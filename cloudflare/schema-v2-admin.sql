-- OAO Platform D1 Schema v2 — GLM 调用日志 / 限流 / 告警
-- Run after schema.sql:
--   npx wrangler d1 execute oao-platform --file=./schema-v2-admin.sql

CREATE TABLE IF NOT EXISTS glm_call_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet_address TEXT,
  client_ip TEXT NOT NULL DEFAULT 'unknown',
  source TEXT NOT NULL DEFAULT 'glm_chat',
  success INTEGER NOT NULL DEFAULT 1,
  input_chars INTEGER NOT NULL DEFAULT 0,
  output_chars INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  identifier TEXT NOT NULL,
  identifier_type TEXT NOT NULL,
  reason TEXT NOT NULL,
  endpoint TEXT,
  meta_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS platform_alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT NOT NULL DEFAULT 'warning',
  message TEXT NOT NULL,
  metric_value INTEGER,
  threshold INTEGER,
  acknowledged INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_glm_call_logs_created ON glm_call_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_glm_call_logs_wallet ON glm_call_logs(wallet_address);
CREATE INDEX IF NOT EXISTS idx_glm_call_logs_ip ON glm_call_logs(client_ip);
CREATE INDEX IF NOT EXISTS idx_glm_call_logs_source ON glm_call_logs(source);
CREATE INDEX IF NOT EXISTS idx_rate_limit_events_created ON rate_limit_events(created_at);
CREATE INDEX IF NOT EXISTS idx_platform_alerts_created ON platform_alerts(created_at);
