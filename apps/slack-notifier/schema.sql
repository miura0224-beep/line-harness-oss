CREATE TABLE IF NOT EXISTS bridge_slack_deliveries (
 event_key TEXT PRIMARY KEY,
 payload TEXT,
 status TEXT NOT NULL DEFAULT 'pending',
 attempts INTEGER NOT NULL DEFAULT 0,
 next_attempt INTEGER NOT NULL DEFAULT 0,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bridge_slack_pending ON bridge_slack_deliveries(status,next_attempt);
