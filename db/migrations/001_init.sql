CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE platforms (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain          TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  permissions     TEXT[],
  requires_approval TEXT[],
  visibility      TEXT DEFAULT 'public',
  company_id      UUID,
  revshare_bps    INT DEFAULT 0,
  status          TEXT DEFAULT 'active',
  openapi_hash    TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_id UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  url         TEXT,
  content     TEXT,
  embedding   vector(1536),
  chunk_type  TEXT CHECK (chunk_type IN ('openapi', 'docs')),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON chunks USING ivfflat (embedding vector_cosine_ops);

CREATE TABLE delegated_tokens (
  user_id      UUID NOT NULL,
  platform_id  UUID NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
  ciphertext   BYTEA NOT NULL,
  expires_at   TIMESTAMPTZ,
  PRIMARY KEY (user_id, platform_id)
);

CREATE TABLE interactions (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL,
  platform_id      UUID NOT NULL REFERENCES platforms(id),
  assistant        TEXT NOT NULL,
  intent           TEXT NOT NULL,
  intent_type      TEXT,
  status           TEXT CHECK (status IN ('pending','complete','awaiting_approval','incomplete','failed')),
  result           JSONB,
  value_moved      DECIMAL,
  completed_steps  TEXT[],
  pending_steps    TEXT[],
  metadata         JSONB,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON interactions (user_id, platform_id, status);
CREATE INDEX ON interactions (updated_at DESC);
