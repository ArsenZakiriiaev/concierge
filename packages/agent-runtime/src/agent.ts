import type { LLMProvider, ContextProvider, Result } from './interfaces.js'

export interface PlatformConfig {
  id: string
  name: string
  permissions: string[]
  requiresApproval: string[]
}

export class InPlatformAgent {
  constructor(
    private llm: LLMProvider,
    private context: ContextProvider,
    private platform: PlatformConfig,
  ) {}

  async execute(intent: string, userId: string): Promise<Result> {
    const contextChunks = await this.context.search(intent, this.platform.id)

    const systemPrompt = [
      `You are the in-platform agent for ${this.platform.name}.`,
      `You execute user intents by calling the platform's internal API.`,
      `Permitted actions: ${this.platform.permissions.join(', ')}.`,
      `Actions requiring approval: ${this.platform.requiresApproval.join(', ')}.`,
      `If an action requires approval, respond with status awaiting_approval and do not execute.`,
      `Current user: ${userId}`,
      ``,
      `Platform API context:`,
      contextChunks,
    ].join('\n')

    return this.llm.run(systemPrompt, intent, [])
  }
}
