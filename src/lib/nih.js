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
  'STTR-I':     {
    label: 'STTR Phase I (U43)',
    aims: 1,
    strategy: 6,
    commercial: 2, // Commercialization POTENTIAL not Plan
    needsCommercial: true,
    commercialType: 'potential', // vs 'plan'
    code: 'U43',
    phase: 'I',
    sttrPartnerMinimum: 0.40, // 40% work to research institution
    dataManagement: 2,
    introduction: 1 // resubmissions only
  },
  'STTR-II':    {
    label: 'STTR Phase II (U44)',
    aims: 1,
    strategy: 12,
    commercial: 12,
    needsCommercial: true,
    commercialType: 'plan',
    code: 'U44',
    phase: 'II',
    sttrPartnerMinimum: 0.30, // 30% work to research institution
    dataManagement: 2,
    introduction: 1
  },
  'SBIR-I':     {
    label: 'SBIR Phase I (R43)',
    aims: 1,
    strategy: 6,
    commercial: 2, // Commercialization POTENTIAL
    needsCommercial: true,
    commercialType: 'potential',
    code: 'R43',
    phase: 'I',
    dataManagement: 2,
    introduction: 1
  },
  'SBIR-II':    {
    label: 'SBIR Phase II (R44)',
    aims: 1,
    strategy: 12,
    commercial: 12,
    needsCommercial: true,
    commercialType: 'plan',
    code: 'R44',
    phase: 'II',
    dataManagement: 2,
    introduction: 1
  },
  'FAST-TRACK': {
    label: 'Fast Track (R41+R42)',
    aims: 1,
    strategyPhaseI: 6,  // Phase I research strategy separate
    strategyPhaseII: 12, // Phase II research strategy separate
    strategy: 18, // Combined for display only
    commercial: 12,
    needsCommercial: true,
    commercialType: 'plan',
    code: 'FAST-TRACK',
    phase: 'I+II',
    requiresGoNoGo: true,
    dataManagement: 2,
    introduction: 1
  },
  'NCI-IIB':    {
    label: 'NCI Phase IIB Bridge',
    aims: 1,
    strategy: 12,
    commercial: 12,
    needsCommercial: true,
    commercialType: 'plan',
    code: 'R44-BRIDGE',
    institute: 'NCI',
    budget: 'up to $4.5M total costs',
    phase: 'IIB',
    dataManagement: 2,
    introduction: 1
  },
  'R21':        {
    label: 'R21',
    aims: 1,
    strategy: 6,
    commercial: 0,
    needsCommercial: false,
    code: 'R21',
    dataManagement: 2,
    introduction: 1
  },
  'R01':        {
    label: 'R01',
    aims: 1,
    strategy: 12,
    commercial: 0,
    needsCommercial: false,
    code: 'R01',
    dataManagement: 2,
    introduction: 1
  },
  'K99':        {
    label: 'K99/R00',
    aims: 1,
    strategy: 12,
    commercial: 0,
    needsCommercial: false,
    code: 'K99',
    dataManagement: 2,
    introduction: 1
  },
}

export const SECTIONS = [
  { id: 'summary',       label: 'Project Summary',         pageLimit: null, partOfStrategy: false, lineLimit: 30 },
  { id: 'narrative',     label: 'Project Narrative',       pageLimit: null, partOfStrategy: false, sentenceLimit: 3 },
  { id: 'aims',          label: 'Specific Aims',           pageLimit: 'aims', partOfStrategy: false },
  { id: 'sig',           label: 'Significance',            pageLimit: 'strategy', partOfStrategy: true },
  { id: 'innov',         label: 'Innovation',              pageLimit: 'strategy', partOfStrategy: true },
  { id: 'approach',      label: 'Approach',                pageLimit: 'strategy', partOfStrategy: true },
  { id: 'data_mgmt',     label: 'Data Management Plan',    pageLimit: 'dataManagement', partOfStrategy: false },
  { id: 'facilities',    label: 'Facilities',              pageLimit: null, partOfStrategy: false },
  { id: 'commercial',    label: 'Commercialization',       pageLimit: 'commercial', partOfStrategy: false },
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

/**
 * Get project rules - FOA rules if valid, otherwise mechanism defaults
 * @param {Object} project - Project with foa_rules and mechanism
 * @returns {Object} Rules object with page limits
 */
export function getProjectRules(project) {
  // If project has valid FOA rules, use those
  if (project && project.foa_rules && project.foa_valid) {
    try {
      const foaRules = typeof project.foa_rules === 'string'
        ? JSON.parse(project.foa_rules)
        : project.foa_rules

      if (foaRules && foaRules.research_strategy_pages) {
        return foaRules
      }
    } catch (e) {
      console.error('Failed to parse FOA rules:', e)
    }
  }

  // Fall back to mechanism defaults
  const mechanism = project?.mechanism || 'STTR-I'
  const mech = MECHANISMS[mechanism]

  if (!mech) return null

  return {
    research_strategy_pages: mech.strategy || 6,
    commercialization_plan_pages: mech.commercial || 0,
    aims_pages: mech.aims || 1,
    data_management_pages: mech.dataManagement || 2,
    introduction_pages: mech.introduction || 1,
    commercialization_type: mech.commercialType || 'plan',
    phase: mech.phase,
    sttr_partner_minimum: mech.sttrPartnerMinimum,
    requires_go_no_go: mech.requiresGoNoGo || false,
    strategy_phase_i_pages: mech.strategyPhaseI,
    strategy_phase_ii_pages: mech.strategyPhaseII
  }
}

/**
 * Get commercial label based on phase
 * @param {string} mechanism - Mechanism key
 * @returns {string} Label for commercialization section
 */
export function getCommercialLabel(mechanism) {
  const mech = MECHANISMS[mechanism]
  if (!mech || !mech.needsCommercial) return null

  return mech.commercialType === 'potential'
    ? 'Commercialization Potential'
    : 'Commercialization Plan'
}
