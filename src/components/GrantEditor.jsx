import { useState, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import {
  MECHANISMS, SECTIONS, WORDS_PER_PAGE, INSTITUTES,
  getDescriptor, getLimitsText
} from '../lib/nih.js'
import { countWords, estimatePages } from '../lib/compression.js'
import { PROFESSOR_SYSTEM, professorWritePrompt, polishPrompt, PROGRAM_DIRECTOR_SYSTEM, REVIEWER_1_SYSTEM, REVIEWER_2_SYSTEM, REVIEWER_3_SYSTEM, STUDY_SECTION_SUMMARY_SYSTEM, ADVISORY_COUNCIL_SYSTEM } from '../lib/personas.js'

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-20250514'

export default function GrantEditor({ project, onSave, onBack }) {
  const api = useApi()

  const [title, setTitle] = useState(project.title || '')
  const [mech, setMech] = useState(project.mechanism || 'STTR-I')
  const [setup, setSetup] = useState({
    pi: '', partner: '', disease: '', biology: '', aims: '', pa: '', budget: '', commercial: '', institute: '',
    ...project.setup,
  })
  const [sections, setSections] = useState(project.sections || {})
  const [scores, setScores] = useState(project.scores || {})
  const [activeTab, setActiveTab] = useState('setup')
  const [activeSec, setActiveSec] = useState('aims')
  const [generating, setGenerating] = useState({})
  const [scoring, setScoring] = useState({})
  const [saveState, setSaveState] = useState('saved')

  const m = MECHANISMS[mech] || MECHANISMS['STTR-I']
  const visibleSecs = SECTIONS.filter(s => s.id !== 'commercial' || m.needsCommercial)

  function getProject() {
    return { title, mechanism: mech, pi: setup.pi, partner: setup.partner, disease: setup.disease, biology: setup.biology, aims: setup.aims, pa: setup.pa, budget: setup.budget, commercial: setup.commercial }
  }

  async function save(updatedSections, updatedScores) {
    setSaveState('saving')
    try {
      await onSave({
        title, mechanism: mech, setup,
        sections: updatedSections || sections,
        scores: updatedScores || scores,
      })
      setSaveState('saved')
    } catch {
      setSaveState('error')
    }
  }

  function updateSection(id, text) {
    const updated = { ...sections, [id]: text }
    setSections(updated)
    setSaveState('unsaved')
    return updated
  }

  async function generateSection(secId) {
    setGenerating(g => ({ ...g, [secId]: true }))
    try {
      // Determine max_tokens based on section type
      const maxTokensBySection = {
        'aims': 1200,
        'sig': 1000,
        'innov': 1000,
        'approach': 2500,
        'facilities': 800,
        'commercial': 1500
      }

      const result = await api.callAI({
        model: SONNET,
        max_tokens: maxTokensBySection[secId] || 1500,
        system: PROFESSOR_SYSTEM,
        messages: [{ role: 'user', content: professorWritePrompt(secId, getProject(), mech) }],
      }, `write_${secId}`)
      const text = result.content.map(b => b.text || '').join('')
      const updated = updateSection(secId, text)
      await save(updated, scores)
      scoreSection(secId, text, updated)
    } catch (e) {
      alert('Generation failed: ' + e.message)
    }
    setGenerating(g => ({ ...g, [secId]: false }))
  }

  async function scoreSection(secId, textOverride, sectionsOverride) {
    const text = textOverride || sections[secId]
    if (!text || text.length < 50) return
    const sec = SECTIONS.find(s => s.id === secId)
    setScoring(s => ({ ...s, [secId]: true }))
    try {
      const result = await api.callAI({
        model: HAIKU, // Use Haiku for scoring
        max_tokens: 600,
        system: `You are an expert NIH grant reviewer. Score this section on the NIH 1-9 scale (1=best). Return ONLY valid JSON: {"score":2,"descriptor":"Outstanding","strengths":["..."],"weaknesses":["..."],"narrative":"..."}`,
        messages: [{ role: 'user', content: `Section: ${sec.label}\nMechanism: ${mech}\n\n${text.slice(0, 6000)}\n\nScore this section. Return only JSON.` }],
      }, 'score_section')
      const raw = result.content.map(b => b.text || '').join('').replace(/```json|```/g, '').trim()
      const scored = JSON.parse(raw)
      const updatedScores = { ...scores, [secId]: scored }
      setScores(updatedScores)
      await save(sectionsOverride || sections, updatedScores)
    } catch (e) {
      console.error('Score failed:', e)
    }
    setScoring(s => ({ ...s, [secId]: false }))
  }

  function getStrategyPages() {
    const words = ['sig', 'innov', 'approach'].reduce((acc, id) => acc + countWords(sections[id]), 0)
    return estimatePages(words)
  }

  function getComplianceStatus(secId) {
    const sec = SECTIONS.find(s => s.id === secId)
    if (!sec?.pageLimit) return null
    const text = sections[secId] || ''
    const words = countWords(text)
    const pages = estimatePages(words)
    let limit, label
    if (sec.pageLimit === 'aims') { limit = m.aims; label = 'Specific Aims' }
    else if (sec.pageLimit === 'strategy') { limit = m.strategy; label = 'Research Strategy (Sig+Innov+Approach combined)'; return { pages: getStrategyPages(), limit, label } }
    else if (sec.pageLimit === 'commercial') { limit = m.commercial; label = 'Commercialization' }
    else return null
    return { pages, limit, label }
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={ghostBtn}>← Grants</button>
        <input
          value={title}
          onChange={e => { setTitle(e.target.value); setSaveState('unsaved') }}
          onBlur={() => save()}
          style={{ flex: 1, fontSize: 16, fontWeight: 500, border: 'none', outline: 'none', background: 'transparent' }}
          placeholder="Grant title"
        />
        <span style={{ fontSize: 12, color: saveState === 'error' ? 'red' : '#999' }}>
          {saveState === 'saving' ? 'Saving...' : saveState === 'unsaved' ? 'Unsaved' : saveState === 'error' ? 'Save failed' : 'Saved'}
        </span>
        <button onClick={() => save()} style={ghostBtn}>Save</button>
      </div>

      {/* Top tabs */}
      <div style={tabRow}>
        {['setup', 'writer', 'full'].map(t => (
          <button key={t} onClick={() => setActiveTab(t)} style={tabBtn(activeTab === t)}>
            {t === 'setup' ? 'Project setup' : t === 'writer' ? 'Section writer' : 'Full grant'}
          </button>
        ))}
      </div>

      {/* SETUP TAB */}
      {activeTab === 'setup' && (
        <div>
          <div style={limitsBox}>{getLimitsText(mech, setup.institute)}</div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={secLabel}>Mechanism</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {Object.entries(MECHANISMS).map(([key, val]) => (
                <button key={key} onClick={() => setMech(key)} style={mechBtn(mech === key)}>{val.label}</button>
              ))}
            </div>
          </div>
          <div style={{ marginBottom: '1rem' }}>
            <div style={secLabel}>NIH Institute (Optional)</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button onClick={() => setSetup(s => ({ ...s, institute: '' }))} style={mechBtn(!setup.institute)}>
                Generic NIH
              </button>
              {Object.entries(INSTITUTES).map(([key, val]) => (
                <button key={key} onClick={() => setSetup(s => ({ ...s, institute: key }))} style={mechBtn(setup.institute === key)}>
                  {key}
                </button>
              ))}
            </div>
            {setup.institute && INSTITUTES[setup.institute] && (
              <div style={{ fontSize: 12, color: '#666', marginTop: 8, padding: '8px 12px', background: '#f8f8f8', borderRadius: 6 }}>
                <strong>{INSTITUTES[setup.institute].name}</strong>
                <br />Priorities: {INSTITUTES[setup.institute].priorities}
                {INSTITUTES[setup.institute].special_programs && (
                  <>
                    <br />Programs: {INSTITUTES[setup.institute].special_programs.join(' · ')}
                  </>
                )}
              </div>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <Field label="PI / Small business" col="1/-1"><input style={inputStyle} value={setup.pi} onChange={e => setSetup(s => ({ ...s, pi: e.target.value }))} placeholder="e.g. COARE Holdings Inc." /></Field>
            <Field label="Academic partner (STTR)"><input style={inputStyle} value={setup.partner} onChange={e => setSetup(s => ({ ...s, partner: e.target.value }))} placeholder="e.g. OUHSC" /></Field>
            <Field label="NIH institute / PA"><input style={inputStyle} value={setup.pa} onChange={e => setSetup(s => ({ ...s, pa: e.target.value }))} placeholder="e.g. NCI PA-24-185" /></Field>
            <Field label="Target disease / indication" col="1/-1"><input style={inputStyle} value={setup.disease} onChange={e => setSetup(s => ({ ...s, disease: e.target.value }))} placeholder="e.g. Platinum-resistant HGSOC" /></Field>
            <Field label="Scientific premise / key biology" col="1/-1"><textarea style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }} value={setup.biology} onChange={e => setSetup(s => ({ ...s, biology: e.target.value }))} placeholder="Core rationale, targets, prior data, unmet need..." /></Field>
            <Field label="Specific aims outline" col="1/-1"><textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={setup.aims} onChange={e => setSetup(s => ({ ...s, aims: e.target.value }))} placeholder="Aim 1: Validate... Aim 2: Demonstrate..." /></Field>
            <Field label="Budget period"><input style={inputStyle} value={setup.budget} onChange={e => setSetup(s => ({ ...s, budget: e.target.value }))} placeholder="e.g. 2 years, $400K" /></Field>
            <Field label="Commercialization path (STTR/SBIR)" col="1/-1"><textarea style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }} value={setup.commercial} onChange={e => setSetup(s => ({ ...s, commercial: e.target.value }))} placeholder="Market, IP, regulatory, Phase II milestones..." /></Field>
          </div>
          <button style={{ ...ghostBtn, marginTop: '1rem' }} onClick={() => { save(); setActiveTab('writer') }}>Save & go to writer →</button>
        </div>
      )}

      {/* WRITER TAB */}
      {activeTab === 'writer' && (
        <div>
          <div style={limitsBox}>{getLimitsText(mech, setup.institute)}</div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: '1rem' }}>
            {visibleSecs.map(s => {
              const hasText = !!sections[s.id]
              const sc = scores[s.id]
              return (
                <button key={s.id} onClick={() => setActiveSec(s.id)} style={{ ...mechBtn(activeSec === s.id), position: 'relative' }}>
                  {s.label}
                  {hasText && <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc ? (sc.score <= 3 ? '#4caf50' : sc.score <= 5 ? '#ff9800' : '#e53935') : '#4caf50', position: 'absolute', top: 4, right: 4 }} />}
                </button>
              )
            })}
          </div>

          {visibleSecs.map(sec => activeSec !== sec.id ? null : (
            <div key={sec.id}>
              <ComplianceBar compliance={getComplianceStatus(sec.id)} />
              <button
                disabled={generating[sec.id]}
                onClick={() => generateSection(sec.id)}
                style={{ ...ghostBtn, marginBottom: 8, fontWeight: 500 }}
              >
                {generating[sec.id] ? 'Writing...' : sections[sec.id] ? 'Regenerate ↗' : `Generate ${sec.label} ↗`}
              </button>

              {scores[sec.id] && (
                <ScoreBar
                  score={scores[sec.id]}
                  label={sec.label}
                  loading={scoring[sec.id]}
                  onRescore={() => scoreSection(sec.id)}
                />
              )}

              <textarea
                value={sections[sec.id] || ''}
                onChange={e => { updateSection(sec.id, e.target.value) }}
                onBlur={() => save()}
                style={{ ...inputStyle, minHeight: 280, resize: 'vertical', width: '100%', lineHeight: 1.8, fontFamily: 'Georgia, serif', fontSize: 13 }}
                placeholder={`Your ${sec.label} text will appear here. Click Generate or paste your own.`}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                <span style={{ fontSize: 11, color: '#999' }}>
                  {countWords(sections[sec.id] || '')} words · ~{estimatePages(countWords(sections[sec.id] || '')).toFixed(1)} pages
                </span>
                {sections[sec.id] && !scores[sec.id] && (
                  <button onClick={() => scoreSection(sec.id)} disabled={scoring[sec.id]} style={{ ...ghostBtn, fontSize: 11 }}>
                    {scoring[sec.id] ? 'Scoring...' : 'Score this section'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* FULL GRANT TAB */}
      {activeTab === 'full' && (
        <div>
          <FullGrantCompliance sections={sections} scores={scores} mech={mech} />
          {visibleSecs.map(sec => (
            <div key={sec.id} style={{ marginBottom: '1.5rem' }}>
              <div style={{ fontSize: 14, fontWeight: 500, borderBottom: '0.5px solid #e5e5e5', paddingBottom: 5, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                {sec.label}
                {scores[sec.id] && <span style={{ fontSize: 11, color: '#888', fontWeight: 400 }}>· Score: {scores[sec.id].score} — {scores[sec.id].descriptor || getDescriptor(scores[sec.id].score)}</span>}
                <span style={{ marginLeft: 'auto', fontSize: 11, color: '#999', fontWeight: 400 }}>
                  {sections[sec.id] ? `${countWords(sections[sec.id])} words · ~${estimatePages(countWords(sections[sec.id])).toFixed(1)} pp` : ''}
                </span>
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: sections[sec.id] ? '#111' : '#999', fontStyle: sections[sec.id] ? 'normal' : 'italic', fontFamily: 'Georgia, serif' }}>
                {sections[sec.id] || 'Not yet generated'}
              </div>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
            <button style={ghostBtn} onClick={() => copyAll(visibleSecs, sections, title, mech)}>Copy full text</button>
            <button style={ghostBtn} onClick={() => downloadTxt(visibleSecs, sections, title, mech)}>Download .txt</button>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, col, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5, gridColumn: col }}>
      <label style={{ fontSize: 11, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</label>
      {children}
    </div>
  )
}

function ComplianceBar({ compliance }) {
  if (!compliance) return null
  const { pages, limit, label } = compliance
  const pct = Math.min(100, (pages / limit) * 100)
  const over = pages > limit
  const warn = pct > 85
  const color = over ? '#e53935' : warn ? '#f57c00' : '#388e3c'
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 11, color: '#888', flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
        <div style={{ flex: 2, height: 5, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 3, transition: 'width .3s' }} />
        </div>
        <span style={{ fontSize: 11, fontWeight: 500, color, minWidth: 80, textAlign: 'right' }}>{pages.toFixed(1)} / {limit} pp</span>
      </div>
      {over && <div style={{ fontSize: 11, color: '#e53935', marginTop: 4 }}>Over limit — cut ~{Math.ceil((pages - limit) * WORDS_PER_PAGE)} words before submitting.</div>}
    </div>
  )
}

function ScoreBar({ score, label, loading, onRescore }) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: '#f8f8f8', borderRadius: 8, marginBottom: 8 }}>
      <div style={{ fontSize: 24, fontWeight: 500, minWidth: 28 }}>{loading ? '↻' : score.score}</div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 11, color: '#888' }}>{label} · live score</div>
        <div style={{ fontSize: 13, fontWeight: 500 }}>{score.descriptor || getDescriptor(score.score)}</div>
        {score.narrative && <div style={{ fontSize: 12, color: '#555', marginTop: 4, lineHeight: 1.6 }}>{score.narrative}</div>}
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
          {(score.strengths || []).slice(0, 2).map((s, i) => <span key={i} style={pill}>✓ {s.slice(0, 45)}</span>)}
          {(score.weaknesses || []).slice(0, 2).map((w, i) => <span key={i} style={pill}>△ {w.slice(0, 45)}</span>)}
        </div>
      </div>
      <button onClick={onRescore} disabled={loading} style={{ ...ghostBtn, fontSize: 11 }}>Re-score</button>
    </div>
  )
}

function FullGrantCompliance({ sections, scores, mech }) {
  const m = MECHANISMS[mech] || MECHANISMS['STTR-I']
  const aimsPages = estimatePages(countWords(sections.aims || ''))
  const stratWords = ['sig', 'innov', 'approach'].reduce((a, id) => a + countWords(sections[id] || ''), 0)
  const stratPages = estimatePages(stratWords)
  const violations = []
  if (aimsPages > 1.05) violations.push(`Specific Aims: ${aimsPages.toFixed(1)} pp (limit 1)`)
  if (stratPages > m.strategy * 1.02) violations.push(`Research Strategy: ${stratPages.toFixed(1)} pp (limit ${m.strategy})`)
  if (m.needsCommercial) {
    const cp = estimatePages(countWords(sections.commercial || ''))
    if (cp > m.commercial * 1.02) violations.push(`Commercialization: ${cp.toFixed(1)} pp (limit ${m.commercial})`)
  }
  return (
    <div style={{ ...limitsBox, marginBottom: '1.5rem', color: violations.length ? '#b71c1c' : '#2e7d32', borderColor: violations.length ? '#e53935' : '#4caf50', background: violations.length ? '#ffebee' : '#f1f8e9' }}>
      {violations.length
        ? `Formatting violations: ${violations.join(' · ')} — Fix before submitting.`
        : `Formatting check passed. All sections within NIH page limits for ${m.label}. Verify font, margins, and single-column in your final PDF.`
      }
    </div>
  )
}

function copyAll(secs, sections, title, mech) {
  let text = `${title}\n${MECHANISMS[mech]?.label || mech}\n\n`
  secs.forEach(s => { text += `--- ${s.label.toUpperCase()} ---\n${sections[s.id] || '(not generated)'}\n\n` })
  navigator.clipboard.writeText(text)
}

function downloadTxt(secs, sections, title, mech) {
  let text = `${title}\n${MECHANISMS[mech]?.label || mech}\n\n`
  secs.forEach(s => { text += `--- ${s.label.toUpperCase()} ---\n${sections[s.id] || '(not generated)'}\n\n` })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
  a.download = title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.txt'
  a.click()
}

const ghostBtn = { padding: '6px 14px', fontSize: 13, border: '0.5px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#111' }
const mechBtn = active => ({ ...ghostBtn, background: active ? '#f5f5f5' : '#fff', fontWeight: active ? 500 : 400, borderColor: active ? '#bbb' : '#e5e5e5' })
const tabRow = { display: 'flex', borderBottom: '0.5px solid #e5e5e5', marginBottom: '1.5rem' }
const tabBtn = active => ({ padding: '8px 16px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', color: active ? '#111' : '#888', fontWeight: active ? 500 : 400, borderBottom: active ? '2px solid #111' : '2px solid transparent', marginBottom: '-0.5px' })
const inputStyle = { border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', color: '#111', background: '#fff', width: '100%' }
const secLabel = { fontSize: 11, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }
const limitsBox = { fontSize: 12, color: '#555', background: '#f8f8f8', border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '8px 12px', marginBottom: '1rem', lineHeight: 1.7 }
const pill = { fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#fff', border: '0.5px solid #e5e5e5', color: '#666' }
