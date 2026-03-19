import { useAuth } from '@clerk/clerk-react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

// Custom error class for AI unavailability — used by UI for retry countdown
export class AIUnavailableError extends Error {
  constructor(retryAfter = 60) {
    super('ai_unavailable')
    this.name = 'AIUnavailableError'
    this.retryAfter = retryAfter
  }
}

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
      // Handle AI unavailability specially so UI can show retry countdown
      if (res.status === 503 && e.error === 'ai_unavailable') {
        throw new AIUnavailableError(e.retry_after || 60)
      }
      throw new Error(e.error || `HTTP ${res.status}`)
    }
    return res.json()
  }

  // AI proxy — all Claude calls go through here
  async function callAI(payload, action = 'ai_call') {
    return request('POST', '/ai', { ...payload, _action: action })
  }

  // Status
  async function getAnthropicStatus() { return fetch(`${API_BASE}/status/anthropic`).then(r => r.json()).catch(() => ({ indicator: 'unknown' })) }
  async function getAppStatus() { return fetch(`${API_BASE}/status`).then(r => r.json()).catch(() => ({ overall: 'unknown', components: {} })) }

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

  // Collaboration
  async function inviteCollaborator(projectId, email, role) { return request('POST', `/projects/${projectId}/collaborators`, { email, role }) }
  async function getCollaborators(projectId) { return request('GET', `/projects/${projectId}/collaborators`) }
  async function deleteCollaborator(projectId, collabId) { return request('DELETE', `/projects/${projectId}/collaborators/${collabId}`) }
  async function patchCollaborator(projectId, collabId, role) { return request('PATCH', `/projects/${projectId}/collaborators/${collabId}`, { role }) }
  async function acceptInvitation(projectId) { return request('POST', `/projects/${projectId}/collaborators/accept`, {}) }
  async function getSharedProjects() { return request('GET', '/projects/shared') }
  async function getPendingInvitations() { return request('GET', '/projects/pending-invitations') }
  async function postComment(projectId, content, sectionName) { return request('POST', `/projects/${projectId}/comments`, { content, section_name: sectionName || null }) }
  async function getComments(projectId) { return request('GET', `/projects/${projectId}/comments`) }
  async function patchComment(projectId, commentId, resolved) { return request('PATCH', `/projects/${projectId}/comments/${commentId}`, { resolved }) }
  async function deleteComment(projectId, commentId) { return request('DELETE', `/projects/${projectId}/comments/${commentId}`) }
  async function assignSection(projectId, sectionName, email) { return request('POST', `/projects/${projectId}/sections/${encodeURIComponent(sectionName)}/assign`, { email }) }
  async function createSnapshot(projectId, summary) { return request('POST', `/projects/${projectId}/versions`, { change_summary: summary }) }
  async function getVersions(projectId) { return request('GET', `/projects/${projectId}/versions`) }
  async function getVersion(projectId, versionNumber) { return request('GET', `/projects/${projectId}/versions/${versionNumber}`) }
  async function restoreVersion(projectId, versionNumber) { return request('POST', `/projects/${projectId}/versions/${versionNumber}/restore`, { confirm: 'RESTORE' }) }

  // Submission Package
  async function getSubmissionPackage(projectId) { return request('GET', `/projects/${projectId}/submission-package`) }
  async function activateSubmissionPackage(projectId, adminOverride = false) { return request('POST', `/projects/${projectId}/submission-package`, { admin_override: adminOverride }) }

  // Post-Review Rewrite
  async function rewriteGrant(projectId, source, sourceResults) { return request('POST', `/projects/${projectId}/rewrite`, { source, source_results: sourceResults }) }

  // Reference Verification
  async function verifyReferences(projectId, sectionName, content) { return request('POST', `/projects/${projectId}/verify-references`, { section_name: sectionName, content }) }

  return {
    callAI, listProjects, createProject, getProject, updateProject, deleteProject, getUsage,
    parseFOA, searchGrants, analyzeGrant, saveReference, getCompliance, getToken,
    uploadPrelim, listPrelim, deletePrelim, analyzePrelim, generatePrelimNarrative, getCitations,
    runStudySection, runPDReview, runAdvisoryCouncil, polishSection,
    generateLetter, importReviewerComments, analyzeResubmission, generateResubmissionIntro, reviseForResubmission,
    runCommercialReview, generateCharts, getBibliography, saveBibliography,
    optimizeAims, generateAimsAlternatives, patchProjectStatus,
    inviteCollaborator, getCollaborators, deleteCollaborator, patchCollaborator, acceptInvitation,
    getSharedProjects, getPendingInvitations, postComment, getComments, patchComment, deleteComment,
    assignSection, createSnapshot, getVersions, getVersion, restoreVersion,
    getAnthropicStatus, getAppStatus,
    getSubmissionPackage, activateSubmissionPackage, rewriteGrant, verifyReferences,
  }
}
