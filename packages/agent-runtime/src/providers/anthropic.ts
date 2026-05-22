import Anthropic from '@anthropic-ai/sdk'
import type { LLMProvider, Tool, Result } from '../interfaces.js'

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic
  private model: string

  constructor(apiKey: string, model = 'claude-sonnet-4-6') {
    this.client = new Anthropic({ apiKey })
    this.model = model
  }

  async run(systemPrompt: string, intent: string, _tools: Tool[]): Promise<Result> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: intent }],
    })

    const output = response.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')

    return { status: 'complete', output }
  }
}
