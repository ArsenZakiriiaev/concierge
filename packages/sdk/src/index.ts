import { createHash } from 'crypto'

export interface RolePermissions {
  permissions: string[]
  requiresApproval?: string[]
}

export interface ConciergeConfig {
  apiKey: string
  apiBaseUrl?: string
  knowledge: {
    openapi?: string
    website?: string
  }
  permissions?: string[] | Record<string, RolePermissions>
  requiresApproval?: string[] | Record<string, string[]>
  visibility?: 'public' | 'private'
  company?: string
  auth?: {
    provider: 'okta' | 'azure-ad'
    domain: string
  }
}

export function concierge(config: ConciergeConfig): void {
  validateConfig(config)
  checkForChanges(config).catch((err) => {
    console.error('[concierge] sync failed:', err)
  })
}

function validateConfig(config: ConciergeConfig): void {
  if (!config.apiKey) throw new Error('[concierge] apiKey is required')
  if (!config.knowledge.openapi && !config.knowledge.website) {
    throw new Error('[concierge] at least one knowledge source is required')
  }
}

async function checkForChanges(config: ConciergeConfig): Promise<void> {
  if (!config.knowledge.openapi) return

  const specText = await fetch(config.knowledge.openapi).then((r) => r.text())
  const currentHash = createHash('sha256').update(specText).digest('hex')
  const apiBaseUrl = (config.apiBaseUrl ?? 'https://api.concierge.dev').replace(/\/$/, '')

  await fetch(`${apiBaseUrl}/v1/sync`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${config.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      openapiHash: currentHash,
      openapiUrl: config.knowledge.openapi,
      website: config.knowledge.website,
      timestamp: Date.now(),
    }),
  })
}
