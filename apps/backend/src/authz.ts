import type { Context, Next } from 'hono'
import { configuredMcpApiKey, hashApiKey } from './config.js'
import { unauthorized } from './errors.js'

export function bearerToken(c: Context): string | undefined {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return undefined
  const token = header.slice('Bearer '.length).trim()
  return token.length > 0 ? token : undefined
}

export async function requireMcpApiKey(c: Context, next: Next): Promise<Response | void> {
  const expected = configuredMcpApiKey()
  if (!expected) return next()

  const provided = bearerToken(c)
  if (!provided || hashApiKey(provided) !== hashApiKey(expected)) {
    throw unauthorized()
  }

  return next()
}
