// Simple subscribe mechanism to follow channels of messages from the server
// Bodies are simple JSON objects following theses conventions:

/*
Upstream examples:
{type: 'subscribe', channel: 'my_channel'}
{type: 'unsubscribe', channel: 'my_channel'}

Downstream examples:
{type: 'subscribe-confirm', channel: 'my_channel'}
{type: 'unsubscribe-confirm', channel: 'my_channel'}
{type: 'message', channel: 'my_channel', data: {...}}
{type: 'error', data: {...}}
*/
const shortid = require('shortid')

let cursor
const subscribers = {}
const clients = {}

let stopped = false
exports.stop = async () => {
  stopped = true
  await cursor.close()
}

async function channel(db) {
  return db.createCollection('messages', { capped: true, size: 100000, max: 1000 })
}

exports.initServer = async (wss, db) => {
  wss.on('connection', ws => {
    // Associate ws connections to ids for subscriptions
    const clientId = shortid.generate()
    clients[clientId] = ws

    // Manage subscribe/unsubscribe demands
    ws.on('message', str => {
      if (stopped) return
      let message
      try {
        message = JSON.parse(str)
      } catch (err) {
        return ws.send(JSON.stringify({ type: 'error', data: err.message }))
      }
      if (!message.type || ['subscribe', 'unsubscribe'].indexOf(message.type) === -1) {
        return ws.send(JSON.stringify({ type: 'error', data: 'type should be "subscribe" or "unsubscribe"' }))
      }
      if (!message.channel) {
        return ws.send(JSON.stringify({ type: 'error', data: '"channel" is required' }))
      }
      if (message.type === 'subscribe') {
        subscribers[message.channel] = subscribers[message.channel] || {}
        subscribers[message.channel][clientId] = 1
        return ws.send(JSON.stringify({ type: 'subscribe-confirm', channel: message.channel }))
      }
      if (message.type === 'unsubscribe') {
        subscribers[message.channel] = subscribers[message.channel] || {}
        delete subscribers[message.channel][clientId]
        return ws.send(JSON.stringify({ type: 'unsubscribe-confirm', channel: message.channel }))
      }
    })

    ws.on('close', () => {
      Object.keys(subscribers).forEach(sub => {
        delete sub[clientId]
      })
      delete clients[clientId]
    })

    ws.on('error', () => ws.terminate())

    ws.isAlive = true
    ws.on('pong', () => { ws.isAlive = true })
  })

  // standard ping/pong used to detect lost connections
  setInterval(function ping() {
    if (stopped) return
    wss.clients.forEach(ws => {
      if (ws.isAlive === false) return ws.terminate()

      ws.isAlive = false
      ws.ping('', false, () => {})
    })
  }, 30000)

  // Listen to pubsub channel based on mongodb to support scaling on multiple processes
  const mongoChannel = await channel(db)
  await mongoChannel.insertOne({ type: 'init' })
  cursor = mongoChannel.find({}, { tailable: true, awaitdata: true, numberOfRetries: -1 })
  cursor.forEach(doc => {
    if (stopped) return
    if (doc && doc.type === 'message') {
      const subs = subscribers[doc.channel] || {}
      Object.keys(subs).forEach(sub => {
        if (clients[sub]) clients[sub].send(JSON.stringify(doc))
      })
    }
  })
}

exports.initPublisher = async (db) => {
  // Write to pubsub channel
  const mongoChannel = await channel(db)
  await mongoChannel.insertOne({ type: 'init' })
  return (channel, data) => mongoChannel.insertOne({ type: 'message', channel, data })
}
