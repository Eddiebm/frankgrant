import { MECHANISMS } from './nih.js'

export const WRITE_SYSTEM = `You are an expert NIH grant writer with 20+ years writing funded R01, R21, STTR, and SBIR applications across NCI, NIGMS, and NHLBI. Write compelling, rigorous, reviewer-ready grant text. Be specific — avoid vague generalities. Use active voice. Structure with subsections where appropriate. Do not include meta-commentary — just write the section.`

export const SCORE_SYSTEM = `You are an expert NIH grant reviewer with 20+ years of experience on study sections across NCI, NIGMS, NHLBI, and NICHD. Score the provided grant section on the NIH 1-9 scale (1=best). Return ONLY valid JSON — no prose outside the JSON:
{"criterion":"Significance","score":2,"descriptor":"Outstanding","strengths":["..."],"weaknesses":["..."],"narrative":"2-3 sentence reviewer note. Be specific and candid."}`

export const FULL_SCORE_SYSTEM = `You are an expert NIH grant reviewer with 20+ years on study sections. Score this complete grant application using NIH criteria. Criterion weights: Significance 20%, Innovation 15%, Approach 40%, Investigators 15%, Environment 10%. Return ONLY valid JSON:
{
  "mechanism": "R21",
  "scores": {
    "significance": {"score":2,"rationale":"..."},
    "innovation":   {"score":3,"rationale":"..."},
    "approach":     {"score":2,"rationale":"..."},
    "investigators":{"score":3,"rationale":"..."},
    "environment":  {"score":4,"rationale":"..."}
  },
  "overall_impact": 2.4,
  "descriptor": "Outstanding",
  "fatal_flaws": [],
  "strengths": ["..."],
  "weaknesses": ["..."],
  "priority_revisions": ["..."],
  "reviewer_narrative": "3-5 paragraph narrative in the voice of a senior study section reviewer. Reference specific text. Be candid and actionable."
}`

export function writeSectionPrompt(secId, project, mechKey) {
  const m = MECHANISMS[mechKey] || MECHANISMS['STTR-I']
  const p = project
  const phaseNote = mechKey.startsWith('STTR') || mechKey.startsWith('SBIR')
    ? `Small business: ${p.pi}. Academic partner: ${p.partner}.`
    : ''
  const aimCount = mechKey === 'R21' || mechKey === 'STTR-I' || mechKey === 'SBIR-I' ? 2 : 3

  const prompts = {
    aims: `Write a compelling NIH Specific Aims page. HARD LIMIT: 1 page (~275 words). Mechanism: ${m.label}. ${phaseNote}
Title: ${p.title}
Disease/indication: ${p.disease}
Scientific premise: ${p.biology}
Aims outline: ${p.aims}
PA/RFA: ${p.pa || 'not specified'}

Structure: (1) Bold opening hook on the unmet need, (2) define the knowledge gap, (3) state overall objective and central hypothesis, (4) present ${aimCount} specific aims with brief rationale and expected outcomes each, (5) closing statement on innovation, impact, and team qualifications. No section headers. Maximum 275 words.`,

    sig: `Write the Significance section for a ${m.label} NIH application. Target ~${Math.round(m.strategy * 0.25 * 275)} words (25% of the ${m.strategy}-page research strategy). ${phaseNote}
Title: ${p.title} | Disease: ${p.disease} | Biology: ${p.biology}
Subsections required: "Public health significance" (quantify burden with epidemiologic data), "Current limitations and knowledge gap" (define precisely), "How this project addresses the gap". Be specific.`,

    innov: `Write the Innovation section for a ${m.label} NIH application. Target ~${Math.round(m.strategy * 0.15 * 275)} words (15% of the ${m.strategy}-page research strategy). ${phaseNote}
Title: ${p.title} | Biology: ${p.biology} | Aims: ${p.aims}
Describe what is genuinely novel — conceptually, technically, clinically. Challenge or shift existing paradigms. Distinguish from prior approaches. Do not overstate. Subsections allowed.`,

    approach: `Write the Approach section for a ${m.label} NIH application. Target ~${Math.round(m.strategy * 0.60 * 275)} words (60% of the ${m.strategy}-page research strategy). ${phaseNote}
Title: ${p.title} | Disease: ${p.disease} | Biology: ${p.biology} | Aims: ${p.aims}
For EACH aim: (a) rationale, (b) methods and experimental design, (c) expected outcomes and interpretation, (d) potential pitfalls and alternative approaches, (e) timeline. Include: rigor and reproducibility, sex as a biological variable (SABV). ${mechKey === 'R21' || mechKey === 'STTR-I' || mechKey === 'SBIR-I' ? 'Frame as a feasibility study.' : ''} ${mechKey.startsWith('STTR') ? 'Note small business vs. academic partner roles per aim.' : ''}`,

    facilities: `Write the Facilities & Resources section for a ${m.label} NIH application. Target ~350 words (no page limit — keep concise).
PI/Org: ${p.pi} | Partner: ${p.partner} | Disease: ${p.disease}
Describe: laboratory space, major equipment, core facilities, clinical or patient access resources, computing and bioinformatics infrastructure. ${mechKey.startsWith('STTR') || mechKey.startsWith('SBIR') ? 'Describe small business site and academic partner site in separate subsections.' : ''}`,

    commercial: `Write the Commercialization Plan for a ${m.label} NIH application. LIMIT: 12 pages (~3,300 words). Target 1,200-1,500 words for this section.
Title: ${p.title} | Disease: ${p.disease} | Org: ${p.pi} | Commercial context: ${p.commercial} | Budget: ${p.budget || 'not specified'}
Required subsections: (1) Unmet commercial need and market opportunity (include market size estimates), (2) Competitive landscape and differentiation, (3) Intellectual property and freedom-to-operate, (4) FDA regulatory pathway, (5) Phase II and Phase III development milestones, (6) Revenue model and business strategy, (7) Partnering, licensing, or acquisition strategy. Be specific and credible.`,
  }

  return prompts[secId] || `Write the ${secId} section for this NIH ${m.label} application. Title: ${p.title}`
}
