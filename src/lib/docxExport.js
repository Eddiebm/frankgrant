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
  const isD2P2 = mech === 'D2P2'
  const isPhaseII = mech.includes('-II') || mech === 'NCI-IIB' || mech === 'FAST-TRACK' || isD2P2
  const needsCommercial = mech.includes('STTR') || mech.includes('SBIR') || isD2P2
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

  // D2P2 special note
  if (isD2P2) {
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 240, after: 0 },
      children: [new TextRun({ text: 'NCI Direct to Phase 2 (D2P2) Application', font: FONT, size: BODY_PT, bold: true, color: '1e40af' })],
    }))
    coverChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 60, after: 0 },
      children: [new TextRun({ text: 'Applicant has completed Phase I equivalent research without federal SBIR/STTR funding', font: FONT, size: 20, color: '3730a3' })],
    }))
  }

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

  // D2P2 Phase I Equivalency Documentation (before Research Strategy)
  if (isD2P2 && sections.phase1_equivalency) {
    contentChildren.push(sectionHeading('PHASE I EQUIVALENCY DOCUMENTATION'))
    contentChildren.push(...textToParagraphs(sections.phase1_equivalency))
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

  // Ownership Disclaimer (always last, before bibliography)
  contentChildren.push(pageBreakPara())
  contentChildren.push(new Paragraph({
    spacing: { before: 240, after: 120 },
    children: [new TextRun({
      text: `This document was prepared by FrankGrant Grant Writing Services based on scientific information provided by the applicant. ${setup.pi || 'The Principal Investigator'} and ${setup.partner || 'the Institution'} own all scientific content, preliminary data, research hypotheses, and intellectual property contained herein. FrankGrant makes no representation regarding the accuracy of scientific claims. The applicant is solely responsible for verifying all content before submission to NIH.`,
      font: FONT, size: 18, italics: true, color: '555555',
    })],
  }))

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

  // Submission Checklist (last page of combined doc)
  const isSTTR = mech.includes('STTR')
  const isSBIR = mech.includes('SBIR') || isSTTR
  const isPhase2 = isPhaseII
  const piName = setup.pi || 'Principal Investigator'
  const institution = setup.partner || 'Institution'

  contentChildren.push(pageBreakPara())
  contentChildren.push(new Paragraph({ spacing: { before: 0, after: 240 }, children: [new TextRun({ text: 'SUBMISSION CHECKLIST', font: FONT, size: HEAD_PT, bold: true })] }))
  contentChildren.push(new Paragraph({ spacing: { before: 0, after: 200 }, children: [new TextRun({ text: `Ownership: Scientific content, preliminary data, research hypotheses, and intellectual property are owned by ${piName} and ${institution}. This document was prepared by FrankGrant Grant Writing Services.`, font: FONT, size: 18, italics: true, color: '0e7490' })] }))
  const clItem = (sym, text) => new Paragraph({ spacing: { before: 40, after: 40 }, children: [new TextRun({ text: `${sym}  ${text}`, font: FONT, size: BODY_PT })] })
  contentChildren.push(sectionHeading('FrankGrant Prepared'))
  ;['Specific Aims', 'Significance', 'Innovation', 'Approach', ...(isSBIR ? [isPhase2 ? 'Commercialization Plan' : 'Commercialization Potential'] : []), 'Data Management and Sharing Plan', 'Facilities and Resources'].forEach(s => contentChildren.push(clItem('✅', s)))
  contentChildren.push(sectionHeading('Your Scientific Documents — Required'))
  ;['Biosketches for all key personnel (5 pages each, NIH SF424 format)', 'Bibliography and References (verify all citations are accurate)', 'Authentication of Key Biological Resources', ...(setup.human_subjects_involved ? ['Human Subjects section (IRB approval required)'] : []), ...(setup.vert_animals_involved ? ['Vertebrate Animals section (IACUC approval required)'] : [])].forEach(s => contentChildren.push(clItem('☐', s)))
  contentChildren.push(sectionHeading('Letters Required'))
  ;['Collaborator support letters', 'Consultant letters', 'Key Personnel commitment letters', ...(isSTTR ? ['STTR Research Institution Partner letter'] : [])].forEach(s => contentChildren.push(clItem('☐', s)))
  contentChildren.push(sectionHeading('Administrative Requirements'))
  ;['SF424 forms completed in NIH ASSIST', 'Budget and Budget Justification', 'Project Summary/Abstract', 'Institutional signing official approval', 'SAM.gov registration current', 'eRA Commons accounts active', 'DUNS/UEI number registered'].forEach(s => contentChildren.push(clItem('☐', s)))

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
