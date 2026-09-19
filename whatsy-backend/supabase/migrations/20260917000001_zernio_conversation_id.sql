ALTER TABLE conversations ADD COLUMN IF NOT EXISTS zernio_conversation_id TEXT UNIQUE;
CREATE INDEX IF NOT EXISTS idx_conversations_zernio_id ON conversations(zernio_conversation_id);
