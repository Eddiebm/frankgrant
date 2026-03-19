/**
 * FrankGrant API Worker v4.2.0
 * Handles: auth validation, AI proxy, project CRUD, usage logging, admin monitoring,
 *          FOA parsing, NIH Reporter search, inline compliance checking,
 *          preliminary data upload/analysis/narrative, PubMed citations
 */

const ADMIN_EMAILS = [
  'eddieb@coareholdings.com',
  'eddie@bannermanmenson.com',
]

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
  if (!ADMIN_EMAILS.includes(email)) return null
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

function sanitizeUserInput(text) {
  if (!text || typeof text !== 'string') return { text, detected: false }
  const patterns = [
    /ignore\s+(?:previous|all)\s+instructions?/gi,
    /you\s+are\s+now\b/gi,
    /disregard\s+your\b/gi,
    /new\s+system\s+prompt/gi,
    /pretend\s+you\s+are\b/gi,
    /forget\s+your\s+instructions?/gi,
    /override\s+your\b/gi,
    /act\s+as\s+if\b/gi,
    /\bsystem:\s*/gi,
    /\[SYSTEM\]/g,
    /<system>/gi,
  ]
  let out = text, detected = false
  for (const p of patterns) {
    if (p.test(out)) { detected = true; out = out.replace(p, '[removed]') }
  }
  return { text: out, detected }
}

async function callAnthropicWithFallback(body, env) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 55000)
  try {
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    if ([500, 503, 529].includes(resp.status)) return { _fallback: true, status: resp.status }
    return await resp.json()
  } catch (e) {
    clearTimeout(timeoutId)
    return { _fallback: true, status: e.name === 'AbortError' ? 'timeout' : 500 }
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
      `INSERT INTO users_meta (id, email, email_domain, first_seen, last_active, total_generations, total_tokens_used, estimated_cost_usd, voice_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)`
    ).bind(userId, email, emailDomain, now, now, isAICall ? 1 : 0, tokens, estimatedCost).run()
  }
}

async function checkSuspended(userId, env) {
  const meta = await env.DB.prepare('SELECT suspended FROM users_meta WHERE id = ?').bind(userId).first()
  return meta?.suspended === 1
}

async function checkVoiceEnabled(userId, env) {
  const meta = await env.DB.prepare('SELECT voice_enabled FROM users_meta WHERE id = ?').bind(userId).first()
  // null row = new user not yet tracked (default deny until row exists)
  if (!meta) return false
  return meta.voice_enabled === 1
}

// ── Safe JSON parsing for AI responses ────────────────────────────────────
function safeParseJSON(text) {
  if (!text) return null
  // Direct parse first
  try { return JSON.parse(text) } catch {}
  // Strip markdown code fences and retry
  const stripped = text.replace(/^```(?:json)?\n?|\n?```$/gm, '').trim()
  try { return JSON.parse(stripped) } catch {}
  // Extract first JSON object from surrounding text
  const m = stripped.match(/\{[\s\S]*\}/)
  if (m) {
    try { return JSON.parse(m[0]) } catch {}
    // Escape literal newlines/tabs that appear inside string values
    try {
      let inStr = false, out = ''
      for (let i = 0; i < m[0].length; i++) {
        const ch = m[0][i]
        if (ch === '"' && (i === 0 || m[0][i - 1] !== '\\')) inStr = !inStr
        if (inStr && ch === '\n') { out += '\\n'; continue }
        if (inStr && ch === '\r') { out += '\\r'; continue }
        if (inStr && ch === '\t') { out += '\\t'; continue }
        out += ch
      }
      return JSON.parse(out)
    } catch {}
  }
  // Try JSON array
  const arr = stripped.match(/\[[\s\S]*\]/)
  if (arr) { try { return JSON.parse(arr[0]) } catch {} }
  return null
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
  'extract_study': 1500,
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
  'write_intro': 700,
  'write_human_subjects': 1500,
  'write_vert_animals': 1000,
  'write_auth_resources': 500,
  'write_resource_sharing': 600,
  'write_select_agents': 500,
  'write_cover_letter': 400,
  'write_project_timeline': 600,
  'generate_letter': 800,
  'resubmission_analyze': 2000,
  'resubmission_intro': 700,
  'resubmission_revise': 2500,
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

    let parsed = safeParseJSON(raw)
    if (!parsed) return

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

  // Sanitize user message content before sending to Anthropic
  if (body.messages) {
    let injectionDetected = false
    body.messages = body.messages.map(m => {
      if (m.role === 'user' && typeof m.content === 'string') {
        const { text, detected } = sanitizeUserInput(m.content)
        if (detected) injectionDetected = true
        return { ...m, content: text }
      }
      return m
    })
    if (injectionDetected) {
      await logError('/api/ai', 200, 'prompt_injection_attempt', 0, userId, env)
    }
  }

  const result = await callAnthropicWithFallback(body, env)
  if (result._fallback) {
    return json({ error: 'ai_unavailable', message: 'AI generation is temporarily unavailable. Your work is saved. Please try again in a few minutes.', retry_after: 60 }, 503)
  }

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
    `SELECT id, title, mechanism, updated_at, created_at,
      status, submission_date, next_deadline, priority, award_amount, award_number, sections
     FROM projects WHERE user_id = ? ORDER BY updated_at DESC`
  ).bind(userId).all()
  const projects = (results || []).map(p => {
    let completion_pct = 0
    try {
      const secs = JSON.parse(p.sections || '{}')
      const keys = ['aims', 'sig', 'innov', 'approach', 'summary', 'narrative']
      const filled = keys.filter(k => secs[k] && secs[k].length > 50).length
      completion_pct = Math.round((filled / keys.length) * 100)
    } catch {}
    return { ...p, sections: undefined, completion_pct, status: p.status || 'draft', priority: p.priority || 'medium' }
  })
  return json(projects)
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
  row.fast_track_phase1_sections = row.fast_track_phase1_sections ? JSON.parse(row.fast_track_phase1_sections) : {}
  row.fast_track_phase2_sections = row.fast_track_phase2_sections ? JSON.parse(row.fast_track_phase2_sections) : {}
  row.go_no_go_milestone = row.go_no_go_milestone || ''
  row.d2p2_funding_source = row.d2p2_funding_source || ''
  row.d2p2_equivalency_period = row.d2p2_equivalency_period || ''
  row.d2p2_milestones_achieved = row.d2p2_milestones_achieved || ''
  row.d2p2_rationale = row.d2p2_rationale || ''
  row.aims_optimization = row.aims_optimization ? (() => { try { return JSON.parse(row.aims_optimization) } catch { return null } })() : null
  row.aims_alternatives = row.aims_alternatives ? (() => { try { return JSON.parse(row.aims_alternatives) } catch { return null } })() : null
  row.status = row.status || 'draft'
  row.priority = row.priority || 'medium'
  row.submission_date = row.submission_date || null
  row.award_date = row.award_date || null
  row.award_amount = row.award_amount || null
  row.award_number = row.award_number || null
  row.next_deadline = row.next_deadline || null
  row.notes = row.notes || null
  row.shared_with = row.shared_with ? (() => { try { return JSON.parse(row.shared_with) } catch { return [] } })() : []
  row.section_assignments = row.section_assignments ? (() => { try { return JSON.parse(row.section_assignments) } catch { return {} } })() : {}
  row.current_version = row.current_version || 1
  row.rewrite_results = row.rewrite_results ? (() => { try { return JSON.parse(row.rewrite_results) } catch { return {} } })() : {}
  row.reference_check_results = row.reference_check_results ? (() => { try { return JSON.parse(row.reference_check_results) } catch { return {} } })() : {}
  row.rewrite_cycles_used = row.rewrite_cycles_used || 0
  row.rewrite_cycles_remaining = row.rewrite_cycles_remaining || 0
  // Quality review fields (v5.5.0)
  row.quality_pass1_results = row.quality_pass1_results ? (() => { try { return JSON.parse(row.quality_pass1_results) } catch { return null } })() : null
  row.quality_pass2_results = row.quality_pass2_results ? (() => { try { return JSON.parse(row.quality_pass2_results) } catch { return null } })() : null
  row.quality_pass3_results = row.quality_pass3_results ? (() => { try { return JSON.parse(row.quality_pass3_results) } catch { return null } })() : null
  row.quality_pass1_at = row.quality_pass1_at || null
  row.quality_pass2_at = row.quality_pass2_at || null
  row.quality_pass3_at = row.quality_pass3_at || null
  row.quality_certified = row.quality_certified === 1
  row.quality_certified_at = row.quality_certified_at || null
  row.delivery_ready = row.delivery_ready === 1
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
      go_no_go_milestone = ?, fast_track_phase1_sections = ?, fast_track_phase2_sections = ?,
      d2p2_funding_source = ?, d2p2_equivalency_period = ?, d2p2_milestones_achieved = ?, d2p2_rationale = ?,
      section_assignments = ?,
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
    body.go_no_go_milestone || null,
    body.fast_track_phase1_sections ? JSON.stringify(body.fast_track_phase1_sections) : null,
    body.fast_track_phase2_sections ? JSON.stringify(body.fast_track_phase2_sections) : null,
    body.d2p2_funding_source || null,
    body.d2p2_equivalency_period || null,
    body.d2p2_milestones_achieved || null,
    body.d2p2_rationale || null,
    body.section_assignments ? JSON.stringify(body.section_assignments) : null,
    now, projectId, userId
  ).run()
  if (result.changes === 0) return err('Project not found', 404)

  // Reset quality certification when sections are edited (v5.5.0)
  if (body.sections) {
    await env.DB.prepare('UPDATE projects SET quality_certified = 0, delivery_ready = 0 WHERE id = ? AND user_id = ?').bind(projectId, userId).run()
  }

  // Auto-snapshot if triggered by generation
  if (body._auto_snapshot && body.sections) {
    try {
      const latest = await env.DB.prepare('SELECT MAX(version_number) as max_ver FROM project_versions WHERE project_id = ?').bind(projectId).first()
      const nextVer = (latest?.max_ver || 0) + 1
      await env.DB.prepare(
        'INSERT INTO project_versions (project_id, user_id, version_number, sections_snapshot, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(projectId, userId, nextVer, JSON.stringify(body.sections), body._snapshot_summary || 'Auto-save', now).run()
      await env.DB.prepare('UPDATE projects SET current_version = ? WHERE id = ?').bind(nextVer, projectId).run()
    } catch (e) { console.error('Auto-snapshot failed:', e) }
  }

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
      rules = safeParseJSON(raw)

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
    const analysis = safeParseJSON(raw)
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

  // Quality metrics (v5.5.0)
  const thisMonth = Math.floor(new Date(now * 1000).setDate(1) / 1000)
  const qualityCertifiedMonth = await env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE quality_certified = 1 AND quality_certified_at >= ?').bind(thisMonth).first()
  const qualityPass1Avg = await env.DB.prepare('SELECT AVG(json_extract(quality_pass1_results, "$.accuracy_score")) as avg FROM projects WHERE quality_pass1_results IS NOT NULL').first()
  const qualityPass2Avg = await env.DB.prepare('SELECT AVG(json_extract(quality_pass2_results, "$.compliance_score")) as avg FROM projects WHERE quality_pass2_results IS NOT NULL').first()
  const deliveryReadyCount = await env.DB.prepare('SELECT COUNT(*) as count FROM projects WHERE delivery_ready = 1').first()
  const failingQuality = await env.DB.prepare('SELECT id, title, quality_pass1_results, quality_pass2_results, quality_pass3_results FROM projects WHERE (quality_pass1_results IS NOT NULL OR quality_pass2_results IS NOT NULL) AND quality_certified = 0 LIMIT 10').all()
  const qualityMetrics = {
    certified_this_month: qualityCertifiedMonth?.count || 0,
    avg_pass1_accuracy: qualityPass1Avg?.avg ? Math.round(qualityPass1Avg.avg) : null,
    avg_pass2_compliance: qualityPass2Avg?.avg ? Math.round(qualityPass2Avg.avg) : null,
    delivery_ready_count: deliveryReadyCount?.count || 0,
    failing_quality: (failingQuality.results || []).map(p => {
      const p1 = p.quality_pass1_results ? (() => { try { return JSON.parse(p.quality_pass1_results) } catch { return null } })() : null
      const p2 = p.quality_pass2_results ? (() => { try { return JSON.parse(p.quality_pass2_results) } catch { return null } })() : null
      const p3 = p.quality_pass3_results ? (() => { try { return JSON.parse(p.quality_pass3_results) } catch { return null } })() : null
      return { id: p.id, title: p.title, pass1_failed: p1 && !p1.passed, pass2_failed: p2 && !p2.passed, pass3_failed: p3 && !p3.passed }
    })
  }

  return json({
    error_rate: errorRate.toFixed(2), avg_latency_ms: avgLatency.avg?.toFixed(1) || 0,
    claude_error_rate: claudeErrorRate.toFixed(2), rate_limit_hits: rateLimitHits.count,
    row_counts: rowCounts, deployments: deployments.results, recent_errors: recentErrors.results,
    quality_metrics: qualityMetrics
  })
}

function wordCount(text) {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(Boolean).length
}

function buildFullGrantContext(project, sections, setup, fastTrackSections) {
  const mech = project.mechanism || ''
  const isSBIR = mech.includes('SBIR') || mech.includes('STTR') || mech.includes('D2P2')
  const isFastTrack = mech === 'FAST-TRACK'
  const isPhaseII = mech.includes('-II') || mech === 'D2P2' || mech === 'R01'

  const wc = (text) => {
    const n = wordCount(text)
    return n > 0 ? `(${n} words)` : '(not generated)'
  }

  let ft1 = {}, ft2 = {}
  try { ft1 = JSON.parse(fastTrackSections?.phase1 || '{}') } catch {}
  try { ft2 = JSON.parse(fastTrackSections?.phase2 || '{}') } catch {}

  const minWords = {
    aims: 200, sig: 400, innov: 200, approach: 800,
    commercial: isPhaseII ? 1500 : 300, data_mgmt: 300, facilities: 100,
  }

  const sectionWordCounts = {
    aims: wordCount(sections.aims),
    sig: wordCount(sections.sig),
    innov: wordCount(sections.innov),
    approach: wordCount(sections.approach),
    commercial: wordCount(sections.commercial || sections.commercialization_potential),
    data_mgmt: wordCount(sections.data_mgmt),
    facilities: wordCount(sections.facilities),
  }

  const wordCountSummary = Object.entries(sectionWordCounts)
    .filter(([k]) => k !== 'commercial' || isSBIR)
    .map(([k, n]) => {
      const labels = { aims: 'Specific Aims', sig: 'Significance', innov: 'Innovation', approach: 'Approach', commercial: 'Commercialization Plan', data_mgmt: 'Data Management Plan', facilities: 'Facilities' }
      const min = minWords[k]
      const flag = n > 0 && n < min ? ` [BRIEF: ${n} words, expected ≥${min}]` : n === 0 ? ' [NOT GENERATED]' : ''
      return `  ${labels[k]}: ${n} words${flag}`
    }).join('\n')

  const lines = [
    `GRANT APPLICATION FOR REVIEW`,
    `Title: ${project.title || setup.title || setup.disease || 'Untitled'}`,
    `Mechanism: ${mech}`,
    `Institute: ${setup.institute || 'NIH'}`,
    `PI: ${setup.pi || 'Not specified'}`,
    `Institution: ${setup.institution || setup.partner || 'Not specified'}`,
    `Disease/Indication: ${setup.disease || 'Not specified'}`,
    ``,
    `SECTION WORD COUNTS:`,
    wordCountSummary,
    ``,
    `PROJECT SUMMARY ${wc(sections.summary)}:`,
    sections.summary || 'Not generated',
    ``,
    `PROJECT NARRATIVE ${wc(sections.narrative)}:`,
    sections.narrative || 'Not generated',
    ``,
    `SPECIFIC AIMS (complete text) ${wc(sections.aims)}:`,
    sections.aims || 'Not generated',
    ``,
    `SIGNIFICANCE (complete text) ${wc(sections.sig)}:`,
    sections.sig || 'Not generated',
    ``,
    `INNOVATION (complete text) ${wc(sections.innov)}:`,
    sections.innov || 'Not generated',
    ``,
  ]

  if (isFastTrack) {
    lines.push(
      `PHASE I RESEARCH STRATEGY — APPROACH (complete text) ${wc(ft1.approach || '')}:`,
      ft1.approach || 'Not generated',
      ``,
      `PHASE II RESEARCH STRATEGY — APPROACH (complete text) ${wc(ft2.approach || '')}:`,
      ft2.approach || 'Not generated',
      ``,
    )
  } else {
    lines.push(
      `APPROACH (complete text) ${wc(sections.approach)}:`,
      sections.approach || 'Not generated',
      ``,
    )
  }

  if (isSBIR) {
    const commText = sections.commercial || sections.commercialization_potential || ''
    lines.push(
      `COMMERCIALIZATION PLAN (complete text) ${wc(commText)}:`,
      commText || 'Not generated',
      ``,
    )
  }

  lines.push(
    `DATA MANAGEMENT AND SHARING PLAN (complete text) ${wc(sections.data_mgmt)}:`,
    sections.data_mgmt || 'Not generated',
    ``,
    `FACILITIES AND RESOURCES (complete text) ${wc(sections.facilities)}:`,
    sections.facilities || 'Not generated',
    ``,
  )

  if (project.prelim_data_narrative) {
    lines.push(
      `PRELIMINARY DATA NARRATIVE:`,
      project.prelim_data_narrative,
      ``,
    )
  }

  if (sections.phase1_equivalency) {
    lines.push(
      `PHASE I EQUIVALENCY DOCUMENTATION (complete text) ${wc(sections.phase1_equivalency)}:`,
      sections.phase1_equivalency,
      ``,
    )
  }

  if (sections.human_subjects) {
    lines.push(`HUMAN SUBJECTS (complete text):`, sections.human_subjects, ``)
  }

  if (sections.vertebrate_animals) {
    lines.push(`VERTEBRATE ANIMALS (complete text):`, sections.vertebrate_animals, ``)
  }

  return lines.join('\n')
}

async function handleGetMe(req, env, userId) {
  const meta = await env.DB.prepare('SELECT email, plan_tier, voice_enabled, voice_tier FROM users_meta WHERE id = ?').bind(userId).first()
  return json({
    voice_enabled: meta?.voice_enabled === 1,
    plan_tier: meta?.plan_tier || 'free',
    voice_tier: meta?.voice_tier || null,
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
  if (body.voice_enabled !== undefined) {
    await env.DB.prepare('UPDATE users_meta SET voice_enabled = ? WHERE id = ?').bind(body.voice_enabled ? 1 : 0, userId).run()
    await env.DB.prepare('INSERT INTO admin_actions (action_type, entity, entity_id, old_value, new_value, admin_user_id) VALUES (?, ?, ?, ?, ?, ?)').bind('voice_toggle', 'user', userId, 'unknown', body.voice_enabled ? '1' : '0', adminUserId).run()
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

  const voiceRow = await env.DB.prepare('SELECT COUNT(*) as sessions, SUM(input_tokens + output_tokens) as tokens FROM usage_log WHERE action = ? AND created_at >= ?').bind('voice_chat', startOfMonth).first()
  const voicePricing = PRICING['claude-sonnet-4-20250514']
  const voiceCost = voiceRow ? ((voiceRow.tokens || 0) / 1000000) * ((voicePricing.input + voicePricing.output) / 2) : 0
  const voiceStats = {
    total_sessions: voiceRow?.sessions || 0,
    total_tokens: voiceRow?.tokens || 0,
    total_cost: voiceCost,
    avg_session_cost: voiceRow?.sessions > 0 ? voiceCost / voiceRow.sessions : 0
  }

  // Submission packages stats
  const pkgStats = await env.DB.prepare('SELECT COUNT(*) as total, SUM(cycles_used) as total_cycles_used, COUNT(CASE WHEN cycles_remaining > 0 THEN 1 END) as active_packages, COUNT(CASE WHEN cycles_remaining = 0 THEN 1 END) as exhausted_packages FROM submission_packages').first()
  const submissionPackages = {
    total_sold: pkgStats?.total || 0,
    total_revenue: (pkgStats?.total || 0) * 199,
    avg_cycles_used: pkgStats?.total > 0 ? Math.round((pkgStats.total_cycles_used || 0) / pkgStats.total * 10) / 10 : 0,
    active_packages: pkgStats?.active_packages || 0,
    exhausted_packages: pkgStats?.exhausted_packages || 0,
  }

  return json({ today_spend: todaySpend, month_spend: monthSpend, by_feature: featureCosts, by_model: modelCosts, by_user: byUser.results, voice: voiceStats, submission_packages: submissionPackages })
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
  return json({ themes: safeParseJSON(text) || [] })
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
  let analysis = safeParseJSON(raw)
  if (!analysis) return err('Analysis parsing failed')

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
  let searchTerms = safeParseJSON(kwRaw) || []

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

// ── Voice Mode Routes ─────────────────────────────────────────────────────────

const VOICE_INTENT_PROMPT = `Classify this voice message into exactly one intent. Return only the intent word and optional section name separated by colon. Nothing else.
Intents: STATUS, READ_SECTION, EDIT_SECTION, GENERATE, COMPLIANCE, PRELIM_DATA, STUDY_SECTION, PD_REVIEW, ADVISORY_COUNCIL, NAVIGATION, QUESTION
Examples:
'read me the aims page' → READ_SECTION:aims
'how many pages do I have left' → STATUS
'make the significance stronger' → EDIT_SECTION:significance
'what did reviewer 2 say' → STUDY_SECTION
'write the approach section' → GENERATE:approach
'what are my compliance issues' → COMPLIANCE
'what is my preliminary data score' → PRELIM_DATA
'go to the innovation section' → NAVIGATION:innovation
'what did the program director say' → PD_REVIEW
'what does the PD think' → PD_REVIEW
'what is the council recommendation' → ADVISORY_COUNCIL
'what did the advisory council decide' → ADVISORY_COUNCIL
'what is the budget cap for STTR Phase I' → QUESTION
Message: `

async function detectIntent(message, env) {
  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 20, messages: [{ role: 'user', content: VOICE_INTENT_PROMPT + message }] }),
  })
  const r = await resp.json()
  const text = (r.content?.[0]?.text || '').trim()
  const [intent, section] = text.split(':')
  return { intent: intent?.trim() || 'QUESTION', section: section?.trim() || null }
}

async function handleVoiceIntent(req, env, userId) {
  const body = await req.json()
  const { message } = body
  if (!message) return err('message required')
  const result = await detectIntent(message, env)
  return json(result)
}

async function handleVoiceChat(req, env, userId) {
  const body = await req.json()
  const { message, project_id, conversation_history = [], current_section } = body
  if (!message) return err('message required')

  // Detect intent
  const { intent, section: intentSection } = await detectIntent(message, env)

  // Load project
  let project = null, setup = {}, sections = {}
  if (project_id) {
    project = await env.DB.prepare(
      'SELECT title, mechanism, setup, sections, foa_number, prelim_data_score, compliance_results, study_section_results, pd_review_results, advisory_council_results FROM projects WHERE id = ? AND user_id = ?'
    ).bind(project_id, userId).first()
    if (project) {
      try { setup = JSON.parse(project.setup || '{}') } catch {}
      try { sections = JSON.parse(project.sections || '{}') } catch {}
    }
  }

  // Build base context (under 600 tokens)
  const baseContext = project ? {
    title: project.title,
    pi: setup.pi || setup.pi_name || 'the PI',
    mechanism: project.mechanism,
    institute: setup.institute || null,
    disease: setup.disease || setup.disease_area || null,
    foa: project.foa_number || null,
    sections_generated: Object.keys(sections).filter(k => sections[k]?.length > 0),
    word_counts: Object.fromEntries(Object.keys(sections).map(k => [k, (sections[k] || '').split(' ').filter(Boolean).length])),
    research_strategy_pages: Math.round(((sections.sig || '').split(' ').length + (sections.innov || '').split(' ').length + (sections.approach || '').split(' ').length) / 250 * 10) / 10,
    research_strategy_limit: (project.mechanism || '').includes('II') ? 12 : 6,
    prelim_score: project.prelim_data_score || 0,
    compliance_issues: (() => { try { return Object.values(JSON.parse(project.compliance_results || '{}')).reduce((a, r) => a + (r?.issues?.filter(i => i.severity === 'critical').length || 0), 0) } catch { return 0 } })(),
    study_section_score: (() => { try { return JSON.parse(project.study_section_results || 'null')?.summary?.impact_score || null } catch { return null } })(),
  } : null

  // Load additional context based on intent
  let additionalCtx = ''
  if ((intent === 'READ_SECTION' || intent === 'EDIT_SECTION') && intentSection && sections[intentSection]) {
    additionalCtx = `\nSECTION CONTENT (${intentSection}):\n${sections[intentSection].slice(0, 2000)}`
  } else if (intent === 'COMPLIANCE' && project?.compliance_results) {
    try { additionalCtx = `\nCOMPLIANCE RESULTS:\n${JSON.stringify(JSON.parse(project.compliance_results), null, 2).slice(0, 1000)}` } catch {}
  } else if (intent === 'STUDY_SECTION' && project?.study_section_results) {
    try { additionalCtx = `\nSTUDY SECTION RESULTS:\n${JSON.stringify(JSON.parse(project.study_section_results).summary, null, 2).slice(0, 800)}` } catch {}
  } else if (intent === 'PD_REVIEW' && project?.pd_review_results) {
    try {
      const pd = JSON.parse(project.pd_review_results)
      additionalCtx = `\nPROGRAM DIRECTOR REVIEW:\nFundability: ${pd.fundability}\nOverall Assessment: ${(pd.overall_assessment || '').slice(0, 400)}\nKey Concerns: ${(pd.concerns || []).slice(0, 3).join('; ')}`
    } catch {}
  } else if (intent === 'ADVISORY_COUNCIL' && project?.advisory_council_results) {
    try {
      const ac = JSON.parse(project.advisory_council_results)
      additionalCtx = `\nADVISORY COUNCIL RECOMMENDATION:\nDecision: ${ac.decision}\nPriority: ${ac.priority}\nRationale: ${(ac.rationale || '').slice(0, 400)}\nFinal Statement: ${(ac.final_statement || '').slice(0, 300)}`
    } catch {}
  }

  // Keep last 6 exchanges
  const recentHistory = (conversation_history || []).slice(-6)
  const historyText = recentHistory.map(h => `${h.role === 'user' ? 'Researcher' : 'Assistant'}: ${h.content}`).join('\n')

  // Build system prompt
  const piName = setup.pi || 'the PI'
  const lastName = piName.split(' ').pop() || 'there'
  const systemPrompt = `You are an expert NIH grant writing assistant helping ${piName} with their ${project?.mechanism || 'NIH'} grant application${project?.title ? ` titled "${project.title}"` : ''}${setup.disease ? ` targeting ${setup.disease}` : ''}. You are speaking — the researcher is listening to your voice, not reading text. Follow these rules strictly:

Keep all responses under 120 words unless you are reading a full grant section
Never use bullet points, numbered lists, headers, or markdown
Speak naturally and conversationally as if talking to a colleague
When reading a section, read the complete text naturally without commentary
After reading or explaining something, always offer one clear next option
Address the researcher as Dr. ${lastName} occasionally to maintain professional rapport
When asked about NIH rules, answer directly and confidently
If asked to make a change, confirm what you will change before doing it
Be warm but efficient — this is a working session not a chat

Current grant state: ${baseContext ? JSON.stringify(baseContext) : 'No project loaded'}`

  const userContent = `${additionalCtx}\n\nConversation history:\n${historyText}\n\nResearcher says: ${message}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 300,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  })
  const result = await resp.json()
  const responseText = result.content?.[0]?.text || ''
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0

  // Log usage
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'voice_chat', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  // Determine action
  let action = null
  if (intent === 'GENERATE' && intentSection) action = { type: 'generate', section: intentSection }
  else if (intent === 'EDIT_SECTION' && intentSection) action = { type: 'edit', section: intentSection }

  return json({ response: responseText, intent, action, tokens_used: inputTokens + outputTokens })
}

async function handleVoiceSpeak(req, env, userId) {
  const body = await req.json()
  const { text, use_elevenlabs, voice_id } = body
  if (!text) return err('text required')

  const wordCount = text.trim().split(/\s+/).length
  const VALID_VOICES = ['pNInz6obpgDQGcFmaJgB', '21m00Tcm4TlvDq8ikWAM', 'ErXwobaYiN019PkySvjV', 'MF3mGyEYCl7XYWbV9V8O']
  const voiceToUse = VALID_VOICES.includes(voice_id) ? voice_id : 'pNInz6obpgDQGcFmaJgB'

  if (use_elevenlabs && env.ELEVENLABS_API_KEY && wordCount > 50) {
    try {
      const elevenResp = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceToUse}`, {
        method: 'POST',
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_monolingual_v1',
          voice_settings: { stability: 0.75, similarity_boost: 0.75 },
        }),
      })
      if (elevenResp.ok) {
        const audioBuffer = await elevenResp.arrayBuffer()
        return new Response(audioBuffer, { status: 200, headers: { ...CORS, 'Content-Type': 'audio/mpeg' } })
      }
    } catch {}
  }

  return json({ fallback: true, text })
}

async function handleVoiceSessionGet(req, env, userId) {
  const url = new URL(req.url)
  const projectId = url.searchParams.get('project_id')
  if (!projectId) return json({ conversation_history: [], session_cost: 0, summary: null })

  const key = `voice:${projectId}:${userId}`
  const data = await env.KV.get(key, 'json')
  return json(data || { conversation_history: [], session_cost: 0, summary: null })
}

async function handleVoiceSessionPost(req, env, userId) {
  const body = await req.json()
  const { project_id, conversation_history, session_cost, summary } = body
  if (!project_id) return err('project_id required')

  const key = `voice:${project_id}:${userId}`
  await env.KV.put(key, JSON.stringify({ conversation_history, session_cost, summary }), { expirationTtl: 4 * 3600 })
  return json({ ok: true })
}

// ── Study Section Simulation ──────────────────────────────────────────────────
const SS_REVIEWER_1 = `You are the PRIMARY REVIEWER (basic scientist, molecular/cellular focus, 25 years running an NIH-funded lab). Score each criterion 1-9 (1=Exceptional, 9=Poor). Be thorough, candid, and specific.

You are reviewing the COMPLETE grant application — every section is provided in full with word counts.

CRITERION-LEVEL INCOMPLETENESS DETECTION: Before scoring each criterion, check if there is sufficient content in the relevant sections to score reliably. Set scoreable: false (and score: null) if a section is absent, cuts off mid-sentence, is under 100 words where 500+ is expected, or is missing a required key subsection. Examples: "Regulatory pathway section ends abruptly at 'The IND submission will include' — insufficient to evaluate regulatory strategy" → scoreable: false for Approach. "No PI credentials or team composition provided" → scoreable: false for Investigators.

EVIDENCE REQUIREMENT: For every criterion, quote or closely paraphrase actual text from the grant. NEVER use generic statements ("the application addresses an important unmet need"). Always cite specific: patient numbers, percentages, dollar amounts, named techniques, quoted claims.

SCORE RATIONALE: Explain step-by-step why this exact score — what specific addition would move it one point better, what specific flaw prevents it from being one point better.

PACKAGE AUDIT: Explicitly note any missing submission components in your critique.

Output ONLY valid JSON (no preamble, no text outside the JSON):
{
  "criteria": {
    "impact": {"score": 1-9 or null, "evidence": "direct quote or close paraphrase from this grant", "score_rationale": "why this score not one point better or worse", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "specific explanation"},
    "significance": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "innovation": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "approach": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "investigators": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "environment": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."}
  },
  "critique": "2-3 paragraph narrative in NIH study section reviewer voice"
}`

const SS_REVIEWER_2 = `You are the SECONDARY REVIEWER (translational physician-scientist MD/PhD). Critique clinical relevance and path to patients. Score each criterion 1-9 (1=Exceptional, 9=Poor).

You are reviewing the COMPLETE grant application — every section is provided in full with word counts.

CRITERION-LEVEL INCOMPLETENESS DETECTION: Before scoring each criterion, check if there is sufficient content to score reliably. Set scoreable: false (and score: null) if a section is absent, cuts off mid-sentence, under 100 words where 500+ expected, or missing a required key subsection.

EVIDENCE REQUIREMENT: Quote or closely paraphrase actual text from this specific grant. Never use generic statements. Cite specific patient populations, clinical trial data, regulatory designations, named endpoints.

SCORE RATIONALE: Step-by-step reasoning — why this score, what would make it one point better, what prevents that.

PACKAGE AUDIT: Identify missing clinical development documentation in your critique.

Output ONLY valid JSON:
{
  "criteria": {
    "impact": {"score": 1-9 or null, "evidence": "direct quote/paraphrase from this grant", "score_rationale": "why this score vs one point better/worse", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "significance": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "innovation": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "approach": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "investigators": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "environment": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."}
  },
  "critique": "2-3 paragraph narrative in NIH study section reviewer voice focused on clinical relevance"
}`

const SS_REVIEWER_3 = `You are the READER (biostatistician/methodologist). Focus on study design, statistical power, SABV. Score all criteria 1-9 (1=Exceptional, 9=Poor). Give a focused critique emphasizing Approach.

You are reviewing the COMPLETE grant application — every section is provided in full with word counts.

CRITERION-LEVEL INCOMPLETENESS DETECTION: Set scoreable: false (score: null) if a section is absent, truncated mid-sentence, under 100 words where 500+ expected, or missing a required subsection. Pay particular attention to missing power calculations, sample size justifications, statistical methods.

EVIDENCE REQUIREMENT: Quote or closely paraphrase actual text. For methodology critique: cite specific sample sizes, named statistical tests, described study designs from the grant text.

SCORE RATIONALE: Step-by-step reasoning for each score vs one point better or worse.

Output ONLY valid JSON:
{
  "criteria": {
    "impact": {"score": 1-9 or null, "evidence": "direct quote/paraphrase from this grant", "score_rationale": "why this score vs one point better/worse", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "significance": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "innovation": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "approach": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "investigators": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."},
    "environment": {"score": 1-9 or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "..."}
  },
  "critique": "2-3 paragraph narrative focused heavily on study design and statistical methodology"
}`

const SS_SUMMARY = `You are the Scientific Review Officer (SRO) synthesizing three reviewer assessments into an NIH Summary Statement. You receive pre-computed averaged criterion scores and three reviewer JSON outputs. Your job is to write the narrative and select the best evidence for each criterion from across the three reviewers.

Output ONLY valid JSON:
{
  "impact_score": number (1-9 averaged, null if fewer than 3 of 5 criteria are scoreable),
  "percentile": number (estimated 0-99, null if impact_score is null),
  "criteria": {
    "significance": {"score": use the pre-computed score provided, "evidence": "best evidence from any reviewer — direct quote or paraphrase from the grant", "score_rationale": "synthesized step-by-step rationale from reviewer consensus", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "synthesized reason"},
    "innovation": {same 6 fields},
    "approach": {same 6 fields},
    "investigators": {same 6 fields},
    "environment": {same 6 fields}
  },
  "strengths": ["string"],
  "weaknesses": ["string"],
  "synthesis": "string (2-3 paragraph summary statement in SRO voice)",
  "fundability": "string",
  "missing_components": [
    {
      "component": "string",
      "expected_location": "string",
      "why_it_matters": "string",
      "impact_on_score": "string",
      "severity": "critical|major|minor"
    }
  ],
  "package_completeness_critique": "string (reviewer-voice paragraph directly to applicant)"
}`

async function handleStudySection(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const isD2P2 = project.mechanism === 'D2P2'
  const d2p2ReviewerNote = isD2P2 ? `

IMPORTANT — D2P2 APPLICATION: This is an NCI Direct to Phase 2 application. The applicant claims to have completed Phase I equivalent research WITHOUT federal SBIR/STTR funding. Apply these additional review criteria:
1. Is the Phase I Equivalency Documentation convincing? Does the completed work genuinely constitute Phase I equivalent research?
2. Are the claimed milestones specific, quantitative, and sufficient to justify skipping a standard Phase I?
3. Is the proposed Phase II development plan appropriately advanced given the claimed Phase I completion — or does it re-do feasibility work?
4. Are go/no-go criteria for Phase III realistic and measurable?
5. Is the Commercialization Plan appropriate for a company that has already been self-funding development?
6. Does the applicant demonstrate genuine commercial commitment through their prior private investment?` : ''

  const fullGrantContext = buildFullGrantContext(
    project, sections, setup,
    { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections }
  )

  const userMsg = `Review this NIH ${project.mechanism || 'grant'} application:\n\n${fullGrantContext}`

  const callReviewer = async (system) => {
    const systemWithD2P2 = system + d2p2ReviewerNote
    const resp = await callAnthropicWithFallback({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: systemWithD2P2,
      messages: [{ role: 'user', content: userMsg }],
    }, env)
    if (resp._fallback) return { criteria: null, critique: 'Reviewer unavailable due to service interruption.', usage: { input_tokens: 0, output_tokens: 0 } }
    const r = await resp.json()
    const text = r.content?.[0]?.text || ''
    const parsed = safeParseJSON(text)
    return {
      criteria: parsed?.criteria || null,
      critique: parsed?.critique || text,
      usage: r.usage,
    }
  }

  const [rev1, rev2, rev3] = await Promise.all([
    callReviewer(SS_REVIEWER_1),
    callReviewer(SS_REVIEWER_2),
    callReviewer(SS_REVIEWER_3),
  ])

  // Aggregate criterion scores in JS for reliability
  const criteriaKeys = ['significance', 'innovation', 'approach', 'investigators', 'environment']
  const aggregatedCriteria = {}
  for (const key of criteriaKeys) {
    const revData = [rev1, rev2, rev3].map(r => r.criteria?.[key]).filter(Boolean)
    const scoreableRevs = revData.filter(c => c.scoreable !== false && c.score != null)
    const majorityScoreable = scoreableRevs.length >= Math.ceil(revData.length / 2)
    const avgScore = scoreableRevs.length > 0
      ? Math.round(scoreableRevs.reduce((s, c) => s + c.score, 0) / scoreableRevs.length * 10) / 10
      : null
    const evidenceSrc = scoreableRevs.find(c => c.confidence === 'high') || scoreableRevs[0] || revData[0]
    aggregatedCriteria[key] = {
      score: majorityScoreable ? avgScore : null,
      scoreable: majorityScoreable,
      unscorable_reason: majorityScoreable ? null : (revData.find(c => c.unscorable_reason)?.unscorable_reason || 'Insufficient content to score this criterion reliably'),
      evidence: evidenceSrc?.evidence || null,
      score_rationale: evidenceSrc?.score_rationale || null,
      confidence: evidenceSrc?.confidence || 'medium',
    }
  }

  // Impact score: null if fewer than 3 of 5 criteria are scoreable
  const scoreableCount = criteriaKeys.filter(k => aggregatedCriteria[k].scoreable).length
  const impactRevData = [rev1, rev2, rev3].map(r => r.criteria?.impact).filter(Boolean)
  const scoreableImpact = impactRevData.filter(c => c.scoreable !== false && c.score != null)
  const rawImpactScore = scoreableImpact.length > 0
    ? Math.round(scoreableImpact.reduce((s, c) => s + c.score, 0) / scoreableImpact.length * 10) / 10
    : null
  const finalImpactScore = scoreableCount >= 3 ? rawImpactScore : null

  // Legacy scores object for reviewer accordion display
  const toScores = (rev) => {
    const c = rev.criteria || {}
    return {
      impact: c.impact?.score || null,
      significance: c.significance?.score || null,
      innovation: c.innovation?.score || null,
      approach: c.approach?.score || null,
      investigators: c.investigators?.score || null,
      environment: c.environment?.score || null,
    }
  }
  const s1 = toScores(rev1), s2 = toScores(rev2), s3 = toScores(rev3)

  const synthInput = `PRE-COMPUTED AVERAGED SCORES (use these exactly in criteria.score fields):
${JSON.stringify(aggregatedCriteria, null, 2)}

SCOREABLE CRITERIA COUNT: ${scoreableCount} of 5 (impact_score should be ${scoreableCount >= 3 ? finalImpactScore : 'null — fewer than 3 criteria scoreable'})

PRIMARY REVIEWER CRITIQUE:
${rev1.critique}

SECONDARY REVIEWER CRITIQUE:
${rev2.critique}

READER CRITIQUE:
${rev3.critique}

For each criterion in your output: use the pre-computed score exactly, but synthesize the best evidence and score_rationale from all three reviewers.`

  const synthResp = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    system: SS_SUMMARY,
    messages: [{ role: 'user', content: synthInput }],
  }, env)

  let synthResult = { content: [{ text: '' }], usage: { input_tokens: 0, output_tokens: 0 } }
  if (!synthResp._fallback) synthResult = await synthResp.json()
  const synthText = synthResult.content?.[0]?.text || ''

  let summary = safeParseJSON(synthText)

  if (!summary) {
    summary = {
      impact_score: finalImpactScore,
      percentile: finalImpactScore != null ? Math.min(99, Math.round(finalImpactScore * 9.5 + 5)) : null,
      criteria: aggregatedCriteria,
      strengths: [], weaknesses: [],
      synthesis: synthText.slice(0, 1200),
      fundability: finalImpactScore != null
        ? (finalImpactScore <= 2.5 ? 'Likely fundable' : finalImpactScore <= 4 ? 'Competitive, near payline' : finalImpactScore <= 6 ? 'Above payline for most ICs' : 'Below typical payline')
        : 'Unable to determine — insufficient scoreable criteria',
      missing_components: [],
      package_completeness_critique: '',
    }
  } else {
    // Ensure pre-computed scores are used (SRO may have guessed different values)
    summary.impact_score = finalImpactScore
    summary.percentile = finalImpactScore != null ? Math.min(99, Math.round(finalImpactScore * 9.5 + 5)) : null
    if (summary.criteria) {
      for (const key of criteriaKeys) {
        if (summary.criteria[key]) {
          summary.criteria[key].score = aggregatedCriteria[key].score
          summary.criteria[key].scoreable = aggregatedCriteria[key].scoreable
          if (!summary.criteria[key].unscorable_reason) {
            summary.criteria[key].unscorable_reason = aggregatedCriteria[key].unscorable_reason
          }
        }
      }
    } else {
      summary.criteria = aggregatedCriteria
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
    reviewer_1: { critique: rev1.critique, scores: s1, criteria: rev1.criteria },
    reviewer_2: { critique: rev2.critique, scores: s2, criteria: rev2.criteria },
    reviewer_3: { critique: rev3.critique, scores: s3, criteria: rev3.criteria },
    summary,
    input_tokens_reviewer_1: rev1.usage?.input_tokens || 0,
    generated_at: Math.floor(Date.now() / 1000),
  }

  try {
    await env.DB.prepare('UPDATE projects SET study_section_results = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(results), projectId, userId).run()
  } catch {}

  return json(results)
}

// ── PD Review ─────────────────────────────────────────────────────────────────
const PD_REVIEW_SYSTEM = `You are a senior NIH Program Director with 30 years across NCI, NIGMS, and NHLBI. You have managed portfolios worth $200M+ and attended 500+ study sections. You know what gets funded and what doesn't.

YOUR ROLE: You provide candid, actionable feedback on fundability. You are not a cheerleader. You are not a destroyer. You tell the truth with specific guidance.

You are reviewing the COMPLETE grant application — every section is provided in full with word counts. Score and critique based only on what you can actually read. For sections marked [BRIEF] or [NOT GENERATED], note this in your assessment.

REVIEW DIMENSIONS:
1. Mission Fit: Does this align with NIH/IC priorities and current funding initiatives?
2. Mechanism Match: Is this the right funding mechanism for the science maturity and team?
3. Portfolio Balance: Is NIH already funding 50 similar projects? Is there a gap this fills?
4. Budget Realism: Does the budget match the scope?
5. PI Fundability: Based on track record described, is this PI competitive?
6. Payline Strategy: Specific changes to move from 35th percentile to 10th percentile

PACKAGE AUDIT: Identify what is missing from this submission. A complete SBIR/STTR Phase II application includes: Specific Aims (1 page), Research Strategy (12 pages) with Significance/Innovation/Approach, Commercialization Plan (12 pages), Data Management Plan (2 pages), Facilities section, Biosketches, Human Subjects (if applicable), Vertebrate Animals (if applicable), Bibliography, and Letters of Support.

Return ONLY valid JSON matching this exact structure:
{
  "fundability": "fund_now|revise_and_resubmit|do_not_fund",
  "overall_assessment": "string",
  "strengths": ["string"],
  "concerns": ["string"],
  "recommended_actions": ["string"],
  "payline_estimate": "string",
  "priority_score_estimate": "string",
  "final_recommendation": "string",
  "missing_components": [
    {
      "component": "string",
      "expected_location": "string",
      "why_it_matters": "string",
      "impact_on_score": "string",
      "severity": "critical|major|minor"
    }
  ],
  "package_completeness_critique": "string (written as it would appear in an NIH program director memo, direct and specific)"
}`

async function handlePDReview(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const fullGrantContext = buildFullGrantContext(
    project, sections, setup,
    { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections }
  )

  const userMsg = `Review this ${project.mechanism || 'STTR-I'} grant application for ${setup.institute || 'NIH'}.

${fullGrantContext}

Write a Program Director review memo. Return ONLY valid JSON.`

  const resp = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: PD_REVIEW_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  }, env)
  if (resp._fallback) return json({ error: 'ai_unavailable' }, 503)
  const r = await resp.json()
  const text = r.content?.[0]?.text || ''

  let result = null
  const jm = text.match(/\{[\s\S]*\}/)
  if (jm) { result = safeParseJSON(jm[0]) }
  if (!result) result = { fundability: 'revise_and_resubmit', overall_assessment: text, strengths: [], concerns: [], recommended_actions: [], payline_estimate: 'Unable to estimate', priority_score_estimate: 'Unable to estimate', final_recommendation: 'See assessment above.', missing_components: [], package_completeness_critique: '' }

  const inputTokens = r.usage?.input_tokens || 0
  const outputTokens = r.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'pd_review', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  try {
    await env.DB.prepare('UPDATE projects SET pd_review_results = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(result), projectId, userId).run()
  } catch {}

  return json(result)
}

// ── Advisory Council ──────────────────────────────────────────────────────────
const ADVISORY_COUNCIL_SYSTEM = `You are the NIH Advisory Council reviewing applications that have been scored by study section.

COUNCIL ROLE: Second-level review focusing on program relevance, portfolio balance, special considerations, payline context, and exceptions.

You receive the complete grant application plus the study section and program director reviews. Consider the full application and all prior review feedback.

DECISION OPTIONS: fund, fund_with_conditions, defer, do_not_fund

Return ONLY valid JSON matching this exact structure:
{
  "decision": "fund|fund_with_conditions|defer|do_not_fund",
  "priority": "high|medium|low",
  "rationale": "string (2 paragraphs)",
  "conditions": ["string array, empty if no conditions"],
  "portfolio_fit": "string (1 sentence)",
  "budget_recommendation": "string",
  "final_statement": "string (1 paragraph formal council statement)",
  "missing_components": [
    {
      "component": "string",
      "expected_location": "string",
      "why_it_matters": "string",
      "impact_on_score": "string",
      "severity": "critical|major|minor"
    }
  ],
  "package_completeness_critique": "string (council-voice assessment of submission completeness)"
}`

async function handleAdvisoryCouncil(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative, study_section_results, pd_review_results FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}, ssResults = null, pdResults = null
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}
  try { ssResults = JSON.parse(project.study_section_results || 'null') } catch {}
  try { pdResults = JSON.parse(project.pd_review_results || 'null') } catch {}

  const mech = project.mechanism || 'STTR-I'
  const institute = setup.institute || 'NIH'
  const budgetCaps = { 'STTR-I': '$400K', 'STTR-II': '$2M', 'SBIR-I': '$400K', 'SBIR-II': '$2M', 'R01': '$500K/yr', 'R21': '$275K total' }
  const budgetCap = budgetCaps[mech] || 'Standard NIH limits'

  const fullGrantContext = buildFullGrantContext(
    project, sections, setup,
    { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections }
  )

  const priorReviews = []
  if (ssResults) {
    priorReviews.push(`STUDY SECTION RESULTS:
Impact Score: ${ssResults.summary?.impact_score || 'N/A'}
Percentile: ${ssResults.summary?.percentile || 'N/A'}
Synthesis: ${ssResults.summary?.synthesis || 'Not available'}
Strengths: ${(ssResults.summary?.strengths || []).join('; ')}
Weaknesses: ${(ssResults.summary?.weaknesses || []).join('; ')}`)
  } else {
    priorReviews.push('STUDY SECTION: Not yet reviewed')
  }

  if (pdResults) {
    priorReviews.push(`PROGRAM DIRECTOR REVIEW:
Fundability: ${pdResults.fundability}
Assessment: ${pdResults.overall_assessment || ''}
Concerns: ${(pdResults.concerns || []).join('; ')}
Recommended Actions: ${(pdResults.recommended_actions || []).join('; ')}`)
  } else {
    priorReviews.push('PROGRAM DIRECTOR REVIEW: Not yet completed')
  }

  const userMsg = `Make a funding recommendation for this ${mech} application at ${institute}.
Mechanism budget cap: ${budgetCap}

${fullGrantContext}

${priorReviews.join('\n\n')}

Make an Advisory Council funding recommendation. Return ONLY valid JSON.`

  const resp = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: ADVISORY_COUNCIL_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  }, env)
  if (resp._fallback) return json({ error: 'ai_unavailable' }, 503)
  const r = await resp.json()
  const text = r.content?.[0]?.text || ''

  let result = null
  const jm = text.match(/\{[\s\S]*\}/)
  if (jm) { result = safeParseJSON(jm[0]) }
  if (!result) result = { decision: 'defer', priority: 'medium', rationale: text, conditions: [], portfolio_fit: 'Unable to assess', budget_recommendation: 'Review required', final_statement: 'Council defers pending additional review.', missing_components: [], package_completeness_critique: '' }

  result._inputs = { used_study_section: !!ssResults, study_section_score: ssResults?.summary?.impact_score || null, used_pd_review: !!pdResults, pd_fundability: pdResults?.fundability || null }

  const inputTokens = r.usage?.input_tokens || 0
  const outputTokens = r.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'advisory_council', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  try {
    await env.DB.prepare('UPDATE projects SET advisory_council_results = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(result), projectId, userId).run()
  } catch {}

  return json(result)
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

// ── Commercial Reviewer Panel ─────────────────────────────────────────────────
const COMMERCIAL_REVIEWER_SYSTEM = `You are a senior commercialization expert and venture capitalist who has evaluated over 500 SBIR/STTR applications and funded 40+ life science startups. You have deep expertise in NIH SBIR/STTR commercialization requirements and private market realities.

YOUR ROLE: Provide a frank, expert commercialization review that tells the applicant exactly how compelling (or not) their commercialization plan is — both for NIH reviewers and real investors.

You are reviewing the COMPLETE grant application — every section is provided in full with word counts. You cannot score Investigators without reading about the team, you cannot score Environment without reading about facilities, you cannot score Significance without reading the Aims. Score based on what you actually read.

PACKAGE AUDIT: For any section marked [BRIEF] or [NOT GENERATED], note this in your critique and explain how the missing content affects your ability to score that dimension. Identify what a complete commercialization submission should contain.

SCORING RUBRIC (each dimension 0-20 points):
- Market Assessment: Is the market real, large, and well-defined? Are TAM/SAM/SOM credible?
- IP Strategy: Is there a defensible IP position? Freedom to operate addressed?
- Regulatory Pathway: Is the regulatory strategy realistic? FDA pathway identified?
- Revenue Model: Is the revenue model credible? Pricing, reimbursement, payer landscape?
- Commercial Team: Does the team have the commercial experience to execute?

CRITERION-LEVEL INCOMPLETENESS DETECTION: For each dimension, check if sufficient content is present to score reliably. Set scoreable: false (score: null) if the relevant section is absent, truncated, under 50 words where 200+ is expected, or missing a key required element.

EVIDENCE REQUIREMENT: For each dimension's evidence field, quote or closely paraphrase actual text from the grant — specific TAM figures, named FDA pathways, quoted revenue projections, named team members with credentials.

SCORE RATIONALE: Step-by-step — why this score (0-20) not one point higher or lower.

Return ONLY valid JSON:
{
  "viability": "high|medium|low|not_viable",
  "overall_score": number or null if 3+ dimensions unscorable,
  "market": {"score": number or null, "evidence": "direct quote/paraphrase from grant", "score_rationale": "why this score vs one point better/worse", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "...", "feedback":"string","tam_estimate":"string","key_insight":"string"},
  "ip": {"score": number or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "...", "feedback":"string","ip_strength":"strong|moderate|weak","key_insight":"string"},
  "regulatory": {"score": number or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "...", "feedback":"string","pathway":"string","timeline_estimate":"string"},
  "revenue_model": {"score": number or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "...", "feedback":"string","model_type":"string","key_insight":"string"},
  "commercial_team": {"score": number or null, "evidence": "...", "score_rationale": "...", "confidence": "high|medium|low", "scoreable": true/false, "unscorable_reason": null or "...", "feedback":"string","gaps":["string"]},
  "investor_readiness": "series_a_ready|seed_stage|pre_seed|not_ready",
  "strengths": ["string"],
  "critical_weaknesses": ["string"],
  "top_improvements": ["string"],
  "phase3_readiness": "string",
  "bottom_line": "string",
  "missing_components": [
    {
      "component": "string",
      "expected_location": "string",
      "why_it_matters": "string",
      "impact_on_score": "string",
      "severity": "critical|major|minor"
    }
  ],
  "package_completeness_critique": "string (frank investor/reviewer assessment of what is missing)"
}`

async function handleCommercialReview(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const fullGrantContext = buildFullGrantContext(
    project, sections, setup,
    { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections }
  )

  const userMsg = `Review the commercialization plan and full application for this ${project.mechanism || 'STTR-I'} grant.

${fullGrantContext}

Provide a complete commercialization review. Return ONLY valid JSON.`

  const resp = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: COMMERCIAL_REVIEWER_SYSTEM,
    messages: [{ role: 'user', content: userMsg }],
  }, env)
  if (resp._fallback) return json({ error: 'ai_unavailable' }, 503)
  const r = await resp.json()
  const text = r.content?.[0]?.text || ''

  let result = null
  const jm = text.match(/\{[\s\S]*\}/)
  if (jm) { result = safeParseJSON(jm[0]) }
  if (!result) result = { viability: 'medium', overall_score: 50, market: { score: 10, feedback: text, tam_estimate: 'N/A', key_insight: '' }, ip: { score: 10, feedback: '', ip_strength: 'moderate', key_insight: '' }, regulatory: { score: 10, feedback: '', pathway: '', timeline_estimate: '' }, revenue_model: { score: 10, feedback: '', model_type: '', key_insight: '' }, commercial_team: { score: 10, feedback: '', gaps: [] }, investor_readiness: 'seed_stage', strengths: [], critical_weaknesses: [], top_improvements: [], phase3_readiness: '', bottom_line: 'Review could not be parsed — see raw assessment.', missing_components: [], package_completeness_critique: '' }

  const inputTokens = r.usage?.input_tokens || 0
  const outputTokens = r.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'commercial_review', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  try {
    await env.DB.prepare('UPDATE projects SET commercial_review_results = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(result), projectId, userId).run()
  } catch {}

  return json(result)
}

// ── Commercial Charts Generator ───────────────────────────────────────────────
async function handleGenerateCharts(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT title, mechanism, setup, sections FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const commercialText = sections.commercial || ''
  const prompt = `You are a market analyst. Extract commercialization data from this NIH grant text and return ONLY valid JSON for chart generation.

Grant title: ${project.title || setup.disease || 'Untitled'}
Disease: ${setup.disease || 'Not specified'}
Commercial text: ${commercialText.slice(0, 2000)}
Setup commercial: ${setup.commercial || ''}

Extract or estimate reasonable values for:
1. Market sizing (TAM, SAM, SOM) in USD millions
2. Revenue projection for years 1-5 (in $ millions)
3. Top 4 competitors with positioning on innovation (0-10) vs accessibility (0-10) axes

Return ONLY valid JSON:
{
  "market": {
    "tam": number,
    "sam": number,
    "som": number,
    "tam_label": "string",
    "sam_label": "string",
    "som_label": "string"
  },
  "revenue": [
    { "year": "Year 1", "value": number },
    { "year": "Year 2", "value": number },
    { "year": "Year 3", "value": number },
    { "year": "Year 4", "value": number },
    { "year": "Year 5", "value": number }
  ],
  "competitors": [
    { "name": "string", "innovation": number, "accessibility": number, "is_us": false },
    { "name": "${project.title || 'Our Solution'}", "innovation": number, "accessibility": number, "is_us": true }
  ]
}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 800, messages: [{ role: 'user', content: prompt }] }),
  })
  const r = await resp.json()
  const text = r.content?.[0]?.text || ''

  let chartData = null
  const jm = text.match(/\{[\s\S]*\}/)
  if (jm) { chartData = safeParseJSON(jm[0]) }
  if (!chartData) return err('Could not extract chart data from the commercialization section. Add more specific market data first.')

  const inputTokens = r.usage?.input_tokens || 0
  const outputTokens = r.usage?.output_tokens || 0
  const pricing = PRICING['claude-haiku-4-5-20251001']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'generate_charts', 'claude-haiku-4-5-20251001', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  try {
    await env.DB.prepare('UPDATE projects SET commercial_charts = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(chartData), projectId, userId).run()
  } catch {}

  return json(chartData)
}

// ── Bibliography ──────────────────────────────────────────────────────────────
async function handleBibliographyGet(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT bibliography FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let bibliography = []
  try { bibliography = JSON.parse(project.bibliography || '[]') } catch {}
  return json({ bibliography })
}

async function handleBibliographySave(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const body = await req.json()
  const bibliography = body.bibliography || []
  await env.DB.prepare('UPDATE projects SET bibliography = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(bibliography), projectId, userId).run()
  return json({ ok: true, count: bibliography.length })
}

// ── Letters Generator ─────────────────────────────────────────────────────────
const LETTER_TEMPLATES = {
  collaborator_support: { name: 'Collaborator Support Letter', maxTokens: 700 },
  consultant: { name: 'Consultant Letter', maxTokens: 600 },
  subaward_institution: { name: 'Subaward Institution Letter', maxTokens: 800 },
  sttr_partner: { name: 'STTR Research Institution Partner Letter', maxTokens: 900 },
  irb_approval: { name: 'IRB Approval Letter', maxTokens: 700 },
  iacuc_approval: { name: 'IACUC Approval Letter', maxTokens: 700 },
  key_personnel: { name: 'Key Personnel Commitment Letter', maxTokens: 500 },
  resource_sharing: { name: 'Resource Sharing Agreement', maxTokens: 700 },
  commercial_partner: { name: 'Commercial Partner Letter', maxTokens: 700 },
  cover_letter_sro: { name: 'Cover Letter to SRO', maxTokens: 500 },
  resubmission_intro: { name: 'Resubmission Introduction', maxTokens: 700 },
  budget_justification: { name: 'Budget Justification Narrative', maxTokens: 1500 },
}

function buildLetterPrompt(letter_type, fields, project) {
  const f = fields || {}
  const p = project || {}
  const title = f.project_title || p.title || 'Not specified'
  const pi = f.pi_name || p.pi || 'Not specified'

  const prompts = {
    collaborator_support: `Write a professional letter of support from ${f.collaborator_name || 'Collaborator'} at ${f.collaborator_institution || 'their institution'} supporting the grant application by ${pi} titled "${title}".

The letter should: open with a statement of enthusiastic support, describe the collaborator's expertise (${f.collaborator_title || 'researcher'}) and how it complements the PI's work, detail specific contributions they will make to the project (${f.specific_contributions || 'as described in the application'}), state their role in the project (${f.collaborator_role_in_project || 'collaborator'}), commit to the collaboration for the project period, and close with a strong endorsement of the scientific merit. Professional business letter format. 300-400 words.`,

    consultant: `Write a consulting agreement letter from ${f.consultant_name || 'Consultant'} (${f.consultant_title || ''}, ${f.consultant_institution || ''}) confirming their role as a paid consultant on "${title}" (PI: ${pi}).

Cover: the consultant's relevant expertise (${f.consultant_expertise || 'as described'}), specific consulting role (${f.consulting_role || 'scientific consultant'}), estimated commitment of ${f.estimated_days || 'X'} days per year at ${f.compensation_rate || 'negotiated rate'}, confirmation of availability for the project period. 250-350 words.`,

    subaward_institution: `Write a letter from ${f.subaward_institution || 'Subaward Institution'} confirming their participation as a subaward institution on "${title}" (Prime PI: ${f.prime_pi_name || pi}).

Cover: institutional commitment to the research, ${f.subaward_pi_name || 'subaward PI'}'s qualifications and role (${f.subaward_role || 'subaward PI'}), specific aims they will lead (${f.subaward_aims || 'as described in the application'}), budget commitment of ${f.subaward_budget || 'the agreed amount'}, institutional resources available, confirmation that institutional approvals will be obtained. 350-450 words.`,

    sttr_partner: `Write a formal letter from ${f.research_institution || 'Research Institution'} confirming their role as the research institution partner on this STTR application for "${title}" (PI: ${pi}, Small Business: ${f.small_business_name || 'the applicant company'}).

CRITICAL: This letter must explicitly state that ${f.work_percentage || '40'}% of the research will be performed at ${f.research_institution || 'the research institution'} as required by STTR regulations. Cover: institutional commitment, ${f.institution_pi_name || 'institution PI'}'s qualifications (${f.institution_pi_title || 'PI'}), facilities and resources contributed (${f.facilities_contributed || 'institutional facilities'}), IP agreement status, confirmation of STTR eligibility. Must include language about the IP agreement between the small business and research institution. 400-500 words.`,

    irb_approval: `Write an IRB approval letter for "${f.study_title || title}" at ${f.institution || 'the institution'} (PI: ${f.pi_name || pi}).

Include: IRB protocol number ${f.irb_number || 'PENDING'}, approval date ${f.approval_date || 'pending'} and expiration ${f.expiration_date || 'pending'}, risk determination (${f.risk_level || 'Minimal Risk'}), approved procedures summary (${f.approved_procedures || 'as described in the protocol'}), any conditions or stipulations, continuing review requirements. ${!f.approval_date ? 'Note: If IRB is pending, generate a letter stating that approval is pending and will be obtained before human subjects research begins.' : ''} Official institutional letter format. 300-400 words.`,

    iacuc_approval: `Write an IACUC protocol approval letter for animal research at ${f.institution || 'the institution'} (PI: ${f.pi_name || pi}).

Include: protocol number ${f.iacuc_number || 'PENDING'}, approval date ${f.approval_date || 'pending'} and expiration ${f.expiration_date || 'pending'}, approved species (${f.species || 'mice'}) and number of animals (${f.number_of_animals || 'as specified'}), approved procedures (${f.approved_procedures || 'as described in the protocol'}), any conditions, confirmation of compliance with Animal Welfare Act and PHS Policy. Official format. 300-400 words.`,

    key_personnel: `Write a letter from ${f.personnel_name || 'Key Personnel'} (${f.personnel_title || ''}, ${f.personnel_institution || ''}) confirming their commitment to "${title}" at ${f.percent_effort || 'X'}% effort.

Cover: their qualifications relevant to the project, specific role and responsibilities (${f.role_on_project || 'as described in the application'}), confirmation of availability for the full project period, institutional support for their participation. 200-300 words.`,

    resource_sharing: `Write a resource sharing agreement letter confirming that ${f.providing_institution || 'the providing institution'} will share ${f.resource_description || 'the described resource'} (type: ${f.resource_type || 'biological resource'}) with ${f.receiving_institution || 'the receiving institution'} for use in "${title}" (PI: ${f.pi_name || pi}).

Cover: description of the resource to be shared, sharing terms and conditions (${f.sharing_terms || 'upon request'}), any costs or fees, timeline, publication rights, acknowledgment requirements. 300-400 words.`,

    commercial_partner: `Write a letter of support from ${f.company_name || 'Commercial Partner'} as a commercial partner for "${title}" (PI: ${f.pi_name || pi}).

Cover: the company's interest in the technology and market opportunity, their role in commercialization (${f.company_role || 'commercial partner'}), specific contributions (${f.commercial_contribution || 'resources and expertise'}), licensing or partnership interest (${f.licensing_interest || 'licensing discussions ongoing'}), market validation they bring. Contact: ${f.company_contact || 'company contact'}. 300-400 words.`,

    cover_letter_sro: `Write a professional cover letter to the Scientific Review Officer for the submission of "${title}" by ${f.pi_name || pi} at ${f.institution || 'the institution'}. FOA/Mechanism: ${f.foa_number || 'as specified'} (${f.mechanism || 'NIH grant'}).

Include: formal submission statement, requested study section if specified (${f.study_section_requested || 'defer to SRO assignment'}), any special review considerations (${f.special_considerations || 'none'}), any conflicts of interest to note (${f.conflicts_of_interest || 'none'}), PI contact information. 200-300 words.`,

    resubmission_intro: `Write a 1-page Introduction for a resubmission application (A1) for "${title}" (PI: ${f.pi_name || pi}).

Prior application number: ${f.prior_application_number || 'Not specified'}. Prior review date: ${f.prior_review_date || 'Not specified'}.

Major changes summary: ${f.major_changes_summary || 'To be described.'}

This introduction must: acknowledge the prior review professionally, summarize the major changes made in response to reviewer concerns (be specific), use language that is responsive and not defensive, end with a statement that the application has been substantially strengthened. Exactly 1 page (~450-500 words). This is a formal NIH document section.`,

    budget_justification: `Write a complete Budget Justification Narrative for "${title}" (PI: ${f.pi_name || pi}).

BUDGET DETAILS:
Personnel: ${f.personnel || 'PI and key personnel as described'}
Equipment (>$5,000): ${f.equipment || 'as specified in the budget'}
Supplies: ${f.supplies || 'laboratory supplies, reagents, and materials'}
Travel: ${f.travel || 'professional conferences'}
Other direct costs: ${f.other_costs || 'as specified'}
Indirect (F&A) rate: ${f.indirect_rate || 'negotiated institutional rate'}

For each budget category, justify why the resources are needed and how costs were calculated. Personnel: justify each person's role and percent effort. Equipment: justify need and cost. Supplies: justify by category. Travel: justify conferences and attendees. Other Direct Costs: justify each line item. Indirect Costs: state the negotiated rate and base. Professional narrative format. 600-800 words.`,
  }

  return prompts[letter_type] || `Write a professional NIH-related ${letter_type} letter for the application "${title}" by ${pi}. 300-400 words.`
}

async function handleGenerateLetter(req, env, userId) {
  const body = await req.json()
  const { letter_type, project_id, letter_fields } = body
  if (!letter_type) return err('letter_type required')

  let project = null
  if (project_id) {
    try {
      const row = await env.DB.prepare('SELECT title, mechanism, setup FROM projects WHERE id = ? AND user_id = ?').bind(project_id, userId).first()
      if (row) {
        let setup = {}
        try { setup = JSON.parse(row.setup || '{}') } catch {}
        project = { title: row.title, mechanism: row.mechanism, pi: setup.pi, partner: setup.partner, institute: setup.institute }
      }
    } catch {}
  }

  const template = LETTER_TEMPLATES[letter_type]
  const maxTok = template?.maxTokens || 800
  const prompt = buildLetterPrompt(letter_type, letter_fields, project)

  const LETTER_SYSTEM = `You are an expert NIH grant writer specializing in formal correspondence. Write professional, formal letters that follow standard NIH grant application conventions. Use proper business letter format with date, salutation, body paragraphs, and closing. Make letters specific and substantive — avoid generic filler.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: maxTok, system: LETTER_SYSTEM, messages: [{ role: 'user', content: prompt }] }),
  })
  const result = await resp.json()
  const letter_content = result.content?.[0]?.text || ''
  const word_count = letter_content.trim().split(/\s+/).filter(Boolean).length

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-haiku-4-5-20251001']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'generate_letter', 'claude-haiku-4-5-20251001', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  return json({ letter_content, letter_type, word_count, template_name: template?.name || letter_type })
}

// ── Resubmission Routes ───────────────────────────────────────────────────────
async function handleResubmissionImportComments(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const body = await req.json()
  const { text } = body
  if (!text || text.trim().length < 50) return err('Summary statement text required (minimum 50 characters)')

  try {
    await env.DB.prepare('UPDATE projects SET reviewer_comments = ? WHERE id = ? AND user_id = ?')
      .bind(text.slice(0, 50000), projectId, userId).run()
  } catch {
    await env.DB.prepare('ALTER TABLE projects ADD COLUMN reviewer_comments TEXT').run().catch(() => {})
    await env.DB.prepare('UPDATE projects SET reviewer_comments = ? WHERE id = ? AND user_id = ?')
      .bind(text.slice(0, 50000), projectId, userId).run()
  }
  return json({ ok: true, length: text.length })
}

async function handleResubmissionAnalyze(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT reviewer_comments, title, mechanism FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  if (!project.reviewer_comments) return err('No reviewer comments imported yet')

  const ANALYZE_SYSTEM = `You are an expert NIH grant consultant analyzing a prior summary statement to help a researcher prepare a resubmission. Extract and organize all reviewer concerns. Return ONLY valid JSON.`
  const userMsg = `Analyze this NIH summary statement for a ${project.mechanism || 'NIH'} application titled "${project.title || 'Unknown'}". Extract all reviewer concerns and strengths. Return ONLY valid JSON:
{"overall_impact_score":number,"reviewer_scores":[{"reviewer":"Reviewer 1","significance":number,"investigators":number,"innovation":number,"approach":number,"environment":number}],"major_concerns":[{"concern":"string","reviewer":"string","severity":"critical|major|minor","suggested_response":"string"}],"minor_concerns":[{"concern":"string","reviewer":"string"}],"strengths_to_preserve":["string"],"recommended_changes":[{"section":"string","change":"string","priority":"high|medium|low"}],"introduction_outline":"string"}

SUMMARY STATEMENT:
${project.reviewer_comments.slice(0, 8000)}`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, system: ANALYZE_SYSTEM, messages: [{ role: 'user', content: userMsg }] }),
  })
  const result = await resp.json()
  const text = result.content?.[0]?.text || ''
  let analysis = null
  const jm = text.match(/\{[\s\S]*\}/)
  if (jm) { analysis = safeParseJSON(jm[0]) }
  if (!analysis) analysis = { overall_impact_score: null, major_concerns: [], minor_concerns: [], strengths_to_preserve: [], recommended_changes: [], introduction_outline: text }

  try {
    await env.DB.prepare('UPDATE projects SET resubmission_analysis = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(analysis), projectId, userId).run()
  } catch {}

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'resubmission_analyze', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  return json(analysis)
}

async function handleResubmissionGenerateIntro(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT reviewer_comments, resubmission_analysis, title, mechanism, setup FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  if (!project.reviewer_comments) return err('Import reviewer comments first')

  let analysis = null, setup = {}
  try { analysis = JSON.parse(project.resubmission_analysis || 'null') } catch {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}

  const majorConcerns = analysis?.major_concerns?.map(c => `- ${c.concern} (${c.reviewer}, ${c.severity}): ${c.suggested_response}`).join('\n') || 'See reviewer comments'
  const recommendedChanges = analysis?.recommended_changes?.map(c => `- ${c.section}: ${c.change} [${c.priority}]`).join('\n') || ''

  const prompt = `Write a 1-page Introduction for an NIH grant resubmission application (A1) for "${project.title || 'this application'}" (${project.mechanism || 'NIH'}) by ${setup.pi || 'the PI'}.

REVIEWER CONCERNS TO ADDRESS:
${majorConcerns}

RECOMMENDED CHANGES:
${recommendedChanges}

REQUIREMENTS:
1. Open with a professional acknowledgment of the prior review and brief thanks
2. Summarize the 3-4 major changes made in response to reviewer concerns — be specific
3. Mark changed text with asterisks: *revised content*
4. Tone: responsive and appreciative, never defensive
5. Close with a forward-looking statement affirming how changes strengthen the application

HARD LIMIT: 450-500 words maximum. This is a strict NIH page limit.
Return only the Introduction text.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 700, system: 'You are an expert NIH grant writer specializing in resubmission applications.', messages: [{ role: 'user', content: prompt }] }),
  })
  const result = await resp.json()
  const intro_text = result.content?.[0]?.text || ''

  try {
    await env.DB.prepare('UPDATE projects SET introduction = ? WHERE id = ? AND user_id = ?')
      .bind(intro_text, projectId, userId).run()
  } catch {}

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'resubmission_intro', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  return json({ intro_text, word_count: intro_text.trim().split(/\s+/).filter(Boolean).length })
}

async function handleResubmissionReviseSection(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT id, resubmission_analysis FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  const body = await req.json()
  const { section_id, section_text, section_label } = body
  if (!section_text) return err('section_text required')

  let analysis = null
  try { analysis = JSON.parse(project.resubmission_analysis || 'null') } catch {}
  const sectionConcerns = (analysis?.recommended_changes || [])
    .filter(c => c.section?.toLowerCase().includes(section_id?.toLowerCase() || '') || section_id?.includes(c.section?.toLowerCase() || ''))
    .map(c => `- ${c.change} [${c.priority}]`).join('\n') || 'General reviewer concerns — see imported summary statement'

  const prompt = `Revise this NIH grant section (${section_label || section_id}) to address the following reviewer concerns from a prior submission. Maintain scientific content and structure but strengthen weak areas identified by reviewers.

REVIEWER CONCERNS FOR THIS SECTION:
${sectionConcerns}

CURRENT SECTION:
${section_text}

Return only the revised text. Make improvements visible and specific. Maintain word count within ±15%.`

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: prompt }] }),
  })
  const result = await resp.json()
  const revised = result.content?.[0]?.text || ''

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const pricing = PRICING['claude-sonnet-4-20250514']
  const cost = (inputTokens / 1e6) * pricing.input + (outputTokens / 1e6) * pricing.output
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'resubmission_revise', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)

  return json({ revised, section_id })
}

// ── Collaboration Access Control ─────────────────────────────────────────────
async function checkProjectAccess(projectId, userId, userEmail, env) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(projectId).first()
  if (!project) return null
  if (project.user_id === userId) return { role: 'owner', project }
  let collab = await env.DB.prepare(
    "SELECT * FROM project_collaborators WHERE project_id = ? AND user_id = ? AND status = 'accepted'"
  ).bind(projectId, userId).first()
  if (!collab && userEmail) {
    collab = await env.DB.prepare(
      "SELECT * FROM project_collaborators WHERE project_id = ? AND email = ? AND status = 'accepted'"
    ).bind(projectId, userEmail.toLowerCase()).first()
  }
  if (!collab) return null
  return { role: collab.role, project, collab }
}

// ── Collaboration Handlers ────────────────────────────────────────────────────
async function handleInviteCollaborator(req, env, userId, userEmail, projectId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Not found or not owner', 403)
  const body = await req.json()
  const { email, role = 'reviewer' } = body
  if (!email) return err('Email required', 400)
  if (!['co_writer', 'reviewer', 'admin'].includes(role)) return err('Invalid role', 400)
  const existing = await env.DB.prepare('SELECT id FROM project_collaborators WHERE project_id = ? AND email = ?').bind(projectId, email.toLowerCase()).first()
  if (existing) return err('Already invited', 409)
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    'INSERT INTO project_collaborators (project_id, invited_by, email, role, status, invited_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(projectId, userId, email.toLowerCase(), role, 'pending', now).run()
  const sharedWith = project.shared_with ? (() => { try { return JSON.parse(project.shared_with) } catch { return [] } })() : []
  if (!sharedWith.includes(email.toLowerCase())) {
    sharedWith.push(email.toLowerCase())
    await env.DB.prepare('UPDATE projects SET shared_with = ? WHERE id = ?').bind(JSON.stringify(sharedWith), projectId).run()
  }
  return json({ id: result.lastRowId, project_id: projectId, email: email.toLowerCase(), role, status: 'pending', invited_at: now }, 201)
}

async function handleGetCollaborators(req, env, userId, userEmail, projectId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const { results } = await env.DB.prepare('SELECT * FROM project_collaborators WHERE project_id = ? ORDER BY invited_at ASC').bind(projectId).all()
  return json({ owner_id: access.project.user_id, collaborators: results || [] })
}

async function handleDeleteCollaborator(req, env, userId, projectId, collaboratorId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Not found or not owner', 403)
  const collab = await env.DB.prepare('SELECT * FROM project_collaborators WHERE id = ? AND project_id = ?').bind(parseInt(collaboratorId), projectId).first()
  if (!collab) return err('Collaborator not found', 404)
  await env.DB.prepare('DELETE FROM project_collaborators WHERE id = ?').bind(parseInt(collaboratorId)).run()
  const sharedWith = project.shared_with ? (() => { try { return JSON.parse(project.shared_with) } catch { return [] } })() : []
  await env.DB.prepare('UPDATE projects SET shared_with = ? WHERE id = ?').bind(JSON.stringify(sharedWith.filter(e => e !== collab.email)), projectId).run()
  return json({ ok: true })
}

async function handlePatchCollaborator(req, env, userId, projectId, collaboratorId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Not found or not owner', 403)
  const body = await req.json()
  if (!['co_writer', 'reviewer', 'admin'].includes(body.role)) return err('Invalid role', 400)
  const res = await env.DB.prepare('UPDATE project_collaborators SET role = ? WHERE id = ? AND project_id = ?').bind(body.role, parseInt(collaboratorId), projectId).run()
  if (res.changes === 0) return err('Not found', 404)
  return json({ ok: true })
}

async function handleAcceptInvitation(req, env, userId, userEmail, projectId) {
  const collab = await env.DB.prepare(
    "SELECT * FROM project_collaborators WHERE project_id = ? AND email = ? AND status = 'pending'"
  ).bind(projectId, userEmail.toLowerCase()).first()
  if (!collab) return err('No pending invitation found for this email', 404)
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare("UPDATE project_collaborators SET status = 'accepted', accepted_at = ?, user_id = ? WHERE id = ?").bind(now, userId, collab.id).run()
  return json({ ok: true, project_id: projectId, role: collab.role })
}

async function handleGetSharedProjects(req, env, userId, userEmail) {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.title, p.mechanism, p.updated_at, p.user_id as owner_id, pc.role, pc.email as collab_email, pc.status
     FROM project_collaborators pc JOIN projects p ON p.id = pc.project_id
     WHERE (pc.user_id = ? OR pc.email = ?) AND pc.status = 'accepted' ORDER BY p.updated_at DESC`
  ).bind(userId, userEmail.toLowerCase()).all()
  return json(results || [])
}

async function handleGetPendingInvitations(req, env, userId, userEmail) {
  const { results } = await env.DB.prepare(
    `SELECT pc.id, pc.project_id, pc.role, pc.invited_at, p.title, p.mechanism
     FROM project_collaborators pc JOIN projects p ON p.id = pc.project_id
     WHERE pc.email = ? AND pc.status = 'pending' ORDER BY pc.invited_at DESC`
  ).bind(userEmail.toLowerCase()).all()
  return json(results || [])
}

// Comments
async function handlePostComment(req, env, userId, userEmail, projectId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const body = await req.json()
  if (!body.comment_text?.trim()) return err('Comment text required', 400)
  const now = Math.floor(Date.now() / 1000)
  const result = await env.DB.prepare(
    'INSERT INTO project_comments (project_id, user_id, user_email, section_name, comment_text, resolved, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
  ).bind(projectId, userId, userEmail, body.section_name || null, body.comment_text.trim(), now).run()
  return json({ id: result.lastRowId, project_id: projectId, user_id: userId, user_email: userEmail, section_name: body.section_name || null, comment_text: body.comment_text.trim(), resolved: 0, created_at: now }, 201)
}

async function handleGetComments(req, env, userId, userEmail, projectId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const { results } = await env.DB.prepare('SELECT * FROM project_comments WHERE project_id = ? ORDER BY created_at ASC').bind(projectId).all()
  const grouped = {}
  ;(results || []).forEach(c => {
    const key = c.section_name || '__general__'
    if (!grouped[key]) grouped[key] = []
    grouped[key].push(c)
  })
  return json(grouped)
}

async function handlePatchComment(req, env, userId, userEmail, projectId, commentId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const comment = await env.DB.prepare('SELECT * FROM project_comments WHERE id = ? AND project_id = ?').bind(parseInt(commentId), projectId).first()
  if (!comment) return err('Comment not found', 404)
  if (access.role !== 'owner' && comment.user_id !== userId) return err('Not authorized', 403)
  const body = await req.json()
  await env.DB.prepare('UPDATE project_comments SET resolved = ? WHERE id = ?').bind(body.resolved ? 1 : 0, parseInt(commentId)).run()
  return json({ ok: true })
}

async function handleDeleteComment(req, env, userId, userEmail, projectId, commentId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const comment = await env.DB.prepare('SELECT * FROM project_comments WHERE id = ? AND project_id = ?').bind(parseInt(commentId), projectId).first()
  if (!comment) return err('Comment not found', 404)
  if (access.role !== 'owner' && comment.user_id !== userId) return err('Not authorized', 403)
  await env.DB.prepare('DELETE FROM project_comments WHERE id = ?').bind(parseInt(commentId)).run()
  return json({ ok: true })
}

// Section assignment
async function handleAssignSection(req, env, userId, projectId, sectionName) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Not found or not owner', 403)
  const body = await req.json()
  const assignments = project.section_assignments ? (() => { try { return JSON.parse(project.section_assignments) } catch { return {} } })() : {}
  if (body.assignee_email) { assignments[sectionName] = body.assignee_email } else { delete assignments[sectionName] }
  await env.DB.prepare('UPDATE projects SET section_assignments = ? WHERE id = ?').bind(JSON.stringify(assignments), projectId).run()
  return json({ ok: true, section_assignments: assignments })
}

// Version history
async function handleCreateSnapshot(req, env, userId, userEmail, projectId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const body = await req.json()
  const project = access.project
  const latest = await env.DB.prepare('SELECT MAX(version_number) as max_ver FROM project_versions WHERE project_id = ?').bind(projectId).first()
  const nextVer = (latest?.max_ver || 0) + 1
  const now = Math.floor(Date.now() / 1000)
  await env.DB.prepare(
    'INSERT INTO project_versions (project_id, user_id, version_number, sections_snapshot, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(projectId, userId, nextVer, project.sections || '{}', body.change_summary || 'Manual snapshot', now).run()
  await env.DB.prepare('UPDATE projects SET current_version = ? WHERE id = ?').bind(nextVer, projectId).run()
  return json({ ok: true, version_number: nextVer, created_at: now })
}

async function handleGetVersions(req, env, userId, userEmail, projectId) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const { results } = await env.DB.prepare(
    'SELECT id, project_id, user_id, version_number, change_summary, created_at FROM project_versions WHERE project_id = ? ORDER BY version_number DESC'
  ).bind(projectId).all()
  return json(results || [])
}

async function handleGetVersion(req, env, userId, userEmail, projectId, versionNumber) {
  const access = await checkProjectAccess(projectId, userId, userEmail, env)
  if (!access) return err('Access denied', 403)
  const version = await env.DB.prepare('SELECT * FROM project_versions WHERE project_id = ? AND version_number = ?').bind(projectId, parseInt(versionNumber)).first()
  if (!version) return err('Version not found', 404)
  return json({ ...version, sections_snapshot: version.sections_snapshot ? (() => { try { return JSON.parse(version.sections_snapshot) } catch { return {} } })() : {} })
}

async function handleRestoreVersion(req, env, userId, projectId, versionNumber) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Not found or not owner', 403)
  const body = await req.json()
  if (body.confirm !== 'RESTORE') return err('Must confirm with { confirm: "RESTORE" }', 400)
  const version = await env.DB.prepare('SELECT * FROM project_versions WHERE project_id = ? AND version_number = ?').bind(projectId, parseInt(versionNumber)).first()
  if (!version) return err('Version not found', 404)
  const now = Math.floor(Date.now() / 1000)
  const latest = await env.DB.prepare('SELECT MAX(version_number) as max_ver FROM project_versions WHERE project_id = ?').bind(projectId).first()
  const nextVer = (latest?.max_ver || 0) + 1
  await env.DB.prepare(
    'INSERT INTO project_versions (project_id, user_id, version_number, sections_snapshot, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(projectId, userId, nextVer, project.sections || '{}', `Pre-restore snapshot (was at v${versionNumber})`, now).run()
  await env.DB.prepare('UPDATE projects SET sections = ?, current_version = ?, updated_at = ? WHERE id = ?').bind(version.sections_snapshot, nextVer + 1, now, projectId).run()
  const restored = version.sections_snapshot ? (() => { try { return JSON.parse(version.sections_snapshot) } catch { return {} } })() : {}
  return json({ ok: true, sections: restored, version_saved: nextVer, restored_from: parseInt(versionNumber) })
}

// ── Aims Optimizer ────────────────────────────────────────────────────────────
async function handleOptimizeAims(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  const sections = JSON.parse(project.sections || '{}')
  const aimsText = sections.aims || ''
  if (!aimsText || aimsText.trim().length < 50) return err('Specific Aims section is empty or too short', 400)

  const SONNET = 'claude-sonnet-4-20250514'
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: SONNET,
      max_tokens: 1500,
      system: `You are an expert NIH grant reviewer who has reviewed over 1,000 Specific Aims pages. Score this Aims page on 5 critical elements. For each element, you must quote or closely paraphrase actual text from the aims page as evidence for your score.

Return ONLY valid JSON:
{
  "overall_score": number (0-100),
  "elements": {
    "hook_sentence": {
      "score": number (0-20),
      "evidence": "direct quote or close paraphrase of the actual hook sentence from this aims page",
      "score_rationale": "why this score (0-20) not one point higher or lower — what would improve it",
      "scoreable": true/false,
      "unscorable_reason": null or "reason if hook is absent or cut off",
      "feedback": string,
      "example_improvement": string
    },
    "problem_statement": {
      "score": number (0-20),
      "evidence": "direct quote/paraphrase of the problem statement from this aims page",
      "score_rationale": "step-by-step reasoning for this score",
      "scoreable": true/false,
      "unscorable_reason": null or "...",
      "feedback": string,
      "example_improvement": string
    },
    "aims_structure": {
      "score": number (0-20),
      "evidence": "quote/paraphrase of how aims are structured — first aim statement, numbering, etc.",
      "score_rationale": "step-by-step reasoning",
      "scoreable": true/false,
      "unscorable_reason": null or "...",
      "feedback": string,
      "example_improvement": string
    },
    "innovation_claim": {
      "score": number (0-20),
      "evidence": "quote/paraphrase of the innovation/novelty claim from this aims page",
      "score_rationale": "step-by-step reasoning",
      "scoreable": true/false,
      "unscorable_reason": null or "...",
      "feedback": string,
      "example_improvement": string
    },
    "impact_statement": {
      "score": number (0-20),
      "evidence": "quote/paraphrase of the impact/significance statement from this aims page",
      "score_rationale": "step-by-step reasoning",
      "scoreable": true/false,
      "unscorable_reason": null or "...",
      "feedback": string,
      "example_improvement": string
    }
  },
  "strongest_element": string,
  "weakest_element": string,
  "top_three_improvements": string[],
  "reviewer_first_impression": string,
  "fundability_prediction": string
}`,
      messages: [{ role: 'user', content: `Score this Specific Aims page:\n\n${aimsText}${sections.sig ? `\n\nSIGNIFICANCE SECTION (for context):\n${sections.sig}` : ''}` }],
    }),
  })
  if (!response.ok) return err('AI service error', 502)
  const result = await response.json()
  const text = result.content?.[0]?.text || '{}'
  let optimization = {}
  try {
    const m = text.match(/\{[\s\S]*\}/)
    if (m) optimization = safeParseJSON(m[0]) || {}
  } catch {}

  try {
    await env.DB.prepare('UPDATE projects SET aims_optimization = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(optimization), Math.floor(Date.now() / 1000), projectId, userId).run()
  } catch (e) { console.error('Save aims_optimization failed:', e) }

  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  try {
    await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(crypto.randomUUID(), userId, 'aims_optimize', SONNET, inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  } catch {}
  return json(optimization)
}

async function handleOptimizeAimsAlternatives(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  const sections = JSON.parse(project.sections || '{}')
  const setup = JSON.parse(project.setup || '{}')
  const aimsText = sections.aims || ''
  if (!aimsText || aimsText.trim().length < 50) return err('Specific Aims section is empty', 400)

  const SONNET = 'claude-sonnet-4-20250514'
  const context = `Title: ${project.title || 'Untitled'}\nMechanism: ${project.mechanism || 'STTR-I'}\nDisease/Condition: ${setup.disease || ''}\nBiology: ${setup.biology || ''}\nPI: ${setup.pi || ''}\n\nORIGINAL SPECIFIC AIMS:\n${aimsText}`

  const structures = [
    { name: 'Problem-Focused', instruction: 'Generate Specific Aims with PROBLEM-FOCUSED structure. Open with devastating impact of disease. Build to critical barrier. Introduce solution. State aims as solutions to specific aspects of barrier.' },
    { name: 'Discovery-Focused', instruction: 'Generate Specific Aims with DISCOVERY-FOCUSED structure. Open with surprising scientific insight or gap in knowledge. Build case for why gap matters. State aims as experiments that fill this gap and transform the field.' },
    { name: 'Translational', instruction: 'Generate Specific Aims with TRANSLATIONAL structure. Open with patient impact and unmet clinical need. Connect to underlying biology. State aims progressing from basic validation through translational application.' },
  ]

  const callAlt = async (instruction) => {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: SONNET, max_tokens: 1200,
        system: `You are a world-class NIH grant writer. ${instruction} Write a complete Specific Aims page (~275 words, ~1 page). Return only the aims text, no preamble or explanation.`,
        messages: [{ role: 'user', content: context }],
      }),
    })
    const data = await r.json()
    return { text: data.content?.[0]?.text || '', tokens: data.usage || {} }
  }

  const [alt1, alt2, alt3] = await Promise.all(structures.map(s => callAlt(s.instruction)))
  const alternatives = [
    { name: structures[0].name, text: alt1.text },
    { name: structures[1].name, text: alt2.text },
    { name: structures[2].name, text: alt3.text },
  ]

  try {
    await env.DB.prepare('UPDATE projects SET aims_alternatives = ?, updated_at = ? WHERE id = ? AND user_id = ?')
      .bind(JSON.stringify(alternatives), Math.floor(Date.now() / 1000), projectId, userId).run()
  } catch (e) { console.error('Save aims_alternatives failed:', e) }

  const totalInput = (alt1.tokens.input_tokens || 0) + (alt2.tokens.input_tokens || 0) + (alt3.tokens.input_tokens || 0)
  const totalOutput = (alt1.tokens.output_tokens || 0) + (alt2.tokens.output_tokens || 0) + (alt3.tokens.output_tokens || 0)
  try {
    await env.DB.prepare('INSERT INTO usage_log (user_id, feature, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(userId, 'aims_alternatives', SONNET, totalInput, totalOutput, Math.floor(Date.now() / 1000)).run()
  } catch {}
  return json(alternatives)
}

// ── Pipeline Status ────────────────────────────────────────────────────────────
async function handlePatchProjectStatus(req, env, userId, projectId) {
  const body = await req.json()
  const now = Math.floor(Date.now() / 1000)
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  try {
    await env.DB.prepare(
      `UPDATE projects SET status = ?, submission_date = ?, award_date = ?, award_amount = ?, award_number = ?, next_deadline = ?, priority = ?, notes = ?, updated_at = ? WHERE id = ? AND user_id = ?`
    ).bind(
      body.status || 'draft',
      body.submission_date || null,
      body.award_date || null,
      body.award_amount != null ? body.award_amount : null,
      body.award_number || null,
      body.next_deadline || null,
      body.priority || 'medium',
      body.notes || null,
      now, projectId, userId
    ).run()
  } catch (e) { return err('Update failed: ' + e.message, 500) }
  return json({ ok: true, updated_at: now })
}

// ── Anthropic Status Monitor ───────────────────────────────────────────────
async function getAnthropicStatus(env) {
  try {
    const cached = await env.KV.get('anthropic_status', 'json')
    if (cached && cached._cached_at && (Date.now() - cached._cached_at) < 5 * 60 * 1000) return cached
    const resp = await fetch('https://status.anthropic.com/api/v2/status.json', { headers: { Accept: 'application/json' } })
    if (!resp.ok) throw new Error('Status API failed')
    const data = await resp.json()
    const result = { indicator: data.status?.indicator || 'unknown', description: data.status?.description || '', _cached_at: Date.now() }
    await env.KV.put('anthropic_status', JSON.stringify(result), { expirationTtl: 300 })
    return result
  } catch {
    return { indicator: 'unknown', description: 'Status unavailable', _cached_at: Date.now() }
  }
}

async function handleAnthropicStatus(req, env) {
  const status = await getAnthropicStatus(env)
  return json(status)
}

async function handleAppStatus(req, env) {
  const components = {}
  // Check D1
  try { await env.DB.prepare('SELECT 1').first(); components.database = 'operational' } catch { components.database = 'outage' }
  // Check KV
  try { await env.KV.get('_health_check'); components.storage = 'operational' } catch { components.storage = 'outage' }
  // Check Anthropic
  const anthropicStatus = await getAnthropicStatus(env)
  components.ai_engine = anthropicStatus.indicator === 'none' ? 'operational' : anthropicStatus.indicator === 'unknown' ? 'degraded' : anthropicStatus.indicator
  components.api = 'operational'
  components.frontend = 'operational'
  const overall = Object.values(components).some(s => s === 'outage') ? 'outage'
    : Object.values(components).some(s => s !== 'operational') ? 'degraded' : 'operational'
  return json({ overall, components, updated_at: new Date().toISOString() })
}

// ── Maintenance Mode ──────────────────────────────────────────────────────
async function handleMaintenanceGet(req, env) {
  const mode = await env.KV.get('maintenance_mode', 'json')
  return json(mode || { enabled: false, eta: null })
}

async function handleMaintenanceSet(req, env) {
  const body = await req.json()
  const data = { enabled: !!body.enabled, eta: body.eta || null, message: body.message || 'FrankGrant is performing scheduled maintenance. Your work is saved.' }
  if (data.enabled) {
    await env.KV.put('maintenance_mode', JSON.stringify(data))
  } else {
    await env.KV.delete('maintenance_mode')
  }
  return json({ ok: true, ...data })
}

// ── R2 Backups ────────────────────────────────────────────────────────────
async function runDailyBackup(env) {
  if (!env.BACKUPS) return { ok: false, error: 'R2 not configured' }
  try {
    const tables = ['users', 'users_meta', 'projects', 'usage_log', 'error_log', 'rate_limit_log', 'project_collaborators', 'project_comments', 'project_versions']
    const backup = { _backup_at: new Date().toISOString(), _version: env.WORKER_VERSION || '5.0.0' }
    for (const table of tables) {
      try {
        const result = await env.DB.prepare(`SELECT * FROM ${table} LIMIT 10000`).all()
        backup[table] = result.results || []
      } catch { backup[table] = [] }
    }
    const now = new Date()
    const filename = `frankgrant-backup-${now.getUTCFullYear()}-${String(now.getUTCMonth()+1).padStart(2,'0')}-${String(now.getUTCDate()).padStart(2,'0')}-${String(now.getUTCHours()).padStart(2,'0')}.json`
    const body = JSON.stringify(backup)
    await env.BACKUPS.put(filename, body, { httpMetadata: { contentType: 'application/json' } })
    // Delete backups older than 30 days
    const list = await env.BACKUPS.list()
    const cutoff = Date.now() - 30 * 24 * 3600 * 1000
    for (const obj of (list.objects || [])) {
      if (obj.uploaded && new Date(obj.uploaded).getTime() < cutoff) {
        try { await env.BACKUPS.delete(obj.key) } catch {}
      }
    }
    return { ok: true, filename, size_bytes: body.length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

async function handleAdminBackup(req, env) {
  const result = await runDailyBackup(env)
  return json(result, result.ok ? 200 : 500)
}

async function handleAdminBackups(req, env) {
  if (!env.BACKUPS) return json({ backups: [] })
  try {
    const list = await env.BACKUPS.list()
    const backups = (list.objects || []).sort((a, b) => b.key.localeCompare(a.key)).map(o => ({
      filename: o.key,
      size_bytes: o.size,
      uploaded: o.uploaded,
    }))
    return json({ backups })
  } catch (e) { return err('Failed to list backups: ' + e.message, 500) }
}

async function handleAdminBackupFile(req, env, filename) {
  if (!env.BACKUPS) return err('R2 not configured', 500)
  try {
    const obj = await env.BACKUPS.get(filename)
    if (!obj) return err('Backup not found', 404)
    const body = await obj.text()
    return new Response(body, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${filename}"` } })
  } catch (e) { return err('Failed to retrieve backup: ' + e.message, 500) }
}

async function handleAdminRestore(req, env) {
  if (!env.BACKUPS) return err('R2 not configured', 500)
  const body = await req.json()
  if (body.confirm !== 'RESTORE') return err('Must confirm with { confirm: "RESTORE" }', 400)
  if (!body.filename) return err('filename required', 400)
  try {
    const obj = await env.BACKUPS.get(body.filename)
    if (!obj) return err('Backup file not found', 404)
    const data = await obj.json()
    const tables = ['users', 'users_meta', 'projects', 'usage_log', 'error_log', 'rate_limit_log', 'project_collaborators', 'project_comments', 'project_versions']
    let tablesRestored = 0, rowsRestored = 0
    for (const table of tables) {
      if (!data[table] || !Array.isArray(data[table])) continue
      try {
        await env.DB.prepare(`DELETE FROM ${table}`).run()
        for (const row of data[table]) {
          const cols = Object.keys(row)
          const placeholders = cols.map(() => '?').join(', ')
          const vals = cols.map(c => row[c])
          await env.DB.prepare(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`).bind(...vals).run()
          rowsRestored++
        }
        tablesRestored++
      } catch {}
    }
    return json({ ok: true, tables_restored: tablesRestored, rows_restored: rowsRestored })
  } catch (e) { return err('Restore failed: ' + e.message, 500) }
}

// ── Voice Dictate ──────────────────────────────────────────────────────────
async function handleVoiceDictate(req, env, userId) {
  const body = await req.json()
  const { project_id, section_id, transcript } = body
  if (!transcript?.trim()) return err('transcript required')

  const project = await env.DB.prepare('SELECT mechanism, setup, sections FROM projects WHERE id = ? AND user_id = ?').bind(project_id, userId).first()
  let setup = {}, sections = {}
  if (project) {
    try { setup = JSON.parse(project.setup || '{}') } catch {}
    try { sections = JSON.parse(project.sections || '{}') } catch {}
  }

  const sectionLabels = { aims: 'Specific Aims', sig: 'Significance', innov: 'Innovation', approach: 'Approach', summary: 'Project Summary', narrative: 'Project Narrative', data_mgmt: 'Data Management Plan', facilities: 'Facilities', commercial: 'Commercialization' }
  const label = sectionLabels[section_id] || section_id

  const result = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
    system: `You are an expert NIH grant writer. The PI has verbally described their research. Write a polished ${label} section in NIH grant style based on their dictation. Preserve all specific scientific details, methods, numbers, and findings. Use active voice, confident tone, no hedge words. Return only the section text, no commentary.`,
    messages: [{
      role: 'user',
      content: `Mechanism: ${project?.mechanism || 'SBIR'}\nPI: ${setup.pi || 'the PI'}\nDisease/Topic: ${setup.disease || 'the research area'}\n\nPI Dictation:\n${transcript}\n\nExisting section content (if any, incorporate improvements):\n${sections[section_id] || 'None generated yet'}\n\nWrite the complete ${label} section:`,
    }],
  }, env)

  if (result._fallback) return json({ error: 'ai_unavailable', message: 'AI generation unavailable', retry_after: 60 }, 503)
  const content = result.content?.[0]?.text || ''
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  const cost = (inputTokens / 1e6) * 3.00 + (outputTokens / 1e6) * 15.00
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'voice_dictate', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  await trackUserActivity(userId, '', env, true, inputTokens + outputTokens, cost)
  return json({ content, section_id })
}

// ── Voice Edit ─────────────────────────────────────────────────────────────
async function handleVoiceEdit(req, env, userId) {
  const body = await req.json()
  const { section_id, instruction, content } = body
  if (!instruction?.trim() || !content?.trim()) return err('instruction and content required')

  const result = await callAnthropicWithFallback({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2500,
    system: 'You are an expert NIH grant editor. Apply the specific edit instruction exactly as described and return the complete edited section. No commentary, no explanation — just the edited text.',
    messages: [{
      role: 'user',
      content: `Edit instruction: ${instruction}\n\nCurrent section content:\n${content}\n\nReturn the complete edited section:`,
    }],
  }, env)

  if (result._fallback) return json({ error: 'ai_unavailable', message: 'AI generation unavailable', retry_after: 60 }, 503)
  const edited = result.content?.[0]?.text || ''
  const inputTokens = result.usage?.input_tokens || 0
  const outputTokens = result.usage?.output_tokens || 0
  await env.DB.prepare('INSERT INTO usage_log (id, user_id, action, model, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), userId, 'voice_edit', 'claude-sonnet-4-20250514', inputTokens, outputTokens, 0, 0, Math.floor(Date.now() / 1000)).run()
  return json({ edited, section_id })
}

// ── Submission Package helpers ────────────────────────────────────────────────

async function checkSubmissionPackage(projectId, userId, env) {
  const pkg = await env.DB.prepare(
    'SELECT * FROM submission_packages WHERE project_id = ? AND user_id = ? AND status = ? AND cycles_remaining > 0 ORDER BY purchased_at DESC LIMIT 1'
  ).bind(projectId, userId, 'active').first()
  if (pkg) {
    return { has_package: true, cycles_remaining: pkg.cycles_remaining, cycles_used: pkg.cycles_used, package_id: pkg.id }
  }
  // Check for package credits (admin-granted)
  const meta = await env.DB.prepare('SELECT package_credits FROM users_meta WHERE id = ?').bind(userId).first()
  return { has_package: false, cycles_remaining: 0, cycles_used: 0, package_credits: meta?.package_credits || 0 }
}

async function handleActivateSubmissionPackage(req, env, userId, projectId) {
  const body = await req.json()
  const now = Math.floor(Date.now() / 1000)

  // Check if project belongs to user
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  // If admin override, activate immediately
  if (body.admin_override) {
    const payload = await requireAuth(req, env)
    const email = payload?.email || payload?.['email_address'] || ''
    if (!ADMIN_EMAILS.includes(email)) return err('Admin access required', 403)
  } else {
    // Check for package credit
    const meta = await env.DB.prepare('SELECT package_credits FROM users_meta WHERE id = ?').bind(userId).first()
    if (!meta || meta.package_credits < 1) {
      return json({ error: 'submission_package_required', message: 'No package credits available' }, 402)
    }
    await env.DB.prepare('UPDATE users_meta SET package_credits = package_credits - 1, total_submission_packages = total_submission_packages + 1 WHERE id = ?').bind(userId).run()
  }

  // Create package
  await env.DB.prepare(
    'INSERT INTO submission_packages (user_id, project_id, purchased_at, cycles_total, cycles_used, cycles_remaining, status) VALUES (?, ?, ?, 5, 0, 5, ?)'
  ).bind(userId, projectId, now, 'active').run()

  await env.DB.prepare('UPDATE projects SET rewrite_cycles_remaining = 5, rewrite_cycles_used = 0 WHERE id = ? AND user_id = ?').bind(projectId, userId).run()

  return json({ ok: true, cycles_remaining: 5 })
}

// ── Post-Review Rewrite ───────────────────────────────────────────────────────

async function handleRewrite(req, env, userId, projectId, ctx) {
  const body = await req.json()
  const { source, source_results } = body
  const now = Math.floor(Date.now() / 1000)

  // Check project ownership
  const project = await env.DB.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  // Check submission package — auto-activate from credits if available
  let pkg = await checkSubmissionPackage(projectId, userId, env)
  if (!pkg.has_package && pkg.package_credits > 0) {
    // Auto-activate from credit
    await env.DB.prepare('UPDATE users_meta SET package_credits = package_credits - 1, total_submission_packages = total_submission_packages + 1 WHERE id = ?').bind(userId).run()
    await env.DB.prepare('INSERT INTO submission_packages (user_id, project_id, purchased_at, cycles_total, cycles_used, cycles_remaining, status) VALUES (?, ?, ?, 5, 0, 5, ?)').bind(userId, projectId, now, 'active').run()
    await env.DB.prepare('UPDATE projects SET rewrite_cycles_remaining = 5, rewrite_cycles_used = 0 WHERE id = ? AND user_id = ?').bind(projectId, userId).run()
    pkg = await checkSubmissionPackage(projectId, userId, env)
  }

  if (!pkg.has_package) {
    return json({ error: 'submission_package_required', message: 'Post-review rewriting requires a Submission Package ($199 per grant). Includes 5 rewrite cycles, reference verification, and compliance certification.' }, 402)
  }
  if (pkg.cycles_remaining <= 0) {
    return json({ error: 'no_cycles_remaining', message: 'You have used all 5 rewrite cycles for this grant.' }, 402)
  }

  const sections = JSON.parse(project.sections || '{}')
  const cycleNum = (project.rewrite_cycles_used || 0) + 1

  // Auto-snapshot before rewrite
  try {
    const latestVer = await env.DB.prepare('SELECT MAX(version_number) as max_ver FROM project_versions WHERE project_id = ?').bind(projectId).first()
    const nextVer = (latestVer?.max_ver || 0) + 1
    await env.DB.prepare('INSERT INTO project_versions (project_id, user_id, version_number, sections_snapshot, change_summary, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(projectId, userId, nextVer, project.sections || '{}', `Pre-rewrite snapshot — ${source} cycle ${cycleNum}`, now).run()
  } catch (e) { console.error('Snapshot failed:', e) }

  // Decrement cycles
  await env.DB.prepare('UPDATE submission_packages SET cycles_remaining = cycles_remaining - 1, cycles_used = cycles_used + 1 WHERE id = ?').bind(pkg.package_id).run()
  await env.DB.prepare('UPDATE projects SET rewrite_cycles_remaining = rewrite_cycles_remaining - 1, rewrite_cycles_used = rewrite_cycles_used + 1, rewrite_source = ? WHERE id = ? AND user_id = ?')
    .bind(source, projectId, userId).run()

  // Extract feedback from source_results based on source type
  function extractFeedback(source, results) {
    const feedback = { general: [], bySection: {} }
    if (!results) return feedback

    const addToSection = (sectionId, text) => {
      if (!text) return
      if (!feedback.bySection[sectionId]) feedback.bySection[sectionId] = []
      feedback.bySection[sectionId].push(text)
    }

    if (source === 'study_section') {
      // Weaknesses from each reviewer and missing components
      const reviewers = [results.reviewer1, results.reviewer2, results.reviewer3].filter(Boolean)
      reviewers.forEach(r => {
        if (r.weaknesses) r.weaknesses.forEach(w => feedback.general.push(w))
        if (r.priority_revisions) r.priority_revisions.forEach(p => feedback.general.push(p))
        if (r.concerns) r.concerns.forEach(c => feedback.general.push(c))
        if (r.criteria) {
          if (r.criteria.approach?.weaknesses) addToSection('approach', r.criteria.approach.weaknesses.join('; '))
          if (r.criteria.significance?.weaknesses) addToSection('sig', r.criteria.significance.weaknesses.join('; '))
          if (r.criteria.innovation?.weaknesses) addToSection('innov', r.criteria.innovation.weaknesses.join('; '))
        }
      })
      if (results.weaknesses) results.weaknesses.forEach(w => feedback.general.push(w))
      if (results.missing_components) results.missing_components.forEach(m => feedback.general.push(`Missing: ${m}`))
    } else if (source === 'pd_review') {
      if (results.concerns) results.concerns.forEach(c => feedback.general.push(c))
      if (results.recommended_actions) results.recommended_actions.forEach(a => feedback.general.push(a))
    } else if (source === 'advisory_council') {
      if (results.conditions) results.conditions.forEach(c => feedback.general.push(c))
      if (results.rationale) feedback.general.push(results.rationale)
    } else if (source === 'commercial_review') {
      const reviewers = [results.reviewer1, results.reviewer2, results.reviewer3].filter(Boolean)
      reviewers.forEach(r => {
        if (r.critical_gaps) r.critical_gaps.forEach(g => feedback.general.push(g))
        if (r.concerns) r.concerns.forEach(c => feedback.general.push(c))
      })
      if (results.critical_gaps) results.critical_gaps.forEach(g => feedback.general.push(g))
      addToSection('commercial', feedback.general.join('; '))
    } else if (source === 'aims_optimizer') {
      if (results.elements) {
        results.elements.filter(e => (e.score || 10) < 7).forEach(e => {
          addToSection('aims', `${e.name}: ${e.issue || e.feedback || ''}`)
        })
      }
      if (results.top_three_improvements) results.top_three_improvements.forEach(i => {
        addToSection('aims', i)
        feedback.general.push(i)
      })
    } else if (source === 'compliance') {
      if (results.issues) {
        results.issues.filter(i => ['critical', 'warning'].includes(i.severity)).forEach(i => {
          addToSection(i.section_id || 'aims', `${i.severity.toUpperCase()}: ${i.message}`)
          feedback.general.push(`${i.section_id}: ${i.message}`)
        })
      }
    }

    return feedback
  }

  const feedback = extractFeedback(source, source_results)

  // Sections to potentially rewrite
  const REWRITEABLE = ['aims', 'sig', 'innov', 'approach', 'summary', 'narrative', 'commercial']
  const rewrittenSections = {}
  const originalSections = {}
  const sectionsRewritten = []

  // Gather all concerns for each section
  const sectionsWithFeedback = new Set([...Object.keys(feedback.bySection)])
  if (feedback.general.length > 0) {
    REWRITEABLE.forEach(s => { if (sections[s] && sections[s].length > 100) sectionsWithFeedback.add(s) })
  }

  const rewritePromises = []
  for (const sectionId of sectionsWithFeedback) {
    if (!sections[sectionId] || sections[sectionId].length < 50) continue
    const concerns = [...(feedback.bySection[sectionId] || []), ...feedback.general].slice(0, 20)
    if (concerns.length === 0) continue

    const sectionContent = sections[sectionId]
    originalSections[sectionId] = sectionContent

    const rewritePromise = callAnthropicWithFallback({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2500,
      system: `You are an elite NIH grant writer performing a targeted rewrite of a grant section to address specific reviewer concerns. Rewrite it to directly address each concern while preserving scientific content and strengthening weak areas. Return only the rewritten section text with no commentary or preamble.`,
      messages: [{
        role: 'user',
        content: `REVIEWER CONCERNS TO ADDRESS:\n${concerns.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\nCURRENT SECTION:\n${sectionContent.slice(0, 8000)}`
      }]
    }, env).then(r => {
      if (r._fallback) return { sectionId, rewritten: sectionContent }
      const text = r.content?.[0]?.text || sectionContent
      return { sectionId, rewritten: text }
    })
    rewritePromises.push(rewritePromise)
  }

  const rewriteResults = await Promise.all(rewritePromises)
  for (const { sectionId, rewritten } of rewriteResults) {
    rewrittenSections[sectionId] = rewritten
    sectionsRewritten.push(sectionId)
  }

  // Store rewrite results
  const existingRewriteResults = project.rewrite_results ? (() => { try { return JSON.parse(project.rewrite_results) } catch { return {} } })() : {}
  const newRewriteResults = { ...existingRewriteResults }
  for (const sectionId of sectionsRewritten) {
    newRewriteResults[sectionId] = { original: originalSections[sectionId], rewritten: rewrittenSections[sectionId], cycle: cycleNum, source }
  }
  await env.DB.prepare('UPDATE projects SET rewrite_results = ? WHERE id = ? AND user_id = ?').bind(JSON.stringify(newRewriteResults), projectId, userId).run()

  // Get updated cycles
  const updatedPkg = await checkSubmissionPackage(projectId, userId, env)

  // Fire reference verification for rewritten sections via waitUntil
  if (ctx && sectionsRewritten.length > 0) {
    ctx.waitUntil((async () => {
      const verifyPromises = sectionsRewritten.slice(0, 3).map(sectionId =>
        runReferenceVerification(projectId, sectionId, rewrittenSections[sectionId], userId, env).catch(e => console.error('Ref verify failed:', e))
      )
      await Promise.all(verifyPromises)
    })())
  }

  return json({
    rewritten_sections: rewrittenSections,
    original_sections: originalSections,
    sections_rewritten: sectionsRewritten,
    feedback_addressed: feedback.general.length + Object.values(feedback.bySection).flat().length,
    cycles_remaining: updatedPkg.cycles_remaining,
    cycle_number: cycleNum,
  })
}

// ── Multi-Database Reference Verification (v5.5.0) ───────────────────────────

async function checkPubMed(citation) {
  const query = encodeURIComponent(`${citation.authors} ${citation.year}${citation.journal ? ' ' + citation.journal : ''}`)
  const searchResp = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=${query}&retmax=3&retmode=json`)
  const searchData = await searchResp.json()
  const pmids = searchData.esearchresult?.idlist || []
  if (pmids.length === 0) return { found: false, database: 'PubMed' }
  const summaryResp = await fetch(`https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmids[0]}&retmode=json`)
  const summaryData = await summaryResp.json()
  const article = summaryData.result?.[pmids[0]]
  if (!article) return { found: false, database: 'PubMed' }
  return { found: true, database: 'PubMed', record: { title: article.title, authors: article.authors?.map(a => a.name).join(', '), journal: article.source, year: article.pubdate?.substring(0, 4), pmid: pmids[0], url: `https://pubmed.ncbi.nlm.nih.gov/${pmids[0]}` } }
}

async function checkCrossRef(citation) {
  const url = `https://api.crossref.org/works?query.author=${encodeURIComponent(citation.authors)}&filter=from-pub-date:${citation.year},until-pub-date:${citation.year}&rows=3&mailto=verify@frankgrant.app`
  const resp = await fetch(url)
  const data = await resp.json()
  const items = data.message?.items || []
  if (items.length === 0) return { found: false, database: 'CrossRef' }
  const item = items[0]
  return { found: true, database: 'CrossRef', record: { title: item.title?.[0], authors: item.author?.map(a => `${a.family} ${a.given}`).join(', '), journal: item['container-title']?.[0], year: item.published?.['date-parts']?.[0]?.[0]?.toString(), doi: item.DOI, url: item.URL || `https://doi.org/${item.DOI}` } }
}

async function checkSemanticScholar(citation) {
  const query = encodeURIComponent(`${citation.authors} ${citation.year}`)
  const resp = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&fields=title,authors,year,journal,externalIds&limit=3`, { headers: { 'User-Agent': 'FrankGrant/1.0 (verify@frankgrant.app)' } })
  const data = await resp.json()
  const papers = data.data || []
  if (papers.length === 0) return { found: false, database: 'Semantic Scholar' }
  const paper = papers[0]
  return { found: true, database: 'Semantic Scholar', record: { title: paper.title, authors: paper.authors?.map(a => a.name).join(', '), year: paper.year?.toString(), journal: paper.journal?.name, url: `https://www.semanticscholar.org/paper/${paper.paperId}` } }
}

async function checkOpenAlex(citation) {
  const url = `https://api.openalex.org/works?filter=author.display_name.search:${encodeURIComponent(citation.authors)},publication_year:${citation.year}&per-page=3&mailto=verify@frankgrant.app`
  const resp = await fetch(url)
  const data = await resp.json()
  const works = data.results || []
  if (works.length === 0) return { found: false, database: 'OpenAlex' }
  const work = works[0]
  return { found: true, database: 'OpenAlex', record: { title: work.display_name, authors: work.authorships?.map(a => a.author?.display_name).join(', '), year: work.publication_year?.toString(), journal: work.primary_location?.source?.display_name, doi: work.doi, url: work.doi || work.id } }
}

async function checkEuropePMC(citation) {
  const query = encodeURIComponent(`AUTH:"${citation.authors}" AND PUB_YEAR:${citation.year}`)
  const resp = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${query}&format=json&pageSize=3`)
  const data = await resp.json()
  const articles = data.resultList?.result || []
  if (articles.length === 0) return { found: false, database: 'Europe PMC' }
  const article = articles[0]
  return { found: true, database: 'Europe PMC', record: { title: article.title, authors: article.authorString, year: article.pubYear, journal: article.journalTitle, pmid: article.pmid, url: `https://europepmc.org/article/MED/${article.pmid}` } }
}

async function verifyReferenceMultiDB(citation) {
  const checks = await Promise.allSettled([
    checkPubMed(citation),
    checkCrossRef(citation),
    checkSemanticScholar(citation),
    checkOpenAlex(citation),
    checkEuropePMC(citation)
  ])
  const results = {
    pubmed: checks[0].status === 'fulfilled' ? checks[0].value : { found: false, error: checks[0].reason?.message },
    crossref: checks[1].status === 'fulfilled' ? checks[1].value : { found: false, error: checks[1].reason?.message },
    semantic_scholar: checks[2].status === 'fulfilled' ? checks[2].value : { found: false, error: checks[2].reason?.message },
    open_alex: checks[3].status === 'fulfilled' ? checks[3].value : { found: false, error: checks[3].reason?.message },
    europe_pmc: checks[4].status === 'fulfilled' ? checks[4].value : { found: false, error: checks[4].reason?.message }
  }
  const foundCount = Object.values(results).filter(r => r.found).length
  const errorCount = Object.values(results).filter(r => r.error).length
  let verificationStatus = 'not_found'
  let confidenceScore = 0
  if (foundCount >= 3) { verificationStatus = 'verified'; confidenceScore = 95 }
  else if (foundCount === 2) { verificationStatus = 'verified'; confidenceScore = 85 }
  else if (foundCount === 1) { verificationStatus = 'likely_real'; confidenceScore = 60 }
  else if (errorCount >= 3) { verificationStatus = 'needs_manual_check'; confidenceScore = 0 }
  const matchedRecords = Object.entries(results).filter(([, r]) => r.found && r.record).map(([db, r]) => ({ database: db, ...r.record }))
  return { databases_checked: 5, databases_found: foundCount, databases_errored: errorCount, verification_status: verificationStatus, confidence_score: confidenceScore, matched_records: matchedRecords, database_results: results }
}

// ── Reference Verification ────────────────────────────────────────────────────

async function runReferenceVerification(projectId, sectionName, content, userId, env) {
  if (!content || content.length < 100) return

  // Step 1: Extract citations with Haiku
  const extractResult = await callAnthropicWithFallback({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    system: 'Extract every citation from this grant section. Look for author-year format like Smith et al. 2023, numbered references like [1] or [14], and any other citation patterns. Return ONLY valid JSON: { "citations": [{ "raw_text": "string", "authors": "string", "year": number, "journal": "string" }] }',
    messages: [{ role: 'user', content: content.slice(0, 6000) }]
  }, env)

  if (extractResult._fallback) return

  let citations = []
  try {
    const jm = (extractResult.content?.[0]?.text || '').match(/\{[\s\S]*\}/)
    if (jm) citations = safeParseJSON(jm[0])?.citations || []
  } catch { return }

  citations = citations.slice(0, 20)

  // Step 2: Multi-database lookup for each citation (200ms delay between to avoid rate limits)
  const results = []
  for (const cit of citations) {
    try {
      const multiResult = await verifyReferenceMultiDB(cit)
      // Map multi-DB result to legacy status for backward compat
      let status = 'not_found'
      if (multiResult.verification_status === 'verified') status = 'verified'
      else if (multiResult.verification_status === 'likely_real') status = 'uncertain'
      else if (multiResult.verification_status === 'needs_manual_check') status = 'uncertain'
      const bestRecord = multiResult.matched_records?.[0]
      results.push({
        ...cit,
        status,
        pmid: bestRecord?.pmid || null,
        doi: bestRecord?.doi || null,
        pubmed_title: bestRecord?.title || null,
        verification_status: multiResult.verification_status,
        confidence_score: multiResult.confidence_score,
        databases_found: multiResult.databases_found,
        databases_checked: multiResult.databases_checked,
        database_results: multiResult.database_results,
        matched_records: multiResult.matched_records,
      })
    } catch (e) {
      results.push({ ...cit, status: 'uncertain', reason: 'Multi-DB lookup failed', verification_status: 'needs_manual_check', databases_found: 0, databases_checked: 5, database_results: {} })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  // Store results
  const existing = await env.DB.prepare('SELECT reference_check_results FROM projects WHERE id = ?').bind(projectId).first()
  const allResults = existing?.reference_check_results ? (() => { try { return JSON.parse(existing.reference_check_results) } catch { return {} } })() : {}
  const verifiedCount = results.filter(r => r.verification_status === 'verified').length
  const likelyRealCount = results.filter(r => r.verification_status === 'likely_real').length
  const notFoundCount = results.filter(r => r.verification_status === 'not_found').length
  const overallReliability = notFoundCount === 0 ? 'high' : notFoundCount <= 2 ? 'medium' : 'low'
  allResults[sectionName] = {
    checked_at: Math.floor(Date.now() / 1000),
    results,
    verified_count: verifiedCount,
    uncertain_count: likelyRealCount,
    not_found_count: notFoundCount,
    overall_reliability: overallReliability,
    // Legacy compat
    verified_count_legacy: results.filter(r => r.status === 'verified').length,
    uncertain_count_legacy: results.filter(r => r.status === 'uncertain').length,
  }
  await env.DB.prepare('UPDATE projects SET reference_check_results = ? WHERE id = ?').bind(JSON.stringify(allResults), projectId).run()
}

// ── Three-Pass Quality Review (v5.5.0) ───────────────────────────────────────

async function handleQualityPass1(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT id, title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const allSectionsText = Object.entries(sections)
    .filter(([, v]) => v && typeof v === 'string' && v.length > 50)
    .map(([k, v]) => `[${k.toUpperCase()}]\n${v.slice(0, 2000)}`)
    .join('\n\n')
    .slice(0, 12000)

  const now = Math.floor(Date.now() / 1000)

  // Run AI accuracy review + citation extraction in parallel
  const [accuracyResp, citationExtractResp] = await Promise.all([
    callAnthropicWithFallback({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      system: 'You are a scientific accuracy reviewer for a professional grant writing service. Verify that the grant sections accurately represent what the researcher described in their setup. Flag: invented claims not in setup, specific numbers not provided by researcher, methods researcher did not mention, preliminary data claims researcher did not describe, PI credentials not stated.',
      messages: [{ role: 'user', content: `PROJECT SETUP: Disease: ${setup.disease_area || 'not specified'}. Biology: ${setup.biology_description || 'not specified'}. Aims: ${setup.aims_summary || 'not specified'}. PI: ${setup.pi_name || 'not specified'} at ${setup.institution || 'not specified'}. Prelim data: ${project.prelim_data_narrative || 'None'}.\n\nSECTIONS:\n${allSectionsText}\n\nReturn ONLY valid JSON: { "passed": boolean, "accuracy_score": number, "invented_claims": [{ "section": "string", "claim": "string", "concern": "string" }], "unverified_numbers": [{ "section": "string", "number": "string", "concern": "string" }], "misrepresented_methods": [{ "section": "string", "issue": "string" }], "overall_assessment": "string", "recommendation": "approve|revise|reject" }` }]
    }, env),
    callAnthropicWithFallback({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'Extract every citation from these grant sections. Return ONLY valid JSON: { "citations": [{ "raw_text": "string", "authors": "string", "year": number, "journal": "string", "section": "string" }] }',
      messages: [{ role: 'user', content: allSectionsText.slice(0, 8000) }]
    }, env)
  ])

  // Parse accuracy results
  let accuracyResult = { passed: true, accuracy_score: 85, invented_claims: [], unverified_numbers: [], misrepresented_methods: [], overall_assessment: 'Unable to complete review', recommendation: 'revise' }
  if (!accuracyResp._fallback) {
    try {
      const r = await accuracyResp.json()
      const text = r.content?.[0]?.text || ''
      const jm = text.match(/\{[\s\S]*\}/)
      if (jm) { const p = safeParseJSON(jm[0]); if (p) accuracyResult = { ...accuracyResult, ...p } }
    } catch {}
  }

  // Extract and verify citations
  let citations = []
  if (!citationExtractResp._fallback) {
    try {
      const r = await citationExtractResp.json()
      const text = r.content?.[0]?.text || ''
      const jm = text.match(/\{[\s\S]*\}/)
      if (jm) citations = safeParseJSON(jm[0])?.citations || []
    } catch {}
  }

  citations = citations.slice(0, 20)
  const citationResults = []
  for (const cit of citations) {
    try {
      const multiResult = await verifyReferenceMultiDB(cit)
      citationResults.push({ ...cit, ...multiResult })
    } catch {
      citationResults.push({ ...cit, verification_status: 'needs_manual_check', databases_found: 0, databases_checked: 5 })
    }
    await new Promise(r => setTimeout(r, 200))
  }

  const verifiedCount = citationResults.filter(r => r.verification_status === 'verified').length
  const likelyRealCount = citationResults.filter(r => r.verification_status === 'likely_real').length
  const notFoundCount = citationResults.filter(r => r.verification_status === 'not_found').length
  const overallReliability = notFoundCount === 0 ? 'high' : notFoundCount <= 2 ? 'medium' : 'low'

  const citationVerification = {
    total_citations: citationResults.length,
    verified: verifiedCount,
    likely_real: likelyRealCount,
    not_found: notFoundCount,
    needs_manual: citationResults.filter(r => r.verification_status === 'needs_manual_check').length,
    overall_reliability: overallReliability,
    problem_citations: citationResults
      .filter(r => r.verification_status === 'not_found' || r.verification_status === 'needs_manual_check')
      .map(r => ({ raw_text: r.raw_text, section: r.section || 'unknown', status: r.verification_status, databases_checked: r.databases_checked, databases_found: r.databases_found, database_results: r.database_results, recommendation: r.verification_status === 'not_found' ? 'Remove or replace — not found in any scholarly database' : 'Verify manually — database errors prevented full check' })),
    all_citations: citationResults
  }

  // Pass 1 fails if: recommendation is reject, accuracy_score < 70, OR any not_found citations
  const passed = accuracyResult.recommendation !== 'reject' && (accuracyResult.accuracy_score || 0) >= 70 && notFoundCount === 0
  const issuesCount = (accuracyResult.invented_claims?.length || 0) + (accuracyResult.unverified_numbers?.length || 0) + (accuracyResult.misrepresented_methods?.length || 0) + notFoundCount

  const pass1Results = { passed, accuracy_score: accuracyResult.accuracy_score, recommendation: accuracyResult.recommendation, overall_assessment: accuracyResult.overall_assessment, invented_claims: accuracyResult.invented_claims, unverified_numbers: accuracyResult.unverified_numbers, misrepresented_methods: accuracyResult.misrepresented_methods, citation_verification: citationVerification, issues_count: issuesCount }

  await env.DB.prepare('UPDATE projects SET quality_pass1_results = ?, quality_pass1_at = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(pass1Results), now, projectId, userId).run()

  return json(pass1Results)
}

async function runComplianceChecks(project, sections, rules) {
  const checks = []
  const isSBIR = project.mechanism?.includes('SBIR') || project.mechanism?.includes('STTR') || project.mechanism?.includes('D2P2')

  const rsWords = (sections.sig?.split(' ').length || 0) + (sections.innov?.split(' ').length || 0) + (sections.approach?.split(' ').length || 0)
  const rsPages = rsWords / 250
  const rsLimit = rules?.research_strategy_pages || 12
  checks.push({ check: 'Research Strategy page limit', passed: rsPages <= rsLimit, value: `${rsPages.toFixed(1)} pages`, limit: `${rsLimit} pages`, severity: 'critical' })

  const aimsWords = sections.aims?.split(' ').length || 0
  checks.push({ check: 'Specific Aims page limit', passed: aimsWords <= 275, value: `${(aimsWords / 250).toFixed(1)} pages`, limit: '1 page', severity: 'critical' })

  const required = ['aims', 'sig', 'innov', 'approach']
  if (isSBIR) required.push('commercial')
  for (const s of required) {
    const wc = sections[s]?.split(' ').length || 0
    checks.push({ check: `${s} section present and substantive`, passed: wc > 100, value: sections[s] ? `${wc} words` : 'Missing', limit: 'Required (>100 words)', severity: 'critical' })
  }

  if (sections.commercial && isSBIR) {
    const commPages = sections.commercial.split(' ').length / 250
    const commLimit = rules?.commercialization_plan_pages || 12
    checks.push({ check: 'Commercialization Plan page limit', passed: commPages <= commLimit, value: `${commPages.toFixed(1)} pages`, limit: `${commLimit} pages`, severity: 'critical' })
  }

  if (rules?.budget_direct_costs) checks.push({ check: 'Budget cap verification', passed: null, value: 'Manual check required', limit: `$${rules.budget_direct_costs?.toLocaleString()} direct costs`, severity: 'warning', manual: true })

  const criticalFailed = checks.filter(c => c.passed === false && c.severity === 'critical').length
  return { checks, passed: criticalFailed === 0, critical_failures: criticalFailed, warnings: checks.filter(c => c.severity === 'warning').length, compliance_score: Math.round((checks.filter(c => c.passed !== false).length / checks.length) * 100) }
}

async function handleQualityPass2(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT id, title, mechanism, setup, sections, foa_rules FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  let rules = null
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}
  try { rules = project.foa_rules ? JSON.parse(project.foa_rules) : null } catch {}

  const now = Math.floor(Date.now() / 1000)

  const allSectionsText = Object.entries(sections)
    .filter(([, v]) => v && typeof v === 'string' && v.length > 50)
    .map(([k, v]) => `[${k.toUpperCase()}]\n${v.slice(0, 1500)}`)
    .join('\n\n')
    .slice(0, 8000)

  const isFastTrack = project.mechanism === 'FAST-TRACK'
  const isSTTR = project.mechanism?.includes('STTR')

  // Run programmatic + AI compliance checks in parallel
  const [programmaticResult, contentResp] = await Promise.all([
    runComplianceChecks(project, sections, rules),
    callAnthropicWithFallback({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      system: 'You are an NIH grants compliance checker.',
      messages: [{ role: 'user', content: `Check this NIH ${project.mechanism || 'grant'} for: missing rigor and reproducibility statement in Significance or Approach (required since 2016), missing timeline in Approach, ${isFastTrack ? 'missing go/no-go criteria (Fast Track required),' : ''} human subjects mentioned without protections, animal research without IACUC reference${isSTTR ? ', STTR without partner work allocation' : ''}. Return ONLY valid JSON: { "content_issues": [{ "issue": "string", "section": "string", "severity": "critical|warning", "fix": "string" }] }\n\nSECTIONS:\n${allSectionsText}` }]
    }, env)
  ])

  let contentIssues = []
  if (!contentResp._fallback) {
    try {
      const r = await contentResp.json()
      const text = r.content?.[0]?.text || ''
      const jm = text.match(/\{[\s\S]*\}/)
      if (jm) contentIssues = safeParseJSON(jm[0])?.content_issues || []
    } catch {}
  }

  const criticalContentIssues = contentIssues.filter(i => i.severity === 'critical').length
  const passed = programmaticResult.passed && criticalContentIssues === 0

  const pass2Results = { passed, compliance_score: programmaticResult.compliance_score, critical_failures: programmaticResult.critical_failures + criticalContentIssues, warnings: programmaticResult.warnings + contentIssues.filter(i => i.severity === 'warning').length, checks: programmaticResult.checks, content_issues: contentIssues }

  await env.DB.prepare('UPDATE projects SET quality_pass2_results = ?, quality_pass2_at = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(pass2Results), now, projectId, userId).run()

  return json(pass2Results)
}

async function runStudySectionCore(project, sections, setup, env) {
  const fullGrantContext = buildFullGrantContext(
    project, sections, setup,
    { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections }
  )
  const userMsg = `Review this NIH ${project.mechanism || 'grant'} application:\n\n${fullGrantContext}`

  const callReviewer = async (system) => {
    const resp = await callAnthropicWithFallback({ model: 'claude-sonnet-4-20250514', max_tokens: 2000, system, messages: [{ role: 'user', content: userMsg }] }, env)
    if (resp._fallback) return { criteria: null, critique: 'Reviewer unavailable.', usage: { input_tokens: 0, output_tokens: 0 } }
    const r = await resp.json()
    const text = r.content?.[0]?.text || ''
    const parsed = safeParseJSON(text)
    return { criteria: parsed?.criteria || null, critique: parsed?.critique || text, usage: r.usage }
  }

  const [rev1, rev2, rev3] = await Promise.all([callReviewer(SS_REVIEWER_1), callReviewer(SS_REVIEWER_2), callReviewer(SS_REVIEWER_3)])

  const criteriaKeys = ['significance', 'innovation', 'approach', 'investigators', 'environment']
  const aggregatedCriteria = {}
  for (const key of criteriaKeys) {
    const revData = [rev1, rev2, rev3].map(r => r.criteria?.[key]).filter(Boolean)
    const scoreableRevs = revData.filter(c => c.scoreable !== false && c.score != null)
    const avgScore = scoreableRevs.length > 0 ? Math.round(scoreableRevs.reduce((s, c) => s + c.score, 0) / scoreableRevs.length * 10) / 10 : null
    aggregatedCriteria[key] = { score: scoreableRevs.length >= 2 ? avgScore : null, scoreable: scoreableRevs.length >= 2 }
  }

  const scoreableCount = criteriaKeys.filter(k => aggregatedCriteria[k].scoreable).length
  const impactRevData = [rev1, rev2, rev3].map(r => r.criteria?.impact).filter(Boolean)
  const scoreableImpact = impactRevData.filter(c => c.scoreable !== false && c.score != null)
  const rawImpactScore = scoreableImpact.length > 0 ? Math.round(scoreableImpact.reduce((s, c) => s + c.score, 0) / scoreableImpact.length * 10) / 10 : null
  const finalImpactScore = scoreableCount >= 3 ? rawImpactScore : null

  return { final_impact_score: finalImpactScore, scored_criteria: aggregatedCriteria, reviewers: [rev1.critique, rev2.critique, rev3.critique] }
}

async function handleQualityPass3(req, env, userId, projectId) {
  const project = await env.DB.prepare(
    'SELECT id, title, mechanism, setup, sections, fast_track_phase1_sections, fast_track_phase2_sections, prelim_data_narrative FROM projects WHERE id = ? AND user_id = ?'
  ).bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  let setup = {}, sections = {}
  try { setup = JSON.parse(project.setup || '{}') } catch {}
  try { sections = JSON.parse(project.sections || '{}') } catch {}

  const isSBIR = project.mechanism?.includes('SBIR') || project.mechanism?.includes('STTR') || project.mechanism?.includes('D2P2')
  const now = Math.floor(Date.now() / 1000)

  // Run study section (and commercial for SBIR)
  const [studySectionResults, commercialResults] = await Promise.all([
    runStudySectionCore(project, sections, setup, env),
    isSBIR ? (async () => {
      const fullGrantContext = buildFullGrantContext(project, sections, setup, { phase1: project.fast_track_phase1_sections, phase2: project.fast_track_phase2_sections })
      const resp = await callAnthropicWithFallback({ model: 'claude-sonnet-4-20250514', max_tokens: 1500, system: COMMERCIAL_REVIEWER_SYSTEM, messages: [{ role: 'user', content: fullGrantContext }] }, env)
      if (resp._fallback) return null
      const r = await resp.json()
      const text = r.content?.[0]?.text || ''
      const jm = text.match(/\{[\s\S]*\}/)
      return jm ? safeParseJSON(jm[0]) : null
    })() : Promise.resolve(null)
  ])

  // Evaluate for delivery
  const issues = []
  if (studySectionResults.final_impact_score !== null && studySectionResults.final_impact_score > 40) {
    issues.push({ type: 'impact_score_too_high', severity: 'critical', message: `Impact score ${studySectionResults.final_impact_score} exceeds 40 — not competitive. Rewrite required before delivery.`, score: studySectionResults.final_impact_score, threshold: 40 })
  }
  for (const [criterion, data] of Object.entries(studySectionResults.scored_criteria || {})) {
    if (data.score && data.score >= 7) {
      issues.push({ type: 'weak_criterion', severity: 'critical', message: `${criterion} scored ${data.score.toFixed(1)} — serious weakness requiring revision.`, criterion, score: data.score })
    }
  }
  if (isSBIR && commercialResults) {
    const dims = ['market', 'ip', 'regulatory', 'revenue_model', 'commercial_team']
    for (const dim of dims) {
      const score = commercialResults[dim]?.score
      if (score && score <= 8) { // score is /20, 8/20 = 40%
        issues.push({ type: 'weak_commercial', severity: 'warning', message: `Commercial ${dim} scored ${score}/20 — needs strengthening.`, dimension: dim, score })
      }
    }
  }

  const criticalIssues = issues.filter(i => i.severity === 'critical')
  const passed = criticalIssues.length === 0
  const pass3Results = { passed, issues, critical_count: criticalIssues.length, warning_count: issues.filter(i => i.severity === 'warning').length, study_section_score: studySectionResults.final_impact_score, study_section_results: studySectionResults, commercial_results: commercialResults, delivery_approved: passed }

  await env.DB.prepare('UPDATE projects SET quality_pass3_results = ?, quality_pass3_at = ? WHERE id = ? AND user_id = ?')
    .bind(JSON.stringify(pass3Results), now, projectId, userId).run()

  return json(pass3Results)
}

async function handleQualityRunAll(req, env, userId, projectId) {
  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)
  const now = Math.floor(Date.now() / 1000)

  // Pass 1
  const pass1Resp = await handleQualityPass1(new Request('https://x'), env, userId, projectId)
  const pass1 = await pass1Resp.clone().json()
  if (!pass1.passed) {
    return json({ all_passed: false, failed_at: 'pass1', delivery_ready: false, pass1, pass2: null, pass3: null })
  }

  // Pass 2
  const pass2Resp = await handleQualityPass2(new Request('https://x'), env, userId, projectId)
  const pass2 = await pass2Resp.clone().json()
  if (!pass2.passed) {
    return json({ all_passed: false, failed_at: 'pass2', delivery_ready: false, pass1, pass2, pass3: null })
  }

  // Pass 3
  const pass3Resp = await handleQualityPass3(new Request('https://x'), env, userId, projectId)
  const pass3 = await pass3Resp.clone().json()
  if (!pass3.passed) {
    return json({ all_passed: false, failed_at: 'pass3', delivery_ready: false, pass1, pass2, pass3 })
  }

  // All passed — certify
  await env.DB.prepare('UPDATE projects SET quality_certified = 1, quality_certified_at = ?, delivery_ready = 1 WHERE id = ? AND user_id = ?')
    .bind(now, projectId, userId).run()

  return json({ all_passed: true, failed_at: null, delivery_ready: true, certified_at: now, pass1, pass2, pass3 })
}

async function handleVerifyReferences(req, env, userId, projectId) {
  const body = await req.json()
  const { section_name, content } = body

  const project = await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ?').bind(projectId, userId).first()
  if (!project) return err('Project not found', 404)

  await runReferenceVerification(projectId, section_name, content, userId, env)

  const updated = await env.DB.prepare('SELECT reference_check_results FROM projects WHERE id = ?').bind(projectId).first()
  const allResults = updated?.reference_check_results ? (() => { try { return JSON.parse(updated.reference_check_results) } catch { return {} } })() : {}
  const sectionResults = allResults[section_name] || { results: [], verified_count: 0, uncertain_count: 0, not_found_count: 0 }

  return json(sectionResults)
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

      // Maintenance mode check (before all routes except health and admin/maintenance)
      if (!path.startsWith('/api/health') && !path.startsWith('/api/admin/maintenance') && !path.startsWith('/api/status')) {
        const maintenance = await env.KV.get('maintenance_mode', 'json').catch(() => null)
        if (maintenance?.enabled) {
          return json({ error: 'maintenance', message: maintenance.message || 'FrankGrant is performing scheduled maintenance. Your work is saved.', eta: maintenance.eta }, 503)
        }
      }

      // Public status endpoints (no auth required)
      if (path === '/api/status/anthropic' && req.method === 'GET') {
        return handleAnthropicStatus(req, env)
      }
      if (path === '/api/status' && req.method === 'GET') {
        return handleAppStatus(req, env)
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

      // IP rate limiting
      const clientIP = req.headers.get('CF-Connecting-IP') || 'unknown'
      if (clientIP !== 'unknown') {
        const ipKey = `rate_ip:${clientIP}:${Math.floor(Date.now() / 60000)}`
        const ipCount = parseInt(await env.KV.get(ipKey) || '0')
        if (ipCount >= 100) {
          try { await env.DB.prepare('INSERT INTO rate_limit_log (user_id, endpoint, ip_address, created_at) VALUES (?, ?, ?, ?)').bind(userId, path, clientIP, Math.floor(Date.now() / 1000)).run() } catch {}
          return json({ error: 'rate_limited', message: 'Too many requests. Please slow down.' }, 429)
        }
        await env.KV.put(ipKey, ipCount + 1, { expirationTtl: 120 })
      }

      // Payload size check for POST/PUT
      if (req.method === 'POST' || req.method === 'PUT') {
        const contentLength = parseInt(req.headers.get('Content-Length') || '0')
        if (contentLength > 52428800) {
          return json({ error: 'payload_too_large', max_size_kb: 50 }, 413)
        }
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

      // Collaboration - global routes (must be before projectMatch)
      if (path === '/api/projects/shared' && req.method === 'GET') {
        const response = await handleGetSharedProjects(req, env, userId, userEmail)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      if (path === '/api/projects/pending-invitations' && req.method === 'GET') {
        const response = await handleGetPendingInvitations(req, env, userId, userEmail)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Collaboration - per-project routes (must be before generic projectMatch)
      const collabMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/collaborators$/)
      if (collabMatch) {
        const projectId = collabMatch[1]
        let response
        if (req.method === 'GET') response = await handleGetCollaborators(req, env, userId, userEmail, projectId)
        else if (req.method === 'POST') response = await handleInviteCollaborator(req, env, userId, userEmail, projectId)
        if (response) { await logError(path, 200, null, Date.now() - startTime, userId, env); return response }
      }

      const collabItemMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/collaborators\/(\d+)$/)
      if (collabItemMatch) {
        const [, projectId, collabId] = collabItemMatch
        let response
        if (req.method === 'DELETE') response = await handleDeleteCollaborator(req, env, userId, projectId, parseInt(collabId))
        else if (req.method === 'PATCH') response = await handlePatchCollaborator(req, env, userId, projectId, parseInt(collabId))
        if (response) { await logError(path, 200, null, Date.now() - startTime, userId, env); return response }
      }

      const collabAcceptMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/collaborators\/accept$/)
      if (collabAcceptMatch && req.method === 'POST') {
        const response = await handleAcceptInvitation(req, env, userId, userEmail, collabAcceptMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const commentsMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/comments$/)
      if (commentsMatch) {
        const projectId = commentsMatch[1]
        let response
        if (req.method === 'GET') response = await handleGetComments(req, env, userId, userEmail, projectId)
        else if (req.method === 'POST') response = await handlePostComment(req, env, userId, userEmail, projectId)
        if (response) { await logError(path, 200, null, Date.now() - startTime, userId, env); return response }
      }

      const commentItemMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/comments\/(\d+)$/)
      if (commentItemMatch) {
        const [, projectId, commentId] = commentItemMatch
        let response
        if (req.method === 'PATCH') response = await handlePatchComment(req, env, userId, userEmail, projectId, parseInt(commentId))
        else if (req.method === 'DELETE') response = await handleDeleteComment(req, env, userId, userEmail, projectId, parseInt(commentId))
        if (response) { await logError(path, 200, null, Date.now() - startTime, userId, env); return response }
      }

      const sectionAssignMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/sections\/([^/]+)\/assign$/)
      if (sectionAssignMatch && req.method === 'POST') {
        const response = await handleAssignSection(req, env, userId, sectionAssignMatch[1], decodeURIComponent(sectionAssignMatch[2]))
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const versionRestoreMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/versions\/(\d+)\/restore$/)
      if (versionRestoreMatch && req.method === 'POST') {
        const response = await handleRestoreVersion(req, env, userId, versionRestoreMatch[1], versionRestoreMatch[2])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const versionItemMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/versions\/(\d+)$/)
      if (versionItemMatch && req.method === 'GET') {
        const response = await handleGetVersion(req, env, userId, userEmail, versionItemMatch[1], versionItemMatch[2])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const versionsMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/versions$/)
      if (versionsMatch) {
        const projectId = versionsMatch[1]
        let response
        if (req.method === 'GET') response = await handleGetVersions(req, env, userId, userEmail, projectId)
        else if (req.method === 'POST') response = await handleCreateSnapshot(req, env, userId, userEmail, projectId)
        if (response) { await logError(path, 200, null, Date.now() - startTime, userId, env); return response }
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

      // Users: me
      if (path === '/api/users/me' && req.method === 'GET') {
        return handleGetMe(req, env, userId)
      }

      // Voice Mode
      if (path.startsWith('/api/voice/')) {
        const voiceAllowed = await checkVoiceEnabled(userId, env)
        if (!voiceAllowed) {
          return json({ error: 'voice_not_enabled', message: 'Voice Mode is a premium feature', upgrade_url: '/upgrade/voice' }, 403)
        }
      }
      if (path === '/api/voice/intent' && req.method === 'POST') {
        const response = await handleVoiceIntent(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/chat' && req.method === 'POST') {
        const response = await handleVoiceChat(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/speak' && req.method === 'POST') {
        const response = await handleVoiceSpeak(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/session' && req.method === 'GET') {
        const response = await handleVoiceSessionGet(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/session' && req.method === 'POST') {
        const response = await handleVoiceSessionPost(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/dictate' && req.method === 'POST') {
        const response = await handleVoiceDictate(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      if (path === '/api/voice/edit' && req.method === 'POST') {
        const response = await handleVoiceEdit(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Aims Optimizer
      const optimizeAimsMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/optimize-aims$/)
      if (optimizeAimsMatch && req.method === 'POST') {
        const response = await handleOptimizeAims(req, env, userId, optimizeAimsMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }
      const optimizeAimsAltMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/optimize-aims\/alternatives$/)
      if (optimizeAimsAltMatch && req.method === 'POST') {
        const response = await handleOptimizeAimsAlternatives(req, env, userId, optimizeAimsAltMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Pipeline Status
      const patchStatusMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/status$/)
      if (patchStatusMatch && req.method === 'PATCH') {
        const response = await handlePatchProjectStatus(req, env, userId, patchStatusMatch[1])
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

      // PD Review
      const pdReviewMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/pd-review$/)
      if (pdReviewMatch && req.method === 'POST') {
        const response = await handlePDReview(req, env, userId, pdReviewMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Advisory Council
      const advisoryCouncilMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/advisory-council$/)
      if (advisoryCouncilMatch && req.method === 'POST') {
        const response = await handleAdvisoryCouncil(req, env, userId, advisoryCouncilMatch[1])
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

      // Commercial Reviewer
      const commercialReviewMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/commercial-review$/)
      if (commercialReviewMatch && req.method === 'POST') {
        const response = await handleCommercialReview(req, env, userId, commercialReviewMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Commercial Charts
      const chartsMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/generate-charts$/)
      if (chartsMatch && req.method === 'POST') {
        const response = await handleGenerateCharts(req, env, userId, chartsMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Bibliography
      const bibliographyMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/bibliography$/)
      if (bibliographyMatch) {
        if (req.method === 'GET') {
          const response = await handleBibliographyGet(req, env, userId, bibliographyMatch[1])
          await logError(path, 200, null, Date.now() - startTime, userId, env)
          return response
        }
        if (req.method === 'POST') {
          const response = await handleBibliographySave(req, env, userId, bibliographyMatch[1])
          await logError(path, 200, null, Date.now() - startTime, userId, env)
          return response
        }
      }

      // Letters Generator
      if (path === '/api/letters/generate' && req.method === 'POST') {
        const response = await handleGenerateLetter(req, env, userId)
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Resubmission
      const resubImportMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/resubmission\/import-comments$/)
      if (resubImportMatch && req.method === 'POST') {
        const response = await handleResubmissionImportComments(req, env, userId, resubImportMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const resubAnalyzeMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/resubmission\/analyze$/)
      if (resubAnalyzeMatch && req.method === 'POST') {
        const response = await handleResubmissionAnalyze(req, env, userId, resubAnalyzeMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const resubIntroMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/resubmission\/generate-introduction$/)
      if (resubIntroMatch && req.method === 'POST') {
        const response = await handleResubmissionGenerateIntro(req, env, userId, resubIntroMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      const resubReviseMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/resubmission\/revise-section$/)
      if (resubReviseMatch && req.method === 'POST') {
        const response = await handleResubmissionReviseSection(req, env, userId, resubReviseMatch[1])
        await logError(path, 200, null, Date.now() - startTime, userId, env)
        return response
      }

      // Submission Package
      const subPkgMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/submission-package$/)
      if (subPkgMatch) {
        const projectId = subPkgMatch[1]
        if (req.method === 'GET') {
          const pkg = await checkSubmissionPackage(projectId, userId, env)
          return json(pkg)
        }
        if (req.method === 'POST') {
          const response = await handleActivateSubmissionPackage(req, env, userId, projectId)
          return response
        }
      }

      // Post-Review Rewrite
      const rewriteMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/rewrite$/)
      if (rewriteMatch && req.method === 'POST') {
        const response = await handleRewrite(req, env, userId, rewriteMatch[1], ctx)
        await logError(path, response.status, null, Date.now() - startTime, userId, env)
        return response
      }

      // Reference Verification
      const verifyRefsMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/verify-references$/)
      if (verifyRefsMatch && req.method === 'POST') {
        const response = await handleVerifyReferences(req, env, userId, verifyRefsMatch[1])
        await logError(path, response.status, null, Date.now() - startTime, userId, env)
        return response
      }

      // Quality Review (v5.5.0)
      const qualityRunAllMatch = path.match(/^\/api\/projects\/([a-f0-9-]+)\/quality\/run-all$/)
      if (qualityRunAllMatch && req.method === 'POST') return handleQualityRunAll(req, env, userId, qualityRunAllMatch[1])
      const qualityPass1Match = path.match(/^\/api\/projects\/([a-f0-9-]+)\/quality\/pass1$/)
      if (qualityPass1Match && req.method === 'POST') return handleQualityPass1(req, env, userId, qualityPass1Match[1])
      const qualityPass2Match = path.match(/^\/api\/projects\/([a-f0-9-]+)\/quality\/pass2$/)
      if (qualityPass2Match && req.method === 'POST') return handleQualityPass2(req, env, userId, qualityPass2Match[1])
      const qualityPass3Match = path.match(/^\/api\/projects\/([a-f0-9-]+)\/quality\/pass3$/)
      if (qualityPass3Match && req.method === 'POST') return handleQualityPass3(req, env, userId, qualityPass3Match[1])

      // Feedback (for trial requests)
      if (path === '/api/feedback' && req.method === 'POST') {
        const body = await req.json()
        const now = Math.floor(Date.now() / 1000)
        await env.DB.prepare(
          'INSERT INTO feedback_log (user_id, feedback_type, message, created_at) VALUES (?, ?, ?, ?)'
        ).bind(userId, body.type || 'general', body.message || '', now).run()
        return json({ ok: true })
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
        if (path === '/api/admin/maintenance' && req.method === 'GET') return handleMaintenanceGet(req, env)
        if (path === '/api/admin/maintenance' && req.method === 'POST') return handleMaintenanceSet(req, env)
        if (path === '/api/admin/backup' && req.method === 'POST') return handleAdminBackup(req, env)
        if (path === '/api/admin/backups' && req.method === 'GET') return handleAdminBackups(req, env)
        const backupFileMatch = path.match(/^\/api\/admin\/backups\/(.+)$/)
        if (backupFileMatch && req.method === 'GET') return handleAdminBackupFile(req, env, backupFileMatch[1])
        if (path === '/api/admin/restore' && req.method === 'POST') return handleAdminRestore(req, env)
        // Grant package credits
        const grantPkgMatch = path.match(/^\/api\/command\/users\/([^/]+)\/grant-package$/)
        if (grantPkgMatch && req.method === 'POST') {
          const targetUserId = grantPkgMatch[1]
          const adminPayload2 = await requireAuth(req, env)
          const adminEmail = adminPayload2?.email || adminPayload2?.['email_address'] || ''
          const now = Math.floor(Date.now() / 1000)
          const existing = await env.DB.prepare('SELECT package_credits FROM users_meta WHERE id = ?').bind(targetUserId).first()
          const currentCredits = existing?.package_credits || 0
          if (existing) {
            await env.DB.prepare('UPDATE users_meta SET package_credits = ?, total_submission_packages = total_submission_packages + 1 WHERE id = ?')
              .bind(currentCredits + 1, targetUserId).run()
          } else {
            await env.DB.prepare('INSERT INTO users_meta (id, package_credits, total_submission_packages, first_seen, last_active) VALUES (?, 1, 1, ?, ?)')
              .bind(targetUserId, now, now).run()
          }
          await env.DB.prepare('INSERT INTO admin_actions (action_type, entity, entity_id, new_value, admin_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?)')
            .bind('grant_package_credit', 'user', targetUserId, JSON.stringify({ credits_added: 1, new_total: currentCredits + 1 }), adminEmail, now).run()
          return json({ ok: true, package_credits: currentCredits + 1 })
        }
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
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runDailyBackup(env))
  },
}
