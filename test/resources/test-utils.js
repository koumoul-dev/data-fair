// require('cache-require-paths')
const fs = require('fs-extra')
const FormData = require('form-data')

exports.formHeaders = (form, organizationId) => {
  const headers = { 'Content-Length': form.getLengthSync(), ...form.getHeaders() }
  if (organizationId) headers['x-organizationId'] = organizationId
  return headers
}

exports.sendDataset = async(fileName, ax, organizationId) => {
  const datasetFd = fs.readFileSync('./test/resources/' + fileName)
  const form = new FormData()
  form.append('file', datasetFd, fileName)
  const res = await ax.post('/api/v1/datasets', form, { headers: exports.formHeaders(form, organizationId) })
  const workers = require('../../server/workers')
  return workers.hook(`finalizer/${res.data.id}`)
}
