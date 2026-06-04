import { createHash, randomUUID } from 'crypto'
import type { Queue, Worker } from 'bullmq'
import { crawlAndChunk, embedChunks, type EmbedChunk, type EmbeddedChunk } from '@concierge/ingestion'
import { query } from './db.js'
import { env } from './config.js'
import { vectorLiteral } from './pgvector-context.js'

const QUEUE_NAME = 'concierge-reindex'

export interface ReindexJobData {
  platformId: string
  openapiHash: string
  openapiUrl: string
  website?: string
}

let queuePromise: Promise<Queue<ReindexJobData> | undefined> | undefined
let worker: Worker<ReindexJobData> | undefined

export async function enqueueReindex(data: ReindexJobData): Promise<{ jobId: string; queued: boolean }> {
  const queue = await getQueue()
  if (!queue) {
    const jobId = `inline-${randomUUID()}`
    void processReindexJob(data).catch((err) => {
      console.error(`[reindex] inline job ${jobId} failed:`, err)
    })
    return { jobId, queued: false }
  }

  const job = await queue.add('reindex-platform', data, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1_000 },
    removeOnComplete: 100,
    removeOnFail: 100,
  })
  return { jobId: String(job.id), queued: true }
}

export async function startReindexWorker(): Promise<void> {
  const connection = redisConnection()
  if (!connection || worker) return

  const { Worker: BullWorker } = await import('bullmq')
  worker = new BullWorker<ReindexJobData>(
    QUEUE_NAME,
    async (job) => processReindexJob(job.data),
    { connection },
  )

  worker.on('completed', (job) => {
    console.log(`[reindex] completed job ${job.id}`)
  })
  worker.on('failed', (job, err) => {
    console.error(`[reindex] failed job ${job?.id}:`, err)
  })
}

export async function processReindexJob(data: ReindexJobData): Promise<void> {
  const openapiText = await fetchText(data.openapiUrl)
  const chunks: EmbedChunk[] = [
    { content: openapiText, url: data.openapiUrl, chunkType: 'openapi' },
  ]

  if (data.website) {
    const docsChunks = await crawlAndChunk(data.website)
    chunks.push(...docsChunks)
  }

  const nonEmptyChunks = chunks.filter((chunk) => chunk.content.trim().length > 0)
  const embedded = await maybeEmbed(nonEmptyChunks)
  const incomingHashes = embedded.map((chunk) => contentHash(chunk))

  await query(
    `DELETE FROM chunks
     WHERE platform_id = $1
       AND content_hash IS NOT NULL
       AND NOT (content_hash = ANY($2::text[]))`,
    [data.platformId, incomingHashes],
  )

  for (const chunk of embedded) {
    await query(
      `INSERT INTO chunks (platform_id, url, content, embedding, chunk_type, content_hash, updated_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6, NOW())
       ON CONFLICT (platform_id, chunk_type, content_hash) WHERE content_hash IS NOT NULL
       DO UPDATE SET
         url = EXCLUDED.url,
         content = EXCLUDED.content,
         embedding = EXCLUDED.embedding,
         updated_at = NOW()`,
      [
        data.platformId,
        chunk.url ?? null,
        chunk.content,
        'embedding' in chunk && chunk.embedding.length > 0 ? vectorLiteral(chunk.embedding) : null,
        chunk.chunkType,
        contentHash(chunk),
      ],
    )
  }

  await query(
    `UPDATE platforms
     SET openapi_hash = $1,
         openapi_url = $2,
         website = $3,
         updated_at = NOW()
     WHERE id = $4`,
    [data.openapiHash, data.openapiUrl, data.website ?? null, data.platformId],
  )
}

async function getQueue(): Promise<Queue<ReindexJobData> | undefined> {
  if (!queuePromise) {
    queuePromise = (async () => {
      const connection = redisConnection()
      if (!connection) return undefined
      const { Queue: BullQueue } = await import('bullmq')
      return new BullQueue<ReindexJobData>(QUEUE_NAME, { connection })
    })()
  }

  return queuePromise
}

function redisConnection(): { host: string; port: number; username?: string; password?: string; db?: number } | undefined {
  const redisUrl = env('REDIS_URL')
  if (!redisUrl) return undefined

  const url = new URL(redisUrl)
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : undefined,
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`)
  return res.text()
}

async function maybeEmbed(chunks: EmbedChunk[]): Promise<(EmbedChunk | EmbeddedChunk)[]> {
  const openaiApiKey = env('OPENAI_API_KEY')
  if (!openaiApiKey) return chunks
  return embedChunks(chunks, openaiApiKey, 'openai')
}

function contentHash(chunk: EmbedChunk): string {
  return createHash('sha256')
    .update(chunk.chunkType)
    .update('\0')
    .update(chunk.url ?? '')
    .update('\0')
    .update(chunk.content)
    .digest('hex')
}
