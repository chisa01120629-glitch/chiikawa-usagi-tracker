CREATE TABLE IF NOT EXISTS item_state (
  id TEXT PRIMARY KEY,
  owned INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS custom_items (
  id TEXT PRIMARY KEY,
  pref_code TEXT NOT NULL,
  motif TEXT NOT NULL,
  owned INTEGER NOT NULL DEFAULT 0,
  memo TEXT NOT NULL DEFAULT '',
  photo_key TEXT,
  ref_link TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
