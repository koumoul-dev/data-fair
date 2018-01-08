// Analyze dataset data and try to guess the schém
const datasetFileSample = require('../utils/dataset-file-sample')
const CSVSniffer = require('csv-sniffer')()
const sniffer = new CSVSniffer([',', ';', '\t', '|'])
const iconv = require('iconv-lite')
const countLines = require('../utils/count-lines')
const datasetUtils = require('../utils/dataset')
const fieldsSniffer = require('../utils/fields-sniffer')

exports.eventsPrefix = 'analyze'

exports.filter = {status: 'loaded', 'file.mimetype': 'text/csv'}

exports.process = async function(app, dataset) {
  const db = app.get('db')
  const fileSample = await datasetFileSample(dataset)
  const sniffResult = sniffer.sniff(iconv.decode(fileSample, dataset.file.encoding), {
    hasHeader: true
  })
  const schema = dataset.file.schema = sniffResult.labels.map((field, i) => ({
    key: fieldsSniffer.escapeKey(field),
    type: sniffResult.types[i],
    'x-originalName': field
  }))
  const props = dataset.file.props = {
    linesDelimiter: sniffResult.newlineStr,
    fieldsDelimiter: sniffResult.delimiter,
    escapeChar: sniffResult.quoteChar || '"'
  }
  props.numLines = await countLines(datasetUtils.fileName(dataset), sniffResult.newlineStr)

  dataset.status = 'analyzed'
  await db.collection('datasets').updateOne({id: dataset.id}, {
    $set: {
      'file.props': props,
      status: 'analyzed',
      'file.schema': schema
    }
  })
}
