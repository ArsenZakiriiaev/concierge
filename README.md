# Concierge

**OAuth for AI agents.**

Paste one snippet into any platform or internal tool and it gets a dedicated AI agent endpoint that any AI assistant (Claude, ChatGPT, etc.) can talk to via MCP.

Instead of Claude scraping a website or calling raw API tools directly, it talks to the platform's own dedicated in-platform agent, which executes actions internally and returns structured results.

---

## The Problem

**Without Concierge:**
```
Claude → scrapes website / calls 600 dumb MCP tools → fragile, slow, overwhelmed
```

**With Concierge:**
```
Claude → 2 smart MCP tools → Concierge resolves platform → in-platform agent executes → clean result
```

---

## What's Built

### SDK
- `@concierge/sdk` — `registerConcierge()`, deployment detection, Next.js instrumentation hook

### Backend
- Full API — Hono, Zod validation, rate limiting, API-key auth middleware
- Ingestion pipeline — OpenAPI (swagger-parser), Postman collections, PDF/HTML/MD documents, sitemap crawler, BullMQ queue/worker
- `platform_actions` normalized table — editable overrides survive re-index
- Agent runtime — RBAC, rate limiting, token budgets, model routing, agentic loop, prompt caching
- SSO role resolution — Mechanism 1 (JWT claims → group mapping) + Mechanism 2 (direct DB assignment)
- MCP server — `McpServer` + `server.tool()` API, stdio + StreamableHTTP transports
- Database migrations 001–004

### Auth
- `/auth/register`, `/auth/login`, `/auth/me`, `/auth/refresh`, `/auth/logout`
- scrypt passwords, HS256 JWTs (15 min access / 7 day refresh)
- No API key required on login screen

### Frontend
- Public landing page — hero, 7 content sections, ⌘K search
- Full dashboard — 7 pages
- Login + Register pages

---

## Not Yet Built

- Approval workflow (pause execution → notify → resume on webhook)
- Per-action rate limiting enforcement inside agentic loop (keys defined, not wired)
- Billing / usage metering
- Actual Okta/Azure AD JWT signature verification (currently trusts payload without verifying signature)
- Token refresh silent automation on frontend (manual redirect on 401 instead)
- Tests

---

## Repo Structure

```
apps/
  web/          # Next.js frontend
  api/          # Hono backend
packages/
  sdk/          # @concierge/sdk
db/             # migrations
```

## Getting Started

```bash
cp .env.example .env
docker compose up -d
npm install
npm run dev
```
