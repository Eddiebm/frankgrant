import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { BIOSKETCH_SYSTEM } from '../lib/personas'

const MODEL = 'claude-sonnet-4-20250514'

export default function BiosketchGenerator({ onBack }) {
  const api = useApi()
  const [formData, setFormData] = useState({
    name: '',
    position: '',
    institution: '',
    education: '',
    research_focus: '',
    publications: [
      { title: '', journal: '', year: '', pmid: '' },
      { title: '', journal: '', year: '', pmid: '' },
      { title: '', journal: '', year: '', pmid: '' },
      { title: '', journal: '', year: '', pmid: '' },
      { title: '', journal: '', year: '', pmid: '' },
    ],
    honors: '',
    current_support: '',
    pending_support: ''
  })
  const [generating, setGenerating] = useState(false)
  const [biosketch, setBiosketch] = useState('')

  function updateField(field, value) {
    setFormData({ ...formData, [field]: value })
  }

  function updatePublication(index, field, value) {
    const pubs = [...formData.publications]
    pubs[index] = { ...pubs[index], [field]: value }
    setFormData({ ...formData, publications: pubs })
  }

  async function generateBiosketch() {
    setGenerating(true)
    try {
      const prompt = `Generate an NIH Biographical Sketch for:

Name: ${formData.name}
Position: ${formData.position}
Institution: ${formData.institution}

Education:
${formData.education}

Current Research Focus:
${formData.research_focus}

Key Publications:
${formData.publications.filter(p => p.title).map((p, i) =>
  `${i + 1}. ${p.title}. ${p.journal}, ${p.year}. ${p.pmid ? `PMID: ${p.pmid}` : ''}`
).join('\n')}

Honors and Awards:
${formData.honors}

Current Research Support:
${formData.current_support}

Pending Research Support:
${formData.pending_support}

Generate a complete NIH biosketch following SF424 (R&R) format. Include:
1. Personal Statement (4 sentences max)
2. Positions and Honors
3. Contributions to Science (organize publications into research themes)
4. Research Support

Keep within 5-page limit.`

      const result = await api.callAI({
        model: MODEL,
        max_tokens: 2000,
        system: BIOSKETCH_SYSTEM,
        messages: [{ role: 'user', content: prompt }]
      }, 'generate_biosketch')

      const text = result.content[0].text
      setBiosketch(text)
    } catch (e) {
      alert('Failed to generate biosketch: ' + e.message)
    }
    setGenerating(false)
  }

  function copyBiosketch() {
    navigator.clipboard.writeText(biosketch)
    alert('Biosketch copied to clipboard')
  }

  function downloadBiosketch() {
    const blob = new Blob([biosketch], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${formData.name.replace(/\s+/g, '_')}_biosketch.txt`
    a.click()
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
        <button onClick={onBack} style={backBtn}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>NIH Biosketch Generator</h1>
      </div>

      {!biosketch ? (
        <div>
          <p style={{ fontSize: 14, color: '#666', marginBottom: '1.5rem', lineHeight: 1.6 }}>
            Fill in your information to generate an NIH Biographical Sketch following the SF424 (R&R) format (5-page limit).
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Field label="Name">
              <input
                style={inputStyle}
                value={formData.name}
                onChange={e => updateField('name', e.target.value)}
                placeholder="Dr. Jane Smith"
              />
            </Field>

            <Field label="Position/Title">
              <input
                style={inputStyle}
                value={formData.position}
                onChange={e => updateField('position', e.target.value)}
                placeholder="Associate Professor of Biochemistry"
              />
            </Field>

            <Field label="Institution">
              <input
                style={inputStyle}
                value={formData.institution}
                onChange={e => updateField('institution', e.target.value)}
                placeholder="Harvard Medical School"
              />
            </Field>

            <Field label="Education History">
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={formData.education}
                onChange={e => updateField('education', e.target.value)}
                placeholder="PhD, Biochemistry, Stanford University, 2010&#10;BS, Chemistry, MIT, 2005"
              />
            </Field>

            <Field label="Current Research Focus">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={formData.research_focus}
                onChange={e => updateField('research_focus', e.target.value)}
                placeholder="Describe your current research areas and expertise relevant to this grant..."
              />
            </Field>

            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#111', marginBottom: 8, display: 'block' }}>
                Key Publications (up to 5)
              </label>
              {formData.publications.map((pub, i) => (
                <div key={i} style={{
                  border: '0.5px solid #e5e5e5',
                  borderRadius: 8,
                  padding: '1rem',
                  marginBottom: 8,
                  background: '#fafafa'
                }}>
                  <div style={{ fontSize: 11, fontWeight: 500, color: '#888', marginBottom: 8 }}>
                    Publication {i + 1}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <input
                      style={{ ...inputStyle, gridColumn: '1 / -1' }}
                      value={pub.title}
                      onChange={e => updatePublication(i, 'title', e.target.value)}
                      placeholder="Full publication title"
                    />
                    <input
                      style={inputStyle}
                      value={pub.journal}
                      onChange={e => updatePublication(i, 'journal', e.target.value)}
                      placeholder="Journal name"
                    />
                    <input
                      style={inputStyle}
                      value={pub.year}
                      onChange={e => updatePublication(i, 'year', e.target.value)}
                      placeholder="Year"
                    />
                    <input
                      style={inputStyle}
                      value={pub.pmid}
                      onChange={e => updatePublication(i, 'pmid', e.target.value)}
                      placeholder="PMID (if available)"
                    />
                  </div>
                </div>
              ))}
            </div>

            <Field label="Honors and Awards">
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={formData.honors}
                onChange={e => updateField('honors', e.target.value)}
                placeholder="List honors, awards, and recognitions with years..."
              />
            </Field>

            <Field label="Current Research Support">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={formData.current_support}
                onChange={e => updateField('current_support', e.target.value)}
                placeholder="List current grants with project numbers, titles, dates, and relevance to proposed work..."
              />
            </Field>

            <Field label="Pending Research Support">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={formData.pending_support}
                onChange={e => updateField('pending_support', e.target.value)}
                placeholder="List pending grants..."
              />
            </Field>
          </div>

          <button
            onClick={generateBiosketch}
            disabled={generating || !formData.name || !formData.institution}
            style={{
              ...btnStyle,
              width: '100%',
              marginTop: '1.5rem',
              opacity: (!formData.name || !formData.institution) ? 0.5 : 1
            }}
          >
            {generating ? 'Generating Biosketch...' : 'Generate NIH Biosketch'}
          </button>
        </div>
      ) : (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
            <button onClick={() => setBiosketch('')} style={backBtn}>← Edit Form</button>
            <button onClick={copyBiosketch} style={actionBtn}>Copy to Clipboard</button>
            <button onClick={downloadBiosketch} style={actionBtn}>Download .txt</button>
          </div>

          <div style={{
            border: '0.5px solid #e5e5e5',
            borderRadius: 8,
            padding: '1.5rem',
            background: '#fff',
            fontSize: 13,
            lineHeight: 1.8,
            fontFamily: 'Georgia, serif',
            whiteSpace: 'pre-wrap',
            maxHeight: '70vh',
            overflowY: 'auto'
          }}>
            {biosketch}
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#111' }}>{label}</label>
      {children}
    </div>
  )
}

const backBtn = {
  padding: '7px 14px',
  fontSize: 13,
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#666'
}

const btnStyle = {
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#111',
  color: '#fff'
}

const actionBtn = {
  padding: '7px 14px',
  fontSize: 13,
  fontWeight: 500,
  border: '0.5px solid #ccc',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#111'
}

const inputStyle = {
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%'
}
