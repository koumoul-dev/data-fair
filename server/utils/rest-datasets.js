const config = require('config')
const fs = require('fs-extra')
const path = require('path')
const createError = require('http-errors')
const { nanoid } = require('nanoid')
const util = require('util')
const pump = util.promisify(require('pump'))
const ajv = require('ajv')()
const multer = require('multer')
const mime = require('mime-types')
const { Readable, Transform, Writable } = require('stream')
const moment = require('moment')
const { crc32 } = require('crc')
const stableStringify = require('fast-json-stable-stringify')
const datasetUtils = require('./dataset')
const attachmentsUtils = require('./attachments')
const findUtils = require('./find')
const fieldsSniffer = require('./fields-sniffer')
const esUtils = require('../utils/es')

const actions = ['create', 'update', 'patch', 'delete']

function cleanLine(line) {
  delete line._needsIndexing
  delete line._deleted
  delete line._action
  delete line._error
  delete line._hash
  return line
}

const tmpDir = path.join(config.dataDir, 'tmp')
const destination = async (req, file, cb) => {
  try {
    await fs.ensureDir(tmpDir)
    cb(null, tmpDir)
  } catch (err) {
    cb(err)
  }
}

const filename = async (req, file, cb) => {
  try {
    const uid = nanoid()
    // creating empty file before streaming seems to fix some weird bugs with NFS
    await fs.ensureFile(path.join(tmpDir, uid))
    cb(null, uid)
  } catch (err) {
    cb(err)
  }
}

const transactionsPacketsSize = 100
const padISize = (transactionsPacketsSize - 1).toString().length
// cf https://github.com/puckey/pad-number/blob/master/index.js
const padI = (i) => {
  const str = i.toString()
  return new Array((padISize - str.length) + 1).join('0') + str
}

exports.uploadAttachment = multer({
  storage: multer.diskStorage({ destination, filename }),
}).single('attachment')

exports.uploadBulk = multer({
  storage: multer.diskStorage({ destination, filename }),
}).fields([{ name: 'attachments', maxCount: 1 }, { name: 'actions', maxCount: 1 }])

exports.collection = (db, dataset) => {
  return db.collection('dataset-data-' + dataset.id)
}

exports.revisionsCollection = (db, dataset) => {
  return db.collection('dataset-revisions-' + dataset.id)
}

exports.initDataset = async (db, dataset) => {
  // just in cas of badly cleaner data from previous dataset with same if
  try {
    await exports.deleteDataset(db, dataset)
  } catch (err) {
    // nothing
  }
  const collection = exports.collection(db, dataset)
  const revisionsCollection = exports.revisionsCollection(db, dataset)
  await Promise.all([
    collection.createIndex({ _needsIndexing: 1 }),
    revisionsCollection.createIndex({ _lineId: 1, _updatedAt: -1 }, { unique: true }),
  ])
}

exports.deleteDataset = async (db, dataset) => {
  await Promise.all([
    exports.collection(db, dataset).drop(),
    exports.revisionsCollection(db, dataset).drop(),
  ])
}

const getLineId = (line, dataset) => {
  if (dataset.primaryKey && dataset.primaryKey.length) {
    const primaryKey = dataset.primaryKey.map(p => line[p])
    return Buffer.from(JSON.stringify(primaryKey).slice(2, -2)).toString('hex')
  }
}

const applyTransactions = async (req, transacs, validate) => {
  const db = req.app.get('db')
  const dataset = req.dataset
  const datasetCreatedAt = new Date(dataset.createdAt).getTime()
  const updatedAt = new Date()
  const collection = exports.collection(db, dataset)
  const history = dataset.rest && dataset.rest.history
  const patchProjection = dataset.schema
          .filter(f => !f['x-calculated'])
          .filter(f => !f['x-extension'])
          .reduce((a, p) => { a[p.key] = 1; return a }, {})
  const results = []

  let i = 0
  for (const transac of transacs) {
    let { _action, ...body } = transac
    if (!actions.includes(_action)) throw createError(400, `action "${_action}" is unknown, use one of ${JSON.stringify(actions)}`)
    if (!body._id) body._id = getLineId(body, dataset)
    if (_action === 'create' && !body._id) body._id = nanoid()
    if (!body._id) throw createError(400, '"_id" attribute is required')

    const extendedBody = { ...body }
    extendedBody._needsIndexing = true
    extendedBody._updatedAt = updatedAt
    extendedBody._i = Number((updatedAt.getTime() - datasetCreatedAt) + padI(i))
    i++

    const result = { _id: body._id, _action }

    if (req.user) extendedBody._updatedBy = { id: req.user.id, name: req.user.name }

    if (_action === 'delete') {
      extendedBody._deleted = true
      extendedBody._hash = null
      try {
        await collection.replaceOne({ _id: body._id }, extendedBody)
      } catch (err) {
        result._error = err.message
        result._status = 500
      }
    } else {
      extendedBody._deleted = false
      if (_action === 'patch') {
        const previousBody = await collection.findOne({ _id: body._id }, { projection: patchProjection })
        if (previousBody) {
          body = { ...previousBody, ...body }
          Object.assign(extendedBody, body)
        }
      }

      if (validate && !validate(body)) {
        await new Promise(resolve => setTimeout(resolve, 0)) // non-blocking in case of large series of errors
        result._error = validate.errors
        result._status = 400
      } else {
        extendedBody._hash = crc32(stableStringify(body)).toString(16)
        const filter = { _id: body._id, _hash: { $ne: extendedBody._hash } }
        try {
          await collection.replaceOne(filter, extendedBody, { upsert: true })
        } catch (err) {
          if (err.code === 11000) {
            // this conflict means that the hash was unchanged
            result.status = 304
          } else {
            result._error = err.message
            result._status = 500
          }
        }
      }
    }

    if (history && !result._error) {
      const revisionsCollection = exports.revisionsCollection(db, dataset)
      const revision = { ...extendedBody, _action }
      delete revision._needsIndexing
      revision._lineId = revision._id
      delete revision._id
      if (!revision._deleted) delete revision._deleted
      await revisionsCollection.insertOne(revision)
    }

    // disable this systematic broadcasting of transactions, not a good idea when doing large bulk inserts
    // and not really used anyway
    // if (!result._error) await req.app.publish('datasets/' + dataset.id + '/transactions', transac)

    results.push({ ...result, ...extendedBody })
  }

  return results
}

class TransactionStream extends Writable {
  constructor(options) {
    super({ objectMode: true })
    this.options = options
    this.i = 0
    this.transactions = []
  }

  async _applyTransactions() {
    const results = await applyTransactions(this.options.req, this.transactions, this.options.validate)
    this.transactions = []
    results.forEach(res => {
      if (res._error) {
        this.options.summary.nbErrors += 1
        if (this.options.summary.errors.length < 10) this.options.summary.errors.push({ line: this.i, error: res._error, status: res._status })
      } else {
        this.options.summary.nbOk += 1
        if (res.status === 304) {
          this.options.summary.nbNotModified += 1
        }
      }
      this.i += 1
    })
    this.emit('batch')
  }

  async _write(chunk, encoding, cb) {
    try {
      chunk._action = chunk._action || (chunk._id ? 'update' : 'create')
      delete chunk._i
      this.transactions.push(chunk)
      // WARNING: changing this number has impact on the _i generation logic
      if (this.transactions.length > transactionsPacketsSize) await this._applyTransactions()
    } catch (err) {
      return cb(err)
    }
    cb()
  }

  async _final(cb) {
    try {
      await this._applyTransactions()
    } catch (err) {
      return cb(err)
    }
    cb()
  }
}

const compileSchema = (dataset) => {
  return ajv.compile({
    type: 'object',
    additionalProperties: false,
    properties: dataset.schema
      .filter(f => f.key[0] !== '_')
      .concat([{ key: '_id', type: 'string' }])
      .reduce((a, b) => { a[b.key] = { ...b, enum: undefined, key: undefined, ignoreDetection: undefined, separator: undefined }; return a }, {}),
  })
}

async function manageAttachment(req, keepExisting) {
  if (req.is('multipart/form-data')) {
    // When taken from form-data everything is string.. convert to actual types
    req.dataset.schema
      .filter(f => !f['x-calculated'])
      .forEach(f => {
        if (req.body[f.key] !== undefined) req.body[f.key] = fieldsSniffer.format(req.body[f.key], f)
      })
  }
  const lineId = req.params.lineId || req.body._id
  const dir = path.join(datasetUtils.attachmentsDir(req.dataset), lineId)

  if (req.file) {
    // An attachment was uploaded
    await fs.ensureDir(dir)
    await fs.emptyDir(dir)
    await fs.rename(req.file.path, path.join(dir, req.file.originalname))
    const relativePath = path.join(lineId, req.file.originalname)
    const pathField = req.dataset.schema.find(f => f['x-refersTo'] === 'http://schema.org/DigitalDocument')
    if (!pathField) {
      throw createError(400, 'Le schéma ne prévoit pas d\'associer une pièce jointe')
    }
    req.body[pathField.key] = relativePath
  } else if (!keepExisting) {
    await fs.remove(dir)
  }
}

exports.readLine = async (req, res, next) => {
  const db = req.app.get('db')
  const collection = exports.collection(db, req.dataset)
  const line = await collection.findOne({ _id: req.params.lineId })
  if (!line) return res.status(404).send('Identifiant de ligne inconnu')
  if (line._deleted) return res.status(404).send('Identifiant de ligne inconnu')
  cleanLine(line)
  const updatedAt = (new Date(line._updatedAt)).toUTCString()
  const ifModifiedSince = req.get('If-Modified-Since')
  if (ifModifiedSince && updatedAt === ifModifiedSince) return res.status(304).send()
  res.setHeader('Last-Modified', updatedAt)
  res.send(line)
}

exports.createLine = async (req, res, next) => {
  const db = req.app.get('db')
  const _action = req.body._id ? 'update' : 'create'
  req.body._id = req.body._id || getLineId(req.body, req.dataset) || nanoid()
  await manageAttachment(req, false)
  const line = (await applyTransactions(req, [{ _action, ...req.body }], compileSchema(req.dataset)))[0]
  if (line._error) return res.status(line._status).send(line._error)
  await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  res.status(201).send(cleanLine(line))
  datasetUtils.updateStorage(db, req.dataset)
}

exports.deleteLine = async (req, res, next) => {
  const db = req.app.get('db')
  const line = (await applyTransactions(req, [{ _action: 'delete', _id: req.params.lineId }], compileSchema(req.dataset)))[0]
  if (line._error) return res.status(line._status).send(line._error)
  await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  res.status(204).send()
  datasetUtils.updateStorage(db, req.dataset)
}

exports.updateLine = async (req, res, next) => {
  const db = req.app.get('db')
  await manageAttachment(req, false)
  const line = (await applyTransactions(req, [{ _action: 'update', _id: req.params.lineId, ...req.body }], compileSchema(req.dataset)))[0]
  if (line._error) return res.status(line._status).send(line._error)
  await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  res.status(200).send(cleanLine(line))
  datasetUtils.updateStorage(db, req.dataset)
}

exports.patchLine = async (req, res, next) => {
  const db = req.app.get('db')
  await manageAttachment(req, true)
  const line = (await applyTransactions(req, [{ _action: 'patch', _id: req.params.lineId, ...req.body }], compileSchema(req.dataset)))[0]
  if (line._error) return res.status(line._status).send(line._error)
  await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  res.status(200).send(cleanLine(line))
  datasetUtils.updateStorage(db, req.dataset)
}

exports.deleteAllLines = async (req, res, next) => {
  const db = req.app.get('db')
  const esClient = req.app.get('es')
  await exports.initDataset(db, req.dataset)
  const indexName = await esUtils.initDatasetIndex(esClient, req.dataset)
  await esUtils.switchAlias(esClient, req.dataset, indexName)
  await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  res.status(204).send()
  datasetUtils.updateStorage(db, req.dataset)
}

exports.bulkLines = async (req, res, next) => {
  const db = req.app.get('db')
  const validate = compileSchema(req.dataset)

  // no buffering nor caching of this response in the reverse proxy
  res.setHeader('X-Accel-Buffering', 'no')

  // If attachments are sent, add them to the existing ones
  if (req.files && req.files.attachments && req.files.attachments[0]) {
    await attachmentsUtils.addAttachments(req.dataset, req.files.attachments[0])
  }

  // The list of actions/operations/transactions is either in a "actions" file
  // or directly in the body
  let inputStream, parseStreams
  const transactionSchema = [...req.dataset.schema, { key: '_id', type: 'string' }, { key: '_action', type: 'string' }]
  if (req.files && req.files.actions && req.files.actions.length) {
    inputStream = fs.createReadStream(req.files.actions[0].path)

    // handle .csv.gz file or other .gz files
    let actionsMime = mime.lookup(req.files.actions[0].originalname)
    if (req.files.actions[0].originalname.endsWith('.gz')) {
      actionsMime = mime.lookup(req.files.actions[0].originalname.slice(0, -3))
      if (actionsMime) actionsMime += '+gzip'
    }
    parseStreams = datasetUtils.transformFileStreams(actionsMime || 'application/x-ndjson', transactionSchema)
  } else {
    inputStream = req
    const contentType = req.get('Content-Type') && req.get('Content-Type').split(';')[0]
    parseStreams = datasetUtils.transformFileStreams(contentType || 'application/json', transactionSchema)
  }
  const summary = { nbOk: 0, nbNotModified: 0, nbErrors: 0, errors: [] }
  const transactionStream = new TransactionStream({ req, validate, summary })

  // we try both to have a HTTP failure if the transactions are clearly badly formatted
  // and also to start writing in the HTTP response as soon as possible to limit the timeout risks
  // this is accomplished partly by the keepalive option to async-wrap (see in the datasets router)
  let firstBatch = true
  transactionStream.on('batch', () => {
    if (firstBatch) {
      res.writeHeader(!summary.nbOk && summary.nbErrors ? 400 : 200, { 'Content-Type': 'application/json' })
      firstBatch = false
    } else {
      res.write(' ')
    }
  })
  try {
    await pump(
      inputStream,
      ...parseStreams,
      transactionStream,
    )
    await db.collection('datasets').updateOne({ id: req.dataset.id }, { $set: { status: 'updated' } })
  } catch (err) {
    if (firstBatch) {
      res.writeHeader(500, { 'Content-Type': 'application/json' })
    }
    summary.nbErrors += 1
    summary.errors.push({ line: -1, error: err.message })
  }
  res.write(JSON.stringify(summary, null, 2))
  res.end()
  datasetUtils.updateStorage(db, req.dataset)

  for (const key in req.files) {
    for (const file of req.files[key]) {
      await fs.unlink(file.path)
    }
  }
}

exports.readLineRevisions = async (req, res, next) => {
  if (!req.dataset.rest || !req.dataset.rest.history) {
    return res.status(400).send('L\'historisation des lignes n\'est pas activée pour ce jeu de données.')
  }
  const revisionsCollection = exports.revisionsCollection(req.app.get('db'), req.dataset)
  const filter = { _lineId: req.params.lineId }
  const [skip, size] = findUtils.pagination(req.query)
  const [total, results] = await Promise.all([
    revisionsCollection.countDocuments(filter),
    revisionsCollection.find(filter).sort({ _updatedAt: -1 }).skip(skip).limit(size).toArray(),
  ])
  results.forEach(r => {
    r._id = r._lineId
    delete r._lineId
  })
  res.send({ total, results })
}

exports.readStreams = (db, dataset, onlyUpdated) => {
  const collection = exports.collection(db, dataset)
  const filter = {}
  if (onlyUpdated) filter._needsIndexing = true
  return [
    collection.find(filter).batchSize(100).stream(),
    new Transform({
      objectMode: true,
      async transform(chunk, encoding, cb) {
        // now _i should always be defined, but keep the OR for retro-compatibility
        chunk._i = chunk._i || chunk._updatedAt.getTime()
        cb(null, chunk)
      },
    }),
  ]
}

exports.writeExtendedStreams = (db, dataset) => {
  const collection = exports.collection(db, dataset)
  return [new Writable({
    objectMode: true,
    async write(item, encoding, cb) {
      try {
        await collection.replaceOne({ _id: item._id }, item)
        cb()
      } catch (err) {
        cb(err)
      }
    },
  })]
}

exports.markIndexedStream = (db, dataset) => {
  const collection = exports.collection(db, dataset)
  return new Writable({
    objectMode: true,
    async write(chunk, encoding, cb) {
      try {
        this.i = this.i || 0
        this.bulkOp = this.bulkOp || collection.initializeUnorderedBulkOp()
        const line = await collection.findOne({ _id: chunk._id })
        // if the line was updated in the interval since reading for indexing
        // do not mark it as properly indexed
        if (chunk._updatedAt.getTime() === line._updatedAt.getTime()) {
          this.i += 1
          if (chunk._deleted) {
            this.bulkOp.find({ _id: chunk._id }).deleteOne()
          } else {
            this.bulkOp.find({ _id: chunk._id }).updateOne({ $set: { _needsIndexing: false } })
          }
        }
        if (this.i === 100) {
          await this.bulkOp.execute()
          this.i = 0
          this.bulkOp = null
        }
        cb()
      } catch (err) {
        cb(err)
      }
    },
    async final(cb) {
      try {
        if (this.i) await this.bulkOp.execute()
        cb()
      } catch (err) {
        cb(err)
      }
    },
  })
}

exports.count = (db, dataset, filter) => {
  const collection = exports.collection(db, dataset)
  if (filter) return collection.countDocuments(filter)
  else return collection.estimatedDocumentCount()
}

exports.applyTTL = async (app, dataset) => {
  const es = app.get('es')
  const query = `${dataset.rest.ttl.prop}:[* TO ${moment().subtract(dataset.rest.ttl.delay.value, dataset.rest.ttl.delay.unit).toISOString()}]`
  const summary = { nbOk: 0, nbErrors: 0, errors: [] }
  await pump(
    new Readable({
      objectMode: true,
      async read() {
        if (this.reading) return
        this.reading = true
        try {
          let { body } = await es.search({
            index: esUtils.aliasName(dataset),
            scroll: '15m',
            size: 1,
            body: {
              query: {
                query_string: { query },
              },
              _source: false,
            },
          })
          while (body.hits.hits.length) {
            body.hits.hits.forEach(hit => this.push(hit))
            body = (await es.scroll({ scrollId: body._scroll_id, scroll: '15m' })).body
          }
          this.push(null)
        } catch (err) {
          this.emit('error', err)
        }
      },
    }),
    new Transform({
      objectMode: true,
      async transform(hit, encoding, callback) {
        return callback(null, { _action: 'delete', _id: hit._id })
      },
    }),
    new TransactionStream({ req: { app, dataset }, summary }),
  )
  const patch = { 'rest.ttl.checkedAt': new Date().toISOString() }
  if (summary.nbOk) patch.status = 'updated'

  await app.get('db').collection('datasets')
    .updateOne({ id: dataset.id }, { $set: patch })
}
