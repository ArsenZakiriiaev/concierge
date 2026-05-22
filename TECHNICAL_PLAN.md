# Concierge — Technical Implementation Plan

This plan turns the project brief into a concrete, sequenced engineering roadmap.
It is organized as: architecture overview, component-by-component spec, phased build
plan with deliverables, and risk/validation checkpoints.

---

## 1. System Architecture

### 1.1 Request flow

```
User: "deploy my repo to Railway"
  v
Assistant (Claude / GPT / Gemini / OSS)
  v  MCP call: concierge_act("railway", intent, userId)
MCP Server
  v
Registry          -> resolve domain -> platform record + agent endpoint
  v
Auth Bridge       -> fetch + decrypt user's delegated OAuth token for platform
  v
In-Platform Agent (one logical agent per platform, hosted by Concierge)
  - ContextProvider.search(intent, platformId) -> top-k context chunks
  - LLMProvider.run(systemPrompt, intent, tools) -> orchestration
  - calls platform's internal API with delegated token
  - handles retries, errors, multi-step edge cases
  v
interactions row written (status, steps, value_moved, model_used)
attribution event written to ClickHouse
  v
Structured result -> MCP -> Assistant -> User
```

### 1.2 Components (and their package)

| Component        | Package              | Responsibility |
|------------------|----------------------|----------------|
| SDK              | `packages/sdk`       | One-call config; hash + report spec on startup |
| MCP Server       | `packages/mcp-server`| `concierge_lookup`, `concierge_act`; stdio + HTTP |
| Agent Runtime    | `packages/agent-runtime` | Per-platform agent; LLMProvider + ContextProvider |
| Ingestion        | `packages/ingestion` | `openapi.ts`, `scraper.ts`, `embedder.ts` (MIT OSS) |
| Backend API      | `apps/backend`       | Registry, auth bridge, `/v1/sync`, interactions |
| Registry Web     | `apps/registry-web`  | Public SEO surface at concierge.dev/registry |
| Data stores      | `db/`                | PostgreSQL+pgvector, ClickHouse |

### 1.3 Two interfaces that must never leak

```ts
export interface LLMProvider {
  run(systemPrompt: string, intent: string, tools: Tool[]): Promise<Result>
}
export interface ContextProvider {
  search(intent: string, platformId: string): Promise<string>
}
```

Agent-runtime depends only on these. Concrete implementations
(`AnthropicProvider`, `OpenAIProvider`, `PgVectorContextProvider`) are injected at
construction. This is the defense against both token deflation (swap model) and
Anthropic absorption (structural neutrality).

---

## 2. Data Model

### 2.1 PostgreSQL (pgvector)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE platforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  permissions     TEXT[],
  requires_approval TEXT[],
  visibility      TEXT DEFAULT 'public',     -- 'public' | 'private'
  company_id      UUID,
  revshare_bps    INT DEFAULT 0,             -- basis points returned on tx fees
  status          TEXT DEFAULT 'active',
  openapi_hash    TEXT,                      -- last known spec hash
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platforms(id),
  url         TEXT,
  content     TEXT,
  embedding   vector(1536),
  chunk_type  TEXT,                          -- 'openapi' | 'docs'
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE chunk_metrics (                 -- Post-MVP (data moat layer 1)
  chunk_id     UUID REFERENCES chunks(id),
  intent_type  TEXT,
  attempts     INT DEFAULT 0,
  successes    INT DEFAULT 0,
  success_rate FLOAT GENERATED ALWAYS AS
    (successes::float / NULLIF(attempts, 0)) STORED
);

CREATE TABLE interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  platform_id      UUID NOT NULL,
  assistant        TEXT NOT NULL,            -- claude | gpt | gemini | other
  intent           TEXT NOT NULL,
  intent_type      TEXT,
  status           TEXT,                     -- pending|complete|awaiting_approval|incomplete|failed
  result           JSONB,
  value_moved      DECIMAL,                  -- basis for tx fee + rev-share
  completed_steps  TEXT[],
  pending_steps    TEXT[],
  metadata         JSONB,                    -- report id, deploy id, approver
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- Encrypted delegated OAuth tokens, per user per platform
CREATE TABLE delegated_tokens (
  user_id      UUID NOT NULL,
  platform_id  UUID NOT NULL,
  ciphertext   BYTEA NOT NULL,               -- AES-GCM encrypted token
  expires_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, platform_id)
);
```

### 2.2 ClickHouse (intent graph — Post-MVP)

```sql
CREATE TABLE intent_events (
  user_id           UUID,
  assistant         String,
  platform_id       UUID,
  intent_type       String,
  sequence_position Int32,
  outcome           String,
  value_moved       Decimal(18,2),
  created_at        DateTime
) ENGINE = MergeTree() ORDER BY (intent_type, created_at);
```

### 2.3 Outcome-weighted retrieval query (Post-MVP)

```sql
SELECT c.content
FROM chunks c
LEFT JOIN chunk_metrics m ON m.chunk_id = c.id
WHERE c.platform_id = $1
ORDER BY (c.embedding <=> $2) * 0.6
       + (1 - COALESCE(m.success_rate, 0.5)) * 0.4
LIMIT 10;
```

---

## 3. Component Specs

### 3.1 SDK — `@concierge/sdk`

What platforms paste in. Single `concierge({...})` call. Build with tsup, zero runtime
deps, MIT-licensed, published to npm.

```ts
concierge({
  apiKey: process.env.CONCIERGE_API_KEY,
  knowledge: { openapi: 'https://api.platform.com/swagger.json',
               website: 'https://platform.com' },
  permissions: ['deploy', 'getLogs', 'getProjects'],
  requiresApproval: ['delete', 'billing'],
  visibility: 'public',                 // or 'private' + company + auth block
})
```

On every server startup the SDK hashes the OpenAPI spec and POSTs the hash to
`https://api.concierge.dev/v1/sync`. **The deploy is the sync trigger** — no webhooks,
no cron, no polling. If the hash differs, the backend triggers a diff-only re-index.

Tasks:
- [ ] `concierge()` config validation + normalization.
- [ ] `checkForChanges()` — fetch spec, `sha256`, POST to `/v1/sync`.
- [ ] tsup build config, zero deps, npm publish pipeline.
- [ ] Private/enterprise config: `visibility`, `company`, `auth` (Okta), role-keyed
      `permissions` / `requiresApproval`.

### 3.2 MCP Server — `packages/mcp-server`

Two tools, exposed via stdio (desktop) and HTTP (web), built on
`@modelcontextprotocol/sdk`.

- `concierge_lookup(domain)` -> does this platform have a Concierge agent?
- `concierge_act(domain, intent, userId)` -> execute intent; returns structured result.

Tasks:
- [ ] MCP server scaffold with both transports.
- [ ] `lookup` -> registry query.
- [ ] `act` -> auth bridge -> agent runtime -> result; writes `interactions` row.
- [ ] Error surface: clean structured errors back to the assistant.

### 3.3 Agent Runtime — `packages/agent-runtime`

One logical agent per platform. Receives intent + resolved context, orchestrates calls
to the platform's internal API.

Tasks:
- [ ] `LLMProvider` + `ContextProvider` interfaces (Section 1.3).
- [ ] `AnthropicProvider` (default, `claude-sonnet-4`).
- [ ] Agent loop: system prompt (platform identity + permissions) + intent + tools ->
      multi-step orchestration with retries.
- [ ] Permission + approval enforcement: block actions in `requiresApproval`, emit
      `awaiting_approval` status.
- [ ] Dynamic complexity routing: classify intent -> haiku (cheap) / sonnet
      (orchestration) / sonnet-extended (rare, complex). Internal, never configured by
      the platform.
- [ ] Post-MVP: `OpenAIProvider`, `GeminiProvider`, OSS adapter.

### 3.4 Ingestion — `packages/ingestion` (MIT OSS, ~3 files)

- `openapi.ts` — fetch + parse OpenAPI spec, extract actions (~200 lines).
- `scraper.ts` — fetch `sitemap.xml`, crawl docs, chunk text into ~512-token pieces.
- `embedder.ts` — embed chunks via Anthropic/OpenAI, store in pgvector.

Diff-only re-index: on hash change, fetch new spec, diff against previous, re-embed
**only changed chunks**. Driven by BullMQ jobs.

### 3.5 Backend API — `apps/backend` (Node.js + Hono)

- [ ] `POST /v1/sync` — receive hash from SDK; enqueue re-index if changed.
- [ ] Registry endpoints — register platform, lookup by domain (public + private tiers).
- [ ] Auth bridge — OAuth delegation flow; AES-GCM encrypt/store delegated tokens;
      decrypt at action time. Enterprise: Okta/Azure AD SSO; roles map to IdP groups.
- [ ] Interactions API — write/update rows; query latest by user/platform/status
      (powers multi-chat scenarios).
- [ ] Approval webhook — approver clicks email link -> webhook fires -> agent executes
      -> status -> `complete`.

### 3.6 Registry Web — `apps/registry-web` (Next.js)

Statically generated from the `platforms` table. Public SEO surface at
concierge.dev/registry — the canonical place developers look up AI-actionable
platforms. Post-MVP.

---

## 4. State Management Across Chats

Concierge is stateful so the assistant doesn't have to be. Every action is written to
`interactions` immediately. Four scenarios the design must support:

1. **Same chat, multiple messages** — assistant passes full thread; Concierge writes
   state at completion.
2. **New chat referencing prior action** — `concierge_act` queries `interactions` for
   the latest matching row, then checks the live platform API.
3. **Interrupted multi-step workflow** — `status='incomplete'`, `completed_steps[]` /
   `pending_steps[]` recorded; a later chat resumes from the first pending step.
4. **Pending approval across chats** — approval webhook fires independently of any
   chat; status flips to `complete`; a later chat reads the result.

Validation: all four must pass as integration tests before the MVP is considered done.

---

## 5. Phased Build Plan

### Phase 0 — Demo (this week)
Goal: user types "deploy my repo to [platform]" in Claude Desktop -> works end-to-end.
Proves the action layer. Skip everything else.

- [ ] Hardcode one platform's OpenAPI spec as JSON in `fixtures/`.
- [ ] Feed spec directly into the agent system prompt — no ingestion infra.
- [ ] Agent runtime wired with `LLMProvider` interface (only `AnthropicProvider` wired).
- [ ] MCP server with 2 tools (`lookup` + `act`).
- [ ] Registry: PostgreSQL with a simple domain lookup.
- [ ] One platform working end-to-end in Claude Desktop.

**Exit criteria:** intent -> result in Claude Desktop, no scraping, no tool selection.

### Phase 1 — MVP (2–3 weeks after demo)
- [ ] SDK npm package with hash-based change detection.
- [ ] OpenAPI parser (~200 lines), open-sourced.
- [ ] pgvector setup in PostgreSQL.
- [ ] Basic sitemap crawler + text chunker.
- [ ] Embedder (Anthropic or OpenAI embeddings).
- [ ] Diff-only re-index on hash change.
- [ ] Real OAuth (replace the hardcoded token).
- [ ] **First enterprise design-partner conversation (Workday wedge).** A signed LOI by
      ~week 6 is the real milestone — not the code.

### Phase 2 — Post-MVP (the moat)
- [ ] `chunk_metrics` table + outcome recording after every execution.
- [ ] Outcome-weighted retrieval (semantic + `success_rate`).
- [ ] ClickHouse intent-graph store + first cross-platform analytics queries.
- [ ] GPT + Gemini adapters through `LLMProvider`.
- [ ] Enterprise SSO (Okta / Azure AD).
- [ ] Attribution dashboard for platforms — the surface that justifies the snippet.
- [ ] Transaction-fee rev-share infrastructure.
- [ ] Billing / usage metering with spend caps + forecasting.
- [ ] Public registry frontend at concierge.dev/registry.

---

## 6. Cross-Cutting Concerns

- **Security:** delegated tokens AES-GCM encrypted at rest; assistant never sees raw
  credentials; platform data never transits a model provider.
- **Compliance:** every interaction logged centrally
  (`timestamp | user | platform | action | result | approval_status | model_used`) —
  satisfies SOC 2 / SOX. This is the enterprise sell, not an afterthought.
- **Billing transparency:** dashboard of interactions by type + cost, per-action
  breakdowns, platform-set spend caps, monthly forecasting.
- **Cost routing:** complexity classifier routes to the cheapest sufficient model;
  enterprise on-prem routes to an OSS adapter at the flat tier.

---

## 7. Validation Checkpoints

| Checkpoint            | Proves |
|-----------------------|--------|
| Demo end-to-end       | Action layer works |
| 4 multi-chat scenarios| Concierge owns state correctly |
| Diff-only re-index    | Deploy-as-trigger works without webhooks |
| Multi-model swap      | `LLMProvider` abstraction holds (Anthropic-risk defense) |
| Signed enterprise LOI | Workday wedge thesis is real (week ~6) |
| Signed CI/framework partner | Distribution thesis is real (Q1) |

Order of priority: hardcoded JSON -> action layer -> ingestion -> first LOI -> the moat.
