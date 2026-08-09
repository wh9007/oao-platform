-- OAO Platform D1 Schema
-- Run: npx wrangler d1 execute oao-platform --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT NOT NULL UNIQUE,
  ens_name TEXT,
  auth_method TEXT NOT NULL DEFAULT 'wallet',
  login_count INTEGER NOT NULL DEFAULT 0,
  first_login_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL,
  is_blocked INTEGER NOT NULL DEFAULT 0,
  blocked_reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  wallet_address TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  duration_sec INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'glm',
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS translate_usage (
  user_id INTEGER PRIMARY KEY,
  wallet_address TEXT NOT NULL UNIQUE,
  translate_count INTEGER NOT NULL DEFAULT 0,
  char_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  wallet_address TEXT,
  action TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login_at);
CREATE INDEX IF NOT EXISTS idx_users_blocked ON users(is_blocked);
CREATE INDEX IF NOT EXISTS idx_meeting_records_user ON meeting_records(user_id);
CREATE INDEX IF NOT EXISTS idx_meeting_records_created ON meeting_records(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_created ON usage_events(created_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_action ON usage_events(action);
