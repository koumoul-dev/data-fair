const config = require('config')
const remoteServiceSchema = require('./remote-service')
const permissionsDoc = require('../server/utils/permissions').apiDoc

module.exports = (remoteService) => {
  const api = {
    openapi: '3.0.0',
    info: Object.assign({}, remoteService.apiDoc.info, {
      title: `Utilisation du service distant : ${remoteService.title || remoteService.id}`
    }),
    servers: [{
      url: `${config.publicUrl}/api/v1/remote-services/${remoteService.id}`
    }],
    components: {
      securitySchemes: {
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'x-apiKey'
        },
        sdCookie: {
          type: 'apiKey',
          in: 'cookie',
          name: 'id_token'
        }
      }
    },
    security: [{ apiKey: [] }, { sdCookie: [] }],
    paths: {
      '/': {
        get: {
          summary: 'Récupérer les informations de configuration du service distant.',
          operationId: 'readDescription',
          'x-permissionClass': 'read',
          tags: ['Configuration'],
          responses: {
            200: {
              description: 'Les informations de configuration du service distant.',
              content: {
                'application/json': {
                  schema: { ...remoteServiceSchema, definitions: {} }
                }
              }
            }
          }
        },
        patch: {
          summary: 'Mettre à jour les informations de configuration du service distant.',
          operationId: 'writeDescription',
          'x-permissionClass': 'write',
          tags: ['Configuration'],
          requestBody: {
            description: 'Les informations de configuration du service distant.',
            required: true,
            content: {
              'application/json': {
                schema: remoteServiceSchema
              }
            }
          },
          responses: {
            200: {
              description: 'Les informations de configuration du service distant',
              content: {
                'application/json': {
                  schema: remoteServiceSchema
                }
              }
            }
          }
        },
        delete: {
          summary: 'Pour supprimer cette configuration du service distant',
          operationId: 'delete',
          'x-permissionClass': 'admin',
          tags: ['Configuration'],
          responses: {
            204: {
              description: 'Aucun contenu'
            }
          }
        }
      },
      '/_update': {
        get: {
          summary: 'Se resynchroniser avec l\'API du service distant',
          operationId: 'updateApiDoc',
          'x-permissionClass': 'write',
          tags: ['Configuration'],
          responses: {
            200: {
              description: 'Les informations de configuration du service distant',
              content: {
                'application/json': {
                  schema: remoteServiceSchema
                }
              }
            }
          }
        }
      },
      '/api-docs.json': {
        get: {
          summary: 'Accéder à la documentation de l\'API',
          operationId: 'readApiDoc',
          'x-permissionClass': 'read',
          tags: ['Informations'],
          responses: {
            200: {
              description: 'La documentation de l\'API',
              content: {
                'application/json': {
                  schema: {
                    type: 'object'
                  }
                }
              }
            }
          }
        }
      },
      '/permissions': permissionsDoc
    },
    externalDocs: {
      description: 'Documentation sur Github',
      url: 'https://koumoul-dev.github.io/data-fair/'
    },
    definitions: remoteServiceSchema.definitions
  }
  const apiPaths = Object.keys(remoteService.apiDoc.paths).map(path => ({ ['/proxy' + path]: remoteService.apiDoc.paths[path] }))
  apiPaths.forEach(path => Object.values(path).forEach(operations => Object.values(operations).forEach(operation => { operation['x-permissionClass'] = 'use' })))
  Object.assign(api.paths, ...apiPaths)
  return api
}
