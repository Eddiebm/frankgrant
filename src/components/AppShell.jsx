import { useState, useEffect } from 'react'
import { useUser, SignOutButton, SignInButton } from '@clerk/clerk-react'

const ADMIN_EMAILS = ['eddieb@coareholdings.com', 'eddie@bannermanmenson.com']

// ── Icons ────────────────────────────────────────────────────────────────────
const Ic = ({ children, size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0 }}>
    {children}
  </svg>
)

const Icons = {
  grants:   () => <Ic><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Ic>,
  new:      () => <Ic><path d="M12 5v14M5 12h14"/></Ic>,
  letters:  () => <Ic><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></Ic>,
  bio:      () => <Ic><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></Ic>,
  scorer:   () => <Ic><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></Ic>,
  pipeline: () => <Ic><path d="M3 3h6v6H3zM15 3h6v6h-6zM3 15h6v6H3z"/><path d="M18 9v3m0 0v3m0-3h3m-3 0h-3"/></Ic>,
  settings: () => <Ic><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></Ic>,
  command:  () => <Ic><path d="m13 2-2 2.5h3L12 7"/><path d="M10 14v-3m4 3v-3"/><path d="M5 7h14a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z"/></Ic>,
  chevL:    () => <Ic><path d="m15 18-6-6 6-6"/></Ic>,
  chevR:    () => <Ic><path d="m9 18 6-6-6-6"/></Ic>,
  signout:  () => <Ic><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ic>,
  menu:     () => <Ic size={20}><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></Ic>,
  x:        () => <Ic size={20}><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></Ic>,
}

const NAV_MAIN = [
  { id: 'projects',  label: 'My Grants',  Icon: Icons.grants  },
  { id: 'wizard',    label: 'New Grant',  Icon: Icons.new     },
  { id: 'letters',   label: 'Letters',    Icon: Icons.letters  },
  { id: 'biosketch', label: 'Biosketch',  Icon: Icons.bio     },
  { id: 'scorer',    label: 'Scorer',     Icon: Icons.scorer  },
]
const NAV_PIPELINE = { id: 'pipeline', label: 'Pipeline', Icon: Icons.pipeline }
const NAV_SETTINGS = { id: 'settings', label: 'Settings', Icon: Icons.settings }

const MOBILE_TABS = [
  { id: 'projects',  label: 'Grants',    Icon: Icons.grants   },
  { id: 'wizard',    label: 'New',       Icon: Icons.new      },
  { id: 'letters',   label: 'Letters',   Icon: Icons.letters  },
  { id: 'pipeline',  label: 'Pipeline',  Icon: Icons.pipeline },
  { id: 'more',      label: 'More',      Icon: Icons.menu     },
]

export default function AppShell({ activeView, setActiveView, activeProject, children }) {
  const { user } = useUser()
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true')
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768)

  const email = user?.emailAddresses?.[0]?.emailAddress || ''
  const isAdmin = ADMIN_EMAILS.includes(email)
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email
  const initials = (user?.firstName?.[0] || email[0] || '?').toUpperCase()

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  useEffect(() => { localStorage.setItem('sidebar_collapsed', collapsed) }, [collapsed])
  useEffect(() => { if (activeView === 'editor') setCollapsed(true) }, [activeView])

  useEffect(() => {
    if (!showUserMenu) return
    const close = () => setShowUserMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showUserMenu])

  const activeNavId = activeView === 'editor' ? 'projects' : activeView
  const W = collapsed ? 56 : 228

  function NavItem({ item, danger = false }) {
    const isActive = activeNavId === item.id
    return (
      <button
        onClick={() => { setActiveView(item.id); setShowMoreSheet(false) }}
        title={collapsed ? item.label : undefined}
        style={{
          display: 'flex', alignItems: 'center', gap: 10,
          width: '100%', padding: collapsed ? '10px 0' : '9px 14px',
          justifyContent: collapsed ? 'center' : 'flex-start',
          border: 'none', background: isActive ? 'var(--sidebar-active)' : 'transparent',
          borderRadius: 8, margin: '1px 6px',
          color: isActive ? '#e2f8fd' : danger ? '#f87171' : 'var(--sidebar-text)',
          fontSize: 13, fontWeight: isActive ? 600 : 400,
          cursor: 'pointer', transition: 'background 0.12s, color 0.12s',
          position: 'relative',
        }}
        onMouseOver={e => { if (!isActive) e.currentTarget.style.background = 'var(--sidebar-hover)'; e.currentTarget.style.color = isActive ? '#e2f8fd' : danger ? '#f87171' : '#e2e8f0' }}
        onMouseOut={e => { e.currentTarget.style.background = isActive ? 'var(--sidebar-active)' : 'transparent'; e.currentTarget.style.color = isActive ? '#e2f8fd' : danger ? '#f87171' : 'var(--sidebar-text)' }}
      >
        {isActive && !collapsed && (
          <span style={{ position: 'absolute', left: 0, top: '50%', transform: 'translateY(-50%)', width: 3, height: 18, background: 'var(--teal)', borderRadius: '0 2px 2px 0', marginLeft: -14 }} />
        )}
        <item.Icon />
        {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
      </button>
    )
  }

  // ── MOBILE ──────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--page-bg)' }}>
        {/* Mobile header */}
        <div style={{ height: 52, background: 'var(--sidebar-bg)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '-0.5px' }}>FG</div>
            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 15 }}>FrankGrant</span>
          </div>
          {user && (
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>{initials}</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 56 }}>
          {children}
        </div>

        {/* Bottom tab bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 56, background: '#fff', borderTop: '1px solid var(--border)', display: 'flex', zIndex: 100 }}>
          {MOBILE_TABS.map(tab => {
            const isActive = tab.id !== 'more' && activeNavId === tab.id
            return (
              <button key={tab.id}
                onClick={() => tab.id === 'more' ? setShowMoreSheet(true) : setActiveView(tab.id)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: isActive ? 'var(--teal)' : '#94a3b8', fontSize: 10, fontWeight: isActive ? 600 : 400, padding: '6px 0' }}
              >
                <tab.Icon />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* More bottom sheet */}
        {showMoreSheet && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }} onClick={() => setShowMoreSheet(false)}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', paddingBottom: 32 }} onClick={e => e.stopPropagation()}>
              <div style={{ width: 36, height: 4, background: '#e2e8f0', borderRadius: 2, margin: '12px auto 8px' }} />
              {/* User info */}
              {user && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px 8px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{initials}</div>
                  <div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div><div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{email}</div></div>
                </div>
              )}
              {[
                { id: 'biosketch', label: 'Biosketch',       Icon: Icons.bio      },
                { id: 'scorer',   label: 'Scorer',           Icon: Icons.scorer   },
                { id: 'settings', label: 'Settings',         Icon: Icons.settings },
                ...(isAdmin ? [{ id: 'command', label: 'Command Station', Icon: Icons.command }] : []),
              ].map(item => (
                <button key={item.id} onClick={() => { setActiveView(item.id); setShowMoreSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: item.id === 'command' ? '#ef4444' : 'var(--text-primary)', textAlign: 'left' }}>
                  <item.Icon />
                  {item.label}
                </button>
              ))}
              {!user && (
                <SignInButton mode="modal">
                  <button style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: 'var(--teal)', fontWeight: 600 }}>
                    Sign In
                  </button>
                </SignInButton>
              )}
              {user && (
                <>
                  <div style={{ height: 1, background: 'var(--border)', margin: '4px 0' }} />
                  <SignOutButton>
                    <button style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: '#ef4444' }}>
                      <Icons.signout /> Sign Out
                    </button>
                  </SignOutButton>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── DESKTOP ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden', background: 'var(--page-bg)' }}>

      {/* ── Sidebar ───────────────────────────────────────────────────────── */}
      <div style={{
        width: W, flexShrink: 0, background: 'var(--sidebar-bg)',
        display: 'flex', flexDirection: 'column',
        transition: 'width 0.15s ease', overflow: 'hidden',
        position: 'relative', zIndex: 10,
      }}>
        {/* Logo */}
        <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '0' : '0 16px', justifyContent: collapsed ? 'center' : 'flex-start', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 13, letterSpacing: '-0.5px', flexShrink: 0 }}>FG</div>
          {!collapsed && <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>FrankGrant</span>}
        </div>

        {/* Main nav */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
          {NAV_MAIN.map(item => <NavItem key={item.id} item={item} />)}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 14px' }} />
          <NavItem item={NAV_PIPELINE} />
        </div>

        {/* Bottom section */}
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 0 4px' }}>
          <NavItem item={NAV_SETTINGS} />
          {isAdmin && <NavItem item={{ id: 'command', label: 'Command Station', Icon: Icons.command }} danger />}

          {/* Sign In (unauthenticated) */}
          {!user && (
            <div style={{ padding: '6px 8px' }}>
              <SignInButton mode="modal">
                <button style={{ width: '100%', padding: '9px', background: 'var(--teal)', border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {collapsed ? '→' : 'Sign In'}
                </button>
              </SignInButton>
            </div>
          )}

          {/* User row */}
          {user && (
            <div style={{ position: 'relative', padding: '4px 8px' }}>
              <button
                onMouseDown={e => { e.stopPropagation(); setShowUserMenu(v => !v) }}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px', border: 'none', background: 'none', cursor: 'pointer', borderRadius: 8, justifyContent: collapsed ? 'center' : 'flex-start' }}
                onMouseOver={e => e.currentTarget.style.background = 'var(--sidebar-hover)'}
                onMouseOut={e => e.currentTarget.style.background = 'none'}
              >
                <div style={{ width: 27, height: 27, borderRadius: '50%', background: 'var(--teal)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials}</div>
                {!collapsed && <span style={{ fontSize: 12, color: 'var(--sidebar-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>{name || email}</span>}
              </button>

              {showUserMenu && (
                <div onMouseDown={e => e.stopPropagation()}
                  style={{ position: 'absolute', bottom: '110%', left: 8, right: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 10, boxShadow: 'var(--shadow-lg)', overflow: 'hidden', zIndex: 300 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 1 }}>{name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
                  </div>
                  <SignOutButton>
                    <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444', fontWeight: 500 }}>
                      <Icons.signout /> Sign out
                    </button>
                  </SignOutButton>
                </div>
              )}
            </div>
          )}

          {/* Collapse toggle */}
          <button onClick={() => setCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '6px', border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', marginBottom: 2 }}
            onMouseOver={e => e.currentTarget.style.color = 'rgba(255,255,255,0.5)'}
            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,255,255,0.2)'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <Icons.chevR /> : <Icons.chevL />}
          </button>
        </div>
      </div>

      {/* ── Main content ──────────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>

        {/* Top bar */}
        {activeView !== 'editor' && (
          <div style={{ height: 48, background: 'var(--surface)', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
            <PageTitle activeView={activeView} activeProject={activeProject} onNavigate={setActiveView} />
            {!user && (
              <SignInButton mode="modal">
                <button style={{ padding: '6px 16px', background: 'var(--teal)', border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Sign In</button>
              </SignInButton>
            )}
          </div>
        )}

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

function PageTitle({ activeView, activeProject, onNavigate }) {
  const titles = {
    projects:  'My Grants',
    wizard:    'New Grant',
    letters:   'Letters',
    biosketch: 'Biosketch',
    scorer:    'Scorer',
    pipeline:  'Pipeline',
    settings:  'Settings',
    command:   'Command Station',
    editor:    'Editor',
    dashboard: 'My Grants',
  }

  if (activeView === 'editor' && activeProject) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
        <span style={{ cursor: 'pointer', color: 'var(--teal)' }} onClick={() => onNavigate('projects')}>My Grants</span>
        <span style={{ color: 'var(--text-muted)' }}>›</span>
        <span style={{ color: 'var(--text-primary)', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{activeProject.title || 'Untitled'}</span>
      </div>
    )
  }

  return <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}>{titles[activeView] || 'FrankGrant'}</h1>
}
