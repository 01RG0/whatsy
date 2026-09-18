-- Add session_version to agents so each new login invalidates previous sessions.
-- Existing tokens have sv=0 (Go zero-value for missing claim) and existing rows
-- default to 0, so current sessions are not disrupted by this migration.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS session_version BIGINT NOT NULL DEFAULT 0;
