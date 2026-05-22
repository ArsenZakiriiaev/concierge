import type { LLMProvider, ContextProvider, Result } from './interfaces.js'
import { buildToolsFromSpec } from './tools.js'

export interface PlatformConfig {
  id: string
  name: string
  permissions: string[]
  requiresApproval: string[]
  specJson?: string        // raw OpenAPI spec for tool generation
  delegatedToken?: string  // user's OAuth token for the platform
}

export class InPlatformAgent {
  constructor(
    private llm: LLMProvider,
    private context: ContextProvider,
    private platform: PlatformConfig,
  ) {}

  async execute(intent: string, userId: string): Promise<Result> {
    const contextChunks = await this.context.search(intent, this.platform.id)

    // Build callable tools from the spec if we have a token (demo: token may be absent)
    const tools = this.platform.specJson && this.platform.delegatedToken
      ? buildToolsFromSpec(
          this.platform.specJson,
          this.platform.delegatedToken,
          this.platform.permissions,
          this.platform.requiresApproval,
        )
      : []

    const systemPrompt = [
      `You are the in-platform agent for ${this.platform.name}.`,
      `You execute user intents by calling the platform's API via the tools provided.`,
      `Permitted actions: ${this.platform.permissions.join(', ')}.`,
      `Actions requiring approval before execution: ${this.platform.requiresApproval.join(', ')}.`,
      `If a tool returns { "status": "awaiting_approval" }, tell the user the action needs approval and stop.`,
      `Current user: ${userId}`,
      ``,
      `Platform API context:`,
      contextChunks,
    ].join('\n')

    return this.llm.run(systemPrompt, intent, tools)
  }
}
