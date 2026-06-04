import { Hono } from 'hono'
import { registry } from './routes/registry.js'
import { sync } from './routes/sync.js'
import { act } from './routes/act.js'
import { auth } from './routes/auth.js'
import { approvals } from './routes/approvals.js'
import { jsonError } from './errors.js'

export function createApp(): Hono {
  const app = new Hono()

  app.onError((err, c) => jsonError(c, err))

  app.route('/v1/registry', registry)
  app.route('/v1/sync', sync)
  app.route('/v1/act', act)
  app.route('/v1/auth', auth)
  app.route('/v1/approvals', approvals)
  app.get('/health', (c) => c.json({ ok: true }))

  return app
}
