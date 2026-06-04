import { Hono } from 'hono'
import { requireMcpApiKey } from '../authz.js'
import { badRequest, notFound } from '../errors.js'
import { encryptToken } from '../token-crypto.js'
import { query } from '../db.js'

export const auth = new Hono()

auth.use('*', requireMcpApiKey)

auth.post('/tokens', async (c) => {
  const body = await c.req.json()
  const { domain, userId, token, expiresAt } = body as {
    domain?: string
    userId?: string
    token?: string
    expiresAt?: string
  }

  if (!domain || !userId || !token) {
    throw badRequest('domain, userId, token required')
  }

  const { rows: platforms } = await query<{ id: string; domain: string }>(
    `SELECT id, domain FROM platforms WHERE domain = $1 AND status = 'active'`,
    [domain],
  )
  if (platforms.length === 0) throw notFound(`No active platform found for ${domain}`)

  const encrypted = encryptToken(token)
  const expiry = expiresAt ? new Date(expiresAt) : null
  if (expiresAt && Number.isNaN(expiry?.getTime())) {
    throw badRequest('expiresAt must be an ISO timestamp')
  }

  await query(
    `INSERT INTO delegated_tokens (user_id, platform_id, ciphertext, expires_at)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, platform_id) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext,
           expires_at = EXCLUDED.expires_at`,
    [userId, platforms[0].id, encrypted, expiry],
  )

  return c.json({ ok: true, domain: platforms[0].domain, userId })
})

auth.get('/status', async (c) => {
  const domain = c.req.query('domain')
  const userId = c.req.query('userId')
  if (!domain || !userId) throw badRequest('domain and userId required')

  const { rows } = await query<{ expires_at: Date | string | null }>(
    `SELECT dt.expires_at
     FROM delegated_tokens dt
     JOIN platforms p ON p.id = dt.platform_id
     WHERE p.domain = $1
       AND p.status = 'active'
       AND dt.user_id = $2
     LIMIT 1`,
    [domain, userId],
  )

  if (rows.length === 0) {
    return c.json({ hasToken: false })
  }

  const expiresAt = rows[0].expires_at ? new Date(rows[0].expires_at).toISOString() : undefined
  const expired = expiresAt ? Date.parse(expiresAt) <= Date.now() : false
  return c.json({ hasToken: !expired, expiresAt })
})
