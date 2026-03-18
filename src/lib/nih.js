export const WORDS_PER_PAGE = 275

export const MECHANISMS = {
  'STTR-I':  { label: 'STTR Phase I (R41)',  aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R41' },
  'STTR-II': { label: 'STTR Phase II (R42)', aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'R42' },
  'SBIR-I':  { label: 'SBIR Phase I (R43)',  aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R43' },
  'SBIR-II': { label: 'SBIR Phase II (R44)', aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'R44' },
  'R21':     { label: 'R21',                 aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R21' },
  'R01':     { label: 'R01',                 aims: 1, strategy: 12, commercial: 0,  needsCommercial: false, code: 'R01' },
  'K99':     { label: 'K99/R00',             aims: 1, strategy: 12, commercial: 0,  needsCommercial: false, code: 'K99' },
}

export const SECTIONS = [
  { id: 'aims',       label: 'Specific aims',    pageLimit: 'aims',       partOfStrategy: false },
  { id: 'sig',        label: 'Significance',     pageLimit: 'strategy',   partOfStrategy: true  },
  { id: 'innov',      label: 'Innovation',       pageLimit: 'strategy',   partOfStrategy: true  },
  { id: 'approach',   label: 'Approach',         pageLimit: 'strategy',   partOfStrategy: true  },
  { id: 'facilities', label: 'Facilities',       pageLimit: null,         partOfStrategy: false },
  { id: 'commercial', label: 'Commercialization',pageLimit: 'commercial', partOfStrategy: false },
]

export const NIH_FONTS = ['Arial', 'Helvetica', 'Palatino Linotype', 'Georgia']
export const NIH_MIN_FONT_PT = 11
export const NIH_MIN_MARGIN_IN = 0.5

export const SCORE_DESCRIPTORS = {
  1: 'Exceptional', 2: 'Outstanding', 3: 'Excellent',
  4: 'Very Good',   5: 'Good',        6: 'Satisfactory',
  7: 'Fair',        8: 'Marginal',    9: 'Poor',
}

export function getDescriptor(score) {
  return SCORE_DESCRIPTORS[Math.round(score)] || 'Good'
}

export function countWords(text) {
  return (text || '').trim().split(/\s+/).filter(w => w.length > 0).length
}

export function wordsToPages(words) {
  return words / WORDS_PER_PAGE
}

export function getLimitsText(mechKey) {
  const m = MECHANISMS[mechKey]
  if (!m) return ''
  let s = `Font ≥11pt (Arial, Helvetica, Palatino Linotype, or Georgia) · Margins ≥0.5" all sides · No headers/footers · Single-column · Black text. `
  s += `Specific Aims = 1 page (~${WORDS_PER_PAGE} words) · Research Strategy = ${m.strategy} pages (~${m.strategy * WORDS_PER_PAGE} words)`
  if (m.needsCommercial) s += ` · Commercialization = ${m.commercial} pages`
  return s
}
