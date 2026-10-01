-- Add tenant isolation to whatsapp_connections.
-- All existing rows are assigned to the default tenant so existing deployments
-- continue working with zero manual configuration.
ALTER TABLE whatsapp_connections ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants(id);
UPDATE whatsapp_connections SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
