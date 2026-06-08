CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_court_sessions_topic_lower
    ON court_sessions USING gin (lower(topic) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_court_sessions_case_prompt_lower
    ON court_sessions USING gin (lower((metadata ->> 'casePrompt')) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_court_sessions_id_lower
    ON court_sessions USING gin (lower(id::text) gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_court_sessions_completed_at
    ON court_sessions (completed_at DESC NULLS LAST)
    WHERE status = 'completed';
