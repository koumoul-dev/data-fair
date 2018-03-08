const config = require('config')
const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const path = require('path')
const WebSocket = require('ws')
const http = require('http')
const util = require('util')
const eventToPromise = require('event-to-promise')
const dbUtils = require('./utils/db')
const esUtils = require('./utils/es')
const wsUtils = require('./utils/ws.js')
const locksUtils = require('./utils/locks.js')
const status = require('./status')
const workers = require('./workers')

const app = express()
app.use(bodyParser.json({limit: '1000kb'}))
app.use(cookieParser())
// In production CORS is taken care of by the reverse proxy if necessary
if (process.env.NODE_ENV === 'development') app.use(require('cors')())

// Business routers
app.use('/api/v1', require('./root'))
app.use('/api/v1/remote-services', require('./remote-services'))
app.use('/api/v1/applications', require('./applications'))
app.use('/api/v1/datasets', require('./datasets'))
app.get('/api/v1/status', status.status)
app.get('/api/v1/ping', status.ping)
app.use('/api/v1/stats', require('./stats'))
app.use('/api/v1/settings', require('./settings'))
app.use('/app', require('./application-proxy'))

// Static routing
const oneWeek = process.env.NODE_ENV === 'development' ? 0 : 7 * 24 * 60 * 60
const staticOptions = {
  setHeaders: (res) => {
    res.set('cache-control', 'public, max-age=' + oneWeek)
  }
}
app.use('/bundles', express.static(path.join(__dirname, '../public/bundles'), staticOptions))
app.use('/assets', express.static(path.join(__dirname, '../public/assets'), staticOptions))

const pug = require('pug')
const compiledIndex = pug.compileFile(path.join(__dirname, './index.pug'))
const renderedIndex = compiledIndex({
  appJS: config.publicUrl + '/bundles/' + require('../public/bundles/webpack-assets.json').main.js,
  config: JSON.stringify({
    publicUrl: config.publicUrl,
    wsPublicUrl: config.wsPublicUrl,
    directoryUrl: config.directoryUrl,
    adminRole: config.adminRole,
    analytics: config.analytics
  })
})
app.use('/*', (req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=0')
  res.send(renderedIndex)
})

// Error management
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).send('invalid token...')
  }
  if (err.statusCode === 500) console.error('Error in express route', err)
  if (!res.headersSent) res.status(err.statusCode || 500).send(err.message)
})

const server = http.createServer(app)
const wss = new WebSocket.Server({server})

// Run app and return it in a promise
exports.run = async () => {
  const db = await dbUtils.init()
  app.set('db', db)
  app.set('es', esUtils.init())
  app.publish = await wsUtils.init(wss, db)
  await locksUtils.init(db)
  workers.start(app)
  server.listen(config.port)
  await eventToPromise(server, 'listening')
  return app
}

exports.stop = async() => {
  await util.promisify((cb) => wss.close(cb))()
  server.close()
  await eventToPromise(server, 'close')
  wsUtils.stop()
  locksUtils.stop()
  await workers.stop()
  await app.get('db').close()
  await app.get('es').close()
}
