-- FrankGrant D1 Schema
-- Run: npm run db:init (local) or npm run db:init:remote (Cloudflare)

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  clerk_id    TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL,
  title       TEXT NOT NULL DEFAULT 'Untitled grant',
  mechanism   TEXT NOT NULL DEFAULT 'STTR-I',
  setup       TEXT NOT NULL DEFAULT '{}',
  sections    TEXT NOT NULL DEFAULT '{}',
  scores      TEXT NOT NULL DEFAULT '{}',
  section_summaries TEXT NOT NULL DEFAULT '{}',
  compressed_grant TEXT,
  is_resubmission INTEGER NOT NULL DEFAULT 0,
  introduction TEXT,
  study_section TEXT,
  review_status TEXT DEFAULT 'pending',
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS usage_log (
  id                      TEXT PRIMARY KEY,
  user_id                 TEXT NOT NULL,
  project_id              TEXT,
  action                  TEXT NOT NULL,
  model                   TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
  input_tokens            INTEGER NOT NULL DEFAULT 0,
  output_tokens           INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens       INTEGER NOT NULL DEFAULT 0,
  created_at              INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
