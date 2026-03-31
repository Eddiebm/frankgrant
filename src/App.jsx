import { useState, useEffect } from 'react'
import { SignedIn, SignedOut, SignInButton, useUser } from '@clerk/clerk-react'
import AppShell from './components/AppShell'
import Dashboard from './components/Dashboard'
import GrantEditor from './components/GrantEditor'
import LettersGenerator from './components/LettersGenerator'
import BiosketchGenerator from './components/BiosketchGenerator'
import StatusPage from './components/StatusPage'
import SharedGrantView from './components/SharedGrantView'
import ErrorBoundary from './components/ErrorBoundary'
import FeedbackButton from './components/FeedbackButton'
import CommandStation from './components/CommandStation'
import GrantWizard from './components/GrantWizard'
import Scorer from './components/Scorer'
import Settings from './components/Settings'
import IntakePage from './components/IntakePage'
import TermsPage from './components/TermsPage'
import PrivacyPage from './components/PrivacyPage'
import { useApi } from './hooks/useApi'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

function MaintenancePage({ message, eta }) {
  const [checking, setChecking] = useState(false)
  async function checkStatus() {
    setChecking(true)
    try {
      const res = await fetch(`${API_BASE}/health`)
      if (res.ok) { const d = await res.json(); if (d.status === 'ok') window.location.reload() }
    } catch {}
    setChecking(false)
  }
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/health`)
        if (res.ok) { const d = await res.json(); if (d.status === 'ok') window.location.reload() }
      } catch {}
    }, 60000)
    return () => clearInterval(interval)
  }, [])
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.5rem', padding: '2rem', background: '#0f172a', color: '#e2e8f0' }}>
      <div style={{ fontSize: 40 }}>🔧</div>
      <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>Scheduled Maintenance</h1>
      <p style={{ fontSize: 15, color: '#94a3b8', textAlign: 'center', maxWidth: 400, margin: 0, lineHeight: 1.6 }}>
        {message || 'FrankGrant is performing scheduled maintenance. Your work is saved and will be available shortly.'}
      </p>
      {eta && <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>Expected completion: {eta}</p>}
      <button onClick={checkStatus} disabled={checking} style={{ padding: '10px 24px', background: '#6366f1', border: 'none', borderRadius: 8, color: '#fff', cursor: checking ? 'not-allowed' : 'pointer', fontSize: 14, fontWeight: 500, opacity: checking ? 0.7 : 1 }}>
        {checking ? 'Checking…' : 'Check Status'}
      </button>
      <p style={{ fontSize: 12, color: '#475569', margin: 0 }}>Auto-checking every 60 seconds</p>
    </div>
  )
}

function AnthropicStatusBanner({ onDismiss }) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, background: '#451a03', borderBottom: '1px solid #92400e', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 12, zIndex: 9999, fontSize: 13, color: '#fde68a' }}>
      <span>⚠️</span>
      <span style={{ flex: 1 }}>AI generation is currently experiencing delays due to a third-party service issue. Your saved work is unaffected.</span>
      <button onClick={onDismiss} style={{ background: 'none', border: 'none', color: '#fde68a', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>×</button>
    </div>
  )
}

function AppRouter() {
  const { user } = useUser()
  const api = useApi()
  const [currentView, setCurrentView] = useState('dashboard')
  const [activeProject, setActiveProject] = useState(null)

  const userEmail = user?.emailAddresses?.[0]?.emailAddress || ''

  function handleNavigate(view) {
    setCurrentView(view)
  }

  function handleOpenProject(project) {
    setActiveProject(project)
    setCurrentView('editor')
  }

  async function handleSaveProject(data) {
    if (!activeProject) return
    try {
      await api.updateProject(activeProject.id, data)
      setActiveProject(prev => ({ ...prev, ...data }))
    } catch (e) { console.error('Save failed:', e) }
  }

  function handleBack() {
    setActiveProject(null)
    setCurrentView('dashboard')
  }

  function handleWizardComplete(project) {
    setActiveProject(project)
    setCurrentView('editor')
  }

  return (
    <AppShell
      currentView={currentView}
      onNavigate={handleNavigate}
      editorProject={activeProject}
      userEmail={userEmail}
      activeView={currentView}
      setActiveView={handleNavigate}
      activeProject={activeProject}
    >
      {currentView === 'editor' && activeProject ? (
        <GrantEditor
          project={activeProject}
          onSave={handleSaveProject}
          onBack={handleBack}
        />
      ) : currentView === 'wizard' ? (
        <GrantWizard
          onComplete={handleWizardComplete}
          onCancel={() => setCurrentView('dashboard')}
        />
      ) : currentView === 'biosketch' ? (
        <BiosketchGenerator onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'command' ? (
        <CommandStation onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'letters' ? (
        <LettersGenerator />
      ) : currentView === 'scorer' ? (
        <Scorer onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'settings' ? (
        <Settings onBack={() => setCurrentView('dashboard')} />
      ) : currentView === 'pipeline' ? (
        <Dashboard
          onOpenProject={handleOpenProject}
          onNewGrant={() => setCurrentView('wizard')}
          initialView="pipeline"
        />
      ) : (
        <Dashboard
          onOpenProject={handleOpenProject}
          onNewGrant={() => setCurrentView('wizard')}
          initialView="projects"
        />
      )}
    </AppShell>
  )
}

export default function App() {
  const [maintenanceData, setMaintenanceData] = useState(null)
  const [anthropicDegraded, setAnthropicDegraded] = useState(false)
  const [bannerDismissed, setBannerDismissed] = useState(false)
  const [bannerDismissedAt, setBannerDismissedAt] = useState(null)

  // Check if we're on the status page
  const isStatusPage = window.location.hash === '#/status' || window.location.hash.startsWith('#/status')

  // Check if we're on a shared grant page (public, no auth)
  const sharedMatch = window.location.hash.match(/^#\/shared\/([a-f0-9]+)$/)
  const sharedToken = sharedMatch?.[1] || null

  // Public pages (no auth required) — v6.0.0
  const isTermsPage = window.location.hash === '#/terms'
  const isPrivacyPage = window.location.hash === '#/privacy'
  const isHirePage = window.location.hash === '#/hire' || window.location.hash.startsWith('#/hire')

  useEffect(() => {
    if (isStatusPage || sharedToken) return
    async function checkHealth() {
      try {
        const res = await fetch(`${API_BASE}/health`)
        if (res.status === 503) {
          const data = await res.json()
          if (data.error === 'maintenance') setMaintenanceData(data)
        } else {
          setMaintenanceData(null)
        }
      } catch {}
    }
    async function checkAnthropicStatus() {
      try {
        const res = await fetch(`${API_BASE}/status/anthropic`)
        if (res.ok) {
          const data = await res.json()
          const degraded = data.indicator && data.indicator !== 'none' && data.indicator !== 'operational'
          setAnthropicDegraded(degraded)
        }
      } catch {}
    }
    checkHealth()
    checkAnthropicStatus()
    const healthInterval = setInterval(checkHealth, 60000)
    const anthropicInterval = setInterval(checkAnthropicStatus, 5 * 60 * 1000)
    return () => { clearInterval(healthInterval); clearInterval(anthropicInterval) }
  }, [isStatusPage])

  // Re-show banner every 10 minutes if still down
  useEffect(() => {
    if (!bannerDismissedAt) return
    const timer = setTimeout(() => {
      if (anthropicDegraded) setBannerDismissed(false)
    }, 10 * 60 * 1000)
    return () => clearTimeout(timer)
  }, [bannerDismissedAt, anthropicDegraded])

  if (isStatusPage) return <StatusPage />
  if (sharedToken) return <SharedGrantView token={sharedToken} />
  if (isTermsPage) return <TermsPage />
  if (isPrivacyPage) return <PrivacyPage />
  if (isHirePage) return <IntakePage />

  if (maintenanceData) {
    return <MaintenancePage message={maintenanceData.message} eta={maintenanceData.eta} />
  }

  return (
    <ErrorBoundary>
      {anthropicDegraded && !bannerDismissed && (
        <AnthropicStatusBanner onDismiss={() => { setBannerDismissed(true); setBannerDismissedAt(Date.now()) }} />
      )}
      <SignedOut>
        {/* Nav bar */}
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, height: 56, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 30, height: 30, borderRadius: 8, background: '#0e7490', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '-0.5px' }}>FG</div>
            <span style={{ color: '#f1f5f9', fontWeight: 700, fontSize: 15, letterSpacing: '-0.3px' }}>FrankGrant</span>
          </div>
          <SignInButton mode="modal">
            <button style={{ padding: '7px 18px', background: '#0e7490', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, letterSpacing: '0.01em' }}>
              Sign In
            </button>
          </SignInButton>
        </div>

        {/* Hero */}
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px 48px', background: 'linear-gradient(160deg, #f8fafc 0%, #e0f2fe 100%)' }}>
          <div style={{ maxWidth: 560, width: '100%', textAlign: 'center' }}>
            {/* Badge */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 12px', background: 'rgba(14,116,144,0.1)', border: '1px solid rgba(14,116,144,0.2)', borderRadius: 20, marginBottom: 28 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#0e7490' }} />
              <span style={{ fontSize: 12, fontWeight: 500, color: '#0e7490', letterSpacing: '0.02em' }}>NIH Grant Studio</span>
            </div>

            <h1 style={{ fontSize: 'clamp(32px, 6vw, 52px)', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, letterSpacing: '-1.5px', marginBottom: 20 }}>
              Write NIH grants<br />
              <span style={{ color: '#0e7490' }}>that get funded.</span>
            </h1>

            <p style={{ fontSize: 17, color: '#475569', lineHeight: 1.65, marginBottom: 36, maxWidth: 440, margin: '0 auto 36px' }}>
              AI-powered grant writing, peer review simulation, and scoring — purpose-built for NIH mechanisms.
            </p>

            <SignInButton mode="modal">
              <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '14px 32px', background: '#0f172a', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontSize: 15, fontWeight: 600, letterSpacing: '-0.2px', boxShadow: '0 4px 14px rgba(15,23,42,0.25)' }}
                onMouseOver={e => e.currentTarget.style.background = '#1e293b'}
                onMouseOut={e => e.currentTarget.style.background = '#0f172a'}
              >
                Get Started
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
              </button>
            </SignInButton>

            {/* Features row */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 24, marginTop: 40, flexWrap: 'wrap' }}>
              {[
                ['Section Writer', 'AI drafts each NIH section'],
                ['Peer Review Sim', 'Study section + PD critique'],
                ['Grant Scorer', 'Criterion-level 1–9 scoring'],
              ].map(([label, desc]) => (
                <div key={label} style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>{desc}</div>
                </div>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 11, color: '#cbd5e1', marginTop: 48 }}>
            COARE Holdings · <a href="/#/terms" style={{ color: '#94a3b8', textDecoration: 'underline' }}>Terms</a> · <a href="/#/privacy" style={{ color: '#94a3b8', textDecoration: 'underline' }}>Privacy</a>
          </p>
        </div>
      </SignedOut>
      <SignedIn>
        <div style={{ marginTop: anthropicDegraded && !bannerDismissed ? 44 : 0 }}>
          <AppRouter />
          <FeedbackButton />
        </div>
      </SignedIn>
    </ErrorBoundary>
  )
}
