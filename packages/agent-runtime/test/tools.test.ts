import { describe, expect, it, vi } from 'vitest'
import { buildToolsFromSpec } from '../src/tools.js'

describe('OpenAPI tool generation', () => {
  it('filters by allowed operation and blocks approval-required calls before fetch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const tools = buildToolsFromSpec(JSON.stringify(spec()), 'delegated-token', ['deleteProject'], ['deleteProject'])
    expect(tools.map((tool) => tool.name)).toEqual(['deleteProject'])

    const result = await tools[0].execute({ id: 'demo-project' })
    expect(JSON.parse(result)).toEqual({
      status: 'awaiting_approval',
      operation: 'deleteProject',
      input: { id: 'demo-project' },
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('calls permitted platform operations with the delegated bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const tools = buildToolsFromSpec(JSON.stringify(spec()), 'delegated-token', ['deployProject'], [])
    const result = await tools[0].execute({ id: 'demo-project' })

    expect(JSON.parse(result)).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith('https://mock.railway.test/projects/demo-project/deploy', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer delegated-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ id: 'demo-project' }),
    })
  })
})

function spec() {
  return {
    openapi: '3.0.0',
    servers: [{ url: 'https://mock.railway.test' }],
    paths: {
      '/projects/{id}/deploy': {
        post: {
          operationId: 'deployProject',
          summary: 'Deploy project',
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
