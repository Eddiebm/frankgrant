import JSZip from 'jszip'
import {
  Document, Paragraph, TextRun, Packer,
  AlignmentType, Footer, PageNumber, Header,
  TabStopType,
} from 'docx'

const FONT = 'Georgia'
const BODY_PT = 22
const HEAD_PT = 24

function textToParagraphs(text, size = BODY_PT) {
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
        children.push(new TextRun({ text: line, font: FONT, size }))
      })
      return new Paragraph({ spacing: { before: 0, after: 120 }, children })
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

function makeHeader(title) {
  return new Header({
    children: [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: 9072 }],
        children: [
          new TextRun({ text: (title || '').slice(0, 50), font: FONT, size: 18, color: '555555' }),
          new TextRun({ text: '\t', font: FONT, size: 18 }),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18, color: '555555' }),
        ],
      }),
    ],
  })
}

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

async function makeSingleDoc(title, headingText, children) {
  const doc = new Document({
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
          size: { width: 12240, height: 15840 },
        },
      },
      headers: { default: makeHeader(title) },
      footers: { default: makeFooter() },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 240 },
          children: [new TextRun({ text: headingText, font: FONT, size: HEAD_PT, bold: true })],
        }),
        ...children,
      ],
    }],
  })
  return Packer.toBuffer(doc)
}

export async function generateSubmissionPackage(project, sections, citations) {
  const zip = new JSZip()
  const title = project.title || 'Untitled Grant'
  const mech = project.mechanism || 'STTR-I'
  const isFastTrack = mech === 'FAST-TRACK'
  const isD2P2 = mech === 'D2P2'
  const isPhaseII = mech.includes('-II') || mech === 'NCI-IIB' || mech === 'FAST-TRACK' || isD2P2
  const needsCommercial = mech.includes('STTR') || mech.includes('SBIR') || isD2P2
  const setup = project.setup || {}

  // Helper to add a doc if content exists
  async function addDoc(filename, heading, paragraphs) {
    if (!paragraphs || paragraphs.length === 0) return
    const buf = await makeSingleDoc(title, heading, paragraphs)
    zip.file(filename, buf)
  }

  // 0. D2P2 Phase I Equivalency Documentation (first, if D2P2)
  if (isD2P2 && sections.phase1_equivalency) {
    await addDoc('phase1_equivalency.docx', 'PHASE I EQUIVALENCY DOCUMENTATION', textToParagraphs(sections.phase1_equivalency))
  }

  // 1. Specific Aims
  if (sections.aims) {
    await addDoc('specific_aims.docx', 'SPECIFIC AIMS', textToParagraphs(sections.aims))
  }

  // 2. Research Strategy
  if (isFastTrack) {
    const ft1 = project.fast_track_phase1_sections || {}
    const ft2 = project.fast_track_phase2_sections || {}

    // Phase I
    const p1children = []
    if (ft1.phase1_sig) { p1children.push(subHeading('A. Significance')); p1children.push(...textToParagraphs(ft1.phase1_sig)) }
    if (ft1.phase1_innov) { p1children.push(subHeading('B. Innovation')); p1children.push(...textToParagraphs(ft1.phase1_innov)) }
    if (ft1.phase1_approach) { p1children.push(subHeading('C. Approach')); p1children.push(...textToParagraphs(ft1.phase1_approach)) }
    if (project.go_no_go_milestone) {
      p1children.push(subHeading('Go/No-Go Milestone'))
      p1children.push(...textToParagraphs(project.go_no_go_milestone))
    }
    if (p1children.length > 0) {
      await addDoc('phase1_research_strategy.docx', 'RESEARCH STRATEGY — PHASE I', p1children)
    }

    // Phase II
    const p2children = []
    if (ft2.phase2_sig) { p2children.push(subHeading('A. Significance')); p2children.push(...textToParagraphs(ft2.phase2_sig)) }
    if (ft2.phase2_innov) { p2children.push(subHeading('B. Innovation')); p2children.push(...textToParagraphs(ft2.phase2_innov)) }
    if (ft2.phase2_approach) { p2children.push(subHeading('C. Approach')); p2children.push(...textToParagraphs(ft2.phase2_approach)) }
    if (p2children.length > 0) {
      await addDoc('phase2_research_strategy.docx', 'RESEARCH STRATEGY — PHASE II', p2children)
    }
  } else {
    const rsChildren = []
    if (sections.sig) { rsChildren.push(subHeading('A. Significance')); rsChildren.push(...textToParagraphs(sections.sig)) }
    if (sections.innov) { rsChildren.push(subHeading('B. Innovation')); rsChildren.push(...textToParagraphs(sections.innov)) }
    if (sections.approach) { rsChildren.push(subHeading('C. Approach')); rsChildren.push(...textToParagraphs(sections.approach)) }
    if (rsChildren.length > 0) {
      await addDoc('research_strategy.docx', 'RESEARCH STRATEGY', rsChildren)
    }
  }

  // 3. Commercialization
  if (needsCommercial && sections.commercial) {
    const label = isPhaseII ? 'COMMERCIALIZATION PLAN' : 'COMMERCIALIZATION POTENTIAL'
    await addDoc('commercialization_plan.docx', label, textToParagraphs(sections.commercial))
  }

  // 4. Data Management
  if (sections.data_mgmt) {
    await addDoc('data_management_plan.docx', 'DATA MANAGEMENT AND SHARING PLAN', textToParagraphs(sections.data_mgmt))
  }

  // 5. Facilities
  if (sections.facilities) {
    await addDoc('facilities.docx', 'FACILITIES AND RESOURCES', textToParagraphs(sections.facilities))
  }

  // 6. Human Subjects (conditional)
  if (setup.human_subjects_involved && sections.human_subjects) {
    await addDoc('human_subjects.docx', 'HUMAN SUBJECTS', textToParagraphs(sections.human_subjects))
  }

  // 7. Vertebrate Animals (conditional)
  if (setup.vert_animals_involved && sections.vert_animals) {
    await addDoc('vertebrate_animals.docx', 'VERTEBRATE ANIMALS', textToParagraphs(sections.vert_animals))
  }

  // 8. Project Summary
  const summaryChildren = []
  if (sections.summary) { summaryChildren.push(sectionHeading('PROJECT SUMMARY/ABSTRACT')); summaryChildren.push(...textToParagraphs(sections.summary)) }
  if (sections.narrative) { summaryChildren.push(sectionHeading('PROJECT NARRATIVE')); summaryChildren.push(...textToParagraphs(sections.narrative)) }
  if (summaryChildren.length > 0) {
    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 }, size: { width: 12240, height: 15840 } } },
        headers: { default: makeHeader(title) },
        footers: { default: makeFooter() },
        children: summaryChildren,
      }],
    })
    zip.file('project_summary.docx', await Packer.toBuffer(doc))
  }

  // 9. Bibliography
  if (citations && citations.length > 0) {
    const bibChildren = citations.map((cite, i) => {
      const authors = cite.authors || 'Unknown Author'
      const year = cite.year || 'n.d.'
      const citeTitle = cite.title || 'Untitled'
      const journal = cite.journal || ''
      const volume = cite.volume || ''
      const issue = cite.issue ? `(${cite.issue})` : ''
      const pages = cite.pages || ''
      const pmid = cite.pmid ? ` PMID: ${cite.pmid}.` : ''
      const text = `${i + 1}. ${authors}. ${citeTitle}. ${journal}${journal && volume ? ' ' : ''}${volume}${issue}${pages ? ':' + pages : ''} (${year}).${pmid}`
      return new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text, font: FONT, size: BODY_PT })] })
    })
    await addDoc('bibliography.docx', 'REFERENCES', bibChildren)
  }

  // 10. Cover Letter
  if (sections.cover_letter) {
    await addDoc('cover_letter.docx', 'COVER LETTER', textToParagraphs(sections.cover_letter))
  }

  const outputType = typeof window !== 'undefined' ? 'blob' : 'nodebuffer'
  return zip.generateAsync({ type: outputType })
}
