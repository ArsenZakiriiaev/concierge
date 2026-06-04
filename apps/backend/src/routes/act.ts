import { Hono } from 'hono'
import type { LLMProvider } from '@concierge/agent-runtime'
import { InPlatformAgent, AnthropicProvider } from '@concierge/agent-runtime'
import { query } from '../db.js'
import { requireMcpApiKey } from '../authz.js'
import { env, publicBaseUrl } from '../config.js'
import { badRequest, notFound } from '../errors.js'
import { decryptToken } from '../token-crypto.js'
import { PgVectorContextProvider } from '../pgvector-context.js'
import { DemoProvider } from '../demo-provider.js'

export const act = new Hono()

act.use('*', requireMcpApiKey)

act.post('/', async (c) => {
  const { domain, intent, userId, assistant = 'claude' } = await c.req.json()
  if (!domain || !intent || !userId) {
    throw badRequest('domain, intent, userId required')
  }

  const { rows: platforms } = await query<{
    id: string
    name: string
    permissions: string[] | null
    requires_approval: string[] | null
  }>(
    `SELECT id, name, permissions, requires_approval FROM platforms
     WHERE domain = $1 AND status = 'active'`,
    [domain],
  )
  if (platforms.length === 0) throw notFound(`No agent found for ${domain}`)
  const platform = platforms[0]

  const { rows: interactions } = await query(
    `INSERT INTO interactions (user_id, platform_id, assistant, intent, status)
     VALUES ($1, $2, $3, $4, 'pending') RETURNING id`,
    [userId, platform.id, assistant, intent],
  )
  const interactionId = interactions[0].id

  const tokenResult = await loadDelegatedToken(userId, platform.id)
  if (!tokenResult.ok) {
    const result = {
      code: 'auth_required',
      message: tokenResult.reason,
      domain,
      userId,
    }
    await query(
      `UPDATE interactions
       SET status = 'failed', result = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result), interactionId],
    )
    return c.json({ ok: false, interactionId, status: 'failed', error: result }, 401)
  }

  const specJson = await loadOpenApiSpec(platform.id)
  if (!specJson) {
    const result = {
      code: 'context_missing',
      message: `No OpenAPI context indexed for ${domain}`,
    }
    await query(
      `UPDATE interactions
       SET status = 'failed', result = $1, updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify(result), interactionId],
    )
    return c.json({ ok: false, interactionId, status: 'failed', error: result }, 409)
  }

  try {
    const llm = createLlmProvider()
    const context = new PgVectorContextProvider()
    const agent = new InPlatformAgent(llm, context, {
      id: platform.id,
      name: platform.name,
      permissions: platform.permissions ?? [],
      requiresApproval: platform.requires_approval ?? [],
      specJson,
      delegatedToken: tokenResult.token,
    })

    const result = await agent.execute(intent, userId)

    await query(
      `UPDATE interactions
       SET status = $1,
           result = $2,
           completed_steps = $3,
           pending_steps = $4,
           metadata = $5,
           updated_at = NOW()
       WHERE id = $6`,
      [
        result.status,
        JSON.stringify({ output: result.output, metadata: result.metadata ?? {} }),
        result.completedSteps ?? [],
        result.pendingSteps ?? [],
        JSON.stringify(result.metadata ?? {}),
        interactionId,
      ],
    )

    const response: Record<string, unknown> = {
      ok: result.status !== 'failed',
      interactionId,
      result: result.output,
      status: result.status,
      completedSteps: result.completedSteps ?? [],
      pendingSteps: result.pendingSteps ?? [],
    }

    if (result.status === 'awaiting_approval') {
      const baseUrl = publicBaseUrl(c.req.url)
      response.approval = {
        approveUrl: `${baseUrl}/v1/approvals/${interactionId}/approve`,
        rejectUrl: `${baseUrl}/v1/approvals/${interactionId}/reject`,
      }
    }

    return c.json(response)
  } catch (err) {
    await query(
      `UPDATE interactions
       SET status = 'failed',
           result = $1,
           updated_at = NOW()
       WHERE id = $2`,
      [JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), interactionId],
    )
    throw err
  }
})

function createLlmProvider(): LLMProvider {
  if (env('CONCIERGE_AGENT_MODE') === 'demo') return new DemoProvider()

  const anthropicApiKey = env('ANTHROPIC_API_KEY')
  if (!anthropicApiKey) throw new Error('ANTHROPIC_API_KEY is required to execute actions')
  return new AnthropicProvider(anthropicApiKey, env('ANTHROPIC_MODEL'))
}

async function loadOpenApiSpec(platformId: string): Promise<string | undefined> {
  const { rows } = await query<{ content: string }>(
    `SELECT content
     FROM chunks
     WHERE platform_id = $1
       AND chunk_type = 'openapi'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [platformId],
  )
  return rows[0]?.content
}

async function loadDelegatedToken(
  userId: string,
  platformId: string,
): Promise<{ ok: true; token: string } | { ok: false; reason: string }> {
  const { rows } = await query<{ ciphertext: Buffer; expires_at: Date | string | null }>(
    `SELECT ciphertext, expires_at
     FROM delegated_tokens
     WHERE user_id = $1
       AND platform_id = $2
     LIMIT 1`,
    [userId, platformId],
  )

  if (rows.length === 0) {
    return { ok: false, reason: 'No delegated platform token is stored for this user and domain.' }
  }

  const expiresAt = rows[0].expires_at ? new Date(rows[0].expires_at) : undefined
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return { ok: false, reason: 'The stored delegated platform token is expired.' }
  }

  return { ok: true, token: decryptToken(rows[0].ciphertext) }
}

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
