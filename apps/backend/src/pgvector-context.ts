import type { ContextProvider } from '@concierge/agent-runtime'
import { query } from './db.js'
import { env } from './config.js'

interface ChunkRow {
  url: string | null
  content: string
  chunk_type: string
}

export class PgVectorContextProvider implements ContextProvider {
  constructor(
    private apiKey = env('OPENAI_API_KEY'),
    private limit = 6,
  ) {}

  async search(intent: string, platformId: string): Promise<string> {
    if (this.apiKey) {
      try {
        const embedding = await embedIntent(intent, this.apiKey)
        const { rows } = await query<ChunkRow>(
          `SELECT url, content, chunk_type
           FROM chunks
           WHERE platform_id = $1
             AND embedding IS NOT NULL
           ORDER BY embedding <=> $2::vector
           LIMIT $3`,
          [platformId, vectorLiteral(embedding), this.limit],
        )
        if (rows.length > 0) return formatChunks(rows)
      } catch (err) {
        console.warn(
          '[context] vector retrieval failed, falling back to recent chunks:',
          err instanceof Error ? err.message : String(err),
        )
      }
    }

    const { rows } = await query<ChunkRow>(
      `SELECT url, content, chunk_type
       FROM chunks
       WHERE platform_id = $1
       ORDER BY
         CASE WHEN chunk_type = 'openapi' THEN 0 ELSE 1 END,
         updated_at DESC NULLS LAST,
         created_at DESC
       LIMIT $2`,
      [platformId, this.limit],
    )

    return formatChunks(rows)
  }
}

async function embedIntent(intent: string, apiKey: string): Promise<number[]> {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-3-small',
      input: intent,
    }),
  })

  if (!res.ok) {
    const text = await res.text()
    throw new Error(`OpenAI embeddings error ${res.status}: ${text}`)
  }

  const data = await res.json() as { data: { embedding: number[] }[] }
  const embedding = data.data[0]?.embedding
  if (!embedding) throw new Error('OpenAI embedding response did not include an embedding')
  return embedding
}

export function vectorLiteral(values: number[]): string {
  return `[${values.map((value) => Number(value).toFixed(8)).join(',')}]`
}

function formatChunks(rows: ChunkRow[]): string {
  return rows
    .map((row, index) => {
      const source = row.url ? `${row.chunk_type}: ${row.url}` : row.chunk_type
      return `Context ${index + 1} (${source})\n${row.content}`
    })
    .join('\n\n')
}
