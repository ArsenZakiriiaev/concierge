import { Hono } from 'hono'
import { query } from '../db.js'

export const sync = new Hono()

sync.post('/', async (c) => {
  const authHeader = c.req.header('Authorization')
  const apiKey = authHeader?.replace('Bearer ', '')
  if (!apiKey) return c.json({ error: 'Authorization required' }, 401)

  const { openapiHash, timestamp } = await c.req.json()
  if (!openapiHash) return c.json({ error: 'openapiHash required' }, 400)

  const { rows } = await query(
    `SELECT id, openapi_hash FROM platforms WHERE status = 'active' LIMIT 1`,
  )
  if (rows.length === 0) return c.json({ error: 'platform not found' }, 404)

  const platform = rows[0]
  const hashChanged = platform.openapi_hash !== openapiHash

  if (hashChanged) {
    await query(
      `UPDATE platforms SET openapi_hash = $1 WHERE id = $2`,
      [openapiHash, platform.id],
    )
    // TODO: enqueue BullMQ re-index job when ingestion pipeline is ready
    console.log(`[sync] hash changed for platform ${platform.id} — re-index needed`)
  }

  return c.json({ ok: true, reindexTriggered: hashChanged, timestamp })
})
