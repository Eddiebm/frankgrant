import {
  Document, Paragraph, TextRun, Packer,
  AlignmentType, Footer, PageNumber, PageBreak,
} from 'docx'

const FONT = 'Georgia'
const BODY_PT = 22   // 11pt in half-points
const HEAD_PT = 24   // 12pt
const TITLE_PT = 32  // 16pt
const PI_PT = 24     // 12pt

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

export async function generateGrantDOCX(project, sections, scores) {
  const mech = project.mechanism || 'STTR-I'
  const isPhaseII = mech.includes('-II') || mech === 'NCI-IIB' || mech === 'FAST-TRACK'
  const needsCommercial = mech.includes('STTR') || mech.includes('SBIR')
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  const setup = project.setup || {}

  const footerPara = new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 20 })],
  })

  const children = []

  // ── Title Page ──────────────────────────────────────────────────────────
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 2880, after: 360 },
    children: [new TextRun({ text: project.title || 'Untitled Grant', font: FONT, size: TITLE_PT, bold: true })],
  }))
  if (setup.pi) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 120 },
      children: [new TextRun({ text: setup.pi, font: FONT, size: PI_PT })],
    }))
  }
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: `${mech}${setup.pa ? ' · ' + setup.pa : ''}`, font: FONT, size: PI_PT })],
  }))
  children.push(new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 120 },
    children: [new TextRun({ text: today, font: FONT, size: BODY_PT })],
  }))
  children.push(pageBreakPara())

  // ── Project Summary ─────────────────────────────────────────────────────
  if (sections.summary) {
    children.push(sectionHeading('PROJECT SUMMARY/ABSTRACT'))
    children.push(...textToParagraphs(sections.summary))
    children.push(new Paragraph({ spacing: { before: 0, after: 240 }, children: [] }))
  }

  // ── Project Narrative ───────────────────────────────────────────────────
  if (sections.narrative) {
    children.push(sectionHeading('PROJECT NARRATIVE'))
    children.push(...textToParagraphs(sections.narrative))
    children.push(new Paragraph({ spacing: { before: 0, after: 240 }, children: [] }))
  }

  // ── Specific Aims (page break after) ───────────────────────────────────
  if (sections.aims) {
    children.push(sectionHeading('SPECIFIC AIMS'))
    children.push(...textToParagraphs(sections.aims))
    children.push(pageBreakPara())
  }

  // ── Research Strategy (page break after) ───────────────────────────────
  if (sections.sig || sections.innov || sections.approach) {
    children.push(sectionHeading('RESEARCH STRATEGY'))
    if (sections.sig) {
      children.push(subHeading('A. Significance'))
      children.push(...textToParagraphs(sections.sig))
    }
    if (sections.innov) {
      children.push(subHeading('B. Innovation'))
      children.push(...textToParagraphs(sections.innov))
    }
    if (sections.approach) {
      children.push(subHeading('C. Approach'))
      children.push(...textToParagraphs(sections.approach))
    }
    children.push(pageBreakPara())
  }

  // ── Commercialization (page break after) ───────────────────────────────
  if (needsCommercial && sections.commercial) {
    const label = isPhaseII ? 'COMMERCIALIZATION PLAN' : 'COMMERCIALIZATION POTENTIAL'
    children.push(sectionHeading(label))
    children.push(...textToParagraphs(sections.commercial))
    children.push(pageBreakPara())
  }

  // ── Data Management (page break after) ─────────────────────────────────
  if (sections.data_mgmt) {
    children.push(sectionHeading('DATA MANAGEMENT AND SHARING PLAN'))
    children.push(...textToParagraphs(sections.data_mgmt))
    children.push(pageBreakPara())
  }

  // ── Facilities ──────────────────────────────────────────────────────────
  if (sections.facilities) {
    children.push(sectionHeading('FACILITIES AND RESOURCES'))
    children.push(...textToParagraphs(sections.facilities))
  }

  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
          size: { width: 12240, height: 15840 }, // US Letter
        },
      },
      footers: { default: new Footer({ children: [footerPara] }) },
      children,
    }],
  })

  return Packer.toBuffer(doc)
}
