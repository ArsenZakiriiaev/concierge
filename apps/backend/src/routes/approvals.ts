import { Hono } from 'hono'
import { buildToolsFromSpec } from '@concierge/agent-runtime'
import { query } from '../db.js'
import { badRequest, notFound } from '../errors.js'
import { decryptToken } from '../token-crypto.js'

export const approvals = new Hono()

interface ApprovalInteraction {
  id: string
  user_id: string
  platform_id: string
  status: string
  completed_steps: string[] | null
  metadata: {
    pendingOperation?: {
      operation: string
      input: Record<string, unknown>
    }
  } | null
  domain: string
  name: string
  permissions: string[] | null
}

approvals.post('/:interactionId/approve', async (c) => {
  const interactionId = c.req.param('interactionId')
  const interaction = await loadApprovalInteraction(interactionId)
  const pending = interaction.metadata?.pendingOperation
  if (!pending) throw badRequest('No pending operation stored for this interaction')

  const token = await loadToken(interaction.user_id, interaction.platform_id)
  const specJson = await loadOpenApiSpec(interaction.platform_id)
  const tools = buildToolsFromSpec(specJson, token, interaction.permissions ?? [], [])
  const tool = tools.find((candidate) => candidate.name === pending.operation)
  if (!tool) {
    throw badRequest(`Pending operation ${pending.operation} is not available for ${interaction.domain}`)
  }

  let status: 'complete' | 'failed' = 'complete'
  let result: string
  try {
    result = await tool.execute(pending.input)
    if (result.startsWith('HTTP ')) status = 'failed'
  } catch (err) {
    status = 'failed'
    result = err instanceof Error ? err.message : String(err)
  }

  const completedStep = `${pending.operation}(${JSON.stringify(pending.input)})`
  await query(
    `UPDATE interactions
     SET status = $1,
         result = $2,
         completed_steps = array_append(COALESCE(completed_steps, ARRAY[]::text[]), $3),
         pending_steps = ARRAY[]::text[],
         updated_at = NOW()
     WHERE id = $4`,
    [status, JSON.stringify({ output: result, approved: true }), completedStep, interactionId],
  )

  return c.json({ ok: status === 'complete', status, result })
})

approvals.post('/:interactionId/reject', async (c) => {
  const interactionId = c.req.param('interactionId')
  await loadApprovalInteraction(interactionId)

  await query(
    `UPDATE interactions
     SET status = 'failed',
         result = $1,
         pending_steps = ARRAY[]::text[],
         updated_at = NOW()
     WHERE id = $2`,
    [JSON.stringify({ output: 'Approval rejected', rejected: true }), interactionId],
  )

  return c.json({ ok: true, status: 'failed' })
})

async function loadApprovalInteraction(interactionId: string): Promise<ApprovalInteraction> {
  const { rows } = await query<ApprovalInteraction>(
    `SELECT i.id,
            i.user_id,
            i.platform_id,
            i.status,
            i.completed_steps,
            i.metadata,
            p.domain,
            p.name,
            p.permissions
     FROM interactions i
     JOIN platforms p ON p.id = i.platform_id
     WHERE i.id = $1`,
    [interactionId],
  )

  if (rows.length === 0) throw notFound('interaction not found')
  const interaction = rows[0]
  if (interaction.status !== 'awaiting_approval') {
    throw badRequest(`interaction is ${interaction.status}, not awaiting_approval`)
  }
  return interaction
}

async function loadToken(userId: string, platformId: string): Promise<string> {
  const { rows } = await query<{ ciphertext: Buffer; expires_at: Date | string | null }>(
    `SELECT ciphertext, expires_at
     FROM delegated_tokens
     WHERE user_id = $1
       AND platform_id = $2
     LIMIT 1`,
    [userId, platformId],
  )
  if (rows.length === 0) throw badRequest('No delegated token is stored for this interaction')

  const expiresAt = rows[0].expires_at ? new Date(rows[0].expires_at) : undefined
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    throw badRequest('The stored delegated token is expired')
  }

  return decryptToken(rows[0].ciphertext)
}

async function loadOpenApiSpec(platformId: string): Promise<string> {
  const { rows } = await query<{ content: string }>(
    `SELECT content
     FROM chunks
     WHERE platform_id = $1
       AND chunk_type = 'openapi'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [platformId],
  )
  if (rows.length === 0) throw badRequest('No OpenAPI context is indexed for this platform')
  return rows[0].content
}
