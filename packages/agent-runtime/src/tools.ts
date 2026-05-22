import type { Tool } from './interfaces.js'

interface OpenAPIOperation {
  operationId?: string
  summary?: string
  description?: string
  parameters?: { name: string; in: string; required?: boolean; schema?: { type: string } }[]
  requestBody?: { content?: { 'application/json'?: { schema?: Record<string, unknown> } } }
}

interface OpenAPISpec {
  servers?: { url: string }[]
  paths?: Record<string, Record<string, OpenAPIOperation>>
}

// Build callable Tool objects from an OpenAPI spec + delegated token.
// The agent calls these tools; they make real HTTP requests to the platform API.
export function buildToolsFromSpec(
  specJson: string,
  delegatedToken: string,
  allowedOperations: string[],
  approvalRequired: string[],
): Tool[] {
  let spec: OpenAPISpec
  try {
    spec = JSON.parse(specJson)
  } catch {
    return []
  }

  const baseUrl = spec.servers?.[0]?.url ?? ''
  const tools: Tool[] = []

  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue

      const opId = operation.operationId ?? `${method}_${path.replace(/\W/g, '_')}`
      if (allowedOperations.length > 0 && !allowedOperations.includes(opId)) continue

      const needsApproval = approvalRequired.includes(opId)

      // Build JSON Schema for the tool input
      const properties: Record<string, unknown> = {}
      const required: string[] = []

      for (const param of operation.parameters ?? []) {
        properties[param.name] = { type: param.schema?.type ?? 'string', description: `${param.in} parameter` }
        if (param.required) required.push(param.name)
      }

      const bodySchema = operation.requestBody?.content?.['application/json']?.schema
      if (bodySchema && 'properties' in bodySchema) {
        for (const [k, v] of Object.entries(bodySchema.properties as Record<string, unknown>)) {
          properties[k] = v
        }
      }

      tools.push({
        name: opId,
        description: needsApproval
          ? `[REQUIRES APPROVAL] ${operation.summary ?? opId}`
          : (operation.summary ?? opId),
        inputSchema: {
          type: 'object',
          properties,
          required,
        },
        async execute(input: Record<string, unknown>): Promise<string> {
          if (needsApproval) {
            return JSON.stringify({ status: 'awaiting_approval', operation: opId, input })
          }

          // Substitute path params
          let resolvedPath = path
          for (const [k, v] of Object.entries(input)) {
            resolvedPath = resolvedPath.replace(`{${k}}`, String(v))
          }

          const url = `${baseUrl}${resolvedPath}`
          const isReadMethod = method === 'get'
          const body = isReadMethod ? undefined : JSON.stringify(input)

          const res = await fetch(url, {
            method: method.toUpperCase(),
            headers: {
              Authorization: `Bearer ${delegatedToken}`,
              'Content-Type': 'application/json',
            },
            body,
          })

          const text = await res.text()
          return res.ok ? text : `HTTP ${res.status}: ${text}`
        },
      })
    }
  }

  return tools
}
