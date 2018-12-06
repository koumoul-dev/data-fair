const debug = require('debug')('app')
debug('enter app.js')
const config = require('config')
const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const WebSocket = require('ws')
const http = require('http')
const util = require('util')
const eventToPromise = require('event-to-promise')
const dbUtils = require('./utils/db')
const esUtils = require('./utils/es')
const wsUtils = require('./utils/ws')
const locksUtils = require('./utils/locks')
const cache = require('./utils/cache')
const apiKey = require('./utils/api-key')
const capture = require('./utils/capture')
const workers = require('./workers')
const upgrade = require('../upgrade')
const baseApplications = require('./routers/base-applications')
const remoteServices = require('./routers/remote-services')
const anonymSession = require('./utils/anonym-session')
const nuxt = require('./nuxt')
const session = require('@koumoul/sd-express')({
  directoryUrl: config.directoryUrl,
  privateDirectoryUrl: config.privateDirectoryUrl || config.directoryUrl,
  publicUrl: config.publicUrl
})
debug('requires are done')

const app = express()

app.use((req, res, next) => {
  if (!req.app.get('api-ready')) res.status(503).send('Service indisponible pour cause de maintenance.')
  else next()
})

if (process.env.NODE_ENV === 'development') {
  app.set('json spaces', 2)

  // Create a mono-domain environment with other services in dev
  const proxy = require('http-proxy-middleware')
  app.use('/openapi-viewer', proxy({ target: 'http://localhost:5680', pathRewrite: { '^/openapi-viewer': '' } }))
  app.use('/simple-directory', proxy({ target: 'http://localhost:8080', pathRewrite: { '^/simple-directory': '' } }))
  app.use('/capture', proxy({ target: 'http://localhost:8087', pathRewrite: { '^/capture': '' } }))
}

app.use(bodyParser.json({ limit: '1000kb' }))
app.use(cookieParser())
// In production CORS is taken care of by the reverse proxy if necessary
if (config.cors.active) app.use(require('cors')(config.cors.opts))

// Business routers
app.use('/api/v1', require('./routers/root'))
app.use('/api/v1/remote-services', session.auth, remoteServices.router)
app.use('/api/v1/catalogs', session.auth, apiKey('catalogs'), require('./routers/catalogs'))
app.use('/api/v1/base-applications', session.auth, baseApplications.router)
app.use('/api/v1/applications', session.auth, apiKey('applications'), require('./routers/applications'))
app.use('/api/v1/datasets', session.auth, apiKey('datasets'), require('./routers/datasets'))
app.use('/api/v1/stats', session.auth, apiKey('stats'), require('./routers/stats'))
app.use('/api/v1/settings', session.auth, require('./routers/settings'))
app.use('/api/v1/admin', session.auth, require('./routers/admin'))
app.use('/api/v1/identities', require('./routers/identities'))
app.use('/api/v1/quotas', session.auth, require('./routers/quotas'))
app.use('/api/v1/session', session.router)
// External applications proxy
app.use('/app', session.loginCallback, session.auth, require('./routers/application-proxy'))

// Error management
app.use((err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).send('invalid token...')
  }
  if (err.statusCode === 500 || !err.statusCode) console.error('Error in express route', err)
  if (!res.headersSent) res.status(err.statusCode || 500).send(err.message)
})

const server = http.createServer(app)
const wss = new WebSocket.Server({ server })

debug('app is initialized, ready to be run')

// Run app and return it in a promise
exports.run = async () => {
  if (!config.listenWhenReady) {
    debug('listen on port', config.port)
    server.listen(config.port)
    await eventToPromise(server, 'listening')
    debug('server is litening')
  }
  debug('upgrade')
  const { db, client } = await upgrade()
  debug('upgrade ok, init db')
  await dbUtils.init(db)
  debug('db ok')
  app.set('db', db)
  app.set('mongoClient', client)
  app.set('anonymSession', await anonymSession.init(db))
  debug('init capture')
  await capture.init()
  debug('capture initialized, init cache')
  await cache.init(db)
  debug('cache initialized, init apps and services')
  baseApplications.init(db)
  await remoteServices.init(db)
  debug('apps and services initialized, init ES')
  app.set('es', await esUtils.init())
  debug('ES initialized, init websockets')
  app.publish = await wsUtils.init(wss, db)
  debug('websockets initialized, init locks')
  await locksUtils.init(db)
  debug('locks initialized')
  workers.start(app)
  app.set('api-ready', true)

  app.use((req, res, next) => {
    if (!req.app.get('ui-ready')) res.status(503).send('Service indisponible pour cause de maintenance.')
    else next()
  })
  app.use(session.decode)
  app.use(session.loginCallback)
  debug('prepare nuxt')
  const nuxtMiddleware = await nuxt()
  debug('nuxt ok')
  app.use(nuxtMiddleware)
  app.set('ui-ready', true)

  if (config.listenWhenReady) {
    debug('listen on port', config.port)
    server.listen(config.port)
    await eventToPromise(server, 'listening')
    debug('server is litening')
  }
  return app
}

exports.stop = async() => {
  await util.promisify((cb) => wss.close(cb))()
  server.close()
  await eventToPromise(server, 'close')
  await wsUtils.stop()
  locksUtils.stop()
  await workers.stop()
  await app.get('mongoClient').close()
  await app.get('es').close()
}
