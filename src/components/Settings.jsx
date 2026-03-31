import { useState, useEffect } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useApi } from '../hooks/useApi'

const TEAL = '#0e7490'

const PLAN_LABELS = {
  free:        { label: 'Free',        color: '#6b7280', bg: '#f3f4f6' },
  individual:  { label: 'Individual',  color: '#0e7490', bg: '#f0f9ff' },
  lab:         { label: 'Lab',         color: '#7c3aed', bg: '#f5f3ff' },
  unlimited:   { label: 'Unlimited',   color: '#059669', bg: '#f0fdf4' },
}

const PLAN_FEATURES = {
  free:        { budget: '$0',   ai: 'No AI generation',     voice: false },
  individual:  { budget: '$15',  ai: '$15/month AI budget',  voice: false },
  lab:         { budget: '$40',  ai: '$40/month AI budget',  voice: true  },
  unlimited:   { budget: '∞',    ai: 'Unlimited AI budget',  voice: true  },
}

export default function Settings({ onBack }) {
  const { user } = useUser()
  const api = useApi()

  const [me, setMe] = useState(null)
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [feedbackSent, setFeedbackSent] = useState(false)
  const [feedbackSending, setFeedbackSending] = useState(false)

  const email = user?.emailAddresses?.[0]?.emailAddress || ''
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email
  const initials = (user?.firstName?.[0] || email[0] || '?').toUpperCase()

  useEffect(() => {
    async function load() {
      try {
        const [meData, usageData] = await Promise.all([
          api.request ? undefined : null,
          api.getUsage().catch(() => null),
        ])
        setUsage(usageData)
      } catch {}

      // Fetch /api/users/me via getToken
      try {
        const token = await api.getToken()
        const res = await fetch(`${import.meta.env.VITE_WORKER_URL || '/api'}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (res.ok) setMe(await res.json())
      } catch {}
      setLoading(false)
    }
    load()
  }, [])

  const tier = me?.plan_tier || 'free'
  const plan = PLAN_LABELS[tier] || PLAN_LABELS.free
  const features = PLAN_FEATURES[tier] || PLAN_FEATURES.free

  const monthly = usage?.monthly
  const pct = monthly ? Math.min(100, monthly.percentage || 0) : 0
  const barColor = pct >= 100 ? '#dc2626' : pct > 80 ? '#f59e0b' : TEAL

  async function sendFeedback() {
    if (!feedbackText.trim()) return
    setFeedbackSending(true)
    try {
      const token = await api.getToken()
      await fetch(`${import.meta.env.VITE_WORKER_URL || '/api'}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: feedbackText, feedback_type: 'general' }),
      })
      setFeedbackSent(true)
      setFeedbackText('')
    } catch {}
    setFeedbackSending(false)
  }

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1.5rem', paddingBottom: '4rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
        <button
          onClick={onBack}
          style={{ padding: '6px 12px', fontSize: 13, border: '0.5px solid #e5e5e5', borderRadius: 6, cursor: 'pointer', background: '#fff', color: '#666' }}
        >
          ← Back
        </button>
        <h1 style={{ fontSize: 22, fontWeight: 500, margin: 0 }}>Settings</h1>
      </div>

      {/* ── Account ─────────────────────────────────────────── */}
      <Section title="Account">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '1rem' }}>
          <div style={{ width: 52, height: 52, borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 20, flexShrink: 0 }}>
            {initials}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#111', marginBottom: 2 }}>{name}</div>
            <div style={{ fontSize: 13, color: '#6b7280' }}>{email}</div>
          </div>
          <div style={{ display: 'inline-flex', alignItems: 'center', padding: '4px 10px', borderRadius: 20, background: plan.bg, color: plan.color, fontSize: 12, fontWeight: 600 }}>
            {plan.label}
          </div>
        </div>
      </Section>

      {/* ── Plan & Usage ─────────────────────────────────────── */}
      <Section title="Plan & Usage">
        {loading ? (
          <div style={{ padding: '1rem', fontSize: 13, color: '#9ca3af' }}>Loading…</div>
        ) : (
          <div style={{ padding: '1rem' }}>
            {/* Plan badge row */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600, color: '#111', marginBottom: 2 }}>{plan.label} Plan</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>{features.ai}{features.voice ? ' · Voice Mode included' : ''}</div>
              </div>
              {tier === 'free' || tier === 'individual' ? (
                <a
                  href="mailto:eddieb@coareholdings.com?subject=FrankGrant%20Upgrade"
                  style={{ padding: '7px 16px', background: TEAL, color: '#fff', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 500, textDecoration: 'none', cursor: 'pointer' }}
                >
                  Upgrade →
                </a>
              ) : (
                <span style={{ fontSize: 12, color: '#059669', fontWeight: 500 }}>✓ Active</span>
              )}
            </div>

            {/* Usage bar */}
            {monthly && tier !== 'unlimited' && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>This month's AI usage</span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: barColor }}>
                    ${monthly.cost.toFixed(2)} / ${monthly.limit.toFixed(2)}
                  </span>
                </div>
                <div style={{ width: '100%', height: 8, background: '#e5e7eb', borderRadius: 4, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ width: `${pct}%`, height: '100%', background: barColor, borderRadius: 4, transition: 'width 0.3s' }} />
                </div>
                {pct >= 100 && (
                  <div style={{ fontSize: 12, color: '#dc2626', marginBottom: 8 }}>⚠️ Monthly budget reached. AI generation is paused until next month.</div>
                )}
                {pct > 80 && pct < 100 && (
                  <div style={{ fontSize: 12, color: '#f59e0b', marginBottom: 8 }}>⚠️ {pct.toFixed(0)}% of monthly budget used.</div>
                )}
              </>
            )}

            {/* Breakdown */}
            {monthly?.breakdown?.length > 0 && (
              <details style={{ marginTop: 4 }}>
                <summary style={{ fontSize: 12, color: '#9ca3af', cursor: 'pointer', userSelect: 'none' }}>
                  Show breakdown
                </summary>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {monthly.breakdown.map((item, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#374151' }}>
                      <span>{item.model?.includes('haiku') ? 'Claude Haiku' : 'Claude Sonnet'} — {item.calls} calls</span>
                      <span style={{ fontWeight: 500 }}>${item.cost.toFixed(3)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}

            {tier === 'unlimited' && (
              <div style={{ fontSize: 13, color: '#059669', fontWeight: 500 }}>✓ Unlimited AI usage — no monthly cap</div>
            )}
          </div>
        )}
      </Section>

      {/* ── Voice Mode ───────────────────────────────────────── */}
      <Section title="Voice Mode">
        <div style={{ padding: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500, color: '#111', marginBottom: 2 }}>AI Voice Assistant</div>
            <div style={{ fontSize: 12, color: '#6b7280' }}>
              {me?.voice_enabled
                ? 'Enabled — use the 🎤 button inside any grant'
                : 'Talk to your grant with voice commands'}
            </div>
          </div>
          {me?.voice_enabled ? (
            <span style={{ fontSize: 12, color: '#059669', fontWeight: 600, padding: '4px 12px', background: '#f0fdf4', borderRadius: 20 }}>Enabled</span>
          ) : (
            <a
              href="mailto:eddieb@coareholdings.com?subject=FrankGrant%20Voice%20Mode"
              style={{ padding: '7px 14px', background: '#f8fafc', color: '#374151', border: '0.5px solid #e2e8f0', borderRadius: 8, fontSize: 12, fontWeight: 500, textDecoration: 'none' }}
            >
              Request access
            </a>
          )}
        </div>
      </Section>

      {/* ── Send Feedback ────────────────────────────────────── */}
      <Section title="Send Feedback">
        <div style={{ padding: '1rem' }}>
          {feedbackSent ? (
            <div style={{ fontSize: 14, color: '#059669', fontWeight: 500 }}>✓ Thanks — we read every message.</div>
          ) : (
            <>
              <textarea
                value={feedbackText}
                onChange={e => setFeedbackText(e.target.value)}
                placeholder="What's working well? What's missing? Any bugs?"
                rows={3}
                style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '0.5px solid #e2e8f0', borderRadius: 8, resize: 'vertical', fontFamily: 'inherit', color: '#111', outline: 'none', boxSizing: 'border-box' }}
              />
              <button
                onClick={sendFeedback}
                disabled={feedbackSending || !feedbackText.trim()}
                style={{ marginTop: 8, padding: '8px 20px', background: TEAL, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 500, cursor: feedbackSending || !feedbackText.trim() ? 'not-allowed' : 'pointer', opacity: feedbackSending || !feedbackText.trim() ? 0.6 : 1 }}
              >
                {feedbackSending ? 'Sending…' : 'Send'}
              </button>
            </>
          )}
        </div>
      </Section>

      {/* ── Legal & Support ──────────────────────────────────── */}
      <Section title="Legal & Support">
        <div style={{ padding: '0.5rem 0' }}>
          {[
            { label: 'Terms of Service',  href: '/#/terms' },
            { label: 'Privacy Policy',    href: '/#/privacy' },
            { label: 'Email Support',     href: 'mailto:eddieb@coareholdings.com' },
          ].map(link => (
            <a
              key={link.label}
              href={link.href}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px', fontSize: 14, color: '#374151', textDecoration: 'none', borderBottom: '0.5px solid #f3f4f6' }}
              onMouseOver={e => e.currentTarget.style.background = '#f9fafb'}
              onMouseOut={e => e.currentTarget.style.background = 'transparent'}
            >
              {link.label}
              <span style={{ color: '#d1d5db', fontSize: 16 }}>›</span>
            </a>
          ))}
        </div>
      </Section>

      {/* ── Version ─────────────────────────────────────────── */}
      <div style={{ textAlign: 'center', fontSize: 11, color: '#d1d5db', marginTop: '2rem' }}>
        FrankGrant · © 2026 COARE Holdings
      </div>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: '1.25rem', border: '0.5px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff' }}>
      <div style={{ padding: '10px 16px', background: '#f9fafb', borderBottom: '0.5px solid #e5e7eb', fontSize: 11, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {title}
      </div>
      {children}
    </div>
  )
}
