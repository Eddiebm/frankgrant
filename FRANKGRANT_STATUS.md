# FrankGrant Status Document

**Last Updated:** 2026-03-18
**Version:** 4.1.0
**Status:** Production (Internal COARE Tool)

---

## 🌐 Live Deployment

| Resource | URL/ID | Status |
|----------|--------|--------|
| **Frontend (Pages)** | https://frankgrant.pages.dev | ✅ Live |
| **Latest Preview** | https://c445f032.frankgrant.pages.dev | ✅ Live |
| **API Worker** | https://frankgrant-worker.eddie-781pagesdev.workers.dev | ✅ Live |
| **D1 Database** | frankgrant-db | ✅ Live |
| **D1 Database ID** | 728339df-7875-4fb7-a58b-196cd8099e22 | — |
| **KV Namespace** | frankgrant-KV | ✅ Live |
| **KV Namespace ID** | 9c6b57ffb4b8435aa323195d39b4b732 | — |
| **GitHub Repo** | https://github.com/Eddiebm/frankgrant | ✅ Live |

---

## ✅ Features: Built & Deployed

### **Core Grant Writing**
- ✅ **Grant Wizard** - Single-textarea study description → auto-extract fields → sequential section generation
- ✅ **Professor Persona** - Elite university (Harvard/Stanford) writing voice with no hedge words, active voice, hypothesis-driven
- ✅ **Manual Grant Editor** - Full editor with 9 section types (Project Summary, Project Narrative, Aims, Significance, Innovation, Approach, Data Management Plan, Facilities, Commercialization)
- ✅ **Auto-scoring** - Sections scored immediately after generation using Haiku
- ✅ **Setup Persistence** - Project setup fields (PI, disease, biology, aims, etc.) saved to D1

### **AI Personas (Created, Not All Wired to UI)**
- ✅ **Professor** - Writing persona for all sections
- ✅ **Program Director** - 30-year NIH PD providing fundability advice (persona ready, UI button pending)
- ✅ **Study Section (3 reviewers)** - Basic scientist, translational/clinical, methodologist (personas ready, UI pending)
- ✅ **Advisory Council** - Final funding recommendation (persona ready, UI pending)
- ✅ **Biosketch Generator** - NIH SF424 format

### **NIH Compliance**
- ✅ **Mechanism Support** - STTR-I/II, SBIR-I/II, FAST-TRACK, NCI-IIB, R21, R01, K99
- ✅ **Correct Page Limits** - SBIR/STTR Phase I: 6-page Research Strategy + 2-page Commercialization Potential; Phase II: 12-page + 12-page Commercialization Plan; R01: 12-page; R21: 6-page
- ✅ **Phase-Aware Prompts** - Generation prompts distinguish Phase I feasibility from Phase II full development
- ✅ **STTR Partner Requirements** - 40% minimum work to research institution (Phase I), 30% (Phase II)
- ✅ **Institute Rules** - NCI, NIGMS, NHLBI, NICHD, NIA with budget caps and paylines
- ✅ **Page Limit Tracking** - Live word count, page estimates, compliance bars
- ✅ **Institute Selector** - Shows budget guidance, paylines, priorities per institute

### **Grant Scoring**
- ✅ **Upload & Score** - PDF/DOCX upload with text extraction
- ✅ **Research Strategy Scoring** - 5 NIH criteria (Significance, Innovation, Approach, Investigators, Environment)
- ✅ **Commercialization Scoring** - 6 criteria (Market, IP, Regulatory, Revenue, Team, Phase II)
- ✅ **Criterion-level scores** - Strengths, weaknesses, priority revisions, reviewer narrative

### **Token Efficiency (v2.1)**
- ✅ **Model Tiering** - Haiku for extraction/scoring, Sonnet for writing
- ✅ **Prompt Caching** - 90% discount on cached persona prompts
- ✅ **Grant Compression** - 1,500-word summaries for efficient review
- ✅ **Progressive Section Summaries** - 200-word summaries reduce context size
- ✅ **Usage Metering** - Real-time monthly cost tracking
- ✅ **Budget Enforcement** - Per-tier monthly limits ($15 individual, $40 lab)
- ✅ **Local Computation** - Word count, page estimates, compliance checks (no AI)
- ✅ **Optimized max_tokens** - 300-2500 based on feature complexity

### **User Features**
- ✅ **Project Management** - Create, list, open, save, delete projects
- ✅ **Authentication** - Clerk with JWKS-based JWT verification
- ✅ **Usage Dashboard** - Monthly cost breakdown by model
- ✅ **Error Boundary** - Graceful error handling with reload button
- ✅ **Auto-save** - Projects save on blur with save state indicator
- ✅ **Feedback System** - Floating button on all pages for bug reports, feature requests, general feedback

### **Export**
- ✅ **Copy to Clipboard** - Individual sections or full grant
- ✅ **Download .txt** - Full grant text export

### **Admin Command Station (v3.0.0)**
- ✅ **Platform Health Panel** - Error rate, API latency, Claude errors, D1 row counts, rate limit hits, recent errors, deployment history
- ✅ **User Management Panel** - User registry with email domain, plan tier, activity tracking, suspension controls, per-user drawer with full history
- ✅ **Revenue Operations Panel** - MRR waterfall (new/expansion/contraction/churn), tier breakdown (individual/lab/institution), all MRR events log
- ✅ **AI Cost Monitoring Panel** - Today/month spend, cost by feature, cost by model, top 20 users by cost
- ✅ **Grant Intelligence Panel** - Mechanism popularity, total projects, projects with sections
- ✅ **Product Health Panel** - Feature usage stats (total/7d/30d/unique users)
- ✅ **Security & Compliance Panel** - Failed auth attempts, suspended users list, admin actions log, unusual activity detection (>50 calls/day)
- ✅ **Feedback Management Panel** - All feedback with type badges, resolved status, admin notes, mark resolved button
- ✅ **Tab Navigation** - 9-tab interface with Overview summary panel
- ✅ **Admin Gating** - Command Station only accessible to eddieb@coareholdings.com

---

## ⏳ Features: Pending Implementation

### **High Priority**
- ⏳ **Polish Button** - Rewrite sections with Professor persona (persona exists, UI button needed)
- ⏳ **PD Review Button** - Get Program Director feedback (persona exists, UI button needed)
- ⏳ **Study Section Button** - Full 3-reviewer panel simulation (personas exist, UI integration needed)
- ⏳ **Advisory Council Button** - Council funding recommendation (persona exists, UI button needed)
- ✅ **Compliance Checker** - Inline per-section AI compliance check with severity levels (v4.1.0)
- ⏳ **DOCX Export** - Properly formatted with Georgia 11pt, 0.5" margins
- ⏳ **PDF Preview** - In-browser rendering with NIH formatting

### **Medium Priority**
- ⏳ **Resubmission Mode** - Introduction section, track changes, reviewer response import
- ⏳ **Multi-Reviewer Independence** - 3 separate API calls for genuine independence
- ⏳ **Additional Sections**:
  - Human Subjects
  - Vertebrate Animals
  - Cover Letter to SRO
- ⏳ **Letters Generator** - 12 letter types:
  - Collaborator support letters
  - Consultant letters
  - Subaward/subcontract letters
  - STTR research institution partner letter
  - IRB/IACUC approval letters
  - Key personnel commitment letters
  - Resource sharing agreements
  - Commercial partner letters
  - Cover letter to Scientific Review Officer
  - Resubmission introduction

### **Lower Priority**
- ⏳ **FOA/NOFO Analyzer** - Parse funding opportunities, analyze fit
- ⏳ **Batch API Support** - Deep Review mode with 50% cost savings (24-hour latency)
- ⏳ **Mobile Responsive** - Full optimization for 375px width
- ⏳ **Retry Logic** - API call retry with exponential backoff
- ⏳ **Loading Skeletons** - Animated loading states
- ⏳ **Input Sanitization** - D1 insert protection
- ⏳ **Clerk Backend SDK** - Replace hand-rolled JWT with official SDK
- ⏳ **Project Limit (20 max)** - Enforcement per user
- ⏳ **Commercial Scorer Panel** - BD exec, FDA strategist, VC (3 reviewers for commercialization)

---

## 🗄️ Database Schema

### **Tables**

#### **users**
```sql
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  clerk_id    TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'free',
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### **projects**
```sql
CREATE TABLE IF NOT EXISTS projects (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL,
  title             TEXT NOT NULL DEFAULT 'Untitled grant',
  mechanism         TEXT NOT NULL DEFAULT 'STTR-I',
  setup             TEXT NOT NULL DEFAULT '{}',
  sections          TEXT NOT NULL DEFAULT '{}',
  scores            TEXT NOT NULL DEFAULT '{}',
  section_summaries TEXT NOT NULL DEFAULT '{}',
  compressed_grant  TEXT,
  is_resubmission   INTEGER NOT NULL DEFAULT 0,
  introduction      TEXT,
  study_section     TEXT,
  review_status     TEXT DEFAULT 'pending',
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id)
);
```

#### **usage_log**
```sql
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
```

#### **error_log**
```sql
CREATE TABLE IF NOT EXISTS error_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  endpoint TEXT,
  status_code INTEGER,
  error_message TEXT,
  response_time_ms INTEGER,
  user_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### **rate_limit_log**
```sql
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  endpoint TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### **deployments_log**
```sql
CREATE TABLE IF NOT EXISTS deployments_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at INTEGER NOT NULL DEFAULT (unixepoch()),
  worker_version TEXT,
  environment TEXT
);
```

#### **users_meta**
```sql
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
```

#### **mrr_events**
```sql
CREATE TABLE IF NOT EXISTS mrr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT,
  user_id TEXT,
  plan_from TEXT,
  plan_to TEXT,
  mrr_delta REAL,
  recorded_at INTEGER NOT NULL DEFAULT (unixepoch())
);
```

#### **batch_jobs**
```sql
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
```

#### **admin_actions**
```sql
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
```

#### **feedback_log**
```sql
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
```

#### **foa_cache** (v4.0.0)
```sql
CREATE TABLE IF NOT EXISTS foa_cache (
  foa_number TEXT PRIMARY KEY,
  rules TEXT,
  fetched_at INTEGER NOT NULL DEFAULT (unixepoch()),
  valid INTEGER DEFAULT 0,
  raw_text TEXT
);
```

**Note:** Schema also includes future columns for FOA Parser, Compliance Checking, and NIH Reporter features (see schema.sql for commented ALTER TABLE statements). These columns are prepared but not yet actively used in v4.0.0.

#### **Indexes**
```sql
CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_user ON usage_log(user_id);
CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
```

---

## 🔌 API Routes (Worker)

### **Authentication**
All routes except `OPTIONS` require Bearer token in `Authorization` header.

### **AI Proxy**
- **POST** `/api/ai`
  - Proxy to Anthropic API
  - Enforces model whitelist, max_tokens limits, and monthly budget
  - Logs usage with model and feature tracking
  - Returns Claude API response

### **Projects**
- **GET** `/api/projects` - List user's projects (id, title, mechanism, timestamps)
- **POST** `/api/projects` - Create new project
- **GET** `/api/projects/:id` - Get project with all fields
- **PUT** `/api/projects/:id` - Update project
- **DELETE** `/api/projects/:id` - Delete project

### **Usage**
- **GET** `/api/usage`
  - Returns monthly cost breakdown by model
  - Shows tier limit and percentage used
  - Returns all-time totals
  - Includes cache token statistics

### **Health & Feedback**
- **GET** `/api/health` - Public health check (no auth)
- **POST** `/api/feedback` - Submit feedback (auth required)

### **Admin Command Station Routes (Admin Only)**
- **GET** `/api/command/health` - Platform health metrics
- **GET** `/api/command/users` - User management data
- **PATCH** `/api/command/users/:id` - Update user (suspend, tier, notes)
- **GET** `/api/command/revenue` - Revenue metrics
- **GET** `/api/command/mrr-events` - MRR events log
- **POST** `/api/command/mrr-events` - Create MRR event
- **GET** `/api/command/ai-costs` - AI cost analytics
- **GET** `/api/command/grants` - Grant intelligence metrics
- **GET** `/api/command/product` - Product health metrics
- **GET** `/api/command/security` - Security audit log
- **GET** `/api/command/feedback` - All feedback
- **PATCH** `/api/command/feedback/:id` - Update feedback
- **POST** `/api/command/feedback/cluster` - Cluster feature requests with AI

### **CORS**
- **OPTIONS** `*` - CORS preflight (204 response)

---

## 🔐 Environment Variables

### **Frontend (.env.local)**
```bash
VITE_CLERK_PUBLISHABLE_KEY=pk_test_bW9kZXJuLXRvbWNhdC0yMy5jbGVyay5hY2NvdW50cy5kZXYk
VITE_WORKER_URL=https://frankgrant-worker.eddie-781pagesdev.workers.dev/api
```

### **Worker (Wrangler Secrets)**
Set via `npx wrangler secret put SECRET_NAME`:

```bash
ANTHROPIC_API_KEY=sk-ant-api03-...
CLERK_SECRET_KEY=sk_test_...
```

**Note:** `CLERK_PEM_PUBLIC_KEY` is NO LONGER NEEDED (now using JWKS)

### **Worker Config (wrangler.toml)**
```toml
name = "frankgrant-worker"
main = "workers/api.js"
compatibility_date = "2024-11-01"
compatibility_flags = ["nodejs_compat"]

[vars]
ENVIRONMENT = "production"
WORKER_VERSION = "4.0.0"

[[d1_databases]]
binding = "DB"
database_name = "frankgrant-db"
database_id = "728339df-7875-4fb7-a58b-196cd8099e22"

[[kv_namespaces]]
binding = "KV"
id = "9c6b57ffb4b8435aa323195d39b4b732"

[dev]
port = 8787
```

---

## 📦 Dependencies

### **Frontend**
```json
{
  "@clerk/clerk-react": "^5.0.0",
  "react": "^18.3.0",
  "react-dom": "^18.3.0",
  "mammoth": "^1.x",
  "docx": "^8.x"
}
```

### **Worker**
No npm dependencies (uses Cloudflare runtime APIs)

---

## 🚀 Deployment Commands

### **Full Deployment (Worker + Frontend)**
```bash
# 1. Build frontend
npm run build

# 2. Deploy worker
npx wrangler deploy

# 3. Deploy frontend
npx wrangler pages deploy dist --project-name frankgrant --commit-dirty=true

# OR: Combined
npm run build && npx wrangler deploy && npm run deploy
```

### **Database Migrations**
```bash
# Local
npm run db:init

# Remote (production)
npm run db:init:remote

# Manual migration
npx wrangler d1 execute frankgrant-db --remote --command "ALTER TABLE ..."
```

### **Secrets Management**
```bash
# Set secrets
npx wrangler secret put ANTHROPIC_API_KEY
npx wrangler secret put CLERK_SECRET_KEY

# List secrets
npx wrangler secret list
```

### **Local Development**
```bash
# Terminal 1: Worker (with local D1)
npm run worker:dev

# Terminal 2: Frontend (proxies to localhost:8787)
npm run dev

# Visit: http://localhost:5173
```

---

## 💰 Token Pricing & Limits

### **Model Pricing (per 1M tokens)**
| Model | Input | Output |
|-------|-------|--------|
| Sonnet 4 | $3.00 | $15.00 |
| Haiku 4.5 | $0.25 | $1.25 |

### **Prompt Caching**
- Cache creation: Same as input price
- Cache read: 90% discount (10% of input price)

### **Tier Limits (Monthly)**
| Tier | Limit | Typical Usage |
|------|-------|---------------|
| Individual | $15 | ~80 full grants |
| Lab | $40 | ~200 full grants |
| Unlimited | ∞ | No limit |

---

## 📊 Feature-Specific Token Allocations

| Feature | Model | Max Tokens | Typical Use |
|---------|-------|-----------|-------------|
| extract_study | Haiku | 300 | Study description parsing |
| compress_grant | Haiku | 2000 | Grant compression |
| section_summary | Haiku | 200 | Progressive summaries |
| compliance | Haiku | 500 | Compliance checking |
| letter | Haiku | 800 | Support letters |
| score_section | Haiku | 600 | Section scoring |
| pd_review | Sonnet | 1000 | PD memo |
| write_summary | Sonnet | 800 | Project Summary |
| write_narrative | Sonnet | 300 | Project Narrative |
| write_aims | Sonnet | 1200 | Specific Aims |
| write_sig | Sonnet | 1000 | Significance |
| write_innov | Sonnet | 1000 | Innovation |
| write_approach | Sonnet | 2500 | Approach (largest) |
| write_data_mgmt | Sonnet | 1000 | Data Management Plan |
| write_facilities | Sonnet | 800 | Facilities |
| write_commercial | Sonnet | 800-1500 | Commercialization (phase-aware) |
| reviewer_critique | Sonnet | 1000 | Reviewer feedback |
| summary_statement | Sonnet | 1500 | NIH summary |
| advisory_council | Sonnet | 800 | Council memo |
| biosketch | Sonnet | 1500 | Biosketch generation |
| polish | Sonnet | 1000 | Section polishing |

---

## 🏗️ Architecture

### **Frontend (React + Vite)**
- **Framework:** React 18.3
- **Build:** Vite 5.4
- **Deployment:** Cloudflare Pages
- **Auth:** Clerk (hash routing)
- **Bundle:** 788.71 KB (217.99 KB gzipped)

### **Backend (Cloudflare Workers)**
- **Runtime:** Cloudflare Workers (V8 isolates)
- **Database:** D1 (SQLite) - 11 tables
- **Cache:** KV (rate limiting)
- **AI:** Anthropic Claude via proxy
- **Auth:** JWKS-based JWT verification
- **Admin Access:** Email-based gating (eddieb@coareholdings.com)

### **Data Flow**
```
User → Clerk Auth → React App → Worker API → Anthropic API
                                ↓
                           D1 Database (projects, usage)
                                ↓
                           KV Store (rate limits)
```

---

## 🐛 Known Issues

1. **Bundle Size:** 813 KB (increased from 789 KB with Command Station - should be code-split)
2. **Mobile Layout:** Not fully responsive below 600px
3. **Study Section UI:** Personas created but not wired to UI
4. **DOCX Export:** Package installed but not implemented
5. **Compliance Checker:** Logic ready but no UI component
6. **Deployment Logging:** deployments_log table exists but not auto-populated on Worker startup
7. **Batch API Integration:** batch_jobs table exists but Batch API routes not implemented

---

## 📝 Recent Changes

### **v4.1.0 (2026-03-18) - FOA Parser, NIH Reporter Search, Inline Compliance**

#### **Added**
- ✅ **FOA Parser** — Enter FOA/RFA number in project setup, auto-fetches NIH page, extracts rules via Haiku. Shows confirmation card (title, institute, due dates, page limits, budget, top priorities). Falls back gracefully if FOA not found. Caches results in D1 `foa_cache` table for 24 hours.
- ✅ **NIH Reporter Grant Search** — "🔍 Grants" toolbar button opens 380px right-side drawer. Search funded NIH grants by keyword pre-populated from disease field. Results show PI, institution, award amount, fiscal year, truncated abstract with Read More. "Use as Reference" analyzes abstract with Haiku, saves analysis to project (max 5).
- ✅ **Reference Grant Context** — When reference grants are saved, Significance/Innovation/Approach prompts automatically include analysis patterns (framing, terminology, reviewer signals) without copying content.
- ✅ **Inline Compliance Checking** — After every section generation, non-blocking Haiku compliance check runs server-side via `ctx.waitUntil()`. Frontend polls `GET /api/projects/:id/compliance` every 4s (max 10 polls). CompliancePanel shows below each section: 🔴 critical / 🟡 warning / 💡 suggestion rows with element, description, fix. Re-check button triggers fresh check.
- ✅ **New Worker Routes** — `POST /api/foa/parse`, `POST /api/search/grants`, `POST /api/search/analyze-grant`, `POST /api/search/save-reference`, `GET /api/projects/:id/compliance`
- ✅ **New DB Columns** — `projects.foa_number`, `projects.foa_rules`, `projects.foa_fetched_at`, `projects.foa_valid`, `projects.reference_grants`, `projects.compliance_results`

#### **Changed**
- Worker updated to v4.1.0, `ctx` added to fetch handler for `waitUntil` support
- Project CRUD handlers updated to read/write all new columns
- `useApi.js` extended with `parseFOA`, `searchGrants`, `analyzeGrant`, `saveReference`, `getCompliance`
- `src/lib/foa_parser.js` created with `extractFOASections`, `FOA_EXTRACTION_PROMPT`, `validateFOARules`

### **v4.0.0 (2026-03-18) - NIH Compliance Overhaul**

#### **Added**
- ✅ **Data Management and Sharing Plan** - Required 2-page section per NIH 2023 policy
  - 6 required elements: Data Types, Tools/Software, Standards, Preservation, Access/Distribution, Oversight
  - Phase-aware prompts for SBIR/STTR (IP protection considerations)
- ✅ **Project Summary/Abstract** - Required section with 30-line limit (~400 words)
  - 5-paragraph structure: Problem, Hypothesis, Aims, Outcomes, Impact
- ✅ **Project Narrative** - Required 2-3 sentence summary (~60 words)
  - Format: Health problem, research solution, beneficiaries
- ✅ **FOA Cache Table** - Schema preparation for FOA Parser (table created, parser not yet implemented)

#### **Fixed**
- ✅ **NIH Page Limits** - Corrected all mechanism page limits to match actual NIH requirements:
  - SBIR/STTR Phase I: 6-page Research Strategy + 2-page Commercialization **Potential** (not Plan)
  - SBIR/STTR Phase II: 12-page Research Strategy + 12-page Commercialization **Plan**
  - R01: 12-page Research Strategy, no commercialization
  - R21: 6-page Research Strategy, no commercialization
  - Fast Track: Separate 6-page Phase I + 12-page Phase II Research Strategies with Go/No-Go milestones
- ✅ **Phase-Aware Commercialization** - Generation prompts now distinguish:
  - Phase I "Commercialization Potential": Brief 2-page feasibility assessment (4 paragraphs, ~550 words)
  - Phase II "Commercialization Plan": Full 12-page business plan (7 subsections, ~3,300 words)
- ✅ **STTR Partner Requirements** - Added work allocation requirements:
  - Phase I: 40% minimum work to research institution partner
  - Phase II: 30% minimum work to research institution partner

#### **Changed**
- Updated MECHANISMS object in nih.js with correct page limits and phase-specific fields
- Updated all generation prompts to be phase-aware (commercial, aims, approach)
- Added getProjectRules() helper for FOA rule fallback logic
- Added getCommercialLabel() helper for dynamic section naming
- Updated SECTIONS array to include summary, narrative, data_mgmt
- Updated GrantEditor.jsx compliance tracking for new sections

#### **Schema Prep (Not Implemented)**
- Created foa_cache table for future FOA Parser
- Documented ALTER TABLE statements for:
  - FOA columns: foa_number, foa_rules, foa_fetched_at, foa_valid
  - Compliance column: compliance_results
  - NIH Reporter column: reference_grants

### **v3.0.0 (2026-03-18)**

### **Added (v3.0.0)**
- Complete Admin Command Station with 8 monitoring panels
- Platform Health: error rate, latency, Claude errors, deployment logs
- User Management: user registry, suspension, tier controls
- Revenue Operations: MRR waterfall, tier breakdown
- AI Cost Monitoring: cost by feature/model/user
- Grant Intelligence: mechanism popularity, analytics
- Product Health: feature usage, drop-off analysis
- Security: failed auth, admin actions, unusual activity
- Feedback Management: user feedback with AI clustering
- 8 new D1 tables for monitoring and analytics
- Request logging middleware with response time tracking
- users_meta auto-upsert on every authenticated request
- Suspended user checking
- Rate limit logging
- FeedbackButton floating component on all pages
- Public health check endpoint
- Admin-only access gating (eddieb@coareholdings.com)

### **Fixed**
- Setup field persistence (was being lost on page refresh)
- Database schema now includes section_summaries, compressed_grant
- Worker API handles new project fields

### **Changed**
- All extraction/scoring now uses Haiku
- All writing now uses Sonnet
- max_tokens optimized per feature (300-2500)
- GrantWizard uses progressive summaries
- Database migrations for new columns

---

## 🎯 Next Milestone: v3.1.0

**Target:** Resilience & Recovery + AI Persona Wiring

**Tasks:**
1. Implement graceful degradation when Claude API is down (503 with retry)
2. Add R2 backup system (daily automated backups)
3. Add restore from backup route
4. Add maintenance mode toggle
5. Implement gradual rollout strategy for deployments
6. Add IP-based rate limiting
7. Add prompt injection sanitization
8. Create RUNBOOK.md with incident response procedures
9. Wire AI personas to UI: Polish, PD Review, Study Section, Advisory Council buttons
10. Add Compliance Checker UI component
11. Add DOCX export functionality

**Estimated Time:** 12-16 hours
**Expected Impact:** Production-grade reliability + full AI persona access

---

## 📞 Support

**Internal Tool Owner:** COARE Holdings
**Technical Contact:** Eddie Bannerman-Menson
**Repository:** https://github.com/Eddiebm/frankgrant
**Issues:** https://github.com/Eddiebm/frankgrant/issues

---

**End of Status Document**
*This document is automatically updated with each major deployment.*
