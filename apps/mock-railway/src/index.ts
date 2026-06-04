import { Hono } from 'hono'
import { serve } from '@hono/node-server'

interface Project {
  id: string
  name: string
  deployments: { id: string; status: string; createdAt: string }[]
  deleted?: boolean
}

const app = new Hono()
const projects = new Map<string, Project>()

projects.set('demo-project', {
  id: 'demo-project',
  name: 'Claude Desktop Demo',
  deployments: [
    { id: 'dep_seed', status: 'SUCCESS', createdAt: new Date('2026-01-01T00:00:00Z').toISOString() },
  ],
})

app.get('/openapi.json', (c) => {
  const baseUrl = publicBaseUrl(c.req.url)
  return c.json(openApiSpec(baseUrl))
})

app.use('/projects/*', async (c, next) => {
  const authorization = c.req.header('Authorization')
  if (!authorization?.startsWith('Bearer ')) {
    return c.json({ error: 'missing bearer token' }, 401)
  }
  return next()
})

app.get('/projects', (c) => {
  return c.json({
    projects: [...projects.values()].filter((project) => !project.deleted),
  })
})

app.post('/projects', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { name?: string; teamId?: string }
  const id = slug(body.name ?? 'claude-demo')
  const project: Project = {
    id,
    name: body.name ?? 'claude-demo',
    deployments: [],
  }
  projects.set(id, project)
  return c.json({ project }, 201)
})

app.post('/projects/:id/deploy', (c) => {
  const id = c.req.param('id')
  const project = projects.get(id)
  if (!project || project.deleted) return c.json({ error: 'project not found' }, 404)

  const deployment = {
    id: `dep_${Date.now()}`,
    status: 'QUEUED',
    createdAt: new Date().toISOString(),
  }
  project.deployments.push(deployment)
  return c.json({ deployment })
})

app.get('/projects/:id/logs', (c) => {
  const id = c.req.param('id')
  const project = projects.get(id)
  if (!project || project.deleted) return c.json({ error: 'project not found' }, 404)
  return c.json({
    logs: [
      `[${project.name}] build started`,
      `[${project.name}] installing dependencies`,
      `[${project.name}] deployment queued`,
    ],
  })
})

app.delete('/projects/:id', (c) => {
  const id = c.req.param('id')
  const project = projects.get(id)
  if (!project || project.deleted) return c.json({ error: 'project not found' }, 404)
  project.deleted = true
  return c.json({ deleted: true, id })
})

app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 4010)
serve({ fetch: app.fetch, port }, () => {
  console.log(`[mock railway] listening on http://localhost:${port}`)
})

function publicBaseUrl(requestUrl: string): string {
  return (process.env.MOCK_RAILWAY_PUBLIC_URL ?? new URL(requestUrl).origin).replace(/\/$/, '')
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'claude-demo'
}

function openApiSpec(baseUrl: string) {
  return {
    openapi: '3.0.0',
    info: { title: 'Mock Railway API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/projects': {
        get: {
          operationId: 'listProjects',
          summary: 'List all projects for the authenticated user',
          parameters: [],
        },
        post: {
          operationId: 'createProject',
          summary: 'Create a new project',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    teamId: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
      '/projects/{id}/deploy': {
        post: {
          operationId: 'deployProject',
          summary: 'Trigger a deployment for a project',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/projects/{id}/logs': {
        get: {
          operationId: 'getProjectLogs',
          summary: 'Get recent deployment logs',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/projects/{id}': {
        delete: {
          operationId: 'deleteProject',
          summary: 'Delete a project; requires approval',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
    },
  }
}
