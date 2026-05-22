import { Hono } from 'hono'
import { InPlatformAgent, AnthropicProvider, StubContextProvider } from '@concierge/agent-runtime'
import { query } from '../db.js'

export const act = new Hono()

act.post('/', async (c) => {
  const { domain, intent, userId, assistant = 'claude' } = await c.req.json()
  if (!domain || !intent || !userId) {
    return c.json({ error: 'domain, intent, userId required' }, 400)
  }

  // 1. Resolve platform
  const { rows: platforms } = await query(
    `SELECT id, name, permissions, requires_approval FROM platforms
     WHERE domain = $1 AND status = 'active'`,
    [domain],
  )
  if (platforms.length === 0) return c.json({ error: `No agent found for ${domain}` }, 404)
  const platform = platforms[0]

  // 2. Load context chunks (openapi spec content — no embeddings yet in demo phase)
  const { rows: chunks } = await query(
    `SELECT content FROM chunks WHERE platform_id = $1 ORDER BY created_at LIMIT 5`,
    [platform.id],
  )
  const specJson = chunks.map((r: { content: string }) => r.content).join('\n\n')

  // 3. Load delegated token if one exists for this user+platform
  const { rows: tokenRows } = await query(
    `SELECT ciphertext FROM delegated_tokens WHERE user_id = $1 AND platform_id = $2`,
    [userId, platform.id],
  )
  // In demo phase the token may be absent — agent runs in context-only mode
  const delegatedToken = tokenRows[0]?.ciphertext?.toString() ?? undefined

  // 4. Write interaction row immediately (audit log — always before execution)
  const { rows: interactions } = await query(
    `INSERT INTO interactions (user_id, platform_id, assistant, intent, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [userId, platform.id, assistant, intent],
  )
  const interactionId = interactions[0].id

  try {
    const llm = new AnthropicProvider(process.env.ANTHROPIC_API_KEY!)
    const context = new StubContextProvider(specJson)
    const agent = new InPlatformAgent(llm, context, {
      id: platform.id,
      name: platform.name,
      permissions: platform.permissions ?? [],
      requiresApproval: platform.requires_approval ?? [],
      specJson,
      delegatedToken,
    })

    const result = await agent.execute(intent, userId)

    await query(
      `UPDATE interactions
       SET status = $1, result = $2, completed_steps = $3, pending_steps = $4, updated_at = NOW()
       WHERE id = $5`,
      [
        result.status,
        JSON.stringify({ output: result.output }),
        result.completedSteps ?? [],
        result.pendingSteps ?? [],
        interactionId,
      ],
    )

    return c.json({ interactionId, result: result.output, status: result.status })
  } catch (err) {
    await query(
      `UPDATE interactions SET status = 'failed', updated_at = NOW() WHERE id = $1`,
      [interactionId],
    )
    throw err
  }
})

// Multi-chat state lookup — powers "did Sarah approve my expenses?" across chats
act.get('/interactions/:userId', async (c) => {
  const { userId } = c.req.param()
  const domain = c.req.query('domain')

  const { rows } = await query(
    `SELECT i.id, p.domain, i.intent, i.status, i.result,
            i.completed_steps, i.pending_steps, i.created_at
     FROM interactions i
     JOIN platforms p ON p.id = i.platform_id
     WHERE i.user_id = $1
       ${domain ? 'AND p.domain = $2' : ''}
     ORDER BY i.updated_at DESC LIMIT 20`,
    domain ? [userId, domain] : [userId],
  )
  return c.json(rows)
})
