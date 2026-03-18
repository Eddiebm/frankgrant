/**
 * FrankGrant API Worker v4.2.0
 * Handles: auth validation, AI proxy, project CRUD, usage logging, admin monitoring,
 *          FOA parsing, NIH Reporter search, inline compliance checking,
 *          preliminary data upload/analysis/narrative, PubMed citations
 */

const ADMIN_EMAIL = 'eddieb@coareholdings.com'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
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

function base64urlToBase64(str) {
  return str.replace(/-/g, '+').replace(/_/g, '/')
}

async function jwkToCryptoKey(jwk) {
  return await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg, ext: true },
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

    const jwksResp = await fetch(CLERK_JWKS_URL)
    const jwks = await jwksResp.json()
    const jwk = jwks.keys.find(k => k.kid === header.kid)
    if (!jwk) throw new Error('Key not found')

    const cryptoKey = await jwkToCryptoKey(jwk)
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`)
    const sig = Uint8Array.from(atob(base64urlToBase64(sigB64)), c => c.charCodeAt(0))

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
    await env.DB.prepare(
      'INSERT INTO rate_limit_log (user_id, endpoint, created_at) VALUES (?, ?, ?)'
    ).bind(userId, endpoint, Math.floor(Date.now() / 1000)).run()
    return false
  }
  await env.KV.put(key, current + 1, { expirationTtl: 7200 })
  return true
}

async function logError(endpoint, statusCode, errorMessage, responseTime, userId, env) {
  try {
    await env.DB.prepare(
      'INSERT INTO error_log (endpoint, status_code, error_message, response_time_ms, user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(endpoint, statusCode, errorMessage || null, responseTime, userId || null, Math.floor(Date.now() / 1000)).run()
  } catch (e) {
    console.error('Failed to log error:', e)
  }
}

async function ensureUser(clerkPayload, env) {
  const clerkId = clerkPayload.sub
  const email = clerkPayload.email || clerkPayload['email_address'] || ''
  const existing = await env.DB.prepare('SELECT id FROM users WHERE clerk_id = ?').bind(clerkId).first()
  if (existing) return existing.id

  const id = crypto.randomUUID()
  await env.DB.prepare('INSERT INTO users (id, clerk_id, email) VALUES (?, ?, ?)').bind(id, clerkId, email).run()
  return id
}

async function trackUserActivity(userId, email, env, isAICall = false, tokens = 0, estimatedCost = 0) {
  const emailDomain = email.includes('@') ? email.split('@')[1] : ''
  const now = Math.floor(Date.now() / 1000)
  const existing = await env.DB.prepare('SELECT * FROM users_meta WHERE id = ?').bind(userId).first()

  if (existing) {
    await env.DB.prepare(
      'UPDATE users_meta SET last_active = ?, total_generations = ?, total_tokens_used = ?, estimated_cost_usd = ? WHERE id = ?'
    ).bind(now, existing.total_generations + (isAICall ? 1 : 0), existing.total_tokens_used + tokens, existing.estimated_cost_usd + estimatedCost, userId).run()
  } else {
    await env.DB.prepare(
      `INSERT INTO users_meta (id, email, email_domain, first_seen, last_active, total_generations, total_tokens_used, estimated_cost_usd)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(userId, email, emailDomain, now, now, isAICall ? 1 : 0, tokens, estimatedCost).run()
  }
}

async function checkSuspended(userId, env) {
  const meta = await env.DB.prepare('SELECT suspended FROM users_meta WHERE id = ?').bind(userId).first()
  return meta?.suspended === 1
}

// ── Token pricing (per 1M tokens) ─────────────────────────────────────────
const PRICING = {
  'claude-sonnet-4-20250514': { input: 3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input: 0.25, output: 1.25 },
}

const TIER_LIMITS = {
  'individual': 15.00,
  'lab': 40.00,
  'unlimited': Infinity,
}

const MAX_TOKENS_BY_FEATURE = {
  'extract_study': 300,
  'compress_grant': 300,
  'section_summary': 200,
  'compliance': 500,
  'letter': 800,
  'score_section': 600,
  'pd_review': 1000,
  'write_summary': 800,
  'write_narrative': 300,
  'write_aims': 1200,
  'write_sig': 1000,
  'write_innov': 1000,
  'write_approach': 2500,
  'write_data_mgmt': 1000,
  'write_facilities': 800,
  'write_commercial': 1500,
  'reviewer_critique': 1000,
  'summary_statement': 1500,
  'advisory_council': 800,
  'biosketch': 1500,
  'polish': 1000,
  'foa_extract': 800,
  'grant_analyze': 800,
  'section_compliance': 500,
  'prelim_describe': 600,
  'prelim_narrative': 1500,
  'prelim_analyze': 800,
  'citations': 200,
  'default': 1000,
}

async function checkMonthlyBudget(userId, env, estimatedCost) {
  const now = new Date()
  const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).getTime() / 1000

  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first()
  const tier = user?.plan || 'individual'
  const limit = TIER_LIMITS[tier] || TIER_LIMITS['individual']

  const usage = await env.DB.prepare(
    `SELECT SUM(input_tokens) as total_input, SUM(output_tokens) as total_output, model
     FROM usage_log WHERE user_id = ? AND created_at >= ? GROUP BY model`
  ).bind(userId, startOfMonth).all()

  let currentSpend = 0
  for (const row of usage.results || []) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    currentSpend += (row.total_input / 1000000) * pricing.input
    currentSpend += (row.total_output / 1000000) * pricing.output
  }

  return currentSpend + estimatedCost > limit
    ? { allowed: false, currentSpend, limit, tier }
    : { allowed: true, currentSpend, limit, tier }
}

// ── Section compliance check (runs non-blocking via waitUntil) ─────────────
async function runSectionCompliance(sectionId, sectionText, mechanism, projectId, userId, env) {
  try {
    if (!sectionText || sectionText.length < 50) return

    const sectionLabels = {
      aims: 'Specific Aims', sig: 'Significance', innov: 'Innovation',
      approach: 'Approach', summary: 'Project Summary', narrative: 'Project Narrative',
      data_mgmt: 'Data Management Plan', facilities: 'Facilities', commercial: 'Commercialization',
    }
    const label = sectionLabels[sectionId] || sectionId

    const pageLimits = {
      aims: '1 page (~275 words)',
      sig: mechanism.includes('STTR-I') || mechanism.includes('SBIR-I') || mechanism === 'R21'
        ? '~1.5 pages (25% of 6-page strategy)' : '~3 pages (25% of 12-page strategy)',
      innov: mechanism.includes('STTR-I') || mechanism.includes('SBIR-I') || mechanism === 'R21'
        ? '~0.9 pages (15% of 6-page strategy)' : '~1.8 pages (15% of 12-page strategy)',
      approach: mechanism.includes('STTR-I') || mechanism.includes('SBIR-I') || mechanism === 'R21'
        ? '~3.6 pages (60% of 6-page strategy)' : '~7.2 pages (60% of 12-page strategy)',
      summary: '30 lines (~400 words)',
      narrative: '2-3 sentences (~60 words)',
      data_mgmt: '2 pages (~550 words)',
      commercial: mechanism.includes('-I') ? '2 pages (~550 words)' : '12 pages (~3,300 words)',
    }

    const isSTTR = mechanism.startsWith('STTR')
    const isPhaseII = mechanism.includes('-II') || mechanism === 'NCI-IIB' || mechanism === 'FAST-TRACK'

    const prompt = `You are an NIH compliance reviewer. Check this ${label} section for issues.

Mechanism: ${mechanism}
Estimated page limit: ${pageLimits[sectionId] || 'standard'}
STTR application: ${isSTTR ? 'Yes (requires partner allocation)' : 'No'}
Phase II: ${isPhaseII ? 'Yes (should reference Phase I results)' : 'No'}

SECTION TEXT (first 4000 chars):
${sectionText.slice(0, 4000)}

Check for these issues based on section type:
${sectionId === 'sig' || sectionId === 'approach' ? '- Missing rigor and reproducibility discussion' : ''}
${sectionId === 'approach' ? '- Missing timeline or milestones\n- Missing pitfalls and alternatives' : ''}
${['sig', 'innov', 'approach', 'aims'].includes(sectionId) ? '- Human subjects research mentioned without IRB/protections statement\n- Animal research mentioned without welfare/IACUC statement' : ''}
${isSTTR && sectionId === 'approach' ? '- Missing explicit small business vs. academic partner work allocation percentages' : ''}
${isPhaseII && sectionId === 'approach' ? '- No reference to Phase I results or Go/No-Go criteria met' : ''}
- Missing required structural elements for this section type
- Word count appears to exceed page limit (estimate ~275 words per page)
- Hedge words used (may, might, could, potentially) that weaken the application

Return ONLY valid JSON:
{
  "issues": [
    { "severity": "critical", "element": "Bold label", "description": "What is wrong", "fix": "How to fix it" }
  ]
}
Severity levels: "critical" (submission blocker), "warning" (score risk), "suggestion" (improvement).
If no issues found, return { "issues": [] }.`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const result = await resp.json()
    const raw = result.content?.[0]?.text?.replace(/```json|```/g, '').trim()
    if (!raw) return

    let parsed
    try { parsed = JSON.parse(raw) } catch { return }

    // Load existing compliance_results and merge
    const project = await env.DB.prepare(
      'SELECT compliance_results FROM projects WHERE id = ? AND user_id = ?'
    ).bind(projectId, userId).first()

    let existing = {}
    try { existing = JSON.parse(project?.compliance_results || '{}') } catch { existing = {} }

    existing[sectionId] = {
      issues: parsed.issues || [],
      checked_at: Math.floor(Date.now() / 1000),
    }

    await env.DB.prepare(
      'UPDATE projects SET compliance_results = ? WHERE id = ? AND user_id = ?'
    ).bind(JSON.stringify(existing), projectId, userId).run()

  } catch (e) {
    console.error('Compliance check failed:', e)
  }
}

// ── AI handler ────────────────────────────────────────────────────────────────
async function handleAI(req, env, userId, userEmail, ctx) {
  const allowed = await checkRateLimit(userId, env, '/api/ai')
  if (!allowed) return err('Rate limit exceeded — 30 requests per hour', 429)

  const body = await req.json()

  // Strip internal fields before forwarding to Anthropic
  const projectId = body._project_id
  const mechanism = body._mechanism || 'STTR-I'
  delete body._project_id
  delete body._mechanism

  // Model validation
  const allowed_models = ['claude-sonnet-4-20250514', 'claude-haiku-4-5-20251001']
  if (!allowed_models.includes(body.model)) body.model = 'claude-sonnet-4-20250514'

  // Set max_tokens based on feature
  const feature = body._action || 'default'
  delete body._action
  const featureMaxTokens = MAX_TOKENS_BY_FEATURE[feature] || MAX_TOKENS_BY_FEATURE['default']
  body.max_tokens = Math.min(body.max_tokens || featureMaxTokens, featureMaxTokens)

  // Add prompt caching to system prompts
  if (body.system && typeof body.system === 'string') {
    body.system = [{ type: 'text', text: body.system, cache_control: { type: 'ephemeral' } }]
  }

  // Budget check
  const estimatedInputTokens = JSON.stringify(body).length / 4
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

  // Log usage
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const cacheCreationTokens = result.usage?.cache_creation_input_tokens || 0
  const cacheReadTokens = result.usage?.cache_read_input_tokens || 0

  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), userId, feature, body.model,
    inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens,
    Math.floor(Date.now() / 1000)
  ).run()

  const actualCost = (inputTokens / 1000000) * pricing.input
    + (outputTokens / 1000000) * pricing.output
    + (cacheCreationTokens / 1000000) * pricing.input
    + (cacheReadTokens / 1000000) * (pricing.input * 0.1)
  const totalTokens = inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens

  await trackUserActivity(userId, userEmail, env, true, totalTokens, actualCost)

  // Fire non-blocking compliance check after section generation
  if (feature.startsWith('write_') && projectId && ctx) {
    const sectionId = feature.replace('write_', '')
    const sectionText = result.content?.map(b => b.text || '').join('') || ''
    ctx.waitUntil(runSectionCompliance(sectionId, sectionText, mechanism, projectId, userId, env))
  }

  return json(result)
}

// ── Project CRUD ──────────────────────────────────────────────────────────────
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
    `INSERT INTO projects (id, user_id, title, mechanism, setup, sections, scores, section_summaries,
      compressed_grant, is_resubmission, introduction, study_section, review_status,
      foa_number, foa_rules, foa_fetched_at, foa_valid, reference_grants, compliance_results,
      updated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    body.foa_number || null,
    body.foa_rules ? JSON.stringify(body.foa_rules) : null,
    body.foa_fetched_at || null,
    body.foa_valid ? 1 : 0,
    body.reference_grants ? JSON.stringify(body.reference_grants) : null,
    body.compliance_results ? JSON.stringify(body.compliance_results) : null,
    now, now
  ).run()

  await env.DB.prepare('UPDATE users_meta SET total_grants = total_grants + 1 WHERE id = ?').bind(userId).run()
  return json({ id, title: body.title, mechanism: body.mechanism, created_at: now }, 201)
}

async function handleGetProject(req, env, userId, projectId) {
  const row = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!row) return err('Project not found', 404)
  row.setup = JSON.parse(row.setup || '{}')
  row.sections = JSON.parse(row.sections || '{}')
  row.scores = JSON.parse(row.scores || '{}')
  row.section_summaries = JSON.parse(row.section_summaries || '{}')
  row.is_resubmission = row.is_resubmission === 1
  row.foa_valid = row.foa_valid === 1
  row.foa_rules = row.foa_rules ? JSON.parse(row.foa_rules) : null
  row.reference_grants = row.reference_grants ? JSON.parse(row.reference_grants) : []
  row.compliance_results = row.compliance_results ? JSON.parse(row.compliance_results) : {}
  row.prelim_data_score = row.prelim_data_score || 0
  row.prelim_data_gaps = row.prelim_data_gaps ? JSON.parse(row.prelim_data_gaps) : null
  row.prelim_data_narrative = row.prelim_data_narrative || null
  row.citation_suggestions = row.citation_suggestions ? JSON.parse(row.citation_suggestions) : {}
  return json(row)
}

async function handleUpdateProject(req, env, userId, projectId) {
  const body = await req.json()
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    `UPDATE projects SET
      title = ?, mechanism = ?, setup = ?, sections = ?, scores = ?,
      section_summaries = ?, compressed_grant = ?, is_resubmission = ?,
      introduction = ?, study_section = ?, review_status = ?,
      foa_number = ?, foa_rules = ?, foa_fetched_at = ?, foa_valid = ?,
      reference_grants = ?, citation_suggestions = ?,
      updated_at = ?
     WHERE id = ? AND user_id = ?`
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
    body.foa_number || null,
    body.foa_rules ? JSON.stringify(body.foa_rules) : null,
    body.foa_fetched_at || null,
    body.foa_valid ? 1 : 0,
    body.reference_grants ? JSON.stringify(body.reference_grants) : null,
    body.citation_suggestions ? JSON.stringify(body.citation_suggestions) : null,
    now, projectId, userId
  ).run()
  if (result.changes === 0) return err('Project not found', 404)
  return json({ ok: true, updated_at: now })
}

async function handleDeleteProject(req, env, userId, projectId) {
  await env.DB.prepare('DELETE FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).run()
  return json({ ok: true })
}

// ── Usage ─────────────────────────────────────────────────────────────────────
async function handleUsage(req, env, userId) {
  const now = new Date()
  const startOfMonth = new Date(now.getUTCFullYear(), now.getUTCMonth(), 1).getTime() / 1000

  const monthlyUsage = await env.DB.prepare(
    `SELECT model, SUM(input_tokens) as input_tokens, SUM(output_tokens) as output_tokens,
       SUM(cache_creation_tokens) as cache_creation_tokens, SUM(cache_read_tokens) as cache_read_tokens,
       COUNT(*) as calls
     FROM usage_log WHERE user_id = ? AND created_at >= ? GROUP BY model`
  ).bind(userId, startOfMonth).all()

  let totalCost = 0
  const breakdown = []

  for (const row of monthlyUsage.results || []) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    const inputCost = (row.input_tokens / 1000000) * pricing.input
    const outputCost = (row.output_tokens / 1000000) * pricing.output
    const cacheCreationCost = (row.cache_creation_tokens / 1000000) * pricing.input
    const cacheReadCost = (row.cache_read_tokens / 1000000) * (pricing.input * 0.1)
    const modelCost = inputCost + outputCost + cacheCreationCost + cacheReadCost
    totalCost += modelCost
    breakdown.push({ model: row.model, input_tokens: row.input_tokens, output_tokens: row.output_tokens, cache_creation_tokens: row.cache_creation_tokens, cache_read_tokens: row.cache_read_tokens, calls: row.calls, cost: modelCost })
  }

  const user = await env.DB.prepare('SELECT plan FROM users WHERE id = ?').bind(userId).first()
  const tier = user?.plan || 'individual'
  const limit = TIER_LIMITS[tier] || TIER_LIMITS['individual']

  const allTimeUsage = await env.DB.prepare(
    `SELECT COUNT(*) as total_calls, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output
     FROM usage_log WHERE user_id = ?`
  ).bind(userId).first()

  return json({
    monthly: { cost: totalCost, limit, tier, percentage: (totalCost / limit) * 100, breakdown },
    all_time: {
      total_calls: allTimeUsage.total_calls || 0,
      total_input: allTimeUsage.total_input || 0,
      total_output: allTimeUsage.total_output || 0,
      total_tokens: (allTimeUsage.total_input || 0) + (allTimeUsage.total_output || 0)
    }
  })
}

// ── Health ────────────────────────────────────────────────────────────────────
async function handleHealth(req, env) {
  return json({ status: 'ok', timestamp: new Date().toISOString(), version: env.WORKER_VERSION || '4.1.0' })
}

// ── Feedback ──────────────────────────────────────────────────────────────────
async function handleFeedback(req, env, userId, userEmail) {
  const body = await req.json()
  const emailDomain = userEmail.includes('@') ? userEmail.split('@')[1] : ''
  await env.DB.prepare(
    'INSERT INTO feedback_log (user_id, email_domain, feedback_type, message, page, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(userId, emailDomain, body.feedback_type || 'general', body.message || '', body.page || '', Math.floor(Date.now() / 1000)).run()
  return json({ ok: true })
}

// ── FOA Parse ─────────────────────────────────────────────────────────────────
async function handleFOAParse(req, env, userId) {
  const body = await req.json()
  const foaNumber = (body.foa_number || '').trim().toUpperCase()
  if (!foaNumber) return err('foa_number required')

  // Check cache (< 24 hours)
  const cached = await env.DB.prepare('SELECT * FROM foa_cache WHERE foa_number = ?').bind(foaNumber).first()
  if (cached && cached.fetched_at && (Date.now() / 1000 - cached.fetched_at) < 86400) {
    return json({
      foa_number: foaNumber,
      rules: cached.rules ? JSON.parse(cached.rules) : null,
      valid: cached.valid === 1,
      from_cache: true,
    })
  }

  // Try fetching FOA from NIH
  const urlPatterns = [
    `https://grants.nih.gov/grants/guide/pa-files/${foaNumber}.html`,
    `https://grants.nih.gov/grants/guide/rfa-files/${foaNumber}.html`,
    `https://grants.nih.gov/grants/guide/notice-files/${foaNumber}.html`,
  ]

  let html = null
  for (const url of urlPatterns) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'FrankGrant/4.1.0' } })
      if (resp.ok) {
        html = await resp.text()
        break
      }
    } catch (e) {
      // try next URL
    }
  }

  if (!html) {
    await env.DB.prepare(
      `INSERT INTO foa_cache (foa_number, rules, fetched_at, valid, raw_text)
       VALUES (?, NULL, ?, 0, NULL)
       ON CONFLICT(foa_number) DO UPDATE SET fetched_at = excluded.fetched_at, valid = 0`
    ).bind(foaNumber, Math.floor(Date.now() / 1000)).run()
    return json({ error: true, fallback: true, foa_number: foaNumber })
  }

  // Extract relevant sections from HTML
  // Simple extraction: convert tables, strip tags, grab key sections
  let text = html
    .replace(/<table[^>]*>/gi, '\n[TABLE]\n')
    .replace(/<\/table>/gi, '\n[/TABLE]\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<t[hd][^>]*>/gi, ' | ')
    .replace(/<\/t[hd]>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  // Cap to 12000 chars for Haiku
  const truncatedText = text.slice(0, 12000)

  const FOA_EXTRACTION_PROMPT = `You are an NIH grant expert. Extract structured information from this Funding Opportunity Announcement (FOA) text.

Return ONLY valid JSON with exactly these fields (use null for missing values):
{
  "foa_number": "string (e.g. PA-24-185 or RFA-CA-24-001)",
  "title": "string (full FOA title)",
  "mechanism": "string (e.g. STTR Phase I, SBIR Phase II, R01)",
  "activity_codes": ["array of strings, e.g. U43, R43, R01"],
  "phase": "string (I, II, I+II, or null)",
  "budget_direct_costs": null,
  "budget_total_costs": null,
  "budget_notes": "string with any budget caveats or null",
  "duration_months": null,
  "research_strategy_pages": null,
  "commercialization_plan_pages": null,
  "other_page_limits": "string or null",
  "due_dates": ["array of strings"],
  "letter_of_intent_date": "string or null",
  "eligible_organizations": ["array of strings"],
  "sttr_partner_required": false,
  "sttr_partner_minimum_percent": null,
  "review_criteria": ["array of strings"],
  "program_priorities": ["array of up to 5 strings"],
  "special_requirements": "string or null",
  "resubmission_allowed": null,
  "study_section": "string or null",
  "institute": "string abbreviation (NCI, NIGMS, NHLBI, etc.) or null",
  "is_omnibus": false,
  "contacts": []
}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation.`

  let rules = null
  let valid = false

  try {
    const aiResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `${FOA_EXTRACTION_PROMPT}\n\nFOA TEXT:\n${truncatedText}`
        }],
      }),
    })

    const aiResult = await aiResp.json()
    const raw = aiResult.content?.[0]?.text?.replace(/```json|```/g, '').trim()
    if (raw) {
      rules = JSON.parse(raw)

      // Validate
      const isSBIRSTTR = rules.activity_codes?.some(c => ['R43', 'R44', 'U43', 'U44', 'R41', 'R42'].includes(c))
      valid = !!(rules.foa_number || foaNumber) &&
              Array.isArray(rules.activity_codes) && rules.activity_codes.length > 0 &&
              (!isSBIRSTTR || rules.research_strategy_pages === 6 || rules.research_strategy_pages === 12 || rules.research_strategy_pages === null)

      // Ensure foa_number is set
      if (!rules.foa_number) rules.foa_number = foaNumber
    }
  } catch (e) {
    console.error('FOA AI extraction failed:', e)
  }

  // Store in cache
  await env.DB.prepare(
    `INSERT INTO foa_cache (foa_number, rules, fetched_at, valid, raw_text)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(foa_number) DO UPDATE SET rules = excluded.rules, fetched_at = excluded.fetched_at, valid = excluded.valid, raw_text = excluded.raw_text`
  ).bind(foaNumber, rules ? JSON.stringify(rules) : null, Math.floor(Date.now() / 1000), valid ? 1 : 0, truncatedText.slice(0, 20000)).run()

  if (!rules) {
    return json({ error: true, fallback: true, foa_number: foaNumber })
  }

  return json({ foa_number: foaNumber, rules, valid, from_cache: false })
}

// ── NIH Reporter Search ───────────────────────────────────────────────────────
const ACTIVITY_CODE_MAP = {
  'STTR-I': ['U43'], 'STTR-II': ['U44'], 'SBIR-I': ['R43'], 'SBIR-II': ['R44'],
  'FAST-TRACK': ['R41', 'R42'], 'NCI-IIB': ['R44'], 'R01': ['R01'], 'R21': ['R21'], 'K99': ['K99'],
}

async function handleSearchGrants(req, env, userId) {
  const body = await req.json()
  const { keywords, mechanism, institute, fiscal_years } = body

  if (!keywords) return err('keywords required')

  // Build cache key
  const cacheKey = `nih_reporter:${keywords}:${mechanism || ''}:${(fiscal_years || []).join(',')}`

  // Check KV cache
  const cached = await env.KV.get(cacheKey)
  if (cached) {
    return json({ results: JSON.parse(cached), from_cache: true })
  }

  // Build activity codes
  const activityCodes = mechanism ? (ACTIVITY_CODE_MAP[mechanism] || []) : []

  const years = fiscal_years || [2023, 2024, 2025]

  const searchBody = {
    criteria: {
      advanced_text_search: {
        operator: 'and',
        search_field: 'all',
        search_text: keywords,
      },
      ...(activityCodes.length > 0 && { activity_codes: activityCodes }),
      fiscal_years: years,
    },
    include_fields: [
      'ProjectTitle', 'AbstractText', 'AwardAmount',
      'PrincipalInvestigators', 'Organization', 'ActivityCode',
      'AgencyIcAdmin', 'ProjectStartDate', 'FiscalYear', 'ProjectNum',
    ],
    offset: 0,
    limit: 25,
    sort_field: 'award_amount',
    sort_order: 'desc',
  }

  try {
    const resp = await fetch('https://api.reporter.nih.gov/v2/projects/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(searchBody),
    })

    if (!resp.ok) {
      return json({ results: [], error: `NIH Reporter returned ${resp.status}` })
    }

    const data = await resp.json()
    const results = (data.results || []).map(p => ({
      project_num: p.project_num,
      title: p.project_title,
      abstract: p.abstract_text || '',
      award_amount: p.award_amount,
      pi_name: p.principal_investigators?.[0]?.full_name || 'Unknown PI',
      organization: p.organization?.org_name || '',
      activity_code: p.activity_code,
      institute: p.agency_ic_admin,
      fiscal_year: p.fiscal_year,
      start_date: p.project_start_date,
    }))

    // Cache for 24 hours
    await env.KV.put(cacheKey, JSON.stringify(results), { expirationTtl: 86400 })

    return json({ results, from_cache: false })
  } catch (e) {
    console.error('NIH Reporter search failed:', e)
    return json({ results: [], error: 'NIH Reporter search failed' })
  }
}

async function handleAnalyzeGrant(req, env, userId) {
  const body = await req.json()
  const { abstract } = body
  if (!abstract) return err('abstract required')

  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 800,
        messages: [{
          role: 'user',
          content: `You are an NIH grant expert. Analyze this funded grant abstract and extract patterns that could improve a new grant application.

ABSTRACT:
${abstract.slice(0, 3000)}

Return ONLY valid JSON:
{
  "significance_framing": "How does this grant frame the unmet need and significance?",
  "aims_structure": "How are the specific aims structured and what is the central hypothesis?",
  "innovation_claims": "What specific innovations does this grant claim?",
  "key_terminology": ["up to 6 key technical terms or phrases used"],
  "reviewer_signals": "What signals did this grant send to reviewers to get funded?",
  "approach_highlights": "What is distinctive about the research approach?"
}`
        }],
      }),
    })

    const result = await resp.json()
    const raw = result.content?.[0]?.text?.replace(/```json|```/g, '').trim()
    const analysis = JSON.parse(raw)
    return json({ analysis })
  } catch (e) {
    return err('Analysis failed: ' + e.message)
  }
}

async function handleSaveReference(req, env, userId) {
  const body = await req.json()
  const { project_id, grant_title, grant_abstract, analysis } = body

  if (!project_id) return err('project_id required')

  const project = await env.DB.prepare(
    'SELECT reference_grants FROM projects WHERE id = ? AND user_id = ?'
  ).bind(project_id, userId).first()
  if (!project) return err('Project not found', 404)

  let refs = []
  try { refs = JSON.parse(project.reference_grants || '[]') } catch { refs = [] }

  // Append and trim to max 5
  refs.push({ grant_title, grant_abstract: (grant_abstract || '').slice(0, 500), analysis, saved_at: Math.floor(Date.now() / 1000) })
  if (refs.length > 5) refs = refs.slice(-5)

  await env.DB.prepare(
    'UPDATE projects SET reference_grants = ? WHERE id = ? AND user_id = ?'
  ).bind(JSON.stringify(refs), project_id, userId).run()

  return json({ ok: true, count: refs.length })
}

// ── Compliance GET ─────────────────────────────────────────────────────────────
async function handleGetCompliance(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT compliance_results FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let results = {}
  try { results = JSON.parse(project.compliance_results || '{}') } catch { results = {} }
  return json(results)
}

// ── ADMIN COMMAND STATION ROUTES ─────────────────────────────────────────────

async function handleCommandHealth(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const last24h = now - (24 * 3600)

  const errors = await env.DB.prepare('SELECT COUNT(*) as count FROM error_log WHERE created_at >= ? AND status_code >= 500').bind(last24h).first()
  const totalRequests = await env.DB.prepare('SELECT COUNT(*) as count FROM error_log WHERE created_at >= ?').bind(last24h).first()
  const errorRate = totalRequests.count > 0 ? (errors.count / totalRequests.count) * 100 : 0
  const avgLatency = await env.DB.prepare('SELECT AVG(response_time_ms) as avg FROM error_log WHERE created_at >= ?').bind(last24h).first()
  const claudeErrors = await env.DB.prepare('SELECT COUNT(*) as count FROM usage_log WHERE created_at >= ? AND (input_tokens = 0 OR output_tokens = 0)').bind(last24h).first()
  const claudeCalls = await env.DB.prepare('SELECT COUNT(*) as count FROM usage_log WHERE created_at >= ?').bind(last24h).first()
  const claudeErrorRate = claudeCalls.count > 0 ? (claudeErrors.count / claudeCalls.count) * 100 : 0

  const tables = ['projects', 'usage_log', 'users', 'users_meta', 'error_log', 'feedback_log']
  const rowCounts = {}
  for (const table of tables) {
    const result = await env.DB.prepare(`SELECT COUNT(*) as count FROM ${table}`).first()
    rowCounts[table] = result.count
  }

  const rateLimitHits = await env.DB.prepare('SELECT COUNT(*) as count FROM rate_limit_log WHERE created_at >= ?').bind(last24h).first()
  const deployments = await env.DB.prepare('SELECT * FROM deployments_log ORDER BY started_at DESC LIMIT 10').all()
  const recentErrors = await env.DB.prepare('SELECT * FROM error_log ORDER BY created_at DESC LIMIT 20').all()

  return json({
    error_rate: errorRate.toFixed(2), avg_latency_ms: avgLatency.avg?.toFixed(1) || 0,
    claude_error_rate: claudeErrorRate.toFixed(2), rate_limit_hits: rateLimitHits.count,
    row_counts: rowCounts, deployments: deployments.results, recent_errors: recentErrors.results
  })
}

async function handleCommandUsers(req, env) {
  const allUsers = await env.DB.prepare('SELECT * FROM users_meta ORDER BY last_active DESC').all()
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
    await env.DB.prepare('UPDATE users_meta SET suspended = ? WHERE id = ?').bind(body.suspended ? 1 : 0, userId).run()
    await env.DB.prepare('INSERT INTO admin_actions (action_type, entity, entity_id, old_value, new_value, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)').bind('user_suspend', 'user', userId, '0', body.suspended ? '1' : '0', adminUserId).run()
  }
  if (body.plan_tier) {
    const old = await env.DB.prepare('SELECT plan_tier FROM users_meta WHERE id = ?').bind(userId).first()
    await env.DB.prepare('UPDATE users_meta SET plan_tier = ? WHERE id = ?').bind(body.plan_tier, userId).run()
    await env.DB.prepare('INSERT INTO admin_actions (action_type, entity, entity_id, old_value, new_value, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)').bind('user_tier_change', 'user', userId, old?.plan_tier || 'free', body.plan_tier, adminUserId).run()
  }
  if (body.notes !== undefined) {
    await env.DB.prepare('UPDATE users_meta SET notes = ? WHERE id = ?').bind(body.notes, userId).run()
  }
  return json({ ok: true })
}

async function handleCommandRevenue(req, env) {
  const mrrEvents = await env.DB.prepare('SELECT * FROM mrr_events ORDER BY recorded_at DESC').all()
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
  const monthEvents = mrrEvents.results.filter(e => e.recorded_at >= startOfMonth)
  const waterfall = {
    new_mrr: monthEvents.filter(e => e.event_type === 'new').reduce((s, e) => s + (e.mrr_delta || 0), 0),
    expansion_mrr: monthEvents.filter(e => e.event_type === 'expansion').reduce((s, e) => s + (e.mrr_delta || 0), 0),
    contraction_mrr: monthEvents.filter(e => e.event_type === 'contraction').reduce((s, e) => s + (e.mrr_delta || 0), 0),
    churn_mrr: monthEvents.filter(e => e.event_type === 'churn').reduce((s, e) => s + (e.mrr_delta || 0), 0)
  }
  const users = await env.DB.prepare('SELECT * FROM users_meta').all()
  const tierBreakdown = { individual: { count: 0, mrr: 0 }, lab: { count: 0, mrr: 0 }, institution: { count: 0, mrr: 0 } }
  for (const user of users.results) {
    if (user.plan_tier === 'individual') { tierBreakdown.individual.count++; tierBreakdown.individual.mrr += 99 }
    else if (user.plan_tier === 'lab') { tierBreakdown.lab.count++; tierBreakdown.lab.mrr += 299 }
  }
  return json({ waterfall, tier_breakdown: tierBreakdown, all_events: mrrEvents.results })
}

async function handleCommandMRREventsGet(req, env) {
  const events = await env.DB.prepare('SELECT * FROM mrr_events ORDER BY recorded_at DESC').all()
  return json(events.results)
}

async function handleCommandMRREventsPost(req, env) {
  const body = await req.json()
  await env.DB.prepare('INSERT INTO mrr_events (event_type, user_id, plan_from, plan_to, mrr_delta, recorded_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(body.event_type, body.user_id || null, body.plan_from || null, body.plan_to || null, body.mrr_delta || 0, Math.floor(Date.now() / 1000)).run()
  return json({ ok: true })
}

async function handleCommandAICosts(req, env) {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000

  const todayUsage = await env.DB.prepare('SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM usage_log WHERE created_at >= ? GROUP BY model').bind(startOfToday).all()
  let todaySpend = 0
  for (const row of todayUsage.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    todaySpend += (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
  }

  const monthUsage = await env.DB.prepare('SELECT model, SUM(input_tokens) as input, SUM(output_tokens) as output FROM usage_log WHERE created_at >= ? GROUP BY model').bind(startOfMonth).all()
  let monthSpend = 0
  for (const row of monthUsage.results) {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    monthSpend += (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output
  }

  const byFeature = await env.DB.prepare('SELECT action, COUNT(*) as calls, SUM(input_tokens) as input, SUM(output_tokens) as output, model FROM usage_log WHERE created_at >= ? GROUP BY action, model').bind(startOfMonth).all()
  const featureCosts = byFeature.results.map(row => {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    return { feature: row.action, calls: row.calls, input_tokens: row.input, output_tokens: row.output, cost: (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output, model: row.model }
  })

  const modelCosts = monthUsage.results.map(row => {
    const pricing = PRICING[row.model] || PRICING['claude-sonnet-4-20250514']
    return { model: row.model, input_tokens: row.input, output_tokens: row.output, cost: (row.input / 1000000) * pricing.input + (row.output / 1000000) * pricing.output }
  })

  const byUser = await env.DB.prepare('SELECT u.email, u.email_domain, u.plan_tier, u.estimated_cost_usd, u.total_generations FROM users_meta u ORDER BY u.estimated_cost_usd DESC LIMIT 20').all()

  return json({ today_spend: todaySpend, month_spend: monthSpend, by_feature: featureCosts, by_model: modelCosts, by_user: byUser.results })
}

async function handleCommandGrants(req, env) {
  const mechanisms = await env.DB.prepare('SELECT mechanism, COUNT(*) as count FROM projects GROUP BY mechanism ORDER BY count DESC').all()
  const totalProjects = await env.DB.prepare('SELECT COUNT(*) as count FROM projects').first()
  const withSections = await env.DB.prepare(`SELECT COUNT(*) as count FROM projects WHERE sections != '{}' AND sections != ''`).first()
  return json({ mechanisms: mechanisms.results, total_projects: totalProjects.count, with_sections: withSections.count })
}

async function handleCommandProduct(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const sevenDaysAgo = now - (7 * 24 * 3600)
  const features = await env.DB.prepare('SELECT action, COUNT(*) as total_uses, COUNT(DISTINCT user_id) as unique_users FROM usage_log GROUP BY action').all()
  const last7Days = await env.DB.prepare('SELECT action, COUNT(*) as uses_7d FROM usage_log WHERE created_at >= ? GROUP BY action').bind(sevenDaysAgo).all()
  const featureUsage = features.results.map(f => {
    const recent = last7Days.results.find(r => r.action === f.action)
    return { feature: f.action, total_uses: f.total_uses, uses_7d: recent?.uses_7d || 0, unique_users: f.unique_users }
  })
  return json({ feature_usage: featureUsage })
}

async function handleCommandSecurity(req, env) {
  const now = Math.floor(Date.now() / 1000)
  const last24h = now - (24 * 3600)
  const failedAuth = await env.DB.prepare('SELECT endpoint, COUNT(*) as count FROM error_log WHERE created_at >= ? AND status_code = 401 GROUP BY endpoint ORDER BY count DESC').bind(last24h).all()
  const suspended = await env.DB.prepare('SELECT * FROM users_meta WHERE suspended = 1').all()
  const adminActions = await env.DB.prepare('SELECT * FROM admin_actions ORDER BY created_at DESC LIMIT 50').all()
  const unusual = await env.DB.prepare(`SELECT user_id, COUNT(*) as count, SUM(input_tokens + output_tokens) as tokens FROM usage_log WHERE created_at >= ? GROUP BY user_id HAVING count > 50 ORDER BY count DESC`).bind(now - (24 * 3600)).all()
  return json({ failed_auth: failedAuth.results, suspended_users: suspended.results, admin_actions: adminActions.results, unusual_activity: unusual.results })
}

async function handleCommandFeedbackGet(req, env) {
  const feedback = await env.DB.prepare('SELECT * FROM feedback_log ORDER BY created_at DESC').all()
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
    await env.DB.prepare('UPDATE feedback_log SET resolved = ? WHERE id = ?').bind(body.resolved ? 1 : 0, feedbackId).run()
  }
  if (body.admin_notes !== undefined) {
    await env.DB.prepare('UPDATE feedback_log SET admin_notes = ? WHERE id = ?').bind(body.admin_notes, feedbackId).run()
  }
  return json({ ok: true })
}

async function handleCommandFeedbackCluster(req, env) {
  const requests = await env.DB.prepare('SELECT message FROM feedback_log WHERE feedback_type = ? AND resolved = 0').bind('feature').all()
  if (requests.results.length === 0) return json({ themes: [] })

  const messages = requests.results.map(r => r.message).join('\n\n---\n\n')
  const prompt = `Analyze these feature requests and group them into 5-7 themes. Return only valid JSON: [{"theme":"...", "count":N, "example":"..."}]\n\n${messages}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 1000, messages: [{ role: 'user', content: prompt }] }),
  })
  const result = await resp.json()
  const text = result.content[0].text.replace(/```json|```/g, '').trim()
  return json({ themes: JSON.parse(text) })
}

// ── Preliminary Data ──────────────────────────────────────────────────────────

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length)))
  }
  return btoa(binary)
}

async function handlePrelimUpload(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let formData
  try { formData = await req.formData() } catch (e) { return err('Invalid multipart form data') }

  const file = formData.get('file')
  const label = (formData.get('label') || '').slice(0, 200)

  if (!file) return err('file required')

  const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf']
  const fileType = file.type || 'image/png'
  if (!supportedTypes.includes(fileType)) {
    return err('Unsupported file type. Use JPEG, PNG, GIF, WebP, or PDF.')
  }

  const arrayBuffer = await file.arrayBuffer()
  if (arrayBuffer.byteLength > 10 * 1024 * 1024) return err('File too large (10MB max)')

  const base64Data = arrayBufferToBase64(arrayBuffer)
  const fileName = (file.name || 'figure').slice(0, 200)
  const fileSize = arrayBuffer.byteLength

  // Describe using Claude vision
  const visionContent = fileType === 'application/pdf'
    ? [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } },
        { type: 'text', text: 'Describe the scientific content of this document for use as preliminary data in an NIH grant. Focus on key findings, figures, statistical results, and how this supports research aims. Be specific. 3-5 sentences.' },
      ]
    : [
        { type: 'image', source: { type: 'base64', media_type: fileType, data: base64Data } },
        { type: 'text', text: 'Describe this scientific figure for use as preliminary data in an NIH grant. Focus on what the data shows, key findings, statistical significance if visible, and how it supports the research aims. 3-5 sentences.' },
      ]

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 600, messages: [{ role: 'user', content: visionContent }] }),
  })

  const result = await resp.json()
  const description = result.content?.[0]?.text || 'Unable to analyze figure.'

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, 'prelim_describe', 'claude-haiku-4-5-20251001', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()

  const insertResult = await env.DB.prepare(
    'INSERT INTO preliminary_data (project_id, user_id, file_name, file_type, file_size, label, ai_description, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(projectId, userId, fileName, fileType, fileSize, label || null, description, Math.floor(Date.now() / 1000)).run()

  return json({ ok: true, id: insertResult.meta.last_row_id, description }, 201)
}

async function handlePrelimList(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT id, prelim_data_score, prelim_data_gaps, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const items = await env.DB.prepare(
    'SELECT id, file_name, file_type, file_size, label, ai_description, ai_narrative, created_at FROM preliminary_data WHERE project_id = ? ORDER BY created_at ASC'
  ).bind(projectId).all()

  return json({
    items: items.results,
    score: project.prelim_data_score || 0,
    gaps: project.prelim_data_gaps ? JSON.parse(project.prelim_data_gaps) : null,
    narrative: project.prelim_data_narrative || null,
  })
}

async function handlePrelimDelete(req, env, userId, projectId, itemId) {
  const project = await env.DB.prepare(
    'SELECT id FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  await env.DB.prepare('DELETE FROM preliminary_data WHERE id = ? AND project_id = ?').bind(itemId, projectId).run()
  return json({ ok: true })
}

async function handlePrelimAnalyze(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT mechanism, reference_grants, setup FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const items = await env.DB.prepare(
    'SELECT label, ai_description FROM preliminary_data WHERE project_id = ? ORDER BY created_at ASC'
  ).bind(projectId).all()
  if (items.results.length === 0) return err('No preliminary data uploaded yet')

  const descriptions = items.results.map((item, i) =>
    `Figure ${i + 1}${item.label ? ` (${item.label})` : ''}: ${item.ai_description}`
  ).join('\n\n')

  let refContext = ''
  if (project.reference_grants) {
    try {
      const refs = JSON.parse(project.reference_grants)
      const highlights = refs.slice(0, 3).map(r => r.analysis?.approach_highlights).filter(Boolean)
      if (highlights.length > 0) refContext = `\n\nFunded grants in this space emphasize: ${highlights.join(' | ')}`
    } catch {}
  }

  const prompt = `You are an NIH study section reviewer evaluating preliminary data for a ${project.mechanism || 'SBIR/STTR'} application.

PRELIMINARY DATA FIGURES:
${descriptions}${refContext}

Evaluate the sufficiency of this preliminary data. Return ONLY valid JSON:
{
  "score": <integer 0-100>,
  "score_label": "<Weak|Adequate|Strong|Excellent>",
  "gaps": [
    { "gap": "...", "importance": "high|medium|low", "suggestion": "..." }
  ],
  "strengths": ["..."],
  "summary": "2-3 sentence reviewer-perspective assessment"
}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  })

  const result = await resp.json()
  const raw = result.content?.[0]?.text?.replace(/```json|```/g, '').trim()
  let analysis
  try { analysis = JSON.parse(raw) } catch { return err('Analysis parsing failed') }

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, 'prelim_analyze', 'claude-haiku-4-5-20251001', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()

  await env.DB.prepare(
    'UPDATE projects SET prelim_data_score = ?, prelim_data_gaps = ? WHERE id = ? AND user_id = ?'
  ).bind(analysis.score || 0, JSON.stringify(analysis), projectId, userId).run()

  return json(analysis)
}

async function handlePrelimNarrative(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT mechanism, setup FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const items = await env.DB.prepare(
    'SELECT label, ai_description FROM preliminary_data WHERE project_id = ? ORDER BY created_at ASC'
  ).bind(projectId).all()
  if (items.results.length === 0) return err('No preliminary data uploaded yet')

  let setup = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}

  const descriptions = items.results.map((item, i) =>
    `Figure ${i + 1}${item.label ? ` — ${item.label}` : ''}: ${item.ai_description}`
  ).join('\n\n')

  const prompt = `You are a grant writing expert. Write a compelling "Preliminary Data" section for an NIH ${project.mechanism || 'SBIR/STTR'} application.

PROJECT CONTEXT:
Technology: ${setup.technology || setup.innovation || 'Not specified'}
Problem: ${setup.problem || 'Not specified'}

FIGURES:
${descriptions}

Write 2-4 paragraphs that:
1. Open with a strong topic sentence connecting preliminary data to the central hypothesis
2. Present each piece of data in logical narrative flow (not a list)
3. Emphasize statistical significance, reproducibility, and translational relevance
4. Close with a forward-looking sentence about how this data de-risks the proposed work

Use present tense. Reference figures as "Figure X". No bullet points. Scientific NIH-reviewer prose.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
  })

  const result = await resp.json()
  const narrative = result.content?.[0]?.text || ''

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output

  await env.DB.prepare(
    'INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, 'prelim_narrative', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()

  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  await env.DB.prepare(
    'UPDATE projects SET prelim_data_narrative = ? WHERE id = ? AND user_id = ?'
  ).bind(narrative, projectId, userId).run()

  return json({ narrative })
}

async function handleCitations(req, env, userId) {
  const body = await req.json()
  const { section_text, section_id } = body
  if (!section_text) return err('section_text required')

  // Extract PubMed search terms from section text using Haiku
  const kwResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract 3 PubMed search queries from this NIH grant ${section_id || 'section'}. Return ONLY a JSON array of 3 strings. Each query should be 3-6 words of key scientific concepts.\n\nSection:\n${section_text.slice(0, 2000)}\n\nExample: ["CRISPR cancer gene therapy", "tumor microenvironment immunotherapy", "checkpoint inhibitor resistance mechanisms"]`,
      }],
    }),
  })

  const kwResult = await kwResp.json()
  const kwRaw = kwResult.content?.[0]?.text?.replace(/```json|```/g, '').trim()
  let searchTerms = []
  try { searchTerms = JSON.parse(kwRaw) } catch {}

  if (searchTerms.length === 0) return json({ citations: [], search_terms: [] })

  // Search PubMed for each term
  const allPMIDs = new Set()
  for (const term of searchTerms.slice(0, 3)) {
    try {
      const encoded = encodeURIComponent(term)
      const resp = await fetch(
        `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${encoded}&retmax=5&sort=relevance&retmode=json`,
        { headers: { 'User-Agent': 'FrankGrant/4.2.0' } }
      )
      const data = await resp.json()
      ;(data.esearchresult?.idlist || []).forEach(id => allPMIDs.add(id))
    } catch {}
  }

  if (allPMIDs.size === 0) return json({ citations: [], search_terms: searchTerms })

  // Fetch summaries
  const pmidList = [...allPMIDs].slice(0, 15).join(',')
  let citations = []
  try {
    const summResp = await fetch(
      `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmidList}&retmode=json`,
      { headers: { 'User-Agent': 'FrankGrant/4.2.0' } }
    )
    const summData = await summResp.json()
    const uids = summData.result?.uids || []
    citations = uids.map(uid => {
      const a = summData.result[uid]
      if (!a) return null
      const authList = a.authors || []
      const authorStr = authList.slice(0, 3).map(x => x.name).join(', ') + (authList.length > 3 ? ' et al.' : '')
      const year = (a.pubdate || '').slice(0, 4)
      return {
        pmid: uid,
        title: a.title || '',
        authors: authorStr,
        journal: a.source || '',
        year,
        citation_text: `${authorStr}. ${a.title || ''} ${a.source || ''}. ${year};${a.volume || ''}${a.issue ? `(${a.issue})` : ''}:${a.pages || ''}.`,
        pubmed_url: `https://pubmed.ncbi.nlm.nih.gov/${uid}/`,
      }
    }).filter(Boolean)
  } catch (e) {
    console.error('PubMed summary failed:', e)
  }

  return json({ citations, search_terms: searchTerms })
}

// ── Study Section Simulation ──────────────────────────────────────────────────
const SS_REVIEWER_1 = `You are the PRIMARY REVIEWER (basic scientist, molecular/cellular focus, 25 years running an NIH-funded lab). Score each criterion 1-9 (1=Exceptional, 9=Poor). Be thorough, candid, and specific. At the very end output exactly: SCORES: {"impact":N,"significance":N,"innovation":N,"approach":N,"investigators":N,"environment":N}`
const SS_REVIEWER_2 = `You are the SECONDARY REVIEWER (translational physician-scientist MD/PhD). Critique clinical relevance and path to patients. Score each criterion 1-9. At the very end output exactly: SCORES: {"impact":N,"significance":N,"innovation":N,"approach":N,"investigators":N,"environment":N}`
const SS_REVIEWER_3 = `You are the READER (biostatistician/methodologist). Focus on study design, power calculations, SABV. Give a brief critique focused heavily on Approach. Score all criteria 1-9. At the very end output exactly: SCORES: {"impact":N,"significance":N,"innovation":N,"approach":N,"investigators":N,"environment":N}`
const SS_SUMMARY = `You are the Scientific Review Officer (SRO) synthesizing three reviewer critiques into an NIH Summary Statement. Output ONLY valid JSON: {"impact_score":N,"percentile":N,"criteria":{"significance":N,"innovation":N,"approach":N,"investigators":N,"environment":N},"strengths":["..."],"weaknesses":["..."],"synthesis":"...","fundability":"..."}`

async function handleStudySection(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT mechanism, setup, sections FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const grantText = [
    sections.aims ? `SPECIFIC AIMS:\n${sections.aims}` : '',
    sections.sig ? `SIGNIFICANCE:\n${sections.sig}` : '',
    sections.innov ? `INNOVATION:\n${sections.innov}` : '',
    sections.approach ? `APPROACH (first 3000 chars):\n${(sections.approach || '').slice(0, 3000)}` : '',
  ].filter(Boolean).join('\n\n---\n\n') || 'No sections generated yet.'

  const userMsg = `Review this NIH ${project.mechanism || 'grant'} application:

TITLE: ${setup.title || setup.disease || 'Untitled'}
PI: ${setup.pi || 'Not specified'}
DISEASE/INDICATION: ${setup.disease || 'Not specified'}

${grantText.slice(0, 7000)}`

  const callReviewer = async (system) => {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 900, system, messages: [{ role: 'user', content: userMsg }] }),
    })
    const r = await resp.json()
    return { text: r.content?.[0]?.text || '', usage: r.usage }
  }

  const [rev1, rev2, rev3] = await Promise.all([
    callReviewer(SS_REVIEWER_1),
    callReviewer(SS_REVIEWER_2),
    callReviewer(SS_REVIEWER_3),
  ])

  const extractScores = (text) => {
    const m = text.match(/SCORES:\s*(\{[^}]+\})/)
    if (m) { try { return JSON.parse(m[1]) } catch {} }
    const m2 = text.match(/\{"impact"\s*:\s*\d/)
    if (m2) { try { return JSON.parse(m2[0] + '}') } catch {} }
    return { impact: 5, significance: 4, innovation: 4, approach: 5, investigators: 4, environment: 3 }
  }

  const s1 = extractScores(rev1.text), s2 = extractScores(rev2.text), s3 = extractScores(rev3.text)

  const synthResp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: SS_SUMMARY,
      messages: [{ role: 'user', content: `PRIMARY REVIEWER:\n${rev1.text}\n\nSECONDARY REVIEWER:\n${rev2.text}\n\nREADER:\n${rev3.text}` }],
    }),
  })
  const synthResult = await synthResp.json()
  const synthText = synthResult.content?.[0]?.text || ''

  let summary = null
  const jm = synthText.match(/\{[\s\S]*\}/)
  if (jm) { try { summary = JSON.parse(jm[0]) } catch {} }

  if (!summary) {
    const avg = (k) => Math.round((s1[k] + s2[k] + s3[k]) / 3 * 10) / 10
    const avgImpact = avg('impact')
    summary = {
      impact_score: avgImpact,
      percentile: Math.min(99, Math.round(avgImpact * 9.5 + 5)),
      criteria: { significance: avg('significance'), innovation: avg('innovation'), approach: avg('approach'), investigators: avg('investigators'), environment: avg('environment') },
      strengths: [], weaknesses: [],
      synthesis: synthText.slice(0, 800),
      fundability: avgImpact <= 2.5 ? 'Likely fundable' : avgImpact <= 4 ? 'Competitive, near payline' : avgImpact <= 6 ? 'Above payline for most ICs' : 'Below typical payline',
    }
  }

  const totalIn = (rev1.usage?.input_tokens || 0) + (rev2.usage?.input_tokens || 0) + (rev3.usage?.input_tokens || 0) + (synthResult.usage?.input_tokens || 0)
  const totalOut = (rev1.usage?.output_tokens || 0) + (rev2.usage?.output_tokens || 0) + (rev3.usage?.output_tokens || 0) + (synthResult.usage?.output_tokens || 0)
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (totalIn / 1e6) * pricing.input + (totalOut / 1e6) * pricing.output

  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'study_section', 'claude-sonnet-4-20250514', totalIn, totalOut, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, totalIn + totalOut, cost)

  const results = {
    reviewer_1: { critique: rev1.text, scores: s1 },
    reviewer_2: { critique: rev2.text, scores: s2 },
    reviewer_3: { critique: rev3.text, scores: s3 },
    summary,
    generated_at: Math.floor(Date.now() / 1000),
  }

  try {
    await env.DB.prepare('UPDATE projects SET study_section_results = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(results), projectId, userId).run()
  } catch {}

  return json(results)
}

// ── Polish Section ────────────────────────────────────────────────────────────
async function handlePolish(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const body = await req.json()
  const { section_id, section_text, section_label } = body
  if (!section_text) return err('section_text required')

  const POLISH_SYSTEM = `You are an elite NIH grant writer who has helped secure over $500M in NIH funding. Your specialty is elevating good science into exceptional grant writing without changing the scientific content.`

  const prompt = `Rewrite this NIH grant section (${section_label || section_id}) to elevate it to the highest professional standard WITHOUT changing the scientific content.

ORIGINAL:
${section_text}

OBJECTIVES:
1. Remove ALL hedge words: "may", "might", "could", "potentially", "possibly"
2. Convert passive voice to active voice
3. Strengthen the opening hook to immediately grab the reviewer
4. Make knowledge gaps more precise and compelling
5. State hypotheses as falsifiable claims, not plans
6. Ensure every paragraph has a clear topic sentence
7. Strengthen the closing impact statement

PRESERVE scientific facts, structure, and word count (±10%). Return ONLY the polished text.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, system: POLISH_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
  })
  const result = await resp.json()
  const polished = result.content?.[0]?.text || ''

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output

  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'polish', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  return json({ polished, section_id })
}

// ── Main fetch handler ────────────────────────────────────────────────────────
export default {
  async fetch(req, env, ctx) {
    const startTime = Date.now()
    const url = new URL(req.url)
    const path = url.pathname

    try {
      if (req.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: CORS })
      }

      if (path === '/api/health' && req.method === 'GET') {
        const response = await handleHealth(req, env)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, null, env)
        return response
      }

      const payload = await requireAuth(req, env)
      if (!payload) {
        const responseTime = Date.now() - startTime
        await logError(path, 401, 'Unauthorized', responseTime, null, env)
        return err('Unauthorized', 401)
      }

      const userId = await ensureUser(payload, env)
      const userEmail = payload.email || payload['email_address'] || ''

      const isSuspended = await checkSuspended(userId, env)
      if (isSuspended) {
        const responseTime = Date.now() - startTime
        await logError(path, 403, 'User suspended', responseTime, userId, env)
        return err('Account suspended. Contact support.', 403)
      }

      if (!path.startsWith('/api/command')) {
        await trackUserActivity(userId, userEmail, env)
      }

      // ── Authenticated routes ──────────────────────────────────────────────

      if (path === '/api/ai' && req.method === 'POST') {
        const response = await handleAI(req, env, userId, userEmail, ctx)
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

      // FOA Parser
      if (path === '/api/foa/parse' && req.method === 'POST') {
        const response = await handleFOAParse(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      // NIH Reporter Search
      if (path === '/api/search/grants' && req.method === 'POST') {
        const response = await handleSearchGrants(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/search/analyze-grant' && req.method === 'POST') {
        const response = await handleAnalyzeGrant(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      if (path === '/api/search/save-reference' && req.method === 'POST') {
        const response = await handleSaveReference(req, env, userId)
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      // Project routes
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

      // Compliance endpoint
      const complianceMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/compliance$/)
      if (complianceMatch && req.method === 'GET') {
        const response = await handleGetCompliance(req, env, userId, complianceMatch[1])
        const responseTime = Date.now() - startTime
        await logError(path, 200, null, responseTime, userId, env)
        return response
      }

      // Preliminary data endpoints
      const prelimMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/prelim$/)
      if (prelimMatch) {
        const projectId = prelimMatch[1]
        let response
        if (req.method === 'POST') response = await handlePrelimUpload(req, env, userId, projectId)
        else if (req.method === 'GET') response = await handlePrelimList(req, env, userId, projectId)
        if (response) {
          await logError(path, response.status, null, Date.now() - startTime, userId, env)
          return response
        }
      }

      const prelimItemMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/prelim\/(\d+)$/)
      if (prelimItemMatch && req.method === 'DELETE') {
        const response = await handlePrelimDelete(req, env, userId, prelimItemMatch[1], parseInt(prelimItemMatch[2]))
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const prelimAnalyzeMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/prelim\/analyze$/)
      if (prelimAnalyzeMatch && req.method === 'POST') {
        const response = await handlePrelimAnalyze(req, env, userId, prelimAnalyzeMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const prelimNarrativeMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/prelim\/narrative$/)
      if (prelimNarrativeMatch && req.method === 'POST') {
        const response = await handlePrelimNarrative(req, env, userId, prelimNarrativeMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Citations (PubMed)
      if (path === '/api/citations' && req.method === 'POST') {
        const response = await handleCitations(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Study Section Simulation
      const studySectionMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/study-section$/)
      if (studySectionMatch && req.method === 'POST') {
        const response = await handleStudySection(req, env, userId, studySectionMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Polish Section
      const polishMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/polish$/)
      if (polishMatch && req.method === 'POST') {
        const response = await handlePolish(req, env, userId, polishMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // ── Admin routes ──────────────────────────────────────────────────────
      if (path.startsWith('/api/command')) {
        const adminPayload = await requireAdmin(req, env)
        if (!adminPayload) {
          const responseTime = Date.now() - startTime
          await logError(path, 403, 'Admin access required', responseTime, userId, env)
          return err('Admin access required', 403)
        }

        if (path === '/api/command/health' && req.method === 'GET') return handleCommandHealth(req, env)
        if (path === '/api/command/users' && req.method === 'GET') return handleCommandUsers(req, env)
        const userUpdateMatch = path.match(/^\/api\/command\/users\/([^/]+)$/)
        if (userUpdateMatch && req.method === 'PATCH') return handleCommandUserUpdate(req, env, userUpdateMatch[1])
        if (path === '/api/command/revenue' && req.method === 'GET') return handleCommandRevenue(req, env)
        if (path === '/api/command/mrr-events' && req.method === 'GET') return handleCommandMRREventsGet(req, env)
        if (path === '/api/command/mrr-events' && req.method === 'POST') return handleCommandMRREventsPost(req, env)
        if (path === '/api/command/ai-costs' && req.method === 'GET') return handleCommandAICosts(req, env)
        if (path === '/api/command/grants' && req.method === 'GET') return handleCommandGrants(req, env)
        if (path === '/api/command/product' && req.method === 'GET') return handleCommandProduct(req, env)
        if (path === '/api/command/security' && req.method === 'GET') return handleCommandSecurity(req, env)
        if (path === '/api/command/feedback' && req.method === 'GET') return handleCommandFeedbackGet(req, env)
        const feedbackMatch = path.match(/^\/api\/command\/feedback\/(\d+)$/)
        if (feedbackMatch && req.method === 'PATCH') return handleCommandFeedbackPatch(req, env, feedbackMatch[1])
        if (path === '/api/command/feedback/cluster' && req.method === 'POST') return handleCommandFeedbackCluster(req, env)
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
