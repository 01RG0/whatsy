CREATE TABLE auto_reply_rules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trigger TEXT NOT NULL,
    trigger_type TEXT NOT NULL DEFAULT 'keyword',
    response TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    priority INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX ON auto_reply_rules(is_active, priority);
INSERT INTO auto_reply_rules (trigger, response, priority) VALUES ('/deadline', 'Please check with your teacher for deadline info.', 1), ('/zoom', 'Zoom link will be sent 30 minutes before class.', 2);