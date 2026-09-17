ALTER TABLE messages
    ADD COLUMN IF NOT EXISTS sent_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_sent_by_agent_id ON messages(sent_by_agent_id);