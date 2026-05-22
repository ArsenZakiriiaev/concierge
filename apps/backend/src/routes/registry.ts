import { Hono } from 'hono'

export const registry = new Hono()

// GET /v1/registry/lookup?domain=railway.app
registry.get('/lookup', async (c) => {
  const domain = c.req.query('domain')
  if (!domain) return c.json({ error: 'domain required' }, 400)

  // TODO: query platforms table
  // const platform = await db.query('SELECT * FROM platforms WHERE domain = $1', [domain])
  const platform = { id: 'stub', domain, name: 'Stub Platform', permissions: ['deploy'] }
  if (!platform) return c.json({ error: 'not found' }, 404)

  return c.json(platform)
})

// POST /v1/registry/register
registry.post('/register', async (c) => {
  const body = await c.req.json()
  // TODO: insert into platforms, generate CONCIERGE_API_KEY, trigger ingestion
  return c.json({ ok: true, apiKey: 'stub-api-key', platform: body })
})
