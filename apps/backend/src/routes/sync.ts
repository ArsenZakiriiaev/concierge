import { Hono } from 'hono'
import { query } from '../db.js'
import { bearerToken } from '../authz.js'
import { hashApiKey } from '../config.js'
import { badRequest, notFound, unauthorized } from '../errors.js'
import { enqueueReindex } from '../reindex.js'

export const sync = new Hono()

sync.post('/', async (c) => {
  const apiKey = bearerToken(c)
  if (!apiKey) throw unauthorized('Authorization required')

  const body = await c.req.json()
  const { openapiHash, openapiUrl, website, timestamp } = body as {
    openapiHash?: string
    openapiUrl?: string
    website?: string
    timestamp?: number
  }

  if (!openapiHash || !openapiUrl) {
    throw badRequest('openapiHash and openapiUrl required')
  }

  const { rows } = await query<{
    id: string
    domain: string
    openapi_hash: string | null
    openapi_url: string | null
    website: string | null
  }>(
    `SELECT id, domain, openapi_hash, openapi_url, website
     FROM platforms
     WHERE api_key_hash = $1
       AND status = 'active'
     LIMIT 1`,
    [hashApiKey(apiKey)],
  )
  if (rows.length === 0) throw notFound('platform not found for API key')

  const platform = rows[0]
  const hashChanged = platform.openapi_hash !== openapiHash
  const sourceChanged = platform.openapi_url !== openapiUrl || (platform.website ?? undefined) !== website
  const reindexTriggered = hashChanged || sourceChanged

  let jobId: string | undefined
  if (reindexTriggered) {
    const job = await enqueueReindex({
      platformId: platform.id,
      openapiHash,
      openapiUrl,
      website,
    })
    jobId = job.jobId
  }

  return c.json({
    ok: true,
    domain: platform.domain,
    reindexTriggered,
    jobId,
    timestamp,
  })
})
