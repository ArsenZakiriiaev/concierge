// Embed chunks via Anthropic or OpenAI, store in pgvector. MIT-licensed.

export interface EmbedChunk {
  content: string
  url?: string
  chunkType: 'openapi' | 'docs'
}

export interface EmbeddedChunk extends EmbedChunk {
  embedding: number[]
}

export async function embedChunks(
  chunks: EmbedChunk[],
  apiKey: string,
  provider: 'openai' | 'anthropic' = 'openai',
): Promise<EmbeddedChunk[]> {
  if (provider === 'openai') return embedWithOpenAI(chunks, apiKey)
  throw new Error(`Embedding provider '${provider}' not yet implemented`)
}

async function embedWithOpenAI(chunks: EmbedChunk[], apiKey: string): Promise<EmbeddedChunk[]> {
  const results: EmbeddedChunk[] = []
  // Batch in groups of 100 to stay within OpenAI limits.
  for (let i = 0; i < chunks.length; i += 100) {
    const batch = chunks.slice(i, i + 100)
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: batch.map((c) => c.content),
      }),
    })
    if (!res.ok) throw new Error(`OpenAI embeddings error: ${res.status}`)
    const data = await res.json() as { data: { embedding: number[] }[] }
    for (let j = 0; j < batch.length; j++) {
      results.push({ ...batch[j], embedding: data.data[j].embedding })
    }
  }
  return results
}
