CREATE TABLE IF NOT EXISTS whatsapp_connections (
    id               BIGSERIAL PRIMARY KEY,
    status           TEXT NOT NULL DEFAULT 'disconnected',
    phone_number_id  TEXT UNIQUE,
    access_token     TEXT,
    phone_number     TEXT NOT NULL DEFAULT '',
    display_name     TEXT NOT NULL DEFAULT '',
    connected_at     TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS whatsapp_webhooks (
    id         BIGSERIAL PRIMARY KEY,
    url        TEXT UNIQUE NOT NULL,
    secret     TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
