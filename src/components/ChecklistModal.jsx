import { useState } from 'react'
import { Document, Paragraph, TextRun, Packer } from 'docx'

const TEAL = '#0e7490'

function SectionHeader({ title }) {
  return (
    <div style={{ fontSize: 14, fontWeight: 700, color: '#111', borderBottom: '1px solid #e5e7eb', paddingBottom: 6, marginBottom: 10, marginTop: 20 }}>
      {title}
    </div>
  )
}

function CheckItem({ symbol, text, words, required, checked, onChange }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 6 }}>
      {onChange ? (
        <input
          type="checkbox"
          checked={checked}
          onChange={onChange}
          style={{ marginTop: 2, flexShrink: 0, cursor: 'pointer', width: 14, height: 14 }}
        />
      ) : (
        <span style={{ flexShrink: 0, fontSize: 14, lineHeight: '20px' }}>{symbol}</span>
      )}
      <span style={{ fontSize: 13, color: '#374151', flex: 1 }}>
        {text}
        {words > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af' }}>{words.toLocaleString()} words</span>}
        {required === false && <span style={{ marginLeft: 6, fontSize: 11, color: '#9ca3af', fontStyle: 'italic' }}>(optional)</span>}
        {required === true && <span style={{ marginLeft: 4, color: '#dc2626', fontSize: 11 }}>*</span>}
      </span>
    </div>
  )
}

function PreparedItem({ item }) {
  const complete = item.status === 'complete'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
      <span style={{ fontSize: 16, flexShrink: 0 }}>{complete ? '✅' : '⏳'}</span>
      <span style={{ fontSize: 13, color: complete ? '#15803d' : '#d97706', fontWeight: complete ? 500 : 400, flex: 1 }}>
        {item.item}
        {item.words > 0 && <span style={{ marginLeft: 8, fontSize: 11, color: '#9ca3af', fontWeight: 400 }}>{item.words.toLocaleString()} words</span>}
      </span>
    </div>
  )
}

export default function ChecklistModal({ checklist, onClose, onEmail, projectId }) {
  const [checks, setChecks] = useState({})
  const [emailing, setEmailing] = useState(false)
  const [emailMsg, setEmailMsg] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const toggle = (key) => setChecks(c => ({ ...c, [key]: !c[key] }))

  const daysUntilDue = checklist.due_date ? Math.ceil((new Date(checklist.due_date) - Date.now()) / 86400000) : null

  async function handleEmail() {
    setEmailing(true)
    setEmailMsg(null)
    try {
      const result = await onEmail()
      setEmailMsg(result.ok ? `Sent to ${result.sent_to}` : result.message)
    } catch (e) {
      setEmailMsg('Email failed: ' + e.message)
    }
    setEmailing(false)
  }

  async function handleDownload() {
    setDownloading(true)
    try {
      const FONT = 'Georgia'
      const children = []

      const h = (text) => new Paragraph({ spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT, size: 24, bold: true })] })
      const p = (text, opts = {}) => new Paragraph({ spacing: { before: 40, after: 60 }, children: [new TextRun({ text, font: FONT, size: 22, ...opts })] })

      children.push(new Paragraph({ spacing: { before: 0, after: 180 }, children: [new TextRun({ text: 'SUBMISSION CHECKLIST', font: FONT, size: 28, bold: true })] }))
      children.push(new Paragraph({ spacing: { before: 0, after: 120 }, children: [new TextRun({ text: `${checklist.project_title} · ${checklist.mechanism}`, font: FONT, size: 22, color: '555555' })] }))
      if (checklist.due_date) children.push(new Paragraph({ spacing: { before: 0, after: 240 }, children: [new TextRun({ text: `Submission deadline: ${checklist.due_date}`, font: FONT, size: 22, bold: true, color: 'dc2626' })] }))
      children.push(new Paragraph({ spacing: { before: 0, after: 240 }, children: [new TextRun({ text: `Ownership: ${checklist.ownership_statement}`, font: FONT, size: 18, italics: true, color: '0e7490' })] }))

      children.push(h('FrankGrant Prepared'))
      checklist.frankgrant_prepared.forEach(it => children.push(p(`${it.status === 'complete' ? '✅' : '⏳'}  ${it.item}${it.words ? ' (' + it.words + ' words)' : ''}`)))

      children.push(h('Your Scientific Documents'))
      checklist.researcher_scientific.forEach(it => children.push(p(`☐  ${it.item}${it.required === false ? ' (optional)' : ' *'}`, it.required ? { bold: true } : {})))

      children.push(h('Letters Required'))
      checklist.letters_required.forEach(it => children.push(p(`☐  ${it.item} *`, { bold: true })))

      children.push(h('Administrative Requirements'))
      checklist.administrative.forEach(it => children.push(p(`☐  ${it.item}${it.required === false ? ' (optional)' : ' *'}`, it.required ? { bold: true } : {})))

      children.push(h('Important Notes'))
      checklist.important_notes.forEach(n => children.push(p(`•  ${n}`)))

      children.push(new Paragraph({
        spacing: { before: 480, after: 0 },
        children: [new TextRun({
          text: `Prepared by FrankGrant Grant Writing Services. Scientific content owned by ${checklist.pi_name}, ${checklist.institution}.`,
          font: FONT, size: 18, italics: true, color: '9ca3af',
        })],
      }))

      const doc = new Document({
        sections: [{
          properties: { page: { margin: { top: 720, right: 720, bottom: 720, left: 720 }, size: { width: 12240, height: 15840 } } },
          children,
        }],
      })
      const buf = await Packer.toBuffer(doc)
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `submission_checklist_${(checklist.project_title || 'grant').replace(/[^a-z0-9]/gi, '_').slice(0, 40)}.docx`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Download failed: ' + e.message)
    }
    setDownloading(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '24px 16px' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 700, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #e5e7eb' }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#111' }}>📋 Submission Checklist</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{checklist.project_title} · {checklist.mechanism}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#6b7280' }}>✕</button>
        </div>

        <div style={{ padding: '20px', maxHeight: '70vh', overflowY: 'auto' }}>
          {/* Ownership box */}
          <div style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e', marginBottom: 4 }}>Your science, your data, your IP. FrankGrant prepared the writing. You own everything.</div>
            <div style={{ fontSize: 12, color: '#0369a1' }}>{checklist.ownership_statement}</div>
          </div>

          {/* Due date */}
          {checklist.due_date && (
            <div style={{ padding: '8px 12px', borderRadius: 6, marginBottom: 14, background: daysUntilDue <= 14 ? '#fef2f2' : '#f0fdf4', border: `1px solid ${daysUntilDue <= 14 ? '#fca5a5' : '#86efac'}`, fontSize: 13, fontWeight: 600, color: daysUntilDue <= 14 ? '#dc2626' : '#15803d' }}>
              📅 Submission deadline: {checklist.due_date}{daysUntilDue !== null && ` (${daysUntilDue > 0 ? daysUntilDue + ' days away' : 'PAST DUE'})`}
            </div>
          )}

          {/* FrankGrant Prepared */}
          <SectionHeader title="1. FrankGrant Prepared" />
          {checklist.frankgrant_prepared.map((it, i) => <PreparedItem key={i} item={it} />)}

          {/* Researcher Scientific */}
          <SectionHeader title="2. Your Scientific Documents" />
          <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 8 }}>* Required items. Check off as you complete them.</div>
          {checklist.researcher_scientific.map((it, i) => (
            <CheckItem key={i} text={it.item} required={it.required} checked={!!checks[`sci_${i}`]} onChange={() => toggle(`sci_${i}`)} />
          ))}

          {/* Letters */}
          <SectionHeader title="3. Letters Required" />
          {checklist.letters_required.map((it, i) => (
            <CheckItem key={i} text={it.item} required={it.required} checked={!!checks[`ltr_${i}`]} onChange={() => toggle(`ltr_${i}`)} />
          ))}

          {/* Administrative */}
          <SectionHeader title="4. Administrative Requirements" />
          {checklist.administrative.map((it, i) => (
            <CheckItem key={i} text={it.item} required={it.required} checked={!!checks[`adm_${i}`]} onChange={() => toggle(`adm_${i}`)} />
          ))}

          {/* Important Notes */}
          <SectionHeader title="5. Important Notes" />
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '10px 14px' }}>
            {checklist.important_notes.map((note, i) => (
              <div key={i} style={{ fontSize: 12, color: '#374151', marginBottom: 4, display: 'flex', gap: 8 }}>
                <span>•</span><span>{note}</span>
              </div>
            ))}
          </div>

          {/* Disclaimer footer */}
          <div style={{ marginTop: 16, fontSize: 11, color: '#9ca3af', fontStyle: 'italic', borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
            Prepared by FrankGrant Grant Writing Services. Scientific content owned by {checklist.pi_name}, {checklist.institution}. View only — no login required.
          </div>
        </div>

        {/* Footer buttons */}
        <div style={{ display: 'flex', gap: 8, padding: '14px 20px', borderTop: '1px solid #e5e7eb', background: '#f9fafb', borderBottomLeftRadius: 12, borderBottomRightRadius: 12 }}>
          <button
            onClick={handleEmail}
            disabled={emailing}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: emailing ? '#e5e7eb' : TEAL, color: emailing ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6, cursor: emailing ? 'not-allowed' : 'pointer' }}
          >
            {emailing ? '⟳ Sending…' : '📧 Email This Checklist to Myself'}
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            style={{ padding: '8px 16px', fontSize: 13, fontWeight: 600, background: '#fff', color: '#374151', border: '1px solid #d1d5db', borderRadius: 6, cursor: downloading ? 'not-allowed' : 'pointer' }}
          >
            {downloading ? '⟳ Generating…' : '📄 Download Checklist (.docx)'}
          </button>
          {emailMsg && <span style={{ fontSize: 12, color: emailMsg.startsWith('Sent') ? '#15803d' : '#dc2626', alignSelf: 'center' }}>{emailMsg}</span>}
          <button onClick={onClose} style={{ marginLeft: 'auto', padding: '8px 14px', fontSize: 13, background: 'none', border: '1px solid #d1d5db', borderRadius: 6, cursor: 'pointer', color: '#374151' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
