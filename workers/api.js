/**
 * FrankGrant API Worker v3.0.0
 * Handles: auth validation, AI proxy, project CRUD, usage logging, admin monitoring
 *
 * Routes:
 *   POST /api/ai          → proxy to Anthropic (auth required)
 *   GET  /api/projects    → list user's projects
 *   POST /api/projects    → create project
 *   GET  /api/projects/:id → get project
 *   PUT  /api/projects/:id → update project
 *   DELETE /api/projects/:id → delete project
 *   GET  /api/usage       → usage stats for user
 *   GET  /api/health      → health check (public)
 *   POST /api/feedback    → submit feedback (auth required)
 *
 * Admin Routes (require admin email check):
 *   GET  /api/command/health → platform health metrics
 *   GET  /api/command/users → user management data
 *   PATCH /api/command/users/:id → update user (suspend, tier, notes)
 *   GET  /api/command/revenue → revenue metrics
 *   GET  /api/command/mrr-events → MRR events log
 *   POST /api/command/mrr-events → create MRR event
 *   GET  /api/command/ai-costs → AI cost analytics
 *   GET  /api/command/grants → grant intelligence metrics
 *   GET  /api/command/product → product health metrics
 *   GET  /api/command/security → security audit log
 *   GET  /api/command/feedback → all feedback
 *   PATCH /api/command/feedback/:id → update feedback
 *   POST /api/command/feedback/cluster → cluster feature requests with AI
 */

// Admin email for Command Station access
const ADMIN_EMAIL = 'eddieb@coareholdings.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS, PATCH',
  'Access-Control-Allow-Headers': 'Content-Type,Authorization',
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

function err(msg, status = 400) {
  return json({ error: msg }, status)
}

// ── JWT verification (Clerk RS256 with JWKS) ────────────────────────────────
const CLERK_JWKS_URL = 'https://modern-tomcat-23.clerk.accounts.dev/.well-known/jwks.json'

// Convert base64url to base64
function base64urlToBase64(str) {
  return str.replace(/-/g, '+').replace(/_/g, '/')
}

// Convert JWK to CryptoKey
async function jwkToCryptoKey(jwk) {
  const keyData = {
    kty: jwk.kty,
    n: jwk.n,
    e: jwk.e,
    alg: jwk.alg,
    ext: true,
  }
  return await crypto.subtle.importKey(
    'jwk',
    keyData,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  )
}

async function verifyJWT(token) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.')
    const header = JSON.parse(atob(base64urlToBase64(headerB64)))
    if (header.alg !== 'RS256') throw new Error('Wrong algorithm')

    // Fetch JWKS (TODO: add caching via KV for production)
    const jwksResp = await fetch(CLERK_JWKS_URL)
    const jwks = await jwksResp.json()
    const jwk = jwks.keys.find(k => k.kid === header.kid)
    if (!jwk) throw new Error('Key not found')

    const cryptoKey = await jwkToCryptoKey(jwk)

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const sig = Uint8Array.from(
      atob(base64urlToBase64(sigB64)),
      c => c.charCodeAt(0)
    )

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)
    if (!valid) throw new Error('Invalid signature')

    const payload = JSON.parse(atob(base64urlToBase64(payloadB64)))
    if (payload.exp < Date.now() / 1000) throw new Error('Token expired')
    return payload
  } catch (e) {
    return null
  }
}

async function requireAuth(req, env) {
  const auth = req.headers.get('Authorization')
  if (!auth?.startsWith('Bearer ')) return null
  const token = auth.slice(7)
  return await verifyJWT(token)
}

async function requireAdmin(req, env) {
  const payload = await requireAuth(req, env)
  if (!payload) return null
  const email = payload.email || payload['email_address'] || ''
  if (email !== ADMIN_EMAIL) return null
  return payload
}

// ── Rate limiting via KV ─────────────────────────────────────────────────────
async function checkRateLimit(userId, env, endpoint, limit = 30) {
  const key = `rate:${userId}:${Math.floor(Date.now() / 3600000)}`
  const current = parseInt(await env.KV.get(key) || '0')
  if (current >= limit) {
    // Log rate limit hit
    await env.DB.prepare(
      'INSERT INTO rate_limit_log (user_id, endpoint, created_at) VALUES (?, ?, ?)'
    ).bind(userId, endpoint, Math.floor(Date.now() / 1000)).run()
    return false
  }
  await env.KV.put(key, current + 1, { expirationTtl: 7200 })
  return true
}

// ── Log errors with response time ───────────────────────────────────────────
async function logError(endpoint, statusCode, errorMessage, responseTime, userId, env) {
  try {
    await env.DB.prepare(
      'INSERT INTO error_log (endpoint, status_code, error_message, response_time_ms, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(endpoint, statusCode, errorMessage || null, responseTime, userId || null, Math.floor(Date.now() / 1000)).run()
  } catch (e) {
    console.error('Failed to log error:', e)
  }
}

// ── Ensure user exists in D1 ─────────────────────────────────────────────────
async function ensureUser(clerkPayload, env) {
  const clerkId = clerkPayload.sub
  const email = clerkPayload.email || clerkPayload['email_address'] || ''
  const existing = await env.DB.prepare(
    'SELECT id FROM users WHERE clerk_id = ?'
  ).bind(clerkId).first()

  if (existing) return existing.id

  const id = crypto.randomUUID()
  await env.DB.prepare(
    'INSERT INTO users (id, clerk_id, email) VALUES (?, ?, ?)'
  ).bind(id, clerkId, email).run()
  return id
}

// ── Track user activity in users_meta ──────────────────────────────────────
async function trackUserActivity(userId, email, env, isAICall = false, tokens = 0, estimatedCost = 0) {
  const emailDomain = email.includes('@') ? email.split('@')[1] : ''
  const now = Math.floor(Date.now() / 1000)

  // Upsert users_meta
  const existing = await env.DB.prepare('SELECT * FROM users_meta WHERE id = ?').bind(userId).first()

  if (existing) {
    // Update existing
    const newTotalGens = existing.total_generations + (isAICall ? 1 : 0)
    const newTotalTokens = existing.total_tokens_used + tokens
    const newCost = existing.estimated_cost_usd + estimatedCost

    await env.DB.prepare(
      'UPDATE users_meta SET last_active = ?, total_generations = ?, total_tokens_used = ?, estimated_cost_usd = ? WHERE id = ?'
    ).bind(now, newTotalGens, newTotalTokens, newCost, userId).run()
  } else {
    // Insert new
    await env.DB.prepare(
      `INSERT INTO users_meta (id, email, email_domain, first_seen, last_active, total_generations, total_tokens_used, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, email, emailDomain, now, now, isAICall ? 1 : 0, tokens, estimatedCost).run()
  }
}

// ── Check if user is suspended ──────────────────────────────────────────────
async function checkSuspended(userId, env) {
  const meta = await env.DB.prepare('SELECT suspended FROM users_meta WHERE id = ?').bind(userId).first()
  return meta?.suspended === 1
}

// ── Route handlers ───────────────────────────────────────────────────────────

// ── Token pricing (per 1M tokens) ─────────────────────────────────────────
const PRICING = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
}

// ── Usage tier limits (monthly) ────────────────────────────────────────────
const TIER_LIMITS = {
  'individual': 15.00,
  'lab': 40.00,
  'unlimited': Infinity,
}

// ── Max tokens per feature ─────────────────────────────────────────────────
const MAX_TOKENS_BY_FEATURE = {
  'extract_study': 300,
  'compress_grant': 300,
  'section_summary': 200,
  'compliance': 500,
  'letter': 800,
  'score_section': 600,
  'pd_review': 1000,
  'write_aims': 1200,
  'write_sig': 1000,
  'write_innov': 1000,
  'write_approach': 2500,
  'write_facilities': 800,
  'write_commercial': 1500,
  'reviewer_critique': 1000,
  'summary_statement': 1500,
  'advisory_council': 800,
  'biosketch': 1500,
  'polish': 1000,
  'default': 1000,
}

async function checkMonthlyBudget(userId, env, estimatedCost) {
  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`

  // Get user's tier
  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first()
  const tier = user?.plan || 'individual'
  const limit = TIER_LIMITS[tier] || TIER_LIMITS['individual']

  // Calculate current month's spend
  const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).getTime() / 1000
  const usage = await env.DB.prepare(
    `SELECT SUM(input_tokens) as total_input, SUM(output_tokens) as total_output, model
     FROM usage_log
     WHERE user_id = ? AND created_at >= ?
     GROUP BY model`
  ).bind(userId, startOfMonth).all()

  let currentSpend = 0
  for (const row of usage.results || []) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    currentSpend += (row.total_input / 1000000) * pricing.input
    currentSpend += (row.total_output / 1000000) * pricing.output
  }

  if (currentSpend + estimatedCost > limit) {
    return { allowed: false, currentSpend, limit, tier }
  }

  return { allowed: true, currentSpend, limit, tier }
}

async function handleAI(req, env, userId, userEmail) {
  const allowed = await checkRateLimit(userId, env, '/api/ai')
  if (!allowed) return err('Rate limit exceeded — 30 requests per hour', 429)

  const body = await req.json()

  // Model validation
  const allowed_models = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']
  if (!allowed_models.includes(body.model)) {
    body.model = 'claude-sonnet-4-20250514'
  }

  // Set max_tokens based on feature
  const feature = body._action || 'default'
  const featureMaxTokens = MAX_TOKENS_BY_FEATURE[feature] || MAX_TOKENS_BY_FEATURE['default']
  body.max_tokens = Math.min(body.max_tokens || featureMaxTokens, featureMaxTokens)

  // Add prompt caching to system prompts if provided
  if (body.system && typeof body.system === 'string') {
    body.system = [
      {
        type: 'text',
        text: body.system,
        cache_control: { type: 'ephemeral' }
      }
    ]
  }

  // Estimate cost for budget check
  const estimatedInputTokens = JSON.stringify(body).length / 4 // rough estimate
  const pricing = PRICING[body.model]
  const estimatedCost = (estimatedInputTokens / 1000000) * pricing.input + (body.max_tokens / 1000000) * pricing.output

  const budgetCheck = await checkMonthlyBudget(userId, env, estimatedCost)
  if (!budgetCheck.allowed) {
    return err(`Monthly budget exceeded. Current: $${budgetCheck.currentSpend.toFixed(2)} / $${budgetCheck.limit.toFixed(2)} (${budgetCheck.tier} tier)`, 429)
  }

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })

  const result = await resp.json()

  // Log usage with model and feature
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const cacheCreationTokens = result.usage?.cache_creation_input_tokens || 0
  const cacheReadTokens = result.usage?.cache_read_input_tokens || 0

  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(),
    userId,
    feature,
    body.model,
    inputTokens,
    outputTokens,
    cacheCreationTokens,
    cacheReadTokens,
    Math.floor(Date.now() / 1000)
  ).run()

  // Calculate actual cost and track user activity
  const actualInputCost = (inputTokens / 1000000) * pricing.input
  const actualOutputCost = (outputTokens / 1000000) * pricing.output
  const actualCacheCreationCost = (cacheCreationTokens / 1000000) * pricing.input
  const actualCacheReadCost = (cacheReadTokens / 1000000) * (pricing.input * 0.1)
  const totalCost = actualInputCost + actualOutputCost + actualCacheCreationCost + actualCacheReadCost
  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens

  await trackUserActivity(userId, userEmail, env, true, totalTokens, totalCost)

  return json(result)
}

async function handleListProjects(req, env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT id, title, mechanism, updated_at, created_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC'
  ).bind(userId).all()
  return json(results)
}

async function handleCreateProject(req, env, userId) {
  const body = await req.json()
  const id = crypto.randomUUID()
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT INTO projects (id, user_id, title, mechanism, setup, sections, scores, section_summaries, compressed_grant, is_resubmission, introduction, study_section, review_status, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId,
    body.title || 'Untitled grant',
    body.mechanism || 'STTR-I',
    JSON.stringify(body.setup || {}),
    JSON.stringify(body.sections || {}),
    JSON.stringify(body.scores || {}),
    JSON.stringify(body.section_summaries || {}),
    body.compressed_grant || null,
    body.is_resubmission ? 1 : 0,
    body.introduction || null,
    body.study_section || null,
    body.review_status || 'pending',
    now, now
  ).run()

  // Increment total_grants in users_meta
  await env.DB.prepare(
    'UPDATE users_meta SET total_grants = total_grants + 1 WHERE id = ?'
  ).bind(userId).run()

  return json({ id, title: body.title, mechanism: body.mechanism, created_at: now }, 201)
}

async function handleGetProject(req, env, userId, projectId) {
  const row = await env.DB.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!row) return err('Project not found', 404)
  row.setup = JSON.parse(row.setup || '{}')
  row.sections = JSON.parse(row.sections || '{}')
  row.scores = JSON.parse(row.scores || '{}')
  row.section_summaries = JSON.parse(row.section_summaries || '{}')
  row.is_resubmission = row.is_resubmission === 1
  return json(row)
}

async function handleUpdateProject(req, env, userId, projectId) {
  const body = await req.json()
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    'UPDATE projects SET title = ?, mechanism = ?, setup = ?, sections = ?, scores = ?, section_summaries = ?, compressed_grant = ?, is_resubmission = ?, introduction = ?, study_section = ?, review_status = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(
    body.title || 'Untitled grant',
    body.mechanism || 'STTR-I',
    JSON.stringify(body.setup || {}),
    JSON.stringify(body.sections || {}),
    JSON.stringify(body.scores || {}),
    JSON.stringify(body.section_summaries || {}),
    body.compressed_grant || null,
    body.is_resubmission ? 1 : 0,
    body.introduction || null,
    body.study_section || null,
    body.review_status || 'pending',
    now, projectId, userId
  ).run()
  if (result.changes === 0) return err('Project not found', 404)
  return json({ ok: true, updated_at: now })
}

async function handleDeleteProject(req, env, userId, projectId) {
  await env.DB.prepare(
    'DELETE FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).run()
  return json({ ok: true })
}

async function handleUsage(req, env, userId) {
  // Get current month's usage
  const now = new Date()
  const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).getTime() / 1000

  const monthlyUsage = await env.DB.prepare(
    `SELECT
       model,
       SUM(input_tokens) as input_tokens,
       SUM(output_tokens) as output_tokens,
       SUM(cache_creation_tokens) as cache_creation_tokens,
       SUM(cache_read_tokens) as cache_read_tokens,
       COUNT(*) as calls
     FROM usage_log
     WHERE user_id = ? AND created_at >= ?
     GROUP BY model`
  ).bind(userId, startOfMonth).all()

  // Calculate costs
  let totalCost = 0
  const breakdown = []

  for (const row of monthlyUsage.results || []) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    const inputCost = (row.input_tokens / 1000000) * pricing.input
    const outputCost = (row.output_tokens / 1000000) * pricing.output
    const cacheCreationCost = (row.cache_creation_tokens / 1000000) * pricing.input
    const cacheReadCost = (row.cache_read_tokens / 1000000) * (pricing.input * 0.1) // 90% discount

    const modelCost = inputCost + outputCost + cacheCreationCost + cacheReadCost
    totalCost += modelCost

    breakdown.push({
      model: row.model,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_creation_tokens: row.cache_creation_tokens,
      cache_read_tokens: row.cache_read_tokens,
      calls: row.calls,
      cost: modelCost
    })
  }

  // Get user's tier
  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first()
  const tier = user?.plan || 'individual'
  const limit = TIER_LIMITS[tier] || TIER_LIMITS['individual']

  // All-time usage
  const allTimeUsage = await env.DB.prepare(
    `SELECT
       COUNT(*) as total_calls,
       SUM(input_tokens) as total_input,
       SUM(output_tokens) as total_output
     FROM usage_log WHERE user_id = ?`
  ).bind(userId).first()

  return json({
    monthly: {
      cost: totalCost,
      limit: limit,
      tier: tier,
      percentage: (totalCost / limit) * 100,
      breakdown: breakdown
    },
    all_time: {
      total_calls: allTimeUsage.total_calls || 0,
      total_input: allTimeUsage.total_input || 0,
      total_output: allTimeUsage.total_output || 0,
      total_tokens: (allTimeUsage.total_input || 0) + (allTimeUsage.total_output || 0)
    }
  })
}

// ── Health check (public) ────────────────────────────────────────────────────
async function handleHealth(req, env) {
  return json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: env.WORKER_VERSION || '3.0.0'
  })
}

// ── Feedback submission ──────────────────────────────────────────────────────
async function handleFeedback(req, env, userId, userEmail) {
  const body = await req.json()
  const emailDomain = userEmail.includes('@') ? userEmail.split('@')[1] : ''

  await env.DB.prepare(
    'INSERT INTO feedback_log (user_id, email_domain, feedback_type, message, page, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    userId,
    emailDomain,
    body.feedback_type || 'general',
    body.message || '',
    body.page || '',
    Math.floor(Date.now() / 1000)
  ).run()

  return json({ ok: true })
}

// ── ADMIN COMMAND STATION ROUTES ─────────────────────────────────────────────

// Platform Health
async function handleCommandHealth(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const last24h = now - (24 * 3600)

  // Worker error rate (5xx)
  const errors = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM error_log WHERE created_at >= ? AND status_code >= 500'
  ).bind(last24h).first()

  const totalRequests = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM error_log WHERE created_at >= ?'
  ).bind(last24h).first()

  const errorRate = totalRequests.count > 0 ? (errors.count / totalRequests.count) * 100 : 0

  // Average API latency
  const avgLatency = await env.DB.prepare(
    'SELECT AVG(response_time_ms) as avg FROM error_log WHERE created_at >= ?'
  ).bind(last24h).first()

  // Anthropic API error rate
  const claudeErrors = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM usage_log WHERE created_at >= ? AND (input_tokens = 0 OR output_tokens = 0)'
  ).bind(last24h).first()

  const claudeCalls = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM usage_log WHERE created_at >= ?'
  ).bind(last24h).first()

  const claudeErrorRate = claudeCalls.count > 0 ? (claudeErrors.count / claudeCalls.count) * 100 : 0

  // D1 row counts
  const tables = ['projects', 'usage_log', 'users', 'users_meta', 'error_log', 'feedback_log']
  const rowCounts = {}
  for (const table of tables) {
    const result = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first()
    rowCounts[table] = result.count
  }

  // KV rate limit hits
  const rateLimitHits = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM rate_limit_log WHERE created_at >= ?'
  ).bind(last24h).first()

  // Last 10 deployments
  const deployments = await env.DB.prepare(
    'SELECT * FROM deployments_log ORDER BY started_at DESC LIMIT 10'
  ).all()

  // Last 20 errors
  const recentErrors = await env.DB.prepare(
    'SELECT * FROM error_log ORDER BY created_at DESC LIMIT 20'
  ).all()

  return json({
    error_rate: errorRate.toFixed(2),
    avg_latency_ms: avgLatency.avg?.toFixed(1) || 0,
    claude_error_rate: claudeErrorRate.toFixed(2),
    rate_limit_hits: rateLimitHits.count,
    row_counts: rowCounts,
    deployments: deployments.results,
    recent_errors: recentErrors.results
  })
}

// User Management
async function handleCommandUsers(req, env) {
  const allUsers = await env.DB.prepare(
    'SELECT * FROM users_meta ORDER BY last_active DESC'
  ).all()

  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - (7 * 24 * 3600)
  const thirtyDaysAgo = now - (30 * 24 * 3600)

  const stats = {
    total: allUsers.results.length,
    paying: allUsers.results.filter(u => u.plan_tier !== 'free').length,
    free: allUsers.results.filter(u => u.plan_tier === 'free').length,
    active_7d: allUsers.results.filter(u => u.last_active >= sevenDaysAgo).length,
    active_30d: allUsers.results.filter(u => u.last_active >= thirtyDaysAgo).length,
    never_active: allUsers.results.filter(u => u.total_generations === 0).length
  }

  return json({ stats, users: allUsers.results })
}

async function handleCommandUserUpdate(req, env, userId) {
  const body = await req.json()
  const adminUserId = body.admin_user_id || 'unknown'

  if (body.suspended !== undefined) {
    await env.DB.prepare(
      'UPDATE users_meta SET suspended = ? WHERE id = ?'
    ).bind(body.suspended ? 1 : 0, userId).run()

    await env.DB.prepare(
      'INSERT INTO admin_actions (action_type, entity, entity_id, old_value, new_value, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('user_suspend', 'user', userId, '0', body.suspended ? '1' : '0', adminUserId).run()
  }

  if (body.plan_tier) {
    const old = await env.DB.prepare('SELECT plan_tier FROM users_meta WHERE id = ?').bind(userId).first()
    await env.DB.prepare(
      'UPDATE users_meta SET plan_tier = ? WHERE id = ?'
    ).bind(body.plan_tier, userId).run()

    await env.DB.prepare(
      'INSERT INTO admin_actions (action_type, entity, entity_id, old_value, new_value, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind('user_tier_change', 'user', userId, old?.plan_tier || 'free', body.plan_tier, adminUserId).run()
  }

  if (body.notes !== undefined) {
    await env.DB.prepare(
      'UPDATE users_meta SET notes = ? WHERE id = ?'
    ).bind(body.notes, userId).run()
  }

  return json({ ok: true })
}

// Revenue Operations
async function handleCommandRevenue(req, env) {
  const mrrEvents = await env.DB.prepare(
    'SELECT * FROM mrr_events ORDER BY recorded_at DESC'
  ).all()

  // Calculate MRR waterfall for current month
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000

  const monthEvents = mrrEvents.results.filter(e => e.recorded_at >= startOfMonth)

  const waterfall = {
    new_mrr: monthEvents.filter(e => e.event_type === 'new').reduce((sum, e) => sum + (e.mrr_delta || 0), 0),
    expansion_mrr: monthEvents.filter(e => e.event_type === 'expansion').reduce((sum, e) => sum + (e.mrr_delta || 0), 0),
    contraction_mrr: monthEvents.filter(e => e.event_type === 'contraction').reduce((sum, e) => sum + (e.mrr_delta || 0), 0),
    churn_mrr: monthEvents.filter(e => e.event_type === 'churn').reduce((sum, e) => sum + (e.mrr_delta || 0), 0)
  }

  // Tier breakdown
  const users = await env.DB.prepare('SELECT * FROM users_meta').all()
  const tierBreakdown = {
    individual: { count: 0, mrr: 0 },
    lab: { count: 0, mrr: 0 },
    institution: { count: 0, mrr: 0 }
  }

  for (const user of users.results) {
    if (user.plan_tier === 'individual') {
      tierBreakdown.individual.count++
      tierBreakdown.individual.mrr += 99
    } else if (user.plan_tier === 'lab') {
      tierBreakdown.lab.count++
      tierBreakdown.lab.mrr += 299
    }
  }

  return json({ waterfall, tier_breakdown: tierBreakdown, all_events: mrrEvents.results })
}

async function handleCommandMRREventsGet(req, env) {
  const events = await env.DB.prepare(
    'SELECT * FROM mrr_events ORDER BY recorded_at DESC'
  ).all()
  return json(events.results)
}

async function handleCommandMRREventsPost(req, env) {
  const body = await req.json()
  await env.DB.prepare(
    'INSERT INTO mrr_events (event_type, user_id, plan_from, plan_to, mrr_delta, recorded_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(
    body.event_type,
    body.user_id || null,
    body.plan_from || null,
    body.plan_to || null,
    body.mrr_delta || 0,
    Math.floor(Date.now() / 1000)
  ).run()

  return json({ ok: true })
}

// AI Cost Monitoring
async function handleCommandAICosts(req, env) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000

  // Today's spend
  const todayUsage = await env.DB.prepare(
    'SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM usage_log WHERE created_at >= ? GROUP BY model'
  ).bind(startOfToday).all()

  let todaySpend = 0
  for (const row of todayUsage.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    todaySpend += (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
  }

  // This month's spend
  const monthUsage = await env.DB.prepare(
    'SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM usage_log WHERE created_at >= ? GROUP BY model'
  ).bind(startOfMonth).all()

  let monthSpend = 0
  for (const row of monthUsage.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    monthSpend += (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
  }

  // Cost by feature
  const byFeature = await env.DB.prepare(
    'SELECT action, COUNT(*) as calls, SUM(input_tokens) as input, SUM(output_tokens) as output, model FROM usage_log WHERE created_at >= ? GROUP BY action, model'
  ).bind(startOfMonth).all()

  const featureCosts = []
  for (const row of byFeature.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    const cost = (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
    featureCosts.push({
      feature: row.action,
      calls: row.calls,
      input_tokens: row.input,
      output_tokens: row.output,
      cost: cost,
      model: row.model
    })
  }

  // Cost by model
  const modelCosts = []
  for (const row of monthUsage.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    const cost = (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
    modelCosts.push({
      model: row.model,
      input_tokens: row.input,
      output_tokens: row.output,
      cost: cost
    })
  }

  // Cost by user (top 20)
  const byUser = await env.DB.prepare(
    `SELECT u.email, u.email_domain, u.plan_tier, u.estimated_cost_usd, u.total_generations
     FROM users_meta u
     ORDER BY u.estimated_cost_usd DESC
     LIMIT 20`
  ).all()

  return json({
    today_spend: todaySpend,
    month_spend: monthSpend,
    by_feature: featureCosts,
    by_model: modelCosts,
    by_user: byUser.results
  })
}

// Grant Intelligence
async function handleCommandGrants(req, env) {
  // Mechanism popularity
  const mechanisms = await env.DB.prepare(
    'SELECT mechanism, COUNT(*) as count FROM projects GROUP BY mechanism ORDER BY count DESC'
  ).all()

  // Total projects
  const totalProjects = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM projects'
  ).first()

  // Projects with at least one section
  const withSections = await env.DB.prepare(
    `SELECT COUNT(*) as count FROM projects WHERE sections != '{}' AND sections != ''`
  ).first()

  return json({
    mechanisms: mechanisms.results,
    total_projects: totalProjects.count,
    with_sections: withSections.count
  })
}

// Product Health
async function handleCommandProduct(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - (7 * 24 * 3600)

  // Feature usage from usage_log
  const features = await env.DB.prepare(
    'SELECT action, COUNT(*) as total_uses, COUNT(DISTINCT user_id) as unique_users FROM usage_log GROUP BY action'
  ).all()

  const last7Days = await env.DB.prepare(
    'SELECT action, COUNT(*) as uses_7d FROM usage_log WHERE created_at >= ? GROUP BY action'
  ).bind(sevenDaysAgo).all()

  // Merge results
  const featureUsage = features.results.map(f => {
    const recent = last7Days.results.find(r => r.action === f.action)
    return {
      feature: f.action,
      total_uses: f.total_uses,
      uses_7d: recent?.uses_7d || 0,
      unique_users: f.unique_users
    }
  })

  return json({ feature_usage: featureUsage })
}

// Security & Compliance
async function handleCommandSecurity(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const last24h = now - (24 * 3600)

  // Failed auth attempts (401s)
  const failedAuth = await env.DB.prepare(
    'SELECT endpoint, COUNT(*) as count FROM error_log WHERE created_at >= ? AND status_code = 401 GROUP BY endpoint ORDER BY count DESC'
  ).bind(last24h).all()

  // Suspended users
  const suspended = await env.DB.prepare(
    'SELECT * FROM users_meta WHERE suspended = 1'
  ).all()

  // Admin actions log
  const adminActions = await env.DB.prepare(
    'SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT 50'
  ).all()

  // Unusual activity (>50 generations in a day)
  const unusual = await env.DB.prepare(
    `SELECT user_id, COUNT(*) as count, SUM(input_tokens + output_tokens) as tokens
     FROM usage_log
     WHERE created_at >= ?
     GROUP BY user_id
     HAVING count > 50
     ORDER BY count DESC`
  ).bind(now - (24 * 3600)).all()

  return json({
    failed_auth: failedAuth.results,
    suspended_users: suspended.results,
    admin_actions: adminActions.results,
    unusual_activity: unusual.results
  })
}

// Feedback Management
async function handleCommandFeedbackGet(req, env) {
  const feedback = await env.DB.prepare(
    'SELECT * FROM feedback_log ORDER BY created_at DESC'
  ).all()

  const stats = {
    total: feedback.results.length,
    bugs: feedback.results.filter(f => f.feedback_type === 'bug').length,
    features: feedback.results.filter(f => f.feedback_type === 'feature').length,
    resolved: feedback.results.filter(f => f.resolved === 1).length
  }

  return json({ stats, feedback: feedback.results })
}

async function handleCommandFeedbackPatch(req, env, feedbackId) {
  const body = await req.json()

  if (body.resolved !== undefined) {
    await env.DB.prepare(
      'UPDATE feedback_log SET resolved = ? WHERE id = ?'
    ).bind(body.resolved ? 1 : 0, feedbackId).run()
  }

  if (body.admin_notes !== undefined) {
    await env.DB.prepare(
      'UPDATE feedback_log SET admin_notes = ? WHERE id = ?'
    ).bind(body.admin_notes, feedbackId).run()
  }

  return json({ ok: true })
}

async function handleCommandFeedbackCluster(req, env) {
  // Get all feature request messages
  const requests = await env.DB.prepare(
    'SELECT message FROM feedback_log WHERE feedback_type = ? AND resolved = 0'
  ).bind('feature').all()

  if (requests.results.length === 0) {
    return json({ themes: [] })
  }

  // Use Claude Haiku to cluster them
  const messages = requests.results.map(r => r.message).join('\n\n---\n\n')
  const prompt = `Analyze these feature requests and group them into 5-7 themes. For each theme, provide a short label and count how many requests match it. Return only valid JSON: [{"theme":"...", "count":N, "example":"..."}]

Feature requests:
${messages}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    }),
  })

  const result = await resp.json()
  const text = result.content[0].text.replace(/```json|```/g, '').trim()
  const themes = JSON.parse(text)

  return json({ themes })
}

// ── Main fetch handler ───────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const startTime = Date.now()
    const url = new URL(req.url)
    const path = url.pathname

    try {
      // CORS preflight
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS })
      }

      // Public health check (no auth)
      if (path === '/api/health' && req.method === 'GET') {
        const response = await handleHealth(req, env)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, null, env)
        return response
      }

      // Auth required for all other routes
      const payload = await requireAuth(req, env)
      if (!payload) {
        const responseTime = Date.now() - startTime
        await logError(path, 401, 'Unauthorized', responseTime, null, env)
        return err('Unauthorized', 401)
      }

      const userId = await ensureUser(payload, env)
      const userEmail = payload.email || payload['email_address'] || ''

      // Check if user is suspended
      const isSuspended = await checkSuspended(userId, env)
      if (isSuspended) {
        const responseTime = Date.now() - startTime
        await logError(path, 403, 'User suspended', responseTime, userId, env)
        return err('Account suspended. Contact support.', 403)
      }

      // Track user activity (not for admin routes)
      if (!path.startsWith('/api/command')) {
        await trackUserActivity(userId, userEmail, env)
      }

      // ── Public authenticated routes ──────────────────────────────────────────
      if (path === '/api/ai' && req.method === 'POST') {
        const response = await handleAI(req, env, userId, userEmail)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/feedback' && req.method === 'POST') {
        const response = await handleFeedback(req, env, userId, userEmail)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/projects' && req.method === 'GET') {
        const response = await handleListProjects(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/projects' && req.method === 'POST') {
        const response = await handleCreateProject(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 201, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/usage' && req.method === 'GET') {
        const response = await handleUsage(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      const projectMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)$/)
      if (projectMatch) {
        const projectId = projectMatch[1]
        let response
        if (req.method === 'GET') response = await handleGetProject(req, env, userId, projectId)
        else if (req.method === 'PUT') response = await handleUpdateProject(req, env, userId, projectId)
        else if (req.method === 'DELETE') response = await handleDeleteProject(req, env, userId, projectId)

        if (response) {
          const responseTime = Date.now() - startTime
          await logError(path, 200, null, responseTime, userId, env)
          return response
        }
      }

      // ── Admin command station routes ─────────────────────────────────────────
      if (path.startsWith('/api/command')) {
        const adminPayload = await requireAdmin(req, env)
        if (!adminPayload) {
          const responseTime = Date.now() - startTime
          await logError(path, 403, 'Admin access required', responseTime, userId, env)
          return err('Admin access required', 403)
        }

        if (path === '/api/command/health' && req.method === 'GET')
          return handleCommandHealth(req, env)

        if (path === '/api/command/users' && req.method === 'GET')
          return handleCommandUsers(req, env)

        const userUpdateMatch = path.match(/^\/api\/command\/users\/([^/]+)$/)
        if (userUpdateMatch && req.method === 'PATCH') {
          return handleCommandUserUpdate(req, env, userUpdateMatch[1])
        }

        if (path === '/api/command/revenue' && req.method === 'GET')
          return handleCommandRevenue(req, env)

        if (path === '/api/command/mrr-events' && req.method === 'GET')
          return handleCommandMRREventsGet(req, env)

        if (path === '/api/command/mrr-events' && req.method === 'POST')
          return handleCommandMRREventsPost(req, env)

        if (path === '/api/command/ai-costs' && req.method === 'GET')
          return handleCommandAICosts(req, env)

        if (path === '/api/command/grants' && req.method === 'GET')
          return handleCommandGrants(req, env)

        if (path === '/api/command/product' && req.method === 'GET')
          return handleCommandProduct(req, env)

        if (path === '/api/command/security' && req.method === 'GET')
          return handleCommandSecurity(req, env)

        if (path === '/api/command/feedback' && req.method === 'GET')
          return handleCommandFeedbackGet(req, env)

        const feedbackMatch = path.match(/^\/api\/command\/feedback\/(\d+)$/)
        if (feedbackMatch && req.method === 'PATCH') {
          return handleCommandFeedbackPatch(req, env, feedbackMatch[1])
        }

        if (path === '/api/command/feedback/cluster' && req.method === 'POST')
          return handleCommandFeedbackCluster(req, env)
      }

      const responseTime = Date.now() - startTime
      await logError(path, 404, 'Not found', responseTime, userId, env)
      return err('Not found', 404)

    } catch (error) {
      const responseTime = Date.now() - startTime
      await logError(path, 500, error.message, responseTime, null, env)
      return err('Internal server error', 500)
    }
  },
}
