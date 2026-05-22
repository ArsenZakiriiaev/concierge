import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { query } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FIXTURES_DIR = join(__dirname, '../../../fixtures')

const DEMO_PLATFORMS = [
  {
    domain: 'railway.app',
    name: 'Railway',
    permissions: ['deploy', 'getLogs', 'getProjects', 'createProject'],
    requires_approval: ['delete'],
    visibility: 'public',
    openapi_fixture: 'railway.app.openapi.json',
  },
]

export async function seedDemoPlatforms(): Promise<void> {
  for (const p of DEMO_PLATFORMS) {
    const existing = await query(
      'SELECT id FROM platforms WHERE domain = $1',
      [p.domain],
    )
    if (existing.rowCount && existing.rowCount > 0) continue

    const openapiSpec = readFileSync(join(FIXTURES_DIR, p.openapi_fixture), 'utf8')

    const { rows } = await query(
      `INSERT INTO platforms (domain, name, permissions, requires_approval, visibility)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [p.domain, p.name, p.permissions, p.requires_approval, p.visibility],
    )

    // Store the fixture spec as a single openapi chunk (no embedding yet — demo phase)
    await query(
      `INSERT INTO chunks (platform_id, content, chunk_type)
       VALUES ($1, $2, 'openapi')`,
      [rows[0].id, openapiSpec],
    )

    console.log(`[seed] inserted platform: ${p.domain}`)
  }
}
