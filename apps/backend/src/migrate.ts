import { readFileSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pool } from './db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '../../../db/migrations')

export async function runMigrations(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS _migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `)

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const { rowCount } = await pool.query(
      'SELECT 1 FROM _migrations WHERE filename = $1',
      [file],
    )
    if (rowCount && rowCount > 0) continue

    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    await pool.query(sql)
    await pool.query('INSERT INTO _migrations (filename) VALUES ($1)', [file])
    console.log(`[migrate] applied ${file}`)
  }
}
