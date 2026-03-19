import { useState } from 'react'
import { useUser } from '@clerk/clerk-react'
import { useApi } from '../hooks/useApi'

const ADMIN_EMAILS = ['eddieb@coareholdings.com', 'eddie@bannermanmenson.com']

const INCLUDED = [
  '5 rewrite cycles informed by reviewer feedback',
  'Reference verification after every rewrite',
  'Compliance certification',
  'NIH submission package download',
  'Priority processing',
]

export default function SubmissionPackageModal({ projectId, cyclesRemaining, onClose, onActivated }) {
  const { user } = useUser()
  const api = useApi()
  const [requesting, setRequesting] = useState(false)
  const [requested, setRequested] = useState(false)

  const email = user?.emailAddresses?.[0]?.emailAddress || ''
  const isAdmin = ADMIN_EMAILS.includes(email)

  async function requestTrial() {
    setRequesting(true)
    try {
      const token = await api.getToken()
      await fetch(`${import.meta.env.VITE_WORKER_URL}/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ type: 'submission_package_trial_request', message: `Trial request from ${email} for project ${projectId}` }),
      })
      setRequested(true)
    } catch (e) { alert('Failed to send request: ' + e.message) }
    setRequesting(false)
  }

  if (isAdmin && cyclesRemaining !== undefined) {
    const total = 5
    const used = total - cyclesRemaining
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
        <div style={{ background: '#fff', borderRadius: 16, padding: 32, maxWidth: 480, width: '100%', textAlign: 'center' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0e7490', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Admin — Submission Package</div>
          <div style={{ fontSize: 28, fontWeight: 700, marginBottom: 4 }}>{cyclesRemaining} cycles remaining</div>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>on this grant ({used} of {total} used)</div>
          <div style={{ background: '#f0f9ff', borderRadius: 8, height: 8, marginBottom: 24, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${(used / total) * 100}%`, background: '#0e7490', borderRadius: 8, transition: 'width 0.3s' }} />
          </div>
          <button onClick={onClose} style={{ padding: '10px 24px', fontSize: 14, fontWeight: 600, background: '#0e7490', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}>Close</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
      <div style={{ background: '#fff', borderRadius: 16, padding: '40px 32px', maxWidth: 480, width: '100%', boxShadow: '0 25px 50px rgba(0,0,0,0.15)' }}>
        <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: '#9ca3af' }}>✕</button>

        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>📦</div>
          <div style={{ fontSize: 22, fontWeight: 700, color: '#111', marginBottom: 4 }}>Submission Package</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: '#0e7490' }}>$199<span style={{ fontSize: 16, fontWeight: 500, color: '#6b7280' }}> per grant</span></div>
        </div>

        <div style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>What's included</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {INCLUDED.map((item, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span style={{ color: '#0d9488', fontWeight: 700, flexShrink: 0, marginTop: 1 }}>✓</span>
                <span style={{ fontSize: 14, color: '#374151' }}>{item}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          style={{ width: '100%', padding: '14px', fontSize: 16, fontWeight: 700, background: '#0e7490', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', marginBottom: 12 }}
          onClick={() => { window.location.href = '/upgrade/submission-package' }}
        >
          Purchase Submission Package — $199
        </button>

        <div style={{ textAlign: 'center' }}>
          {requested ? (
            <span style={{ fontSize: 13, color: '#0d9488' }}>✓ Trial request sent. We'll be in touch within 24 hours.</span>
          ) : (
            <button
              onClick={requestTrial}
              disabled={requesting}
              style={{ background: 'none', border: 'none', fontSize: 13, color: '#6b7280', textDecoration: 'underline', cursor: 'pointer' }}
            >
              {requesting ? 'Sending request…' : 'Request Free Trial'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
