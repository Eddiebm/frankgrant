import { useState, useEffect } from 'react'
import { useUser, UserButton } from '@clerk/clerk-react'
import { useApi } from '../hooks/useApi'
import GrantEditor from './GrantEditor'
import Scorer from './Scorer'

export default function Dashboard() {
  const { user } = useUser()
  const api = useApi()
  const [projects, setProjects] = useState([])
  const [activeProject, setActiveProject] = useState(null)
  const [activeView, setActiveView] = useState('projects') // 'projects', 'editor', 'scorer'
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    api.listProjects()
      .then(setProjects)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  async function newProject() {
    setCreating(true)
    try {
      const proj = await api.createProject({
        title: 'Untitled grant',
        mechanism: 'STTR-I',
        sections: {},
        scores: {},
      })
      // Load full project
      const full = await api.getProject(proj.id)
      setProjects(prev => [proj, ...prev])
      setActiveProject(full)
    } catch (e) {
      alert('Error creating project: ' + e.message)
    }
    setCreating(false)
  }

  async function openProject(id) {
    try {
      const proj = await api.getProject(id)
      setActiveProject(proj)
      setActiveView('editor')
    } catch (e) {
      alert('Error loading project: ' + e.message)
    }
  }

  async function saveProject(data) {
    try {
      await api.updateProject(activeProject.id, data)
      setProjects(prev => prev.map(p =>
        p.id === activeProject.id ? { ...p, title: data.title, mechanism: data.mechanism } : p
      ))
      setActiveProject(prev => ({ ...prev, ...data }))
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  async function deleteProject(id) {
    if (!confirm('Delete this project?')) return
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
    if (activeProject?.id === id) setActiveProject(null)
  }

  if (activeView === 'editor' && activeProject) {
    return (
      <GrantEditor
        project={activeProject}
        onSave={saveProject}
        onBack={() => { setActiveProject(null); setActiveView('projects') }}
      />
    )
  }

  if (activeView === 'scorer') {
    return <Scorer onBack={() => setActiveView('projects')} />
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 4 }}>FrankGrant</h1>
          <p style={{ fontSize: 13, color: '#666' }}>NIH grant studio · COARE Holdings</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#666' }}>{user?.emailAddresses?.[0]?.emailAddress}</span>
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h2 style={{ fontSize: 15, fontWeight: 500 }}>Your grants</h2>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setActiveView('scorer')} style={btnStyle}>
            📊 Score Document
          </button>
          <button onClick={newProject} disabled={creating} style={btnStyle}>
            {creating ? 'Creating...' : '+ New grant'}
          </button>
        </div>
      </div>

      {loading ? (
        <p style={{ fontSize: 13, color: '#666' }}>Loading...</p>
      ) : projects.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', border: '0.5px dashed #ccc', borderRadius: 8 }}>
          <p style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>No grants yet.</p>
          <button onClick={newProject} style={btnStyle}>Create your first grant</button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {projects.map(p => (
            <div key={p.id} style={cardStyle}>
              <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => openProject(p.id)}>
                <div style={{ fontSize: 14, fontWeight: 500, marginBottom: 3 }}>{p.title}</div>
                <div style={{ fontSize: 12, color: '#888' }}>
                  {p.mechanism} · Updated {new Date(p.updated_at * 1000).toLocaleDateString()}
                </div>
              </div>
              <button onClick={() => deleteProject(p.id)} style={deleteBtnStyle}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const btnStyle = {
  padding: '7px 14px', fontSize: 13, fontWeight: 500,
  border: '0.5px solid #ccc', borderRadius: 8,
  cursor: 'pointer', background: '#fff', color: '#111',
}
const cardStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 16px', border: '0.5px solid #e5e5e5',
  borderRadius: 8, background: '#fff',
}
const deleteBtnStyle = {
  padding: '4px 10px', fontSize: 12,
  border: '0.5px solid #e5e5e5', borderRadius: 6,
  cursor: 'pointer', background: '#fff', color: '#888',
}
