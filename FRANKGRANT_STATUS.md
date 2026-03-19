# FrankGrant Status Document

**Last Updated:** 2026-03-19
**Version:** 5.7.0
**Status:** Production (Internal COARE Tool)

---

## 🌐 Live Deployment

| Resource | URL/ID | Status |
|----------|--------|--------|
| **Frontend (Pages)** | https://frankgrant.pages.dev | ✅ Live |
| **Latest Preview** | https://f159de0c.frankgrant.pages.dev | ✅ Live |
| **R2 Bucket** | frankgrant-backups | ✅ Live |
| **API Worker** | https://frankgrant-worker.eddie-781pagesdev.workers.dev | ✅ Live |
| **D1 Database** | frankgrant-db | ✅ Live |
| **D1 Database ID** | 728339df-7875-4fb7-a58b-196cd8099e22 | — |
| **KV Namespace** | frankgrant-KV | ✅ Live |
| **KV Namespace ID** | 9c6b57ffb4b8435aa323195d39b4b732 | — |
| **GitHub Repo** | https://github.com/Eddiebm/frankgrant | ✅ Live |

---

## ✅ Features: Built & Deployed

### **Email Grant, Shareable Read-Only Link, PDF Export (v5.7.0)**
- ✅ **POST /api/projects/:id/email** — sends combined DOCX as Resend attachment to any email; graceful fallback if RESEND_API_KEY not set; logs to usage_log
- ✅ **📧 Email to myself** — one-click in Export dropdown using Clerk user email; generates DOCX in browser → base64 → worker → Resend
- ✅ **📧 Email to colleague** — opens modal with To field; sends DOCX; shows list of recipients sent this session
- ✅ **POST /api/projects/:id/share** — creates share token (UUID, 30-day expiry), stores in DB; returns share URL
- ✅ **GET /api/shared/:token** — PUBLIC endpoint (no auth); returns title, mechanism, pi_name, institution, sections, scores; 404 if revoked, 410 if expired
- ✅ **DELETE /api/projects/:id/share** — revokes share link (clears share_token, sets share_enabled = 0)
- ✅ **🔗 Get shareable link** — Export dropdown option; modal shows URL with Copy button, expiry date, Revoke button
- ✅ **SharedGrantView.jsx** — public read-only page at `/#/shared/:token`; sidebar section nav; teal view-only banner; ownership footer; expired/invalid states
- ✅ **App.jsx routing** — `#/shared/:token` renders SharedGrantView without Clerk auth; skips health/maintenance checks
- ✅ **D1 migration** — `share_token TEXT`, `share_enabled INTEGER DEFAULT 0`, `share_expires_at INTEGER` added to projects table
- ✅ **🖨️ Save as PDF** — improved `handlePrint()` builds a dedicated print div with formatted grant content (section headings, page breaks, ownership footer); `@media print` CSS updated with `#print-grant-content` isolation

### **Submission Checklist Generator + Ownership Disclaimer on All Exports (v5.6.0)**
- ✅ **GET /api/projects/:id/submission-checklist** — generates full checklist object with frankgrant_prepared, researcher_scientific, letters_required, administrative, important_notes, and ownership_statement sections
- ✅ **POST /api/projects/:id/email-checklist** — sends formatted HTML email via MailChannels with full checklist content
- ✅ **📋 Checklist button** in GrantEditor toolbar — loads checklist modal on demand
- ✅ **ChecklistModal** — full-screen modal with ownership box (teal), due date alert (red if ≤14 days), 5 sections with interactive checkboxes, email + DOCX download buttons
- ✅ **Ownership disclaimer** added as final paragraph of every combined DOCX (9pt italic Georgia): PI Name, Institution own all content; FrankGrant makes no accuracy representation
- ✅ **Submission checklist page** added as last page of combined DOCX export
- ✅ **submission_checklist.docx** added to ZIP submission package
- ✅ **SharedGrantView footer** — "Prepared by FrankGrant Grant Writing Services. Scientific content owned by [PI Name], [Institution]. View only — no login required." (inline in ChecklistModal)

### **Three-Pass Quality Review + Five-Database Reference Verification + Delivery Gate (v5.5.0)**
- ✅ **Five-database reference verification** - PubMed, CrossRef, Semantic Scholar, OpenAlex, Europe PMC checked in parallel via Promise.allSettled; 200ms delay between citations; verified/likely_real/not_found/needs_manual_check statuses with confidence scores
- ✅ **Pass 1 — Scientific Accuracy** - Sonnet checks for invented claims, unverified numbers, misrepresented methods; Haiku extracts all citations and verifies each against 5 databases; any hallucinated citation blocks certification
- ✅ **Pass 2 — NIH Compliance** - Programmatic page limit checks (Research Strategy, Specific Aims, Commercialization); required section presence; Haiku content checks (rigor/reproducibility, timeline, go/no-go criteria, IACUC references)
- ✅ **Pass 3 — Reviewer Simulation** - Full 3-reviewer study section + commercial review for SBIR/STTR; blocks delivery if impact score >40 or any criterion ≥7
- ✅ **Three-Pass Orchestrator** - Sequential passes, stops at first failure, certifies and sets delivery_ready=1 if all pass
- ✅ **Quality certification resets on edit** - PUT /projects/:id resets quality_certified=0 and delivery_ready=0 when sections change
- ✅ **QualityReviewPanel** - Collapsible panel in writer tab with pass status indicators, certified/failed banners, database grids for hallucinated citations, re-certification notice
- ✅ **Delivery gate** - NIH Package (.zip) export disabled until quality_certified=1; tooltip explains requirement
- ✅ **Updated ReferenceVerifier** - Multi-database grid showing all 5 databases per citation, reliability badge (HIGH/MEDIUM/LOW), matched records with PMID/DOI links
- ✅ **Command Station quality metrics** - Health panel shows certified-this-month, delivery-ready count, avg scores, failing-quality grant list
- ✅ **D1 schema** - 9 new quality columns on projects table
- ✅ **Worker routes** - POST /quality/pass1, /pass2, /pass3, /run-all

### **Post-Review Rewrite + Track Changes + Reference Checking + Submission Package (v5.4.0)**
- ✅ **Post-Review Rewrite** - Sonnet rewrites all grant sections based on reviewer feedback (study section, PD review, advisory council, commercial review, aims optimizer, compliance)
- ✅ **Track Changes Viewer** - LCS word-level diff, paragraph-level accept/reject, 3 view modes (track changes / clean / side-by-side with sync scroll)
- ✅ **Reference Hallucination Checker** - Haiku extracts citations → PubMed esearch/esummary → classified verified/uncertain/not_found with PMID links
- ✅ **Auto-verify after rewrite** - Reference verification fires in background via ctx.waitUntil after every rewrite
- ✅ **Submission Package gate** - $199/grant, 5 rewrite cycles, D1 tracking, admin credit system
- ✅ **Admin: Grant Package** - Command Station user drawer "Grant Submission Package" button
- ✅ **Admin: Package metrics** - AI Costs panel shows total sold, revenue, avg cycles used, active vs exhausted
- ✅ **Rewrite button on all review modals** - Study Section, PD Review, Advisory Council, Commercial Review, Aims Optimizer
- ✅ **D1 schema** - submission_packages table, rewrite_results/cycles columns on projects
- ✅ **Worker routes** - GET/POST /submission-package, POST /rewrite, POST /verify-references, POST /command/users/:id/grant-package

### **Navigation & Shell (v5.2.0)**
- ✅ **AppShell** - Desktop sidebar (220px expanded / 48px collapsed), mobile bottom tabs (56px)
- ✅ **Sidebar nav** - My Grants, New Grant, Letters, Biosketch, Pipeline, Settings, Command Station (admin-gated)
- ✅ **Mobile tabs** - Grants, New, Letters, Pipeline, More (bottom sheet with Biosketch/Settings/Sign Out)
- ✅ **Auto-collapse** - Sidebar collapses automatically when editor is open
- ✅ **Breadcrumbs** - Full path shown on all views
- ✅ **Single-return architecture** - All views wrapped in AppShell, no duplicate layout code
- ✅ **Pipeline view** - Dedicated route for kanban board / calendar / list with view toggle
- ✅ **Projects view** - 4-card stats bar, improved empty state with wizard CTA, cleaner toolbar

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

### **Preliminary Data System (v4.2.0)**
- ✅ **Figure Upload** - Drag-and-drop JPEG/PNG/GIF/WebP/PDF (max 10MB), labeled per figure
- ✅ **Claude Vision Analysis** - Haiku describes each figure for grant context (3-5 sentences)
- ✅ **Gap Analysis** - Haiku reviews all figures as NIH reviewer, returns score 0-100, label, gaps, strengths
- ✅ **Score Circle** - Visual score ring in prelim drawer toolbar button with color coding
- ✅ **Narrative Generation** - Sonnet writes polished "Preliminary Data" prose from all figures
- ✅ **Use in Approach** - One-click inserts narrative into Approach section, or appends on generate
- ✅ **Approach Prompt Injection** - `prelim_data_narrative` and `critical_gaps` (high-importance) injected into Approach writing prompt
- ✅ **Drawer UI** - 📎 Prelim toolbar button opens 400px side panel with Upload/Analysis/Narrative tabs

### **PubMed Citations (v4.2.0)**
- ✅ **Per-Section Citations** - "📚 Find Citations" button under each section in writer tab
- ✅ **Keyword Extraction** - Haiku extracts 3 PubMed search queries from section text
- ✅ **PubMed E-utilities** - esearch + esummary API calls (no API key required)
- ✅ **Citation Panel** - Shows title, authors, journal, year, PubMed link, Insert button
- ✅ **Insert to Section** - Appends formatted citation text to section textarea

### **Enhanced DOCX Export (v4.8.0)**
- ✅ **Export dropdown** — "📄 Export ▾" toolbar dropdown with three options
- ✅ **Combined Document** — improved cover page (18pt title bold, 14pt PI, 12pt institution+mechanism, FOA, date + HR), running header (title left / page# right on all content pages), bibliography appendix if citations exist, Fast Track dual research strategy sections
- ✅ **NIH Submission Package** — separate .docx per section bundled into .zip via JSZip: specific_aims.docx, research_strategy.docx (or phase1/phase2 for Fast Track), commercialization_plan.docx, data_management_plan.docx, facilities.docx, human_subjects.docx, vertebrate_animals.docx, project_summary.docx, bibliography.docx, cover_letter.docx — empty sections skipped
- ✅ **Print / PDF** — `window.print()` with `@media print` CSS that hides all UI chrome
- ✅ **Full Grant tab** — also has Combined DOCX + NIH Package (.zip) buttons
- ✅ **D1 columns** — `go_no_go_milestone TEXT`, `fast_track_phase1_sections TEXT`, `fast_track_phase2_sections TEXT`

### **Study Section Simulation (v4.3.0)**
- ✅ **3 parallel Sonnet calls** - Primary (basic scientist), Secondary (physician-scientist), Reader (biostatistician)
- ✅ **SRO synthesis** - Fourth Sonnet call generates NIH Summary Statement JSON
- ✅ **Progress modal** - 4-step animated progress during ~25-30s API calls
- ✅ **Results modal** - Impact score, percentile, criterion table, reviewer accordions, synthesis
- ✅ **Persisted** - `study_section_results` column, "View Last Study Section" on toolbar if results exist
- ✅ **Fundability statement** - Green/yellow/red based on impact score

### **Polish Button (v4.3.0)**
- ✅ **Per-section** - "✨ Polish" button next to "📚 Find Citations" in writer tab
- ✅ **Diff modal** - Side-by-side Original vs Polished in Georgia serif
- ✅ **Accept / Discard** - Accept overwrites section and saves; Discard cancels
- ✅ **Sonnet powered** - Removes hedges, converts to active voice, strengthens hooks

### **PD Review (v4.5.0)**
- ✅ **"📋 PD Review" toolbar button** - Shows existing results or triggers fresh 30-year veteran assessment
- ✅ **Fundability badge** - Fund Now (green) / Revise & Resubmit (amber) / Do Not Fund (red)
- ✅ **Full memo modal** - Overall assessment, strengths (green), concerns (red), recommended actions (amber)
- ✅ **Estimates** - Payline estimate + priority score estimate side by side
- ✅ **Final recommendation** - Highlighted quote block
- ✅ **Copy memo** - Full text copy for pasting elsewhere
- ✅ **Persisted** - `pd_review_results` column, re-run or view instantly
- ✅ **Worker route** - `POST /api/projects/:id/pd-review`, Sonnet, max_tokens 1500

### **Advisory Council (v4.5.0)**
- ✅ **"🏛️ Council" toolbar button** - Full second-level review modal
- ✅ **Decision badge** - Fund / Fund with Conditions / Defer / Do Not Fund
- ✅ **Priority indicator** - High / Medium / Low
- ✅ **Conditions list** - Specific requirements if fund_with_conditions
- ✅ **Portfolio fit + budget recommendation** - Side-by-side summary
- ✅ **Formal council statement** - Styled italics quote block
- ✅ **Inputs used footer** - Shows if study section score and PD review informed the decision
- ✅ **Persisted** - `advisory_council_results` column
- ✅ **Worker route** - `POST /api/projects/:id/advisory-council`, Sonnet, max_tokens 1000
- ✅ **Voice Mode integration** - "What did the program director say" → loads PD context; "What did the advisory council decide" → loads council context

### **Commercial Reviewer Panel (v4.7.0)**
- ✅ **"💰 Comm Review" toolbar button** — visible only for SBIR/STTR mechanisms (when commercialization plan exists)
- ✅ **Viability badge** — High / Medium / Low / Not Viable with color coding
- ✅ **Overall score** — 0-100 with green/amber/red threshold coloring
- ✅ **Investor readiness** — Series A Ready / Seed Stage / Pre-Seed / Not Ready
- ✅ **5 dimension scores** — Market Assessment, IP Strategy, Regulatory Pathway, Revenue Model, Commercial Team (each /20)
- ✅ **Scored dimension bars** — visual progress bar per dimension with feedback text and key insights
- ✅ **Commercial team gaps** — tagged badges showing missing commercial expertise
- ✅ **Strengths vs Critical Weaknesses** — side-by-side grid
- ✅ **Top Improvements** — numbered action list
- ✅ **Phase III readiness + Bottom Line** — dark card with frank bottom-line assessment
- ✅ **Persisted** — `commercial_review_results` column, re-run or view instantly
- ✅ **Worker route** — `POST /api/projects/:id/commercial-review`, Sonnet, max_tokens 1500

### **SVG Charts in Commercialization Plan (v4.7.0)**
- ✅ **"📊 Generate Charts" button** — in commercial section writer (SBIR/STTR only)
- ✅ **Haiku extraction** — extracts TAM/SAM/SOM, revenue projections, competitor positioning from commercialization text
- ✅ **Market Opportunity chart** — concentric circles SVG showing TAM/SAM/SOM with dollar labels
- ✅ **Revenue Projection chart** — 5-year bar chart with gradient fills and formatted dollar labels
- ✅ **Competitive Landscape chart** — 2×2 positioning matrix (Innovation vs Accessibility) with quadrant coloring
- ✅ **Pure inline SVG** — no charting library, zero extra dependencies
- ✅ **Show/Hide toggle** — "📊 View Charts" / "▲ Hide Charts" button after generation
- ✅ **Persisted** — `commercial_charts` column stores structured JSON, charts re-render from data
- ✅ **Worker route** — `POST /api/projects/:id/generate-charts`, Haiku, max_tokens 800

### **Bibliography Manager (v4.7.0)**
- ✅ **"📚 Bibliography" toolbar button** — opens 480px right-side drawer
- ✅ **Add manual citations** — form with: Title, Authors, Journal, Year, Volume, Issue, Pages, PMID, Section Tag
- ✅ **NIH-style formatting** — auto-formats all citations as numbered NIH bibliography entries
- ✅ **PubMed link** — clickable PubMed ↗ link for citations with PMID
- ✅ **Section tagging** — optional tag to track which section each citation belongs to
- ✅ **Copy All** — copies full formatted bibliography to clipboard
- ✅ **Insert into Section** — inserts formatted bibliography into the currently active section
- ✅ **Delete** — remove individual citations with ✕ button
- ✅ **Formatted preview** — live NIH-formatted reference list preview at bottom
- ✅ **Persisted** — `bibliography` column stores JSON array, loaded on drawer open
- ✅ **Worker routes** — `GET /POST /api/projects/:id/bibliography`

### **Missing Required Grant Sections (v4.6.0)**
- ✅ **Introduction (Resubmission)** — shown only when `is_resubmission` is true; 1-page with asterisk-marked changes
- ✅ **Human Subjects** — all 10 NIH required elements; toggled in setup
- ✅ **Vertebrate Animals** — NIH five-point section; toggled in setup
- ✅ **Authentication of Key Biological Resources** — always shown
- ✅ **Resource Sharing Plan** — shown only for R01/R21 mechanisms
- ✅ **Select Agent Research** — toggled in setup
- ✅ **Cover Letter to SRO** — always shown
- ✅ **Project Timeline** — always shown
- ✅ **Conditional visibility** — `showWhen` and `showForMechanisms` properties on SECTIONS drive filtering
- ✅ **Setup toggles** — Human Subjects, Vertebrate Animals, Select Agents checkboxes in Project Setup tab
- ✅ **Section generation prompts** — all 8 sections added to `professorWritePrompt()` in personas.js
- ✅ **Max token caps** — all new section write actions added to MAX_TOKENS_BY_FEATURE in worker

### **Letters Generator (v4.6.0)**
- ✅ **12 letter types** — Collaboration, Support, MOU, PI Commitment, Mentor (K99), Consultant, Data Sharing, IRB Approval, Patient Advocacy, Industry Partner, Key Personnel, Subcontract Intent
- ✅ **Dashboard "📝 Letters" button** — top-level navigation view
- ✅ **Project selector** — choose which project context to use for generation
- ✅ **Letter type grid** — visual card grid, click to select
- ✅ **Dynamic form fields** — each letter type has required/optional fields
- ✅ **Preview panel** — side-by-side form + generated letter in Georgia serif
- ✅ **Copy / Download** — clipboard copy or .txt download
- ✅ **Haiku-powered** — fast, cost-efficient (formulaic content)
- ✅ **Worker route** — `POST /api/letters/generate`, logs usage as `generate_letter`

### **Resubmission Mode (v4.6.0)**
- ✅ **Resubmission toggle** in Project Setup — enables A1 mode, shows Prior Application Number + Prior Review Date fields
- ✅ **Conditional sections** — Introduction (Resubmission) appears in writer when is_resubmission is true
- ✅ **"🔄 Resubmission" tab** — appears in Grant Editor tab row when is_resubmission is on
- ✅ **Reviewer comments import** — paste full Summary Statement text, saved to `reviewer_comments` D1 column
- ✅ **Sonnet analysis** — structured JSON: impact score, reviewer scores, major concerns, minor concerns, strengths, recommended changes by section
- ✅ **Analysis display** — impact score badge, reviewer score grid, major concerns cards with affected sections, minor concerns list, strengths list, recommended changes by section
- ✅ **Generate Introduction button** — 275-word A1 Introduction stored to `introduction` column, shown in Section Writer
- ✅ **"🔄 Revise for A1" button** — per-section in writer tab when resubmission mode + analysis available
- ✅ **D1 migrations** — `prior_application_number`, `prior_review_date`, `reviewer_comments`, `resubmission_analysis` columns added
- ✅ **Worker routes** — import-comments, analyze, generate-introduction, revise-section endpoints

### **Voice Mode (v4.4.0)**
- ✅ **Full-screen overlay** - Dark modal with teal/purple/amber status indicators
- ✅ **Web Speech API** - Browser-native speech recognition (Chrome/Edge/Safari)
- ✅ **ElevenLabs TTS** - High-quality voice synthesis for responses >50 words (Adam voice)
- ✅ **Browser TTS fallback** - Web Speech API SpeechSynthesisUtterance for short responses or when ElevenLabs unavailable
- ✅ **Intent detection** - Haiku classifies user message (READ_SECTION, GENERATE, COMPLIANCE, etc.) in ~300ms
- ✅ **Smart context** - Loads section content, compliance results, study section scores based on detected intent
- ✅ **Conversation history** - Last 6 exchanges passed to Sonnet; session persisted in KV (4h TTL)
- ✅ **Section generation** - "Write my Aims section" triggers generateSection() flow then re-enters voice
- ✅ **Section update** - Voice edits trigger onSectionUpdated callback
- ✅ **Keyboard shortcuts** - Space=toggle mic, Esc=exit, P=pause/resume
- ✅ **Waveform animation** - 5-bar CSS keyframe animation (staggered delays)
- ✅ **Session cost tracking** - Sonnet calls logged as `voice_chat` in usage_log
- ✅ **Admin monitoring** - Voice section in AI Costs panel (sessions, tokens, cost, avg session cost)
- ✅ **voice_enabled toggle** - Per-user voice enable/disable in Command Station Users panel
- ✅ **D1 columns** - `voice_enabled INTEGER DEFAULT 1`, `voice_tier TEXT` on users_meta
- ✅ **KV session storage** - `voice:{project_id}:{user_id}` with 4h expiration
- ✅ **Toolbar button** - "🎤 Voice Mode" teal/cyan button in project toolbar

### **Specific Aims Optimizer (v4.10.0)**
- ✅ **"🎯 Optimize Aims" toolbar button** — shown only when Specific Aims section has content (>50 chars)
- ✅ **Scoring modal** — overall score 0-100 with color coding (80+ green, 60-79 amber, <60 red), animated progress bar, fundability prediction
- ✅ **5-element analysis** — Hook Sentence, Problem Statement, Aims Structure, Innovation Claim, Impact Statement — each scored 0-20 with expandable feedback and example improvement
- ✅ **Strongest/weakest badges** — highlighted inline on element bars
- ✅ **Top 3 action items** — amber boxes with specific improvements
- ✅ **Reviewer first impression** — quoted block, verbatim from NIH reviewer persona
- ✅ **Generate Alternative Structures button** — triggers 3 parallel Sonnet calls (max_tokens 1200 each)
- ✅ **3-column alternatives view** — Problem-Focused, Discovery-Focused, Translational structures side by side with scrollable text
- ✅ **Use This Version** — one-click replaces Aims section content and saves
- ✅ **Mix & Match note** — copy elements across versions
- ✅ **Worker routes** — `POST /api/projects/:id/optimize-aims` and `POST /api/projects/:id/optimize-aims/alternatives`
- ✅ **D1 columns** — `aims_optimization TEXT`, `aims_alternatives TEXT`

### **Grant Pipeline Management (v4.10.0)**
- ✅ **Pipeline status** — 8 statuses: draft, in_progress, ready_to_submit, submitted, under_review, awarded, not_funded, withdrawn
- ✅ **PATCH /api/projects/:id/status** — updates status, submission_date, award_date, award_amount, award_number, next_deadline, priority, notes
- ✅ **D1 columns** — status, submission_date, award_date, award_amount, priority, notes, next_deadline, award_number (10 new columns)
- ✅ **Stats bar** — Total Grants, In Progress, Submitted, Awarded (count + $M), Not Funded
- ✅ **Deadline banner** — "⚠️ You have N grant deadline(s) approaching this week" with project links
- ✅ **View toggle** — ☰ List / ⬜ Board / 📅 Calendar with localStorage persistence
- ✅ **List view** — filter by status/mechanism/priority, sort by deadline/status/mechanism/updated, completion % bar, deadline countdown (color-coded), quick Open/Status/Delete buttons
- ✅ **Kanban board** — 7 columns, HTML5 drag-and-drop (no library), PATCH on drop, card shows title, mechanism, priority, deadline badge, completion bar
- ✅ **Calendar view** — monthly grid with prev/next navigation, color-coded deadline events (blue >14d, amber ≤14d, red ≤3d/overdue), click to open project, "No deadline set" section with Set Deadline button
- ✅ **Status modal** — edit status, priority, next_deadline, submission_date, award_amount, award_number, notes; award fields conditionally shown
- ✅ **Enhanced list cards** — status badge, priority color, mechanism badge, deadline countdown, completion % progress bar

### **Project Collaboration (v4.11.0)**
- ✅ **D1 tables** — `project_collaborators`, `project_comments`, `project_versions`; 3 new columns on `projects` (`shared_with`, `section_assignments`, `current_version`)
- ✅ **Access control** — `checkProjectAccess` helper: owner full access, accepted collaborators by role (co_writer/reviewer/admin), email+user_id matching
- ✅ **15+ worker routes** — invite/manage/remove collaborators, accept invitation, shared projects, pending invitations, comments (CRUD + resolve), section assignments, version snapshots/restore
- ✅ **Auto-snapshot** — triggered via `_auto_snapshot: true` flag in PUT body when a section is generated, stores full sections JSON in project_versions
- ✅ **CollaborationPanel** — 380px right-side drawer: Team tab (invite + role management), Comments tab (post/resolve/delete, grouped by section), History tab (snapshots + restore)
- ✅ **"👥 Share" button** — in GrantEditor toolbar with unresolved comment count badge (red dot)
- ✅ **Dashboard** — "Shared With Me" section below own projects, pending invitation banner with Accept button
- ✅ **useApi.js** — 16 new collaboration API methods

### **NCI Direct to Phase 2 (D2P2) Mechanism (v4.9.0)**
- ✅ **D2P2 mechanism** — Added `D2P2` to MECHANISMS in nih.js: 12-page strategy, 12-page commercial, $2,097,580 budget cap, 24 months, NCI only, requires Phase I equivalency documentation
- ✅ **Phase I Equivalency Documentation section** — 2-3 page section shown only for D2P2 mechanism, with phase1_equivalency prompt in personas.js (5 required subsections, confident "already proven" tone)
- ✅ **D2P2 setup fields UI** — Blue box in Project Setup tab (shown when mechanism = D2P2): Phase I Equivalency Funding Source, Phase I Equivalency Period, Key Milestones Achieved (textarea), Why D2P2 Rationale (textarea)
- ✅ **D2P2-specific AI prompts** — All sig/innov/approach prompts modified with D2P2 context block: funding source, equivalency period, milestones, rationale; tone is Phase II development (not feasibility)
- ✅ **D2P2 Study Section reviewers** — 6 D2P2-specific criteria injected into all 3 reviewer system prompts: Phase I equivalency documentation quality, Phase II readiness, regulatory pathway, commercialization plan, budget justification, team experience
- ✅ **DOCX export** — D2P2 cover page note (blue text), Phase I Equivalency section included in both Combined DOCX and NIH Submission Package (phase1_equivalency.docx)
- ✅ **D1 schema** — 4 new columns: `d2p2_funding_source`, `d2p2_equivalency_period`, `d2p2_milestones_achieved`, `d2p2_rationale`
- ✅ **isD2P2 flags** — Properly included in `isPhaseII` and `needsCommercial` checks throughout

### **Fast Track Dual Research Strategy (v4.8.0)**
- ✅ **Go/No-Go Milestone field** — amber box in Project Setup tab (shown when mechanism = FAST-TRACK), required warning
- ✅ **Dual section writer** — FastTrackWriter component replaces standard section list; shows Phase I group (6-page) + Go/No-Go milestone display box + Phase II group (12-page) + Other Sections
- ✅ **Phase-specific generation** — `generateFTSection(phase, secId)` uses `professorWritePrompt()` with phase-specific prompts for: `phase1_sig`, `phase1_innov`, `phase1_approach`, `phase2_sig`, `phase2_innov`, `phase2_approach`
- ✅ **Separate storage** — `fast_track_phase1_sections` JSON column (phase1_sig, phase1_innov, phase1_approach) + `fast_track_phase2_sections` JSON column separate from main `sections`
- ✅ **Compliance counters** — per-phase word count / page estimate shown below each phase group
- ✅ **DOCX integration** — both Combined DOCX and NIH Package export Phase I / Phase II research strategy as separate labeled sections with Go/No-Go milestone between them
- ✅ **Phase-specific prompts** — all 6 Fast Track section prompts added to `professorWritePrompt()` in personas.js with phase-appropriate word targets, feasibility vs. full-development framing, go_no_go_milestone injection
- ✅ **nih.js flags** — `is_fast_track: true`, `phase1_research_strategy_pages: 6`, `phase2_research_strategy_pages: 12`

### **NIH Compliance**
- ✅ **Mechanism Support** - STTR-I/II, SBIR-I/II, FAST-TRACK, NCI-IIB, D2P2, R21, R01, K99
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

### **Evidence-Based Scoring + Criterion-Level Incompleteness (v5.1.1)**
- ✅ **Reviewer JSON output** — All 3 Study Section reviewers now output structured JSON per criterion (previously free text + `SCORES:` line)
- ✅ **Per-criterion fields** — Every criterion score includes: `evidence` (direct quote/paraphrase from grant), `score_rationale` (why this score not one point better/worse), `confidence` (high/medium/low), `scoreable` (bool), `unscorable_reason` (string or null)
- ✅ **Criterion-level incompleteness detection** — Reviewers set `scoreable: false` when section is absent, truncated mid-sentence, under 100 words where 500+ expected, or missing a required subsection
- ✅ **JS-side score aggregation** — Scores averaged in handler code (not by AI) using majority-vote scoreability logic across 3 reviewers; reliable math, no hallucination
- ✅ **Impact score suspension** — `impact_score: null` + `percentile: null` when fewer than 3 of 5 criteria are scoreable; SRO instructed to pass this through
- ✅ **NIHScoreCard component** — New expandable criterion cards replacing flat score grid: completeness banner (green/amber/red), scoreable criteria show "Why this score" with evidence + rationale, unscorable criteria show gray box with ⚠ + unscorable_reason + "Complete to score" CTA
- ✅ **ScoreBar updated** — Per-section auto-scorer shows confidence badge, expandable evidence/rationale panel, unscorable state with ⚠
- ✅ **Commercial Review dimensions** — market/ip/regulatory/revenue_model/commercial_team all include evidence, score_rationale, confidence, scoreable, unscorable_reason; ScoreDimension component shows expandable "Why this score" + unscorable gray box
- ✅ **Aims Optimizer** — Each of 5 elements includes evidence, score_rationale, scoreable, unscorable_reason
- ✅ **Backwards compatible** — NIHScoreCard handles old number-only criteria format for previously saved results
- ✅ **Token budget increase** — Reviewers 1500→2000, SRO synthesis 2000→2500

### **Full Document Scoring — No Truncation (v5.0.5)**
- ✅ **`buildFullGrantContext()` helper** — generates complete grant context string with all sections in full, section word counts, [BRIEF]/[NOT GENERATED] flags for thin sections
- ✅ **Study Section** — all 3 reviewer Sonnet calls receive complete document via `buildFullGrantContext`, no `.slice()`, max_tokens increased to 1500 per reviewer, 2000 for SRO synthesis
- ✅ **PD Review** — full document passed, no character limits on any section
- ✅ **Advisory Council** — full document + full study section synthesis + full PD review results passed
- ✅ **Commercial Review** — full document including Aims, Significance, Approach, Commercialization Plan all passed in full
- ✅ **Aims Optimizer** — passes complete Aims + complete Significance section for context
- ✅ **Reviewer instructions updated** — all reviewers instructed to flag thin/missing sections and score based only on what they can read
- ✅ **`missing_components` field** — all 4 reviewer JSONs now return `missing_components[]` (component, expected_location, why_it_matters, impact_on_score, severity) + `package_completeness_critique` paragraph
- ✅ **All system prompts updated** — SS_REVIEWER_1/2/3, SS_SUMMARY, PD_REVIEW_SYSTEM, ADVISORY_COUNCIL_SYSTEM, COMMERCIAL_REVIEWER_SYSTEM
- ✅ **Completeness gate modal** — shows before any review run when sections are missing/brief; checklist with ✅/⚠️/❌ per section with word counts; "Score anyway" vs "Complete document first" options
- ✅ **MissingComponentsPanel component** — displayed in Study Section, PD Review, Advisory Council, Commercial Review result modals; severity badges (critical/major/minor); package_completeness_critique in reviewer-voice styled box
- ✅ **Word count summary in every scorer prompt** — all section word counts + [BRIEF]/[NOT GENERATED] flags passed to every reviewer
- ✅ **aims_optimize usage_log** — fixed INSERT to use correct column names (action, not feature)
- ✅ **All scoring routes use `callAnthropicWithFallback`** — graceful degradation on all reviewer calls

### **Production Resilience (v5.0.0)**
- ✅ **Graceful Claude Degradation** — `callAnthropicWithFallback()` with 55s AbortController timeout; returns `{_fallback:true}` on 529/500/503; worker returns 503 `ai_unavailable`
- ✅ **AIUnavailableError** — custom error class in useApi.js; GrantEditor catches it, shows amber retry countdown banner (60s), auto-retries at 0
- ✅ **Anthropic Status Monitoring** — polls https://status.anthropic.com/api/v2/status.json every 5 min, KV-cached; `GET /api/status/anthropic`; amber dismissible banner in App.jsx
- ✅ **R2 Automated Backups** — daily 3am UTC cron (`0 3 * * *`), `scheduled()` export, backs up all 9 D1 tables to `frankgrant-backups` R2 bucket as JSON; deletes backups >30 days
- ✅ **Maintenance Mode** — KV `maintenance_mode` check before all routes; `POST/GET /api/admin/maintenance`; full-screen maintenance page in App.jsx with auto-check every 60s
- ✅ **IP Rate Limiting** — `CF-Connecting-IP` → KV key `rate_ip:[ip]:[minute]`, limit 100/min; 429 + log to `rate_limit_log` with `ip_address` column
- ✅ **Prompt Injection Sanitization** — `sanitizeUserInput()` removes 11 patterns (ignore/forget instructions, jailbreak phrases, etc.); logs to `error_log` as `prompt_injection_attempt`
- ✅ **Payload Size Limits** — Content-Length > 50KB → 413 `{error:'payload_too_large',max_size_kb:50}`
- ✅ **Public Status Page** — `StatusPage.jsx` at `/#/status`, no auth required, polls `/api/status`, green/amber/red component indicators, auto-refresh 60s
- ✅ **Full System Status Endpoint** — `GET /api/status` checks D1 row count + KV + Anthropic + maintenance mode; returns `{overall, components, maintenance}`
- ✅ **Admin Backup Routes** — `POST /api/admin/backup` (manual trigger), `GET /api/admin/backups` (list R2), `GET /api/admin/backups/:file` (download), `POST /api/admin/restore` (destructive restore with `confirm:"RESTORE"`)
- ✅ **RUNBOOK.md** — 6 operational scenarios: Anthropic down, bad deployment, D1 corruption, malicious abuse, Clerk outage, Cloudflare outage
- ✅ **worker:rollback script** — `npx wrangler deployments rollback` added to package.json

### **Voice Mode Completions (v5.0.0)**
- ✅ **Read All Sections** — "read me the whole grant / read from the beginning" → queues all 9 sections in NIH order, shows "Reading section 3 of 7 — Innovation" progress header, speaks each via ElevenLabs
- ✅ **Interrupt Handling** — `startPeekRecognition()` background SpeechRecognition fires when `isSpeaking`; any detected speech immediately cancels all audio and resumes listening
- ✅ **Dictate Mode** — "let me dictate / I want to dictate [section]" → continuous SpeechRecognition accumulates transcript until "done/finish/that's all"; sends to `POST /api/voice/dictate` (Sonnet writes the section)
- ✅ **Voice Edit** — "edit [section] to [instruction]" → `POST /api/voice/edit` (Sonnet applies specific edit); shows diff modal with Accept/Discard buttons controllable by voice
- ✅ **Speed Control** — "read faster/slower/normal" → adjusts `speechRate` 1.1/0.7/0.88 for both ElevenLabs and browser TTS
- ✅ **Voice Study Section** — "run the study section / simulate peer review" → announces running, calls route, speaks periodic 15s updates, reads synthesis when complete
- ✅ **ElevenLabs Voice Selection** — gear icon in Voice Mode overlay; 4 voices: Adam, Rachel, Antoni, Elli (stored in localStorage); dynamic `voice_id` passed to `/api/voice/speak`
- ✅ **Worker voice routes** — `POST /api/voice/dictate` and `POST /api/voice/edit` added to worker; `handleVoiceSpeak` accepts `voice_id` param validated against `VALID_VOICES`

---

## ⏳ Features: Pending Implementation

### **High Priority**
- ⏳ **GrantWizard Prelim Upload Step** - Optional prelim upload between 'review' and 'generating' steps (deferred from v4.2.0)
- ⏳ **PDF Preview** - In-browser rendering with NIH formatting
- ⏳ **DOCX Export — Resubmission** - Export Introduction section as first page (before Specific Aims) when is_resubmission is true

### **Medium Priority**
- ⏳ **Multi-Reviewer Independence** - 3 separate API calls for genuine independence

### **Lower Priority**
- ⏳ **FOA/NOFO Analyzer** - Parse funding opportunities, analyze fit
- ⏳ **Batch API Support** - Deep Review mode with 50% cost savings (24-hour latency)
- ⏳ **Mobile Responsive** - Full optimization for 375px width
- ⏳ **Loading Skeletons** - Animated loading states
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
