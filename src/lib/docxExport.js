import {
  Document, Paragraph, TextRun, Packer,
  AlignmentType, Footer, Header, PageNumber, PageBreak,
  BorderStyle, TabStopType,
} from 'docx'

const FONT = 'Georgia'
const BODY_PT = 22   // 11pt in half-points
const HEAD_PT = 24   // 12pt
const TITLE_PT = 36  // 18pt
const PI_PT = 28     // 14pt

// Convert body text (double-newline = paragraph, single = line break)
function textToParagraphs(text, size = BODY_PT, bold = false) {
  if (!text) return []
  return text
    .split(/\n\n+/)
    .map(p => p.trim())
    .filter(Boolean)
    .map(p => {
      const lines = p.split('\n')
      const children = []
      lines.forEach((line, i) => {
        if (i > 0) children.push(new TextRun({ break: 1 }))
        children.push(new TextRun({ text: line, font: FONT, size, bold }))
      })
      return new Paragraph({
        spacing: { before: 0, after: 120 }, // 6pt after
        children,
      })
    })
}

function sectionHeading(text) {
  return new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({ text, font: FONT, size: HEAD_PT, bold: true })],
  })
}

function subHeading(text) {
  return new Paragraph({
    spacing: { before: 200, after: 80 },
    children: [new TextRun({ text, font: FONT, size: BODY_PT, bold: true })],
  })
}

function pageBreakPara() {
  return new Paragraph({ children: [new PageBreak()] })
}

function emptyPara() {
  return new Paragraph({ spacing: { before: 0, after: 240 }, children: [] })
}

function hrPara() {
  return new Paragraph({
    spacing: { before: 240, after: 240 },
    border: { bottom: { color: '999999', size: 6, style: BorderStyle.SINGLE, space: 1 } },
    children: [],
  })
}

// Running header: title (left) | page number (right)
function makeRunningHeader(titleTruncated) {
  return new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9072 }],
        children: [
          new TextRun({ text: titleTruncated, font: FONT, size: 18, color: '555555' }),
          new TextRun({ text: '\t', font: FONT, size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '555555' }),
        ],
      }),
    ],
  })
}

// Footer: centered page number
function makeFooter() {
  return new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })],
      }),
    ],
  })
}

export async function generateGrantDOCX(project, sections, scores, citations) {
  const mech = project.mechanism || 'STTR-I'
  const isFastTrack = mech === 'FAST-TRACK'
  const isPhaseII = mech.includes('-II') || mech === 'NCI-IIB' || mech === 'FAST-TRACK'
  const needsCommercial = mech.includes('STTR') || mech.includes('SBIR')
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const setup = project.setup || {}

  const titleTruncated = (project.title || 'Untitled Grant').slice(0, 50) + ((project.title || '').length > 50 ? '…' : '')
  const runningHeader = makeRunningHeader(titleTruncated)
  const footer = makeFooter()

  // ── Cover Page (no header) ───────────────────────────────────────────────
  const coverChildren = []

  // Vertical space before title
  coverChildren.push(new Paragraph({ spacing: { before: 2880, after: 0 }, children: [] }))

  // Title — 18pt bold centered
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 360 },
    children: [new TextRun({ text: project.title || 'Untitled Grant', font: FONT, size: TITLE_PT, bold: true })],
  }))

  // Horizontal rule
  coverChildren.push(hrPara())

  // PI — 14pt
  if (setup.pi) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: `Principal Investigator: ${setup.pi}`, font: FONT, size: PI_PT })],
    }))
  }

  // Institution
  if (setup.partner) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: setup.partner, font: FONT, size: HEAD_PT })],
    }))
  }

  // Mechanism + Institute
  const mechLine = [mech, setup.institute].filter(Boolean).join(' · ')
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: mechLine, font: FONT, size: HEAD_PT })],
  }))

  // FOA number
  if (project.foa_number) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: project.foa_number, font: FONT, size: BODY_PT })],
    }))
  }

  // Date
  coverChildren.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 0 },
    children: [new TextRun({ text: today, font: FONT, size: 20, color: '777777' })],
  }))

  // Page break after cover
  coverChildren.push(pageBreakPara())

  // ── Content ──────────────────────────────────────────────────────────────
  const contentChildren = []

  // Project Summary
  if (sections.summary) {
    contentChildren.push(sectionHeading('PROJECT SUMMARY/ABSTRACT'))
    contentChildren.push(...textToParagraphs(sections.summary))
    contentChildren.push(emptyPara())
  }

  // Project Narrative
  if (sections.narrative) {
    contentChildren.push(sectionHeading('PROJECT NARRATIVE'))
    contentChildren.push(...textToParagraphs(sections.narrative))
    contentChildren.push(emptyPara())
  }

  // Specific Aims
  if (sections.aims) {
    contentChildren.push(sectionHeading('SPECIFIC AIMS'))
    contentChildren.push(...textToParagraphs(sections.aims))
    contentChildren.push(pageBreakPara())
  }

  // Research Strategy
  if (isFastTrack) {
    const ft1 = project.fast_track_phase1_sections || {}
    const ft2 = project.fast_track_phase2_sections || {}
    if (ft1.phase1_sig || ft1.phase1_innov || ft1.phase1_approach) {
      contentChildren.push(sectionHeading('RESEARCH STRATEGY — PHASE I'))
      if (ft1.phase1_sig) { contentChildren.push(subHeading('A. Significance')); contentChildren.push(...textToParagraphs(ft1.phase1_sig)) }
      if (ft1.phase1_innov) { contentChildren.push(subHeading('B. Innovation')); contentChildren.push(...textToParagraphs(ft1.phase1_innov)) }
      if (ft1.phase1_approach) { contentChildren.push(subHeading('C. Approach')); contentChildren.push(...textToParagraphs(ft1.phase1_approach)) }
      if (project.go_no_go_milestone) {
        contentChildren.push(subHeading('Go/No-Go Milestone'))
        contentChildren.push(...textToParagraphs(project.go_no_go_milestone))
      }
      contentChildren.push(pageBreakPara())
    }
    if (ft2.phase2_sig || ft2.phase2_innov || ft2.phase2_approach) {
      contentChildren.push(sectionHeading('RESEARCH STRATEGY — PHASE II'))
      if (ft2.phase2_sig) { contentChildren.push(subHeading('A. Significance')); contentChildren.push(...textToParagraphs(ft2.phase2_sig)) }
      if (ft2.phase2_innov) { contentChildren.push(subHeading('B. Innovation')); contentChildren.push(...textToParagraphs(ft2.phase2_innov)) }
      if (ft2.phase2_approach) { contentChildren.push(subHeading('C. Approach')); contentChildren.push(...textToParagraphs(ft2.phase2_approach)) }
      contentChildren.push(pageBreakPara())
    }
  } else if (sections.sig || sections.innov || sections.approach) {
    contentChildren.push(sectionHeading('RESEARCH STRATEGY'))
    if (sections.sig) { contentChildren.push(subHeading('A. Significance')); contentChildren.push(...textToParagraphs(sections.sig)) }
    if (sections.innov) { contentChildren.push(subHeading('B. Innovation')); contentChildren.push(...textToParagraphs(sections.innov)) }
    if (sections.approach) { contentChildren.push(subHeading('C. Approach')); contentChildren.push(...textToParagraphs(sections.approach)) }
    contentChildren.push(pageBreakPara())
  }

  // Commercialization
  if (needsCommercial && sections.commercial) {
    const label = isPhaseII ? 'COMMERCIALIZATION PLAN' : 'COMMERCIALIZATION POTENTIAL'
    contentChildren.push(sectionHeading(label))
    contentChildren.push(...textToParagraphs(sections.commercial))
    contentChildren.push(pageBreakPara())
  }

  // Data Management
  if (sections.data_mgmt) {
    contentChildren.push(sectionHeading('DATA MANAGEMENT AND SHARING PLAN'))
    contentChildren.push(...textToParagraphs(sections.data_mgmt))
    contentChildren.push(pageBreakPara())
  }

  // Facilities
  if (sections.facilities) {
    contentChildren.push(sectionHeading('FACILITIES AND RESOURCES'))
    contentChildren.push(...textToParagraphs(sections.facilities))
    contentChildren.push(emptyPara())
  }

  // Human Subjects
  if (sections.human_subjects) {
    contentChildren.push(sectionHeading('HUMAN SUBJECTS'))
    contentChildren.push(...textToParagraphs(sections.human_subjects))
    contentChildren.push(emptyPara())
  }

  // Vertebrate Animals
  if (sections.vert_animals) {
    contentChildren.push(sectionHeading('VERTEBRATE ANIMALS'))
    contentChildren.push(...textToParagraphs(sections.vert_animals))
    contentChildren.push(emptyPara())
  }

  // Select Agents
  if (sections.select_agents) {
    contentChildren.push(sectionHeading('SELECT AGENTS'))
    contentChildren.push(...textToParagraphs(sections.select_agents))
    contentChildren.push(emptyPara())
  }

  // Cover Letter
  if (sections.cover_letter) {
    contentChildren.push(sectionHeading('COVER LETTER'))
    contentChildren.push(...textToParagraphs(sections.cover_letter))
    contentChildren.push(emptyPara())
  }

  // Bibliography Appendix
  if (citations && citations.length > 0) {
    contentChildren.push(pageBreakPara())
    contentChildren.push(sectionHeading('REFERENCES'))
    citations.forEach((cite, i) => {
      const authors = cite.authors || 'Unknown Author'
      const year = cite.year || 'n.d.'
      const title = cite.title || 'Untitled'
      const journal = cite.journal || ''
      const volume = cite.volume || ''
      const issue = cite.issue ? `(${cite.issue})` : ''
      const pages = cite.pages || ''
      const pmid = cite.pmid ? ` PMID: ${cite.pmid}.` : ''
      const text = `${i + 1}. ${authors}. ${title}. ${journal}${journal && volume ? ' ' : ''}${volume}${issue}${pages ? ':' + pages : ''} (${year}).${pmid}`
      contentChildren.push(new Paragraph({
        spacing: { before: 0, after: 120 },
        children: [new TextRun({ text, font: FONT, size: BODY_PT })],
      }))
    })
  }

  const doc = new Document({
    sections: [
      // Cover page: no header, no footer
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
            size: { width: 12240, height: 15840 },
          },
        },
        children: coverChildren,
      },
      // Content: running header + page footer
      {
        properties: {
          page: {
            margin: { top: 720, right: 720, bottom: 720, left: 720 },
            size: { width: 12240, height: 15840 },
          },
        },
        headers: { default: runningHeader },
        footers: { default: footer },
        children: contentChildren,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
