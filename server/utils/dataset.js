const fs = require('fs')
const path = require('path')
const Combine = require('stream-combiner')
const { Transform } = require('stream')
const iconv = require('iconv-lite')
const config = require('config')
const csv = require('csv-parser')
const JSONStream = require('JSONStream')
const dir = require('node-dir')
const axios = require('axios')
const fieldsSniffer = require('./fields-sniffer')

exports.fileName = (dataset) => {
  return path.join(config.dataDir, dataset.owner.type, dataset.owner.id, dataset.id + '.' + dataset.file.name.split('.').pop())
}

exports.originalFileName = (dataset) => {
  return path.join(config.dataDir, dataset.owner.type, dataset.owner.id, dataset.id + '.' + dataset.originalFile.name.split('.').pop())
}

exports.extractedFilesDirname = (dataset) => {
  return path.join(config.dataDir, dataset.owner.type, dataset.owner.id, dataset.id + '.files')
}

exports.lsExtractedFiles = async (dataset) => {
  const dirName = exports.extractedFilesDirname(dataset)
  const files = (await dir.promiseFiles(dirName))
    .map(f => path.relative(dirName, f))
  return files.filter(p => path.basename(p).toLowerCase() !== 'thumbs.db')
}

exports.lsFiles = async (dataset) => {
  const infos = {}
  if (dataset.file) {
    const filePath = exports.fileName(dataset)
    infos.file = { filePath, size: (await fs.promises.stat(filePath)).size }
  }
  if (dataset.originalFile) {
    const filePath = exports.originalFileName(dataset)
    infos.originalFile = { filePath, size: (await fs.promises.stat(filePath)).size }
  }
  if (dataset.hasFiles) {
    const dirPath = exports.extractedFilesDirname(dataset)
    const paths = await exports.lsExtractedFiles(dataset)
    const files = []
    for (let p of paths) {
      const filePath = path.join(dirPath, p)
      files.push({ filePath, size: (await fs.promises.stat(filePath)).size })
    }
    infos.extractedFiles = { nb: files.length, files }
  }
  return infos
}

// Read the dataset file and get a stream of line items
exports.readStream = (dataset) => {
  let parser, transformer
  if (dataset.file.mimetype === 'text/csv') {
    // use result from csv-sniffer to configure parser
    parser = csv({
      separator: dataset.file.props.fieldsDelimiter,
      quote: dataset.file.props.escapeChar,
      newline: dataset.file.props.linesDelimiter
    })
    // reject empty lines (parsing failures from csv-parser)
    transformer = new Transform({
      objectMode: true,
      transform(item, encoding, callback) {
        const hasContent = Object.keys(item).reduce((a, b) => a || ![undefined, '\n', '\r', '\r\n'].includes(item[b]), false)
        item._i = this.i = (this.i || 0) + 1
        if (hasContent) callback(null, item)
        else callback()
      }
    })
  } else if (dataset.file.mimetype === 'application/geo+json') {
    parser = JSONStream.parse('features.*')
    // transform geojson features into raw data items
    transformer = new Transform({
      objectMode: true,
      transform(feature, encoding, callback) {
        const item = { ...feature.properties }
        if (feature.id) item.id = feature.id
        item.geometry = feature.geometry
        item._i = this.i = (this.i || 0) + 1
        callback(null, item)
      }
    })
  } else {
    throw new Error('Dataset type is not supported ' + dataset.file.mimetype)
  }
  return Combine(
    fs.createReadStream(exports.fileName(dataset)),
    iconv.decodeStream(dataset.file.encoding),
    parser,
    transformer,
    // Fix the objects based on fields sniffing
    new Transform({
      objectMode: true,
      transform(chunk, encoding, callback) {
        const line = {}
        dataset.schema.forEach(prop => {
          // console.log(chunk[prop['x-originalName']])
          // console.log(fieldsSniffer.format(chunk[prop['x-originalName']], prop))
          const value = fieldsSniffer.format(chunk[prop['x-originalName']], prop)
          if (value !== null) line[prop.key] = value
        })
        line._i = chunk._i
        callback(null, line)
      }
    })
  )
}

exports.storageSize = async (db, owner) => {
  const aggQuery = [
    { $match: { 'owner.type': owner.type, 'owner.id': owner.id } },
    { $project: { 'file.size': 1 } },
    { $group: { _id: null, totalSize: { $sum: '$file.size' } } }
  ]
  const res = await db.collection('datasets').aggregate(aggQuery).toArray()
  return res.length ? res[0].totalSize : 0
}

// After a change that might impact consumed storage, we store the value
// and trigger optional webhooks
exports.updateStorageSize = async (db, owner) => {
  const currentSize = await exports.storageSize(db, owner)
  const consumption = { storage: currentSize }
  await db.collection('quotas').updateOne({ type: owner.type, id: owner.id }, { $set: { consumption } })
  for (let webhook of config.globalWebhooks.consumption) {
    const url = webhook.replace('{type}', owner.type).replace('{id}', owner.id)
    axios.post(url, consumption).catch(err => {
      console.error(`Failure to push consumption webhook ${url} - ${JSON.stringify(consumption)}`, err)
    })
  }
}

exports.storageRemaining = async (db, owner) => {
  const quotas = await db.collection('quotas')
    .findOne({ type: owner.type, id: owner.id })
  const limit = (quotas && quotas.storage !== undefined) ? quotas.storage : config.defaultLimits.totalStorage
  if (limit === -1) return -1
  const size = await exports.storageSize(db, owner)
  return Math.max(0, limit - size)
}
