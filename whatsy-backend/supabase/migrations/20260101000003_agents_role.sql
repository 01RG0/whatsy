-- Existing installations created before role was added to the initial schema
-- need this column for authentication and agent profile endpoints.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT '';
