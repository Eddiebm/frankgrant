// ═══════════════════════════════════════════════════════════════════════════
// Grant Compression and Summarization for Token Efficiency
// ═══════════════════════════════════════════════════════════════════════════

const COMPRESS_GRANT_SYSTEM = `You are a technical summarizer. Your task is to compress a full NIH grant application into a structured 1,500-word summary that preserves all critical scientific content, aims, methods, and innovation while removing redundancy and verbosity.

Output structure:
1. Title and Mechanism (1 line)
2. Overall Objective (2-3 sentences)
3. Specific Aims (100 words per aim, preserving hypotheses and expected outcomes)
4. Significance Summary (200 words - key gap, impact)
5. Innovation Summary (150 words - what's novel)
6. Approach Summary (500 words - key methods, timeline, analysis plan)
7. Preliminary Data (200 words if present)
8. Team and Environment (100 words)
9. Commercialization (150 words if SBIR/STTR)

Target: 1,500 words exactly. Preserve scientific accuracy. Remove prose filler.`

const SECTION_SUMMARY_SYSTEM = `You are a technical summarizer. Compress this grant section into exactly 200 words preserving all key scientific content, methods, and conclusions. Remove rhetorical filler and redundancy. Output only the summary, no meta-commentary.`

export function compressGrantPrompt(fullGrantText) {
  return `Compress this NIH grant application into a structured 1,500-word summary following the format specified in the system prompt.

FULL GRANT:
${fullGrantText.slice(0, 30000)}

Return only the compressed summary, no meta-commentary.`
}

export function sectionSummaryPrompt(sectionLabel, sectionText) {
  return `Summarize this ${sectionLabel} section in exactly 200 words.

SECTION TEXT:
${sectionText.slice(0, 4000)}

Return only the 200-word summary, no meta-commentary.`
}

export async function compressGrant(fullGrantText, apiCallFn) {
  const result = await apiCallFn({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    system: COMPRESS_GRANT_SYSTEM,
    messages: [{ role: 'user', content: compressGrantPrompt(fullGrantText) }]
  }, 'compress_grant')

  return result.content[0].text
}

export async function createSectionSummary(sectionLabel, sectionText, apiCallFn) {
  if (!sectionText || sectionText.length < 100) return ''

  const result = await apiCallFn({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: SECTION_SUMMARY_SYSTEM,
    messages: [{ role: 'user', content: sectionSummaryPrompt(sectionLabel, sectionText) }]
  }, 'section_summary')

  return result.content[0].text
}

// Local computation functions - no AI needed
export function countWords(text) {
  if (!text) return 0
  return text.trim().split(/\s+/).filter(w => w.length > 0).length
}

export function estimatePages(wordCount, wordsPerPage = 275) {
  return wordCount / wordsPerPage
}

export function checkSectionPresence(sections, requiredSections) {
  const results = {}
  for (const sec of requiredSections) {
    results[sec] = !!(sections[sec] && sections[sec].length > 50)
  }
  return results
}

export function estimateReadingLevel(text) {
  if (!text || text.length < 100) return 'N/A'

  const words = text.split(/\s+/).filter(w => w.length > 0)
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0)
  const syllables = words.reduce((sum, word) => sum + countSyllables(word), 0)

  if (sentences.length === 0 || words.length === 0) return 'N/A'

  // Flesch-Kincaid Grade Level
  const gradeLevel = 0.39 * (words.length / sentences.length) + 11.8 * (syllables / words.length) - 15.59

  if (gradeLevel < 6) return 'Elementary'
  if (gradeLevel < 9) return 'Middle School'
  if (gradeLevel < 13) return 'High School'
  if (gradeLevel < 16) return 'College'
  return 'Graduate/Professional'
}

function countSyllables(word) {
  word = word.toLowerCase()
  if (word.length <= 3) return 1
  word = word.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
  word = word.replace(/^y/, '')
  const matches = word.match(/[aeiouy]{1,2}/g)
  return matches ? matches.length : 1
}

export function extractKeywords(text, topN = 10) {
  if (!text) return []

  // Remove common words
  const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'should', 'could', 'may', 'might', 'must', 'can', 'this', 'that', 'these', 'those', 'we', 'us', 'our', 'they', 'them', 'their', 'it', 'its'])

  const words = text.toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !stopWords.has(w))

  const freq = {}
  for (const word of words) {
    freq[word] = (freq[word] || 0) + 1
  }

  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([word, count]) => ({ word, count }))
}

export function calculateComplianceScore(project, mechanism) {
  let totalChecks = 0
  let passedChecks = 0

  // Check required sections
  const requiredSections = ['aims', 'sig', 'innov', 'approach']
  for (const sec of requiredSections) {
    totalChecks++
    if (project.sections?.[sec] && project.sections[sec].length > 100) {
      passedChecks++
    }
  }

  // Check page limits
  const aimsWords = countWords(project.sections?.aims || '')
  totalChecks++
  if (aimsWords > 0 && aimsWords <= 300) passedChecks++

  // Check commercialization if needed
  if (mechanism?.needsCommercial) {
    totalChecks++
    if (project.sections?.commercial && project.sections.commercial.length > 500) {
      passedChecks++
    }
  }

  return Math.round((passedChecks / totalChecks) * 100)
}
