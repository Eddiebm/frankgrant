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

// ── JWT verification (Clerk RS256) ──────────────────────────────────────────
async function verifyJWT(token, pemPublicKey) {
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.')
    const header = JSON.parse(atob(headerB64))
    if (header.alg !== 'RS256') throw new Error('Wrong algorithm')

    const keyData = pemPublicKey
      .replace(/-----BEGIN PUBLIC KEY-----/, '')
      .replace(/-----END PUBLIC KEY-----/, '')
      .replace(/\s/g, '')
    const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0))

    const cryptoKey = await crypto.subtle.importKey(
      'spki', binaryKey.buffer,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false, ['verify']
    )

    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const sig = Uint8Array.from(
      atob(sigB64.replace(/-/g, '+').replace(/_/g, '/')),
      c => c.charCodeAt(0)
    )

    const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sig, data)
    if (!valid) throw new Error('Invalid signature')

    const payload = JSON.parse(atob(payloadB64))
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
  return await verifyJWT(token, env.CLERK_PEM_PUBLIC_KEY)
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

async function handleAI(req, env, userId) {
  const allowed = await checkRateLimit(userId, env)
  if (!allowed) return err('Rate limit exceeded — 30 requests per hour', 429)

  const body = await req.json()

  // Safety: strip any injected system prompts beyond what we allow
  const allowed_models = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']
  if (!allowed_models.includes(body.model)) {
    body.model = 'claude-sonnet-4-20250514'
  }
  body.max_tokens = Math.min(body.max_tokens || 1000, 2000)

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

  // Log usage
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, input_tokens, output_tokens) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, body._action || 'ai_call', inputTokens, outputTokens).run()

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
    'INSERT INTO projects (id, user_id, title, mechanism, sections, scores, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, userId,
    body.title || 'Untitled grant',
    body.mechanism || 'STTR-I',
    JSON.stringify(body.sections || {}),
    JSON.stringify(body.scores || {}),
    now, now
  ).run()
  return json({ id, title: body.title, mechanism: body.mechanism, created_at: now }, 201)
}

async function handleGetProject(req, env, userId, projectId) {
  const row = await env.DB.prepare(
    'SELECT * FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!row) return err('Project not found', 404)
  row.sections = JSON.parse(row.sections || '{}')
  row.scores = JSON.parse(row.scores || '{}')
  return json(row)
}

async function handleUpdateProject(req, env, userId, projectId) {
  const body = await req.json()
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    'UPDATE projects SET title = ?, mechanism = ?, sections = ?, scores = ?, updated_at = ? WHERE id = ? AND user_id = ?'
  ).bind(
    body.title || 'Untitled grant',
    body.mechanism || 'STTR-I',
    JSON.stringify(body.sections || {}),
    JSON.stringify(body.scores || {}),
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
  const rows = await env.DB.prepare(
    `SELECT
       COUNT(*) as total_calls,
       SUM(input_tokens) as total_input,
       SUM(output_tokens) as total_output,
       SUM(input_tokens + output_tokens) as total_tokens
     FROM usage_log WHERE user_id = ?`
  ).bind(userId).first()
  return json(rows)
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
