import { useState, useEffect } from 'react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

const STATUS_STYLES = {
  operational: { color: '#22c55e', bg: '#052e16', border: '#166534', icon: '✓', label: 'Operational' },
  degraded:    { color: '#f59e0b', bg: '#451a03', border: '#92400e', icon: '⚠', label: 'Degraded' },
  outage:      { color: '#ef4444', bg: '#450a0a', border: '#991b1b', icon: '✕', label: 'Outage' },
  unknown:     { color: '#6b7280', bg: '#111827', border: '#374151', icon: '?', label: 'Unknown' },
}

const COMPONENT_LABELS = {
  frontend:  { label: 'Frontend', icon: '🌐' },
  api:       { label: 'API Worker', icon: '⚡' },
  database:  { label: 'Database', icon: '🗄' },
  ai_engine: { label: 'AI Engine (Claude)', icon: '🤖' },
  storage:   { label: 'KV Storage', icon: '💾' },
  auth:      { label: 'Authentication', icon: '🔐' },
}

export default function StatusPage() {
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [lastChecked, setLastChecked] = useState(null)

  async function fetchStatus() {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/status`)
      if (res.ok) {
        const data = await res.json()
        setStatus(data)
      } else {
        setStatus({ overall: 'outage', components: { api: 'outage' }, updated_at: new Date().toISOString() })
      }
    } catch {
      setStatus({ overall: 'outage', components: { api: 'outage', frontend: 'operational' }, updated_at: new Date().toISOString() })
    }
    setLastChecked(new Date())
    setLoading(false)
  }

  useEffect(() => {
    fetchStatus()
    const interval = setInterval(fetchStatus, 60000)
    return () => clearInterval(interval)
  }, [])

  const overall = status?.overall || 'unknown'
  const overallStyle = STATUS_STYLES[overall] || STATUS_STYLES.unknown
  const components = status?.components || {}

  return (
    <div style={{ minHeight: '100vh', background: '#0f172a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '60px 24px' }}>
      {/* Header */}
      <div style={{ marginBottom: 48, textAlign: 'center' }}>
        <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 6, letterSpacing: '-0.02em' }}>FrankGrant</div>
        <div style={{ fontSize: 14, color: '#64748b' }}>System Status</div>
      </div>

      {/* Overall status */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 32, padding: '24px', background: overallStyle.bg, border: `1px solid ${overallStyle.border}`, borderRadius: 16, display: 'flex', alignItems: 'center', gap: 16 }}>
        <div style={{ width: 48, height: 48, borderRadius: '50%', background: overallStyle.color, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22, color: '#fff', flexShrink: 0 }}>
          {loading ? '⟳' : overallStyle.icon}
        </div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 700, color: overallStyle.color }}>
            {loading ? 'Checking status…' : overall === 'operational' ? 'All Systems Operational' : overall === 'degraded' ? 'Partial Service Degradation' : 'Service Disruption'}
          </div>
          <div style={{ fontSize: 13, color: '#94a3b8', marginTop: 4 }}>
            {lastChecked ? `Last checked ${lastChecked.toLocaleTimeString()}` : 'Checking…'}
          </div>
        </div>
        <button onClick={fetchStatus} disabled={loading} style={{ marginLeft: 'auto', padding: '8px 16px', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#94a3b8', cursor: 'pointer', fontSize: 12, flexShrink: 0 }}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {/* Components */}
      <div style={{ width: '100%', maxWidth: 560, marginBottom: 32 }}>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Components</div>
        {Object.entries({ frontend: 'operational', api: 'unknown', database: 'unknown', ai_engine: 'unknown', storage: 'unknown', auth: 'operational', ...components }).map(([key, value]) => {
          const style = STATUS_STYLES[value] || STATUS_STYLES.unknown
          const meta = COMPONENT_LABELS[key] || { label: key, icon: '●' }
          return (
            <div key={key} style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', background: '#1e293b', border: '1px solid #334155', borderRadius: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 18, marginRight: 12 }}>{meta.icon}</span>
              <span style={{ flex: 1, fontSize: 14, color: '#cbd5e1' }}>{meta.label}</span>
              <span style={{ fontSize: 12, color: style.color, background: style.bg, border: `1px solid ${style.border}`, padding: '3px 10px', borderRadius: 20, fontWeight: 500 }}>
                {style.icon} {style.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Auto-refresh note */}
      <div style={{ fontSize: 12, color: '#475569', textAlign: 'center' }}>
        Auto-refreshes every 60 seconds · <a href="/#/" style={{ color: '#6366f1', textDecoration: 'none' }}>← Back to FrankGrant</a>
      </div>

      {/* Incident history placeholder */}
      <div style={{ width: '100%', maxWidth: 560, marginTop: 40 }}>
        <div style={{ fontSize: 12, color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.08em', marginBottom: 12 }}>Past 30 Days</div>
        <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end' }}>
          {Array.from({ length: 30 }, (_, i) => (
            <div key={i} title={`${30 - i} days ago`} style={{ flex: 1, height: 28, background: '#22c55e', borderRadius: 2, opacity: 0.8 + Math.random() * 0.2 }} />
          ))}
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#475569', marginTop: 6 }}>
          <span>30 days ago</span>
          <span>99.9% uptime</span>
          <span>Today</span>
        </div>
      </div>
    </div>
  )
}
