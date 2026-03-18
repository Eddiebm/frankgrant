import { useState, useCallback, useEffect, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import PreliminaryData from './PreliminaryData'
import {
  MECHANISMS, SECTIONS, WORDS_PER_PAGE, INSTITUTES,
  getDescriptor, getLimitsText, getCommercialLabel, getProjectRules
} from '../lib/nih.js'
import { countWords, estimatePages } from '../lib/compression.js'
import { PROFESSOR_SYSTEM, professorWritePrompt, polishPrompt } from '../lib/personas.js'

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
  const [foaNumber, setFoaNumber] = useState(project.foa_number || '')
  const [foaRules, setFoaRules] = useState(project.foa_rules || null)
  const [foaValid, setFoaValid] = useState(project.foa_valid || false)
  const [foaLoading, setFoaLoading] = useState(false)
  const [foaError, setFoaError] = useState(null)
  const [referenceGrants, setReferenceGrants] = useState(project.reference_grants || [])
  const [complianceResults, setComplianceResults] = useState(project.compliance_results || {})

  const [activeTab, setActiveTab] = useState('setup')
  const [activeSec, setActiveSec] = useState('aims')
  const [generating, setGenerating] = useState({})
  const [scoring, setScoring] = useState({})
  const [saveState, setSaveState] = useState('saved')
  const [showGrantDrawer, setShowGrantDrawer] = useState(false)
  const [complianceExpanded, setComplianceExpanded] = useState({})
  const [compliancePolling, setCompliancePolling] = useState({})

  // Grant search state
  const [grantSearchQuery, setGrantSearchQuery] = useState(setup.disease || '')
  const [grantSearchResults, setGrantSearchResults] = useState([])
  const [grantSearchLoading, setGrantSearchLoading] = useState(false)
  const [grantSearchError, setGrantSearchError] = useState(null)
  const [analyzingGrant, setAnalyzingGrant] = useState({})
  const [addedGrants, setAddedGrants] = useState({})

  // Preliminary data state
  const [showPrelimDrawer, setShowPrelimDrawer] = useState(false)
  const [prelimScore, setPrelimScore] = useState(project.prelim_data_score || 0)

  // Citations state per section
  const [citationSection, setCitationSection] = useState(null)
  const [citationResults, setCitationResults] = useState({})
  const [citationLoading, setCitationLoading] = useState({})

  const pollTimers = useRef({})

  const m = MECHANISMS[mech] || MECHANISMS['STTR-I']
  const visibleSecs = SECTIONS.filter(s => s.id !== 'commercial' || m.needsCommercial)

  function getProject() {
    return {
      title, mechanism: mech, pi: setup.pi, partner: setup.partner,
      disease: setup.disease, biology: setup.biology, aims: setup.aims,
      pa: setup.pa, budget: setup.budget, commercial: setup.commercial,
      reference_grants: referenceGrants,
      prelim_data_narrative: project.prelim_data_narrative || null,
      prelim_data_gaps: project.prelim_data_gaps || null,
    }
  }

  async function save(updatedSections, updatedScores, updatedFoaRules) {
    setSaveState('saving')
    try {
      await onSave({
        title, mechanism: mech, setup,
        sections: updatedSections || sections,
        scores: updatedScores || scores,
        foa_number: foaNumber || null,
        foa_rules: updatedFoaRules !== undefined ? updatedFoaRules : foaRules,
        foa_valid: foaValid ? 1 : 0,
        reference_grants: referenceGrants,
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

  // ── FOA Parse ──────────────────────────────────────────────────────────────
  async function handleFOABlur() {
    const foa = foaNumber.trim()
    if (!foa || foa === project.foa_number) return
    setFoaLoading(true)
    setFoaError(null)
    try {
      const result = await api.parseFOA(foa)
      if (result.error) {
        setFoaError('fallback')
        setFoaRules(null)
        setFoaValid(false)
      } else {
        setFoaRules(result.rules)
        setFoaValid(result.valid)
        setFoaError(null)
        // Auto-fill mechanism if detected
        if (result.rules?.activity_codes?.length > 0) {
          const codeMap = { U43: 'STTR-I', U44: 'STTR-II', R43: 'SBIR-I', R44: 'SBIR-II', R01: 'R01', R21: 'R21', K99: 'K99' }
          const detected = codeMap[result.rules.activity_codes[0]]
          if (detected) setMech(detected)
        }
        await save(sections, scores, result.rules)
      }
    } catch (e) {
      setFoaError('fallback')
    }
    setFoaLoading(false)
  }

  // ── Section generation ─────────────────────────────────────────────────────
  async function generateSection(secId) {
    setGenerating(g => ({ ...g, [secId]: true }))
    // Clear old compliance for this section
    setComplianceResults(cr => { const n = { ...cr }; delete n[secId]; return n })

    try {
      const maxTokensBySection = {
        'summary': 800, 'narrative': 300, 'aims': 1200, 'sig': 1000, 'innov': 1000,
        'approach': 2500, 'data_mgmt': 1000, 'facilities': 800,
        'commercial': m.commercialType === 'potential' ? 800 : 1500
      }

      const result = await api.callAI({
        model: SONNET,
        max_tokens: maxTokensBySection[secId] || 1500,
        system: PROFESSOR_SYSTEM,
        messages: [{ role: 'user', content: professorWritePrompt(secId, getProject(), mech) }],
        _project_id: project.id,
        _mechanism: mech,
      }, `write_${secId}`)

      const text = result.content.map(b => b.text || '').join('')
      const updated = updateSection(secId, text)
      await save(updated, scores)
      scoreSection(secId, text, updated)

      // Start compliance polling
      startCompliancePolling(secId)
    } catch (e) {
      alert('Generation failed: ' + e.message)
    }
    setGenerating(g => ({ ...g, [secId]: false }))
  }

  // ── Compliance polling ─────────────────────────────────────────────────────
  function startCompliancePolling(secId) {
    if (!project.id) return
    // Clear any existing poll for this section
    if (pollTimers.current[secId]) {
      clearInterval(pollTimers.current[secId])
    }

    let pollCount = 0
    setCompliancePolling(p => ({ ...p, [secId]: true }))

    const interval = setInterval(async () => {
      pollCount++
      try {
        const results = await api.getCompliance(project.id)
        if (results[secId]) {
          setComplianceResults(cr => ({ ...cr, [secId]: results[secId] }))
          clearInterval(interval)
          delete pollTimers.current[secId]
          setCompliancePolling(p => ({ ...p, [secId]: false }))
          return
        }
      } catch (e) {
        // ignore poll errors
      }
      if (pollCount >= 10) {
        clearInterval(interval)
        delete pollTimers.current[secId]
        setCompliancePolling(p => ({ ...p, [secId]: false }))
      }
    }, 4000)

    pollTimers.current[secId] = interval
  }

  async function recheckCompliance(secId) {
    const text = sections[secId]
    if (!text || !project.id) return
    // Trigger a re-check by calling AI with action write_ (which fires compliance)
    // Instead: call generateSection would overwrite content, so we do a direct re-check
    // by calling the AI compliance endpoint directly from frontend
    setCompliancePolling(p => ({ ...p, [secId]: true }))
    setComplianceResults(cr => { const n = { ...cr }; delete n[secId]; return n })

    try {
      // Call AI with compliance action — doesn't overwrite section, just triggers compliance
      await api.callAI({
        model: HAIKU,
        max_tokens: 500,
        messages: [{ role: 'user', content: `Re-check compliance for this section.\n\n${text.slice(0, 3000)}` }],
        _project_id: project.id,
        _mechanism: mech,
      }, `write_${secId}`)
      startCompliancePolling(secId)
    } catch (e) {
      setCompliancePolling(p => ({ ...p, [secId]: false }))
    }
  }

  // Cleanup polls on unmount
  useEffect(() => {
    return () => {
      Object.values(pollTimers.current).forEach(t => clearInterval(t))
    }
  }, [])

  // ── Section scoring ────────────────────────────────────────────────────────
  async function scoreSection(secId, textOverride, sectionsOverride) {
    const text = textOverride || sections[secId]
    if (!text || text.length < 50) return
    const sec = SECTIONS.find(s => s.id === secId)
    setScoring(s => ({ ...s, [secId]: true }))
    try {
      const result = await api.callAI({
        model: HAIKU,
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
    else if (sec.pageLimit === 'commercial') { limit = m.commercial; label = getCommercialLabel(mech) || 'Commercialization' }
    else if (sec.pageLimit === 'dataManagement') { limit = m.dataManagement || 2; label = 'Data Management Plan' }
    else return null
    return { pages, limit, label }
  }

  // ── NIH Reporter Grant Search ──────────────────────────────────────────────
  async function handleGrantSearch() {
    if (!grantSearchQuery.trim()) return
    setGrantSearchLoading(true)
    setGrantSearchError(null)
    setGrantSearchResults([])
    try {
      const result = await api.searchGrants({
        keywords: grantSearchQuery,
        mechanism: mech,
        fiscal_years: [2023, 2024, 2025],
      })
      setGrantSearchResults(result.results || [])
      if (!result.results?.length) setGrantSearchError('No results found. Try broader keywords.')
    } catch (e) {
      setGrantSearchError('Search failed: ' + e.message)
    }
    setGrantSearchLoading(false)
  }

  async function handleUseAsReference(grant, index) {
    setAnalyzingGrant(a => ({ ...a, [index]: true }))
    try {
      const result = await api.analyzeGrant(grant.abstract)
      await api.saveReference(project.id, grant.title, grant.abstract, result.analysis)
      const newRefs = [...referenceGrants, {
        grant_title: grant.title, grant_abstract: grant.abstract.slice(0, 500),
        analysis: result.analysis, saved_at: Math.floor(Date.now() / 1000)
      }]
      if (newRefs.length > 5) newRefs.splice(0, newRefs.length - 5)
      setReferenceGrants(newRefs)
      setAddedGrants(a => ({ ...a, [index]: true }))
    } catch (e) {
      alert('Could not analyze grant: ' + e.message)
    }
    setAnalyzingGrant(a => ({ ...a, [index]: false }))
  }

  async function handleFindCitations(secId) {
    const text = sections[secId]
    if (!text) return
    setCitationSection(secId)
    setCitationLoading(l => ({ ...l, [secId]: true }))
    try {
      const result = await api.getCitations(text, secId)
      setCitationResults(r => ({ ...r, [secId]: result.citations || [] }))
    } catch (e) {
      setCitationResults(r => ({ ...r, [secId]: [] }))
    }
    setCitationLoading(l => ({ ...l, [secId]: false }))
  }

  function handleInsertCitation(secId, citationText) {
    const current = sections[secId] || ''
    const updated = updateSection(secId, current + '\n\n' + citationText)
    save(updated, scores)
  }

  return (
    <div style={{ maxWidth: (showGrantDrawer || showPrelimDrawer) ? 'none' : 900, margin: '0 auto', padding: '1.5rem', display: 'flex', gap: 0 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
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
          <button
            onClick={() => { setShowPrelimDrawer(d => !d); setShowGrantDrawer(false) }}
            style={{ ...ghostBtn, fontSize: 12, background: showPrelimDrawer ? '#f0f0f0' : '#fff', position: 'relative' }}
            title="Preliminary data"
          >
            📎 Prelim
            {prelimScore > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, background: prelimScore >= 70 ? '#16a34a' : '#d97706', color: '#fff', borderRadius: 10, padding: '1px 6px' }}>
                {prelimScore}
              </span>
            )}
          </button>
          <button
            onClick={() => { setShowGrantDrawer(d => !d); setShowPrelimDrawer(false) }}
            style={{ ...ghostBtn, fontSize: 12, background: showGrantDrawer ? '#f0f0f0' : '#fff', position: 'relative' }}
            title="Find funded NIH grants"
          >
            🔍 Grants
            {referenceGrants.length > 0 && (
              <span style={{ marginLeft: 5, fontSize: 10, background: '#111', color: '#fff', borderRadius: 10, padding: '1px 6px' }}>
                {referenceGrants.length}/5
              </span>
            )}
          </button>
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

            {/* FOA Number Field */}
            <div style={{ marginBottom: '1rem', padding: '10px 14px', background: '#f8f8f8', border: '0.5px solid #e5e5e5', borderRadius: 8 }}>
              <div style={secLabel}>FOA / RFA Number (optional — auto-imports page limits)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  style={{ ...inputStyle, flex: 1 }}
                  value={foaNumber}
                  onChange={e => { setFoaNumber(e.target.value.toUpperCase()); setFoaError(null) }}
                  onBlur={handleFOABlur}
                  placeholder="e.g. PA-24-185 or RFA-CA-24-001"
                />
                {foaLoading && <span style={{ fontSize: 12, color: '#888' }}>Fetching…</span>}
              </div>
              {foaRules && foaValid && !foaError && <FOAConfirmCard rules={foaRules} foaNumber={foaNumber} />}
              {foaError === 'fallback' && (
                <div style={{ fontSize: 12, color: '#b45309', marginTop: 8, padding: '6px 10px', background: '#fef3c7', borderRadius: 6 }}>
                  FOA not found or couldn't be parsed — using default page limits for selected mechanism.
                </div>
              )}
            </div>

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
                <button onClick={() => setSetup(s => ({ ...s, institute: '' }))} style={mechBtn(!setup.institute)}>Generic NIH</button>
                {Object.entries(INSTITUTES).map(([key, val]) => (
                  <button key={key} onClick={() => setSetup(s => ({ ...s, institute: key }))} style={mechBtn(setup.institute === key)}>{key}</button>
                ))}
              </div>
              {setup.institute && INSTITUTES[setup.institute] && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 8, padding: '8px 12px', background: '#f8f8f8', borderRadius: 6 }}>
                  <strong>{INSTITUTES[setup.institute].name}</strong>
                  <br />Priorities: {INSTITUTES[setup.institute].priorities}
                  {INSTITUTES[setup.institute].special_programs && (
                    <><br />Programs: {INSTITUTES[setup.institute].special_programs.join(' · ')}</>
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
                  <ScoreBar score={scores[sec.id]} label={sec.label} loading={scoring[sec.id]} onRescore={() => scoreSection(sec.id)} />
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

                {/* Inline Compliance Panel */}
                <CompliancePanel
                  secId={sec.id}
                  result={complianceResults[sec.id]}
                  polling={compliancePolling[sec.id]}
                  expanded={complianceExpanded[sec.id]}
                  onToggle={() => setComplianceExpanded(e => ({ ...e, [sec.id]: !e[sec.id] }))}
                  onRecheck={() => recheckCompliance(sec.id)}
                  hasText={!!sections[sec.id]}
                />

                {/* Citations */}
                {sections[sec.id] && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => citationSection === sec.id ? setCitationSection(null) : handleFindCitations(sec.id)}
                      disabled={citationLoading[sec.id]}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}
                    >
                      {citationLoading[sec.id] ? '⟳ Searching PubMed…' : citationSection === sec.id && citationResults[sec.id] ? '▲ Hide Citations' : '📚 Find Citations'}
                    </button>
                    {citationSection === sec.id && citationResults[sec.id] && (
                      <CitationsPanel
                        citations={citationResults[sec.id]}
                        onInsert={(cite) => handleInsertCitation(sec.id, cite)}
                        onRefresh={() => handleFindCitations(sec.id)}
                      />
                    )}
                  </div>
                )}
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

      {/* Preliminary Data Drawer */}
      {showPrelimDrawer && (
        <div style={{
          width: 400, flexShrink: 0, borderLeft: '0.5px solid #e5e5e5', marginLeft: 20,
          paddingLeft: 20, maxHeight: '90vh', overflowY: 'auto',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontWeight: 600, fontSize: 14 }}>Preliminary Data</div>
            <button onClick={() => setShowPrelimDrawer(false)} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}>✕</button>
          </div>
          <PreliminaryData
            projectId={project.id}
            onNarrativeGenerated={(narrative) => {
              const updated = updateSection('approach', (sections.approach || '') + '\n\nPRELIMINARY DATA:\n' + narrative)
              save(updated, scores)
              setShowPrelimDrawer(false)
            }}
          />
        </div>
      )}

      {/* Grant Search Drawer */}
      {showGrantDrawer && (
        <GrantSearchDrawer
          query={grantSearchQuery}
          onQueryChange={setGrantSearchQuery}
          results={grantSearchResults}
          loading={grantSearchLoading}
          error={grantSearchError}
          onSearch={handleGrantSearch}
          onUseAsReference={handleUseAsReference}
          analyzingGrant={analyzingGrant}
          addedGrants={addedGrants}
          referenceCount={referenceGrants.length}
          onClose={() => setShowGrantDrawer(false)}
          mech={mech}
        />
      )}
    </div>
  )
}

// ── FOA Confirmation Card ───────────────────────────────────────────────────
function FOAConfirmCard({ rules, foaNumber }) {
  const nihUrl = `https://grants.nih.gov/grants/guide/pa-files/${foaNumber}.html`
  return (
    <div style={{ marginTop: 10, padding: '10px 12px', background: '#f0fdf4', border: '0.5px solid #86efac', borderRadius: 8, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, color: '#166534' }}>✓ FOA loaded: {rules.foa_number || foaNumber}</span>
        <a href={nihUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#166534' }}>View on NIH →</a>
      </div>
      {rules.title && <div style={{ color: '#166534', marginBottom: 4, fontWeight: 500 }}>{rules.title}</div>}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', color: '#15803d' }}>
        {rules.mechanism && <span>Mechanism: {rules.mechanism}</span>}
        {rules.institute && <span>Institute: {rules.institute}</span>}
        {rules.due_dates?.length > 0 && <span>Due: {rules.due_dates[0]}</span>}
        {rules.research_strategy_pages && <span>Strategy: {rules.research_strategy_pages} pages</span>}
        {rules.budget_total_costs && <span>Budget: ${(rules.budget_total_costs / 1000).toFixed(0)}K total</span>}
        {!rules.budget_total_costs && rules.budget_notes && <span>{rules.budget_notes}</span>}
      </div>
      {rules.program_priorities?.length > 0 && (
        <div style={{ marginTop: 6, color: '#166534' }}>
          <span style={{ fontWeight: 500 }}>Priorities: </span>
          {rules.program_priorities.slice(0, 3).join(' · ')}
        </div>
      )}
    </div>
  )
}

// ── Compliance Panel ────────────────────────────────────────────────────────
function CompliancePanel({ secId, result, polling, expanded, onToggle, onRecheck, hasText }) {
  if (!hasText && !result && !polling) return null

  const issues = result?.issues || []
  const criticals = issues.filter(i => i.severity === 'critical').length
  const warnings = issues.filter(i => i.severity === 'warning').length

  let statusLabel, statusColor, statusBg
  if (polling) {
    statusLabel = 'Checking compliance…'
    statusColor = '#888'
    statusBg = '#f8f8f8'
  } else if (!result) {
    return null
  } else if (criticals > 0) {
    statusLabel = `${criticals} critical issue${criticals > 1 ? 's' : ''}`
    statusColor = '#dc2626'
    statusBg = '#fef2f2'
  } else if (warnings > 0) {
    statusLabel = `${warnings} warning${warnings > 1 ? 's' : ''}`
    statusColor = '#d97706'
    statusBg = '#fffbeb'
  } else {
    statusLabel = 'Compliant'
    statusColor = '#16a34a'
    statusBg = '#f0fdf4'
  }

  return (
    <div style={{ marginTop: 8, border: '0.5px solid #e5e5e5', borderRadius: 8, overflow: 'hidden', fontSize: 12 }}>
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 12px', background: statusBg, cursor: polling ? 'default' : 'pointer' }}
        onClick={!polling && result ? onToggle : undefined}
      >
        {polling ? (
          <span style={{ color: statusColor }}>⟳ {statusLabel}</span>
        ) : (
          <>
            <span style={{ color: statusColor, flex: 1 }}>
              {criticals > 0 ? '🔴' : warnings > 0 ? '🟡' : '✅'} {statusLabel}
            </span>
            <button
              onClick={e => { e.stopPropagation(); onRecheck() }}
              style={{ ...ghostBtn, fontSize: 11, padding: '2px 8px' }}
            >Re-check</button>
            <span style={{ color: '#888' }}>{expanded ? '▲' : '▼'}</span>
          </>
        )}
      </div>

      {expanded && issues.length > 0 && (
        <div style={{ padding: '8px 12px', background: '#fff' }}>
          {issues.map((issue, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '6px 0', borderBottom: i < issues.length - 1 ? '0.5px solid #f0f0f0' : 'none' }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>
                {issue.severity === 'critical' ? '🔴' : issue.severity === 'warning' ? '🟡' : '💡'}
              </span>
              <div>
                <div style={{ fontWeight: 600, color: '#111', marginBottom: 2 }}>{issue.element}</div>
                <div style={{ color: '#555', marginBottom: 2 }}>{issue.description}</div>
                <div style={{ color: '#888', fontStyle: 'italic' }}>{issue.fix}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {expanded && issues.length === 0 && result && (
        <div style={{ padding: '8px 12px', background: '#fff', color: '#16a34a', fontStyle: 'italic' }}>
          No compliance issues detected for this section.
        </div>
      )}
    </div>
  )
}

// ── Grant Search Drawer ─────────────────────────────────────────────────────
function GrantSearchDrawer({ query, onQueryChange, results, loading, error, onSearch, onUseAsReference, analyzingGrant, addedGrants, referenceCount, onClose, mech }) {
  const [expandedAbstracts, setExpandedAbstracts] = useState({})

  return (
    <div style={{
      width: 380, flexShrink: 0, borderLeft: '0.5px solid #e5e5e5', marginLeft: 20,
      paddingLeft: 20, display: 'flex', flexDirection: 'column', maxHeight: '90vh', overflowY: 'auto'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Find Funded Grants</div>
          <div style={{ fontSize: 11, color: '#888' }}>NIH Reporter · References {referenceCount}/5</div>
        </div>
        <button onClick={onClose} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 12 }}>✕</button>
      </div>

      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={query}
          onChange={e => onQueryChange(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && onSearch()}
          placeholder="Keywords (disease, target, approach)"
        />
        <button onClick={onSearch} disabled={loading} style={{ ...ghostBtn, fontWeight: 500, whiteSpace: 'nowrap' }}>
          {loading ? '…' : 'Search'}
        </button>
      </div>

      {error && <div style={{ fontSize: 12, color: '#b45309', marginBottom: 8 }}>{error}</div>}

      {loading && (
        <div style={{ fontSize: 12, color: '#888', textAlign: 'center', padding: '20px 0' }}>
          Searching NIH Reporter…
        </div>
      )}

      {results.map((grant, i) => (
        <div key={i} style={{ border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '10px 12px', marginBottom: 8 }}>
          <div style={{ fontWeight: 500, fontSize: 12, marginBottom: 4, lineHeight: 1.4 }}>{grant.title}</div>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
            {grant.pi_name} · {grant.organization}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 11, color: '#888', marginBottom: 6, flexWrap: 'wrap' }}>
            {grant.activity_code && <span style={pill}>{grant.activity_code}</span>}
            {grant.institute && <span style={pill}>{grant.institute}</span>}
            {grant.fiscal_year && <span style={pill}>FY{grant.fiscal_year}</span>}
            {grant.award_amount && <span style={pill}>${(grant.award_amount / 1000).toFixed(0)}K</span>}
          </div>
          {grant.abstract && (
            <div style={{ fontSize: 11, color: '#555', lineHeight: 1.5, marginBottom: 6 }}>
              {expandedAbstracts[i] ? grant.abstract : grant.abstract.slice(0, 160) + (grant.abstract.length > 160 ? '…' : '')}
              {grant.abstract.length > 160 && (
                <button
                  onClick={() => setExpandedAbstracts(e => ({ ...e, [i]: !e[i] }))}
                  style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 11, padding: '0 4px' }}
                >
                  {expandedAbstracts[i] ? ' Less' : ' More'}
                </button>
              )}
            </div>
          )}
          <button
            onClick={() => !addedGrants[i] && !analyzingGrant[i] && onUseAsReference(grant, i)}
            disabled={analyzingGrant[i] || addedGrants[i] || referenceCount >= 5}
            style={{
              ...ghostBtn, fontSize: 11, padding: '4px 10px', width: '100%', justifyContent: 'center',
              background: addedGrants[i] ? '#f0fdf4' : '#fff',
              color: addedGrants[i] ? '#16a34a' : referenceCount >= 5 ? '#999' : '#111',
              cursor: addedGrants[i] || referenceCount >= 5 ? 'default' : 'pointer',
            }}
          >
            {analyzingGrant[i] ? 'Analyzing…' : addedGrants[i] ? '✓ Added' : referenceCount >= 5 ? 'Max 5 references' : 'Use as Reference'}
          </button>
        </div>
      ))}

      {!loading && results.length === 0 && !error && (
        <div style={{ fontSize: 12, color: '#aaa', textAlign: 'center', padding: '20px 0' }}>
          Search for funded NIH grants to use as writing references.
          <br /><br />
          References inform framing and terminology in Significance, Innovation, and Approach sections.
        </div>
      )}
    </div>
  )
}

// ── Sub-components ──────────────────────────────────────────────────────────
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
        : `Formatting check passed. All sections within NIH page limits for ${m.label}. Verify font, margins, and single-column in your final PDF.`}
    </div>
  )
}

// ── Citations Panel ──────────────────────────────────────────────────────────
function CitationsPanel({ citations, onInsert, onRefresh }) {
  if (citations.length === 0) {
    return (
      <div style={{ marginTop: 8, padding: '10px 12px', border: '0.5px solid #e5e5e5', borderRadius: 8, fontSize: 12, color: '#888', fontStyle: 'italic' }}>
        No relevant citations found. Try adding more specific terminology to this section.
        <button onClick={onRefresh} style={{ ...ghostBtn, fontSize: 11, marginLeft: 8 }}>Try again</button>
      </div>
    )
  }
  return (
    <div style={{ marginTop: 8, border: '0.5px solid #e5e5e5', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ padding: '7px 12px', background: '#f8f8f8', fontSize: 11, fontWeight: 600, color: '#555', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>📚 {citations.length} relevant citation{citations.length !== 1 ? 's' : ''} from PubMed</span>
        <button onClick={onRefresh} style={{ ...ghostBtn, fontSize: 10, padding: '2px 8px' }}>Refresh</button>
      </div>
      {citations.map((cite, i) => (
        <div key={i} style={{ padding: '8px 12px', borderTop: '0.5px solid #f0f0f0' }}>
          <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2, lineHeight: 1.4 }}>{cite.title}</div>
          <div style={{ fontSize: 11, color: '#888', marginBottom: 4 }}>
            {cite.authors} · {cite.journal} {cite.year}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <a href={cite.pubmed_url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#3b82f6', textDecoration: 'none' }}>
              PubMed ↗
            </a>
            <button
              onClick={() => onInsert(cite.citation_text)}
              style={{ ...ghostBtn, fontSize: 10, padding: '2px 8px' }}
            >
              Insert
            </button>
          </div>
        </div>
      ))}
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
const inputStyle = { border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', color: '#111', background: '#fff', width: '100%', boxSizing: 'border-box' }
const secLabel = { fontSize: 11, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }
const limitsBox = { fontSize: 12, color: '#555', background: '#f8f8f8', border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '8px 12px', marginBottom: '1rem', lineHeight: 1.7 }
const pill = { fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#fff', border: '0.5px solid #e5e5e5', color: '#666' }
