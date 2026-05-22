import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

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
    const res = await fetch(
      `${process.env.CONCIERGE_API_URL}/v1/registry/lookup?domain=${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${process.env.CONCIERGE_API_KEY}` } }
    )
    if (!res.ok) {
      return { content: [{ type: 'text', text: `No Concierge agent found for ${domain}` }] }
    }
    const platform = await res.json()
    return {
      content: [{
        type: 'text',
        text: `Found Concierge agent for ${domain}: ${platform.name}. Permissions: ${platform.permissions?.join(', ')}.`,
      }],
    }
  }
)

// Tool 2: execute intent on platform
server.tool(
  'concierge_act',
  'Execute an intent on a platform via its in-platform agent. The agent handles orchestration; you only send intent.',
  {
    domain: z.string().describe('The platform domain, e.g. "railway.app"'),
    intent: z.string().describe('Natural language description of what to do'),
    userId: z.string().describe('The authenticated user ID'),
  },
  async ({ domain, intent, userId }) => {
    const res = await fetch(`${process.env.CONCIERGE_API_URL}/v1/act`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.CONCIERGE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ domain, intent, userId }),
    })
    const data = await res.json()
    if (!res.ok) {
      return { content: [{ type: 'text', text: `Action failed: ${data.error}` }] }
    }
    return { content: [{ type: 'text', text: data.result }] }
  }
)

const transport = new StdioServerTransport()
await server.connect(transport)
