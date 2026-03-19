import { useState, useCallback, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useApi, AIUnavailableError } from '../hooks/useApi'
import PreliminaryData from './PreliminaryData'
import VoiceMode from './VoiceMode'
import CollaborationPanel from './CollaborationPanel'
import { CommercialChartsPanel } from './CommercialCharts'
import BibliographyManager from './BibliographyManager'
import TrackChangesViewer from './TrackChangesViewer'
import SubmissionPackageModal from './SubmissionPackageModal'
import ReferenceVerifier from './ReferenceVerifier'
import QualityReviewPanel from './QualityReviewPanel'
import ChecklistModal from './ChecklistModal'
import { generateGrantDOCX } from '../lib/docxExport'
import { generateSubmissionPackage } from '../lib/docxExportPackage'
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
  const [exportingPackage, setExportingPackage] = useState(false)
  const [showExportDropdown, setShowExportDropdown] = useState(false)

  // D2P2 fields
  const [d2p2FundingSource, setD2p2FundingSource] = useState(project.d2p2_funding_source || '')
  const [d2p2EquivalencyPeriod, setD2p2EquivalencyPeriod] = useState(project.d2p2_equivalency_period || '')
  const [d2p2MilestonesAchieved, setD2p2MilestonesAchieved] = useState(project.d2p2_milestones_achieved || '')
  const [d2p2Rationale, setD2p2Rationale] = useState(project.d2p2_rationale || '')

  // Fast Track
  const [fastTrackPhase1Sections, setFastTrackPhase1Sections] = useState(() => {
    try { return JSON.parse(project.fast_track_phase1_sections || '{}') } catch { return {} }
  })
  const [fastTrackPhase2Sections, setFastTrackPhase2Sections] = useState(() => {
    try { return JSON.parse(project.fast_track_phase2_sections || '{}') } catch { return {} }
  })
  const [goNoGoMilestone, setGoNoGoMilestone] = useState(project.go_no_go_milestone || '')
  const [activeFTSec, setActiveFTSec] = useState('phase1_sig')

  // Aims Optimizer
  const [aimsOptModal, setAimsOptModal] = useState(null) // null | 'loading' | 'results' | 'alternatives'
  const [aimsOptData, setAimsOptData] = useState(project.aims_optimization || null)
  const [aimsAltData, setAimsAltData] = useState(project.aims_alternatives || null)
  const [aimsOptLoading, setAimsOptLoading] = useState(false)
  const [aimsAltLoading, setAimsAltLoading] = useState(false)
  const [aimsAltExpanded, setAimsAltExpanded] = useState({})

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

  // Completeness gate modal
  const [completenessModal, setCompletenessModal] = useState(null) // null | { reviewType, items, onProceed }


  // Post-Review Rewrite
  const [rewriteConfirmModal, setRewriteConfirmModal] = useState(null) // null | { source, results, cyclesRemaining }
  const [rewriteProgress, setRewriteProgress] = useState(null) // null | { steps }
  const [rewriteResults, setRewriteResults] = useState(project.rewrite_results || {}) // { sectionId: { original, rewritten } }
  const [showTrackChanges, setShowTrackChanges] = useState({}) // { sectionId: boolean }
  const [showPackageModal, setShowPackageModal] = useState(false)
  const [pkgCyclesRemaining, setPkgCyclesRemaining] = useState(project.rewrite_cycles_remaining || 0)
  const [refCheckResults, setRefCheckResults] = useState(project.reference_check_results || {})

  // Submission Checklist (v5.6.0)
  const [showChecklist, setShowChecklist] = useState(false)
  const [checklistData, setChecklistData] = useState(null)
  const [checklistLoading, setChecklistLoading] = useState(false)

  // Email Grant (v5.7.0)
  const [emailGrant_loading, setEmailGrantLoading] = useState(false)
  const [emailGrant_selfStatus, setEmailGrantSelfStatus] = useState(null) // null | 'ok' | 'err'
  const [emailGrant_selfMsg, setEmailGrantSelfMsg] = useState('')
  const [showEmailColleagueModal, setShowEmailColleagueModal] = useState(false)
  const [emailColleague_to, setEmailColleagueTo] = useState('')
  const [emailColleague_sending, setEmailColleagueSending] = useState(false)
  const [emailColleague_sentList, setEmailColleagueSentList] = useState([])
  const [emailColleague_status, setEmailColleagueStatus] = useState(null)

  // Share Token (v5.7.0)
  const [showShareModal, setShowShareModal] = useState(false)
  const [shareInfo, setShareInfo] = useState(null) // null | { enabled, share_url, expires_at }
  const [shareLoading, setShareLoading] = useState(false)

  // AI unavailable / retry state
  const [aiUnavailable, setAiUnavailable] = useState(null) // { sectionId, retryAfter, countdown }
  const retryTimerRef = useRef(null)

  function handleAIUnavailable(e, sectionId) {
    if (!(e instanceof AIUnavailableError)) return false
    const retryAfter = e.retryAfter || 60
    setAiUnavailable({ sectionId, retryAfter, countdown: retryAfter })
    let count = retryAfter
    retryTimerRef.current = setInterval(() => {
      count--
      setAiUnavailable(prev => prev ? { ...prev, countdown: count } : null)
      if (count <= 0) {
        clearInterval(retryTimerRef.current)
        setAiUnavailable(null)
        generateSection(sectionId)
      }
    }, 1000)
    return true
  }

  useEffect(() => () => { if (retryTimerRef.current) clearInterval(retryTimerRef.current) }, [])

  // ── Document Completeness Check ──────────────────────────────────────────────
  function wc(text) {
    if (!text) return 0
    return text.trim().split(/\s+/).filter(Boolean).length
  }

  function buildCompletenessItems(reviewType) {
    const m = project?.mechanism || ''
    const isSBIR = m.includes('SBIR') || m.includes('STTR') || m === 'D2P2'
    const isPhaseII = m.includes('-II') || m === 'D2P2' || m === 'R01'

    const minWords = {
      aims: 200, sig: 400, innov: 200, approach: 800,
      commercial: isPhaseII ? 1500 : 300, data_mgmt: 300, facilities: 100,
    }

    const sects = [
      { id: 'aims', label: 'Specific Aims', min: minWords.aims, always: true },
      { id: 'sig', label: 'Significance', min: minWords.sig, always: true },
      { id: 'innov', label: 'Innovation', min: minWords.innov, always: true },
      { id: 'approach', label: 'Approach', min: minWords.approach, always: true },
      { id: 'commercial', label: `Commercialization Plan ${isPhaseII ? '(Phase II)' : '(Phase I)'}`, min: minWords.commercial, always: isSBIR },
      { id: 'data_mgmt', label: 'Data Management Plan', min: minWords.data_mgmt, always: true },
      { id: 'facilities', label: 'Facilities and Resources', min: minWords.facilities, always: true },
    ].filter(s => s.always)

    return sects.map(s => {
      const text = sections[s.id] || ''
      const words = wc(text)
      const missing = words === 0
      const brief = !missing && words < s.min
      return { ...s, words, missing, brief }
    })
  }

  function checkCompletenessAndRun(reviewType, onProceed) {
    const items = buildCompletenessItems(reviewType)
    const hasMissing = items.some(i => i.missing)
    const hasBrief = items.some(i => i.brief)
    if (hasMissing || hasBrief) {
      setCompletenessModal({ reviewType, items, onProceed })
    } else {
      onProceed()
    }
  }

  // Collaboration
  const { user } = useUser()
  const [showCollabPanel, setShowCollabPanel] = useState(false)
  const [commentCount, setCommentCount] = useState(0)

  useEffect(() => {
    if (!project.id) return
    api.getComments(project.id).then(data => {
      const all = Object.values(data.grouped || {}).flat()
      setCommentCount(all.filter(c => !c.resolved).length)
    }).catch(() => {})
  }, [project.id])

  // Commercial Reviewer
  const [commercialReviewModal, setCommercialReviewModal] = useState(null) // null | 'loading' | 'results'
  const [commercialReviewResults, setCommercialReviewResults] = useState(project.commercial_review_results ? (() => { try { return JSON.parse(project.commercial_review_results) } catch { return null } })() : null)

  // Commercial Charts
  const [chartData, setChartData] = useState(project.commercial_charts ? (() => { try { return JSON.parse(project.commercial_charts) } catch { return null } })() : null)
  const [generatingCharts, setGeneratingCharts] = useState(false)
  const [showCharts, setShowCharts] = useState(false)

  // Bibliography
  const [showBibliography, setShowBibliography] = useState(false)

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
      institute: setup.institute,
      foa_number: foaNumber || null,
      reference_grants: referenceGrants,
      prelim_data_narrative: project.prelim_data_narrative || null,
      prelim_data_gaps: project.prelim_data_gaps || null,
      go_no_go_milestone: goNoGoMilestone,
      fast_track_phase1_sections: fastTrackPhase1Sections,
      fast_track_phase2_sections: fastTrackPhase2Sections,
      d2p2_funding_source: d2p2FundingSource,
      d2p2_equivalency_period: d2p2EquivalencyPeriod,
      d2p2_milestones_achieved: d2p2MilestonesAchieved,
      d2p2_rationale: d2p2Rationale,
    }
  }

  async function save(updatedSections, updatedScores, updatedFoaRules, updatedFT1, updatedFT2, updatedMilestone, snapshotMeta) {
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
        go_no_go_milestone: updatedMilestone !== undefined ? updatedMilestone : goNoGoMilestone,
        fast_track_phase1_sections: updatedFT1 !== undefined ? updatedFT1 : fastTrackPhase1Sections,
        fast_track_phase2_sections: updatedFT2 !== undefined ? updatedFT2 : fastTrackPhase2Sections,
        d2p2_funding_source: d2p2FundingSource,
        d2p2_equivalency_period: d2p2EquivalencyPeriod,
        d2p2_milestones_achieved: d2p2MilestonesAchieved,
        d2p2_rationale: d2p2Rationale,
        ...(snapshotMeta || {}),
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
      await save(updated, scores, undefined, undefined, undefined, undefined, { _auto_snapshot: true, _snapshot_summary: `Generated: ${secId}` })
      scoreSection(secId, text, updated)

      // Start compliance polling
      startCompliancePolling(secId)
    } catch (e) {
      if (!handleAIUnavailable(e, secId)) {
        alert('Generation failed: ' + e.message)
      }
    }
    setGenerating(g => ({ ...g, [secId]: false }))
  }

  // ── Fast Track Section Helpers ─────────────────────────────────────────────
  function updateFT1Section(id, text) {
    const updated = { ...fastTrackPhase1Sections, [id]: text }
    setFastTrackPhase1Sections(updated)
    setSaveState('unsaved')
    return updated
  }

  function updateFT2Section(id, text) {
    const updated = { ...fastTrackPhase2Sections, [id]: text }
    setFastTrackPhase2Sections(updated)
    setSaveState('unsaved')
    return updated
  }

  async function generateFTSection(phase, secId) {
    setGenerating(g => ({ ...g, [secId]: true }))
    try {
      const result = await api.callAI({
        model: SONNET,
        max_tokens: secId.includes('approach') ? 2500 : 1000,
        system: PROFESSOR_SYSTEM,
        messages: [{ role: 'user', content: professorWritePrompt(secId, getProject(), mech) }],
        _project_id: project.id,
        _mechanism: mech,
      }, `write_${secId}`)
      const text = result.content.map(b => b.text || '').join('')
      if (phase === 1) {
        const updated = updateFT1Section(secId, text)
        await save(sections, scores, foaRules, updated, fastTrackPhase2Sections, goNoGoMilestone)
      } else {
        const updated = updateFT2Section(secId, text)
        await save(sections, scores, foaRules, fastTrackPhase1Sections, updated, goNoGoMilestone)
      }
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
        system: `You are an expert NIH grant reviewer. Score this section on the NIH 1-9 scale (1=best). Quote or closely paraphrase actual text from the section as evidence. Return ONLY valid JSON: {"score":2,"descriptor":"Outstanding","evidence":"direct quote or paraphrase from this section supporting the score","score_rationale":"why this score not one point better or worse","confidence":"high|medium|low","scoreable":true,"unscorable_reason":null,"strengths":["..."],"weaknesses":["..."],"narrative":"..."}`,
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
  function getBibliography() {
    try { return JSON.parse(project.bibliography || '[]') } catch { return [] }
  }

  async function handleExportDOCX() {
    setExportingDocx(true)
    setShowExportDropdown(false)
    try {
      const fullProject = { ...getProject(), id: project.id }
      const buffer = await generateGrantDOCX(fullProject, sections, scores, getBibliography())
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (title || 'grant').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_combined.docx'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Export failed: ' + e.message)
    }
    setExportingDocx(false)
  }

  async function handleExportPackage() {
    setExportingPackage(true)
    setShowExportDropdown(false)
    try {
      const fullProject = { ...getProject(), id: project.id }
      const blob = await generateSubmissionPackage(fullProject, sections, getBibliography())
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = (title || 'grant').replace(/[^a-z0-9]/gi, '_').toLowerCase() + '_submission_package.zip'
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      alert('Package export failed: ' + e.message)
    }
    setExportingPackage(false)
  }

  function handlePrint() {
    setShowExportDropdown(false)
    const sectionOrder = [
      { key: 'project_summary', label: 'PROJECT SUMMARY' },
      { key: 'project_narrative', label: 'PROJECT NARRATIVE' },
      { key: 'aims', label: 'SPECIFIC AIMS' },
      { key: 'sig', label: 'SIGNIFICANCE' },
      { key: 'innov', label: 'INNOVATION' },
      { key: 'approach', label: 'APPROACH' },
      { key: 'commercial', label: 'COMMERCIALIZATION PLAN' },
      { key: 'data_mgmt', label: 'DATA MANAGEMENT AND SHARING PLAN' },
      { key: 'facilities', label: 'FACILITIES AND RESOURCES' },
    ]
    const piName = setup.pi || ''
    const institution = setup.partner || ''
    let html = `<div style="text-align:center;margin-bottom:48pt;font-family:Georgia,serif;">
      <h1 style="font-size:14pt;font-weight:bold;">${title || 'Untitled Grant'}</h1>
      <p style="font-size:11pt;">${piName}${piName && mech ? ' | ' : ''}${mech}${mech && project.institute ? ' | ' : ''}${project.institute || ''}</p>
      ${foaNumber ? `<p style="font-size:10pt;">FOA: ${foaNumber}</p>` : ''}
    </div>`
    let first = true
    for (const { key, label } of sectionOrder) {
      if (sections[key]) {
        html += `<div class="${first ? '' : 'print-section-break'}">
          <h2 class="print-section-heading">${label}</h2>
          <div class="print-content">${sections[key].replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
        </div>`
        first = false
      }
    }
    html += `<div style="margin-top:48pt;font-size:9pt;font-style:italic;color:#666;border-top:1px solid #ccc;padding-top:12pt;">
      Prepared by FrankGrant Grant Writing Services. Scientific content owned by ${piName || 'the applicant'}${institution ? ', ' + institution : ''}. The applicant is solely responsible for verifying all content before submission.
    </div>`
    const printDiv = document.createElement('div')
    printDiv.id = 'print-grant-content'
    printDiv.innerHTML = html
    document.body.appendChild(printDiv)
    window.print()
    document.body.removeChild(printDiv)
  }

  async function docxToBase64() {
    const fullProject = { ...getProject(), id: project.id }
    const buffer = await generateGrantDOCX(fullProject, sections, scores, getBibliography())
    const bytes = new Uint8Array(buffer)
    let bin = ''
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
    return btoa(bin)
  }

  async function handleEmailSelf() {
    const userEmail = user?.primaryEmailAddress?.emailAddress
    if (!userEmail) { setEmailGrantSelfMsg('Could not get your email from your account.'); setEmailGrantSelfStatus('err'); return }
    setShowExportDropdown(false)
    setEmailGrantLoading(true)
    setEmailGrantSelfStatus(null)
    try {
      const docxB64 = await docxToBase64()
      const result = await api.emailGrant(project.id, userEmail, docxB64)
      if (result.ok) { setEmailGrantSelfStatus('ok'); setEmailGrantSelfMsg(`Sent to ${userEmail}`) }
      else if (result.error === 'email_not_configured') { setEmailGrantSelfStatus('err'); setEmailGrantSelfMsg('Email not configured — download DOCX instead.') }
      else { setEmailGrantSelfStatus('err'); setEmailGrantSelfMsg(result.message || 'Failed to send email.') }
    } catch (e) { setEmailGrantSelfStatus('err'); setEmailGrantSelfMsg(e.message) }
    setEmailGrantLoading(false)
  }

  async function handleEmailColleague() {
    if (!emailColleague_to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailColleague_to)) {
      setEmailColleagueStatus({ ok: false, msg: 'Enter a valid email address.' }); return
    }
    setEmailColleagueSending(true)
    setEmailColleagueStatus(null)
    try {
      const docxB64 = await docxToBase64()
      const result = await api.emailGrant(project.id, emailColleague_to, docxB64)
      if (result.ok) {
        setEmailColleagueSentList(l => [...l, emailColleague_to])
        setEmailColleagueStatus({ ok: true, msg: `Sent to ${emailColleague_to}` })
        setEmailColleagueTo('')
      } else if (result.error === 'email_not_configured') {
        setEmailColleagueStatus({ ok: false, msg: 'Email not configured — download DOCX instead.' })
      } else {
        setEmailColleagueStatus({ ok: false, msg: result.message || 'Failed to send.' })
      }
    } catch (e) { setEmailColleagueStatus({ ok: false, msg: e.message }) }
    setEmailColleagueSending(false)
  }

  async function handleOpenShareModal() {
    setShowExportDropdown(false)
    setShowShareModal(true)
    if (shareInfo !== null) return
    setShareLoading(true)
    try { setShareInfo(await api.getShare(project.id)) } catch { setShareInfo({ enabled: false }) }
    setShareLoading(false)
  }

  async function handleCreateShare() {
    setShareLoading(true)
    try { setShareInfo(await api.createShare(project.id, 30)) } catch (e) { alert('Failed to create share link: ' + e.message) }
    setShareLoading(false)
  }

  async function handleRevokeShare() {
    setShareLoading(true)
    try { await api.deleteShare(project.id); setShareInfo({ enabled: false }) } catch (e) { alert('Failed to revoke: ' + e.message) }
    setShareLoading(false)
  }

  // ── Aims Optimizer ────────────────────────────────────────────────────────────
  async function handleOptimizeAims() {
    setAimsOptLoading(true)
    setAimsOptModal('loading')
    try {
      const result = await api.optimizeAims(project.id)
      setAimsOptData(result)
      setAimsOptModal('results')
    } catch (e) {
      alert('Optimization failed: ' + e.message)
      setAimsOptModal(null)
    }
    setAimsOptLoading(false)
  }

  async function handleGenerateAlternatives() {
    setAimsAltLoading(true)
    try {
      const alts = await api.generateAimsAlternatives(project.id)
      setAimsAltData(alts)
      setAimsOptModal('alternatives')
    } catch (e) {
      alert('Failed to generate alternatives: ' + e.message)
    }
    setAimsAltLoading(false)
  }

  function handleUseAltVersion(altText) {
    const updated = updateSection('aims', altText)
    save(updated, scores)
    setAimsOptModal(null)
  }

  // ── Study Section ────────────────────────────────────────────────────────────
  function handleRunStudySectionClick() {
    checkCompletenessAndRun('Study Section', () => handleRunStudySection())
  }

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
  function handleRunPDReviewClick() {
    checkCompletenessAndRun('PD Review', () => handleRunPDReview())
  }

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
  function handleRunAdvisoryCouncilClick() {
    checkCompletenessAndRun('Advisory Council', () => handleRunAdvisoryCouncil())
  }

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

  // ── Commercial Reviewer ───────────────────────────────────────────────────────
  function handleRunCommercialReviewClick() {
    checkCompletenessAndRun('Commercial Review', () => handleRunCommercialReview())
  }

  async function handleRunCommercialReview() {
    setCommercialReviewModal('loading')
    try {
      const results = await api.runCommercialReview(project.id)
      setCommercialReviewResults(results)
      setCommercialReviewModal('results')
    } catch (e) {
      setCommercialReviewModal(null)
      alert('Commercial review failed: ' + e.message)
    }
  }

  // ── Post-Review Rewrite ───────────────────────────────────────────────────────
  async function handleInitiateRewrite(source, sourceResults) {
    // Check package status first
    try {
      const pkg = await api.getSubmissionPackage(project.id)
      if (!pkg.has_package && pkg.package_credits === 0) {
        setShowPackageModal(true)
        return
      }
      setPkgCyclesRemaining(pkg.cycles_remaining)
      setRewriteConfirmModal({ source, results: sourceResults, cyclesRemaining: pkg.cycles_remaining })
    } catch (e) {
      setShowPackageModal(true)
    }
  }

  async function handleExecuteRewrite() {
    if (!rewriteConfirmModal) return
    const { source, results } = rewriteConfirmModal
    setRewriteConfirmModal(null)
    setRewriteProgress({ steps: ['Saving current version…', 'Analyzing feedback…', 'Rewriting sections…', 'Verifying references…'], current: 0 })

    try {
      setRewriteProgress(p => ({ ...p, current: 1 }))
      await new Promise(r => setTimeout(r, 500))
      setRewriteProgress(p => ({ ...p, current: 2 }))
      const response = await api.rewriteGrant(project.id, source, results)
      setRewriteProgress(p => ({ ...p, current: 3 }))
      await new Promise(r => setTimeout(r, 600))

      // Update local rewrite results
      const newResults = { ...rewriteResults }
      for (const [secId, rewritten] of Object.entries(response.rewritten_sections || {})) {
        newResults[secId] = { original: response.original_sections?.[secId] || sections[secId] || '', rewritten, cycle: response.cycle_number, source }
      }
      setRewriteResults(newResults)
      setPkgCyclesRemaining(response.cycles_remaining)

      // Show track changes for all rewritten sections
      const newShow = { ...showTrackChanges }
      for (const secId of response.sections_rewritten || []) {
        newShow[secId] = true
      }
      setShowTrackChanges(newShow)
    } catch (e) {
      if (e.message === 'submission_package_required') {
        setShowPackageModal(true)
      } else {
        alert('Rewrite failed: ' + e.message)
      }
    }
    setRewriteProgress(null)
  }

  async function handleVerifyRefs(sectionId) {
    const content = sections[sectionId]
    if (!content) return
    try {
      const result = await api.verifyReferences(project.id, sectionId, content)
      setRefCheckResults(prev => ({ ...prev, [sectionId]: result }))
    } catch (e) {
      alert('Reference check failed: ' + e.message)
    }
  }

  function handleAcceptRewrite(sectionId, finalText) {
    const updated = updateSection(sectionId, finalText)
    save(updated, scores)
    setShowTrackChanges(prev => ({ ...prev, [sectionId]: false }))
    const newResults = { ...rewriteResults }
    delete newResults[sectionId]
    setRewriteResults(newResults)
  }

  function handleRejectRewrite(sectionId) {
    setShowTrackChanges(prev => ({ ...prev, [sectionId]: false }))
    const newResults = { ...rewriteResults }
    delete newResults[sectionId]
    setRewriteResults(newResults)
  }

  // ── Commercial Charts ─────────────────────────────────────────────────────────
  async function handleGenerateCharts() {
    setGeneratingCharts(true)
    try {
      const data = await api.generateCharts(project.id)
      setChartData(data)
      setShowCharts(true)
    } catch (e) {
      alert('Chart generation failed: ' + e.message)
    }
    setGeneratingCharts(false)
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
          <div style={{ position: 'relative' }}>
            <button
              onClick={() => setShowExportDropdown(d => !d)}
              disabled={exportingDocx || exportingPackage}
              style={{ ...ghostBtn, fontSize: 12 }}
              title="Export options"
            >
              {exportingDocx ? '⟳ Exporting…' : exportingPackage ? '⟳ Packaging…' : '📄 Export ▾'}
            </button>
            {showExportDropdown && (
              <div style={{ position: 'absolute', top: '100%', right: 0, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 220, padding: '4px 0' }}>
                <button onClick={handleExportDOCX} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                  📄 Combined Document (.docx)
                </button>
                <button onClick={handleExportPackage} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                  📦 NIH Submission Package (.zip)
                </button>
                <button onClick={handlePrint} title="Opens print dialog — select Save as PDF as destination" style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                  🖨️ Save as PDF
                </button>
                <div style={{ borderTop: '1px solid #f3f4f6', margin: '4px 0' }} />
                <button onClick={handleEmailSelf} disabled={emailGrant_loading} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: emailGrant_loading ? 'not-allowed' : 'pointer', fontSize: 13, color: '#111' }}>
                  {emailGrant_loading ? '⟳ Sending…' : '📧 Email to myself'}
                </button>
                <button onClick={() => { setShowExportDropdown(false); setShowEmailColleagueModal(true) }} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                  📧 Email to colleague
                </button>
                <button onClick={handleOpenShareModal} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '8px 14px', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, color: '#111' }}>
                  🔗 Get shareable link
                </button>
                {emailGrant_selfStatus && (
                  <div style={{ padding: '6px 14px', fontSize: 12, color: emailGrant_selfStatus === 'ok' ? '#15803d' : '#dc2626' }}>{emailGrant_selfMsg}</div>
                )}
              </div>
            )}
          </div>
          {sections.aims && sections.aims.length > 50 && (
            <button
              onClick={() => aimsOptData && !aimsOptLoading ? setAimsOptModal('results') : handleOptimizeAims()}
              disabled={aimsOptLoading}
              style={{ ...ghostBtn, fontSize: 12, background: aimsOptData ? '#f0fdf4' : '#fff', borderColor: aimsOptData ? '#86efac' : undefined }}
              title="Score and optimize your Specific Aims"
            >
              🎯 {aimsOptLoading ? 'Scoring…' : 'Optimize Aims'}
            </button>
          )}
          <button
            onClick={() => studySectionResults ? setStudySectionModal('results') : handleRunStudySectionClick()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Simulate NIH study section review"
          >
            🔬 {studySectionResults ? 'Review' : 'Study Section'}
          </button>
          <button
            onClick={() => pdReviewResults ? setPdReviewModal('results') : handleRunPDReviewClick()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Get Program Director fundability assessment"
          >
            📋 {pdReviewResults ? 'PD Review' : 'PD Review'}
          </button>
          <button
            onClick={() => councilResults ? setCouncilModal('results') : handleRunAdvisoryCouncilClick()}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="Get Advisory Council funding recommendation"
          >
            🏛️ Council
          </button>
          {m.needsCommercial && (
            <button
              onClick={() => commercialReviewResults ? setCommercialReviewModal('results') : handleRunCommercialReviewClick()}
              style={{ ...ghostBtn, fontSize: 12 }}
              title="Get expert commercialization review"
            >
              💰 {commercialReviewResults ? 'Comm Review' : 'Comm Review'}
            </button>
          )}
          <button
            onClick={() => setShowBibliography(d => !d)}
            style={{ ...ghostBtn, fontSize: 12, background: showBibliography ? '#f0f0f0' : '#fff' }}
            title="Manage your bibliography"
          >
            📚 Bibliography
          </button>
          <button
            onClick={async () => {
              if (checklistData) { setShowChecklist(true); return }
              setChecklistLoading(true)
              try {
                const cl = await api.getSubmissionChecklist(project.id)
                setChecklistData(cl)
                setShowChecklist(true)
              } catch (e) { alert('Failed to load checklist: ' + e.message) }
              setChecklistLoading(false)
            }}
            disabled={checklistLoading}
            style={{ ...ghostBtn, fontSize: 12 }}
            title="View submission checklist with ownership statement"
          >
            {checklistLoading ? '⟳' : '📋'} Checklist
          </button>
          <button
            onClick={() => setShowVoiceMode(true)}
            style={{ ...ghostBtn, fontSize: 12, background: '#0e7490', color: '#fff', borderColor: '#0e7490' }}
            title="Talk to your grant with AI voice assistant"
          >
            🎤 Voice Mode
          </button>
          <button
            onClick={() => setShowCollabPanel(p => !p)}
            style={{ ...ghostBtn, fontSize: 12, background: '#7c3aed', color: '#fff', borderColor: '#7c3aed', position: 'relative' }}
            title="Collaborate with your team"
          >
            👥 Share
            {commentCount > 0 && (
              <span style={{ position: 'absolute', top: -6, right: -6, background: '#ef4444', color: '#fff', borderRadius: '50%', width: 16, height: 16, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>{commentCount > 9 ? '9+' : commentCount}</span>
            )}
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

            {/* Fast Track: Go/No-Go Milestone */}
            {m.is_fast_track && (
              <div style={{ marginTop: 12, padding: '12px 16px', background: '#fffbeb', border: '0.5px solid #fbbf24', borderRadius: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, color: '#92400e' }}>
                  ⚡ Fast Track Go/No-Go Milestone <span style={{ color: '#dc2626', fontSize: 11 }}>Required</span>
                </div>
                <div style={{ fontSize: 12, color: '#78350f', marginBottom: 8 }}>
                  State the quantitative milestone(s) that Phase I must achieve to proceed to Phase II. This appears prominently in the Phase I Approach and DOCX export.
                </div>
                <textarea
                  style={{ ...inputStyle, width: '100%', minHeight: 80, resize: 'vertical' }}
                  value={goNoGoMilestone}
                  onChange={e => { setGoNoGoMilestone(e.target.value); setSaveState('unsaved') }}
                  onBlur={() => save(sections, scores, foaRules, fastTrackPhase1Sections, fastTrackPhase2Sections, goNoGoMilestone)}
                  placeholder="e.g., Achieve ≥80% tumor regression in at least 5 of 8 treated mice in the murine xenograft model by Month 18, with <10% off-target toxicity..."
                />
              </div>
            )}

            {/* D2P2: Phase I Equivalency fields */}
            {m.is_d2p2 && (
              <div style={{ marginTop: 12, padding: '12px 16px', background: '#eff6ff', border: '0.5px solid #3b82f6', borderRadius: 8 }}>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4, color: '#1e40af' }}>
                  🔬 NCI Direct to Phase 2 — Phase I Equivalency
                </div>
                <div style={{ fontSize: 12, color: '#1e3a8a', marginBottom: 10 }}>
                  Provide evidence that Phase I equivalent research was completed without federal SBIR/STTR funding. This information populates the Phase I Equivalency Documentation section and AI prompts.
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={secLabel}>Phase I Equivalency Funding Source <span style={{ color: '#dc2626' }}>*</span></div>
                  <input
                    style={inputStyle}
                    value={d2p2FundingSource}
                    onChange={e => { setD2p2FundingSource(e.target.value); setSaveState('unsaved') }}
                    onBlur={() => save()}
                    placeholder="e.g., NIH R01 CA123456, private foundation grant, company R&D funds, venture capital..."
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={secLabel}>Phase I Equivalency Period <span style={{ color: '#dc2626' }}>*</span></div>
                  <input
                    style={inputStyle}
                    value={d2p2EquivalencyPeriod}
                    onChange={e => { setD2p2EquivalencyPeriod(e.target.value); setSaveState('unsaved') }}
                    onBlur={() => save()}
                    placeholder="e.g., January 2021 – December 2023"
                  />
                </div>
                <div style={{ marginBottom: 8 }}>
                  <div style={secLabel}>Key Phase I Milestones Achieved <span style={{ color: '#dc2626' }}>*</span></div>
                  <textarea
                    style={{ ...inputStyle, width: '100%', minHeight: 80, resize: 'vertical' }}
                    value={d2p2MilestonesAchieved}
                    onChange={e => { setD2p2MilestonesAchieved(e.target.value); setSaveState('unsaved') }}
                    onBlur={() => save()}
                    placeholder="e.g., Demonstrated proof-of-concept in 3 animal models; achieved IC50 <10 nM in cancer cell lines; completed IND-enabling toxicology studies..."
                  />
                </div>
                <div>
                  <div style={secLabel}>Why D2P2 (Rationale) <span style={{ color: '#dc2626' }}>*</span></div>
                  <textarea
                    style={{ ...inputStyle, width: '100%', minHeight: 70, resize: 'vertical' }}
                    value={d2p2Rationale}
                    onChange={e => { setD2p2Rationale(e.target.value); setSaveState('unsaved') }}
                    onBlur={() => save()}
                    placeholder="e.g., Pursuing D2P2 rather than standard Phase I because Phase I equivalent work was completed through non-federal funding and the technology is ready for Phase II development..."
                  />
                </div>
              </div>
            )}

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

            {/* Fast Track Dual Writer */}
            {m.is_fast_track ? (
              <FastTrackWriter
                project={getProject()}
                sections={sections}
                scores={scores}
                ft1={fastTrackPhase1Sections}
                ft2={fastTrackPhase2Sections}
                goNoGo={goNoGoMilestone}
                activeSec={activeFTSec}
                setActiveSec={setActiveFTSec}
                generating={generating}
                scoring={scoring}
                onGenerate={generateFTSection}
                onGenerateStd={generateSection}
                onUpdateFT1={(id, text) => { const u = updateFT1Section(id, text); save(sections, scores, foaRules, u, fastTrackPhase2Sections, goNoGoMilestone) }}
                onUpdateFT2={(id, text) => { const u = updateFT2Section(id, text); save(sections, scores, foaRules, fastTrackPhase1Sections, u, goNoGoMilestone) }}
                onUpdateSection={(id, text) => { const u = updateSection(id, text); save(u, scores) }}
                onScore={scoreSection}
                visibleSecs={visibleSecs}
                mech={mech}
                setup={setup}
                inputStyle={inputStyle}
                ghostBtn={ghostBtn}
                mechBtn={mechBtn}
                complianceResults={complianceResults}
                compliancePolling={compliancePolling}
                complianceExpanded={complianceExpanded}
                setComplianceExpanded={setComplianceExpanded}
                onRecheck={recheckCompliance}
                chartData={chartData}
                showCharts={showCharts}
                setShowCharts={setShowCharts}
                generatingCharts={generatingCharts}
                onGenerateCharts={handleGenerateCharts}
                citationSection={citationSection}
                citationResults={citationResults}
                citationLoading={citationLoading}
                onFindCitations={handleFindCitations}
                setCitationSection={setCitationSection}
                onInsertCitation={handleInsertCitation}
                polishing={polishing}
                onPolish={handlePolish}
                resubAnalysis={resubAnalysis}
                resubRevising={resubRevising}
                onRevise={handleReviseSection}
              />
            ) : (
            <>
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

                {/* Commercial charts for commercial section */}
                {sec.id === 'commercial' && m.needsCommercial && (
                  <div style={{ marginBottom: 8, display: 'flex', gap: 6 }}>
                    <button
                      onClick={handleGenerateCharts}
                      disabled={generatingCharts}
                      style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px', borderColor: '#7c3aed', color: '#7c3aed' }}
                      title="Generate market, revenue, and competitive landscape charts"
                    >
                      {generatingCharts ? '⟳ Generating Charts...' : '📊 Generate Charts'}
                    </button>
                    {chartData && (
                      <button
                        onClick={() => setShowCharts(s => !s)}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}
                      >
                        {showCharts ? '▲ Hide Charts' : '📊 View Charts'}
                      </button>
                    )}
                  </div>
                )}
                {sec.id === 'commercial' && showCharts && chartData && (
                  <CommercialChartsPanel chartData={chartData} onClose={() => setShowCharts(false)} />
                )}

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
                      <button
                        onClick={() => handleVerifyRefs(sec.id)}
                        style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px', borderColor: '#7c3aed', color: '#7c3aed' }}
                        title="Check citations against PubMed"
                      >
                        🔍 Verify Refs
                      </button>
                    </div>
                    {citationSection === sec.id && citationResults[sec.id] && (
                      <CitationsPanel
                        citations={citationResults[sec.id]}
                        onInsert={(cite) => handleInsertCitation(sec.id, cite)}
                        onRefresh={() => handleFindCitations(sec.id)}
                      />
                    )}
                    {/* Reference Verifier */}
                    {refCheckResults[sec.id] && (
                      <ReferenceVerifier results={refCheckResults[sec.id]} />
                    )}
                    {/* Track Changes Viewer */}
                    {showTrackChanges[sec.id] && rewriteResults[sec.id] && (
                      <TrackChangesViewer
                        originalText={rewriteResults[sec.id].original}
                        rewrittenText={rewriteResults[sec.id].rewritten}
                        sectionName={sec.label}
                        cyclesRemaining={pkgCyclesRemaining}
                        onAcceptAll={(finalText) => handleAcceptRewrite(sec.id, finalText)}
                        onRejectAll={() => handleRejectRewrite(sec.id)}
                        onClose={() => handleRejectRewrite(sec.id)}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
            </>
            )}

            {/* Quality Review Panel */}
            <QualityReviewPanel
              project={{ ...project, quality_pass1_results: project.quality_pass1_results, quality_pass2_results: project.quality_pass2_results, quality_pass3_results: project.quality_pass3_results, quality_certified: project.quality_certified, quality_certified_at: project.quality_certified_at, delivery_ready: project.delivery_ready }}
              onRewriteRequest={() => handleInitiateRewrite('compliance', project.compliance_results)}
            />
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
                {exportingDocx ? 'Exporting…' : '📄 Combined DOCX'}
              </button>
              <button
                style={{ ...ghostBtn, opacity: project.quality_certified ? 1 : 0.5, cursor: project.quality_certified ? 'pointer' : 'not-allowed' }}
                onClick={project.quality_certified ? handleExportPackage : () => alert('Run Quality Review first to enable NIH Submission Package export.')}
                disabled={exportingPackage}
                title={project.quality_certified ? 'Download NIH submission package' : 'Run Quality Review first — certification required before delivery'}
              >
                {exportingPackage ? 'Packaging…' : project.quality_certified ? '📦 NIH Package (.zip)' : '🔒 NIH Package (Quality Review required)'}
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

      {/* Aims Optimizer Loading */}
      {aimsOptModal === 'loading' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '32px 40px', maxWidth: 400, textAlign: 'center' }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>🎯</div>
            <div style={{ fontWeight: 600, fontSize: 16, marginBottom: 8 }}>Scoring Your Specific Aims</div>
            <div style={{ color: '#666', fontSize: 13 }}>An expert NIH reviewer is analyzing 5 critical elements…</div>
            <div style={{ marginTop: 20, height: 4, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#3b82f6', borderRadius: 4, width: '60%', animation: 'pulse 1.5s infinite' }} />
            </div>
          </div>
        </div>
      )}

      {/* Aims Optimizer Results */}
      {aimsOptModal === 'results' && aimsOptData && (
        <AimsOptimizerModal
          data={aimsOptData}
          altLoading={aimsAltLoading}
          onGenerateAlts={handleGenerateAlternatives}
          onClose={() => setAimsOptModal(null)}
          onRerun={handleOptimizeAims}
          onRewrite={() => { setAimsOptModal(null); handleInitiateRewrite('aims_optimizer', aimsOptData) }}
        />
      )}

      {/* Aims Alternatives */}
      {aimsOptModal === 'alternatives' && aimsAltData && (
        <AimsAlternativesModal
          alternatives={aimsAltData}
          expanded={aimsAltExpanded}
          setExpanded={setAimsAltExpanded}
          onUse={handleUseAltVersion}
          onClose={() => setAimsOptModal('results')}
        />
      )}

      {/* Completeness Gate Modal */}
      {completenessModal && (
        <CompletenessModal
          reviewType={completenessModal.reviewType}
          items={completenessModal.items}
          onProceed={() => { setCompletenessModal(null); completenessModal.onProceed() }}
          onClose={() => setCompletenessModal(null)}
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
          onRewrite={() => { setStudySectionModal(null); handleInitiateRewrite('study_section', studySectionResults) }}
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
          onRewrite={() => { setPdReviewModal(null); handleInitiateRewrite('pd_review', pdReviewResults) }}
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
          onRewrite={() => { setCouncilModal(null); handleInitiateRewrite('advisory_council', councilResults) }}
        />
      )}

      {/* Commercial Review Loading */}
      {commercialReviewModal === 'loading' && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: '32px 40px', textAlign: 'center', maxWidth: 360 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>💰</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>Commercial Review in Progress</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>Our VC/commercialization expert is analyzing your plan...</div>
          </div>
        </div>
      )}

      {/* Commercial Review Results */}
      {commercialReviewModal === 'results' && commercialReviewResults && (
        <CommercialReviewModal
          results={commercialReviewResults}
          onClose={() => setCommercialReviewModal(null)}
          onRerun={handleRunCommercialReview}
          onRewrite={() => { setCommercialReviewModal(null); handleInitiateRewrite('commercial_review', commercialReviewResults) }}
        />
      )}

      {/* Submission Package Modal */}
      {showPackageModal && (
        <SubmissionPackageModal
          projectId={project.id}
          cyclesRemaining={pkgCyclesRemaining}
          onClose={() => setShowPackageModal(false)}
          onActivated={() => { setShowPackageModal(false) }}
        />
      )}

      {/* Rewrite Confirm Modal */}
      {rewriteConfirmModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, maxWidth: 480, width: '100%', boxShadow: '0 20px 50px rgba(0,0,0,0.2)' }}>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12 }}>✍️ Rewrite Grant to Address Feedback</div>
            <div style={{ fontSize: 14, color: '#374151', lineHeight: 1.6, marginBottom: 20 }}>
              I'll rewrite your grant sections to address the reviewer concerns from <strong>{rewriteConfirmModal.source.replace(/_/g, ' ')}</strong>.
              Your current version will be saved automatically first.
            </div>
            <div style={{ padding: '12px 16px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, fontSize: 13, color: '#92400e', marginBottom: 24 }}>
              This uses <strong>1</strong> of your <strong>{rewriteConfirmModal.cyclesRemaining}</strong> remaining rewrite cycle{rewriteConfirmModal.cyclesRemaining !== 1 ? 's' : ''}.
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setRewriteConfirmModal(null)} style={{ flex: 1, padding: '11px', fontSize: 14, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#374151' }}>Cancel</button>
              <button onClick={handleExecuteRewrite} style={{ flex: 2, padding: '11px', fontSize: 14, fontWeight: 600, border: 'none', borderRadius: 8, cursor: 'pointer', background: '#0e7490', color: '#fff' }}>Proceed with Rewrite</button>
            </div>
          </div>
        </div>
      )}

      {/* Rewrite Progress Modal */}
      {rewriteProgress && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 14, padding: 32, maxWidth: 400, width: '100%', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 12 }}>✍️</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 20 }}>Rewriting your grant…</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rewriteProgress.steps.map((step, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: i <= rewriteProgress.current ? '#f0fdf4' : '#f9fafb', borderRadius: 8, fontSize: 13, color: i <= rewriteProgress.current ? '#15803d' : '#9ca3af' }}>
                  <span>{i < rewriteProgress.current ? '✅' : i === rewriteProgress.current ? '⏳' : '○'}</span>
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Bibliography Drawer */}
      {showBibliography && (
        <div style={{ position: 'fixed', right: 0, top: 0, bottom: 0, width: 480, background: '#fff', boxShadow: '-4px 0 20px rgba(0,0,0,0.1)', overflowY: 'auto', zIndex: 900 }}>
          <BibliographyManager
            projectId={project.id}
            onInsert={(text) => {
              const current = sections[activeSec] || ''
              const updated = updateSection(activeSec, current + '\n\n' + text)
              save(updated, scores)
            }}
            onClose={() => setShowBibliography(false)}
          />
        </div>
      )}

      {/* AI Unavailable Banner */}
      {aiUnavailable && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', background: '#451a03', border: '1px solid #92400e', borderRadius: 12, padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 14, zIndex: 800, boxShadow: '0 4px 20px rgba(0,0,0,0.4)', maxWidth: 480 }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#fde68a' }}>AI generation temporarily unavailable</div>
            <div style={{ fontSize: 12, color: '#d97706', marginTop: 2 }}>Your work is saved. Auto-retrying in {aiUnavailable.countdown}s…</div>
          </div>
          <button onClick={() => { if (retryTimerRef.current) clearInterval(retryTimerRef.current); setAiUnavailable(null); generateSection(aiUnavailable.sectionId) }} style={{ padding: '6px 14px', background: '#d97706', border: 'none', borderRadius: 6, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>Retry Now</button>
          <button onClick={() => { if (retryTimerRef.current) clearInterval(retryTimerRef.current); setAiUnavailable(null) }} style={{ background: 'none', border: 'none', color: '#d97706', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Collaboration Panel */}
      {showCollabPanel && (
        <CollaborationPanel
          projectId={project.id}
          projectOwnerId={project.user_id}
          onClose={() => setShowCollabPanel(false)}
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

      {/* Submission Checklist Modal (v5.6.0) */}
      {showChecklist && checklistData && (
        <ChecklistModal
          checklist={checklistData}
          onClose={() => setShowChecklist(false)}
          onEmail={() => api.emailChecklist(project.id)}
          projectId={project.id}
        />
      )}

      {/* Email to Colleague Modal (v5.7.0) */}
      {showEmailColleagueModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 440, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>📧 Email Grant to Colleague</div>
              <button onClick={() => { setShowEmailColleagueModal(false); setEmailColleagueStatus(null); setEmailColleagueTo('') }} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>Send the combined DOCX as an email attachment.</div>
            <input
              type="email"
              placeholder="colleague@university.edu"
              value={emailColleague_to}
              onChange={e => setEmailColleagueTo(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleEmailColleague()}
              style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, marginBottom: 10, boxSizing: 'border-box' }}
            />
            {emailColleague_status && (
              <div style={{ fontSize: 12, color: emailColleague_status.ok ? '#15803d' : '#dc2626', marginBottom: 8 }}>{emailColleague_status.msg}</div>
            )}
            {emailColleague_sentList.length > 0 && (
              <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 10 }}>Sent this session: {emailColleague_sentList.join(', ')}</div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowEmailColleagueModal(false); setEmailColleagueStatus(null); setEmailColleagueTo('') }} style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Close</button>
              <button onClick={handleEmailColleague} disabled={emailColleague_sending} style={{ padding: '8px 16px', background: emailColleague_sending ? '#e5e7eb' : '#0e7490', color: emailColleague_sending ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6, cursor: emailColleague_sending ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}>
                {emailColleague_sending ? '⟳ Sending…' : 'Send Grant'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Share Link Modal (v5.7.0) */}
      {showShareModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 16 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 24, width: '100%', maxWidth: 480, boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>🔗 Shareable Read-Only Link</div>
              <button onClick={() => setShowShareModal(false)} style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#6b7280' }}>✕</button>
            </div>
            <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 14 }}>⚠️ Anyone with this link can view your grant in read-only mode.</div>
            {shareLoading && <div style={{ fontSize: 13, color: '#6b7280' }}>Loading…</div>}
            {!shareLoading && shareInfo && !shareInfo.enabled && (
              <div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 14 }}>No active share link. Create one below (30-day expiry).</div>
                <button onClick={handleCreateShare} style={{ padding: '8px 16px', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Create Share Link</button>
              </div>
            )}
            {!shareLoading && shareInfo && shareInfo.enabled && (
              <div>
                <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 10px', fontSize: 12, color: '#374151', wordBreak: 'break-all', marginBottom: 8 }}>
                  {shareInfo.share_url}
                </div>
                {shareInfo.expires_at && (
                  <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 12 }}>
                    Expires: {new Date(shareInfo.expires_at * 1000).toLocaleDateString()}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    onClick={() => { navigator.clipboard.writeText(shareInfo.share_url).catch(() => {}); }}
                    style={{ padding: '8px 14px', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}
                  >📋 Copy Link</button>
                  <button
                    onClick={handleRevokeShare}
                    disabled={shareLoading}
                    style={{ padding: '8px 14px', background: '#fff', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                  >Revoke</button>
                </div>
              </div>
            )}
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowShareModal(false)} style={{ padding: '8px 14px', border: '1px solid #d1d5db', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Aims Optimizer Modal ─────────────────────────────────────────────────────
function AimsOptimizerModal({ data, altLoading, onGenerateAlts, onClose, onRerun, onRewrite }) {
  const [expanded, setExpanded] = useState({})
  const score = data.overall_score || 0
  const scoreColor = score >= 80 ? '#16a34a' : score >= 60 ? '#d97706' : '#dc2626'
  const scoreBg = score >= 80 ? '#f0fdf4' : score >= 60 ? '#fffbeb' : '#fef2f2'
  const scoreBorder = score >= 80 ? '#86efac' : score >= 60 ? '#fbbf24' : '#fca5a5'
  const elementLabels = { hook_sentence: 'Hook Sentence', problem_statement: 'Problem Statement', aims_structure: 'Aims Structure', innovation_claim: 'Innovation Claim', impact_statement: 'Impact Statement' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 680, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>🎯 Specific Aims Score</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onRerun} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>↻ Re-run</button>
            <button onClick={onClose} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>✕ Close</button>
          </div>
        </div>

        {/* Overall score */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, padding: '16px 20px', background: scoreBg, border: `1px solid ${scoreBorder}`, borderRadius: 10, marginBottom: 20 }}>
          <div style={{ textAlign: 'center', minWidth: 80 }}>
            <div style={{ fontSize: 42, fontWeight: 800, color: scoreColor, lineHeight: 1 }}>{score}</div>
            <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>out of 100</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ height: 10, background: '#e5e7eb', borderRadius: 5, overflow: 'hidden', marginBottom: 8 }}>
              <div style={{ height: '100%', width: `${score}%`, background: scoreColor, borderRadius: 5, transition: 'width 0.6s ease' }} />
            </div>
            {data.fundability_prediction && (
              <div style={{ fontSize: 13, fontWeight: 600, color: scoreColor }}>{data.fundability_prediction}</div>
            )}
          </div>
        </div>

        {/* 5 element bars */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 10 }}>Element Scores</div>
          {data.elements && Object.entries(data.elements).map(([key, el]) => (
            <div key={key} style={{ marginBottom: 8, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', cursor: 'pointer', background: key === data.strongest_element ? '#f0fdf4' : key === data.weakest_element ? '#fef2f2' : '#fafafa' }}
                onClick={() => setExpanded(e => ({ ...e, [key]: !e[key] }))}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
                    {elementLabels[key] || key}
                    {key === data.strongest_element && <span style={{ marginLeft: 6, fontSize: 10, background: '#dcfce7', color: '#166534', padding: '1px 5px', borderRadius: 10 }}>Strongest</span>}
                    {key === data.weakest_element && <span style={{ marginLeft: 6, fontSize: 10, background: '#fee2e2', color: '#991b1b', padding: '1px 5px', borderRadius: 10 }}>Needs Work</span>}
                  </div>
                  <div style={{ height: 5, background: '#e5e7eb', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(el.score / 20) * 100}%`, background: el.score >= 16 ? '#16a34a' : el.score >= 12 ? '#d97706' : '#dc2626', borderRadius: 3 }} />
                  </div>
                </div>
                <div style={{ fontSize: 15, fontWeight: 700, minWidth: 40, textAlign: 'right', color: el.score >= 16 ? '#16a34a' : el.score >= 12 ? '#d97706' : '#dc2626' }}>{el.score}/20</div>
                <div style={{ fontSize: 11, color: '#888' }}>{expanded[key] ? '▲' : '▼'}</div>
              </div>
              {expanded[key] && (
                <div style={{ padding: '10px 12px', borderTop: '1px solid #e5e7eb', fontSize: 12, lineHeight: 1.6 }}>
                  <div style={{ marginBottom: 6 }}><span style={{ fontWeight: 600 }}>Feedback: </span>{el.feedback}</div>
                  {el.example_improvement && (
                    <div style={{ background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, padding: '8px 10px', color: '#1e40af', fontStyle: 'italic' }}>
                      <span style={{ fontWeight: 600, fontStyle: 'normal' }}>Example: </span>{el.example_improvement}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Top 3 improvements */}
        {data.top_three_improvements && data.top_three_improvements.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Top 3 Action Items</div>
            {data.top_three_improvements.map((item, i) => (
              <div key={i} style={{ display: 'flex', gap: 10, marginBottom: 6, padding: '8px 12px', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, fontSize: 12 }}>
                <span style={{ fontWeight: 700, color: '#d97706', minWidth: 18 }}>{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        )}

        {/* Reviewer first impression */}
        {data.reviewer_first_impression && (
          <div style={{ padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 16, fontSize: 13, fontStyle: 'italic', lineHeight: 1.6 }}>
            <div style={{ fontWeight: 700, fontStyle: 'normal', fontSize: 11, color: '#64748b', marginBottom: 4 }}>REVIEWER FIRST IMPRESSION</div>
            "{data.reviewer_first_impression}"
          </div>
        )}

        <button
          onClick={onGenerateAlts}
          disabled={altLoading}
          style={{ width: '100%', padding: '10px', background: '#1e40af', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: altLoading ? 'not-allowed' : 'pointer', opacity: altLoading ? 0.7 : 1 }}
        >
          {altLoading ? '⟳ Generating 3 Alternative Structures…' : '✨ Generate Alternative Aims Structures'}
        </button>
        {onRewrite && (
          <button
            onClick={onRewrite}
            style={{ width: '100%', marginTop: 10, padding: '10px', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
          >
            ✍️ Rewrite Grant to Address This Feedback
          </button>
        )}
      </div>
    </div>
  )
}

// ── Aims Alternatives Modal ───────────────────────────────────────────────────
function AimsAlternativesModal({ alternatives, onUse, onClose }) {
  const structureColors = ['#1e40af', '#7c3aed', '#0f766e']
  const structureBgs = ['#eff6ff', '#f5f3ff', '#f0fdfa']

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}>
      <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 1100, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: 17 }}>✨ Alternative Aims Structures</div>
          <button onClick={onClose} style={{ fontSize: 12, padding: '4px 10px', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff' }}>← Back to Score</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
          {alternatives.map((alt, i) => (
            <div key={i} style={{ border: `1.5px solid ${structureColors[i]}30`, borderRadius: 10, overflow: 'hidden' }}>
              <div style={{ padding: '10px 14px', background: structureBgs[i], borderBottom: `1px solid ${structureColors[i]}20` }}>
                <div style={{ fontWeight: 700, fontSize: 13, color: structureColors[i] }}>{alt.name}</div>
              </div>
              <div style={{ padding: '12px 14px', fontSize: 12, lineHeight: 1.65, whiteSpace: 'pre-wrap', maxHeight: 360, overflowY: 'auto', color: '#374151' }}>{alt.text}</div>
              <div style={{ padding: '10px 14px', borderTop: `1px solid ${structureColors[i]}20`, background: structureBgs[i] }}>
                <button
                  onClick={() => onUse(alt.text)}
                  style={{ width: '100%', padding: '7px', background: structureColors[i], color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
                >
                  Use This Version
                </button>
              </div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 16, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, fontSize: 12, color: '#666', textAlign: 'center' }}>
          Mix &amp; Match: Copy elements from any version and paste into your Aims section in the writer tab.
        </div>
      </div>
    </div>
  )
}

// ── Fast Track Dual Writer ──────────────────────────────────────────────────
function FastTrackWriter({
  project, sections, scores, ft1, ft2, goNoGo,
  activeSec, setActiveSec,
  generating, scoring,
  onGenerate, onGenerateStd, onUpdateFT1, onUpdateFT2, onUpdateSection, onScore,
  visibleSecs, mech, setup, inputStyle, ghostBtn, mechBtn,
  complianceResults, compliancePolling, complianceExpanded, setComplianceExpanded, onRecheck,
  chartData, showCharts, setShowCharts, generatingCharts, onGenerateCharts,
  citationSection, citationResults, citationLoading, onFindCitations, setCitationSection, onInsertCitation,
  polishing, onPolish, resubAnalysis, resubRevising, onRevise,
}) {
  const PHASE1_SECS = [
    { id: 'phase1_sig', label: 'Phase I Significance', phase: 1 },
    { id: 'phase1_innov', label: 'Phase I Innovation', phase: 1 },
    { id: 'phase1_approach', label: 'Phase I Approach', phase: 1 },
  ]
  const PHASE2_SECS = [
    { id: 'phase2_sig', label: 'Phase II Significance', phase: 2 },
    { id: 'phase2_innov', label: 'Phase II Innovation', phase: 2 },
    { id: 'phase2_approach', label: 'Phase II Approach', phase: 2 },
  ]

  // Non-research-strategy standard sections
  const stdSecs = visibleSecs.filter(s => !['sig','innov','approach'].includes(s.id))

  function getContent(secId, phase) {
    if (phase === 1) return ft1[secId] || ''
    if (phase === 2) return ft2[secId] || ''
    return sections[secId] || ''
  }

  function isActiveSec(id) { return activeSec === id }

  function renderSectionEditor(secId, phase, label) {
    const content = getContent(secId, phase)
    const isFT = phase === 1 || phase === 2
    return (
      <div key={secId}>
        <button
          disabled={generating[secId]}
          onClick={() => isFT ? onGenerate(phase, secId) : onGenerateStd(secId)}
          style={{ ...ghostBtn, marginBottom: 8, fontWeight: 500 }}
        >
          {generating[secId] ? 'Writing...' : content ? 'Regenerate ↗' : `Generate ${label} ↗`}
        </button>
        <textarea
          value={content}
          onChange={e => {
            if (phase === 1) onUpdateFT1(secId, e.target.value)
            else if (phase === 2) onUpdateFT2(secId, e.target.value)
            else onUpdateSection(secId, e.target.value)
          }}
          style={{ ...inputStyle, minHeight: 280, resize: 'vertical', width: '100%', lineHeight: 1.8, fontFamily: 'Georgia, serif', fontSize: 13 }}
          placeholder={`Your ${label} text will appear here.`}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, marginBottom: 8 }}>
          <span style={{ fontSize: 11, color: '#999' }}>
            {content ? `${content.split(/\s+/).filter(Boolean).length} words` : ''}
          </span>
        </div>
        {content && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            <button onClick={() => isFT ? onFindCitations(secId) : onFindCitations(secId)} disabled={citationLoading[secId]} style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}>
              {citationLoading[secId] ? '⟳ Searching PubMed…' : '📚 Find Citations'}
            </button>
            <button onClick={() => onPolish(secId)} disabled={polishing[secId]} style={{ ...ghostBtn, fontSize: 11, padding: '4px 10px' }}>
              {polishing[secId] ? '⟳ Polishing…' : '✨ Polish'}
            </button>
          </div>
        )}
        {citationSection === secId && citationResults[secId] && (
          <CitationsPanel
            citations={citationResults[secId]}
            onInsert={(cite) => {
              if (phase === 1) onUpdateFT1(secId, content + '\n\n' + cite)
              else if (phase === 2) onUpdateFT2(secId, content + '\n\n' + cite)
              else onInsertCitation(secId, cite)
            }}
            onRefresh={() => onFindCitations(secId)}
          />
        )}
      </div>
    )
  }

  const allSecs = [
    ...PHASE1_SECS,
    { id: '_gonogo', label: 'Go/No-Go', phase: 0 },
    ...PHASE2_SECS,
    ...stdSecs.map(s => ({ ...s, phase: 0 })),
  ]

  const activeMeta = allSecs.find(s => s.id === activeSec)

  return (
    <div>
      {/* Phase I Group */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Phase I Research Strategy (6 pages)
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHASE1_SECS.map(s => {
            const hasText = !!ft1[s.id]
            return (
              <button key={s.id} onClick={() => setActiveSec(s.id)} style={{ ...mechBtn(isActiveSec(s.id)), position: 'relative' }}>
                {s.label}
                {hasText && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4caf50', position: 'absolute', top: 4, right: 4 }} />}
              </button>
            )
          })}
        </div>
        {/* Phase I word count */}
        {(ft1.phase1_sig || ft1.phase1_innov || ft1.phase1_approach) && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
            Phase I Research Strategy: {Math.round(([ft1.phase1_sig, ft1.phase1_innov, ft1.phase1_approach].filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length) / 275 * 10) / 10} / 6 pages
          </div>
        )}
      </div>

      {/* Go/No-Go Milestone display */}
      <div style={{ margin: '10px 0', padding: '10px 14px', background: goNoGo ? '#f0fdf4' : '#fff7ed', border: `1px solid ${goNoGo ? '#86efac' : '#fbbf24'}`, borderRadius: 8, fontSize: 12 }}>
        <div style={{ fontWeight: 600, color: goNoGo ? '#166534' : '#92400e', marginBottom: goNoGo ? 4 : 0 }}>
          {goNoGo ? '✓ Go/No-Go Milestone' : '⚠ Go/No-Go Milestone not set — add in Project Setup tab'}
        </div>
        {goNoGo && <div style={{ color: '#166534', lineHeight: 1.5 }}>{goNoGo}</div>}
      </div>

      {/* Phase II Group */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
          Phase II Research Strategy (12 pages)
        </div>
        <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
          {PHASE2_SECS.map(s => {
            const hasText = !!ft2[s.id]
            return (
              <button key={s.id} onClick={() => setActiveSec(s.id)} style={{ ...mechBtn(isActiveSec(s.id)), position: 'relative' }}>
                {s.label}
                {hasText && <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#4caf50', position: 'absolute', top: 4, right: 4 }} />}
              </button>
            )
          })}
        </div>
        {(ft2.phase2_sig || ft2.phase2_innov || ft2.phase2_approach) && (
          <div style={{ marginTop: 6, fontSize: 11, color: '#6b7280' }}>
            Phase II Research Strategy: {Math.round(([ft2.phase2_sig, ft2.phase2_innov, ft2.phase2_approach].filter(Boolean).join(' ').split(/\s+/).filter(Boolean).length) / 275 * 10) / 10} / 12 pages
          </div>
        )}
      </div>

      {/* Other sections */}
      {stdSecs.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            Other Sections
          </div>
          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
            {stdSecs.map(s => {
              const hasText = !!sections[s.id]
              const sc = scores[s.id]
              return (
                <button key={s.id} onClick={() => setActiveSec(s.id)} style={{ ...mechBtn(isActiveSec(s.id)), position: 'relative' }}>
                  {s.label}
                  {hasText && <span style={{ width: 5, height: 5, borderRadius: '50%', background: sc ? (sc.score <= 3 ? '#4caf50' : sc.score <= 5 ? '#ff9800' : '#e53935') : '#4caf50', position: 'absolute', top: 4, right: 4 }} />}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Active section editor */}
      <div style={{ marginTop: 12 }}>
        {activeMeta && activeMeta.phase === 1 && renderSectionEditor(activeSec, 1, activeMeta.label)}
        {activeMeta && activeMeta.phase === 2 && renderSectionEditor(activeSec, 2, activeMeta.label)}
        {activeMeta && activeMeta.phase === 0 && activeMeta.id !== '_gonogo' && renderSectionEditor(activeSec, 0, activeMeta.label)}
        {activeMeta && activeMeta.id === '_gonogo' && (
          <div style={{ padding: '12px 14px', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, fontSize: 13, color: '#78350f' }}>
            Configure the Go/No-Go milestone in the <strong>Project Setup</strong> tab.
          </div>
        )}
      </div>
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
  const [showEvidence, setShowEvidence] = React.useState(false)
  const s = score.score
  const scoreable = score.scoreable !== false
  const confColor = { high: '#16a34a', medium: '#d97706', low: '#dc2626' }[score.confidence] || '#6b7280'
  return (
    <div style={{ border: '0.5px solid #e5e5e5', borderRadius: 8, marginBottom: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '10px 14px', background: scoreable ? '#f8f8f8' : '#f9fafb' }}>
        <div style={{ fontSize: 24, fontWeight: 500, minWidth: 28, color: scoreable ? (s <= 3 ? '#16a34a' : s <= 5 ? '#2563eb' : '#dc2626') : '#9ca3af' }}>
          {loading ? '↻' : scoreable ? s : '—'}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, color: '#888' }}>{label} · live score</div>
          {scoreable ? (
            <>
              <div style={{ fontSize: 13, fontWeight: 500 }}>{score.descriptor || getDescriptor(s)}</div>
              {score.confidence && <span style={{ fontSize: 10, color: confColor, fontWeight: 600 }}>{score.confidence.toUpperCase()} CONFIDENCE</span>}
              {score.narrative && <div style={{ fontSize: 12, color: '#555', marginTop: 4, lineHeight: 1.6 }}>{score.narrative}</div>}
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 5 }}>
                {(score.strengths || []).slice(0, 2).map((str, i) => <span key={i} style={pill}>✓ {str.slice(0, 45)}</span>)}
                {(score.weaknesses || []).slice(0, 2).map((w, i) => <span key={i} style={pill}>△ {w.slice(0, 45)}</span>)}
              </div>
              {(score.evidence || score.score_rationale) && (
                <button onClick={() => setShowEvidence(v => !v)} style={{ ...ghostBtn, fontSize: 10, marginTop: 6, padding: '2px 8px' }}>
                  {showEvidence ? '▲ Hide' : '▼ Why this score'}
                </button>
              )}
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>⚠ Unscorable — complete this section to receive a score</div>
              {score.unscorable_reason && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, fontStyle: 'italic' }}>{score.unscorable_reason}</div>}
            </>
          )}
        </div>
        <button onClick={onRescore} disabled={loading} style={{ ...ghostBtn, fontSize: 11 }}>Re-score</button>
      </div>
      {showEvidence && scoreable && (score.evidence || score.score_rationale) && (
        <div style={{ padding: '10px 14px', background: '#fff', borderTop: '0.5px solid #e5e5e5', fontSize: 12 }}>
          {score.evidence && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>Evidence from grant:</div>
              <div style={{ color: '#374151', lineHeight: 1.6, fontStyle: 'italic', borderLeft: '2px solid #d1d5db', paddingLeft: 10 }}>{score.evidence}</div>
            </div>
          )}
          {score.score_rationale && (
            <div>
              <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>Score rationale:</div>
              <div style={{ color: '#555', lineHeight: 1.6 }}>{score.score_rationale}</div>
            </div>
          )}
        </div>
      )}
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
function PDReviewResultsModal({ results, onClose, onRerun, onRewrite }) {
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

          <MissingComponentsPanel missingComponents={results.missing_components} packageCritique={results.package_completeness_critique} />
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={copyMemo} style={ghostBtn}>Copy memo</button>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          {onRewrite && <button onClick={onRewrite} style={{ ...ghostBtn, borderColor: '#0e7490', color: '#0e7490', fontWeight: 600 }}>✍️ Rewrite Grant to Address This Feedback</button>}
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
function AdvisoryCouncilModal({ results, onClose, onRerun, onRewrite }) {
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

          <MissingComponentsPanel missingComponents={results.missing_components} packageCritique={results.package_completeness_critique} />
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          {onRewrite && <button onClick={onRewrite} style={{ ...ghostBtn, borderColor: '#0e7490', color: '#0e7490', fontWeight: 600 }}>✍️ Rewrite Grant to Address This Feedback</button>}
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

// ── NIHScoreCard — evidence-based criterion display ───────────────────────────
function NIHScoreCard({ criteria, impact }) {
  const [expandedKey, setExpandedKey] = React.useState(null)
  const CRITERION_KEYS = ['significance', 'innovation', 'approach', 'investigators', 'environment']
  const CRITERION_LABELS = { significance: 'Significance', innovation: 'Innovation', approach: 'Approach', investigators: 'Investigators', environment: 'Environment' }

  // Normalise: old format is {significance: 4, ...}, new is {significance: {score, evidence, ...}}
  const normaliseCriterion = (k, v) => {
    if (typeof v === 'number') return { score: v, scoreable: true, evidence: null, score_rationale: null, confidence: null, unscorable_reason: null }
    return v || { score: null, scoreable: false, evidence: null, score_rationale: null, confidence: null, unscorable_reason: 'No data' }
  }

  const normCriteria = {}
  for (const k of CRITERION_KEYS) normCriteria[k] = normaliseCriterion(k, criteria[k])

  const scoreableCount = CRITERION_KEYS.filter(k => normCriteria[k].scoreable !== false).length
  const bannerConfig = scoreableCount === 5
    ? { bg: '#f0fdf4', border: '#86efac', text: '#166534', icon: '✅', msg: 'All 5 criteria fully scored' }
    : scoreableCount >= 3
    ? { bg: '#fffbeb', border: '#fcd34d', text: '#92400e', icon: '⚠️', msg: `${scoreableCount} of 5 criteria scored — ${5 - scoreableCount} require more content` }
    : { bg: '#fef2f2', border: '#fca5a5', text: '#991b1b', icon: '❌', msg: `Only ${scoreableCount} of 5 criteria scoreable — overall impact score suspended` }

  const scoreColor = (s) => s == null ? '#9ca3af' : s <= 3 ? '#16a34a' : s <= 5 ? '#2563eb' : s <= 7 ? '#d97706' : '#dc2626'
  const confColor = { high: '#16a34a', medium: '#d97706', low: '#dc2626' }

  return (
    <div style={{ marginBottom: 20 }}>
      {/* Completeness banner */}
      <div style={{ padding: '8px 12px', background: bannerConfig.bg, border: `0.5px solid ${bannerConfig.border}`, borderRadius: 8, marginBottom: 10, fontSize: 12, color: bannerConfig.text, fontWeight: 500 }}>
        {bannerConfig.icon} {bannerConfig.msg}
      </div>

      {/* Criterion cards */}
      <div style={{ fontSize: 12, fontWeight: 600, color: '#555', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>Criterion Scores (1 = Exceptional, 9 = Poor)</div>
      {CRITERION_KEYS.map(k => {
        const c = normCriteria[k]
        const isExpanded = expandedKey === k
        const scoreable = c.scoreable !== false
        return (
          <div key={k} style={{ border: '0.5px solid #e5e5e5', borderRadius: 8, marginBottom: 6, overflow: 'hidden' }}>
            <div
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: scoreable ? '#f8f8f8' : '#f9fafb', cursor: (c.evidence || c.score_rationale || c.unscorable_reason) ? 'pointer' : 'default' }}
              onClick={() => (c.evidence || c.score_rationale || c.unscorable_reason) && setExpandedKey(isExpanded ? null : k)}
            >
              <div style={{ fontSize: 22, fontWeight: 700, minWidth: 32, color: scoreable ? scoreColor(c.score) : '#9ca3af' }}>
                {scoreable ? (c.score ?? '—') : '—'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 500, textTransform: 'capitalize' }}>{CRITERION_LABELS[k]}</div>
                {!scoreable && c.unscorable_reason && (
                  <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 1 }}>⚠ {c.unscorable_reason.slice(0, 80)}{c.unscorable_reason.length > 80 ? '…' : ''}</div>
                )}
                {scoreable && c.confidence && (
                  <span style={{ fontSize: 10, color: confColor[c.confidence] || '#6b7280', fontWeight: 600 }}>{c.confidence.toUpperCase()} CONFIDENCE</span>
                )}
              </div>
              {!scoreable ? (
                <span style={{ fontSize: 11, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 10 }}>Complete to score</span>
              ) : (c.evidence || c.score_rationale) ? (
                <span style={{ color: '#9ca3af', fontSize: 11 }}>{isExpanded ? '▲' : '▼ Why'}</span>
              ) : null}
            </div>
            {isExpanded && (
              <div style={{ padding: '10px 14px', background: '#fff', borderTop: '0.5px solid #e5e5e5', fontSize: 12 }}>
                {!scoreable ? (
                  <div style={{ padding: '8px 12px', background: '#f9fafb', border: '0.5px solid #e5e5e5', borderRadius: 6, color: '#6b7280' }}>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>⚠ Complete this section to receive a score</div>
                    <div style={{ fontStyle: 'italic' }}>{c.unscorable_reason}</div>
                  </div>
                ) : (
                  <>
                    {c.evidence && (
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>Evidence from grant</div>
                        <div style={{ color: '#374151', lineHeight: 1.7, fontStyle: 'italic', borderLeft: '2px solid #d1d5db', paddingLeft: 10 }}>{c.evidence}</div>
                      </div>
                    )}
                    {c.score_rationale && (
                      <div>
                        <div style={{ fontWeight: 600, color: '#374151', marginBottom: 4 }}>Score rationale</div>
                        <div style={{ color: '#555', lineHeight: 1.7 }}>{c.score_rationale}</div>
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Study Section Results Modal ──────────────────────────────────────────────
function StudySectionResultsModal({ results, onClose, onRerun, onRewrite }) {
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
          {/* NIHScoreCard — Completeness Banner + Criterion Cards */}
          <NIHScoreCard criteria={criteria} impact={impact} />

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
                  <div style={{ fontSize: 18, fontWeight: 600, color: scores.impact == null ? '#9ca3af' : scores.impact <= 3 ? '#16a34a' : scores.impact <= 5 ? '#2563eb' : '#dc2626' }}>
                    {scores.impact ?? '—'}
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

          <MissingComponentsPanel missingComponents={results.summary?.missing_components} packageCritique={results.summary?.package_completeness_critique} />
        </div>

        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          {onRewrite && <button onClick={onRewrite} style={{ ...ghostBtn, borderColor: '#0e7490', color: '#0e7490', fontWeight: 600 }}>✍️ Rewrite Grant to Address This Feedback</button>}
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

// ── Commercial Review Modal ────────────────────────────────────────────────────
function CommercialReviewModal({ results, onClose, onRerun, onRewrite }) {
  const viabilityConfig = {
    high: { bg: '#dcfce7', border: '#86efac', text: '#15803d', label: '✅ HIGH VIABILITY' },
    medium: { bg: '#fef9c3', border: '#fde047', text: '#854d0e', label: '⚠️ MEDIUM VIABILITY' },
    low: { bg: '#ffedd5', border: '#fdba74', text: '#9a3412', label: '🔶 LOW VIABILITY' },
    not_viable: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', label: '❌ NOT VIABLE' },
  }
  const vc = viabilityConfig[results.viability] || viabilityConfig.medium
  const invConfig = { series_a_ready: { label: 'Series A Ready', color: '#15803d' }, seed_stage: { label: 'Seed Stage', color: '#1d4ed8' }, pre_seed: { label: 'Pre-Seed', color: '#92400e' }, not_ready: { label: 'Not Investor Ready', color: '#991b1b' } }
  const inv = invConfig[results.investor_readiness] || { label: results.investor_readiness || 'Unknown', color: '#6b7280' }

  function ScoreDimension({ label, dim }) {
    const [showEvidence, setShowEvidence] = React.useState(false)
    if (!dim) return null
    const scoreable = dim.scoreable !== false
    const pct = scoreable && dim.score != null ? (dim.score / 20) * 100 : 0
    const color = pct >= 70 ? '#16a34a' : pct >= 40 ? '#d97706' : '#dc2626'
    const confColor = { high: '#16a34a', medium: '#d97706', low: '#dc2626' }[dim.confidence] || '#6b7280'
    return (
      <div style={{ marginBottom: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 13 }}>
          <span style={{ fontWeight: 600 }}>{label}</span>
          <span style={{ fontWeight: 700, color: scoreable ? color : '#9ca3af' }}>{scoreable && dim.score != null ? `${dim.score}/20` : '—/20'}</span>
        </div>
        {scoreable ? (
          <>
            <div style={{ height: 6, background: '#e5e7eb', borderRadius: 3, marginBottom: 8 }}>
              <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 3 }} />
            </div>
            {dim.confidence && <div style={{ fontSize: 10, color: confColor, fontWeight: 600, marginBottom: 4 }}>{dim.confidence.toUpperCase()} CONFIDENCE</div>}
            <div style={{ fontSize: 12, color: '#374151', lineHeight: 1.5 }}>{dim.feedback}</div>
            {dim.key_insight && <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4, fontStyle: 'italic' }}>{dim.key_insight}</div>}
            {(dim.evidence || dim.score_rationale) && (
              <button onClick={() => setShowEvidence(v => !v)} style={{ ...ghostBtn, fontSize: 10, marginTop: 6, padding: '2px 8px' }}>
                {showEvidence ? '▲ Hide' : '▼ Why this score'}
              </button>
            )}
            {showEvidence && (
              <div style={{ marginTop: 8, padding: '10px 12px', background: '#f9fafb', borderRadius: 6, fontSize: 12 }}>
                {dim.evidence && (
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>Evidence from grant</div>
                    <div style={{ color: '#374151', lineHeight: 1.6, fontStyle: 'italic', borderLeft: '2px solid #d1d5db', paddingLeft: 10 }}>{dim.evidence}</div>
                  </div>
                )}
                {dim.score_rationale && (
                  <div>
                    <div style={{ fontWeight: 600, color: '#374151', marginBottom: 3 }}>Score rationale</div>
                    <div style={{ color: '#555', lineHeight: 1.6 }}>{dim.score_rationale}</div>
                  </div>
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '8px 12px', background: '#f9fafb', border: '0.5px solid #e5e5e5', borderRadius: 6, marginBottom: 4 }}>
            <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>⚠ Complete this section to receive a score</div>
            {dim.unscorable_reason && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3, fontStyle: 'italic' }}>{dim.unscorable_reason}</div>}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '2rem 1rem' }}>
      <div style={{ background: '#fff', borderRadius: 14, width: '100%', maxWidth: 680 }}>
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '0.5px solid #e5e5e5', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: 17 }}>💰 Commercial Review</div>
            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>VC & Commercialization Expert Assessment</div>
          </div>
          <button onClick={onClose} style={{ ...ghostBtn, padding: '4px 10px', fontSize: 13 }}>✕</button>
        </div>
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          {/* Viability + Overall Score */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1, padding: '16px 20px', background: vc.bg, border: `1.5px solid ${vc.border}`, borderRadius: 10, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: vc.text }}>{vc.label}</div>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8f8f8', borderRadius: 10, textAlign: 'center', minWidth: 100 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>SCORE</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: (results.overall_score || 0) >= 70 ? '#15803d' : (results.overall_score || 0) >= 50 ? '#d97706' : '#dc2626' }}>{results.overall_score || 0}</div>
              <div style={{ fontSize: 10, color: '#9ca3af' }}>/ 100</div>
            </div>
            <div style={{ padding: '16px 20px', background: '#f8f8f8', borderRadius: 10, textAlign: 'center', minWidth: 120 }}>
              <div style={{ fontSize: 11, color: '#888', marginBottom: 4, fontWeight: 600 }}>INVESTOR READINESS</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: inv.color }}>{inv.label}</div>
            </div>
          </div>

          {/* 5 Dimension Scores */}
          <div>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Dimension Scores</div>
            <ScoreDimension label="🏪 Market Assessment" dim={results.market} />
            <ScoreDimension label="🔒 IP Strategy" dim={results.ip} />
            <ScoreDimension label="🏥 Regulatory Pathway" dim={results.regulatory} />
            <ScoreDimension label="💵 Revenue Model" dim={results.revenue_model} />
            <ScoreDimension label="👥 Commercial Team" dim={results.commercial_team} />
            {results.commercial_team?.gaps?.length > 0 && (
              <div style={{ marginTop: -8, marginBottom: 14, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {results.commercial_team.gaps.map((g, i) => <span key={i} style={{ fontSize: 11, background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: 10 }}>{g}</span>)}
              </div>
            )}
          </div>

          {/* Strengths + Weaknesses */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {(results.strengths || []).length > 0 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#15803d' }}>Strengths</div>
                {results.strengths.map((s, i) => <div key={i} style={{ fontSize: 12, marginBottom: 6, paddingLeft: 12, borderLeft: '2px solid #86efac' }}>{s}</div>)}
              </div>
            )}
            {(results.critical_weaknesses || []).length > 0 && (
              <div>
                <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: '#dc2626' }}>Critical Weaknesses</div>
                {results.critical_weaknesses.map((w, i) => <div key={i} style={{ fontSize: 12, marginBottom: 6, paddingLeft: 12, borderLeft: '2px solid #fca5a5' }}>{w}</div>)}
              </div>
            )}
          </div>

          {/* Top Improvements */}
          {(results.top_improvements || []).length > 0 && (
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8 }}>Top Improvements to Make</div>
              {results.top_improvements.map((imp, i) => (
                <div key={i} style={{ display: 'flex', gap: 8, padding: '8px 12px', background: '#fffbeb', borderRadius: 8, fontSize: 12, marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, color: '#d97706' }}>{i + 1}.</span>
                  <span>{imp}</span>
                </div>
              ))}
            </div>
          )}

          {/* Phase 3 readiness + bottom line */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {results.phase3_readiness && (
              <div style={{ padding: '12px 16px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>PHASE III READINESS</div>
                <div style={{ fontSize: 12 }}>{results.phase3_readiness}</div>
              </div>
            )}
            {results.bottom_line && (
              <div style={{ padding: '12px 16px', background: '#1e293b', borderRadius: 8 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 600 }}>BOTTOM LINE</div>
                <div style={{ fontSize: 12, color: '#f1f5f9', lineHeight: 1.5 }}>{results.bottom_line}</div>
              </div>
            )}
          </div>

          <MissingComponentsPanel missingComponents={results.missing_components} packageCritique={results.package_completeness_critique} />
        </div>
        <div style={{ padding: '1rem 1.5rem', borderTop: '0.5px solid #e5e5e5', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <button onClick={onRerun} style={ghostBtn}>Re-run</button>
          {onRewrite && (
            <button
              onClick={onRewrite}
              style={{ padding: '7px 14px', fontSize: 13, fontWeight: 600, background: '#0e7490', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            >
              ✍️ Rewrite Grant to Address This Feedback
            </button>
          )}
          <button onClick={onClose} style={{ ...ghostBtn, marginLeft: 'auto' }}>Close</button>
        </div>
      </div>
    </div>
  )
}

// ── Completeness Gate Modal ───────────────────────────────────────────────────
function CompletenessModal({ reviewType, items, onProceed, onClose }) {
  const missing = items.filter(i => i.missing)
  const brief = items.filter(i => i.brief)
  const complete = items.filter(i => !i.missing && !i.brief)
  const pct = Math.round((complete.length / items.length) * 100)

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 3000 }}>
      <div style={{ background: '#fff', borderRadius: 14, padding: '32px', maxWidth: 520, width: '90%', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 4 }}>Document Completeness Check</div>
        <div style={{ fontSize: 13, color: '#888', marginBottom: 20 }}>Before running {reviewType} · {pct}% complete</div>

        <div style={{ marginBottom: 20 }}>
          {items.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '7px 0', borderBottom: '0.5px solid #f0f0f0' }}>
              <span style={{ fontSize: 16, flexShrink: 0 }}>
                {item.missing ? '❌' : item.brief ? '⚠️' : '✅'}
              </span>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 13, fontWeight: 500 }}>{item.label}</span>
                <span style={{ fontSize: 12, color: '#888', marginLeft: 8 }}>
                  {item.missing
                    ? 'not generated'
                    : item.brief
                      ? `${item.words} words — expected ≥${item.min}`
                      : `${item.words} words`}
                </span>
              </div>
            </div>
          ))}
        </div>

        {(missing.length > 0 || brief.length > 0) && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#92400e', marginBottom: 20 }}>
            {missing.length > 0 && <div><strong>{missing.length} section{missing.length > 1 ? 's' : ''} not generated.</strong> Reviewers will note these as absent and cannot score criteria that depend on them.</div>}
            {brief.length > 0 && <div style={{ marginTop: missing.length > 0 ? 6 : 0 }}><strong>{brief.length} section{brief.length > 1 ? 's' : ''} may be incomplete.</strong> Reviewers will flag thin sections and score based only on what is present.</div>}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={onProceed}
            style={{ flex: 1, padding: '10px', background: '#fff', border: '1.5px solid #d97706', borderRadius: 8, color: '#92400e', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Score anyway
          </button>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '10px', background: '#111', border: 'none', borderRadius: 8, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}
          >
            Complete document first (recommended)
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Missing Components Panel ──────────────────────────────────────────────────
export function MissingComponentsPanel({ missingComponents, packageCritique }) {
  if (!missingComponents?.length && !packageCritique) return null

  const critical = missingComponents?.filter(c => c.severity === 'critical') || []
  const major = missingComponents?.filter(c => c.severity === 'major') || []
  const minor = missingComponents?.filter(c => c.severity === 'minor') || []

  const severityColors = {
    critical: { bg: '#fee2e2', border: '#fca5a5', text: '#991b1b', badge: '#dc2626' },
    major: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', badge: '#d97706' },
    minor: { bg: '#f9fafb', border: '#e5e7eb', text: '#374151', badge: '#6b7280' },
  }

  return (
    <div style={{ marginTop: 24 }}>
      {missingComponents?.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: '#dc2626' }}>Missing from your submission package</div>
            <div style={{ fontSize: 12, color: '#888' }}>
              {critical.length > 0 && <span style={{ color: '#dc2626', marginRight: 6 }}>{critical.length} critical</span>}
              {major.length > 0 && <span style={{ color: '#d97706', marginRight: 6 }}>{major.length} major</span>}
              {minor.length > 0 && <span style={{ color: '#6b7280' }}>{minor.length} minor</span>}
            </div>
          </div>
          {missingComponents.map((c, i) => {
            const col = severityColors[c.severity] || severityColors.minor
            return (
              <div key={i} style={{ background: col.bg, border: `1px solid ${col.border}`, borderRadius: 8, padding: '10px 14px', marginBottom: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span style={{ background: col.badge, color: '#fff', borderRadius: 4, padding: '1px 7px', fontSize: 11, fontWeight: 700, textTransform: 'uppercase' }}>{c.severity}</span>
                  <span style={{ fontWeight: 600, fontSize: 13, color: col.text }}>{c.component}</span>
                </div>
                <div style={{ fontSize: 13, color: col.text, marginBottom: 3 }}>{c.why_it_matters}</div>
                <div style={{ fontSize: 12, color: col.text, opacity: 0.8, fontStyle: 'italic' }}>{c.impact_on_score}</div>
              </div>
            )
          })}
        </div>
      )}
      {packageCritique && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: '#374151', marginBottom: 8 }}>Reviewer's package assessment</div>
          <div style={{ background: '#f3f4f6', borderLeft: '3px solid #9ca3af', borderRadius: 4, padding: '12px 16px', fontSize: 13, color: '#374151', lineHeight: 1.7, fontStyle: 'italic' }}>
            {packageCritique}
          </div>
        </div>
      )}
    </div>
  )
}

const ghostBtn = { padding: '6px 14px', fontSize: 13, border: '0.5px solid #ddd', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#111' }
const mechBtn = active => ({ ...ghostBtn, background: active ? '#f5f5f5' : '#fff', fontWeight: active ? 500 : 400, borderColor: active ? '#bbb' : '#e5e5e5' })
const tabRow = { display: 'flex', borderBottom: '0.5px solid #e5e5e5', marginBottom: '1.5rem' }
const tabBtn = active => ({ padding: '8px 16px', fontSize: 13, border: 'none', background: 'none', cursor: 'pointer', color: active ? '#111' : '#888', fontWeight: active ? 500 : 400, borderBottom: active ? '2px solid #111' : '2px solid transparent', marginBottom: '-0.5px' })
const inputStyle = { border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '7px 10px', fontSize: 13, fontFamily: 'inherit', color: '#111', background: '#fff', width: '100%', boxSizing: 'border-box' }
const secLabel = { fontSize: 11, fontWeight: 500, color: '#888', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }
const limitsBox = { fontSize: 12, color: '#555', background: '#f8f8f8', border: '0.5px solid #e5e5e5', borderRadius: 8, padding: '8px 12px', marginBottom: '1rem', lineHeight: 1.7 }
const pill = { fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#fff', border: '0.5px solid #e5e5e5', color: '#666' }
