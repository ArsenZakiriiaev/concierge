import { Hono } from 'hono'
import { query } from '../db.js'
import { badRequest, notFound } from '../errors.js'
import { hashApiKey } from '../config.js'

export const registry = new Hono()

registry.get('/lookup', async (c) => {
  const domain = c.req.query('domain')
  if (!domain) throw badRequest('domain required')

  const { rows } = await query(
    `SELECT id, domain, name, permissions, requires_approval, visibility, openapi_hash, updated_at
     FROM platforms WHERE domain = $1 AND status = 'active'`,
    [domain],
  )
  if (rows.length === 0) throw notFound('not found')

  return c.json(rows[0])
})

registry.post('/register', async (c) => {
  const body = await c.req.json()
  const { domain, name, permissions = [], requires_approval = [], visibility = 'public' } = body

  if (!domain || !name) throw badRequest('domain and name required')

  const apiKey = `ck_${crypto.randomUUID().replace(/-/g, '')}`

  const { rows } = await query(
    `INSERT INTO platforms (domain, name, permissions, requires_approval, visibility, api_key_hash, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (domain) DO UPDATE
       SET name = EXCLUDED.name,
           permissions = EXCLUDED.permissions,
           requires_approval = EXCLUDED.requires_approval,
           visibility = EXCLUDED.visibility,
           api_key_hash = EXCLUDED.api_key_hash,
           updated_at = NOW()
     RETURNING id, domain, name`,
    [domain, name, permissions, requires_approval, visibility, hashApiKey(apiKey)],
  )

  return c.json({ ok: true, apiKey, platform: rows[0] }, 201)
})

registry.get('/list', async (c) => {
  const { rows } = await query(
    `SELECT id, domain, name, permissions, requires_approval, visibility, updated_at
     FROM platforms
     WHERE visibility = 'public' AND status = 'active'
     ORDER BY name`,
  )
  return c.json(rows)
})
