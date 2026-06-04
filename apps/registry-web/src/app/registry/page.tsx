interface Platform {
  id: string
  domain: string
  name: string
  permissions?: string[]
  requires_approval?: string[]
  visibility: string
}

export const dynamic = 'force-dynamic'

export default async function RegistryPage() {
  const platforms = await getPlatforms()

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 880, margin: '48px auto', padding: 24 }}>
      <h1>Concierge Registry</h1>
      <p>Public platforms available to Claude Desktop through Concierge MCP.</p>
      {platforms.length === 0 ? (
        <p>No public platforms are registered yet.</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }}>
          {platforms.map((platform) => (
            <li key={platform.id} style={{ border: '1px solid #ddd', borderRadius: 8, padding: 16 }}>
              <strong>{platform.name}</strong>
              <div>{platform.domain}</div>
              <div>Actions: {(platform.permissions ?? []).join(', ') || 'none configured'}</div>
              <div>Approval required: {(platform.requires_approval ?? []).join(', ') || 'none'}</div>
            </li>
          ))}
        </ul>
      )}
    </main>
  )
}

async function getPlatforms(): Promise<Platform[]> {
  const apiUrl = (process.env.CONCIERGE_API_URL ?? 'http://localhost:3000').replace(/\/$/, '')
  try {
    const res = await fetch(`${apiUrl}/v1/registry/list`, { cache: 'no-store' })
    if (!res.ok) return []
    return await res.json() as Platform[]
  } catch {
    return []
  }
}
