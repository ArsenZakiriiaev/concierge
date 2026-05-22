-- Post-MVP: outcome-weighted retrieval (data moat layer 1)
CREATE TABLE chunk_metrics (
  chunk_id     UUID REFERENCES chunks(id) ON DELETE CASCADE,
  intent_type  TEXT,
  attempts     INT DEFAULT 0,
  successes    INT DEFAULT 0,
  success_rate FLOAT GENERATED ALWAYS AS
    (successes::float / NULLIF(attempts, 0)) STORED,
  PRIMARY KEY (chunk_id, intent_type)
);
