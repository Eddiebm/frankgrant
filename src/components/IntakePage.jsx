import { useState } from 'react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

function getFee(mechanism) {
  if (!mechanism) return 2500
  if (mechanism.includes('Fast Track') || mechanism.includes('Fast-Track')) return 5000
  if (mechanism.includes('Phase II') || mechanism.includes('-II')) return 4500
  if (mechanism === 'R01') return 3500
  if (mechanism === 'R21') return 2000
  return 2500
}

export default function IntakePage() {
  const [form, setForm] = useState({
    client_name: '', client_email: '', client_institution: '', pi_name: '',
    contact_phone: '', mechanism: '', institute: '', research_description: '',
    preliminary_data_description: '', foa_number: ''
  })
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState(null)

  const fee = getFee(form.mechanism)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.client_name || !form.client_email || !form.research_description) {
      setError('Please fill in all required fields.')
      return
    }
    if (form.research_description.length < 100) {
      setError('Please provide more detail in your research description (at least 100 characters).')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${API_BASE}/intake/direct`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      })
      const data = await res.json()
      if (data.ok) { setSubmitted(true) }
      else { setError(data.message || 'Submission failed. Please try again.') }
    } catch {
      setError('Network error. Please try again.')
    }
    setSubmitting(false)
  }

  if (submitted) {
    return (
      <div style={{ minHeight: '100vh', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <div style={{ background: '#fff', borderRadius: 12, padding: 40, maxWidth: 500, textAlign: 'center', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, color: '#15803d', marginBottom: 12 }}>Thank you, {form.client_name}!</h2>
          <p style={{ fontSize: 15, color: '#374151', lineHeight: 1.6, marginBottom: 16 }}>We received your intake. You will receive a welcome email within 24 hours. Your first draft is expected within 5–7 business days of payment confirmation.</p>
          <p style={{ fontSize: 13, color: '#6b7280' }}>Questions? Email <a href="mailto:eddie@bannermanmenson.com" style={{ color: '#0e7490' }}>eddie@bannermanmenson.com</a></p>
        </div>
      </div>
    )
  }

  const f = (k, v) => setForm(p => ({ ...p, [k]: v }))
  const inp = { width: '100%', padding: '10px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 15, boxSizing: 'border-box', fontFamily: 'inherit' }
  const lbl = { display: 'block', fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 6 }

  const mechanismOptions = ['SBIR Phase I', 'STTR Phase I', 'SBIR Phase II', 'STTR Phase II', 'SBIR Fast Track', 'STTR Fast Track', 'R01', 'R21']

  return (
    <div style={{ minHeight: '100vh', background: '#fafafa', fontFamily: 'Georgia, serif' }}>
      {/* Header */}
      <div style={{ background: '#0e7490', color: '#fff', padding: '40px 24px', textAlign: 'center' }}>
        <div style={{ maxWidth: 700, margin: '0 auto' }}>
          <div style={{ fontSize: 13, color: '#a5f3fc', marginBottom: 8, fontFamily: 'sans-serif' }}>COARE Holdings · FrankGrant</div>
          <h1 style={{ fontSize: 32, fontWeight: 700, marginBottom: 12 }}>NIH Grant Writing Services</h1>
          <p style={{ fontSize: 17, color: '#e0f2fe', lineHeight: 1.6 }}>Professional SBIR/STTR and R-series grant writing by researchers with $7M+ in NIH awards. Done-for-you grant preparation using expert knowledge and AI.</p>
        </div>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '40px 24px' }}>
        {/* Pricing cards */}
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 24, textAlign: 'center' }}>Service Pricing</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 32 }}>
          {[
            { label: 'Phase I', sub: 'SBIR or STTR', fee: '$2,500', detail: '+ 3% success fee if funded' },
            { label: 'Phase II / Fast Track', sub: 'SBIR or STTR', fee: '$4,500', detail: '+ 3% success fee if funded' },
            { label: 'R01 / R21', sub: 'NIH R-series', fee: '$3,500', detail: '+ 3% success fee if funded' },
          ].map(card => (
            <div key={card.label} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20, textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#111', marginBottom: 4 }}>{card.label}</div>
              <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 12 }}>{card.sub}</div>
              <div style={{ fontSize: 28, fontWeight: 800, color: '#0e7490', marginBottom: 4 }}>{card.fee}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{card.detail}</div>
            </div>
          ))}
        </div>

        {/* What's included */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: '#111', marginBottom: 16 }}>What's Included</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 8 }}>
            {[
              'Complete grant application written by expert + AI',
              'Minimum 3 rounds of revision included',
              'Commercialization Plan (Phase II/Fast Track)',
              'Three-pass quality review before delivery',
              'Citation verification across 5 scholarly databases',
              'NIH submission package (all required documents)',
              'Submission checklist with deadlines',
              '90 days revision support after submission',
            ].map(item => (
              <div key={item} style={{ display: 'flex', gap: 8, fontSize: 14, color: '#374151' }}>
                <span style={{ color: '#0e7490', flexShrink: 0 }}>✓</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Ownership box */}
        <div style={{ background: '#e0f2fe', border: '1px solid #7dd3fc', borderRadius: 10, padding: 20, marginBottom: 32 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e', marginBottom: 6 }}>Your science remains 100% yours.</div>
          <div style={{ fontSize: 13, color: '#0369a1', lineHeight: 1.6 }}>Your research, data, hypotheses, preliminary results, and intellectual property remain entirely yours. FrankGrant owns only the writing service platform. You own your grant.</div>
        </div>

        {/* Intake Form */}
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 32, boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
          <h2 style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 8 }}>Start Your Grant</h2>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24 }}>Fill out this form and we'll contact you within 24 hours to confirm details and arrange payment.</p>

          <form onSubmit={handleSubmit}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Your Name *</label>
                <input style={inp} value={form.client_name} onChange={e => f('client_name', e.target.value)} required />
              </div>
              <div>
                <label style={lbl}>Email Address *</label>
                <input type="email" style={inp} value={form.client_email} onChange={e => f('client_email', e.target.value)} required />
              </div>
              <div>
                <label style={lbl}>Institution / Company</label>
                <input style={inp} value={form.client_institution} onChange={e => f('client_institution', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>PI Name (if different from you)</label>
                <input style={inp} value={form.pi_name} onChange={e => f('pi_name', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>Phone (optional)</label>
                <input type="tel" style={inp} value={form.contact_phone} onChange={e => f('contact_phone', e.target.value)} />
              </div>
              <div>
                <label style={lbl}>FOA Number (optional)</label>
                <input style={inp} placeholder="e.g. PA-24-184" value={form.foa_number} onChange={e => f('foa_number', e.target.value)} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
              <div>
                <label style={lbl}>Grant Mechanism *</label>
                <select style={inp} value={form.mechanism} onChange={e => f('mechanism', e.target.value)} required>
                  <option value="">Select mechanism...</option>
                  {mechanismOptions.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>NIH Institute / IC</label>
                <input style={inp} placeholder="e.g. NCI, NHLBI, NICHD" value={form.institute} onChange={e => f('institute', e.target.value)} />
              </div>
            </div>

            {form.mechanism && (
              <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, padding: '12px 16px', marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: '#15803d', fontWeight: 600 }}>Your upfront fee:</div>
                <div style={{ fontSize: 28, fontWeight: 800, color: '#15803d' }}>${fee.toLocaleString()}</div>
                <div style={{ fontSize: 12, color: '#6b7280' }}>+ 3% success fee payable within 30 days of Notice of Award (from operating funds)</div>
              </div>
            )}

            <div style={{ marginBottom: 16 }}>
              <label style={lbl}>Research Description * <span style={{ fontWeight: 400, color: '#9ca3af' }}>(describe your research, technology, and target indication)</span></label>
              <textarea
                style={{ ...inp, minHeight: 120, resize: 'vertical' }}
                value={form.research_description}
                onChange={e => f('research_description', e.target.value)}
                required
                placeholder="Describe your research, the problem you're solving, your technology or approach, and the target disease or indication. Include what stage you're at (e.g. proof of concept, animal studies, Phase I clinical data)."
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={lbl}>Preliminary Data Summary <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional but helpful)</span></label>
              <textarea
                style={{ ...inp, minHeight: 80, resize: 'vertical' }}
                value={form.preliminary_data_description}
                onChange={e => f('preliminary_data_description', e.target.value)}
                placeholder="Summarize your key preliminary data — what experiments have been done, what results support your approach."
              />
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6, padding: '10px 14px', fontSize: 13, color: '#dc2626', marginBottom: 16 }}>{error}</div>
            )}

            <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 16, textAlign: 'center' }}>
              By submitting you agree to our{' '}
              <a href="/#/terms" style={{ color: '#0e7490' }}>Terms of Service</a>{' '}and{' '}
              <a href="/#/privacy" style={{ color: '#0e7490' }}>Privacy Policy</a>.
            </div>

            <button
              type="submit"
              disabled={submitting}
              style={{ width: '100%', padding: '14px', background: submitting ? '#e5e7eb' : '#0e7490', color: submitting ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, fontSize: 16, fontWeight: 700, cursor: submitting ? 'not-allowed' : 'pointer' }}
            >
              {submitting ? 'Submitting...' : `Submit Intake — $${fee.toLocaleString()} upfront`}
            </button>
          </form>
        </div>

        <div style={{ marginTop: 32, textAlign: 'center', fontSize: 12, color: '#9ca3af' }}>
          © 2026 FrankGrant · COARE Holdings ·{' '}
          <a href="/#/terms" style={{ color: '#0e7490' }}>Terms</a> ·{' '}
          <a href="/#/privacy" style={{ color: '#0e7490' }}>Privacy</a>
        </div>
      </div>
    </div>
  )
}
