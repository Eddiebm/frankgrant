/**
 * FOA Parser — extracts structured rules from NIH Funding Opportunity Announcements
 */

/**
 * Convert HTML tables to pipe-delimited text, strip all other tags,
 * extract sections II-V, cap each at 8000 chars.
 * Returns { award_info, eligibility, submission, review }
 */
export function extractFOASections(html) {
  // Convert tables to pipe-delimited text first
  let text = html
    .replace(/<table[^>]*>/gi, '\n[TABLE]\n')
    .replace(/<\/table>/gi, '\n[/TABLE]\n')
    .replace(/<tr[^>]*>/gi, '\n')
    .replace(/<\/tr>/gi, '')
    .replace(/<t[hd][^>]*>/gi, ' | ')
    .replace(/<\/t[hd]>/gi, '')

  // Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ')

  // Decode common HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')

  // Collapse whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  // Section header patterns used in NIH FOAs
  const sectionPatterns = {
    award_info: /(?:section\s+ii\.?\s*award\s+information|part\s+2[:\s]+award\s+information|ii\.\s+award\s+information)/i,
    eligibility: /(?:section\s+iii\.?\s*eligibility|part\s+3[:\s]+eligibility|iii\.\s+eligibility)/i,
    submission: /(?:section\s+iv\.?\s*application|part\s+4[:\s]+application|iv\.\s+application\s+and\s+submission)/i,
    review: /(?:section\s+v\.?\s*application\s+review|part\s+5[:\s]+application\s+review|v\.\s+application\s+review)/i,
  }

  function extractSection(text, startPattern, endPatterns) {
    const startMatch = text.search(startPattern)
    if (startMatch === -1) return ''

    let endIdx = text.length
    for (const endPat of endPatterns) {
      const m = text.slice(startMatch + 10).search(endPat)
      if (m !== -1 && (startMatch + 10 + m) < endIdx) {
        endIdx = startMatch + 10 + m
      }
    }

    return text.slice(startMatch, endIdx).trim()
  }

  const sectionOrder = ['award_info', 'eligibility', 'submission', 'review']
  const sections = {}

  for (let i = 0; i < sectionOrder.length; i++) {
    const key = sectionOrder[i]
    const nextPatterns = sectionOrder.slice(i + 1).map(k => sectionPatterns[k])
    const nextWithExtra = [
      ...nextPatterns,
      /section\s+vi\./i,
      /part\s+6/i,
      /vi\.\s+award\s+administration/i,
    ]
    let extracted = extractSection(text, sectionPatterns[key], nextWithExtra)
    if (!extracted) {
      // Fallback: look for any mention of the key topics
      if (key === 'award_info') extracted = text.slice(0, 8000)
      else extracted = ''
    }
    sections[key] = extracted.slice(0, 8000)
  }

  return {
    award_info: sections.award_info || '',
    eligibility: sections.eligibility || '',
    submission: sections.submission || '',
    review: sections.review || '',
  }
}

/**
 * Haiku prompt for structured FOA data extraction
 */
export const FOA_EXTRACTION_PROMPT = `You are an NIH grant expert. Extract structured information from this Funding Opportunity Announcement (FOA) text.

Return ONLY valid JSON with exactly these fields (use null for missing values):
{
  "foa_number": "string (e.g. PA-24-185 or RFA-CA-24-001)",
  "title": "string (full FOA title)",
  "mechanism": "string (e.g. STTR Phase I, SBIR Phase II, R01)",
  "activity_codes": ["array of strings, e.g. U43, R43, R01"],
  "phase": "string (I, II, I+II, or null)",
  "budget_direct_costs": "number in dollars or null (e.g. 300000)",
  "budget_total_costs": "number in dollars or null (e.g. 400000)",
  "budget_notes": "string with any budget caveats or null",
  "duration_months": "number or null (e.g. 24)",
  "research_strategy_pages": "number (e.g. 6 or 12)",
  "commercialization_plan_pages": "number or null",
  "other_page_limits": "string describing other limits or null",
  "due_dates": ["array of strings (e.g. 2024-06-05)"],
  "letter_of_intent_date": "string or null",
  "eligible_organizations": ["array of strings"],
  "sttr_partner_required": "boolean",
  "sttr_partner_minimum_percent": "number or null (e.g. 40)",
  "review_criteria": ["array of strings"],
  "program_priorities": ["array of strings, max 5 most important"],
  "special_requirements": "string of any special requirements or null",
  "resubmission_allowed": "boolean or null",
  "study_section": "string or null",
  "institute": "string abbreviation (NCI, NIGMS, NHLBI, etc.) or null",
  "is_omnibus": "boolean (true if this is a parent/omnibus announcement)",
  "contacts": [{"name": "string", "email": "string", "role": "string"}]
}

IMPORTANT: Return ONLY the JSON object, no markdown, no explanation.`

/**
 * Validate extracted FOA rules for SBIR/STTR compliance
 * Returns { valid, errors, rules }
 */
export function validateFOARules(rules) {
  const errors = []

  if (!rules) {
    return { valid: false, errors: ['No rules extracted'], rules: null }
  }

  // Check activity codes
  if (!rules.activity_codes || !Array.isArray(rules.activity_codes) || rules.activity_codes.length === 0) {
    errors.push('No activity codes found')
  }

  // Check research strategy pages — SBIR/STTR should be 6 or 12
  const isSBIRSTTR = rules.activity_codes?.some(c =>
    ['R43', 'R44', 'U43', 'U44', 'R41', 'R42'].includes(c)
  )

  if (isSBIRSTTR) {
    const pages = rules.research_strategy_pages
    if (pages !== 6 && pages !== 12 && pages !== null) {
      errors.push(`Unusual research strategy page limit: ${pages} (expected 6 or 12 for SBIR/STTR)`)
    }

    // Phase I budget check
    if (rules.phase === 'I' || rules.activity_codes?.some(c => ['R43', 'U43', 'R41'].includes(c))) {
      const budget = rules.budget_total_costs || rules.budget_direct_costs
      if (budget && budget > 500000) {
        errors.push(`Phase I total costs $${budget.toLocaleString()} exceeds typical $400-500K limit`)
      }
    }
  }

  // Check if FOA number looks valid
  if (!rules.foa_number) {
    errors.push('FOA number not found')
  }

  return {
    valid: errors.length === 0,
    errors,
    rules,
  }
}
