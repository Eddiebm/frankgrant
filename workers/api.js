/**
 * FrankGrant API Worker
 * Handles: auth validation, AI proxy, project CRUD, usage logging
 *
 * Routes:
 *   POST /api/ai          → proxy to Anthropic (auth required)
 *   GET  /api/projects    → list user's projects
 *   POST /api/projects    → create project
 *   GET  /api/projects/:id → get project
 *   PUT  /api/projects/:id → update project
 *   DELETE /api/projects/:id → delete project
 *   GET  /api/usage       → usage stats for user
 *   POST /api/users/sync  → upsert user from Clerk webhook
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
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

// ── Rate limiting via KV ─────────────────────────────────────────────────────
async function checkRateLimit(userId, env, limit = 30) {
  const key = `rate:${userId}:${Math.floor(Date.now() / 3600000)}`
  const current = parseInt(await env.KV.get(key) || '0')
  if (current >= limit) return false
  await env.KV.put(key, current + 1, { expirationTtl: 7200 })
  return true
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

async function handleAI(req, env, userId) {
  const allowed = await checkRateLimit(userId, env)
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

// ── Main fetch handler ───────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    const url = new URL(req.url)
    const path = url.pathname

    // CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    // Auth (all routes except OPTIONS)
    const payload = await requireAuth(req, env)
    if (!payload) return err('Unauthorized', 401)
    const userId = await ensureUser(payload, env)

    // Route
    if (path === '/api/ai' && req.method === 'POST')
      return handleAI(req, env, userId)

    if (path === '/api/projects' && req.method === 'GET')
      return handleListProjects(req, env, userId)

    if (path === '/api/projects' && req.method === 'POST')
      return handleCreateProject(req, env, userId)

    if (path === '/api/usage' && req.method === 'GET')
      return handleUsage(req, env, userId)

    const projectMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)$/)
    if (projectMatch) {
      const projectId = projectMatch[1]
      if (req.method === 'GET') return handleGetProject(req, env, userId, projectId)
      if (req.method === 'PUT') return handleUpdateProject(req, env, userId, projectId)
      if (req.method === 'DELETE') return handleDeleteProject(req, env, userId, projectId)
    }

    return err('Not found', 404)
  },
}
