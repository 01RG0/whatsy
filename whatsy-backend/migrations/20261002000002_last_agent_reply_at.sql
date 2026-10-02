ALTER TABLE conversations ADD COLUMN IF NOT EXISTS last_agent_reply_at TIMESTAMPTZ;
