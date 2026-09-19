-- Workspace settings: per-tenant key/value feature flags and preferences.
CREATE TABLE IF NOT EXISTS workspace_settings (
    tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    key        TEXT        NOT NULL,
    value      TEXT        NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (tenant_id, key)
);

-- Seed default settings for the default tenant so GET /v1/settings
-- always returns a complete object even before any admin saves.
INSERT INTO workspace_settings (tenant_id, key, value)
VALUES
    ('00000000-0000-0000-0000-000000000001', 'interactive_messages_enabled', 'false'),
    ('00000000-0000-0000-0000-000000000001', 'canned_responses_enabled',     'true'),
    ('00000000-0000-0000-0000-000000000001', 'auto_reply_enabled',           'true'),
    ('00000000-0000-0000-0000-000000000001', 'typing_indicators_enabled',    'true')
ON CONFLICT (tenant_id, key) DO NOTHING;
