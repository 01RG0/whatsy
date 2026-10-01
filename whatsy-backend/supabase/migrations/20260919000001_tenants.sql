CREATE TABLE IF NOT EXISTS tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), owner_id UUID
);
ALTER TABLE agents ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE students ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE whatsapp_connections ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE auto_reply_rules ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE broadcasts ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
ALTER TABLE tags ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'canned_responses') THEN
        ALTER TABLE canned_responses ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
    END IF;
END $$;
INSERT INTO tenants (id, name, slug) VALUES ('00000000-0000-0000-0000-000000000001', 'Default Workspace', 'default') ON CONFLICT (id) DO NOTHING;
UPDATE agents SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE students SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE conversations SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE whatsapp_connections SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE auto_reply_rules SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE broadcasts SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
UPDATE tags SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'canned_responses') THEN
        UPDATE canned_responses SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
    END IF;
END $$;
UPDATE tenants SET owner_id = (SELECT id FROM agents ORDER BY created_at ASC LIMIT 1) WHERE id = '00000000-0000-0000-0000-000000000001' AND owner_id IS NULL;
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'tenants' AND constraint_name = 'tenants_owner_id_fkey') THEN
        ALTER TABLE tenants ADD CONSTRAINT tenants_owner_id_fkey FOREIGN KEY (owner_id) REFERENCES agents(id) ON DELETE SET NULL;
    END IF;
END $$;
DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.table_constraints WHERE table_name = 'agents' AND constraint_name = 'agents_email_key') THEN
        ALTER TABLE agents DROP CONSTRAINT agents_email_key;
    END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS agents_tenant_email_uniq ON agents (tenant_id, email);
CREATE TABLE IF NOT EXISTS agent_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'agent', token TEXT UNIQUE NOT NULL,
    invited_by UUID REFERENCES agents(id) ON DELETE SET NULL, expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    accepted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS agent_invites_token_idx ON agent_invites (token) WHERE accepted_at IS NULL;
