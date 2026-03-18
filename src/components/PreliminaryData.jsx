import { useState, useRef, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'

const SCORE_COLOR = (score) => {
  if (score >= 80) return '#22c55e'
  if (score >= 60) return '#f59e0b'
  if (score >= 40) return '#f97316'
  return '#ef4444'
}

const IMPORTANCE_BADGE = { high: '#ef4444', medium: '#f59e0b', low: '#6b7280' }

function ScoreCircle({ score }) {
  const color = SCORE_COLOR(score)
  const radius = 36
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={90} height={90}>
        <circle cx={45} cy={45} r={radius} fill="none" stroke="#1e293b" strokeWidth={7} />
        <circle
          cx={45} cy={45} r={radius} fill="none"
          stroke={color} strokeWidth={7}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 45 45)"
          style={{ transition: 'stroke-dashoffset 0.6s ease' }}
        />
        <text x={45} y={51} textAnchor="middle" fill={color} fontSize={20} fontWeight={700}>{score}</text>
      </svg>
      <span style={{ fontSize: 11, color: '#94a3b8' }}>Prelim Score</span>
    </div>
  )
}

function DropZone({ onFiles, disabled }) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef()

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const files = Array.from(e.dataTransfer.files)
    if (files.length) onFiles(files)
  }, [onFiles, disabled])

  const handleChange = (e) => {
    const files = Array.from(e.target.files)
    if (files.length) onFiles(files)
    e.target.value = ''
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      style={{
        border: `2px dashed ${dragging ? '#6366f1' : '#334155'}`,
        borderRadius: 10,
        padding: '32px 24px',
        textAlign: 'center',
        cursor: disabled ? 'not-allowed' : 'pointer',
        background: dragging ? 'rgba(99,102,241,0.06)' : 'rgba(15,23,42,0.5)',
        transition: 'all 0.2s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ fontSize: 28, marginBottom: 8 }}>📎</div>
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        Drop figures, images, or PDFs here
      </div>
      <div style={{ color: '#64748b', fontSize: 11, marginTop: 4 }}>
        JPEG, PNG, GIF, WebP, PDF · Max 10MB per file
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
        onChange={handleChange}
        style={{ display: 'none' }}
      />
    </div>
  )
}

export default function PreliminaryData({ projectId, onNarrativeGenerated }) {
  const api = useApi()
  const [tab, setTab] = useState('upload')
  const [items, setItems] = useState([])
  const [score, setScore] = useState(0)
  const [gapAnalysis, setGapAnalysis] = useState(null)
  const [narrative, setNarrative] = useState('')
  const [uploading, setUploading] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [generatingNarrative, setGeneratingNarrative] = useState(false)
  const [labelMap, setLabelMap] = useState({})
  const [pendingLabel, setPendingLabel] = useState('')
  const [error, setError] = useState(null)
  const [uploadQueue, setUploadQueue] = useState([])
  const pendingLabelRef = useRef('')

  useEffect(() => {
    loadData()
  }, [projectId])

  async function loadData() {
    try {
      const data = await api.listPrelim(projectId)
      setItems(data.items || [])
      setScore(data.score || 0)
      setGapAnalysis(data.gaps || null)
      setNarrative(data.narrative || '')
    } catch (e) {
      setError('Failed to load preliminary data')
    }
  }

  async function handleFiles(files) {
    setError(null)
    for (const file of files) {
      const label = pendingLabelRef.current || ''
      setUploading(true)
      try {
        const result = await api.uploadPrelim(projectId, file, label)
        await loadData()
      } catch (e) {
        setError(e.message)
      } finally {
        setUploading(false)
      }
    }
  }

  async function handleDelete(id) {
    try {
      await api.deletePrelim(projectId, id)
      setItems(prev => prev.filter(i => i.id !== id))
    } catch (e) {
      setError(e.message)
    }
  }

  async function handleAnalyze() {
    setAnalyzing(true)
    setError(null)
    try {
      const result = await api.analyzePrelim(projectId)
      setScore(result.score || 0)
      setGapAnalysis(result)
      setTab('analysis')
    } catch (e) {
      setError(e.message)
    } finally {
      setAnalyzing(false)
    }
  }

  async function handleGenerateNarrative() {
    setGeneratingNarrative(true)
    setError(null)
    try {
      const result = await api.generatePrelimNarrative(projectId)
      setNarrative(result.narrative)
      setTab('narrative')
      if (onNarrativeGenerated) onNarrativeGenerated(result.narrative)
    } catch (e) {
      setError(e.message)
    } finally {
      setGeneratingNarrative(false)
    }
  }

  const sectionStyle = {
    background: '#0f172a',
    border: '1px solid #1e293b',
    borderRadius: 10,
    padding: '16px 18px',
    marginBottom: 10,
  }

  const tabBtnStyle = (active) => ({
    padding: '6px 14px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    background: active ? '#6366f1' : 'transparent',
    color: active ? '#fff' : '#64748b',
    transition: 'all 0.2s',
  })

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header with score */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: '#f1f5f9' }}>Preliminary Data</div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>
            {items.length} figure{items.length !== 1 ? 's' : ''} uploaded
          </div>
        </div>
        {items.length > 0 && <ScoreCircle score={score} />}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 14, background: '#0f172a', borderRadius: 8, padding: 4, border: '1px solid #1e293b' }}>
        {['upload', 'analysis', 'narrative'].map(t => (
          <button key={t} style={tabBtnStyle(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ background: '#1f1010', border: '1px solid #7f1d1d', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12, color: '#fca5a5' }}>
          {error}
        </div>
      )}

      {/* Upload Tab */}
      {tab === 'upload' && (
        <div>
          <div style={{ marginBottom: 10 }}>
            <label style={{ fontSize: 11, color: '#64748b', display: 'block', marginBottom: 4 }}>Label (optional)</label>
            <input
              type="text"
              placeholder="e.g. In vitro efficacy, Mouse model, Western blot..."
              value={pendingLabel}
              onChange={(e) => {
                setPendingLabel(e.target.value)
                pendingLabelRef.current = e.target.value
              }}
              style={{
                width: '100%', padding: '8px 10px', borderRadius: 6,
                border: '1px solid #1e293b', background: '#0f172a',
                color: '#f1f5f9', fontSize: 12, boxSizing: 'border-box',
              }}
            />
          </div>

          <DropZone onFiles={handleFiles} disabled={uploading} />

          {uploading && (
            <div style={{ textAlign: 'center', color: '#6366f1', fontSize: 12, marginTop: 10 }}>
              Uploading and analyzing with Claude vision...
            </div>
          )}

          {/* Uploaded items list */}
          {items.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Uploaded Figures
              </div>
              {items.map((item, i) => (
                <div key={item.id} style={{ ...sectionStyle, display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: '#6366f1', background: 'rgba(99,102,241,0.1)', padding: '2px 6px', borderRadius: 4 }}>
                        Fig {i + 1}
                      </span>
                      <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.label || item.file_name}
                      </span>
                      <span style={{ fontSize: 10, color: '#475569', marginLeft: 'auto', flexShrink: 0 }}>
                        {item.file_type?.split('/')[1]?.toUpperCase()} · {(item.file_size / 1024).toFixed(0)}KB
                      </span>
                    </div>
                    <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.5 }}>
                      {item.ai_description}
                    </div>
                  </div>
                  <button
                    onClick={() => handleDelete(item.id)}
                    style={{ background: 'none', border: 'none', color: '#475569', cursor: 'pointer', fontSize: 16, flexShrink: 0, padding: '0 4px' }}
                    title="Remove"
                  >
                    ✕
                  </button>
                </div>
              ))}

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 7, border: 'none',
                    background: analyzing ? '#1e293b' : '#4f46e5', color: '#fff',
                    fontSize: 12, fontWeight: 600, cursor: analyzing ? 'not-allowed' : 'pointer',
                  }}
                >
                  {analyzing ? 'Analyzing...' : '🔍 Analyze Gaps'}
                </button>
                <button
                  onClick={handleGenerateNarrative}
                  disabled={generatingNarrative}
                  style={{
                    flex: 1, padding: '9px 0', borderRadius: 7, border: 'none',
                    background: generatingNarrative ? '#1e293b' : '#0f766e', color: '#fff',
                    fontSize: 12, fontWeight: 600, cursor: generatingNarrative ? 'not-allowed' : 'pointer',
                  }}
                >
                  {generatingNarrative ? 'Writing...' : '✍️ Write Narrative'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Analysis Tab */}
      {tab === 'analysis' && (
        <div>
          {!gapAnalysis ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 13 }}>
              {items.length === 0
                ? 'Upload figures first, then run gap analysis.'
                : <><p style={{ marginBottom: 12 }}>Run a gap analysis to see how reviewers might assess your preliminary data.</p>
                  <button
                    onClick={handleAnalyze}
                    disabled={analyzing}
                    style={{ padding: '9px 20px', borderRadius: 7, border: 'none', background: '#4f46e5', color: '#fff', fontSize: 13, fontWeight: 600, cursor: analyzing ? 'not-allowed' : 'pointer' }}
                  >
                    {analyzing ? 'Analyzing...' : '🔍 Run Gap Analysis'}
                  </button>
                </>
              }
            </div>
          ) : (
            <div>
              {/* Score + label + summary */}
              <div style={{ ...sectionStyle, display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <ScoreCircle score={gapAnalysis.score || 0} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: SCORE_COLOR(gapAnalysis.score || 0), marginBottom: 6 }}>
                    {gapAnalysis.score_label || 'Assessed'}
                  </div>
                  <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>{gapAnalysis.summary}</div>
                </div>
              </div>

              {/* Strengths */}
              {gapAnalysis.strengths?.length > 0 && (
                <div style={{ ...sectionStyle, borderColor: '#14532d' }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Strengths</div>
                  {gapAnalysis.strengths.map((s, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#86efac', marginBottom: 4, paddingLeft: 12, position: 'relative' }}>
                      <span style={{ position: 'absolute', left: 0 }}>✓</span>{s}
                    </div>
                  ))}
                </div>
              )}

              {/* Gaps */}
              {gapAnalysis.gaps?.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Gaps to Address</div>
                  {gapAnalysis.gaps.map((gap, i) => (
                    <div key={i} style={{ ...sectionStyle, borderLeft: `3px solid ${IMPORTANCE_BADGE[gap.importance] || '#6b7280'}` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 10, fontWeight: 700, color: IMPORTANCE_BADGE[gap.importance] || '#6b7280', textTransform: 'uppercase' }}>
                          {gap.importance}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0' }}>{gap.gap}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>→ {gap.suggestion}</div>
                    </div>
                  ))}
                </div>
              )}

              <button
                onClick={handleAnalyze}
                disabled={analyzing}
                style={{ width: '100%', marginTop: 8, padding: '8px 0', borderRadius: 7, border: '1px solid #1e293b', background: 'transparent', color: '#64748b', fontSize: 12, cursor: analyzing ? 'not-allowed' : 'pointer' }}
              >
                {analyzing ? 'Re-analyzing...' : '↻ Re-analyze'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Narrative Tab */}
      {tab === 'narrative' && (
        <div>
          {!narrative ? (
            <div style={{ textAlign: 'center', padding: '40px 0', color: '#475569', fontSize: 13 }}>
              {items.length === 0
                ? 'Upload figures first, then generate a narrative.'
                : <>
                  <p style={{ marginBottom: 12 }}>Generate a polished "Preliminary Data" narrative from your uploaded figures.</p>
                  <button
                    onClick={handleGenerateNarrative}
                    disabled={generatingNarrative}
                    style={{ padding: '9px 20px', borderRadius: 7, border: 'none', background: '#0f766e', color: '#fff', fontSize: 13, fontWeight: 600, cursor: generatingNarrative ? 'not-allowed' : 'pointer' }}
                  >
                    {generatingNarrative ? 'Writing...' : '✍️ Generate Narrative'}
                  </button>
                </>
              }
            </div>
          ) : (
            <div>
              <div style={{ ...sectionStyle, lineHeight: 1.7, fontSize: 13, color: '#cbd5e1', whiteSpace: 'pre-wrap' }}>
                {narrative}
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(narrative)
                  }}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: '1px solid #1e293b', background: 'transparent', color: '#64748b', fontSize: 12, cursor: 'pointer' }}
                >
                  📋 Copy
                </button>
                <button
                  onClick={handleGenerateNarrative}
                  disabled={generatingNarrative}
                  style={{ flex: 1, padding: '8px 0', borderRadius: 7, border: '1px solid #1e293b', background: 'transparent', color: '#64748b', fontSize: 12, cursor: generatingNarrative ? 'not-allowed' : 'pointer' }}
                >
                  {generatingNarrative ? 'Writing...' : '↻ Regenerate'}
                </button>
              </div>
              {onNarrativeGenerated && (
                <button
                  onClick={() => onNarrativeGenerated(narrative)}
                  style={{ width: '100%', marginTop: 8, padding: '9px 0', borderRadius: 7, border: 'none', background: '#0f766e', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
                >
                  ✓ Use in Approach Section
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
