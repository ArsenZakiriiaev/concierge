// Fetch + parse OpenAPI spec, extract actions. ~200 lines. MIT-licensed.

export interface Action {
  operationId: string
  method: string
  path: string
  summary?: string
  description?: string
  parameters: unknown[]
  requestBody?: unknown
}

export async function fetchAndParseSpec(url: string): Promise<Action[]> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch OpenAPI spec: ${res.status}`)
  const spec = await res.json() as Record<string, unknown>
  return extractActions(spec)
}

export function extractActions(spec: Record<string, unknown>): Action[] {
  const actions: Action[] = []
  const paths = spec.paths as Record<string, Record<string, unknown>> | undefined
  if (!paths) return actions

  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method)) continue
      const op = operation as Record<string, unknown>
      actions.push({
        operationId: (op.operationId as string) ?? `${method}_${path.replace(/\//g, '_')}`,
        method: method.toUpperCase(),
        path,
        summary: op.summary as string | undefined,
        description: op.description as string | undefined,
        parameters: (op.parameters as unknown[]) ?? [],
        requestBody: op.requestBody,
      })
    }
  }
  return actions
}
