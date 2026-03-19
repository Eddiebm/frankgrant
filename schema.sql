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

-- ─── ADMIN MONITORING TABLES ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT,
  status_code INTEGER,
  error_message TEXT,
  response_time_ms INTEGER,
  user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  endpoint TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS deployments_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  worker_version TEXT,
  environment TEXT
);

CREATE TABLE IF NOT EXISTS users_meta (
  id TEXT PRIMARY KEY,
  email TEXT,
  email_domain TEXT,
  first_seen INTEGER NOT NULL DEFAULT (unixepoch()),
  last_active INTEGER NOT NULL DEFAULT (unixepoch()),
  plan_tier TEXT DEFAULT 'free',
  total_grants INTEGER DEFAULT 0,
  total_generations INTEGER DEFAULT 0,
  total_tokens_used INTEGER DEFAULT 0,
  estimated_cost_usd REAL DEFAULT 0,
  suspended INTEGER DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS mrr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  user_id TEXT,
  plan_from TEXT,
  plan_to TEXT,
  mrr_delta REAL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS batch_jobs (
  id TEXT PRIMARY KEY,
  status TEXT,
  submitted_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER,
  input_tokens INTEGER,
  output_tokens INTEGER,
  model TEXT,
  user_id TEXT,
  project_id TEXT
);

CREATE TABLE IF NOT EXISTS admin_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action_type TEXT,
  entity TEXT,
  entity_id TEXT,
  old_value TEXT,
  new_value TEXT,
  admin_user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS feedback_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  email_domain TEXT,
  feedback_type TEXT,
  message TEXT,
  page TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  resolved INTEGER DEFAULT 0,
  admin_notes TEXT
);

-- ─── ADMIN MONITORING INDEXES ──────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_status ON error_log(status_code);
CREATE INDEX IF NOT EXISTS idx_users_meta_last_active ON users_meta(last_active);
CREATE INDEX IF NOT EXISTS idx_users_meta_plan ON users_meta(plan_tier);
CREATE INDEX IF NOT EXISTS idx_feedback_resolved ON feedback_log(resolved);
CREATE INDEX IF NOT EXISTS idx_feedback_type ON feedback_log(feedback_type);

-- ─── FOA PARSER (v4.0.0) ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS foa_cache (
  foa_number TEXT PRIMARY KEY,
  rules TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  valid INTEGER DEFAULT 0,
  raw_text TEXT
);

-- Add FOA columns to projects (v4.1.0 — already applied to remote DB)
-- Run manually if needed: wrangler d1 execute frankgrant-db --remote --command "ALTER TABLE projects ADD COLUMN foa_number TEXT"
-- ALTER TABLE projects ADD COLUMN foa_number TEXT;
-- ALTER TABLE projects ADD COLUMN foa_rules TEXT;
-- ALTER TABLE projects ADD COLUMN foa_fetched_at INTEGER;
-- ALTER TABLE projects ADD COLUMN foa_valid INTEGER DEFAULT 0;

-- ─── COMPLIANCE CHECKING (v4.1.0) ───────────────────────────────────────────
-- ALTER TABLE projects ADD COLUMN compliance_results TEXT;

-- ─── NIH REPORTER REFERENCE GRANTS (v4.1.0) ─────────────────────────────────
-- ALTER TABLE projects ADD COLUMN reference_grants TEXT;

-- ─── PRELIMINARY DATA (v4.2.0) ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS preliminary_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  file_name TEXT,
  file_type TEXT,
  file_size INTEGER,
  label TEXT,
  ai_description TEXT,
  ai_narrative TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_prelim_project ON preliminary_data(project_id);

-- Run individually (catch duplicate column errors):
-- ALTER TABLE projects ADD COLUMN prelim_data_score INTEGER DEFAULT 0;
-- ALTER TABLE projects ADD COLUMN prelim_data_gaps TEXT;
-- ALTER TABLE projects ADD COLUMN prelim_data_narrative TEXT;
-- ALTER TABLE projects ADD COLUMN citation_suggestions TEXT;

-- ─── VOICE MODE (v4.4.0) ─────────────────────────────────────────────────────
-- Run individually:
ALTER TABLE users_meta ADD COLUMN voice_enabled INTEGER DEFAULT 1;
ALTER TABLE users_meta ADD COLUMN voice_tier TEXT DEFAULT null;

-- ─── PD REVIEW & ADVISORY COUNCIL (v4.5.0) ───────────────────────────────────
-- ALTER TABLE projects ADD COLUMN pd_review_results TEXT;
-- ALTER TABLE projects ADD COLUMN advisory_council_results TEXT;

-- ─── POST-REVIEW REWRITE & REFERENCE CHECK (v5.4.0) ──────────────────────────
ALTER TABLE projects ADD COLUMN rewrite_results TEXT;
ALTER TABLE projects ADD COLUMN rewrite_source TEXT;
ALTER TABLE projects ADD COLUMN rewrite_cycles_used INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN rewrite_cycles_remaining INTEGER DEFAULT 0;
ALTER TABLE projects ADD COLUMN reference_check_results TEXT;

ALTER TABLE users_meta ADD COLUMN total_submission_packages INTEGER DEFAULT 0;
ALTER TABLE users_meta ADD COLUMN package_credits INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS submission_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  purchased_at INTEGER DEFAULT (unixepoch()),
  cycles_total INTEGER DEFAULT 5,
  cycles_used INTEGER DEFAULT 0,
  cycles_remaining INTEGER DEFAULT 5,
  status TEXT DEFAULT 'active',
  amount_paid REAL DEFAULT 199.00
);

CREATE INDEX IF NOT EXISTS idx_submission_packages_user ON submission_packages(user_id);
CREATE INDEX IF NOT EXISTS idx_submission_packages_project ON submission_packages(project_id);
