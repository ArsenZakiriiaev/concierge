import { Hono } from 'hono'
import { InPlatformAgent, AnthropicProvider, StubContextProvider } from '@concierge/agent-runtime'
import { readFileSync } from 'fs'
import { join } from 'path'

export const act = new Hono()

// POST /v1/act — called by MCP server
act.post('/', async (c) => {
  const { domain, intent, userId } = await c.req.json()
  if (!domain || !intent || !userId) {
    return c.json({ error: 'domain, intent, userId required' }, 400)
  }

  // Demo: load hardcoded fixture spec
  const fixturePath = join(process.cwd(), '../../fixtures', `${domain}.openapi.json`)
  let specJson = '{}'
  try {
    specJson = readFileSync(fixturePath, 'utf8')
  } catch {
    // no fixture; context will be empty
  }

  const llm = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)
  const context = new StubContextProvider(specJson)

  const agent = new InPlatformAgent(llm, context, {
    id: domain,
    name: domain,
    permissions: ['deploy', 'getLogs', 'getProjects'],
    requiresApproval: ['delete'],
  })

  const result = await agent.execute(intent, userId)

  // TODO: write to interactions table with audit log fields
  // await db.query('INSERT INTO interactions ...')

  return c.json({ result: result.output, status: result.status })
})
