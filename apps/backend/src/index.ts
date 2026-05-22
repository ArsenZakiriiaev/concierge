import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { registry } from './routes/registry.js'
import { sync } from './routes/sync.js'
import { act } from './routes/act.js'

const app = new Hono()

app.route('/v1/registry', registry)
app.route('/v1/sync', sync)
app.route('/v1/act', act)

app.get('/health', (c) => c.json({ ok: true }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => {
  console.log(`[concierge backend] listening on http://localhost:${port}`)
})

export default app
