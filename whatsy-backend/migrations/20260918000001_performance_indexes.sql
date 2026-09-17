-- Enable trigram extension for ILIKE search performance
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Trigram GIN indexes for ILIKE search on student name and message content
CREATE INDEX IF NOT EXISTS idx_students_name_trgm ON students USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_messages_content_trgm ON messages USING gin (content gin_trgm_ops);

-- Partial index for unread conversations filter
CREATE INDEX IF NOT EXISTS idx_conversations_unread ON conversations (last_message_at DESC) WHERE unread_count > 0;

-- Index on messages.status for delivery status queries
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages (status) WHERE status IN ('pending', 'failed');
