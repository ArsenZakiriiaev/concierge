import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, Tool, Result } from '../interfaces.js'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async run(systemPrompt: string, intent: string, tools: Tool[]): Promise<Result> {
    const anthropicTools: Anthropic.Tool[] = tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))

    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: intent },
    ]

    const completedSteps: string[] = []

    // Agentic loop — keep running until the model stops calling tools
    while (true) {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: 4096,
        system: systemPrompt,
        tools: anthropicTools.length > 0 ? anthropicTools : undefined,
        messages,
      })

      if (response.stop_reason === 'end_turn') {
        const output = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('')
        return { status: 'complete', output, completedSteps }
      }

      if (response.stop_reason === 'tool_use') {
        const toolUseBlocks = response.content.filter(
          (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
        )

        // Push the assistant message (with tool calls)
        messages.push({ role: 'assistant', content: response.content })

        // Execute each tool call and collect results
        const toolResults: Anthropic.ToolResultBlockParam[] = []
        for (const block of toolUseBlocks) {
          const tool = tools.find((t) => t.name === block.name)
          let result: string

          if (!tool) {
            result = `Error: unknown tool ${block.name}`
          } else {
            try {
              result = await tool.execute(block.input as Record<string, unknown>)
            } catch (err) {
              result = `Error: ${err instanceof Error ? err.message : String(err)}`
            }
          }

          const approval = parseApprovalResult(result)
          if (approval) {
            return {
              status: 'awaiting_approval',
              output: `Approval required for ${approval.operation}.`,
              completedSteps,
              pendingSteps: [approval.operation],
              metadata: {
                pendingOperation: approval,
              },
            }
          }

          if (tool) {
            completedSteps.push(`${block.name}(${JSON.stringify(block.input)})`)
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: block.id,
            content: result,
          })
        }

        messages.push({ role: 'user', content: toolResults })
        continue
      }

      // Unexpected stop reason
      return {
        status: 'failed',
        output: `Unexpected stop reason: ${response.stop_reason}`,
        completedSteps,
      }
    }
  }
}

function parseApprovalResult(result: string):
  | { operation: string; input: Record<string, unknown> }
  | undefined {
  try {
    const parsed = JSON.parse(result) as {
      status?: string
      operation?: string
      input?: Record<string, unknown>
    }
    if (
      parsed.status === 'awaiting_approval'
      && typeof parsed.operation === 'string'
      && parsed.input
      && typeof parsed.input === 'object'
    ) {
      return { operation: parsed.operation, input: parsed.input }
    }
  } catch {
    return undefined
  }

  return undefined
}
