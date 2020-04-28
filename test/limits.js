const FormData = require('form-data')
const testUtils = require('./resources/test-utils')
const config = require('config')

const baseLimit = { store_bytes: { limit: 30000, consumption: 0 }, lastUpdate: new Date().toISOString() }

it('Manage a user storage limit', async () => {
  const ax = await global.ax.builder('dmeadus0@answers.com:passwd')

  // Just fill up al little
  let form = new FormData()
  form.append('file', Buffer.alloc(15000), 'dataset.csv')
  let res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
  assert.equal(res.status, 201)

  // Send dataset applying default limits
  form = new FormData()
  form.append('file', Buffer.alloc(10000), 'dataset.csv')
  try {
    res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
    assert.fail()
  } catch (err) {
    assert.equal(err.status, 429)
  }

  // define a higher limit
  res = await ax.post('/api/v1/limits/user/dmeadus0', baseLimit, { params: { key: config.secretKeys.limits } })
  form = new FormData()
  form.append('file', Buffer.alloc(10000), 'dataset.csv')
  res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
  assert.equal(res.status, 201)
  form = new FormData()
  form.append('file', Buffer.alloc(10000), 'dataset.csv')
  try {
    res = await ax.post('/api/v1/datasets', form, { headers: testUtils.formHeaders(form) })
    assert.fail()
  } catch (err) {
    assert.equal(err.status, 429)
  }

  res = await ax.get('/api/v1/limits/user/dmeadus0')
  assert.equal(res.status, 200)
  assert.equal(res.data.store_bytes.limit, 30000)
  assert.equal(res.data.store_bytes.consumption, 25000)
})

it('A user cannot change limits', async () => {
  const ax = await global.ax.builder('dmeadus0@answers.com:passwd')
  try {
    await ax.post('/api/v1/limits/user/dmeadus0', baseLimit)
    assert.fail()
  } catch (err) {
    assert.equal(err.status, 401)
  }
})

it('A user can read his limits', async () => {
  const ax = await global.ax.builder('dmeadus0@answers.com:passwd')
  await ax.post('/api/v1/limits/user/dmeadus0', baseLimit, { params: { key: config.secretKeys.limits } })
  const res = await ax.get('/api/v1/limits/user/dmeadus0')
  assert.equal(res.status, 200)
  assert.equal(res.data.store_bytes.limit, 30000)
})

it('A user cannot read the list of limits', async () => {
  const ax = await global.ax.builder('dmeadus0@answers.com:passwd')
  try {
    await ax.get('/api/v1/limits')
    assert.fail()
  } catch (err) {
    assert.equal(err.status, 401)
  }
})

it('A super admin can read the list of limits', async () => {
  const ax = await global.ax.builder('alban.mouton@koumoul.com:passwd:adminMode')
  await ax.post('/api/v1/limits/user/dmeadus0', baseLimit, { params: { key: config.secretKeys.limits } })
  const res = await ax.get('/api/v1/limits')
  assert.equal(res.status, 200)
  assert.equal(res.data.count, 1)
  assert.equal(res.data.results.length, 1)
  assert.equal(res.data.results[0].id, 'dmeadus0')
  assert.equal(res.data.results[0].type, 'user')
})
