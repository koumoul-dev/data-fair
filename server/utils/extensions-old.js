const { Readable, Transform, Writable } = require('stream')
const util = require('util')
const fs = require('fs-extra')
const path = require('path')
const config = require('config')
const request = require('request')
const byline = require('byline')
const hash = require('object-hash')
const pump = util.promisify(require('pump'))
const flatten = require('flat')
const randomSeed = require('random-seed')
const es = require('./es')
const geoUtils = require('./geo')
const journals = require('./journals')
const datasetUtils = require('./dataset')

const debug = require('debug')('extensions')

// Apply an extension to a dataset: meaning, query a remote service in streaming manner
// and update the documents
exports.extend = async(app, dataset, extension, remoteService, action) => {
  const esClient = app.get('es')
  const db = app.get('db')
  const extensionKey = getExtensionKey(remoteService.id, action.id)
  const indexName = es.aliasName(dataset)
  const inputMapping = prepareInputMapping(action, dataset.schema, extensionKey, extension.select)

  const stats = {}
  debug('dataset.count', dataset.count)

  const setProgress = async (error = '') => {
    try {
      const progress = stats.count / stats.target
      debug(`Progress ${stats.count} / ${stats.target} = ${progress}`)
      await app.publish('datasets/' + dataset.id + '/extend-progress', { remoteService: remoteService.id, action: action.id, progress, error })
      await db.collection('datasets').updateOne({
        id: dataset.id,
        extensions: { $elemMatch: { remoteService: remoteService.id, action: action.id } },
      }, {
        $set: { 'extensions.$.progress': progress, 'extensions.$.error': error, 'extensions.$.forceNext': false },
      })
    } catch (err) {
      console.error('Failure to update progress of an extension', err)
    }
  }

  let progressInterval
  try {
    const inputStream = new ESInputStream({ esClient, indexName, inputMapping, stats, forceNext: extension.forceNext, extensionKey })
    await inputStream.init()
    await setProgress()
    progressInterval = setInterval(setProgress, 600)

    if (stats.missing !== 0) {
      const indexStream = es.indexStream({ esClient, indexName, dataset, stats, updateMode: true })
      await pump(
        inputStream,
        new RemoteExtensionStream({ action, remoteService, extension, dataset, stats, inputMapping, extensionKey }),
        indexStream,
        new Writable({ objectMode: true, write(chunk, encoding, cb) { cb() } }),
      )
      debug('Extension is over')
      const errorsSummary = indexStream.errorsSummary()
      if (errorsSummary) await journals.log(app, dataset, { type: 'error', data: errorsSummary })
    }
    await setProgress()
    clearInterval(progressInterval)
  } catch (err) {
    // catch the error, as a failure to use remote service should not prevent the dataset
    // to be processed and used
    console.error('Failure to extend using remote service', err)
    clearInterval(progressInterval)
    await setProgress(err.message)
  }
}

exports.preserveExtensionStream = (options) => new PreserveExtensionStream(options)

exports.prepareSchema = async (db, schema, extensions) => {
  let extensionsFields = []
  for (const extension of extensions) {
    if (!extension.active) continue
    const remoteService = await db.collection('remote-services').findOne({ id: extension.remoteService })
    if (!remoteService) continue
    const action = remoteService.actions.find(action => action.id === extension.action)
    if (!action) continue
    const extensionKey = getExtensionKey(extension.remoteService, extension.action)
    const extensionId = `${extension.remoteService}/${extension.action}`
    const selectFields = extension.select || []
    extensionsFields = extensionsFields.concat(action.output
      .filter(output => !!output)
      .filter(output => output.name !== 'error' && output.name !== '_error')
      .filter(output => !output.concept || output.concept !== 'http://schema.org/identifier')
      .filter(output => selectFields.length === 0 || selectFields.includes(output.name))
      .map(output => {
        const key = extensionKey + '.' + output.name
        const existingField = schema.find(field => field.key === key)
        if (existingField) return existingField
        return {
          key,
          'x-originalName': output.name,
          'x-extension': extensionId,
          'x-refersTo': output.concept,
          title: output.title,
          description: output.description,
          type: output.type || 'string',
        }
      }))
    const errorField = action.output.find(o => o.name === '_error') || action.output.find(o => o.name === 'error')

    extensionsFields.push({
      key: extensionKey + '.' + (errorField ? errorField.name : 'error'),
      type: 'string',
      'x-originalName': (errorField ? errorField.name : 'error'),
      'x-extension': extensionId,
      title: (errorField && errorField.title) || 'Erreur d\'enrichissement',
      description: (errorField && errorField.description) || 'Une erreur lors de la récupération des informations depuis un service distant',
      'x-calculated': true,
    })
  }
  return schema.filter(field => !field['x-extension']).concat(extensionsFields)
}

function getExtensionKey(remoteServiceId, actionId) {
  return `_ext_${remoteServiceId}_${actionId}`
}

// Create a function that will transform items from a dataset into inputs for an action
function prepareInputMapping(action, schema, extensionKey, selectFields) {
  const fields = action.input.map(input => {
    const field = schema.find(f =>
      f['x-refersTo'] === input.concept &&
      f['x-refersTo'] !== 'http://schema.org/identifier' &&
      f.key.indexOf(extensionKey) !== 0,
    )
    if (field) return [field.key, input.name, field]
  }).filter(i => i)
  const idInput = (action.input.find(input => input.concept === 'http://schema.org/identifier'))
  if (!idInput) throw new Error('A field with concept "http://schema.org/identifier" is required and missing in the remote service action', action)
  return {
    fields,
    transform: (item) => {
      const mappedItem = {}
      fields.forEach(m => {
        const val = item.doc[m[0]]
        if (val !== undefined && val !== '') mappedItem[m[1]] = val
      })
      // remember a hash of the input.. so that we can store it alongside the result and use this to reapply
      // extension to a new version of the index without using the remote service
      const h = hash(mappedItem)
      mappedItem[idInput.name] = item.id
      return [mappedItem, h]
    },
  }
}

// Input stream scanning a full ES index using the scroll api
class ESInputStream extends Readable {
  constructor(options) {
    super({ objectMode: true })
    this.esClient = options.esClient
    this.indexName = options.indexName
    this.stats = options.stats
    this.forceNext = options.forceNext
    this.extensionKey = options.extensionKey
    this.i = 0

    if (!options.inputMapping) {
      this.query = { match_all: {} }
    } else {
      // only consider lines with at least one input field
      this.query = {
        bool: {
          should: options.inputMapping.fields.map(f => {
            const notEmpty = {
              bool: { must: { exists: { field: f[0] } } },
            }
            if (f[2].type === 'string') {
              notEmpty.bool.must_not = { term: { [f[0]]: '' } }
            }
            return notEmpty
          }),
        },
      }
      if (!this.forceNext) {
        this.countQuery = JSON.parse(JSON.stringify(this.query))
        this.countQuery.bool.must = { exists: { field: this.extensionKey + '._hash' } }
        this.query.bool.must_not = { exists: { field: this.extensionKey + '._hash' } }
      }
    }
  }

  async init() {
    if (!this.stats) return
    debug('Count missing query', JSON.stringify(this.query))
    const res = (await this.esClient.count({
      index: this.indexName,
      body: { query: this.query },
    })).body
    this.stats.missing = res.count
    if (this.countQuery) {
      debug('Count already done query', JSON.stringify(this.countQuery))
      const res = (await this.esClient.count({
        index: this.indexName,
        body: { query: this.countQuery },
      })).body
      this.stats.count = res.count
    } else {
      this.stats.count = 0
    }
    this.stats.target = this.stats.missing + this.stats.count
    debug('Initial stats', this.stats)
  }

  async _read() {
    if (this.reading) return
    this.reading = true
    try {
      let res
      if (!this.scrollId) {
        debug('Start streaming query', JSON.stringify(this.query))
        res = (await this.esClient.search({
          index: this.indexName,
          scroll: '15m',
          size: 1000,
          body: { query: this.query },
        })).body
      } else {
        res = (await this.esClient.scroll({ scrollId: this.scrollId, scroll: '15m' })).body
      }
      this.scrollId = res._scroll_id
      for (const hit of res.hits.hits) {
        this.reading = this.push({ id: hit._id, doc: flatten(hit._source, { safe: true }) })
        this.i += 1
      }

      if (res.hits.total.value > this.i) {
        if (this.reading) {
          this.reading = false
          await this._read()
        }
      } else {
        this.push(null)
      }
    } catch (err) {
      console.error('ES read error', err)
      this.emit('error', err)
    }
  }
}

// Perform HTTP requests to a remote service to extend data
class RemoteExtensionStream extends Transform {
  constructor(options) {
    super({ objectMode: true })
    this.i = 0
    this.inputMapping = options.inputMapping
    this.stats = options.stats
    this.extensionKey = options.extensionKey
    this.selectFields = options.extension.select || []
    this.errorKey = options.action.output.find(o => o.name === '_error') ? '_error' : 'error'
    this.buffer = []

    // The field in the output that contains the line identifier of the bulk request
    // same as input if not present
    this.idOutput = options.action.output.find(output => output.concept === 'http://schema.org/identifier') ||
     options.action.input.find(input => input.concept === 'http://schema.org/identifier')

    const opts = {
      method: options.action.operation.method,
      url: options.remoteService.server + options.action.operation.path,
      headers: {
        Accept: 'application/x-ndjson',
        'Content-Type': 'application/x-ndjson',
        'x-consumer': JSON.stringify(options.dataset.owner),
      },
      qs: {},
    }
    // TODO handle query & cookie header types
    if (options.remoteService.apiKey && options.remoteService.apiKey.in === 'header' && options.remoteService.apiKey.value) {
      opts.headers[options.remoteService.apiKey.name] = options.remoteService.apiKey.value
    } else if (config.defaultRemoteKey.in === 'header' && config.defaultRemoteKey.value) {
      opts.headers[config.defaultRemoteKey.name] = config.defaultRemoteKey.value
    }
    if (options.extension.select && options.extension.select.length) {
      opts.qs.select = options.extension.select.join(',')
    }
    this.reqOpts = opts

    this.hashes = {}
    this.buffer = []
  }

  async _transform(item, encoding, callback) {
    try {
      this.i += 1

      // map input, from dataset data to parameters for the remote service
      const [mappedItem, h] = this.inputMapping.transform(item)
      // No actual parameters on this line (only the key)
      // should not happen, we excluded from input previously
      if (Object.keys(mappedItem).length === 1) {
        debug('Empty input item', item)
        if (this.stats) this.stats.count += 1
        return callback()
      }
      this.hashes[item.id] = h
      this.buffer.push(mappedItem)

      if (this.i % 1000 === 0) {
        await this._sendBuffer()
      }
      callback()
    } catch (err) {
      callback(err)
    }
  }

  async _flush(callback) {
    try {
      await this._sendBuffer()
      callback()
    } catch (err) {
      callback(err)
    }
  }

  async _sendBuffer() {
    if (!this.buffer.length) return
    debug(`Send REQ with ${this.buffer.length} items`, this.reqOpts)
    const req = request({ ...this.reqOpts, body: this.buffer.map(JSON.stringify).join('\n') })
    this.buffer = []
    req.on('response', response => {
      debug('REQ sent', response.statusCode)
      if (response.statusCode && response.statusCode > 400) {
        this.emit('error', new Error(`Échec lors de l'appel au service distant ${response.statusCode} ${response.statusMessage || ''}`))
      }
    })

    const _this = this
    await pump(
      req,
      byline.createStream(),
      new Writable({
        objectMode: true,
        write(chunk, encoding, cb) {
          try {
            let item
            try {
              item = JSON.parse(chunk)
            } catch (err) {
              throw new Error('Contenu invalide - ' + chunk)
            }
            if (_this.stats) _this.stats.count += 1
            const selectedItem = Object.keys(item)
              .filter(itemKey => _this.selectFields.length === 0 || _this.selectFields.includes(itemKey) || itemKey === _this.errorKey)
              .reduce((a, itemKey) => { a[itemKey] = item[itemKey]; return a }, {})

            // override potential previous error
            if (!selectedItem[_this.errorKey]) selectedItem[_this.errorKey] = ''

            const mappedItem = { doc: { [_this.extensionKey]: selectedItem } }
            mappedItem.id = item[_this.idOutput.name]
            // debug('mappedItem', mappedItem)
            selectedItem._hash = _this.hashes[mappedItem.id]
            delete _this.hashes[mappedItem.id]
            _this.push(mappedItem)
            cb()
          } catch (err) {
            cb(err)
          }
        },
      }),
    )
  }
}

// Transform stream fetching extensions data from previous index
// used when re-indexing
// TODO: use multi-search for performance
class PreserveExtensionStream extends Transform {
  constructor(options) {
    super({ objectMode: true })
    this.options = options
  }

  async init() {
    const db = this.options.db
    const esClient = this.options.esClient
    this.indexName = es.aliasName(this.options.dataset)
    const extensions = this.options.dataset.extensions || []
    this.mappings = {}
    this.extensionsMap = {}
    this.buffer = []
    this.bufferChars = 0

    // The ES index was not yet created, we will not try to extract previous extensions
    if (!(await esClient.indices.exists({ index: this.indexName })).body) return
    for (const extension of extensions) {
      if (!extension.active) return
      const remoteService = await db.collection('remote-services').findOne({ id: extension.remoteService })
      if (!remoteService) continue
      const action = remoteService.actions.find(action => action.id === extension.action)
      if (!action) continue
      const extensionKey = getExtensionKey(extension.remoteService, extension.action)
      this.mappings[extensionKey] = prepareInputMapping(action, this.options.dataset.schema, extensionKey).transform
      this.extensionsMap[extensionKey] = extension
    }
  }

  async _sendBuffer() {
    if (!this.buffer || !this.buffer.length) return
    const tasks = []
    const searches = []
    const items = this.buffer
    this.buffer = []
    this.bufferChars = 0
    items.forEach(item => {
      // preserve _id other calculated fields
      // this allows to have the same properties when writing full file compared to indexation
      if (!this.options.dataset.isRest && this.options.calculated) {
        tasks.push({ item, extensionKey: 'calculated' })
        searches.push({ index: this.indexName })
        searches.push({
          size: 1,
          _source: '_rand',
          query: { constant_score: { filter: { term: { _i: item._i } } } },
        })
      }

      Object.keys(this.mappings).forEach(extensionKey => {
        const [mappedItem, h] = this.mappings[extensionKey]({ doc: item })
        tasks.push({ item, mappedItem, h, extensionKey })
        searches.push({ index: this.indexName })
        searches.push({
          size: 1,
          _source: `${extensionKey}.*`,
          query: { constant_score: { filter: { term: { [extensionKey + '._hash']: h } } } },
        })
      })
    })

    if (searches.length) {
      const esClient = this.options.esClient
      const { responses } = (await esClient.msearch({ body: searches })).body
      responses.forEach((res, i) => {
        const { item, extensionKey } = tasks[i]
        if (!res.hits) console.error('Missing response.hits in ES extension response', this.options.dataset.id, extensionKey, item, JSON.stringify(res))
        if (res.hits.total.value > 0) {
          if (extensionKey === 'calculated') {
            item._id = res.hits.hits[0]._id
            Object.assign(item, res.hits.hits[0]._source)
          } else {
            const extensionResult = res.hits.hits[0]._source[extensionKey]
            const selectFields = this.extensionsMap[extensionKey].select || []
            const selectedExtensionResult = Object.keys(extensionResult)
              .filter(key => key === '_hash' || selectFields.length === 0 || selectFields.includes(key))
              .reduce((a, key) => { a[key] = extensionResult[key]; return a }, {})
            item[extensionKey] = selectedExtensionResult
          }
        }
      })
    }
    items.forEach(item => this.push(item))
  }

  async _transform(item, encoding, callback) {
    try {
      if (!this.mappings) await this.init()
      this.buffer.push(item)
      this.bufferChars += JSON.stringify(item).length
      if (
        this.buffer.length >= config.elasticsearch.maxBulkLines ||
        this.bufferChars >= config.elasticsearch.maxBulkChars
      ) {
        debug(`preserve extension stream send buffer of ${this.buffer.length} items totalling ${this.bufferChars} chars`)
        await this._sendBuffer()
      }
      callback()
    } catch (err) {
      callback(err)
    }
  }

  async _flush(callback) {
    try {
      await this._sendBuffer()
      callback()
    } catch (err) {
      callback(err)
    }
  }
}

exports.applyCalculations = async (dataset, item) => {
  let warning = null
  const flatItem = flatten(item, { safe: true })

  // Add base64 content of attachments
  const attachmentField = dataset.schema.find(f => f['x-refersTo'] === 'http://schema.org/DigitalDocument')
  if (attachmentField && flatItem[attachmentField.key]) {
    const filePath = path.join(datasetUtils.attachmentsDir(dataset), flatItem[attachmentField.key])
    if (await fs.pathExists(filePath)) {
      const stats = await fs.stat(filePath)
      if (stats.size > config.defaultLimits.attachmentIndexed) {
        warning = 'Pièce jointe trop volumineuse pour être analysée'
      } else {
        item._attachment_url = `${config.publicUrl}/api/v1/datasets/${dataset.id}/attachments/${flatItem[attachmentField.key]}`
        item._file_raw = (await fs.readFile(filePath))
          .toString('base64')
      }
    }
  }

  // calculate geopoint and geometry fields depending on concepts
  if (geoUtils.schemaHasGeopoint(dataset.schema)) {
    Object.assign(item, geoUtils.latlon2fields(dataset, flatItem))
  } else if (geoUtils.schemaHasGeometry(dataset.schema)) {
    Object.assign(item, await geoUtils.geometry2fields(dataset.schema, flatItem))
  }

  // Add a pseudo-random number for random sorting (more natural distribution)
  item._rand = randomSeed.create(dataset.id + item._i)(1000000)

  // split the fields that have a separator in their schema
  dataset.schema.filter(field => field.separator && item[field.key]).forEach(field => {
    item[field.key] = item[field.key].split(field.separator.trim()).map(part => part.trim())
  })
  return warning
}
