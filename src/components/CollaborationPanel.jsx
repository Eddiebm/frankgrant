import { useState, useEffect, useCallback } from 'react'
import { useApi } from '../hooks/useApi'
import { useUser } from '@clerk/clerk-react'

const ROLES = ['reviewer', 'co_writer', 'admin']
const ROLE_LABELS = { reviewer: 'Reviewer', co_writer: 'Co-Writer', admin: 'Admin' }
const ROLE_COLORS = { reviewer: '#6b7280', co_writer: '#3b82f6', admin: '#8b5cf6', owner: '#f59e0b' }

export default function CollaborationPanel({ projectId, projectOwnerId, onClose }) {
  const api = useApi()
  const { user } = useUser()
  const [tab, setTab] = useState('team')
  const [collaborators, setCollaborators] = useState([])
  const [comments, setComments] = useState({})
  const [versions, setVersions] = useState([])
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('reviewer')
  const [newComment, setNewComment] = useState('')
  const [commentSection, setCommentSection] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const isOwner = user?.id === projectOwnerId

  const loadCollaborators = useCallback(async () => {
    try {
      const data = await api.getCollaborators(projectId)
      setCollaborators(data.collaborators || [])
    } catch (e) { setError(e.message) }
  }, [projectId])

  const loadComments = useCallback(async () => {
    try {
      const data = await api.getComments(projectId)
      setComments(data.grouped || {})
    } catch (e) { setError(e.message) }
  }, [projectId])

  const loadVersions = useCallback(async () => {
    try {
      const data = await api.getVersions(projectId)
      setVersions(data.versions || [])
    } catch (e) { setError(e.message) }
  }, [projectId])

  useEffect(() => {
    if (tab === 'team') loadCollaborators()
    else if (tab === 'comments') loadComments()
    else if (tab === 'history') loadVersions()
  }, [tab])

  async function handleInvite(e) {
    e.preventDefault()
    if (!inviteEmail.trim()) return
    setLoading(true); setError(null)
    try {
      await api.inviteCollaborator(projectId, inviteEmail.trim(), inviteRole)
      setInviteEmail('')
      await loadCollaborators()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleRemove(collabId) {
    if (!confirm('Remove this collaborator?')) return
    try {
      await api.deleteCollaborator(projectId, collabId)
      await loadCollaborators()
    } catch (e) { setError(e.message) }
  }

  async function handleRoleChange(collabId, role) {
    try {
      await api.patchCollaborator(projectId, collabId, role)
      await loadCollaborators()
    } catch (e) { setError(e.message) }
  }

  async function handlePostComment(e) {
    e.preventDefault()
    if (!newComment.trim()) return
    setLoading(true); setError(null)
    try {
      await api.postComment(projectId, newComment.trim(), commentSection)
      setNewComment('')
      await loadComments()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleToggleResolve(commentId, resolved) {
    try {
      await api.patchComment(projectId, commentId, !resolved)
      await loadComments()
    } catch (e) { setError(e.message) }
  }

  async function handleDeleteComment(commentId) {
    try {
      await api.deleteComment(projectId, commentId)
      await loadComments()
    } catch (e) { setError(e.message) }
  }

  async function handleSnapshot() {
    const summary = prompt('Version note (optional):')
    if (summary === null) return
    setLoading(true)
    try {
      await api.createSnapshot(projectId, summary || 'Manual snapshot')
      await loadVersions()
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  async function handleRestore(versionNumber) {
    if (!confirm(`Restore version ${versionNumber}? Current state will be saved as a backup.`)) return
    setLoading(true)
    try {
      await api.restoreVersion(projectId, versionNumber)
      alert('Restored. Reload the editor to see changes.')
    } catch (e) { setError(e.message) }
    finally { setLoading(false) }
  }

  const allComments = Object.entries(comments).flatMap(([section, list]) =>
    list.map(c => ({ ...c, section_display: section === '__general__' ? 'General' : section }))
  )
  const unresolvedCount = allComments.filter(c => !c.resolved).length

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, width: 380, height: '100vh',
      background: '#1a1a2e', borderLeft: '1px solid #2d2d4e',
      display: 'flex', flexDirection: 'column', zIndex: 900,
      fontFamily: 'system-ui, sans-serif', color: '#e2e8f0',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #2d2d4e' }}>
        <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Collaboration</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', borderBottom: '1px solid #2d2d4e' }}>
        {[
          { id: 'team', label: 'Team', count: collaborators.length },
          { id: 'comments', label: 'Comments', count: unresolvedCount || null },
          { id: 'history', label: 'History', count: versions.length || null },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            flex: 1, padding: '10px 4px', background: 'none', border: 'none',
            borderBottom: tab === t.id ? '2px solid #6366f1' : '2px solid transparent',
            color: tab === t.id ? '#6366f1' : '#94a3b8', cursor: 'pointer', fontSize: 13, fontWeight: 500,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          }}>
            {t.label}
            {t.count != null && (
              <span style={{ background: tab === t.id ? '#6366f1' : '#374151', color: '#fff', borderRadius: 10, padding: '1px 6px', fontSize: 11 }}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ margin: '12px 16px', padding: '8px 12px', background: '#7f1d1d', borderRadius: 6, fontSize: 13, color: '#fca5a5' }}>
          {error} <button onClick={() => setError(null)} style={{ float: 'right', background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer' }}>×</button>
        </div>
      )}

      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {/* TEAM TAB */}
        {tab === 'team' && (
          <div>
            {isOwner && (
              <form onSubmit={handleInvite} style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invite Collaborator</div>
                <input
                  type="email" placeholder="Email address" value={inviteEmail}
                  onChange={e => setInviteEmail(e.target.value)}
                  style={{ width: '100%', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, boxSizing: 'border-box', marginBottom: 8 }}
                  required
                />
                <div style={{ display: 'flex', gap: 8 }}>
                  <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                    style={{ flex: 1, padding: '8px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13 }}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                  <button type="submit" disabled={loading} style={{
                    padding: '8px 16px', background: '#6366f1', border: 'none', borderRadius: 6,
                    color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, opacity: loading ? 0.6 : 1,
                  }}>Invite</button>
                </div>
              </form>
            )}

            <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Members</div>
            {collaborators.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No collaborators yet</div>
            )}
            {collaborators.map(c => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #1e293b' }}>
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                  {c.email[0].toUpperCase()}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.email}</div>
                  <div style={{ fontSize: 11, color: c.status === 'accepted' ? '#22c55e' : '#f59e0b', marginTop: 1 }}>{c.status}</div>
                </div>
                {isOwner ? (
                  <select value={c.role} onChange={e => handleRoleChange(c.id, e.target.value)}
                    style={{ padding: '4px 6px', background: '#0f172a', border: '1px solid #334155', borderRadius: 4, color: ROLE_COLORS[c.role] || '#94a3b8', fontSize: 12 }}>
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                ) : (
                  <span style={{ fontSize: 12, color: ROLE_COLORS[c.role] || '#94a3b8', padding: '3px 8px', background: '#1e293b', borderRadius: 4 }}>{ROLE_LABELS[c.role]}</span>
                )}
                {isOwner && (
                  <button onClick={() => handleRemove(c.id)} title="Remove" style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* COMMENTS TAB */}
        {tab === 'comments' && (
          <div>
            <form onSubmit={handlePostComment} style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>New Comment</div>
              <select value={commentSection || ''} onChange={e => setCommentSection(e.target.value || null)}
                style={{ width: '100%', padding: '7px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, marginBottom: 8, boxSizing: 'border-box' }}>
                <option value="">General</option>
                {Object.keys(comments).filter(k => k !== '__general__').map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <textarea value={newComment} onChange={e => setNewComment(e.target.value)} placeholder="Write a comment..."
                rows={3}
                style={{ width: '100%', padding: '8px 10px', background: '#0f172a', border: '1px solid #334155', borderRadius: 6, color: '#e2e8f0', fontSize: 13, resize: 'vertical', boxSizing: 'border-box', marginBottom: 8 }}
              />
              <button type="submit" disabled={loading || !newComment.trim()} style={{
                width: '100%', padding: '8px', background: '#6366f1', border: 'none', borderRadius: 6,
                color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 500, opacity: loading ? 0.6 : 1,
              }}>Post Comment</button>
            </form>

            {allComments.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No comments yet</div>
            )}
            {allComments.map(c => (
              <div key={c.id} style={{ marginBottom: 12, padding: 12, background: c.resolved ? '#0f1f0f' : '#0f172a', border: `1px solid ${c.resolved ? '#166534' : '#1e293b'}`, borderRadius: 8, opacity: c.resolved ? 0.7 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 12, color: '#6366f1', fontWeight: 500 }}>{c.user_email?.split('@')[0]}</span>
                    {c.section_display !== 'General' && (
                      <span style={{ fontSize: 11, color: '#94a3b8', background: '#1e293b', padding: '1px 6px', borderRadius: 4 }}>{c.section_display}</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button onClick={() => handleToggleResolve(c.id, c.resolved)} title={c.resolved ? 'Reopen' : 'Resolve'}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.resolved ? '#22c55e' : '#94a3b8', fontSize: 14 }}>
                      {c.resolved ? '✓' : '○'}
                    </button>
                    <button onClick={() => handleDeleteComment(c.id)} title="Delete"
                      style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 14 }}>×</button>
                  </div>
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{c.content}</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 6 }}>
                  {new Date(c.created_at * 1000).toLocaleDateString()} {new Date(c.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div style={{ fontSize: 12, color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Version History</div>
              <button onClick={handleSnapshot} disabled={loading} style={{
                padding: '6px 12px', background: '#1e293b', border: '1px solid #334155', borderRadius: 6,
                color: '#94a3b8', cursor: 'pointer', fontSize: 12,
              }}>+ Save snapshot</button>
            </div>

            {versions.length === 0 && (
              <div style={{ color: '#64748b', fontSize: 13, textAlign: 'center', padding: '20px 0' }}>No versions saved yet</div>
            )}
            {versions.map((v, i) => (
              <div key={v.id} style={{ marginBottom: 10, padding: 12, background: '#0f172a', border: '1px solid #1e293b', borderRadius: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#6366f1' }}>v{v.version_number}</span>
                    {i === 0 && <span style={{ fontSize: 11, color: '#22c55e', background: '#052e16', padding: '1px 6px', borderRadius: 4 }}>latest</span>}
                  </div>
                  {isOwner && i !== 0 && (
                    <button onClick={() => handleRestore(v.version_number)} disabled={loading} style={{
                      padding: '4px 10px', background: '#1e293b', border: '1px solid #334155', borderRadius: 4,
                      color: '#94a3b8', cursor: 'pointer', fontSize: 12,
                    }}>Restore</button>
                  )}
                </div>
                <div style={{ fontSize: 13, color: '#cbd5e1' }}>{v.change_summary || 'No description'}</div>
                <div style={{ fontSize: 11, color: '#475569', marginTop: 4 }}>
                  {new Date(v.created_at * 1000).toLocaleDateString()} {new Date(v.created_at * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
