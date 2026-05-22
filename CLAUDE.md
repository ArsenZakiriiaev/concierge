# Concierge

> OAuth for AI agents. Paste one snippet into any platform; it becomes an AI-agent
> endpoint that any assistant (Claude, ChatGPT, Gemini, open-source) can talk to via MCP.

## What this project is

Instead of an assistant scraping a website or calling 600 raw MCP tools, it talks to the
platform's own **in-platform agent**, hosted by Concierge. The agent executes actions
internally and returns a structured result. The platform sees every AI interaction,
controls how it is represented to the model, and earns revenue from it.

```
Without Concierge:  Claude -> scrapes site / 600 dumb MCP tools -> fragile, platform sees nothing
With Concierge:     Claude -> platform's in-platform agent -> clean result, platform monetizes
```

## Core mental model

- **Claude owns** the conversation, the language, the interface. Stateless. Forgets.
- **Concierge owns** state, credentials, action history, attribution. Stateful. Never forgets.
- Agent-to-agent, **not** tool-to-agent. The assistant sends *intent*; the platform agent
  orchestrates. The assistant never sees raw API endpoints.

## Repo layout (target)

```
concierge/
  packages/
    sdk/            @concierge/sdk - what platforms paste in. TypeScript, tsup, zero deps.
    mcp-server/     MCP server: concierge_lookup + concierge_act tools.
    agent-runtime/  In-platform agent. LLMProvider + ContextProvider interfaces.
    ingestion/      openapi.ts, scraper.ts, embedder.ts. MIT OSS. ~3 files.
  apps/
    backend/        Node.js + Hono API. Registry, auth bridge, sync endpoint.
    registry-web/   Next.js public registry frontend (concierge.dev/registry).
  db/
    migrations/     PostgreSQL + pgvector schema. ClickHouse schema for intent graph.
  fixtures/
    *.openapi.json  Hardcoded specs for the demo.
```

## Tech stack (do not substitute without reason)

- SDK: TypeScript, tsup, **zero runtime dependencies** except `fetch`. MIT, published to npm.
- Backend: Node.js + Hono.
- DB: PostgreSQL + pgvector extension. `vector(1536)` embeddings, ivfflat index.
- Analytics: ClickHouse (cross-platform intent graph, attribution events).
- Job queue: BullMQ.
- Agent runtime: `LLMProvider` interface; default Anthropic SDK (`claude-sonnet-4`).
  GPT + Gemini adapters are first-class, not afterthoughts.
- Context layer: own `ContextProvider` — pgvector similarity search + outcome weighting.
- Embeddings: Anthropic or OpenAI embeddings API.
- MCP: `@modelcontextprotocol/sdk`. stdio transport (desktop) + HTTP (web).
- Auth: OAuth 2.0, `jose` (JWT), Okta/Azure AD for enterprise SSO.
- Hosting: Railway or Fly.io. Edge registry: Cloudflare Workers.

## Architectural invariants — do not violate

1. **`LLMProvider` and `ContextProvider` are interfaces.** Agent-runtime code must never
   import a concrete model SDK or pgvector directly. Swap either without touching agent code.
2. **Multi-model from day one.** Claude is the default, never the only path.
3. **MCP-native.** Expose everything as MCP. No proprietary protocol.
4. **One snippet, two registries.** Public + private enterprise registries share the same
   snippet, infra, and agent runtime. Visibility is a config flag, not a separate product.
5. **Own the ingestion runtime, open-source the parser.** `openapi.ts` / `scraper.ts` /
   `embedder.ts` ship MIT. The moat is outcome-weighted retrieval + the cross-platform
   intent graph, not the parser.
6. **Audit log is a feature, not an afterthought.** Every interaction logged at the
   infrastructure level: `timestamp | user | platform | action | result | approval_status | model_used`.
   Platform data never passes through any model provider — interactions terminate at the
   Concierge runtime. This is the compliance pitch.
7. **Concierge owns state.** Every action is written to the `interactions` table
   immediately, independent of any assistant's context window. This is what makes
   multi-chat resumption and attribution possible.

## Key data model

- `platforms` — registry: domain -> agent endpoint, permissions, revshare_bps, visibility.
- `chunks` — `vector(1536)` embedded context, `chunk_type` = `openapi` | `docs`.
- `chunk_metrics` — per-chunk `attempts` / `successes` / generated `success_rate`.
- `interactions` — every agent action; `status`, `completed_steps[]`, `pending_steps[]`,
  `value_moved`. Powers resumable multi-step workflows and rev-share.
- `intent_events` (ClickHouse) — cross-platform intent graph; the data moat.

## Build order (see TECHNICAL_PLAN.md for detail)

1. **Demo (this week):** hardcoded OpenAPI JSON -> agent system prompt -> MCP server
   (2 tools) -> registry lookup -> one platform working end-to-end in Claude Desktop.
2. **Week 2:** SDK + hash-based change detection, OpenAPI parser, pgvector + embedder.
3. **Week 3:** sitemap crawler + chunker, `ContextProvider`, real OAuth, open-source SDK.
4. **Week 4+:** `chunk_metrics`, weighted retrieval, ClickHouse intent graph, GPT/Gemini
   adapters, attribution dashboard, rev-share, public registry frontend.

Start with the hardcoded JSON. Get the action layer working first. The demo only needs to
prove the action layer works.

## Environment variables

```
ANTHROPIC_API_KEY=      # default agent model + embeddings
OPENAI_API_KEY=         # multi-model adapter + alt embeddings
DATABASE_URL=           # PostgreSQL with pgvector extension
CLICKHOUSE_URL=         # intent-graph analytics store
CONCIERGE_API_KEY=      # generated per platform on registration
```

## Conventions

- TypeScript everywhere. SDK stays dependency-free; backend may use deps.
- Demo-first: never block the end-to-end demo on ingestion infrastructure.
- When adding a model, add an `LLMProvider` adapter — never branch on model name in
  agent code.
