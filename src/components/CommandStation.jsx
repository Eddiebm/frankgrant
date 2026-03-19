import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi'

export default function CommandStation({ onBack }) {
  const api = useApi()
  const [activeTab, setActiveTab] = useState('overview')
  const [data, setData] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadAllData()
  }, [])

  async function loadAllData() {
    setLoading(true)
    try {
      const [health, users, revenue, aiCosts, grants, product, security, feedback] = await Promise.all([
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/health`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/users`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/revenue`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/ai-costs`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/grants`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/product`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/security`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json()),
        fetch(`${import.meta.env.VITE_WORKER_URL}/command/feedback`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        }).then(r => r.json())
      ])

      setData({ health, users, revenue, aiCosts, grants, product, security, feedback })
    } catch (e) {
      alert('Failed to load command station data: ' + e.message)
    }
    setLoading(false)
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'health', label: 'Platform Health' },
    { id: 'users', label: 'Users' },
    { id: 'revenue', label: 'Revenue' },
    { id: 'ai-costs', label: 'AI Costs' },
    { id: 'grants', label: 'Grant Intelligence' },
    { id: 'product', label: 'Product Health' },
    { id: 'security', label: 'Security' },
    { id: 'feedback', label: 'Feedback' },
    { id: 'clients', label: 'Clients' },
    { id: 'nps', label: 'NPS' },
  ]

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '1.5rem' }}>
        <button onClick={onBack} style={backBtn}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Command Station</h1>
        <button onClick={loadAllData} style={{ ...backBtn, marginLeft: 'auto' }}>
          🔄 Refresh
        </button>
      </div>

      {/* Tab navigation */}
      <div style={{
        display: 'flex',
        gap: 4,
        marginBottom: '2rem',
        borderBottom: '0.5px solid #e5e5e5',
        overflowX: 'auto'
      }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              padding: '10px 16px',
              fontSize: 13,
              fontWeight: 500,
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid #111' : '2px solid transparent',
              background: 'transparent',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              color: activeTab === tab.id ? '#111' : '#666'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>Loading...</div>
      ) : (
        <>
          {activeTab === 'overview' && <OverviewPanel data={data} />}
          {activeTab === 'health' && <HealthPanel data={data.health} />}
          {activeTab === 'users' && <UsersPanel data={data.users} api={api} onRefresh={loadAllData} />}
          {activeTab === 'revenue' && <RevenuePanel data={data.revenue} />}
          {activeTab === 'ai-costs' && <AICostsPanel data={data.aiCosts} />}
          {activeTab === 'grants' && <GrantsPanel data={data.grants} />}
          {activeTab === 'product' && <ProductPanel data={data.product} />}
          {activeTab === 'security' && <SecurityPanel data={data.security} />}
          {activeTab === 'feedback' && <FeedbackPanel data={data.feedback} api={api} onRefresh={loadAllData} />}
          {activeTab === 'clients' && <ClientsPanel api={api} />}
          {activeTab === 'nps' && <NPSPanel api={api} />}
        </>
      )}
    </div>
  )
}

// ── OVERVIEW PANEL ──────────────────────────────────────────────────────────

function OverviewPanel({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <StatCard label="Error Rate (24h)" value={`${data.health?.error_rate || 0}%`} />
      <StatCard label="Total Users" value={data.users?.stats?.total || 0} />
      <StatCard label="AI Spend (Month)" value={`$${(data.aiCosts?.month_spend || 0).toFixed(2)}`} />
      <StatCard label="Total Grants" value={data.grants?.total_projects || 0} />
      <StatCard label="Open Bugs" value={data.feedback?.stats?.bugs || 0} />
    </div>
  )
}

// ── HEALTH PANEL ────────────────────────────────────────────────────────────

function HealthPanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label="Error Rate (24h)" value={`${data.error_rate}%`} />
        <StatCard label="Avg Latency" value={`${data.avg_latency_ms}ms`} />
        <StatCard label="Claude Error Rate" value={`${data.claude_error_rate}%`} />
        <StatCard label="Rate Limit Hits" value={data.rate_limit_hits} />
      </div>

      <Section title="D1 Row Counts">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Table</th>
              <th style={thStyle}>Rows</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.row_counts || {}).map(([table, count]) => (
              <tr key={table}>
                <td style={tdStyle}>{table}</td>
                <td style={tdStyle}>{count.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Recent Errors (Last 20)">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Endpoint</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Message</th>
              <th style={thStyle}>Time</th>
            </tr>
          </thead>
          <tbody>
            {(data.recent_errors || []).slice(0, 20).map(err => (
              <tr key={err.id}>
                <td style={tdStyle}>{err.endpoint}</td>
                <td style={{ ...tdStyle, color: err.status_code >= 500 ? '#dc2626' : '#666' }}>
                  {err.status_code}
                </td>
                <td style={tdStyle}>{err.error_message || '—'}</td>
                <td style={tdStyle}>{new Date(err.created_at * 1000).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.quality_metrics && (
        <Section title="🔍 Quality Review Metrics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <StatCard label="Certified This Month" value={data.quality_metrics.certified_this_month} />
            <StatCard label="Delivery Ready" value={data.quality_metrics.delivery_ready_count} />
            {data.quality_metrics.avg_pass1_accuracy != null && <StatCard label="Avg Pass 1 Accuracy" value={`${data.quality_metrics.avg_pass1_accuracy}%`} />}
            {data.quality_metrics.avg_pass2_compliance != null && <StatCard label="Avg Pass 2 Compliance" value={`${data.quality_metrics.avg_pass2_compliance}%`} />}
          </div>
          {(data.quality_metrics.failing_quality || []).length > 0 && (
            <>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 6 }}>Grants Failing Quality Review</div>
              <table style={tableStyle}>
                <thead><tr><th style={thStyle}>Title</th><th style={thStyle}>Pass 1</th><th style={thStyle}>Pass 2</th><th style={thStyle}>Pass 3</th></tr></thead>
                <tbody>
                  {data.quality_metrics.failing_quality.map(g => (
                    <tr key={g.id}>
                      <td style={tdStyle}>{g.title || g.id}</td>
                      <td style={{ ...tdStyle, color: g.pass1_failed ? '#dc2626' : '#16a34a' }}>{g.pass1_failed ? '✕ Failed' : '✓'}</td>
                      <td style={{ ...tdStyle, color: g.pass2_failed ? '#dc2626' : '#16a34a' }}>{g.pass2_failed ? '✕ Failed' : '✓'}</td>
                      <td style={{ ...tdStyle, color: g.pass3_failed ? '#dc2626' : '#16a34a' }}>{g.pass3_failed ? '✕ Failed' : '✓'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Section>
      )}

      <Section title="Recent Deployments">
        {(data.deployments || []).length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>No deployment history yet</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Version</th>
                <th style={thStyle}>Environment</th>
                <th style={thStyle}>Started</th>
              </tr>
            </thead>
            <tbody>
              {data.deployments.map(d => (
                <tr key={d.id}>
                  <td style={tdStyle}>{d.worker_version}</td>
                  <td style={tdStyle}>{d.environment}</td>
                  <td style={tdStyle}>{new Date(d.started_at * 1000).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

// ── USERS PANEL ─────────────────────────────────────────────────────────────

function UsersPanel({ data, api, onRefresh }) {
  const [filter, setFilter] = useState('all')
  const [selectedUser, setSelectedUser] = useState(null)

  if (!data) return null

  const users = data.users || []
  const stats = data.stats || {}

  let filteredUsers = users
  if (filter === 'paying') filteredUsers = users.filter(u => u.plan_tier !== 'free')
  if (filter === 'free') filteredUsers = users.filter(u => u.plan_tier === 'free')
  if (filter === 'suspended') filteredUsers = users.filter(u => u.suspended === 1)

  async function suspendUser(userId, suspend) {
    try {
      await fetch(`${import.meta.env.VITE_WORKER_URL}/command/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await api.getToken()}`
        },
        body: JSON.stringify({ suspended: suspend })
      })
      onRefresh()
      setSelectedUser(null)
    } catch (e) {
      alert('Failed to update user: ' + e.message)
    }
  }

  async function grantPackage(userId) {
    if (!confirm(`Grant a submission package credit to this user? This allows them to run 5 rewrite cycles on one grant at no charge.`)) return
    try {
      await fetch(`${import.meta.env.VITE_WORKER_URL}/command/users/${userId}/grant-package`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await api.getToken()}`
        },
        body: JSON.stringify({})
      })
      alert('Submission package credit granted successfully.')
      onRefresh()
    } catch (e) {
      alert('Failed to grant package: ' + e.message)
    }
  }

  async function toggleVoice(userId, enabled) {
    try {
      await fetch(`${import.meta.env.VITE_WORKER_URL}/command/users/${userId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await api.getToken()}`
        },
        body: JSON.stringify({ voice_enabled: enabled ? 1 : 0 })
      })
      onRefresh()
      setSelectedUser(prev => prev ? { ...prev, voice_enabled: enabled ? 1 : 0 } : prev)
    } catch (e) {
      alert('Failed to update voice setting: ' + e.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <StatCard label="Total Users" value={stats.total} />
        <StatCard label="Paying" value={stats.paying} />
        <StatCard label="Free" value={stats.free} />
        <StatCard label="Active (7d)" value={stats.active_7d} />
        <StatCard label="Active (30d)" value={stats.active_30d} />
        <StatCard label="Never Active" value={stats.never_active} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        {['all', 'paying', 'free', 'suspended'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              ...filterBtn,
              background: filter === f ? '#111' : '#fff',
              color: filter === f ? '#fff' : '#111'
            }}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Email Domain</th>
            <th style={thStyle}>Tier</th>
            <th style={thStyle}>First Seen</th>
            <th style={thStyle}>Last Active</th>
            <th style={thStyle}>Grants</th>
            <th style={thStyle}>Generations</th>
            <th style={thStyle}>Est. Cost</th>
            <th style={thStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {filteredUsers.map(user => (
            <tr
              key={user.id}
              onClick={() => setSelectedUser(user)}
              style={{ cursor: 'pointer', background: selectedUser?.id === user.id ? '#f8f8f8' : 'transparent' }}
            >
              <td style={tdStyle}>{user.email_domain}</td>
              <td style={tdStyle}>
                <span style={{
                  padding: '2px 6px',
                  fontSize: 11,
                  borderRadius: 4,
                  background: user.plan_tier === 'free' ? '#e5e5e5' : '#059669',
                  color: user.plan_tier === 'free' ? '#666' : '#fff'
                }}>
                  {user.plan_tier}
                </span>
              </td>
              <td style={tdStyle}>{new Date(user.first_seen * 1000).toLocaleDateString()}</td>
              <td style={tdStyle}>{timeAgo(user.last_active)}</td>
              <td style={tdStyle}>{user.total_grants}</td>
              <td style={tdStyle}>{user.total_generations}</td>
              <td style={tdStyle}>${user.estimated_cost_usd.toFixed(2)}</td>
              <td style={tdStyle}>
                {user.suspended === 1 ? (
                  <span style={{ color: '#dc2626' }}>Suspended</span>
                ) : (
                  <span style={{ color: '#059669' }}>Active</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {selectedUser && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 400,
          height: '100%',
          background: '#fff',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
          padding: '2rem',
          overflowY: 'auto'
        }}>
          <button onClick={() => setSelectedUser(null)} style={{ ...backBtn, marginBottom: '1rem' }}>
            ✕ Close
          </button>
          <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: '1rem' }}>User Details</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: 13 }}>
            <p><strong>Email:</strong> {selectedUser.email}</p>
            <p><strong>Domain:</strong> {selectedUser.email_domain}</p>
            <p><strong>Tier:</strong> {selectedUser.plan_tier}</p>
            <p><strong>Total Grants:</strong> {selectedUser.total_grants}</p>
            <p><strong>Total Generations:</strong> {selectedUser.total_generations}</p>
            <p><strong>Total Tokens:</strong> {selectedUser.total_tokens_used.toLocaleString()}</p>
            <p><strong>Estimated Cost:</strong> ${selectedUser.estimated_cost_usd.toFixed(2)}</p>
            <p><strong>Notes:</strong> {selectedUser.notes || 'None'}</p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8 }}>
              <strong>Voice Mode:</strong>
              <button
                onClick={() => toggleVoice(selectedUser.id, selectedUser.voice_enabled !== 1)}
                style={{
                  padding: '3px 10px',
                  fontSize: 12,
                  borderRadius: 6,
                  border: '1px solid #ddd',
                  cursor: 'pointer',
                  background: selectedUser.voice_enabled !== 0 ? '#0e7490' : '#e5e5e5',
                  color: selectedUser.voice_enabled !== 0 ? '#fff' : '#666'
                }}
              >
                {selectedUser.voice_enabled !== 0 ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          </div>
          <div style={{ marginTop: '2rem', display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              onClick={() => grantPackage(selectedUser.id)}
              style={{ ...btnStyle, background: '#0e7490' }}
            >
              📦 Grant Submission Package
            </button>
            {selectedUser.suspended === 1 ? (
              <button onClick={() => suspendUser(selectedUser.id, false)} style={btnStyle}>
                Unsuspend User
              </button>
            ) : (
              <button
                onClick={() => {
                  if (confirm('Suspend this user? They will be blocked from all API calls.')) {
                    suspendUser(selectedUser.id, true)
                  }
                }}
                style={{ ...btnStyle, background: '#dc2626' }}
              >
                Suspend User
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── REVENUE PANEL ───────────────────────────────────────────────────────────

function RevenuePanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Section title="MRR Waterfall (Current Month)">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Metric</th>
              <th style={thStyle}>Amount</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={tdStyle}>New MRR</td>
              <td style={{ ...tdStyle, color: '#059669' }}>${data.waterfall.new_mrr.toFixed(2)}</td>
            </tr>
            <tr>
              <td style={tdStyle}>Expansion MRR</td>
              <td style={{ ...tdStyle, color: '#059669' }}>${data.waterfall.expansion_mrr.toFixed(2)}</td>
            </tr>
            <tr>
              <td style={tdStyle}>Contraction MRR</td>
              <td style={{ ...tdStyle, color: '#f59e0b' }}>${data.waterfall.contraction_mrr.toFixed(2)}</td>
            </tr>
            <tr>
              <td style={tdStyle}>Churn MRR</td>
              <td style={{ ...tdStyle, color: '#dc2626' }}>${data.waterfall.churn_mrr.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Tier Breakdown">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Tier</th>
              <th style={thStyle}>Subscribers</th>
              <th style={thStyle}>MRR</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(data.tier_breakdown || {}).map(([tier, info]) => (
              <tr key={tier}>
                <td style={tdStyle}>{tier}</td>
                <td style={tdStyle}>{info.count}</td>
                <td style={tdStyle}>${info.mrr.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

// ── AI COSTS PANEL ──────────────────────────────────────────────────────────

function AICostsPanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label="Today's Spend" value={`$${data.today_spend.toFixed(2)}`} />
        <StatCard label="Month's Spend" value={`$${data.month_spend.toFixed(2)}`} />
      </div>

      <Section title="Cost by Feature">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Feature</th>
              <th style={thStyle}>Calls</th>
              <th style={thStyle}>Tokens In</th>
              <th style={thStyle}>Tokens Out</th>
              <th style={thStyle}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {(data.by_feature || []).sort((a, b) => b.cost - a.cost).map((f, i) => (
              <tr key={i}>
                <td style={tdStyle}>{f.feature}</td>
                <td style={tdStyle}>{f.calls.toLocaleString()}</td>
                <td style={tdStyle}>{(f.input_tokens / 1000).toFixed(1)}K</td>
                <td style={tdStyle}>{(f.output_tokens / 1000).toFixed(1)}K</td>
                <td style={tdStyle}>${f.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Cost by Model">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Model</th>
              <th style={thStyle}>Tokens</th>
              <th style={thStyle}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {(data.by_model || []).map((m, i) => (
              <tr key={i}>
                <td style={tdStyle}>{m.model.includes('haiku') ? 'Haiku' : 'Sonnet'}</td>
                <td style={tdStyle}>{((m.input_tokens + m.output_tokens) / 1000).toFixed(1)}K</td>
                <td style={tdStyle}>${m.cost.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="Top Users by Cost">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Domain</th>
              <th style={thStyle}>Tier</th>
              <th style={thStyle}>Generations</th>
              <th style={thStyle}>Cost</th>
            </tr>
          </thead>
          <tbody>
            {(data.by_user || []).map((u, i) => (
              <tr key={i}>
                <td style={tdStyle}>{u.email_domain}</td>
                <td style={tdStyle}>{u.plan_tier}</td>
                <td style={tdStyle}>{u.total_generations}</td>
                <td style={tdStyle}>${u.estimated_cost_usd.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {data.voice && (
        <Section title="🎤 Voice Mode">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <StatCard label="Voice Sessions" value={data.voice.total_sessions || 0} />
            <StatCard label="Voice Tokens" value={`${((data.voice.total_tokens || 0) / 1000).toFixed(1)}K`} />
            <StatCard label="Voice Cost" value={`$${(data.voice.total_cost || 0).toFixed(2)}`} />
            <StatCard label="Avg Session Cost" value={`$${(data.voice.avg_session_cost || 0).toFixed(3)}`} />
          </div>
        </Section>
      )}

      {data.submission_packages && (
        <Section title="📦 Submission Packages">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
            <StatCard label="Total Sold" value={data.submission_packages.total_sold || 0} />
            <StatCard label="Total Revenue" value={`$${((data.submission_packages.total_sold || 0) * 199).toLocaleString()}`} />
            <StatCard label="Avg Cycles Used" value={(data.submission_packages.avg_cycles_used || 0).toFixed(1)} />
            <StatCard label="Active Packages" value={data.submission_packages.active_count || 0} />
            <StatCard label="Exhausted" value={data.submission_packages.exhausted_count || 0} />
          </div>
        </Section>
      )}
    </div>
  )
}

// ── GRANTS PANEL ────────────────────────────────────────────────────────────

function GrantsPanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
        <StatCard label="Total Projects" value={data.total_projects} />
        <StatCard label="With Sections" value={data.with_sections} />
      </div>

      <Section title="Mechanism Popularity">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Mechanism</th>
              <th style={thStyle}>Count</th>
            </tr>
          </thead>
          <tbody>
            {(data.mechanisms || []).map(m => (
              <tr key={m.mechanism}>
                <td style={tdStyle}>{m.mechanism}</td>
                <td style={tdStyle}>{m.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

// ── PRODUCT PANEL ───────────────────────────────────────────────────────────

function ProductPanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Section title="Feature Usage">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Feature</th>
              <th style={thStyle}>Total Uses</th>
              <th style={thStyle}>Last 7 Days</th>
              <th style={thStyle}>Unique Users</th>
            </tr>
          </thead>
          <tbody>
            {(data.feature_usage || []).map(f => (
              <tr key={f.feature}>
                <td style={tdStyle}>{f.feature}</td>
                <td style={tdStyle}>{f.total_uses.toLocaleString()}</td>
                <td style={tdStyle}>{f.uses_7d.toLocaleString()}</td>
                <td style={tdStyle}>{f.unique_users}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  )
}

// ── SECURITY PANEL ──────────────────────────────────────────────────────────

function SecurityPanel({ data }) {
  if (!data) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <Section title="Failed Auth Attempts (Last 24h)">
        {(data.failed_auth || []).length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>No failed auth attempts</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Endpoint</th>
                <th style={thStyle}>Count</th>
              </tr>
            </thead>
            <tbody>
              {data.failed_auth.map((a, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{a.endpoint}</td>
                  <td style={tdStyle}>{a.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Suspended Users">
        {(data.suspended_users || []).length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>No suspended users</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Email</th>
                <th style={thStyle}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {data.suspended_users.map(u => (
                <tr key={u.id}>
                  <td style={tdStyle}>{u.email}</td>
                  <td style={tdStyle}>{u.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section title="Unusual Activity (>50 calls/day)">
        {(data.unusual_activity || []).length === 0 ? (
          <p style={{ fontSize: 13, color: '#666' }}>No unusual activity detected</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>User ID</th>
                <th style={thStyle}>Calls</th>
                <th style={thStyle}>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {data.unusual_activity.map((u, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{u.user_id}</td>
                  <td style={tdStyle}>{u.count}</td>
                  <td style={tdStyle}>{(u.tokens / 1000).toFixed(1)}K</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

// ── FEEDBACK PANEL ──────────────────────────────────────────────────────────

function FeedbackPanel({ data, api, onRefresh }) {
  const [selectedFeedback, setSelectedFeedback] = useState(null)

  if (!data) return null

  async function markResolved(id, resolved) {
    try {
      await fetch(`${import.meta.env.VITE_WORKER_URL}/command/feedback/${id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await api.getToken()}`
        },
        body: JSON.stringify({ resolved })
      })
      onRefresh()
      setSelectedFeedback(null)
    } catch (e) {
      alert('Failed to update feedback: ' + e.message)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <StatCard label="Total Feedback" value={data.stats.total} />
        <StatCard label="Bugs" value={data.stats.bugs} />
        <StatCard label="Features" value={data.stats.features} />
        <StatCard label="Resolved" value={data.stats.resolved} />
      </div>

      <Section title="All Feedback">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Type</th>
              <th style={thStyle}>Message</th>
              <th style={thStyle}>Page</th>
              <th style={thStyle}>Submitted</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {(data.feedback || []).map(f => (
              <tr
                key={f.id}
                onClick={() => setSelectedFeedback(f)}
                style={{ cursor: 'pointer' }}
              >
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 6px',
                    fontSize: 11,
                    borderRadius: 4,
                    background: f.feedback_type === 'bug' ? '#dc2626' : f.feedback_type === 'feature' ? '#059669' : '#666',
                    color: '#fff'
                  }}>
                    {f.feedback_type}
                  </span>
                </td>
                <td style={tdStyle}>{f.message.slice(0, 60)}...</td>
                <td style={tdStyle}>{f.page}</td>
                <td style={tdStyle}>{new Date(f.created_at * 1000).toLocaleDateString()}</td>
                <td style={tdStyle}>{f.resolved === 1 ? '✅' : '⏳'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {selectedFeedback && (
        <div style={{
          position: 'fixed',
          top: 0,
          right: 0,
          width: 400,
          height: '100%',
          background: '#fff',
          boxShadow: '-2px 0 10px rgba(0,0,0,0.1)',
          padding: '2rem',
          overflowY: 'auto'
        }}>
          <button onClick={() => setSelectedFeedback(null)} style={{ ...backBtn, marginBottom: '1rem' }}>
            ✕ Close
          </button>
          <h3 style={{ fontSize: 16, fontWeight: 500, marginBottom: '1rem' }}>Feedback Details</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: 13 }}>
            <p><strong>Type:</strong> {selectedFeedback.feedback_type}</p>
            <p><strong>Domain:</strong> {selectedFeedback.email_domain}</p>
            <p><strong>Page:</strong> {selectedFeedback.page}</p>
            <p><strong>Message:</strong></p>
            <p style={{ whiteSpace: 'pre-wrap', background: '#f8f8f8', padding: '0.5rem', borderRadius: 4 }}>
              {selectedFeedback.message}
            </p>
            <p><strong>Submitted:</strong> {new Date(selectedFeedback.created_at * 1000).toLocaleString()}</p>
          </div>
          <div style={{ marginTop: '2rem' }}>
            {selectedFeedback.resolved === 1 ? (
              <button onClick={() => markResolved(selectedFeedback.id, false)} style={btnStyle}>
                Mark as Open
              </button>
            ) : (
              <button onClick={() => markResolved(selectedFeedback.id, true)} style={{ ...btnStyle, background: '#059669' }}>
                Mark as Resolved
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── CLIENTS PANEL (v6.0.0) ───────────────────────────────────────────────────
function ClientsPanel({ api }) {
  const [clients, setClients] = useState([])
  const [loading, setLoading] = useState(true)
  const [fundedModal, setFundedModal] = useState(null)
  const [fundedForm, setFundedForm] = useState({ award_number: '', award_amount: '', award_notification_date: '' })

  useEffect(() => { loadClients() }, [])

  async function loadClients() {
    setLoading(true)
    try {
      const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/command/clients`, {
        headers: { Authorization: `Bearer ${await api.getToken()}` }
      })
      const data = await res.json()
      setClients(data.clients || [])
    } catch (e) { alert('Failed to load clients: ' + e.message) }
    setLoading(false)
  }

  async function patchClient(id, body) {
    await fetch(`${import.meta.env.VITE_WORKER_URL}/command/clients/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await api.getToken()}` },
      body: JSON.stringify(body)
    })
    loadClients()
  }

  async function markFunded() {
    if (!fundedModal) return
    await fetch(`${import.meta.env.VITE_WORKER_URL}/command/clients/${fundedModal.id}/mark-funded`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await api.getToken()}` },
      body: JSON.stringify(fundedForm)
    })
    setFundedModal(null)
    loadClients()
  }

  const STATUS_COLORS = {
    intake_received: { bg: '#eff6ff', color: '#2563eb' },
    in_progress: { bg: '#f0fdf4', color: '#15803d' },
    draft_sent: { bg: '#fef9c3', color: '#92400e' },
    submitted: { bg: '#f5f3ff', color: '#7c3aed' },
    funded: { bg: '#dcfce7', color: '#166534' },
    closed: { bg: '#f9fafb', color: '#6b7280' },
  }

  const total = clients.length
  const inProgress = clients.filter(c => c.status === 'in_progress').length
  const funded = clients.filter(c => c.status === 'funded').length
  const totalRevenue = clients.reduce((s, c) => s + (c.upfront_fee_paid || 0) + (c.success_fee_amount && c.success_fee_status === 'paid' ? c.success_fee_amount : 0), 0)

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading clients...</div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <StatCard label="Total Clients" value={total} />
        <StatCard label="In Progress" value={inProgress} />
        <StatCard label="Funded" value={funded} />
        <StatCard label="Total Revenue" value={`$${totalRevenue.toLocaleString()}`} />
      </div>

      {clients.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#888', border: '1px dashed #e5e7eb', borderRadius: 8 }}>No clients yet — intake submissions will appear here.</div>
      ) : (
        <Section title="Service Clients">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Name / Email</th>
                <th style={thStyle}>Mechanism</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Upfront Fee</th>
                <th style={thStyle}>Success Fee</th>
                <th style={thStyle}>Date</th>
                <th style={thStyle}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const sc = STATUS_COLORS[c.status] || STATUS_COLORS.intake_received
                return (
                  <tr key={c.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{c.client_name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{c.client_email}</div>
                      {c.client_institution && <div style={{ fontSize: 11, color: '#888' }}>{c.client_institution}</div>}
                    </td>
                    <td style={tdStyle}>{c.mechanism || '—'}</td>
                    <td style={tdStyle}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: sc.bg, color: sc.color, fontWeight: 600 }}>{c.status?.replace(/_/g, ' ')}</span>
                    </td>
                    <td style={tdStyle}>{c.upfront_fee_paid > 0 ? `$${c.upfront_fee_paid.toLocaleString()} paid` : '—'}</td>
                    <td style={tdStyle}>
                      {c.success_fee_amount ? (
                        <span style={{ fontSize: 11 }}>${c.success_fee_amount.toLocaleString()} ({c.success_fee_status})</span>
                      ) : '—'}
                    </td>
                    <td style={tdStyle}>{new Date(c.created_at * 1000).toLocaleDateString()}</td>
                    <td style={tdStyle}>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        <select
                          value={c.status}
                          onChange={e => patchClient(c.id, { status: e.target.value })}
                          style={{ fontSize: 11, padding: '3px 6px', border: '1px solid #e5e7eb', borderRadius: 4, cursor: 'pointer' }}
                        >
                          {['intake_received', 'in_progress', 'draft_sent', 'submitted', 'funded', 'closed'].map(s => (
                            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
                          ))}
                        </select>
                        {c.status !== 'funded' && (
                          <button onClick={() => { setFundedModal(c); setFundedForm({ award_number: '', award_amount: '', award_notification_date: '' }) }} style={{ fontSize: 11, padding: '3px 8px', background: '#dcfce7', color: '#166534', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer' }}>
                            Mark Funded
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}

      {fundedModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: '#fff', borderRadius: 12, padding: 28, maxWidth: 420, width: '90%' }}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>Mark as Funded — {fundedModal.client_name}</div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Award Number</div>
              <input value={fundedForm.award_number} onChange={e => setFundedForm(f => ({ ...f, award_number: e.target.value }))} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} placeholder="e.g. 1R43CA123456-01" />
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Award Amount ($)</div>
              <input type="number" value={fundedForm.award_amount} onChange={e => setFundedForm(f => ({ ...f, award_amount: e.target.value }))} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} placeholder="e.g. 300000" />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>Notification Date</div>
              <input type="date" value={fundedForm.award_notification_date} onChange={e => setFundedForm(f => ({ ...f, award_notification_date: e.target.value }))} style={{ width: '100%', padding: '8px 10px', border: '1px solid #e5e7eb', borderRadius: 6, fontSize: 13, boxSizing: 'border-box' }} />
            </div>
            {fundedForm.award_amount && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 13, color: '#15803d' }}>
                Success fee: ${(parseFloat(fundedForm.award_amount) * 0.03).toLocaleString(undefined, { maximumFractionDigits: 0 })} (3% of award)
              </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setFundedModal(null)} style={{ ...backBtn, flex: 1 }}>Cancel</button>
              <button onClick={markFunded} style={{ flex: 1, padding: '8px', background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>Confirm Funded</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── NPS PANEL (v6.0.0) ───────────────────────────────────────────────────────
function NPSPanel({ api }) {
  const [npsData, setNpsData] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const res = await fetch(`${import.meta.env.VITE_WORKER_URL}/command/nps`, {
          headers: { Authorization: `Bearer ${await api.getToken()}` }
        })
        setNpsData(await res.json())
      } catch (e) { console.error(e) }
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div style={{ padding: 40, textAlign: 'center', color: '#666' }}>Loading NPS data...</div>
  if (!npsData) return null

  const { nps, total, promoters, passives, detractors, responses } = npsData
  const npsColor = nps == null ? '#9ca3af' : nps >= 50 ? '#15803d' : nps >= 0 ? '#d97706' : '#dc2626'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem' }}>
        <div style={{ padding: '1rem', border: '0.5px solid #e5e5e5', borderRadius: 8, background: '#fff', textAlign: 'center' }}>
          <div style={{ fontSize: 11, color: '#666', marginBottom: 4, textTransform: 'uppercase' }}>NPS Score</div>
          <div style={{ fontSize: 40, fontWeight: 700, color: npsColor }}>{nps ?? '—'}</div>
          <div style={{ fontSize: 11, color: '#9ca3af' }}>Net Promoter Score</div>
        </div>
        <StatCard label="Total Responses" value={total} />
        <StatCard label="Promoters (9-10)" value={promoters} />
        <StatCard label="Passives (7-8)" value={passives} />
        <StatCard label="Detractors (0-6)" value={detractors} />
      </div>

      {(responses || []).length > 0 && (
        <Section title="Recent NPS Responses">
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>Score</th>
                <th style={thStyle}>Comment</th>
                <th style={thStyle}>Week</th>
                <th style={thStyle}>Date</th>
              </tr>
            </thead>
            <tbody>
              {responses.map((r, i) => {
                const sc = r.nps_score >= 9 ? '#15803d' : r.nps_score >= 7 ? '#d97706' : '#dc2626'
                return (
                  <tr key={i}>
                    <td style={tdStyle}>
                      <span style={{ fontWeight: 700, color: sc, fontSize: 15 }}>{r.nps_score}</span>
                    </td>
                    <td style={tdStyle}>{r.message || '—'}</td>
                    <td style={tdStyle}>{r.nps_week || '—'}</td>
                    <td style={tdStyle}>{new Date(r.created_at * 1000).toLocaleDateString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Section>
      )}

      {total === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem', color: '#888', border: '1px dashed #e5e7eb', borderRadius: 8 }}>No NPS responses yet — the widget will appear on user dashboards after 7 days.</div>
      )}
    </div>
  )
}

// ── UTILITY COMPONENTS ──────────────────────────────────────────────────────

function StatCard({ label, value }) {
  return (
    <div style={{
      padding: '1rem',
      border: '0.5px solid #e5e5e5',
      borderRadius: 8,
      background: '#fff'
    }}>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 500 }}>{value}</div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div>
      <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>{title}</h3>
      {children}
    </div>
  )
}

function timeAgo(timestamp) {
  const seconds = Math.floor(Date.now() / 1000) - timestamp
  if (seconds < 60) return 'Just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// ── STYLES ──────────────────────────────────────────────────────────────────

const backBtn = {
  padding: '7px 14px',
  fontSize: 13,
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#666'
}

const btnStyle = {
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#111',
  color: '#fff',
  width: '100%'
}

const filterBtn = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: '0.5px solid #ccc',
  borderRadius: 6,
  cursor: 'pointer'
}

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13
}

const thStyle = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '0.5px solid #e5e5e5',
  fontWeight: 500,
  fontSize: 12,
  color: '#666'
}

const tdStyle = {
  padding: '8px 12px',
  borderBottom: '0.5px solid #f5f5f5'
}
