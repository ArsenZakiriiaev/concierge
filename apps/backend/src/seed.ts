import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { query } from './db.js'
import { env, hashApiKey } from './config.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../../../fixtures')

const DEMO_PLATFORMS = [
  {
    domain: 'railway.app',
    name: 'Railway',
    permissions: ['listProjects', 'createProject', 'deployProject', 'getProjectLogs', 'deleteProject'],
    requires_approval: ['deleteProject'],
    visibility: 'public',
    openapi_fixture: 'railway.app.openapi.json',
  },
]

export async function seedDemoPlatforms(): Promise<void> {
  for (const p of DEMO_PLATFORMS) {
    const demoApiKeyHash = env('CONCIERGE_API_KEY') ? hashApiKey(env('CONCIERGE_API_KEY')!) : null
    const existing = await query(
      'SELECT id FROM platforms WHERE domain = $1',
      [p.domain],
    )
    if (existing.rowCount && existing.rowCount > 0) {
      await query(
        `UPDATE platforms
         SET permissions = $1,
             requires_approval = $2,
             api_key_hash = COALESCE(api_key_hash, $3),
             updated_at = NOW()
         WHERE domain = $4`,
        [p.permissions, p.requires_approval, demoApiKeyHash, p.domain],
      )
      await upsertOpenApiChunk(existing.rows[0].id, readOpenApiFixture(p.openapi_fixture))
      continue
    }

    const openapiSpec = readOpenApiFixture(p.openapi_fixture)

    const { rows } = await query(
      `INSERT INTO platforms (domain, name, permissions, requires_approval, visibility, api_key_hash, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       RETURNING id`,
      [p.domain, p.name, p.permissions, p.requires_approval, p.visibility, demoApiKeyHash],
    )

    // Store the fixture spec as a single openapi chunk (no embedding yet — demo phase)
    await upsertOpenApiChunk(rows[0].id, openapiSpec)

    console.log(`[seed] inserted platform: ${p.domain}`)
  }
}

async function upsertOpenApiChunk(platformId: string, openapiSpec: string): Promise<void> {
  await query(
    `INSERT INTO chunks (platform_id, content, chunk_type, content_hash, updated_at)
     VALUES ($1, $2, 'openapi', encode(digest($2, 'sha256'), 'hex'), NOW())
     ON CONFLICT (platform_id, chunk_type, content_hash) WHERE content_hash IS NOT NULL
     DO UPDATE SET content = EXCLUDED.content, updated_at = NOW()`,
    [platformId, openapiSpec],
  )
}

function readOpenApiFixture(filename: string): string {
  const spec = JSON.parse(readFileSync(join(FIXTURES_DIR, filename), 'utf8')) as {
    servers?: { url: string }[]
  }
  const baseUrl = env('RAILWAY_API_BASE_URL')
  if (baseUrl) {
    spec.servers = [{ url: baseUrl.replace(/\/$/, '') }]
  }
  return JSON.stringify(spec, null, 2)
}
