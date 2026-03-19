import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

const SECTION_LABELS = {
  project_summary: 'Project Summary',
  project_narrative: 'Project Narrative',
  aims: 'Specific Aims',
  sig: 'Significance',
  innov: 'Innovation',
  approach: 'Approach',
  commercial: 'Commercialization Plan',
  data_mgmt: 'Data Management and Sharing Plan',
  facilities: 'Facilities and Resources',
}

const SECTION_ORDER = ['project_summary', 'project_narrative', 'aims', 'sig', 'innov', 'approach', 'commercial', 'data_mgmt', 'facilities']

export default function SharedGrantView({ token }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [activeSection, setActiveSection] = useState(null)

  useEffect(() => {
    fetch(`${API_BASE}/shared/${token}`)
      .then(r => r.json())
      .then(d => {
        if (d.error === 'expired') { setError('expired'); return }
        if (d.error) { setError('invalid'); return }
        setData(d)
        const first = SECTION_ORDER.find(k => d.sections?.[k])
        setActiveSection(first || null)
      })
      .catch(() => setError('invalid'))
      .finally(() => setLoading(false))
  }, [token])

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <div style={{ fontSize: 14, color: '#6b7280' }}>Loading grant…</div>
      </div>
    )
  }

  if (error === 'expired') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#f9fafb', padding: 24 }}>
        <div style={{ fontSize: 40 }}>⏰</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>This shared link has expired.</h2>
        <p style={{ fontSize: 14, color: '#6b7280' }}>Ask the grant owner to create a new share link.</p>
        <a href="https://frankgrant.pages.dev" style={{ padding: '10px 20px', background: '#0e7490', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Create your own grant</a>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, background: '#f9fafb', padding: 24 }}>
        <div style={{ fontSize: 40 }}>🔒</div>
        <h2 style={{ fontSize: 20, fontWeight: 700, color: '#111' }}>This link is invalid or has been revoked.</h2>
        <p style={{ fontSize: 14, color: '#6b7280' }}>The owner may have revoked access or the link is incorrect.</p>
        <a href="https://frankgrant.pages.dev" style={{ padding: '10px 20px', background: '#0e7490', color: '#fff', borderRadius: 8, textDecoration: 'none', fontSize: 14, fontWeight: 600 }}>Create your own grant</a>
      </div>
    )
  }

  const visibleSections = SECTION_ORDER.filter(k => data.sections?.[k])

  return (
    <div style={{ minHeight: '100vh', background: '#f9fafb', display: 'flex', flexDirection: 'column' }}>
      {/* View-only banner */}
      <div style={{ background: '#0e7490', color: '#fff', padding: '10px 20px', fontSize: 13, fontWeight: 500, textAlign: 'center' }}>
        Shared via FrankGrant — View only · <a href="https://frankgrant.pages.dev" style={{ color: '#a5f3fc', textDecoration: 'underline' }}>Create your own grant</a>
      </div>

      {/* Header */}
      <div style={{ background: '#fff', borderBottom: '1px solid #e5e7eb', padding: '20px 32px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto' }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 6 }}>{data.title}</h1>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {data.mechanism && <span style={{ fontSize: 12, background: '#e0f2fe', color: '#0c4a6e', padding: '2px 8px', borderRadius: 10, fontWeight: 600 }}>{data.mechanism}</span>}
            {data.pi_name && <span style={{ fontSize: 13, color: '#6b7280' }}>{data.pi_name}</span>}
            {data.institution && <span style={{ fontSize: 13, color: '#6b7280' }}>· {data.institution}</span>}
            {data.expires_at && <span style={{ fontSize: 11, color: '#9ca3af', marginLeft: 'auto' }}>Link expires {new Date(data.expires_at * 1000).toLocaleDateString()}</span>}
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, display: 'flex', maxWidth: 900, margin: '0 auto', width: '100%', padding: '24px 16px', gap: 24 }}>
        {/* Sidebar */}
        <div style={{ width: 200, flexShrink: 0 }}>
          <div style={{ position: 'sticky', top: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Sections</div>
            {visibleSections.map(k => (
              <button
                key={k}
                onClick={() => setActiveSection(k)}
                style={{ display: 'block', width: '100%', textAlign: 'left', padding: '6px 10px', background: activeSection === k ? '#e0f2fe' : 'none', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: activeSection === k ? '#0c4a6e' : '#374151', fontWeight: activeSection === k ? 600 : 400, marginBottom: 2 }}
              >
                {SECTION_LABELS[k] || k}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          {activeSection && data.sections?.[activeSection] ? (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 28 }}>
              <h2 style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #e5e7eb' }}>
                {SECTION_LABELS[activeSection] || activeSection}
              </h2>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: 14, lineHeight: 1.7, color: '#1f2937', whiteSpace: 'pre-wrap' }}>
                {data.sections[activeSection]}
              </div>
            </div>
          ) : (
            <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: 28, color: '#6b7280', fontSize: 14 }}>
              No sections available.
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div style={{ borderTop: '1px solid #e5e7eb', background: '#fff', padding: '14px 32px', fontSize: 11, color: '#9ca3af', fontStyle: 'italic', textAlign: 'center' }}>
        Prepared by FrankGrant Grant Writing Services. Scientific content owned by {data.pi_name || 'the applicant'}{data.institution ? ', ' + data.institution : ''}. View only — no login required.
      </div>
    </div>
  )
}
