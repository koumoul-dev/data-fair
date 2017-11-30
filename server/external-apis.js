const express = require('express')
const auth = require('./auth')
const ajv = require('ajv')()
const externalApiSchema = require('../contract/external-api.js')
const validate = ajv.compile(externalApiSchema)
const permissions = require('./utils/permissions')
const moment = require('moment')
const shortid = require('shortid')

const router = module.exports = express.Router()

// Get the list of external-apis
router.get('', auth.optionalJwtMiddleware, async function(req, res, next) {
  const externalApis = req.app.get('db').collection('external-apis')
  let query = {}
  let sort = {}
  let size = 10
  let skip = 0
  if (req.query) {
    if (req.query.size && !isNaN(parseInt(req.query.size))) {
      size = parseInt(req.query.size)
    }
    if (req.query.skip && !isNaN(parseInt(req.query.skip))) {
      skip = parseInt(req.query.skip)
    }
    if (req.query.q) {
      query.$text = {
        $search: req.query.q
      }
    }
    Object.assign(query, ...[{
      name: 'owner-type',
      field: 'owner.type'
    }, {
      name: 'owner-id',
      field: 'owner.id'
    }, {
      name: 'source-filename',
      field: 'source.file.name'
    }].filter(p => req.query[p.name] !== undefined).map(p => ({
      [p.field]: req.query[p.name]
    })))
  }
  if (req.query.sort) {
    Object.assign(sort, ...req.query.sort.split(',').map(s => {
      let toks = s.split(':')
      return {
        [toks[0]]: Number(toks[1])
      }
    }))
  }
  // TODO : handle permissions and set the correct filter on the list
  if (req.user) {
    query.$or = []
    query.$or.push({
      'owner.type': 'user',
      'owner.id': req.user.id
    })
    query.$or.push({
      'owner.type': 'organization',
      'owner.id': {
        $in: req.user.organizations.map(o => o.id)
      }
    })
  }
  let mongoQueries = [
    size > 0 ? externalApis.find(query).limit(size).skip(skip).sort(sort).project({
      _id: 0,
      source: 0
    }).toArray() : Promise.resolve([]),
    externalApis.find(query).count()
  ]
  try {
    let [documents, count] = await Promise.all(mongoQueries)
    res.json({
      results: documents,
      count: count
    })
  } catch (err) {
    next(err)
  }
})

// Create an external Api
router.post('', auth.jwtMiddleware, async(req, res, next) => {
  // This id is temporary, we should have an human understandable id, or perhaps manage it UI side ?
  req.body.id = req.body.id || shortid.generate()
  var valid = validate(req.body)
  if (!valid) return res.status(400).send(validate.errors)
  const date = moment().toISOString()
  req.body.createdAt = date
  req.body.createdBy = req.user.id
  req.body.updatedAt = date
  req.body.updatedBy = req.user.id
  try {
    await req.app.get('db').collection('external-apis').insertOne(req.body)
    res.status(201).json(req.body)
  } catch (err) {
    return next(err)
  }
})

// Middlewares
router.use('/:externalApiId', auth.optionalJwtMiddleware, async function(req, res, next) {
  try {
    req.externalApi = await req.app.get('db').collection('external-apis').findOne({
      id: req.params.externalApiId
    }, {
      fields: {
        _id: 0
      }
    })
    if (!req.externalApi) return res.status(404).send('External Api not found')
    next()
  } catch (err) {
    next(err)
  }
})

// retrieve a externalApi by its id
router.get('/:externalApiId', (req, res, next) => {
  if (!permissions(req.externalApi, 'readDescription', req.user)) return res.sendStatus(403)
  res.status(200).send(req.externalApi)
})

// update a externalApi
router.put('/:externalApiId', async(req, res, next) => {
  if (!permissions(req.externalApi, 'writeDescription', req.user)) return res.sendStatus(403)
  var valid = validate(req.body)
  if (!valid) return res.status(400).send(validate.errors)
  req.body.updatedAt = moment().toISOString()
  req.body.updatedBy = req.user.id
  req.body.id = req.params.externalApiId
  try {
    await req.app.get('db').collection('external-apis').updateOne({
      id: req.params.externalApiId
    }, req.body)
    res.status(200).json(req.body)
  } catch (err) {
    return next(err)
  }
})

// Delete a externalApi
router.delete('/:externalApiId', async(req, res, next) => {
  if (!permissions(req.externalApi, 'delete', req.user)) return res.sendStatus(403)
  try {
    // TODO : Remove indexes
    await req.app.get('db').collection('external-apis').deleteOne({
      id: req.params.externalApiId
    })
    res.sendStatus(204)
  } catch (err) {
    return next(err)
  }
})
