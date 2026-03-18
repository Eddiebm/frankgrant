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

  return { callAI, listProjects, createProject, getProject, updateProject, deleteProject, getUsage }
}
