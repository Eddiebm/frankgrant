import { useAuth } from '@clerk/clerk-react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

export function useApi() {
  const { getToken } = useAuth()

  async function request(method, path, body) {
    const token = await getToken()
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(e.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  // AI proxy — all Claude calls go through here
  async function callAI(payload, action = 'ai_call') {
    return request('POST', '/ai', { ...payload, _action: action })
  }

  // Projects
  async function listProjects() { return request('GET', '/projects') }
  async function createProject(data) { return request('POST', '/projects', data) }
  async function getProject(id) { return request('GET', `/projects/${id}`) }
  async function updateProject(id, data) { return request('PUT', `/projects/${id}`, data) }
  async function deleteProject(id) { return request('DELETE', `/projects/${id}`) }

  // Usage
  async function getUsage() { return request('GET', '/usage') }

  // FOA Parser
  async function parseFOA(foa_number) { return request('POST', '/foa/parse', { foa_number }) }

  // NIH Reporter
  async function searchGrants(params) { return request('POST', '/search/grants', params) }
  async function analyzeGrant(abstract) { return request('POST', '/search/analyze-grant', { abstract }) }
  async function saveReference(project_id, grant_title, grant_abstract, analysis) {
    return request('POST', '/search/save-reference', { project_id, grant_title, grant_abstract, analysis })
  }

  // Compliance
  async function getCompliance(projectId) { return request('GET', `/projects/${projectId}/compliance`) }

  // Preliminary data
  async function uploadPrelim(projectId, file, label) {
    const token = await getToken()
    const form = new FormData()
    form.append('file', file)
    if (label) form.append('label', label)
    const res = await fetch(`${API_BASE}/projects/${projectId}/prelim`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    })
    if (!res.ok) {
      const e = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error(e.error || `HTTP ${res.status}`)
    }
    return res.json()
  }
  async function listPrelim(projectId) { return request('GET', `/projects/${projectId}/prelim`) }
  async function deletePrelim(projectId, itemId) { return request('DELETE', `/projects/${projectId}/prelim/${itemId}`) }
  async function analyzePrelim(projectId) { return request('POST', `/projects/${projectId}/prelim/analyze`, {}) }
  async function generatePrelimNarrative(projectId) { return request('POST', `/projects/${projectId}/prelim/narrative`, {}) }

  // Citations
  async function getCitations(section_text, section_id) { return request('POST', '/citations', { section_text, section_id }) }

  // Study Section
  async function runStudySection(projectId) { return request('POST', `/projects/${projectId}/study-section`, {}) }

  // PD Review
  async function runPDReview(projectId) { return request('POST', `/projects/${projectId}/pd-review`, {}) }

  // Advisory Council
  async function runAdvisoryCouncil(projectId) { return request('POST', `/projects/${projectId}/advisory-council`, {}) }

  // Polish
  async function polishSection(projectId, sectionId, sectionText, sectionLabel) {
    return request('POST', `/projects/${projectId}/polish`, { section_id: sectionId, section_text: sectionText, section_label: sectionLabel })
  }

  // Commercial Reviewer
  async function runCommercialReview(projectId) { return request('POST', `/projects/${projectId}/commercial-review`, {}) }

  // Commercial Charts
  async function generateCharts(projectId) { return request('POST', `/projects/${projectId}/generate-charts`, {}) }

  // Bibliography
  async function getBibliography(projectId) { return request('GET', `/projects/${projectId}/bibliography`) }
  async function saveBibliography(projectId, bibliography) { return request('POST', `/projects/${projectId}/bibliography`, { bibliography }) }

  // Letters Generator
  async function generateLetter(letter_type, project_id, letter_fields) {
    return request('POST', '/letters/generate', { letter_type, project_id, letter_fields })
  }

  // Aims Optimizer
  async function optimizeAims(projectId) { return request('POST', `/projects/${projectId}/optimize-aims`, {}) }
  async function generateAimsAlternatives(projectId) { return request('POST', `/projects/${projectId}/optimize-aims/alternatives`, {}) }

  // Pipeline Status
  async function patchProjectStatus(projectId, data) { return request('PATCH', `/projects/${projectId}/status`, data) }

  // Resubmission
  async function importReviewerComments(projectId, text) {
    return request('POST', `/projects/${projectId}/resubmission/import-comments`, { reviewer_comments: text })
  }
  async function analyzeResubmission(projectId) {
    return request('POST', `/projects/${projectId}/resubmission/analyze`, {})
  }
  async function generateResubmissionIntro(projectId) {
    return request('POST', `/projects/${projectId}/resubmission/generate-introduction`, {})
  }
  async function reviseForResubmission(projectId, sectionId, sectionText, sectionLabel) {
    return request('POST', `/projects/${projectId}/resubmission/revise-section`, { section_id: sectionId, section_text: sectionText, section_label: sectionLabel })
  }

  return {
    callAI, listProjects, createProject, getProject, updateProject, deleteProject, getUsage,
    parseFOA, searchGrants, analyzeGrant, saveReference, getCompliance, getToken,
    uploadPrelim, listPrelim, deletePrelim, analyzePrelim, generatePrelimNarrative, getCitations,
    runStudySection, runPDReview, runAdvisoryCouncil, polishSection,
    generateLetter, importReviewerComments, analyzeResubmission, generateResubmissionIntro, reviseForResubmission,
    runCommercialReview, generateCharts, getBibliography, saveBibliography,
    optimizeAims, generateAimsAlternatives, patchProjectStatus,
  }
}
