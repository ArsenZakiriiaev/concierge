// Fetch sitemap.xml, crawl docs pages, chunk text into ~512-token pieces. MIT-licensed.

const CHUNK_CHARS = 2000 // ~512 tokens at ~4 chars/token

export interface Chunk {
  url: string
  content: string
  chunkType: 'docs'
}

export async function crawlAndChunk(websiteUrl: string): Promise<Chunk[]> {
  const urls = await fetchSitemapUrls(websiteUrl)
  const chunks: Chunk[] = []
  for (const url of urls) {
    const text = await fetchPageText(url)
    for (const piece of chunkText(text)) {
      chunks.push({ url, content: piece, chunkType: 'docs' })
    }
  }
  return chunks
}

async function fetchSitemapUrls(baseUrl: string): Promise<string[]> {
  const sitemapUrl = `${baseUrl.replace(/\/$/, '')}/sitemap.xml`
  const res = await fetch(sitemapUrl)
  if (!res.ok) return []
  const xml = await res.text()
  return [...xml.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1])
}

async function fetchPageText(url: string): Promise<string> {
  const res = await fetch(url)
  if (!res.ok) return ''
  const html = await res.text()
  // Strip tags — a real implementation would use a proper HTML parser.
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function chunkText(text: string): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += CHUNK_CHARS) {
    chunks.push(text.slice(i, i + CHUNK_CHARS))
  }
  return chunks
}
