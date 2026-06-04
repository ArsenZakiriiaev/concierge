import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const apiUrl = (process.env.CONCIERGE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
const apiKey = process.env.CONCIERGE_API_KEY

const server = new McpServer({
  name: 'concierge',
  version: '0.0.1',
})

// Tool 1: does this platform have a Concierge agent?
server.tool(
  'concierge_lookup',
  'Check if a platform domain has a Concierge in-platform agent registered.',
  { domain: z.string().describe('The platform domain, e.g. "railway.app"') },
  async ({ domain }) => {
    const res = await backendFetch(`/v1/registry/lookup?domain=${encodeURIComponent(domain)}`)
    if (!res.ok) {
      return text(`No Concierge agent is registered for ${domain}.`)
    }
    const platform = await res.json()
    const approvals = platform.requires_approval?.length
      ? ` Actions requiring approval: ${platform.requires_approval.join(', ')}.`
      : ' No actions require approval.'
    return text(
      `Concierge agent found for ${domain}: ${platform.name}. `
      + `Allowed actions: ${(platform.permissions ?? []).join(', ') || 'none configured'}.`
      + approvals,
    )
  }
)

server.tool(
  'concierge_auth_status',
  'Check whether Claude Desktop can run Concierge actions for a user on a platform domain.',
  {
    domain: z.string().describe('The platform domain, e.g. "railway.app"'),
    userId: z.string().describe('The Claude Desktop user identifier to check'),
  },
  async ({ domain, userId }) => {
    const res = await backendFetch(
      `/v1/auth/status?domain=${encodeURIComponent(domain)}&userId=${encodeURIComponent(userId)}`,
    )
    const data = await res.json()
    if (!res.ok) return text(`Auth status check failed: ${errorMessage(data)}`)
    if (!data.hasToken) {
      return text(
        `No active delegated token is stored for ${userId} on ${domain}. `
        + `Use concierge_store_token before concierge_act.`,
      )
    }
    const expiry = data.expiresAt ? ` It expires at ${data.expiresAt}.` : ''
    return text(`An active delegated token is stored for ${userId} on ${domain}.${expiry}`)
  },
)

server.tool(
  'concierge_store_token',
  'Store a delegated API token for Claude Desktop to use through Concierge. The token is encrypted by the backend and never returned.',
  {
    domain: z.string().describe('The platform domain, e.g. "railway.app"'),
    userId: z.string().describe('The Claude Desktop user identifier that owns this token'),
    token: z.string().describe('The delegated platform API token to store'),
    expiresAt: z.string().optional().describe('Optional ISO timestamp when this token expires'),
  },
  async ({ domain, userId, token, expiresAt }) => {
    const res = await backendFetch('/v1/auth/tokens', {
      method: 'POST',
      body: JSON.stringify({ domain, userId, token, expiresAt }),
    })
    const data = await res.json()
    if (!res.ok) return text(`Token registration failed: ${errorMessage(data)}`)
    return text(`Delegated token stored for ${data.userId} on ${data.domain}. The token value was not returned.`)
  },
)

// Tool 2: execute intent on platform
server.tool(
  'concierge_act',
  'Execute an intent on a platform via Concierge. Designed for Claude Desktop: send the user intent, not raw API calls.',
  {
    domain: z.string().describe('The platform domain, e.g. "railway.app"'),
    intent: z.string().describe('Natural language description of what to do'),
    userId: z.string().describe('The Claude Desktop user identifier'),
  },
  async ({ domain, intent, userId }) => {
    const res = await backendFetch('/v1/act', {
      method: 'POST',
      body: JSON.stringify({ domain, intent, userId }),
    })
    const data = await res.json()
    if (!res.ok) {
      if (data.error?.code === 'auth_required') {
        return text(
          `Action not run. ${data.error.message} `
          + `Call concierge_store_token for ${domain} and userId ${userId}, then retry concierge_act. `
          + `Interaction ID: ${data.interactionId}.`,
        )
      }
      return text(`Action failed: ${errorMessage(data)}${data.interactionId ? ` Interaction ID: ${data.interactionId}.` : ''}`)
    }

    if (data.status === 'awaiting_approval') {
      return text(
        `Approval required. Interaction ID: ${data.interactionId}. `
        + `Pending steps: ${(data.pendingSteps ?? []).join(', ') || 'unknown'}. `
        + `Approve: ${data.approval?.approveUrl}. Reject: ${data.approval?.rejectUrl}.`,
      )
    }

    if (data.status === 'failed') {
      return text(`Action failed. Interaction ID: ${data.interactionId}. ${data.result}`)
    }

    return text(`Action complete. Interaction ID: ${data.interactionId}.\n${data.result}`)
  }
)

server.tool(
  'concierge_history',
  'Look up recent Concierge interactions for a Claude Desktop user, optionally scoped to one platform domain.',
  {
    userId: z.string().describe('The Claude Desktop user identifier'),
    domain: z.string().optional().describe('Optional platform domain, e.g. "railway.app"'),
  },
  async ({ userId, domain }) => {
    const suffix = domain ? `?domain=${encodeURIComponent(domain)}` : ''
    const res = await backendFetch(`/v1/act/interactions/${encodeURIComponent(userId)}${suffix}`)
    const data = await res.json()
    if (!res.ok) return text(`History lookup failed: ${errorMessage(data)}`)
    if (!Array.isArray(data) || data.length === 0) return text('No Concierge interactions found.')

    return text(
      data.map((row) => {
        const result = row.result?.output ?? row.result?.error ?? ''
        return `${row.created_at} | ${row.domain} | ${row.status} | ${row.intent}${result ? ` | ${result}` : ''}`
      }).join('\n'),
    )
  },
)

const transport = new StdioServerTransport()
await server.connect(transport)

function text(value: string) {
  return { content: [{ type: 'text' as const, text: value }] }
}

function backendFetch(path: string, init: RequestInit = {}) {
  return fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function errorMessage(data: unknown): string {
  if (data && typeof data === 'object' && 'error' in data) {
    const error = (data as { error?: unknown }).error
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
      return String((error as { message?: unknown }).message)
    }
  }
  return JSON.stringify(data)
}
