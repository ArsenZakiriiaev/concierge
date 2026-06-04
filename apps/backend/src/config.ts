import { createHash } from 'crypto'

export function env(name: string): string | undefined {
  const value = process.env[name]
  return value && value.trim().length > 0 ? value : undefined
}

export function requiredEnv(name: string): string {
  const value = env(name)
  if (!value) throw new Error(`${name} is required`)
  return value
}

export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey).digest('hex')
}

export function publicBaseUrl(requestUrl: string): string {
  return env('CONCIERGE_PUBLIC_URL') ?? new URL(requestUrl).origin
}

export function configuredMcpApiKey(): string | undefined {
  return env('CONCIERGE_API_KEY')
}
