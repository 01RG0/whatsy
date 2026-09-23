CREATE TABLE IF NOT EXISTS sticker_cache (
    url_hash     TEXT        PRIMARY KEY,
    original_url TEXT        NOT NULL,
    data         BYTEA       NOT NULL,
    mime_type    TEXT        NOT NULL DEFAULT 'image/webp',
    cached_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
