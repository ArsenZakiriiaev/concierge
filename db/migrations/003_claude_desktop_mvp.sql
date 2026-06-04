ALTER TABLE platforms
  ADD COLUMN IF NOT EXISTS api_key_hash TEXT,
  ADD COLUMN IF NOT EXISTS openapi_url TEXT,
  ADD COLUMN IF NOT EXISTS website TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS platforms_api_key_hash_idx
  ON platforms(api_key_hash)
  WHERE api_key_hash IS NOT NULL;

ALTER TABLE delegated_tokens
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE interactions
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS content_hash TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

CREATE UNIQUE INDEX IF NOT EXISTS chunks_platform_type_hash_idx
  ON chunks(platform_id, chunk_type, content_hash)
  WHERE content_hash IS NOT NULL;
