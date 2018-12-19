const config = require('config')
const express = require('express')
const asyncWrap = require('../utils/async-wrap')
const pjson = require('../../package.json')
const findUtils = require('../utils/find')
const thumbor = require('../utils/thumbor')
const router = module.exports = express.Router()

// All routes in the router are only for the super admins of the service
router.use(asyncWrap(async (req, res, next) => {
  if (!req.user) return res.status(401).send()
  if (!req.user.isAdmin) return res.status(403).send()
  next()
}))

router.get('/info', asyncWrap(async (req, res, next) => {
  res.send({
    version: pjson.version,
    config
  })
}))

router.get('/datasets-errors', asyncWrap(async (req, res, next) => {
  const datasets = req.app.get('db').collection('datasets')
  const query = { status: 'error' }
  const [skip, size] = findUtils.pagination(req.query)

  const aggregatePromise = datasets.aggregate([
    { $match: query },
    { $project: { _id: 0, id: 1, title: 1, description: 1, updatedAt: 1, owner: 1 } },
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: size },
    { $lookup: { from: 'journals', localField: 'id', foreignField: 'id', as: 'journal' } },
    { $unwind: '$journal' },
    { $match: { 'journal.type': 'dataset' } },
    { $addFields: { event: { $arrayElemAt: ['$journal.events', -1] } } },
    { $project: { id: 1, title: 1, description: 1, updatedAt: 1, owner: 1, event: 1 } }
  ]).toArray()

  const [count, results] = await Promise.all([ datasets.countDocuments(query), aggregatePromise ])

  res.send({ count, results })
}))

router.get('/applications-errors', asyncWrap(async (req, res, next) => {
  const applications = req.app.get('db').collection('applications')
  const query = { status: 'error' }
  const [skip, size] = findUtils.pagination(req.query)

  const aggregatePromise = applications.aggregate([
    { $match: query },
    { $project: { _id: 0, id: 1, title: 1, description: 1, updatedAt: 1, owner: 1 } },
    { $sort: { updatedAt: -1 } },
    { $skip: skip },
    { $limit: size },
    { $lookup: { from: 'journals', localField: 'id', foreignField: 'id', as: 'journal' } },
    { $unwind: '$journal' },
    { $match: { 'journal.type': 'application' } },
    { $addFields: { event: { $arrayElemAt: ['$journal.events', -1] } } },
    { $project: { id: 1, title: 1, description: 1, updatedAt: 1, owner: 1, event: 1 } }
  ]).toArray()

  const [count, results] = await Promise.all([ applications.countDocuments(query), aggregatePromise ])

  res.send({ count, results })
}))

router.get('/owners', asyncWrap(async(req, res) => {
  const quotas = req.app.get('db').collection('quotas')
  const [skip, size] = findUtils.pagination(req.query)
  const query = {}
  if (req.query.q) query.$text = { $search: req.query.q }

  const agg = [{
    $match: query
  }, {
    $sort: { name: 1 }
  }, {
    $skip: skip
  }, {
    $limit: size
  }, {
    // imperfect.. we should do a lookup on both owner.id and owner.type
    $lookup: {
      from: 'datasets',
      localField: 'id',
      foreignField: 'owner.id',
      as: 'datasets'
    }
  }, {
    // imperfect.. we should do a lookup on both owner.id and owner.type
    $lookup: {
      from: 'applications',
      localField: 'id',
      foreignField: 'owner.id',
      as: 'applications'
    }
  }, {
    $project: {
      id: 1,
      type: 1,
      name: 1,
      nbDatasets: { $size: '$datasets' },
      nbApplications: { $size: '$applications' },
      consumption: 1,
      storage: 1
    }
  }]

  const aggPromise = quotas.aggregate(agg).toArray()
  const [count, results] = await Promise.all([ quotas.countDocuments(query), aggPromise ])
  res.send({ count, results })
}))

router.get('/base-applications', asyncWrap(async(req, res) => {
  const baseApps = req.app.get('db').collection('base-applications')
  const [skip, size] = findUtils.pagination(req.query)
  const query = {}
  if (req.query.public) query.public = true
  if (req.query.q) query.$text = { $search: req.query.q }

  const agg = [{
    $match: query
  }, {
    $sort: { public: -1, title: 1 }
  }, {
    $skip: skip
  }, {
    $limit: size
  }, {
    $lookup: {
      from: 'applications',
      localField: 'url',
      foreignField: 'url',
      as: 'applications'
    }
  }, {
    $project: {
      id: 1,
      title: 1,
      description: 1,
      meta: 1,
      url: 1,
      image: 1,
      public: 1,
      privateAccess: 1,
      nbApplications: { $size: '$applications' },
      servicesFilters: 1,
      datasetsFilters: 1
    }
  }]

  const aggPromise = baseApps.aggregate(agg).toArray()
  const [count, results] = await Promise.all([ baseApps.countDocuments(query), aggPromise ])
  for (let result of results) {
    result.privateAccess = result.privateAccess || []
    result.title = result.title || result.meta.title
    result.description = result.description || result.meta.description
    result.image = result.image || result.url + 'thumbnail.png'
    result.thumbnail = thumbor.thumbnail(result.image, req.query.thumbnail || '300x200')
  }
  res.send({ count, results })
}))
