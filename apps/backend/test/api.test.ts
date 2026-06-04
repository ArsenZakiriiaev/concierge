import { createHash } from 'crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Platform = {
  id: string
  domain: string
  name: string
  permissions: string[]
  requires_approval: string[]
  status: string
  visibility: string
  api_key_hash?: string | null
  openapi_hash?: string | null
  openapi_url?: string | null
  website?: string | null
}

type TokenRow = {
  user_id: string
  platform_id: string
  ciphertext: Buffer
  expires_at: Date | null
}

type ChunkRow = {
  platform_id: string
  url?: string | null
  content: string
  chunk_type: 'openapi' | 'docs'
  content_hash?: string | null
}

type InteractionRow = {
  id: string
  user_id: string
  platform_id: string
  assistant: string
  intent: string
  status: string
  result?: Record<string, unknown> | null
  completed_steps?: string[] | null
  pending_steps?: string[] | null
  metadata?: Record<string, unknown> | null
  created_at: string
}

const db = vi.hoisted(() => {
  const state = {
    platforms: [] as Platform[],
    tokens: [] as TokenRow[],
    chunks: [] as ChunkRow[],
    interactions: [] as InteractionRow[],
    interactionSeq: 0,
  }

  function parseJson(value: unknown): Record<string, unknown> | null {
    if (typeof value !== 'string') return value as Record<string, unknown> | null
    return JSON.parse(value) as Record<string, unknown>
  }

  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim()

    if (normalized.startsWith('SELECT id, domain FROM platforms WHERE domain')) {
      const rows = state.platforms
        .filter((platform) => platform.domain === params[0] && platform.status === 'active')
        .map((platform) => ({ id: platform.id, domain: platform.domain }))
      return result(rows)
    }

    if (normalized.startsWith('INSERT INTO delegated_tokens')) {
      const [userId, platformId, ciphertext, expiresAt] = params as [string, string, Buffer, Date | null]
      const existing = state.tokens.find((token) => token.user_id === userId && token.platform_id === platformId)
      if (existing) {
        existing.ciphertext = ciphertext
        existing.expires_at = expiresAt
      } else {
        state.tokens.push({ user_id: userId, platform_id: platformId, ciphertext, expires_at: expiresAt })
      }
      return result([])
    }

    if (normalized.startsWith('SELECT dt.expires_at FROM delegated_tokens')) {
      const [domain, userId] = params as [string, string]
      const platform = state.platforms.find((candidate) => candidate.domain === domain && candidate.status === 'active')
      const token = platform
        ? state.tokens.find((candidate) => candidate.platform_id === platform.id && candidate.user_id === userId)
        : undefined
      return result(token ? [{ expires_at: token.expires_at }] : [])
    }

    if (normalized.startsWith('SELECT id, domain, openapi_hash')) {
      const rows = state.platforms
        .filter((platform) => platform.api_key_hash === params[0] && platform.status === 'active')
        .map((platform) => ({
          id: platform.id,
          domain: platform.domain,
          openapi_hash: platform.openapi_hash ?? null,
          openapi_url: platform.openapi_url ?? null,
          website: platform.website ?? null,
        }))
      return result(rows)
    }

    if (normalized.startsWith('DELETE FROM chunks')) {
      const [platformId, hashes] = params as [string, string[]]
      state.chunks = state.chunks.filter((chunk) => {
        if (chunk.platform_id !== platformId) return true
        if (!chunk.content_hash) return true
        return hashes.includes(chunk.content_hash)
      })
      return result([])
    }

    if (normalized.startsWith('INSERT INTO chunks')) {
      const [platformId, url, content, _embedding, chunkType, contentHash] = params as [
        string,
        string | null,
        string,
        string | null,
        'openapi' | 'docs',
        string,
      ]
      const existing = state.chunks.find(
        (chunk) => chunk.platform_id === platformId
          && chunk.chunk_type === chunkType
          && chunk.content_hash === contentHash,
      )
      if (existing) {
        existing.url = url
        existing.content = content
      } else {
        state.chunks.push({ platform_id: platformId, url, content, chunk_type: chunkType, content_hash: contentHash })
      }
      return result([])
    }

    if (normalized.startsWith('UPDATE platforms SET openapi_hash')) {
      const [openapiHash, openapiUrl, website, platformId] = params as [string, string, string | null, string]
      const platform = state.platforms.find((candidate) => candidate.id === platformId)
      if (platform) {
        platform.openapi_hash = openapiHash
        platform.openapi_url = openapiUrl
        platform.website = website
      }
      return result([])
    }

    if (normalized.startsWith('SELECT id, name, permissions')) {
      const rows = state.platforms
        .filter((platform) => platform.domain === params[0] && platform.status === 'active')
        .map((platform) => ({
          id: platform.id,
          name: platform.name,
          permissions: platform.permissions,
          requires_approval: platform.requires_approval,
        }))
      return result(rows)
    }

    if (normalized.startsWith('INSERT INTO interactions')) {
      const [userId, platformId, assistant, intent] = params as [string, string, string, string]
      const id = `interaction-${++state.interactionSeq}`
      state.interactions.push({
        id,
        user_id: userId,
        platform_id: platformId,
        assistant,
        intent,
        status: 'pending',
        completed_steps: [],
        pending_steps: [],
        created_at: new Date().toISOString(),
      })
      return result([{ id }])
    }

    if (normalized.startsWith('SELECT ciphertext, expires_at FROM delegated_tokens')) {
      const [userId, platformId] = params as [string, string]
      const token = state.tokens.find((candidate) => candidate.user_id === userId && candidate.platform_id === platformId)
      return result(token ? [{ ciphertext: token.ciphertext, expires_at: token.expires_at }] : [])
    }

    if (normalized.startsWith('SELECT content FROM chunks')) {
      const rows = state.chunks
        .filter((chunk) => chunk.platform_id === params[0] && chunk.chunk_type === 'openapi')
        .map((chunk) => ({ content: chunk.content }))
      return result(rows.slice(0, 1))
    }

    if (normalized.startsWith('SELECT url, content, chunk_type FROM chunks')) {
      const rows = state.chunks
        .filter((chunk) => chunk.platform_id === params[0])
        .map((chunk) => ({ url: chunk.url ?? null, content: chunk.content, chunk_type: chunk.chunk_type }))
      return result(rows)
    }

    if (normalized.startsWith('UPDATE interactions SET status = $1')
      && normalized.includes('array_append')) {
      const [status, resultJson, completedStep, id] = params as [string, string, string, string]
      const interaction = state.interactions.find((candidate) => candidate.id === id)
      if (interaction) {
        interaction.status = status
        interaction.result = parseJson(resultJson)
        interaction.completed_steps = [...(interaction.completed_steps ?? []), completedStep]
        interaction.pending_steps = []
      }
      return result([])
    }

    if (normalized.startsWith("UPDATE interactions SET status = 'failed'")
      && normalized.includes('pending_steps = ARRAY[]::text[]')) {
      const [resultJson, id] = params as [string, string]
      const interaction = state.interactions.find((candidate) => candidate.id === id)
      if (interaction) {
        interaction.status = 'failed'
        interaction.result = parseJson(resultJson)
        interaction.pending_steps = []
      }
      return result([])
    }

    if (normalized.startsWith('UPDATE interactions SET status = $1, result = $2')) {
      const [status, resultJson, completed, pending, metadataJson, id] = params as [
        string,
        string,
        string[],
        string[],
        string,
        string,
      ]
      const interaction = state.interactions.find((candidate) => candidate.id === id)
      if (interaction) {
        interaction.status = status
        interaction.result = parseJson(resultJson)
        interaction.completed_steps = completed
        interaction.pending_steps = pending
        interaction.metadata = parseJson(metadataJson)
      }
      return result([])
    }

    if (normalized.startsWith("UPDATE interactions SET status = 'failed', result = $1")) {
      const [resultJson, id] = params as [string, string]
      const interaction = state.interactions.find((candidate) => candidate.id === id)
      if (interaction) {
        interaction.status = 'failed'
        interaction.result = parseJson(resultJson)
      }
      return result([])
    }

    if (normalized.startsWith('SELECT i.id, i.user_id')) {
      const interaction = state.interactions.find((candidate) => candidate.id === params[0])
      if (!interaction) return result([])
      const platform = state.platforms.find((candidate) => candidate.id === interaction.platform_id)
      return result([{
        ...interaction,
        domain: platform?.domain,
        name: platform?.name,
        permissions: platform?.permissions,
      }])
    }

    if (normalized.startsWith('SELECT i.id, p.domain')) {
      const rows = state.interactions.map((interaction) => {
        const platform = state.platforms.find((candidate) => candidate.id === interaction.platform_id)
        return {
          id: interaction.id,
          domain: platform?.domain,
          intent: interaction.intent,
          status: interaction.status,
          result: interaction.result,
          completed_steps: interaction.completed_steps,
          pending_steps: interaction.pending_steps,
          created_at: interaction.created_at,
        }
      })
      return result(rows)
    }

    throw new Error(`Unhandled SQL in test mock: ${normalized}`)
  })

  function result<T>(rows: T[]) {
    return { rows, rowCount: rows.length }
  }

  function reset() {
    state.platforms = []
    state.tokens = []
    state.chunks = []
    state.interactions = []
    state.interactionSeq = 0
    query.mockClear()
  }

  return { state, query, reset }
})

vi.mock('../src/db.js', () => ({ query: db.query }))

describe('backend MVP API contracts', () => {
  beforeEach(() => {
    db.reset()
    process.env.CONCIERGE_API_KEY = 'demo-key'
    process.env.CONCIERGE_TOKEN_KEY = '0123456789abcdef0123456789abcdef'
    process.env.CONCIERGE_AGENT_MODE = 'demo'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.REDIS_URL
    seedPlatform()
  })

  it('stores delegated tokens and reports auth status without returning the token', async () => {
    const { createApp } = await import('../src/app.js')
    const app = createApp()

    const missing = await app.request('/v1/auth/status?domain=railway.app&userId=claude-user', {
      headers: authHeaders(),
    })
    expect(await missing.json()).toEqual({ hasToken: false })

    const stored = await app.request('/v1/auth/tokens', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        domain: 'railway.app',
        userId: 'claude-user',
        token: 'secret-railway-token',
      }),
    })
    const storedBody = await stored.text()
    expect(stored.status).toBe(200)
    expect(storedBody).not.toContain('secret-railway-token')
    expect(JSON.parse(storedBody)).toMatchObject({ ok: true, domain: 'railway.app', userId: 'claude-user' })

    const present = await app.request('/v1/auth/status?domain=railway.app&userId=claude-user', {
      headers: authHeaders(),
    })
    expect(await present.json()).toEqual({ hasToken: true })
  })

  it('returns auth_required and writes an audited failed interaction when no token exists', async () => {
    const { createApp } = await import('../src/app.js')
    const app = createApp()

    const response = await app.request('/v1/act', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        domain: 'railway.app',
        userId: 'claude-user',
        intent: 'list my projects',
      }),
    })

    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.error.code).toBe('auth_required')
    expect(db.state.interactions[0]).toMatchObject({ status: 'failed', user_id: 'claude-user' })
  })

  it('triggers reindex on sync hash changes and skips unchanged syncs', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(buildSpec('https://mock.railway.test'))))

    const { createApp } = await import('../src/app.js')
    const app = createApp()
    const payload = {
      openapiHash: 'hash-1',
      openapiUrl: 'https://mock.railway.test/openapi.json',
      timestamp: Date.now(),
    }

    const first = await app.request('/v1/sync', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
    expect(await first.json()).toMatchObject({ ok: true, reindexTriggered: true })
    await waitUntil(() => db.state.platforms[0].openapi_hash === 'hash-1')
    expect(db.state.chunks.some((chunk) => chunk.content.includes('Mock Railway API'))).toBe(true)

    const second = await app.request('/v1/sync', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
    })
    expect(await second.json()).toMatchObject({ ok: true, reindexTriggered: false })
  })

  it('creates awaiting approval interactions and approves the pending operation', async () => {
    const platformCalls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input)
      platformCalls.push(`${init?.method ?? 'GET'} ${url}`)
      return Response.json({ deleted: true, id: 'demo-project' })
    }))

    const { createApp } = await import('../src/app.js')
    const app = createApp()
    await storeToken(app)

    const action = await app.request('/v1/act', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        domain: 'railway.app',
        userId: 'claude-user',
        intent: 'delete project demo-project',
      }),
    })
    const actionBody = await action.json()
    expect(action.status).toBe(200)
    expect(actionBody.status).toBe('awaiting_approval')
    expect(platformCalls).toEqual([])

    const approved = await app.request(`/v1/approvals/${actionBody.interactionId}/approve`, {
      method: 'POST',
    })
    expect(await approved.json()).toMatchObject({ ok: true, status: 'complete' })
    expect(platformCalls).toEqual(['DELETE https://mock.railway.test/projects/demo-project'])
    expect(db.state.interactions[0]).toMatchObject({ status: 'complete', pending_steps: [] })
  })

  it('rejects pending approval without calling the platform', async () => {
    const platformFetch = vi.fn(async () => Response.json({ deleted: true }))
    vi.stubGlobal('fetch', platformFetch)

    const { createApp } = await import('../src/app.js')
    const app = createApp()
    await storeToken(app)

    const action = await app.request('/v1/act', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        domain: 'railway.app',
        userId: 'claude-user',
        intent: 'delete project demo-project',
      }),
    })
    const actionBody = await action.json()

    const rejected = await app.request(`/v1/approvals/${actionBody.interactionId}/reject`, {
      method: 'POST',
    })
    expect(await rejected.json()).toEqual({ ok: true, status: 'failed' })
    expect(platformFetch).not.toHaveBeenCalled()
    expect(db.state.interactions[0]).toMatchObject({ status: 'failed', pending_steps: [] })
  })
})

function seedPlatform() {
  db.state.platforms.push({
    id: 'platform-1',
    domain: 'railway.app',
    name: 'Railway',
    permissions: ['listProjects', 'createProject', 'deployProject', 'getProjectLogs', 'deleteProject'],
    requires_approval: ['deleteProject'],
    status: 'active',
    visibility: 'public',
    api_key_hash: hash('demo-key'),
  })
  db.state.chunks.push({
    platform_id: 'platform-1',
    content: JSON.stringify(buildSpec('https://mock.railway.test')),
    chunk_type: 'openapi',
    content_hash: 'seed-openapi',
  })
}

async function storeToken(app: { request(input: string, init?: RequestInit): Promise<Response> }) {
  const response = await app.request('/v1/auth/tokens', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      domain: 'railway.app',
      userId: 'claude-user',
      token: 'secret-railway-token',
    }),
  })
  expect(response.status).toBe(200)
}

function authHeaders() {
  return {
    Authorization: 'Bearer demo-key',
    'Content-Type': 'application/json',
  }
}

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function buildSpec(baseUrl: string) {
  return {
    openapi: '3.0.0',
    info: { title: 'Mock Railway API', version: '1.0.0' },
    servers: [{ url: baseUrl }],
    paths: {
      '/projects': {
        get: { operationId: 'listProjects', summary: 'List projects', parameters: [] },
        post: {
          operationId: 'createProject',
          summary: 'Create project',
          requestBody: {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { name: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      '/projects/{id}/deploy': {
        post: {
          operationId: 'deployProject',
          summary: 'Deploy project',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/projects/{id}/logs': {
        get: {
          operationId: 'getProjectLogs',
          summary: 'Get logs',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
      '/projects/{id}': {
        delete: {
          operationId: 'deleteProject',
          summary: 'Delete project',
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        },
      },
    },
  }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('condition was not met before timeout')
}
