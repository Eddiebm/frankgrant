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

  // Polish
  async function polishSection(projectId, sectionId, sectionText, sectionLabel) {
    return request('POST', `/projects/${projectId}/polish`, { section_id: sectionId, section_text: sectionText, section_label: sectionLabel })
  }

  return {
    callAI, listProjects, createProject, getProject, updateProject, deleteProject, getUsage,
    parseFOA, searchGrants, analyzeGrant, saveReference, getCompliance, getToken,
    uploadPrelim, listPrelim, deletePrelim, analyzePrelim, generatePrelimNarrative, getCitations,
    runStudySection, polishSection,
  }
}
