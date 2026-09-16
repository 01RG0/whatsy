CREATE TABLE canned_responses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    shortcut TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    created_by UUID REFERENCES agents(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX ON canned_responses(shortcut);
