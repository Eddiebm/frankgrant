import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi'

const inp = { border: '1px solid #d1d5db', borderRadius: 6, padding: '7px 10px', fontSize: 13, width: '100%', boxSizing: 'border-box' }
const lbl = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 3, display: 'block' }
const ghostBtn = { background: '#fff', border: '0.5px solid #ccc', borderRadius: 6, padding: '5px 14px', cursor: 'pointer', fontSize: 12 }

function formatNIH(cite, index) {
  const authors = cite.authors || 'Unknown Author'
  const year = cite.year || 'n.d.'
  const title = cite.title || 'Untitled'
  const journal = cite.journal || ''
  const volume = cite.volume || ''
  const issue = cite.issue ? `(${cite.issue})` : ''
  const pages = cite.pages || ''
  const pmid = cite.pmid ? ` PMID: ${cite.pmid}.` : ''
  return `${index}. ${authors}. ${title}. ${journal}${journal && volume ? ' ' : ''}${volume}${issue}${pages ? `:${pages}` : ''} (${year}).${pmid}`
}

export default function BibliographyManager({ projectId, onInsert, onClose }) {
  const { getBibliography, saveBibliography } = useApi()

  const [bibliography, setBibliography] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [copied, setCopied] = useState(false)
  const [form, setForm] = useState({ authors: '', title: '', journal: '', year: '', volume: '', issue: '', pages: '', pmid: '', section: '' })
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!projectId) { setLoading(false); return }
    getBibliography(projectId)
      .then(data => setBibliography(data.bibliography || []))
      .catch(() => setBibliography([]))
      .finally(() => setLoading(false))
  }, [projectId])

  async function save(updated) {
    if (!projectId) return
    setSaving(true)
    try {
      await saveBibliography(projectId, updated)
    } catch (e) {
      setError('Save failed: ' + e.message)
    }
    setSaving(false)
  }

  function handleAdd() {
    if (!form.title.trim() && !form.pmid.trim()) { setError('Title or PMID required'); return }
    const newCite = { ...form, id: Date.now().toString() }
    const updated = [...bibliography, newCite]
    setBibliography(updated)
    save(updated)
    setForm({ authors: '', title: '', journal: '', year: '', volume: '', issue: '', pages: '', pmid: '', section: '' })
    setShowForm(false)
    setError(null)
  }

  function handleDelete(id) {
    const updated = bibliography.filter(c => c.id !== id)
    setBibliography(updated)
    save(updated)
  }

  function handleAddFromPubMed(text) {
    // Parse a formatted citation string from the citation panel
    const newCite = { id: Date.now().toString(), title: text.slice(0, 120), authors: '', journal: '', year: '', section: '' }
    const updated = [...bibliography, newCite]
    setBibliography(updated)
    save(updated)
  }

  function getFormattedBibliography() {
    return bibliography.map((cite, i) => formatNIH(cite, i + 1)).join('\n\n')
  }

  function handleCopy() {
    navigator.clipboard.writeText(getFormattedBibliography())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleInsertBibliography() {
    if (onInsert) onInsert(getFormattedBibliography())
  }

  if (loading) return <div style={{ padding: 20, fontSize: 13, color: '#6b7280' }}>Loading bibliography...</div>

  return (
    <div style={{ padding: '16px 20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ fontWeight: 700, fontSize: 15 }}>📚 Bibliography Manager</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {saving && <span style={{ fontSize: 11, color: '#9ca3af', alignSelf: 'center' }}>Saving...</span>}
          {onClose && <button onClick={onClose} style={{ ...ghostBtn, fontSize: 13 }}>✕</button>}
        </div>
      </div>

      {/* Actions row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={() => setShowForm(f => !f)} style={{ ...ghostBtn, background: showForm ? '#eff6ff' : '#fff' }}>
          + Add Citation
        </button>
        {bibliography.length > 0 && (
          <>
            <button onClick={handleCopy} style={ghostBtn}>
              {copied ? '✓ Copied' : '📋 Copy All'}
            </button>
            {onInsert && (
              <button onClick={handleInsertBibliography} style={{ ...ghostBtn, borderColor: '#2563eb', color: '#2563eb' }}>
                ⬆ Insert into Section
              </button>
            )}
          </>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div style={{ marginBottom: 14, padding: '14px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Add Citation</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div style={{ gridColumn: '1/-1' }}>
              <div style={lbl}>Title *</div>
              <input style={inp} value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Article or chapter title" />
            </div>
            <div style={{ gridColumn: '1/-1' }}>
              <div style={lbl}>Authors (Last FM, Last FM, ...)</div>
              <input style={inp} value={form.authors} onChange={e => setForm(f => ({ ...f, authors: e.target.value }))} placeholder="Smith AB, Jones CD, et al." />
            </div>
            <div>
              <div style={lbl}>Journal / Book</div>
              <input style={inp} value={form.journal} onChange={e => setForm(f => ({ ...f, journal: e.target.value }))} placeholder="J Clin Oncol" />
            </div>
            <div>
              <div style={lbl}>Year</div>
              <input style={inp} value={form.year} onChange={e => setForm(f => ({ ...f, year: e.target.value }))} placeholder="2024" />
            </div>
            <div>
              <div style={lbl}>Volume</div>
              <input style={inp} value={form.volume} onChange={e => setForm(f => ({ ...f, volume: e.target.value }))} placeholder="42" />
            </div>
            <div>
              <div style={lbl}>Issue / Pages</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input style={inp} value={form.issue} onChange={e => setForm(f => ({ ...f, issue: e.target.value }))} placeholder="3" />
                <input style={inp} value={form.pages} onChange={e => setForm(f => ({ ...f, pages: e.target.value }))} placeholder="123-145" />
              </div>
            </div>
            <div>
              <div style={lbl}>PMID</div>
              <input style={inp} value={form.pmid} onChange={e => setForm(f => ({ ...f, pmid: e.target.value }))} placeholder="38291234" />
            </div>
            <div>
              <div style={lbl}>Section Tag (optional)</div>
              <input style={inp} value={form.section} onChange={e => setForm(f => ({ ...f, section: e.target.value }))} placeholder="sig, approach, aims..." />
            </div>
          </div>
          {error && <div style={{ color: '#dc2626', fontSize: 12, marginTop: 8 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <button onClick={handleAdd} style={{ ...ghostBtn, background: '#2563eb', color: '#fff', border: 'none' }}>Add</button>
            <button onClick={() => { setShowForm(false); setError(null) }} style={ghostBtn}>Cancel</button>
          </div>
        </div>
      )}

      {/* Citation list */}
      {bibliography.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '32px 0', color: '#9ca3af', fontSize: 13 }}>
          No citations yet. Add citations manually or they will appear here when you insert them from the Citations panel.
        </div>
      ) : (
        <div>
          <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>{bibliography.length} citation{bibliography.length !== 1 ? 's' : ''}</div>
          {bibliography.map((cite, i) => (
            <div key={cite.id} style={{ marginBottom: 10, padding: '10px 14px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#6b7280', minWidth: 20, paddingTop: 1 }}>{i + 1}.</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, lineHeight: 1.5, fontFamily: 'Georgia, serif' }}>{formatNIH(cite, i + 1).slice(3)}</div>
                {cite.section && (
                  <span style={{ fontSize: 10, background: '#e0e7ff', color: '#3730a3', padding: '1px 6px', borderRadius: 10, marginTop: 4, display: 'inline-block' }}>{cite.section}</span>
                )}
                {cite.pmid && (
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${cite.pmid}/`} target="_blank" rel="noreferrer" style={{ fontSize: 10, color: '#2563eb', marginLeft: 6 }}>PubMed ↗</a>
                )}
              </div>
              <button onClick={() => handleDelete(cite.id)} style={{ ...ghostBtn, padding: '3px 8px', fontSize: 12, color: '#dc2626', borderColor: '#fca5a5' }}>✕</button>
            </div>
          ))}

          {/* Formatted preview */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#374151' }}>REFERENCES (formatted, NIH style)</div>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, fontFamily: 'Georgia, serif', lineHeight: 1.7, background: '#fff', padding: '12px 14px', border: '1px solid #e5e7eb', borderRadius: 6, maxHeight: 200, overflowY: 'auto', margin: 0 }}>
              {getFormattedBibliography()}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
