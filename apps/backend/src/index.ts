import { serve } from '@hono/node-server'
import { createApp } from './app.js'
import { runMigrations } from './migrate.js'
import { seedDemoPlatforms } from './seed.js'
import { startReindexWorker } from './reindex.js'

async function start() {
  await runMigrations()
  await seedDemoPlatforms()
  await startReindexWorker()

  const app = createApp()
  const port = Number(process.env.PORT ?? 3000)
  serve({ fetch: app.fetch, port }, () => {
    console.log(`[concierge backend] listening on http://localhost:${port}`)
  })
}

start().catch((err) => {
  console.error('[concierge] startup failed:', err)
  process.exit(1)
})
