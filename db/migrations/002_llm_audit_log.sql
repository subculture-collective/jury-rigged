CREATE TABLE IF NOT EXISTS llm_audit_logs (
  id UUID PRIMARY KEY,
  session_id UUID REFERENCES court_sessions(id) ON DELETE CASCADE,
  turn_id UUID,
  phase TEXT NOT NULL,
  speaker TEXT NOT NULL,
  role TEXT NOT NULL,
  source TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('mock', 'succeeded', 'failed', 'fallback')),
  prompt_hash TEXT NOT NULL,
  response_hash TEXT,
  prompt_chars INTEGER NOT NULL,
  response_chars INTEGER,
  prompt_tokens_estimate INTEGER,
  response_tokens_estimate INTEGER,
  latency_ms INTEGER NOT NULL,
  error_code TEXT,
  error_message TEXT,
  body_persisted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS llm_audit_bodies (
  audit_id UUID PRIMARY KEY REFERENCES llm_audit_logs(id) ON DELETE CASCADE,
  messages_json JSONB NOT NULL,
  raw_response TEXT,
  sanitized_response TEXT
);

CREATE INDEX IF NOT EXISTS idx_llm_audit_session_created ON llm_audit_logs (session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_audit_created ON llm_audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_llm_audit_status ON llm_audit_logs (status);
CREATE INDEX IF NOT EXISTS idx_llm_audit_model ON llm_audit_logs (model);
