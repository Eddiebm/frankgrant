# FrankGrant Runbook

**Owner:** COARE Holdings
**Last Updated:** 2026-03-18
**Version:** 5.0.0

---

## Scenario 1: Anthropic / Claude API Down

**Symptoms:** AI generation buttons fail; users see "AI generation temporarily unavailable" banner; `/api/status/anthropic` returns non-operational indicator.

**Response:**
- Under 2 hours: No action required. The frontend auto-retries with 60-second countdown. Users can save and return.
- Over 2 hours: Enable maintenance mode via Command Station → Platform Health, or:
  ```bash
  curl -X POST https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/admin/maintenance \
    -H "Authorization: Bearer $ADMIN_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"enabled":true,"eta":"Expected recovery: 2 hours","message":"AI generation is temporarily unavailable due to a third-party service issue. Your saved work is unaffected."}'
  ```
- Recovery: Disable maintenance mode once Anthropic confirms operational status.
- Monitor: https://status.anthropic.com

---

## Scenario 2: Bad Deployment (Worker Crash / Regression)

**Symptoms:** 500 errors on all routes; `/api/health` fails; users can't load projects.

**Response:**
1. Check deployment logs: `npx wrangler tail --format=pretty`
2. Roll back to previous worker deployment:
   ```bash
   npm run worker:rollback
   ```
   This runs `npx wrangler deployments rollback` which promotes the previous version.
3. Verify recovery: `curl https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/health`
4. For Pages rollback, go to Cloudflare Pages dashboard → select previous deployment → Promote.

---

## Scenario 3: D1 Database Corruption

**Symptoms:** Projects not loading; 500 errors with DB-related messages; data missing.

**Response:**
1. Identify the last clean backup:
   ```bash
   curl https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/admin/backups \
     -H "Authorization: Bearer $ADMIN_TOKEN"
   ```
2. Download the backup to inspect it:
   ```bash
   curl "https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/admin/backups/frankgrant-backup-YYYY-MM-DD-HH.json" \
     -H "Authorization: Bearer $ADMIN_TOKEN" -o backup.json
   ```
3. Enable maintenance mode to prevent writes during restore.
4. Restore from backup (DESTRUCTIVE — clears all tables and reinserts):
   ```bash
   curl -X POST https://frankgrant-worker.eddie-781pagesdev.workers.dev/api/admin/restore \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"confirm":"RESTORE","filename":"frankgrant-backup-YYYY-MM-DD-HH.json"}'
   ```
5. Disable maintenance mode and verify data.

---

## Scenario 4: Malicious Abuse / Spam User

**Symptoms:** Abnormal usage costs; rate limit logs spiking; IP rate limit entries in DB.

**Response:**
1. Open Command Station → Security → check `rate_limit_log` for repeated IPs/users.
2. Suspend the user account via Command Station → Users → select user → PATCH Suspended.
3. For IP-level blocking, add a Cloudflare WAF rule via the Cloudflare dashboard.
4. Review `usage_log` for cost impact; update monthly budget limits if needed.
5. If prompt injection detected: review `error_log` for `prompt_injection_attempt` entries to understand the attack pattern.

---

## Scenario 5: Clerk Authentication Outage

**Symptoms:** Users can't sign in; "Unauthorized" errors on all authenticated routes; JWT verification failing.

**Response:**
- Users with active sessions: Clerk JWTs are valid for 1 hour. Existing sessions continue to work until expiry.
- New logins: Not possible during Clerk outage.
- Show status banner: Update the App.jsx Anthropic banner logic or add a manual KV flag:
  ```bash
  # Via wrangler KV
  npx wrangler kv key put --binding=KV "auth_status_message" "Login is temporarily unavailable. Existing sessions remain active."
  ```
- Monitor: https://status.clerk.com
- No data risk — all user data is in D1/R2, not Clerk.

---

## Scenario 6: Cloudflare Platform Outage

**Symptoms:** Entire site unreachable; DNS/CDN errors.

**Response:**
- Monitor: https://www.cloudflarestatus.com
- No action possible — Cloudflare handles automatic recovery and failover.
- Communicate to users via email/Slack if outage exceeds 30 minutes.
- All data is persisted in D1 (SQLite) and R2 (backups) — no data loss risk.
- After recovery, verify via `/api/health` and check D1 for any partial writes.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `npm run worker:rollback` | Roll back worker to previous version |
| `npx wrangler tail` | Stream live worker logs |
| `npx wrangler d1 execute frankgrant-db --remote --command="SELECT COUNT(*) FROM projects"` | Check DB row counts |
| `GET /api/health` | Health check (no auth) |
| `GET /api/status` | Full system status (no auth) |
| `GET /api/status/anthropic` | Anthropic status (no auth) |
| `POST /api/admin/maintenance` | Enable/disable maintenance mode |
| `POST /api/admin/backup` | Trigger manual backup |
| `GET /api/admin/backups` | List R2 backups |
| `POST /api/admin/restore` | Restore from backup |
