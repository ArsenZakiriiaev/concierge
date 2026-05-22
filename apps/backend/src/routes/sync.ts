import { Hono } from 'hono'

export const sync = new Hono()

// POST /v1/sync — called by SDK on every platform server startup
sync.post('/', async (c) => {
  const { openapiHash, timestamp } = await c.req.json()
  if (!openapiHash) return c.json({ error: 'openapiHash required' }, 400)

  // TODO: compare with platforms.openapi_hash; if different, enqueue BullMQ re-index job
  // const platform = await db.query('SELECT openapi_hash FROM platforms WHERE api_key = $1', [apiKey])
  // if (platform.openapi_hash !== openapiHash) await ingestionQueue.add(...)

  console.log('[sync] received hash', openapiHash, 'at', timestamp)
  return c.json({ ok: true, reindexTriggered: false })
})
