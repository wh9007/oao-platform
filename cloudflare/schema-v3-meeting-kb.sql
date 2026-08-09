-- OAO Platform D1 Schema v3 — 会议知识库归档字段
-- Run: npx wrangler d1 execute oao-platform --file=./schema-v3-meeting-kb.sql

ALTER TABLE meeting_records ADD COLUMN kb_archived INTEGER NOT NULL DEFAULT 0;
ALTER TABLE meeting_records ADD COLUMN kb_doc_title TEXT;
ALTER TABLE meeting_records ADD COLUMN meeting_id TEXT;
