import { useState, useCallback, useEffect, useRef } from 'react'
import { useApi } from '../hooks/useApi'
import PreliminaryData from './PreliminaryData'
import VoiceMode from './VoiceMode'
import { generateGrantDOCX } from '../lib/docxExport'
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
    human_subjects_involved: false, vert_animals_involved: false, select_agents_involved: false,
    is_resubmission: false, prior_application_number: '', prior_review_date: '',
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

  // DOCX export
  const [exportingDocx, setExportingDocx] = useState(false)

  // Study Section
  const [studySectionModal, setStudySectionModal] = useState(null) // null | 'progress' | 'results'
  const [studySectionStep, setStudySectionStep] = useState(0)
  const [studySectionResults, setStudySectionResults] = useState(project.study_section_results || null)

  // Polish
  const [polishModal, setPolishModal] = useState(null) // null | { secId, original, polished }
  const [polishing, setPolishing] = useState({})

  // PD Review
  const [pdReviewModal, setPdReviewModal] = useState(null) // null | 'loading' | 'results'
  const [pdReviewResults, setPdReviewResults] = useState(project.pd_review_results || null)

  // Advisory Council
  const [councilModal, setCouncilModal] = useState(null) // null | 'loading' | 'results'
  const [councilResults, setCouncilResults] = useState(project.advisory_council_results || null)

  // Voice Mode
  const [showVoiceMode, setShowVoiceMode] = useState(false)

  // Resubmission
  const [resubComments, setResubComments] = useState(project.reviewer_comments || '')
  const [resubAnalysis, setResubAnalysis] = useState(project.resubmission_analysis ? (() => { try { return JSON.parse(project.resubmission_analysis) } catch { return null } })() : null)
  const [resubAnalyzing, setResubAnalyzing] = useState(false)
  const [resubGeneratingIntro, setResubGeneratingIntro] = useState(false)
  const [resubRevising, setResubRevising] = useState({})

  const pollTimers = useRef({})

  const m = MECHANISMS[mech] || MECHANISMS['STTR-I']
  const visibleSecs = SECTIONS.filter(s => {
    if (s.id === 'commercial' && !m.needsCommercial) return false
    if (s.showForMechanisms && !s.showForMechanisms.includes(mech)) return false
    if (s.showWhen) {
      if (s.showWhen === 'is_resubmission' && !setup.is_resubmission) return false
      if (s.showWhen === 'human_subjects_involved' && !setup.human_subjects_involved) return false
      if (s.showWhen === 'vert_animals_involved' && !setup.vert_animals_involved) return false
      if (s.showWhen === 'select_agents_involved' && !setup.select_agents_involved) return false
    }
    return true
  })

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

  // ── DOCX Export ─────────────────────────────────────────────────────────────
  async function handleExportDOCX() {
    setExportingDocx(true)
    try {
      const buffer = await generateGrantDOCX(getProject(), sections, scores)
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (title || 'grant').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + e.message)
    }
    setExportingDocx(false)
  }

  // ── Study Section ────────────────────────────────────────────────────────────
  async function handleRunStudySection() {
    setStudySectionModal('progress')
    setStudySectionStep(0)
    const t1 = setTimeout(() => setStudySectionStep(1), 6000)
    const t2 = setTimeout(() => setStudySectionStep(2), 14000)
    const t3 = setTimeout(() => setStudySectionStep(3), 22000)
    try {
      const results = await api.runStudySection(project.id)
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      setStudySectionStep(3)
      setStudySectionResults(results)
      setTimeout(() => setStudySectionModal('results'), 400)
    } catch (e) {
      clearTimeout(t1); clearTimeout(t2); clearTimeout(t3)
      setStudySectionModal(null)
      alert('Study section simulation failed: ' + e.message)
    }
  }

  // ── PD Review ────────────────────────────────────────────────────────────────
  async function handleRunPDReview() {
    setPdReviewModal('loading')
    try {
      const results = await api.runPDReview(project.id)
      setPdReviewResults(results)
      setPdReviewModal('results')
    } catch (e) {
      setPdReviewModal(null)
      alert('PD Review failed: ' + e.message)
    }
  }

  // ── Advisory Council ──────────────────────────────────────────────────────────
  async function handleRunAdvisoryCouncil() {
    setCouncilModal('loading')
    try {
      const results = await api.runAdvisoryCouncil(project.id)
      setCouncilResults(results)
      setCouncilModal('results')
    } catch (e) {
      setCouncilModal(null)
      alert('Advisory Council review failed: ' + e.message)
    }
  }

  // ── Polish ───────────────────────────────────────────────────────────────────
  async function handlePolish(secId) {
    const text = sections[secId]
    if (!text) return
    setPolishing(p => ({ ...p, [secId]: true }))
    try {
      const sec = SECTIONS.find(s => s.id === secId)
      const result = await api.polishSection(project.id, secId, text, sec?.label || secId)
      setPolishModal({ secId, original: text, polished: result.polished })
    } catch (e) {
      alert('Polish failed: ' + e.message)
    }
    setPolishing(p => ({ ...p, [secId]: false }))
  }

  function handleAcceptPolish() {
    if (!polishModal) return
    const updated = updateSection(polishModal.secId, polishModal.polished)
    save(updated, scores)
    setPolishModal(null)
  }

  // ── Resubmission ─────────────────────────────────────────────────────────────
  async function handleImportReviewerComments() {
    if (!resubComments.trim()) return
    try {
      await api.importReviewerComments(project.id, resubComments)
    } catch (e) {
      alert('Import failed: ' + e.message)
    }
  }

  async function handleAnalyzeResubmission() {
    if (!resubComments.trim()) { alert('Paste reviewer comments first'); return }
    await handleImportReviewerComments()
    setResubAnalyzing(true)
    try {
      const result = await api.analyzeResubmission(project.id)
      setResubAnalysis(result)
    } catch (e) {
      alert('Analysis failed: ' + e.message)
    }
    setResubAnalyzing(false)
  }

  async function handleGenerateResubIntro() {
    setResubGeneratingIntro(true)
    try {
      const result = await api.generateResubmissionIntro(project.id)
      const updated = updateSection('intro', result.introduction)
      await save(updated, scores)
    } catch (e) {
      alert('Introduction generation failed: ' + e.message)
    }
    setResubGeneratingIntro(false)
  }

  async function handleReviseSection(secId) {
    const text = sections[secId]
    if (!text) return
    const sec = SECTIONS.find(s => s.id === secId)
    setResubRevising(r => ({ ...r, [secId]: true }))
    try {
      const result = await api.reviseForResubmission(project.id, secId, text, sec?.label || secId)
      const updated = updateSection(secId, result.revised_section)
      await save(updated, scores)
    } catch (e) {
      alert('Revision failed: ' + e.message)
    }
    setResubRevising(r => ({ ...r, [secId]: false }))
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
          <button
            onClick={handleExportDOCX}
            disabled={exportingDocx}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Export as Word document"
          >
            {exportingDocx ? '⟳' : '📄'} DOCX
          </button>
          <button
            onClick={() => studySectionResults ? setStudySectionModal('results') : handleRunStudySection()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Simulate NIH study section review"
          >
            🔬 {studySectionResults ? 'Review' : 'Study Section'}
          </button>
          <button
            onClick={() => pdReviewResults ? setPdReviewModal('results') : handleRunPDReview()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Get Program Director fundability assessment"
          >
            📋 {pdReviewResults ? 'PD Review' : 'PD Review'}
          </button>
          <button
            onClick={() => councilResults ? setCouncilModal('results') : handleRunAdvisoryCouncil()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Get Advisory Council funding recommendation"
          >
            🏛️ Council
          </button>
          <button
            onClick={() => setShowVoiceMode(true)}
            style={{ ...ghostBtn, fontSize: 12, background: '#0e7490', color: '#fff', borderColor: '#0e7490' }}
            title="Talk to your grant with AI voice assistant"
          >
            🎤 Voice Mode
          </button>
        </div>

        {/* Top tabs */}
        <div style={tabRow}>
          {['setup', 'writer', 'full', ...(setup.is_resubmission ? ['resubmission'] : [])].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} style={tabBtn(activeTab === t)}>
              {t === 'setup' ? 'Project setup' : t === 'writer' ? 'Section writer' : t === 'full' ? 'Full grant' : '🔄 Resubmission'}
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
            {/* Required sections toggles */}
            <div style={{ marginTop: 16, padding: '12px 16px', background: '#f8f8f8', border: '0.5px solid #e5e5e5', borderRadius: 8 }}>
              <div style={{ ...secLabel, marginBottom: 10 }}>Required Sections (toggle to show/hide)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                {[
                  { key: 'human_subjects_involved', label: '👥 Human Subjects' },
                  { key: 'vert_animals_involved', label: '🐭 Vertebrate Animals' },
                  { key: 'select_agents_involved', label: '⚠️ Select Agents' },
                ].map(({ key, label: lbl }) => (
                  <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={!!setup[key]}
                      onChange={e => setSetup(s => ({ ...s, [key]: e.target.checked }))}
                    />
                    {lbl}
                  </label>
                ))}
              </div>
            </div>

            {/* Resubmission toggle */}
            <div style={{ marginTop: 12, padding: '12px 16px', background: setup.is_resubmission ? '#eff6ff' : '#f8f8f8', border: `0.5px solid ${setup.is_resubmission ? '#93c5fd' : '#e5e5e5'}`, borderRadius: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={!!setup.is_resubmission}
                  onChange={e => setSetup(s => ({ ...s, is_resubmission: e.target.checked }))}
                />
                🔄 Resubmission (A1)
              </label>
              {setup.is_resubmission && (
                <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <div style={secLabel}>Prior Application Number</div>
                    <input style={inputStyle} value={setup.prior_application_number || ''} onChange={e => setSetup(s => ({ ...s, prior_application_number: e.target.value }))} placeholder="e.g. 1 R43 CA999999-01" />
                  </div>
                  <div>
                    <div style={secLabel}>Prior Review Date</div>
                    <input style={inputStyle} type="date" value={setup.prior_review_date || ''} onChange={e => setSetup(s => ({ ...s, prior_review_date: e.target.value }))} />
                  </div>
                </div>
              )}
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

                {/* Citations + Polish */}
                {sections[sec.id] && (
                  <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button
                        onClick={() => citationSection === sec.id ? setCitationSection(null) : handleFindCitations(sec.id)}
                        disabled={citationLoading[sec.id]}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}
                      >
                        {citationLoading[sec.id] ? '⟳ Searching PubMed…' : citationSection === sec.id && citationResults[sec.id] ? '▲ Hide Citations' : '📚 Find Citations'}
                      </button>
                      <button
                        onClick={() => handlePolish(sec.id)}
                        disabled={polishing[sec.id]}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}
                        title="Elevate writing quality without changing scientific content"
                      >
                        {polishing[sec.id] ? '⟳ Polishing…' : '✨ Polish'}
                      </button>
                      {setup.is_resubmission && resubAnalysis && (
                        <button
                          onClick={() => handleReviseSection(sec.id)}
                          disabled={resubRevising[sec.id]}
                          style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px', borderColor: '#2563eb', color: '#2563eb' }}
                          title="Revise this section based on reviewer feedback"
                        >
                          {resubRevising[sec.id] ? '⟳ Revising…' : '🔄 Revise for A1'}
                        </button>
                      )}
                    </div>
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
              <button style={ghostBtn} onClick={handleExportDOCX} disabled={exportingDocx}>
                {exportingDocx ? 'Exporting…' : '📄 Export DOCX'}
              </button>
            </div>
          </div>
        )}

        {/* RESUBMISSION TAB */}
        {activeTab === 'resubmission' && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 4px' }}>Resubmission (A1) Workbench</h3>
              <p style={{ fontSize: 13, color: '#6b7280', margin: 0 }}>Import reviewer comments, analyze feedback, generate the Introduction section, and revise sections.</p>
            </div>

            {/* Prior application info */}
            {setup.prior_application_number && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: '#eff6ff', borderRadius: 6, fontSize: 13, color: '#1d4ed8' }}>
                Prior application: <strong>{setup.prior_application_number}</strong>
                {setup.prior_review_date && <> · Review date: {setup.prior_review_date}</>}
              </div>
            )}

            {/* Reviewer comments */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ ...secLabel, marginBottom: 6 }}>Paste Reviewer Comments (from Summary Statement)</div>
              <textarea
                style={{ ...inputStyle, width: '100%', minHeight: 200, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                value={resubComments}
                onChange={e => setResubComments(e.target.value)}
                placeholder="Paste the full reviewer comments / Summary Statement text here..."
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  style={{ ...ghostBtn, background: resubAnalyzing ? '#9ca3af' : '#2563eb', color: '#fff', border: 'none' }}
                  onClick={handleAnalyzeResubmission}
                  disabled={resubAnalyzing || !resubComments.trim()}
                >
                  {resubAnalyzing ? '⟳ Analyzing...' : '🔍 Analyze Reviewer Feedback'}
                </button>
              </div>
            </div>

            {/* Analysis results */}
            {resubAnalysis && (
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 12 }}>Analysis Results</div>

                {/* Score */}
                {resubAnalysis.impact_score && (
                  <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, display: 'flex', gap: 20, alignItems: 'center' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 32, fontWeight: 700, color: '#1d4ed8' }}>{resubAnalysis.impact_score}</div>
                      <div style={{ fontSize: 11, color: '#6b7280' }}>Impact Score</div>
                    </div>
                    {resubAnalysis.reviewer_scores && (
                      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                        {Object.entries(resubAnalysis.reviewer_scores).map(([k, v]) => (
                          <div key={k} style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: 18, fontWeight: 600 }}>{v}</div>
                            <div style={{ fontSize: 10, color: '#6b7280', textTransform: 'capitalize' }}>{k}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Major concerns */}
                {resubAnalysis.major_concerns?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#dc2626' }}>Major Concerns</div>
                    {resubAnalysis.major_concerns.map((c, i) => (
                      <div key={i} style={{ marginBottom: 8, padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>{c.concern}</div>
                        {c.suggestion && <div style={{ fontSize: 11, color: '#7f1d1d' }}>{c.suggestion}</div>}
                        {c.affected_sections?.length > 0 && (
                          <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {c.affected_sections.map(s => <span key={s} style={{ fontSize: 10, background: '#fee2e2', padding: '1px 6px', borderRadius: 10 }}>{s}</span>)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Minor concerns */}
                {resubAnalysis.minor_concerns?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#d97706' }}>Minor Concerns</div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#92400e' }}>
                      {resubAnalysis.minor_concerns.map((c, i) => <li key={i} style={{ marginBottom: 4 }}>{c}</li>)}
                    </ul>
                  </div>
                )}

                {/* Strengths */}
                {resubAnalysis.strengths?.length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8, color: '#16a34a' }}>Strengths to Preserve</div>
                    <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, color: '#14532d' }}>
                      {resubAnalysis.strengths.map((s, i) => <li key={i} style={{ marginBottom: 4 }}>{s}</li>)}
                    </ul>
                  </div>
                )}

                {/* Recommended changes */}
                {resubAnalysis.recommended_changes && Object.entries(resubAnalysis.recommended_changes).length > 0 && (
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Recommended Changes by Section</div>
                    {Object.entries(resubAnalysis.recommended_changes).map(([sec, changes]) => (
                      <div key={sec} style={{ marginBottom: 6, padding: '6px 10px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{sec}</div>
                        <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12 }}>
                          {(Array.isArray(changes) ? changes : [changes]).map((c, i) => <li key={i}>{c}</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}

                {/* Generate Introduction */}
                <div style={{ marginTop: 20, padding: '14px 18px', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>Generate Introduction Section</div>
                  <p style={{ fontSize: 12, color: '#1e40af', margin: '0 0 10px' }}>
                    1-page Introduction that acknowledges reviewer concerns and summarizes your A1 changes (required for resubmissions).
                  </p>
                  <button
                    style={{ ...ghostBtn, background: resubGeneratingIntro ? '#9ca3af' : '#1d4ed8', color: '#fff', border: 'none' }}
                    onClick={handleGenerateResubIntro}
                    disabled={resubGeneratingIntro}
                  >
                    {resubGeneratingIntro ? '⟳ Generating...' : '✍️ Generate Introduction (1 page)'}
                  </button>
                  {sections.intro && (
                    <div style={{ marginTop: 12, fontSize: 12, color: '#16a34a' }}>
                      ✓ Introduction generated — see "Introduction (Resubmission)" in Section Writer
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Empty state */}
            {!resubAnalysis && !resubAnalyzing && (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>
                Paste reviewer comments above and click Analyze to get started
              </div>
            )}
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

      {/* Study Section Progress Modal */}
      {studySectionModal === 'progress' && (
        <StudySectionProgressModal step={studySectionStep} />
      )}

      {/* Study Section Results Modal */}
      {studySectionModal === 'results' && studySectionResults && (
        <StudySectionResultsModal
          results={studySectionResults}
          onClose={() => setStudySectionModal(null)}
          onRerun={handleRunStudySection}
        />
      )}

      {/* Polish Modal */}
      {polishModal && (
        <PolishModal
          secId={polishModal.secId}
          original={polishModal.original}
          polished={polishModal.polished}
          onAccept={handleAcceptPolish}
          onDiscard={() => setPolishModal(null)}
        />
      )}

      {/* PD Review Loading */}
      {pdReviewModal === 'loading' && (
        <PDReviewLoadingModal />
      )}

      {/* PD Review Results */}
      {pdReviewModal === 'results' && pdReviewResults && (
        <PDReviewResultsModal
          results={pdReviewResults}
          onClose={() => setPdReviewModal(null)}
          onRerun={handleRunPDReview}
        />
      )}

      {/* Advisory Council Loading */}
      {councilModal === 'loading' && (
        <CouncilLoadingModal />
      )}

      {/* Advisory Council Results */}
      {councilModal === 'results' && councilResults && (
        <AdvisoryCouncilModal
          results={councilResults}
          onClose={() => setCouncilModal(null)}
          onRerun={handleRunAdvisoryCouncil}
        />
      )}

      {/* Voice Mode Overlay */}
      {showVoiceMode && (
        <VoiceMode
          project={getProject()}
          onSectionGenerated={(sectionId) => {
            generateSection(sectionId)
            setShowVoiceMode(false)
            setTimeout(() => setShowVoiceMode(true), 100)
          }}
          onSectionUpdated={(sectionId, newText) => {
            setSections(prev => ({ ...prev, [sectionId]: newText }))
          }}
          onClose={() => setShowVoiceMode(false)}
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

// ── PD Review Loading Modal ───────────────────────────────────────────────────
function PDReviewLoadingModal() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Program Director Reviewing</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>30-year NIH veteran assessing your application…</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {['Reading aims and significance', 'Assessing mechanism fit and portfolio balance', 'Writing fundability memo'].map((s, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8f8f8', borderRadius: 8, fontSize: 13 }}>
              <span style={{ width: 18, height: 18, borderRadius: '50%', border: '2px solid #ddd', borderTopColor: '#111', display: 'inline-block', animation: 'spin 1s linear infinite' }} />
              {s}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── PD Review Results Modal ───────────────────────────────────────────────────
function PDReviewResultsModal({ results, onClose, onRerun }) {
  const fundColors = { fund_now: { bg: '#f0fdf4', border: '#86efac', text: '#166534', label: '✅ Fund Now' }, revise_and_resubmit: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', label: '🔄 Revise & Resubmit' }, do_not_fund: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '❌ Do Not Fund' } }
  const fc = fundColors[results.fundability] || fundColors.revise_and_resubmit

  function copyMemo() {
    const text = `PROGRAM DIRECTOR REVIEW\n\nFundability: ${results.fundability?.replace(/_/g, ' ').toUpperCase()}\n\nOverall Assessment:\n${results.overall_assessment}\n\nStrengths:\n${(results.strengths || []).map(s => '• ' + s).join('\n')}\n\nConcerns:\n${(results.concerns || []).map(c => '• ' + c).join('\n')}\n\nRecommended Actions:\n${(results.recommended_actions || []).map(a => '• ' + a).join('\n')}\n\nPayline Estimate: ${results.payline_estimate}\nPriority Score Estimate: ${results.priority_score_estimate}\n\nFinal Recommendation:\n${results.final_recommendation}`
    navigator.clipboard.writeText(text).catch(() => {})
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 640, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1.5rem', borderBottom: '0.5px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>📋 Program Director Review</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>30-year NIH veteran assessment</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Fundability badge */}
          <div style={{ padding: '16px 20px', background: fc.bg, border: `1.5px solid ${fc.border}`, borderRadius: 10, textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: fc.text }}>{fc.label}</div>
            <div style={{ fontSize: 12, color: fc.text, marginTop: 4, opacity: 0.8 }}>Program Director Recommendation</div>
          </div>

          {/* Overall assessment */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Overall Assessment</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333', whiteSpace: 'pre-wrap' }}>{results.overall_assessment}</div>
          </div>

          {/* Strengths */}
          {(results.strengths || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Strengths</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.strengths.map((s, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#f0fdf4', borderRadius: 8, fontSize: 13 }}>
                    <span style={{ color: '#16a34a', flexShrink: 0 }}>✓</span>
                    <span>{s}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Concerns */}
          {(results.concerns || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Concerns</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.concerns.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#fef2f2', borderRadius: 8, fontSize: 13 }}>
                    <span style={{ color: '#dc2626', flexShrink: 0 }}>!</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommended actions */}
          {(results.recommended_actions || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Recommended Actions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.recommended_actions.map((a, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#fffbeb', borderRadius: 8, fontSize: 13 }}>
                    <span style={{ color: '#d97706', flexShrink: 0 }}>→</span>
                    <span>{a}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Estimates */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: '#f8f8f8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>PAYLINE ESTIMATE</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{results.payline_estimate}</div>
            </div>
            <div style={{ padding: '12px 16px', background: '#f8f8f8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>PRIORITY SCORE</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{results.priority_score_estimate}</div>
            </div>
          </div>

          {/* Final recommendation */}
          <div style={{ padding: '16px 20px', background: '#f8f8f8', borderRadius: 10, borderLeft: '3px solid #111' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Final Recommendation</div>
            <div style={{ fontSize: 13, lineHeight: 1.6 }}>{results.final_recommendation}</div>
          </div>
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8 }}>
          <button onClick={copyMemo} style={ghostBtn}>Copy memo</button>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          <button onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Advisory Council Loading Modal ────────────────────────────────────────────
function CouncilLoadingModal() {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.2)', textAlign: 'center' }}>
        <div style={{ fontSize: 32, marginBottom: 12 }}>🏛️</div>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>Advisory Council Deliberating</div>
        <div style={{ fontSize: 13, color: '#888' }}>Council reviewing study section results and program priorities…</div>
      </div>
    </div>
  )
}

// ── Advisory Council Results Modal ────────────────────────────────────────────
function AdvisoryCouncilModal({ results, onClose, onRerun }) {
  const decisionColors = {
    fund: { bg: '#f0fdf4', border: '#86efac', text: '#166534', label: '✅ Fund' },
    fund_with_conditions: { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', label: '🔄 Fund with Conditions' },
    defer: { bg: '#eff6ff', border: '#93c5fd', text: '#1e40af', label: '⏸ Defer to Next Cycle' },
    do_not_fund: { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', label: '❌ Do Not Fund' },
  }
  const priorityColors = { high: '#059669', medium: '#d97706', low: '#6b7280' }
  const dc = decisionColors[results.decision] || decisionColors.defer

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 600, maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1.5rem', borderBottom: '0.5px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 600, fontSize: 16 }}>🏛️ Advisory Council Recommendation</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>Second-level NIH funding review</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Decision + priority badges */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, padding: '16px 20px', background: dc.bg, border: `1.5px solid ${dc.border}`, borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: dc.text }}>{dc.label}</div>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8f8f8', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>PRIORITY</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: priorityColors[results.priority] || '#111' }}>{(results.priority || 'medium').toUpperCase()}</div>
            </div>
          </div>

          {/* Rationale */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Rationale</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: '#333', whiteSpace: 'pre-wrap' }}>{results.rationale}</div>
          </div>

          {/* Conditions */}
          {(results.conditions || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Conditions</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {results.conditions.map((c, i) => (
                  <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#fffbeb', borderRadius: 8, fontSize: 13 }}>
                    <span style={{ color: '#d97706', flexShrink: 0 }}>◆</span>
                    <span>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Portfolio fit + budget */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div style={{ padding: '12px 16px', background: '#f8f8f8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>PORTFOLIO FIT</div>
              <div style={{ fontSize: 13 }}>{results.portfolio_fit}</div>
            </div>
            <div style={{ padding: '12px 16px', background: '#f8f8f8', borderRadius: 8 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 500 }}>BUDGET RECOMMENDATION</div>
              <div style={{ fontSize: 13 }}>{results.budget_recommendation}</div>
            </div>
          </div>

          {/* Formal council statement */}
          <div style={{ padding: '16px 20px', background: '#f8f8f8', borderRadius: 10, borderLeft: '3px solid #111' }}>
            <div style={{ fontSize: 11, color: '#888', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>Formal Council Statement</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, fontStyle: 'italic' }}>{results.final_statement}</div>
          </div>

          {/* Inputs used */}
          {results._inputs && (
            <div style={{ fontSize: 11, color: '#888', borderTop: '0.5px solid #e5e5e5', paddingTop: 12 }}>
              Based on:{' '}
              {results._inputs.used_study_section && `Study Section score ${results._inputs.study_section_score}`}
              {results._inputs.used_study_section && results._inputs.used_pd_review && ' · '}
              {results._inputs.used_pd_review && `Program Director: ${results._inputs.pd_fundability?.replace(/_/g, ' ')}`}
              {!results._inputs.used_study_section && !results._inputs.used_pd_review && 'Grant text only (no study section or PD review on file)'}
            </div>
          )}
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8 }}>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          <button onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Study Section Progress Modal ─────────────────────────────────────────────
function StudySectionProgressModal({ step }) {
  const steps = [
    { label: 'Assembling reviewer panel', detail: 'Basic scientist · Physician-scientist · Biostatistician' },
    { label: 'Primary reviewer reading', detail: 'Scoring significance, innovation, approach…' },
    { label: 'Secondary & third reviewers', detail: 'Critiquing clinical relevance and study design…' },
    { label: 'SRO synthesizing summary', detail: 'Writing NIH Summary Statement…' },
  ]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: '2rem', width: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 6 }}>🔬 Study Section Simulation</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 24 }}>NIH-style peer review in progress…</div>
        {steps.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'flex-start' }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
              background: i < step ? '#16a34a' : i === step ? '#2563eb' : '#f0f0f0',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: i <= step ? '#fff' : '#999',
            }}>
              {i < step ? '✓' : i === step ? '…' : i + 1}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: i === step ? 600 : 400, color: i > step ? '#aaa' : '#111' }}>{s.label}</div>
              {i === step && <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>{s.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Study Section Results Modal ──────────────────────────────────────────────
function StudySectionResultsModal({ results, onClose, onRerun }) {
  const [activeReviewer, setActiveReviewer] = useState(null)
  const sum = results.summary || {}
  const impact = sum.impact_score || 0
  const percentile = sum.percentile || 0
  const criteria = sum.criteria || {}
  const impactColor = impact <= 2 ? '#16a34a' : impact <= 4 ? '#2563eb' : impact <= 6 ? '#d97706' : '#dc2626'

  const reviewers = [
    { key: 'reviewer_1', label: 'Primary Reviewer', role: 'Basic scientist · Molecular/cellular' },
    { key: 'reviewer_2', label: 'Secondary Reviewer', role: 'Physician-scientist · Translational' },
    { key: 'reviewer_3', label: 'Reader', role: 'Biostatistician · Methodologist' },
  ]

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 720, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '0.5px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 16 }}>Study Section Results</div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {results.generated_at ? new Date(results.generated_at * 1000).toLocaleString() : ''}
            </div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: impactColor, lineHeight: 1 }}>{impact.toFixed(1)}</div>
            <div style={{ fontSize: 11, color: '#888' }}>Impact Score</div>
          </div>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 36, fontWeight: 700, color: impactColor, lineHeight: 1 }}>{percentile}<span style={{ fontSize: 18 }}>th</span></div>
            <div style={{ fontSize: 11, color: '#888' }}>Percentile</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 13 }}>✕</button>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '1.25rem 1.5rem' }}>
          {/* Criteria table */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Criterion Scores (1 = Exceptional, 9 = Poor)</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 6 }}>
              {Object.entries(criteria).map(([k, v]) => (
                <div key={k} style={{ padding: '8px 10px', background: '#f8f8f8', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 600, color: v <= 3 ? '#16a34a' : v <= 5 ? '#2563eb' : '#dc2626' }}>{v}</div>
                  <div style={{ fontSize: 10, color: '#888', textTransform: 'capitalize' }}>{k}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Strengths + Weaknesses */}
          {(sum.strengths?.length > 0 || sum.weaknesses?.length > 0) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
              {sum.strengths?.length > 0 && (
                <div style={{ padding: '10px 12px', background: '#f0fdf4', borderRadius: 8, border: '0.5px solid #86efac' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#166534', marginBottom: 6 }}>Strengths</div>
                  {sum.strengths.map((s, i) => <div key={i} style={{ fontSize: 12, color: '#15803d', marginBottom: 3 }}>✓ {s}</div>)}
                </div>
              )}
              {sum.weaknesses?.length > 0 && (
                <div style={{ padding: '10px 12px', background: '#fef2f2', borderRadius: 8, border: '0.5px solid #fca5a5' }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#991b1b', marginBottom: 6 }}>Concerns</div>
                  {sum.weaknesses.map((w, i) => <div key={i} style={{ fontSize: 12, color: '#b91c1c', marginBottom: 3 }}>△ {w}</div>)}
                </div>
              )}
            </div>
          )}

          {/* Synthesis */}
          {sum.synthesis && (
            <div style={{ padding: '10px 12px', background: '#f8f8f8', borderRadius: 8, marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#555', marginBottom: 6 }}>SRO Synthesis</div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: '#333', whiteSpace: 'pre-wrap' }}>{sum.synthesis}</div>
            </div>
          )}

          {/* Fundability */}
          {sum.fundability && (
            <div style={{ padding: '8px 14px', background: impact <= 4 ? '#f0fdf4' : '#fffbeb', border: `0.5px solid ${impact <= 4 ? '#86efac' : '#fcd34d'}`, borderRadius: 8, fontSize: 13, fontWeight: 500, color: impact <= 4 ? '#166534' : '#92400e', marginBottom: 20 }}>
              {sum.fundability}
            </div>
          )}

          {/* Individual Reviewer Critiques */}
          <div style={{ fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Reviewer Critiques</div>
          {reviewers.map(r => {
            const data = results[r.key]
            if (!data) return null
            const scores = data.scores || {}
            return (
              <div key={r.key} style={{ border: '0.5px solid #e5e5e5', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
                <div
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: '#f8f8f8', cursor: 'pointer' }}
                  onClick={() => setActiveReviewer(activeReviewer === r.key ? null : r.key)}
                >
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.label}</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{r.role}</div>
                  </div>
                  <div style={{ fontSize: 18, fontWeight: 600, color: (scores.impact || 5) <= 3 ? '#16a34a' : (scores.impact || 5) <= 5 ? '#2563eb' : '#dc2626' }}>
                    {scores.impact || '—'}
                  </div>
                  <span style={{ color: '#888', fontSize: 12 }}>{activeReviewer === r.key ? '▲' : '▼'}</span>
                </div>
                {activeReviewer === r.key && (
                  <div style={{ padding: '10px 12px', fontSize: 13, lineHeight: 1.7, whiteSpace: 'pre-wrap', color: '#333', borderTop: '0.5px solid #e5e5e5', maxHeight: 300, overflowY: 'auto' }}>
                    {data.critique}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8 }}>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          <button onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Polish Modal ─────────────────────────────────────────────────────────────
function PolishModal({ secId, original, polished, onAccept, onDiscard }) {
  const sec = SECTIONS.find(s => s.id === secId)
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, width: '100%', maxWidth: 900, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
        <div style={{ padding: '1rem 1.5rem', borderBottom: '0.5px solid #e5e5e5', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600, fontSize: 15 }}>✨ Polish — {sec?.label || secId}</div>
            <div style={{ fontSize: 12, color: '#888' }}>Review changes below. Accept to replace your current text.</div>
          </div>
          <button onClick={onDiscard} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 13 }}>✕</button>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0, overflowY: 'auto', minHeight: 0 }}>
          <div style={{ padding: '1rem 1.25rem', borderRight: '0.5px solid #e5e5e5', overflowY: 'auto' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Original</div>
            <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#555', fontFamily: 'Georgia, serif' }}>{original}</div>
          </div>
          <div style={{ padding: '1rem 1.25rem', overflowY: 'auto', background: '#fafff8' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#16a34a', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Polished ✨</div>
            <div style={{ fontSize: 13, lineHeight: 1.8, whiteSpace: 'pre-wrap', color: '#111', fontFamily: 'Georgia, serif' }}>{polished}</div>
          </div>
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8 }}>
          <button onClick={onAccept} style={{ ...ghostBtn, background: '#16a34a', color: '#fff', borderColor: '#16a34a', fontWeight: 500 }}>
            Accept polished version
          </button>
          <button onClick={onDiscard} style={ghostBtn}>Discard</button>
        </div>
      </div>
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
