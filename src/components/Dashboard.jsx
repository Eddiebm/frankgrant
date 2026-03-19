import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useAuth } from '@clerk/clerk-react'
import { useApi } from '../hooks/useApi'
import UsageMeter from './UsageMeter'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

const STATUS_CONFIG = {
  draft:            { label: 'Draft',           color: '#6b7280', bg: '#f3f4f6', border: '#d1d5db' },
  in_progress:      { label: 'In Progress',     color: '#2563eb', bg: '#eff6ff', border: '#93c5fd' },
  ready_to_submit:  { label: 'Ready to Submit', color: '#7c3aed', bg: '#f5f3ff', border: '#c4b5fd' },
  submitted:        { label: 'Submitted',       color: '#d97706', bg: '#fffbeb', border: '#fbbf24' },
  under_review:     { label: 'Under Review',    color: '#0891b2', bg: '#ecfeff', border: '#67e8f9' },
  awarded:          { label: 'Awarded',         color: '#16a34a', bg: '#f0fdf4', border: '#86efac' },
  not_funded:       { label: 'Not Funded',      color: '#dc2626', bg: '#fef2f2', border: '#fca5a5' },
  withdrawn:        { label: 'Withdrawn',       color: '#9ca3af', bg: '#f9fafb', border: '#e5e7eb' },
}

const KANBAN_COLUMNS = [
  'draft', 'in_progress', 'ready_to_submit', 'submitted', 'under_review', 'awarded', 'not_funded'
]

const PRIORITY_CONFIG = {
  low:    { label: 'Low',    color: '#9ca3af' },
  medium: { label: 'Medium', color: '#d97706' },
  high:   { label: 'High',   color: '#dc2626' },
}

function deadlineUrgency(dateStr) {
  if (!dateStr) return null
  const now = new Date()
  const dl = new Date(dateStr)
  const diffDays = Math.ceil((dl - now) / (1000 * 60 * 60 * 24))
  return diffDays
}

function DeadlineBadge({ dateStr }) {
  if (!dateStr) return null
  const days = deadlineUrgency(dateStr)
  const overdue = days < 0
  const urgent = days <= 3
  const warning = days <= 14
  const color = overdue || urgent ? '#dc2626' : warning ? '#d97706' : '#2563eb'
  const bg = overdue || urgent ? '#fef2f2' : warning ? '#fffbeb' : '#eff6ff'
  const label = overdue ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d left`
  return (
    <span style={{ fontSize: 11, fontWeight: overdue || urgent ? 700 : 600, color, background: bg, padding: '2px 7px', borderRadius: 10, border: `1px solid ${color}30` }}>
      📅 {label}
    </span>
  )
}

export default function Dashboard({ onOpenProject, onNewGrant, initialView = 'projects' }) {
  const { user } = useUser()
  const { getToken } = useAuth()
  const api = useApi()
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [sharedProjects, setSharedProjects] = useState([])
  const [pendingInvitations, setPendingInvitations] = useState([])

  // NPS widget state
  const [npsVisible, setNpsVisible] = useState(false)
  const [npsScore, setNpsScore] = useState(null)
  const [npsComment, setNpsComment] = useState('')
  const [npsSubmitted, setNpsSubmitted] = useState(false)

  // Pipeline view
  const [pipelineView, setPipelineView] = useState(() => localStorage.getItem('fg_pipeline_view') || 'list')
  const [statusFilter, setStatusFilter] = useState('all')
  const [mechFilter, setMechFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [sortBy, setSortBy] = useState('deadline')
  const [statusModal, setStatusModal] = useState(null) // { projectId, current }
  const [statusForm, setStatusForm] = useState({})
  const [calendarMonth, setCalendarMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() } })
  const [draggingId, setDraggingId] = useState(null)
  const [deadlineBanner, setDeadlineBanner] = useState([])

  // View: 'projects' or 'pipeline'
  const view = initialView

  useEffect(() => {
    api.listProjects()
      .then(data => {
        setProjects(data)
        const soon = data.filter(p => {
          const days = deadlineUrgency(p.next_deadline)
          return days !== null && days >= 0 && days <= 7
        })
        setDeadlineBanner(soon)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    api.getSharedProjects().then(d => setSharedProjects(d.projects || [])).catch(() => {})
    api.getPendingInvitations().then(d => setPendingInvitations(d.invitations || [])).catch(() => {})

    // NPS: show after 7-day gap
    const lastShown = localStorage.getItem('fg_last_nps_shown')
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    if (!lastShown || parseInt(lastShown) < sevenDaysAgo) {
      setTimeout(() => setNpsVisible(true), 3000)
    }
  }, [])

  function changePipelineView(v) {
    setPipelineView(v)
    localStorage.setItem('fg_pipeline_view', v)
  }

  async function newProject() {
    setCreating(true)
    try {
      const proj = await api.createProject({ title: 'Untitled grant', mechanism: 'STTR-I', sections: {}, scores: {} })
      const full = await api.getProject(proj.id)
      setProjects(prev => [{ ...proj, status: 'draft', priority: 'medium', completion_pct: 0 }, ...prev])
      if (onOpenProject) onOpenProject(full)
    } catch (e) { alert('Error creating project: ' + e.message) }
    setCreating(false)
  }

  async function openProject(id) {
    try {
      const proj = await api.getProject(id)
      if (onOpenProject) onOpenProject(proj)
    } catch (e) { alert('Error loading project: ' + e.message) }
  }

  async function deleteProject(id) {
    if (!confirm('Delete this project?')) return
    await api.deleteProject(id)
    setProjects(prev => prev.filter(p => p.id !== id))
  }

  async function handleStatusSave() {
    if (!statusModal) return
    try {
      await api.patchProjectStatus(statusModal.projectId, statusForm)
      setProjects(prev => prev.map(p => p.id === statusModal.projectId ? { ...p, ...statusForm } : p))
      setStatusModal(null)
    } catch (e) { alert('Failed to update: ' + e.message) }
  }

  function openStatusModal(project) {
    setStatusForm({
      status: project.status || 'draft',
      submission_date: project.submission_date || '',
      award_date: project.award_date || '',
      award_amount: project.award_amount || '',
      award_number: project.award_number || '',
      next_deadline: project.next_deadline || '',
      priority: project.priority || 'medium',
      notes: project.notes || '',
    })
    setStatusModal({ projectId: project.id, current: project.status })
  }

  // Drag-and-drop handlers
  function handleDragStart(e, projectId) {
    setDraggingId(projectId)
    e.dataTransfer.effectAllowed = 'move'
  }
  function handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' }
  async function handleDrop(e, newStatus) {
    e.preventDefault()
    if (!draggingId || newStatus === projects.find(p => p.id === draggingId)?.status) { setDraggingId(null); return }
    const proj = projects.find(p => p.id === draggingId)
    if (!proj) { setDraggingId(null); return }
    const updatedForm = {
      status: newStatus,
      submission_date: proj.submission_date || null,
      award_date: proj.award_date || null,
      award_amount: proj.award_amount || null,
      award_number: proj.award_number || null,
      next_deadline: proj.next_deadline || null,
      priority: proj.priority || 'medium',
      notes: proj.notes || null,
    }
    try {
      await api.patchProjectStatus(draggingId, updatedForm)
      setProjects(prev => prev.map(p => p.id === draggingId ? { ...p, status: newStatus } : p))
    } catch (e) { console.error('Drag status update failed:', e) }
    setDraggingId(null)
  }

  // Filtered + sorted projects
  const filteredProjects = projects.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false
    if (mechFilter !== 'all' && p.mechanism !== mechFilter) return false
    if (priorityFilter !== 'all' && (p.priority || 'medium') !== priorityFilter) return false
    return true
  }).sort((a, b) => {
    if (sortBy === 'deadline') {
      if (!a.next_deadline && !b.next_deadline) return 0
      if (!a.next_deadline) return 1
      if (!b.next_deadline) return -1
      return new Date(a.next_deadline) - new Date(b.next_deadline)
    }
    if (sortBy === 'status') return (a.status || '').localeCompare(b.status || '')
    if (sortBy === 'mechanism') return (a.mechanism || '').localeCompare(b.mechanism || '')
    return b.updated_at - a.updated_at
  })

  const allMechs = [...new Set(projects.map(p => p.mechanism).filter(Boolean))]

  const stats = {
    total: projects.length,
    in_progress: projects.filter(p => p.status === 'in_progress').length,
    submitted: projects.filter(p => ['submitted', 'under_review'].includes(p.status)).length,
    awarded_count: projects.filter(p => p.status === 'awarded').length,
    awarded_dollars: projects.filter(p => p.status === 'awarded').reduce((s, p) => s + (p.award_amount || 0), 0),
    not_funded: projects.filter(p => p.status === 'not_funded').length,
  }

  return (
    <>
      {/* ── Pipeline View ──────────────────────────────────────────────────────── */}
      {view === 'pipeline' ? (
        <div style={{ padding: '1rem 1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {[['list', '☰ List'], ['board', '⬜ Board'], ['calendar', '📅 Calendar']].map(([v, label]) => (
                <button key={v} onClick={() => changePipelineView(v)} style={{ ...btnStyle, background: pipelineView === v ? '#1e293b' : '#fff', color: pipelineView === v ? '#fff' : '#111', borderColor: pipelineView === v ? '#1e293b' : '#ccc' }}>{label}</button>
              ))}
            </div>
            <button onClick={onNewGrant} style={{ ...btnStyle, background: '#0e7490', color: '#fff', border: 'none' }}>+ New Grant</button>
          </div>
          {loading ? (
            <p style={{ fontSize: 13, color: '#666' }}>Loading…</p>
          ) : pipelineView === 'board' ? (
            <KanbanView projects={projects} draggingId={draggingId} onDragStart={handleDragStart} onDragOver={handleDragOver} onDrop={handleDrop} onOpen={openProject} onStatus={openStatusModal} />
          ) : pipelineView === 'calendar' ? (
            <CalendarView projects={projects} month={calendarMonth} setMonth={setCalendarMonth} onOpen={openProject} onStatus={openStatusModal} />
          ) : (
            <ListView projects={filteredProjects} allMechs={allMechs} statusFilter={statusFilter} setStatusFilter={setStatusFilter} mechFilter={mechFilter} setMechFilter={setMechFilter} priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter} sortBy={sortBy} setSortBy={setSortBy} onOpen={openProject} onStatus={openStatusModal} onDelete={deleteProject} />
          )}
        </div>

      ) : (
        /* ── My Grants (projects view) ────────────────────────────────────────── */
        <div style={{ padding: '1.5rem' }}>
          <UsageMeter />

          {/* NPS Widget */}
          {npsVisible && !npsSubmitted && (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', marginBottom: 20, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 12 }}>How likely are you to recommend FrankGrant to a colleague?</div>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {[0,1,2,3,4,5,6,7,8,9,10].map(n => {
                  const bg = n <= 6 ? (npsScore === n ? '#dc2626' : '#fee2e2') : n <= 8 ? (npsScore === n ? '#d97706' : '#fef3c7') : (npsScore === n ? '#15803d' : '#dcfce7')
                  const color = n <= 6 ? '#dc2626' : n <= 8 ? '#d97706' : '#15803d'
                  return (
                    <button key={n} onClick={() => setNpsScore(n)} style={{ width: 36, height: 36, borderRadius: 6, border: `2px solid ${npsScore === n ? color : 'transparent'}`, background: bg, color, fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                      {n}
                    </button>
                  )
                })}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9ca3af', marginBottom: 12 }}>
                <span>Not likely</span><span>Extremely likely</span>
              </div>
              {npsScore !== null && (
                <div style={{ marginBottom: 12 }}>
                  <input
                    placeholder="What's the main reason for your score? (optional)"
                    value={npsComment}
                    onChange={e => setNpsComment(e.target.value)}
                    style={{ width: '100%', padding: '8px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }}
                  />
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={async () => {
                    if (npsScore !== null) {
                      const token = await getToken().catch(() => null)
                      if (token) {
                        await fetch(`${API_BASE}/feedback`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                          body: JSON.stringify({ type: 'nps', nps_score: npsScore, message: npsComment, nps_week: new Date().toISOString().slice(0, 10) })
                        }).catch(() => {})
                      }
                    }
                    localStorage.setItem('fg_last_nps_shown', Date.now().toString())
                    setNpsSubmitted(true)
                    setTimeout(() => setNpsVisible(false), 2000)
                  }}
                  disabled={npsScore === null}
                  style={{ padding: '8px 16px', background: npsScore === null ? '#e5e7eb' : '#0e7490', color: npsScore === null ? '#9ca3af' : '#fff', border: 'none', borderRadius: 6, cursor: npsScore === null ? 'not-allowed' : 'pointer', fontSize: 13, fontWeight: 600 }}
                >Submit</button>
                <button
                  onClick={() => { localStorage.setItem('fg_last_nps_shown', Date.now().toString()); setNpsVisible(false) }}
                  style={{ padding: '8px 12px', background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: 13 }}
                >Skip</button>
              </div>
              {npsSubmitted && <div style={{ fontSize: 13, color: '#15803d', marginTop: 8 }}>Thank you — your feedback helps us improve FrankGrant.</div>}
            </div>
          )}

          {/* Deadline Banner */}
          {deadlineBanner.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 16px', background: '#fffbeb', border: '1px solid #fbbf24', borderRadius: 8, fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>⚠️</span>
              <span style={{ fontWeight: 600 }}>You have {deadlineBanner.length} grant deadline(s) approaching this week:</span>
              <span style={{ color: '#b45309' }}>
                {deadlineBanner.map((p, i) => (
                  <span key={p.id}>
                    {i > 0 && ', '}
                    <span style={{ cursor: 'pointer', textDecoration: 'underline' }} onClick={() => openProject(p.id)}>{p.title}</span>
                  </span>
                ))}
              </span>
            </div>
          )}

          {/* Pending Invitations Banner */}
          {pendingInvitations.length > 0 && (
            <div style={{ marginBottom: 12, padding: '10px 16px', background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: 8, fontSize: 13 }}>
              <div style={{ fontWeight: 600, color: '#7c3aed', marginBottom: 6 }}>👥 You have {pendingInvitations.length} pending collaboration invitation{pendingInvitations.length > 1 ? 's' : ''}:</div>
              {pendingInvitations.map(inv => (
                <div key={inv.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                  <span style={{ flex: 1, color: '#4b5563' }}><strong>{inv.project_title || 'Untitled'}</strong> — invited as <strong>{inv.role}</strong></span>
                  <button
                    onClick={async () => {
                      try {
                        await api.acceptInvitation(inv.project_id)
                        setPendingInvitations(prev => prev.filter(i => i.id !== inv.id))
                        const data = await api.getSharedProjects()
                        setSharedProjects(data.projects || [])
                      } catch (e) { alert('Error accepting: ' + e.message) }
                    }}
                    style={{ padding: '4px 12px', background: '#7c3aed', border: 'none', borderRadius: 4, color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 }}
                  >Accept</button>
                </div>
              ))}
            </div>
          )}

          {/* Stats bar */}
          {!loading && projects.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
              {[
                { label: 'Total Grants', value: stats.total, color: '#1e293b' },
                { label: 'In Progress', value: stats.in_progress, color: '#2563eb' },
                { label: 'Submitted', value: stats.submitted, color: '#d97706' },
                { label: 'Awarded', value: `${stats.awarded_count}${stats.awarded_dollars > 0 ? ' · $' + (stats.awarded_dollars / 1000000).toFixed(1) + 'M' : ''}`, color: '#16a34a' },
              ].map(s => (
                <div key={s.label} style={{ padding: '10px 14px', background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, textAlign: 'center' }}>
                  <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          {/* Toolbar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111' }}>
              {projects.length > 0 ? `${projects.length} grant${projects.length !== 1 ? 's' : ''}` : ''}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {onNewGrant && (
                <button onClick={onNewGrant} style={{ ...btnStyle, background: '#0e7490', color: '#fff', border: 'none' }}>✨ New Grant</button>
              )}
              <button onClick={newProject} disabled={creating} style={btnStyle}>{creating ? 'Creating…' : '+ Blank Grant'}</button>
            </div>
          </div>

          {loading ? (
            <p style={{ fontSize: 13, color: '#666' }}>Loading…</p>
          ) : projects.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '4rem 2rem', border: '1px dashed #d1d5db', borderRadius: 12 }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
              <div style={{ fontSize: 18, fontWeight: 600, color: '#111', marginBottom: 8 }}>No grants yet</div>
              <div style={{ fontSize: 14, color: '#6b7280', marginBottom: 20 }}>Start writing your first NIH grant application.</div>
              {onNewGrant && (
                <button onClick={onNewGrant} style={{ ...btnStyle, background: '#0e7490', color: '#fff', border: 'none', padding: '10px 20px', fontSize: 14 }}>✨ Start with Wizard</button>
              )}
              <span style={{ display: 'inline-block', margin: '0 12px', color: '#d1d5db' }}>or</span>
              <button onClick={newProject} disabled={creating} style={{ ...btnStyle, padding: '10px 20px', fontSize: 14 }}>{creating ? 'Creating…' : 'Blank Grant'}</button>
            </div>
          ) : (
            <ListView
              projects={filteredProjects}
              allMechs={allMechs}
              statusFilter={statusFilter} setStatusFilter={setStatusFilter}
              mechFilter={mechFilter} setMechFilter={setMechFilter}
              priorityFilter={priorityFilter} setPriorityFilter={setPriorityFilter}
              sortBy={sortBy} setSortBy={setSortBy}
              onOpen={openProject}
              onStatus={openStatusModal}
              onDelete={deleteProject}
            />
          )}

          {/* Shared With Me */}
          {sharedProjects.length > 0 && (
            <div style={{ marginTop: 32 }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#7c3aed', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                👥 Shared With Me <span style={{ fontSize: 12, fontWeight: 400, color: '#9ca3af' }}>({sharedProjects.length})</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {sharedProjects.map(p => (
                  <div key={p.id} onClick={() => openProject(p.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: 8, cursor: 'pointer' }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 14, color: '#1f2937' }}>{p.title}</div>
                      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{p.mechanism} · {p.status?.replace(/_/g, ' ')}</div>
                    </div>
                    <span style={{ fontSize: 11, color: '#7c3aed', background: '#ede9fe', padding: '3px 10px', borderRadius: 12, fontWeight: 600, textTransform: 'capitalize' }}>{p.my_role}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Status Modal */}
      {statusModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Update Grant Status</div>

            <div style={{ marginBottom: 12 }}>
              <div style={secLabel}>Status</div>
              <select style={inputStyle} value={statusForm.status} onChange={e => setStatusForm(f => ({ ...f, status: e.target.value }))}>
                {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={secLabel}>Priority</div>
              <select style={inputStyle} value={statusForm.priority} onChange={e => setStatusForm(f => ({ ...f, priority: e.target.value }))}>
                {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={secLabel}>Next Deadline</div>
              <input type="date" style={inputStyle} value={statusForm.next_deadline || ''} onChange={e => setStatusForm(f => ({ ...f, next_deadline: e.target.value }))} />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={secLabel}>Submission Date</div>
              <input type="date" style={inputStyle} value={statusForm.submission_date || ''} onChange={e => setStatusForm(f => ({ ...f, submission_date: e.target.value }))} />
            </div>
            {statusForm.status === 'awarded' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
                <div>
                  <div style={secLabel}>Award Amount ($)</div>
                  <input type="number" style={inputStyle} value={statusForm.award_amount || ''} onChange={e => setStatusForm(f => ({ ...f, award_amount: parseFloat(e.target.value) || null }))} placeholder="e.g. 300000" />
                </div>
                <div>
                  <div style={secLabel}>Award Number</div>
                  <input style={inputStyle} value={statusForm.award_number || ''} onChange={e => setStatusForm(f => ({ ...f, award_number: e.target.value }))} placeholder="e.g. R43 CA123456" />
                </div>
              </div>
            )}
            <div style={{ marginBottom: 16 }}>
              <div style={secLabel}>Notes</div>
              <textarea style={{ ...inputStyle, width: '100%', minHeight: 60, resize: 'vertical' }} value={statusForm.notes || ''} onChange={e => setStatusForm(f => ({ ...f, notes: e.target.value }))} placeholder="Any internal notes…" />
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => setStatusModal(null)} style={{ ...btnStyle }}>Cancel</button>
              <button onClick={handleStatusSave} style={{ ...btnStyle, background: '#1e293b', color: '#fff', border: 'none' }}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── List View ────────────────────────────────────────────────────────────────
function ListView({ projects, allMechs, statusFilter, setStatusFilter, mechFilter, setMechFilter, priorityFilter, setPriorityFilter, sortBy, setSortBy, onOpen, onStatus, onDelete }) {
  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select style={{ ...filterSelect }} value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select style={filterSelect} value={mechFilter} onChange={e => setMechFilter(e.target.value)}>
          <option value="all">All Mechanisms</option>
          {allMechs.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select style={filterSelect} value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}>
          <option value="all">All Priorities</option>
          {Object.entries(PRIORITY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label} Priority</option>)}
        </select>
        <select style={filterSelect} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="deadline">Sort: Deadline</option>
          <option value="status">Sort: Status</option>
          <option value="mechanism">Sort: Mechanism</option>
          <option value="updated">Sort: Last Modified</option>
        </select>
        <span style={{ fontSize: 12, color: '#888', marginLeft: 4 }}>{projects.length} grant{projects.length !== 1 ? 's' : ''}</span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {projects.map(p => {
          const sc = STATUS_CONFIG[p.status] || STATUS_CONFIG.draft
          const pc = PRIORITY_CONFIG[p.priority] || PRIORITY_CONFIG.medium
          const completion = p.completion_pct || 0
          return (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', border: `1px solid ${sc.border}`, borderRadius: 10, background: '#fff', transition: 'box-shadow 0.15s' }}>
              <div style={{ flex: 1, cursor: 'pointer', minWidth: 0 }} onClick={() => onOpen(p.id)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{p.title}</span>
                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: '#e5e7eb', color: '#374151', fontWeight: 500 }}>{p.mechanism}</span>
                  <span style={{ fontSize: 11, padding: '1px 7px', borderRadius: 10, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}`, fontWeight: 600 }}>{sc.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, color: pc.color }}>● {pc.label}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <DeadlineBadge dateStr={p.next_deadline} />
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#888' }}>
                    <div style={{ width: 60, height: 4, background: '#e5e7eb', borderRadius: 2, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${completion}%`, background: completion >= 80 ? '#16a34a' : completion >= 40 ? '#d97706' : '#93c5fd', borderRadius: 2 }} />
                    </div>
                    {completion}% written
                  </div>
                  <span style={{ fontSize: 11, color: '#aaa' }}>Updated {new Date(p.updated_at * 1000).toLocaleDateString()}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                <button onClick={() => onOpen(p.id)} style={actionBtn}>Open</button>
                <button onClick={() => onStatus(p)} style={actionBtn}>Status</button>
                <button onClick={() => onDelete(p.id)} style={{ ...actionBtn, color: '#dc2626' }}>Delete</button>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Kanban Board ─────────────────────────────────────────────────────────────
function KanbanView({ projects, draggingId, onDragStart, onDragOver, onDrop, onOpen, onStatus }) {
  return (
    <div style={{ overflowX: 'auto', paddingBottom: 12 }}>
      <div style={{ display: 'flex', gap: 12, minWidth: 'max-content' }}>
        {KANBAN_COLUMNS.map(col => {
          const sc = STATUS_CONFIG[col]
          const colProjects = projects.filter(p => (p.status || 'draft') === col)
          return (
            <div
              key={col}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, col)}
              style={{ width: 220, minHeight: 400, background: '#f8fafc', border: `2px dashed ${sc.border}`, borderRadius: 10, padding: '0 0 12px 0', transition: 'border-color 0.15s', flexShrink: 0 }}
            >
              <div style={{ padding: '10px 12px', borderBottom: `2px solid ${sc.border}`, background: sc.bg, borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: sc.color }}>{sc.label}</span>
                <span style={{ fontSize: 11, color: sc.color, background: `${sc.color}20`, padding: '1px 7px', borderRadius: 10 }}>{colProjects.length}</span>
              </div>
              <div style={{ padding: '8px 8px 0 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {colProjects.map(p => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={e => onDragStart(e, p.id)}
                    style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 10px', cursor: 'grab', opacity: draggingId === p.id ? 0.5 : 1, boxShadow: '0 1px 3px rgba(0,0,0,0.06)', transition: 'opacity 0.15s' }}
                  >
                    <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 5, lineHeight: 1.3 }}>{p.title?.slice(0, 45)}{p.title?.length > 45 ? '…' : ''}</div>
                    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginBottom: 4 }}>
                      <span style={{ fontSize: 10, padding: '1px 5px', background: '#e5e7eb', borderRadius: 8, color: '#555' }}>{p.mechanism}</span>
                      {p.priority === 'high' && <span style={{ fontSize: 10, padding: '1px 5px', background: '#fee2e2', color: '#dc2626', borderRadius: 8 }}>High</span>}
                    </div>
                    {p.next_deadline && <DeadlineBadge dateStr={p.next_deadline} />}
                    {(p.completion_pct || 0) > 0 && (
                      <div style={{ marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
                        <div style={{ flex: 1, height: 3, background: '#e5e7eb', borderRadius: 2 }}>
                          <div style={{ height: '100%', width: `${p.completion_pct}%`, background: '#3b82f6', borderRadius: 2 }} />
                        </div>
                        <span style={{ fontSize: 10, color: '#888' }}>{p.completion_pct}%</span>
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 5, marginTop: 7 }}>
                      <button onClick={() => onOpen(p.id)} style={{ ...actionBtn, fontSize: 10, padding: '2px 7px' }}>Open</button>
                      <button onClick={() => onStatus(p)} style={{ ...actionBtn, fontSize: 10, padding: '2px 7px' }}>Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Calendar View ─────────────────────────────────────────────────────────────
function CalendarView({ projects, month, setMonth, onOpen, onStatus }) {
  const { year, month: mo } = month
  const firstDay = new Date(year, mo, 1).getDay()
  const daysInMonth = new Date(year, mo + 1, 0).getDate()
  const monthName = new Date(year, mo, 1).toLocaleString('default', { month: 'long', year: 'numeric' })

  const deadlineMap = {}
  projects.forEach(p => {
    if (!p.next_deadline) return
    const key = p.next_deadline.slice(0, 10)
    if (!deadlineMap[key]) deadlineMap[key] = []
    deadlineMap[key].push(p)
  })

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const projectsWithNoDeadline = projects.filter(p => !p.next_deadline)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <button onClick={() => setMonth(m => { const d = new Date(m.year, m.month - 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })} style={btnStyle}>← Prev</button>
        <div style={{ fontWeight: 700, fontSize: 16, minWidth: 180, textAlign: 'center' }}>{monthName}</div>
        <button onClick={() => setMonth(m => { const d = new Date(m.year, m.month + 1, 1); return { year: d.getFullYear(), month: d.getMonth() } })} style={btnStyle}>Next →</button>
        <button onClick={() => { const d = new Date(); setMonth({ year: d.getFullYear(), month: d.getMonth() }) }} style={{ ...btnStyle, color: '#666' }}>Today</button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#888', padding: '6px 0' }}>{d}</div>
        ))}
        {cells.map((day, i) => {
          if (!day) return <div key={`empty-${i}`} style={{ minHeight: 70 }} />
          const dateStr = `${year}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
          const dayProjects = deadlineMap[dateStr] || []
          const isToday = dateStr === todayStr
          return (
            <div key={day} style={{ minHeight: 70, border: `1px solid ${isToday ? '#3b82f6' : '#e5e7eb'}`, borderRadius: 6, padding: '4px 5px', background: isToday ? '#eff6ff' : '#fff' }}>
              <div style={{ fontSize: 12, fontWeight: isToday ? 700 : 400, color: isToday ? '#2563eb' : '#374151', marginBottom: 3 }}>{day}</div>
              {dayProjects.map(p => {
                const days = deadlineUrgency(dateStr)
                const color = days !== null && days < 0 ? '#dc2626' : days !== null && days <= 3 ? '#dc2626' : days !== null && days <= 14 ? '#d97706' : '#2563eb'
                return (
                  <div key={p.id} onClick={() => onOpen(p.id)} style={{ fontSize: 10, marginBottom: 2, padding: '2px 5px', background: `${color}15`, color, borderRadius: 4, cursor: 'pointer', fontWeight: 600, lineHeight: 1.3, border: `1px solid ${color}30` }}>
                    {p.title?.slice(0, 18)}{p.title?.length > 18 ? '…' : ''}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>

      {projectsWithNoDeadline.length > 0 && (
        <div style={{ marginTop: 20, padding: '12px 16px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>No deadline set ({projectsWithNoDeadline.length})</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {projectsWithNoDeadline.map(p => (
              <div key={p.id} style={{ fontSize: 12, padding: '4px 10px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{p.title?.slice(0, 30)}{p.title?.length > 30 ? '…' : ''}</span>
                <button onClick={() => onStatus(p)} style={{ fontSize: 10, border: 'none', background: '#eff6ff', color: '#2563eb', padding: '1px 6px', borderRadius: 4, cursor: 'pointer' }}>Set Deadline</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle = { padding: '7px 14px', fontSize: 13, fontWeight: 500, border: '0.5px solid #ccc', borderRadius: 8, cursor: 'pointer', background: '#fff', color: '#111' }
const actionBtn = { padding: '4px 10px', fontSize: 12, border: '0.5px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#374151' }
const filterSelect = { padding: '5px 10px', fontSize: 12, border: '1px solid #e5e7eb', borderRadius: 6, background: '#fff', cursor: 'pointer' }
const secLabel = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 }
const inputStyle = { padding: '7px 10px', fontSize: 13, border: '1px solid #e5e7eb', borderRadius: 7, width: '100%', boxSizing: 'border-box' }
