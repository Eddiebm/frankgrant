import { useState, useEffect } from 'react'
import { useUser, SignOutButton, SignInButton } from '@clerk/clerk-react'

const ADMIN_EMAILS = ['eddieb@coareholdings.com', 'eddie@bannermanmenson.com']
const TEAL = '#0e7490'
const TEAL_BG = '#f0f9ff'

const NAV_MAIN = [
  { id: 'projects', label: 'My Grants', icon: '📋' },
  { id: 'wizard',   label: 'New Grant', icon: '✍️' },
  { id: 'letters',  label: 'Letters',   icon: '📝' },
  { id: 'biosketch',label: 'Biosketch', icon: '👤' },
  { id: 'scorer',   label: 'Scorer',    icon: '🎯' },
]
const NAV_PIPELINE = { id: 'pipeline', label: 'Pipeline', icon: '📊' }
const NAV_BOTTOM = (isAdmin) => [
  { id: 'settings', label: 'Settings', icon: '⚙️' },
  ...(isAdmin ? [{ id: 'command', label: 'Command Station', icon: '⚡', red: true }] : []),
]
const MOBILE_TABS = [
  { id: 'projects', label: 'Grants',   icon: '📋' },
  { id: 'wizard',   label: 'New',      icon: '✍️' },
  { id: 'letters',  label: 'Letters',  icon: '📝' },
  { id: 'pipeline', label: 'Pipeline', icon: '📊' },
  { id: 'more',     label: 'More',     icon: '⋯' },
]

const BREADCRUMBS = {
  projects:  ['My Grants'],
  wizard:    ['My Grants', 'New Grant'],
  letters:   ['Letters'],
  biosketch: ['Biosketch'],
  pipeline:  ['Pipeline'],
  command:   ['Command Station'],
  settings:  ['Settings'],
  scorer:    ['Scorer'],
  editor:    ['My Grants', 'Editor'],
}

export default function AppShell({ activeView, setActiveView, activeProject, children }) {
  const { user } = useUser()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  const email = user?.emailAddresses?.[0]?.emailAddress || ''
  const isAdmin = ADMIN_EMAILS.includes(email)
  const initials = (user?.firstName?.[0] || email[0] || '?').toUpperCase()

  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', collapsed)
  }, [collapsed])

  // Auto-collapse sidebar in editor to maximise space
  useEffect(() => {
    if (activeView === 'editor') setCollapsed(true)
  }, [activeView])

  const activeNavId = activeView === 'editor' ? 'projects'
    : activeView === 'pipeline' ? 'pipeline'
    : activeView

  const sidebarWidth = collapsed ? 48 : 220

  // Close user menu on outside click
  useEffect(() => {
    if (!showUserMenu) return
    const close = () => setShowUserMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showUserMenu])

  function NavBtn({ item }) {
    const isActive = activeNavId === item.id
    return (
      <button
        onClick={() => { setActiveView(item.id); setShowMoreSheet(false) }}
        title={collapsed ? item.label : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '10px 12px', border: 'none', cursor: 'pointer',
          background: isActive ? TEAL_BG : 'transparent',
          borderLeft: `3px solid ${isActive ? TEAL : 'transparent'}`,
          borderRadius: '0 6px 6px 0',
          color: isActive ? TEAL : item.red ? '#dc2626' : '#374151',
          fontSize: 13, fontWeight: isActive ? 600 : 400,
          textAlign: 'left', minHeight: 40, transition: 'background 0.1s',
        }}
      >
        <span style={{ fontSize: 16, flexShrink: 0, width: 20, textAlign: 'center' }}>{item.icon}</span>
        {!collapsed && (
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
        )}
      </button>
    )
  }

  function Breadcrumb() {
    const crumbs = BREADCRUMBS[activeView] || ['My Grants']
    const fullCrumbs = ['Home', ...crumbs]
    const displayCrumbs = isMobile ? fullCrumbs.slice(-2) : fullCrumbs
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 16px', fontSize: 11, color: '#9ca3af', background: '#f9fafb', borderBottom: '0.5px solid #f1f5f9' }}>
        {displayCrumbs.map((crumb, i) => (
          <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {i > 0 && <span style={{ color: '#d1d5db' }}>›</span>}
            <span
              style={{ cursor: i < displayCrumbs.length - 1 ? 'pointer' : 'default', color: i < displayCrumbs.length - 1 ? TEAL : '#374151', fontWeight: i === displayCrumbs.length - 1 ? 500 : 400 }}
              onClick={() => {
                if (i === 0) setActiveView('projects')
                else if (crumb === 'My Grants') setActiveView('projects')
              }}
            >
              {crumb === 'Editor' && activeProject ? (activeProject.title || 'Untitled').slice(0, 30) : crumb}
            </span>
          </span>
        ))}
      </div>
    )
  }

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 56 }}>
          {children}
        </div>

        {/* Bottom tab bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 56, background: '#fff', borderTop: '0.5px solid #e5e7eb', display: 'flex', zIndex: 100, boxShadow: '0 -2px 8px rgba(0,0,0,0.06)' }}>
          {MOBILE_TABS.map(tab => {
            const isActive = tab.id !== 'more' && activeNavId === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => tab.id === 'more' ? setShowMoreSheet(true) : setActiveView(tab.id)}
                style={{
                  flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  gap: 2, background: 'none', border: 'none', cursor: 'pointer', position: 'relative',
                  color: isActive ? TEAL : '#6b7280', fontSize: 10, fontWeight: isActive ? 600 : 400,
                  minHeight: 44, padding: '4px 0',
                }}
              >
                <span style={{ fontSize: 18 }}>{tab.icon}</span>
                <span>{tab.label}</span>
                {isActive && (
                  <div style={{ position: 'absolute', bottom: 2, width: 20, height: 2, background: TEAL, borderRadius: 1 }} />
                )}
              </button>
            )
          })}
        </div>

        {/* More bottom sheet */}
        {showMoreSheet && (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }}
            onClick={() => setShowMoreSheet(false)}
          >
            <div
              style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', padding: '16px 0 40px' }}
              onClick={e => e.stopPropagation()}
            >
              <div style={{ width: 40, height: 4, background: '#e5e7eb', borderRadius: 2, margin: '0 auto 16px' }} />
              {[
                { id: 'biosketch', label: 'Biosketch', icon: '👤' },
                { id: 'scorer',   label: 'Scorer',    icon: '🎯' },
                { id: 'settings', label: 'Settings', icon: '⚙️' },
                ...(isAdmin ? [{ id: 'command', label: 'Command Station', icon: '⚡' }] : []),
              ].map(item => (
                <button
                  key={item.id}
                  onClick={() => { setActiveView(item.id); setShowMoreSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '14px 24px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#111', textAlign: 'left', minHeight: 44 }}
                >
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
              <div style={{ borderTop: '0.5px solid #e5e7eb', margin: '8px 0' }} />
              {!user && (
                <SignInButton mode="modal">
                  <button style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '14px 24px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#0e7490', textAlign: 'left', minHeight: 44, fontWeight: 600 }}>
                    <span style={{ fontSize: 20 }}>🔑</span>
                    Sign In
                  </button>
                </SignInButton>
              )}
              {user && (
                <SignOutButton>
                  <button style={{ display: 'flex', alignItems: 'center', gap: 16, width: '100%', padding: '14px 24px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#dc2626', textAlign: 'left', minHeight: 44 }}>
                    <span style={{ fontSize: 20 }}>🚪</span>
                    Sign Out
                  </button>
                </SignOutButton>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{
        width: sidebarWidth, flexShrink: 0, background: '#fff', borderRight: '0.5px solid #e5e7eb',
        display: 'flex', flexDirection: 'column', transition: 'width 0.15s ease', overflow: 'hidden',
        position: 'relative', zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ padding: '12px', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '0.5px solid #f1f5f9', minHeight: 52, flexShrink: 0 }}>
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>F</div>
          {!collapsed && <span style={{ fontSize: 15, fontWeight: 600, color: '#111', whiteSpace: 'nowrap' }}>FrankGrant</span>}
        </div>

        {/* Nav */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', paddingTop: 6 }}>
          {NAV_MAIN.map(item => <NavBtn key={item.id} item={item} />)}
          <div style={{ height: 0.5, background: '#f1f5f9', margin: '6px 0 6px 3px' }} />
          <NavBtn item={NAV_PIPELINE} />
          <div style={{ height: 0.5, background: '#f1f5f9', margin: '6px 0 6px 3px' }} />
        </div>

        {/* Bottom: settings, command, user */}
        <div style={{ flexShrink: 0, borderTop: '0.5px solid #f1f5f9', paddingBottom: 4 }}>
          {NAV_BOTTOM(isAdmin).map(item => <NavBtn key={item.id} item={item} />)}

          {/* Sign In — shown when not authenticated */}
          {!user && (
            <div style={{ padding: '8px 8px 0' }}>
              <SignInButton mode="modal">
                <button style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'center', gap: 8, width: '100%', padding: '10px 12px', border: 'none', borderRadius: 8, background: '#0e7490', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <span style={{ fontSize: 15, flexShrink: 0 }}>🔑</span>
                  {!collapsed && <span>Sign In</span>}
                </button>
              </SignInButton>
            </div>
          )}

          {/* User row */}
          <div style={{ position: 'relative', padding: '4px 8px 0' }}>
            <button
              onMouseDown={e => { e.stopPropagation(); setShowUserMenu(v => !v) }}
              style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '8px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: 6, minHeight: 40 }}
            >
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#374151', flexShrink: 0 }}>
                {initials}
              </div>
              {!collapsed && <span style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>{email}</span>}
            </button>

            {showUserMenu && (
              <div
                onMouseDown={e => e.stopPropagation()}
                style={{ position: 'absolute', bottom: '110%', left: 8, right: 8, background: '#fff', border: '0.5px solid #e5e7eb', borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.1)', overflow: 'hidden', zIndex: 300 }}
              >
                <div style={{ padding: '8px 12px', fontSize: 11, color: '#9ca3af', borderBottom: '0.5px solid #f1f5f9', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{email}</div>
                <SignOutButton>
                  <button style={{ display: 'block', width: '100%', padding: '10px 12px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, textAlign: 'left', color: '#dc2626' }}>
                    Sign out
                  </button>
                </SignOutButton>
              </div>
            )}
          </div>

          {/* Footer links */}
          {!collapsed && (
            <div style={{ padding: '8px 12px', fontSize: 11, color: '#9ca3af', borderTop: '1px solid #f3f4f6', textAlign: 'center' }}>
              © 2026 FrankGrant ·{' '}
              <a href="/#/terms" style={{ color: '#0e7490', textDecoration: 'none' }}>Terms</a> ·{' '}
              <a href="/#/privacy" style={{ color: '#0e7490', textDecoration: 'none' }}>Privacy</a>
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: collapsed ? 'center' : 'flex-end', width: '100%', padding: '4px 14px 8px', border: 'none', background: 'none', cursor: 'pointer', color: '#d1d5db', fontSize: 18, lineHeight: 1 }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? '›' : '‹'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        {/* Top bar: breadcrumb + sign-in button when unauthenticated */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {activeView !== 'editor' && <Breadcrumb />}
          {activeView === 'editor' && <div />}
          {!user && (
            <div style={{ padding: '4px 16px', flexShrink: 0 }}>
              <SignInButton mode="modal">
                <button style={{ padding: '6px 18px', background: '#0e7490', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600, boxShadow: '0 2px 6px rgba(14,116,144,0.3)' }}>
                  Sign In
                </button>
              </SignInButton>
            </div>
          )}
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}
