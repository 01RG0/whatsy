-- Media cache: stores inbound WhatsApp media (voice notes, images, video)
-- downloaded immediately on webhook arrival so they survive Meta CDN expiry.
CREATE TABLE IF NOT EXISTS media_cache (
    url_hash     TEXT        PRIMARY KEY,
    original_url TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    mime_type    TEXT        NOT NULL DEFAULT 'application/octet-stream',
    cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for potential future TTL-based eviction jobs.
CREATE INDEX IF NOT EXISTS media_cache_cached_at_idx ON media_cache(cached_at);
