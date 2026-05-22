export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface Result {
  status: 'complete' | 'incomplete' | 'awaiting_approval' | 'failed'
  output: string
  valueMoved?: number
  completedSteps?: string[]
  pendingSteps?: string[]
  metadata?: Record<string, unknown>
}

// The two interfaces agent-runtime depends on. Never import concrete implementations here.
export interface LLMProvider {
  run(systemPrompt: string, intent: string, tools: Tool[]): Promise<Result>
}

export interface ContextProvider {
  search(intent: string, platformId: string): Promise<string>
}
