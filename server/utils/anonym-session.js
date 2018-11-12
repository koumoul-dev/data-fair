// Manage anonymous sessions for applications' users
// Distinct from authentication's session

const url = require('url')
const crypto = require('crypto')
const config = require('config')
const expressSession = require('express-session')
const MongoStore = require('connect-mongo')(expressSession)

const hour = 3600000
const publicPath = url.parse(config.publicUrl).pathname

exports.init = async (db) => {
  const store = new MongoStore({ db, stringify: false, collection: 'sessions' })

  try {
    await db.collection('secrets').insertOne({ _id: 'anonym-session', secret: crypto.randomBytes(50).toString('hex') })
  } catch (err) {
    if (err.code !== 11000) throw err
  }
  const secret = (await db.collection('secrets').findOne({ _id: 'anonym-session' })).secret
  return expressSession({
    store,
    secret,
    name: 'session_id',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: hour, path: publicPath } }
  )
}