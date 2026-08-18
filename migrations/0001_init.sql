-- LINE harness core schema
CREATE TABLE friends (
  id TEXT PRIMARY KEY,
  line_user_id TEXT NOT NULL UNIQUE,
  display_name TEXT,
  picture_url TEXT,
  status_message TEXT,
  is_following INTEGER NOT NULL DEFAULT 1,
  followed_at TEXT,
  unfollowed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE friend_tags (
  friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (friend_id, tag_id)
);

CREATE TABLE messages_log (
  id TEXT PRIMARY KEY,
  friend_id TEXT REFERENCES friends(id),
  direction TEXT NOT NULL CHECK (direction IN ('in', 'out')),
  message_type TEXT NOT NULL,
  content TEXT,
  line_message_id TEXT,
  broadcast_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_messages_log_friend ON messages_log(friend_id, created_at);

CREATE TABLE auto_replies (
  id TEXT PRIMARY KEY,
  keyword TEXT NOT NULL,
  match_type TEXT NOT NULL DEFAULT 'contains' CHECK (match_type IN ('exact', 'contains')),
  reply_text TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE broadcasts (
  id TEXT PRIMARY KEY,
  title TEXT,
  message_text TEXT NOT NULL,
  tag_id TEXT REFERENCES tags(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'failed')),
  sent_count INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
