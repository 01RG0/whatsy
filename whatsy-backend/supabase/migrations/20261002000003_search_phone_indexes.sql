CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_students_phone_trgm ON students USING gin (phone gin_trgm_ops);
