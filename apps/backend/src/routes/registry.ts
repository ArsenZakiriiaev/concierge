import { Hono } from 'hono'
import { query } from '../db.js'

export const registry = new Hono()

registry.get('/lookup', async (c) => {
  const domain = c.req.query('domain')
  if (!domain) return c.json({ error: 'domain required' }, 400)

  const { rows } = await query(
    `SELECT id, domain, name, permissions, requires_approval, visibility
     FROM platforms WHERE domain = $1 AND status = 'active'`,
    [domain],
  )
  if (rows.length === 0) return c.json({ error: 'not found' }, 404)

  return c.json(rows[0])
})

registry.post('/register', async (c) => {
  const body = await c.req.json()
  const { domain, name, permissions = [], requires_approval = [], visibility = 'public' } = body

  if (!domain || !name) return c.json({ error: 'domain and name required' }, 400)

  const apiKey = `ck_${crypto.randomUUID().replace(/-/g, '')}`

  const { rows } = await query(
    `INSERT INTO platforms (domain, name, permissions, requires_approval, visibility)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (domain) DO UPDATE
       SET name = EXCLUDED.name,
           permissions = EXCLUDED.permissions,
           requires_approval = EXCLUDED.requires_approval
     RETURNING id, domain, name`,
    [domain, name, permissions, requires_approval, visibility],
  )

  return c.json({ ok: true, apiKey, platform: rows[0] }, 201)
})

registry.get('/list', async (c) => {
  const { rows } = await query(
    `SELECT id, domain, name, permissions, visibility FROM platforms
     WHERE visibility = 'public' AND status = 'active'
     ORDER BY name`,
  )
  return c.json(rows)
})
