export const WORDS_PER_PAGE = 275

// ═══════════════════════════════════════════════════════════════════════════
// NIH INSTITUTES — Budget Caps, Paylines, and Special Programs
// ═══════════════════════════════════════════════════════════════════════════

export const INSTITUTES = {
  'NCI': {
    name: 'National Cancer Institute',
    sttr_i_budget: '$400K total costs, up to 2 years',
    sttr_ii_budget: '$2M total costs, up to 3 years',
    sbir_i_budget: '$400K total costs, up to 2 years',
    sbir_ii_budget: '$2M total costs, up to 3 years',
    fast_track_budget: '$400K Phase I + $2M Phase II',
    payline_sttr: '~25th percentile',
    payline_sbir: '~27th percentile',
    payline_r01: '~15th percentile',
    payline_r21: '~20th percentile',
    special_programs: [
      'NCI does NOT participate in SB1 or CRP programs',
      'Phase IIB Bridge Awards available: up to $4.5M total costs for promising Phase II projects'
    ],
    priorities: 'Cancer prevention, early detection, treatment resistance, immunotherapy, precision oncology',
  },
  'NIGMS': {
    name: 'National Institute of General Medical Sciences',
    sttr_i_budget: '$275K total costs, up to 2 years',
    sttr_ii_budget: '$1.5M total costs, up to 2 years',
    sbir_i_budget: '$275K total costs, up to 2 years',
    sbir_ii_budget: '$1.5M total costs, up to 2 years',
    fast_track_budget: '$275K Phase I + $1.5M Phase II',
    payline_sttr: '~20th percentile',
    payline_sbir: '~20th percentile',
    payline_r01: '~18th percentile',
    payline_r21: '~22nd percentile',
    special_programs: [
      'NIGMS does not fund disease-specific research',
      'Focus on fundamental biological processes'
    ],
    priorities: 'Basic biomedical research, cell biology, biophysics, genetics, pharmacology, training',
  },
  'NHLBI': {
    name: 'National Heart, Lung, and Blood Institute',
    sttr_i_budget: '$300K total costs, up to 2 years',
    sttr_ii_budget: '$2M total costs, up to 3 years',
    sbir_i_budget: '$300K total costs, up to 2 years',
    sbir_ii_budget: '$2M total costs, up to 3 years',
    fast_track_budget: '$300K Phase I + $2M Phase II',
    payline_sttr: '~22nd percentile',
    payline_sbir: '~22nd percentile',
    payline_r01: '~12th percentile',
    payline_r21: '~18th percentile',
    special_programs: [
      'Strong emphasis on clinical translation',
      'TOPMed and other large-scale genomics initiatives'
    ],
    priorities: 'Cardiovascular disease, lung disease, blood disorders, sleep disorders, critical care',
  },
  'NICHD': {
    name: 'National Institute of Child Health and Human Development',
    sttr_i_budget: '$300K total costs, up to 2 years',
    sttr_ii_budget: '$2M total costs, up to 3 years',
    sbir_i_budget: '$300K total costs, up to 2 years',
    sbir_ii_budget: '$2M total costs, up to 3 years',
    fast_track_budget: '$300K Phase I + $2M Phase II',
    payline_sttr: '~25th percentile',
    payline_sbir: '~25th percentile',
    payline_r01: '~15th percentile',
    payline_r21: '~20th percentile',
    special_programs: [
      'Pediatric research emphasis',
      'Maternal and child health focus'
    ],
    priorities: 'Pregnancy, child development, reproductive health, intellectual disabilities, rehabilitation',
  },
  'NIA': {
    name: 'National Institute on Aging',
    sttr_i_budget: '$300K total costs, up to 2 years',
    sttr_ii_budget: '$2M total costs, up to 3 years',
    sbir_i_budget: '$300K total costs, up to 2 years',
    sbir_ii_budget: '$2M total costs, up to 3 years',
    fast_track_budget: '$300K Phase I + $2M Phase II',
    payline_sttr: '~20th percentile',
    payline_sbir: '~20th percentile',
    payline_r01: '~14th percentile',
    payline_r21: '~19th percentile',
    special_programs: [
      "Alzheimer's Disease research priority",
      'Geroscience and healthspan initiatives'
    ],
    priorities: "Aging biology, Alzheimer's and related dementias, geriatrics, longevity",
  },
}

// ═══════════════════════════════════════════════════════════════════════════
// NIH MECHANISMS
// ═══════════════════════════════════════════════════════════════════════════

export const MECHANISMS = {
  'STTR-I':     { label: 'STTR Phase I (R41)',     aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R41' },
  'STTR-II':    { label: 'STTR Phase II (R42)',    aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'R42' },
  'SBIR-I':     { label: 'SBIR Phase I (R43)',     aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R43' },
  'SBIR-II':    { label: 'SBIR Phase II (R44)',    aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'R44' },
  'FAST-TRACK': { label: 'Fast Track (R41+R42)',   aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'FAST-TRACK' },
  'NCI-IIB':    { label: 'NCI Phase IIB Bridge',   aims: 1, strategy: 12, commercial: 12, needsCommercial: true,  code: 'R44-BRIDGE', institute: 'NCI', budget: 'up to $4.5M total costs' },
  'R21':        { label: 'R21',                    aims: 1, strategy: 6,  commercial: 0,  needsCommercial: false, code: 'R21' },
  'R01':        { label: 'R01',                    aims: 1, strategy: 12, commercial: 0,  needsCommercial: false, code: 'R01' },
  'K99':        { label: 'K99/R00',                aims: 1, strategy: 12, commercial: 0,  needsCommercial: false, code: 'K99' },
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

export function getLimitsText(mechKey, instituteKey) {
  const m = MECHANISMS[mechKey]
  if (!m) return ''

  let s = `Font ≥11pt (Arial, Helvetica, Palatino Linotype, or Georgia) · Margins ≥0.5" all sides · No headers/footers · Single-column · Black text. `
  s += `Specific Aims = 1 page (~${WORDS_PER_PAGE} words) · Research Strategy = ${m.strategy} pages (~${m.strategy * WORDS_PER_PAGE} words)`
  if (m.needsCommercial) s += ` · Commercialization = ${m.commercial} pages`

  // Add institute-specific guidance
  if (instituteKey && INSTITUTES[instituteKey]) {
    const inst = INSTITUTES[instituteKey]
    s += ` || Institute: ${inst.name} `

    if (mechKey === 'STTR-I' && inst.sttr_i_budget) {
      s += `· Budget: ${inst.sttr_i_budget} · Payline: ${inst.payline_sttr}`
    } else if (mechKey === 'STTR-II' && inst.sttr_ii_budget) {
      s += `· Budget: ${inst.sttr_ii_budget} · Payline: ${inst.payline_sttr}`
    } else if (mechKey === 'SBIR-I' && inst.sbir_i_budget) {
      s += `· Budget: ${inst.sbir_i_budget} · Payline: ${inst.payline_sbir}`
    } else if (mechKey === 'SBIR-II' && inst.sbir_ii_budget) {
      s += `· Budget: ${inst.sbir_ii_budget} · Payline: ${inst.payline_sbir}`
    } else if (mechKey === 'FAST-TRACK' && inst.fast_track_budget) {
      s += `· Budget: ${inst.fast_track_budget} · Payline: ${inst.payline_sbir}`
    } else if (mechKey === 'R01') {
      s += `· Payline: ${inst.payline_r01}`
    } else if (mechKey === 'R21') {
      s += `· Payline: ${inst.payline_r21}`
    }
  }

  return s
}
