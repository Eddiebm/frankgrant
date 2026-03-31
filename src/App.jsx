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
        {/* Always-visible top-right Sign In button */}
        <div style={{ position: 'fixed', top: 16, right: 16, zIndex: 1000 }}>
          <SignInButton mode="modal">
            <button style={{ padding: '8px 20px', background: '#0e7490', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 500, boxShadow: '0 2px 8px rgba(14,116,144,0.3)' }}>
              Sign In
            </button>
          </SignInButton>
        </div>

        {/* Centered landing page */}
        <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1.25rem', padding: '2rem', marginTop: anthropicDegraded && !bannerDismissed ? 44 : 0 }}>
          {/* Logo */}
          <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#0e7490', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 32, boxShadow: '0 4px 20px rgba(14,116,144,0.35)', marginBottom: 8 }}>
            F
          </div>

          <h1 style={{ fontSize: 32, fontWeight: 700, margin: 0, color: '#111827', letterSpacing: '-0.5px' }}>
            Welcome to FrankGrant
          </h1>

          <p style={{ fontSize: 16, color: '#6b7280', margin: 0 }}>
            AI-powered NIH grant writing
          </p>

          <SignInButton mode="modal">
            <button style={{ marginTop: 12, padding: '14px 40px', background: '#0e7490', border: 'none', borderRadius: 10, color: '#fff', cursor: 'pointer', fontSize: 17, fontWeight: 600, boxShadow: '0 4px 16px rgba(14,116,144,0.4)', transition: 'opacity 0.15s' }}
              onMouseOver={e => e.currentTarget.style.opacity = '0.9'}
              onMouseOut={e => e.currentTarget.style.opacity = '1'}
            >
              Sign In
            </button>
          </SignInButton>

          <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>
            NIH grant writing &amp; scoring · COARE Holdings
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
