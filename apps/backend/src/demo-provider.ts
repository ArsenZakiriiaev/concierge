import type { LLMProvider, Result, Tool } from '@concierge/agent-runtime'

export class DemoProvider implements LLMProvider {
  async run(_systemPrompt: string, intent: string, tools: Tool[]): Promise<Result> {
    const tool = selectTool(intent, tools)
    if (!tool) {
      return {
        status: 'failed',
        output: 'No matching demo tool was available for this intent.',
      }
    }

    const input = inputForIntent(intent, tool.name)
    const output = await tool.execute(input)
    const approval = parseApproval(output)
    if (approval) {
      return {
        status: 'awaiting_approval',
        output: `Approval required for ${approval.operation}.`,
        completedSteps: [],
        pendingSteps: [approval.operation],
        metadata: { pendingOperation: approval },
      }
    }

    return {
      status: output.startsWith('HTTP ') ? 'failed' : 'complete',
      output,
      completedSteps: [`${tool.name}(${JSON.stringify(input)})`],
      pendingSteps: [],
    }
  }
}

function selectTool(intent: string, tools: Tool[]): Tool | undefined {
  const normalized = intent.toLowerCase()
  if (normalized.includes('delete')) return tools.find((tool) => tool.name === 'deleteProject')
  if (normalized.includes('deploy')) return tools.find((tool) => tool.name === 'deployProject')
  if (normalized.includes('log')) return tools.find((tool) => tool.name === 'getProjectLogs')
  if (normalized.includes('create') || normalized.includes('new project')) {
    return tools.find((tool) => tool.name === 'createProject')
  }
  return tools.find((tool) => tool.name === 'listProjects') ?? tools[0]
}

function inputForIntent(intent: string, operation: string): Record<string, unknown> {
  const id = extractValue(intent, /(?:project|id)\s+([a-zA-Z0-9_-]+)/) ?? 'demo-project'
  const name = extractValue(intent, /named\s+["']?([a-zA-Z0-9_-]+)/) ?? 'claude-demo'

  if (operation === 'createProject') return { name }
  if (operation === 'deployProject' || operation === 'getProjectLogs' || operation === 'deleteProject') {
    return { id }
  }
  return {}
}

function extractValue(input: string, pattern: RegExp): string | undefined {
  return pattern.exec(input)?.[1]
}

function parseApproval(output: string): { operation: string; input: Record<string, unknown> } | undefined {
  try {
    const parsed = JSON.parse(output) as {
      status?: string
      operation?: string
      input?: Record<string, unknown>
    }
    if (parsed.status === 'awaiting_approval' && parsed.operation && parsed.input) {
      return { operation: parsed.operation, input: parsed.input }
    }
  } catch {
    return undefined
  }
  return undefined
}
