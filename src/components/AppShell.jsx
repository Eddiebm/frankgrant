import { useState, useEffect } from 'react'
import { useUser, SignOutButton, SignInButton } from '@clerk/clerk-react'

const ADMIN_EMAILS = ['eddieb@coareholdings.com', 'eddie@bannermanmenson.com']

const SB = '#0f172a'        // sidebar bg
const SB_ACTIVE = 'rgba(14,116,144,0.2)'
const SB_HOVER  = 'rgba(255,255,255,0.06)'
const SB_TEXT   = '#94a3b8'
const SB_ACTIVE_TEXT = '#e2f8fd'
const TEAL = '#0e7490'

// ── SVG Icons ────────────────────────────────────────────────────────────────
const Ic = ({ children, s = 16 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {children}
  </svg>
)

export const Icons = {
  Grants:   () => <Ic><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></Ic>,
  New:      () => <Ic><path d="M12 5v14M5 12h14"/></Ic>,
  Letters:  () => <Ic><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></Ic>,
  Bio:      () => <Ic><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></Ic>,
  Scorer:   () => <Ic><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></Ic>,
  Pipeline: () => <Ic><rect x="3" y="3" width="5" height="18" rx="1"/><rect x="10" y="8" width="5" height="13" rx="1"/><rect x="17" y="5" width="5" height="16" rx="1"/></Ic>,
  Settings: () => <Ic><circle cx="12" cy="12" r="3"/><path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83"/></Ic>,
  Command:  () => <Ic><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></Ic>,
  SignOut:  () => <Ic><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></Ic>,
  ChevL:    () => <Ic><path d="m15 18-6-6 6-6"/></Ic>,
  ChevR:    () => <Ic><path d="m9 18 6-6-6-6"/></Ic>,
}

const NAV_ITEMS = [
  { id: 'projects',  label: 'My Grants', Icon: Icons.Grants   },
  { id: 'wizard',    label: 'New Grant', Icon: Icons.New      },
  { id: 'letters',   label: 'Letters',   Icon: Icons.Letters  },
  { id: 'biosketch', label: 'Biosketch', Icon: Icons.Bio      },
  { id: 'scorer',    label: 'Scorer',    Icon: Icons.Scorer   },
]
const PIPELINE_ITEM  = { id: 'pipeline', label: 'Pipeline', Icon: Icons.Pipeline }
const SETTINGS_ITEM  = { id: 'settings', label: 'Settings', Icon: Icons.Settings }
const COMMAND_ITEM   = { id: 'command',  label: 'Command',  Icon: Icons.Command  }

const MOBILE_TABS = [
  { id: 'projects',  label: 'Grants',   Icon: Icons.Grants   },
  { id: 'wizard',    label: 'New',      Icon: Icons.New      },
  { id: 'letters',   label: 'Letters',  Icon: Icons.Letters  },
  { id: 'pipeline',  label: 'Pipeline', Icon: Icons.Pipeline },
  { id: 'more',      label: 'More',     Icon: Icons.Settings },
]

const PAGE_TITLES = {
  projects: 'My Grants', wizard: 'New Grant', letters: 'Letters',
  biosketch: 'Biosketch', scorer: 'Scorer', pipeline: 'Pipeline',
  settings: 'Settings', command: 'Command Station', dashboard: 'My Grants',
}

// ── NavItem — module-level component (NOT inside AppShell) ───────────────────
function NavItem({ item, isActive, collapsed, onNavigate, danger }) {
  const [hovered, setHovered] = useState(false)
  const bg = isActive ? SB_ACTIVE : hovered ? SB_HOVER : 'transparent'
  const color = isActive ? SB_ACTIVE_TEXT : danger ? '#f87171' : hovered ? '#e2e8f0' : SB_TEXT

  return (
    <button
      onClick={() => onNavigate(item.id)}
      title={collapsed ? item.label : undefined}
      style={{
        display: 'flex', alignItems: 'center',
        gap: collapsed ? 0 : 10,
        justifyContent: collapsed ? 'center' : 'flex-start',
        width: 'calc(100% - 12px)', margin: '1px 6px',
        padding: collapsed ? '10px 0' : '9px 12px',
        border: 'none', borderRadius: 8,
        background: bg, color, fontSize: 13,
        fontWeight: isActive ? 600 : 400,
        cursor: 'pointer', transition: 'background 0.1s, color 0.1s',
        position: 'relative',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {isActive && !collapsed && (
        <span style={{ position: 'absolute', left: -6, top: '50%', transform: 'translateY(-50%)', width: 3, height: 16, background: TEAL, borderRadius: 2 }} />
      )}
      <item.Icon />
      {!collapsed && <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>}
    </button>
  )
}

// ── AppShell ─────────────────────────────────────────────────────────────────
export default function AppShell({ activeView, setActiveView, activeProject, children }) {
  const { user } = useUser()
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true' } catch { return false }
  })
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showMoreSheet, setShowMoreSheet] = useState(false)
  const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768)

  const email = user?.emailAddresses?.[0]?.emailAddress || ''
  const isAdmin = ADMIN_EMAILS.includes(email)
  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || email
  const initials = user?.firstName?.[0] || email?.[0] || '?'

  const activeNavId = activeView === 'editor' ? 'projects' : activeView
  const W = collapsed ? 56 : 228

  useEffect(() => {
    const h = () => setIsMobile(window.innerWidth < 768)
    window.addEventListener('resize', h)
    return () => window.removeEventListener('resize', h)
  }, [])

  useEffect(() => {
    try { localStorage.setItem('sidebar_collapsed', String(collapsed)) } catch {}
  }, [collapsed])

  useEffect(() => {
    if (activeView === 'editor') setCollapsed(true)
  }, [activeView])

  useEffect(() => {
    if (!showUserMenu) return
    const close = () => setShowUserMenu(false)
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showUserMenu])

  // ── MOBILE ─────────────────────────────────────────────────────────────────
  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        {/* Mobile header */}
        <div style={{ height: 52, background: SB, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 16px', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 7, background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>FG</div>
            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: 15 }}>FrankGrant</span>
          </div>
          {user && (
            <div style={{ width: 30, height: 30, borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12 }}>{initials.toUpperCase()}</div>
          )}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', paddingBottom: 56, background: '#f8fafc' }}>
          {children}
        </div>

        {/* Bottom tab bar */}
        <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, height: 56, background: '#ffffff', borderTop: '1px solid #e2e8f0', display: 'flex', zIndex: 100 }}>
          {MOBILE_TABS.map(tab => {
            const isActive = tab.id !== 'more' && activeNavId === tab.id
            return (
              <button key={tab.id}
                onClick={() => tab.id === 'more' ? setShowMoreSheet(true) : setActiveView(tab.id)}
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 3, background: 'none', border: 'none', cursor: 'pointer', color: isActive ? TEAL : '#94a3b8', fontSize: 10, fontWeight: isActive ? 600 : 400 }}
              >
                <tab.Icon />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>

        {/* More sheet */}
        {showMoreSheet && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 200 }} onClick={() => setShowMoreSheet(false)}>
            <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, background: '#fff', borderRadius: '16px 16px 0 0', paddingBottom: 32 }} onClick={e => e.stopPropagation()}>
              <div style={{ width: 36, height: 4, background: '#e2e8f0', borderRadius: 2, margin: '12px auto 8px' }} />
              {user && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 20px 10px', borderBottom: '1px solid #f1f5f9', marginBottom: 4 }}>
                  <div style={{ width: 36, height: 36, borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 14, flexShrink: 0 }}>{initials.toUpperCase()}</div>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{name}</div>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>{email}</div>
                  </div>
                </div>
              )}
              {[
                { id: 'biosketch', label: 'Biosketch',       Icon: Icons.Bio      },
                { id: 'scorer',    label: 'Scorer',          Icon: Icons.Scorer   },
                { id: 'settings',  label: 'Settings',        Icon: Icons.Settings },
                ...(isAdmin ? [{ id: 'command', label: 'Command', Icon: Icons.Command }] : []),
              ].map(item => (
                <button key={item.id}
                  onClick={() => { setActiveView(item.id); setShowMoreSheet(false) }}
                  style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: item.id === 'command' ? '#ef4444' : '#0f172a' }}>
                  <item.Icon />
                  {item.label}
                </button>
              ))}
              <div style={{ height: 1, background: '#f1f5f9', margin: '4px 0' }} />
              {!user
                ? <SignInButton mode="modal"><button style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: TEAL, fontWeight: 600 }}>Sign In</button></SignInButton>
                : <SignOutButton><button style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', padding: '13px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 15, color: '#ef4444' }}><Icons.SignOut /> Sign Out</button></SignOutButton>
              }
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── DESKTOP ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* Sidebar */}
      <div style={{ width: W, flexShrink: 0, background: SB, display: 'flex', flexDirection: 'column', transition: 'width 0.15s ease', overflow: 'hidden', zIndex: 10 }}>

        {/* Logo */}
        <div style={{ height: 56, display: 'flex', alignItems: 'center', gap: 10, padding: collapsed ? '0' : '0 16px', justifyContent: collapsed ? 'center' : 'flex-start', flexShrink: 0, borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
          <div style={{ width: 30, height: 30, borderRadius: 7, background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: 12, letterSpacing: '-0.5px', flexShrink: 0 }}>FG</div>
          {!collapsed && <span style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9', whiteSpace: 'nowrap', letterSpacing: '-0.3px' }}>FrankGrant</span>}
        </div>

        {/* Main nav */}
        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', padding: '8px 0' }}>
          {NAV_ITEMS.map(item => (
            <NavItem key={item.id} item={item} isActive={activeNavId === item.id} collapsed={collapsed} onNavigate={setActiveView} />
          ))}
          <div style={{ height: 1, background: 'rgba(255,255,255,0.06)', margin: '8px 14px' }} />
          <NavItem item={PIPELINE_ITEM} isActive={activeNavId === 'pipeline'} collapsed={collapsed} onNavigate={setActiveView} />
        </div>

        {/* Bottom */}
        <div style={{ flexShrink: 0, borderTop: '1px solid rgba(255,255,255,0.06)', padding: '8px 0 4px' }}>
          <NavItem item={SETTINGS_ITEM} isActive={activeNavId === 'settings'} collapsed={collapsed} onNavigate={setActiveView} />
          {isAdmin && <NavItem item={COMMAND_ITEM} isActive={activeNavId === 'command'} collapsed={collapsed} onNavigate={setActiveView} danger />}

          {!user && (
            <div style={{ padding: '6px 8px' }}>
              <SignInButton mode="modal">
                <button style={{ width: '100%', padding: '9px', background: TEAL, border: 'none', borderRadius: 8, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
                  {collapsed ? '→' : 'Sign In'}
                </button>
              </SignInButton>
            </div>
          )}

          {user && (
            <div style={{ position: 'relative', padding: '4px 8px' }} onMouseDown={e => e.stopPropagation()}>
              <button
                onClick={() => setShowUserMenu(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 9, width: '100%', padding: '8px', border: 'none', background: showUserMenu ? SB_HOVER : 'none', cursor: 'pointer', borderRadius: 8, justifyContent: collapsed ? 'center' : 'flex-start' }}
              >
                <div style={{ width: 27, height: 27, borderRadius: '50%', background: TEAL, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials.toUpperCase()}</div>
                {!collapsed && <span style={{ fontSize: 12, color: SB_TEXT, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, textAlign: 'left' }}>{name || email}</span>}
              </button>

              {showUserMenu && (
                <div style={{ position: 'absolute', bottom: '110%', left: 8, right: 8, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, boxShadow: '0 10px 30px rgba(0,0,0,0.12)', overflow: 'hidden', zIndex: 300 }}>
                  <div style={{ padding: '10px 14px', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a', marginBottom: 1 }}>{name}</div>
                    <div style={{ fontSize: 11, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{email}</div>
                  </div>
                  <SignOutButton>
                    <button style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#ef4444', fontWeight: 500 }}>
                      <Icons.SignOut /> Sign out
                    </button>
                  </SignOutButton>
                </div>
              )}
            </div>
          )}

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed(v => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', padding: '5px', border: 'none', background: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.2)', marginBottom: 2 }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <Icons.ChevR /> : <Icons.ChevL />}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0, background: '#f8fafc' }}>
        {activeView !== 'editor' && (
          <div style={{ height: 48, background: '#ffffff', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 20px', flexShrink: 0 }}>
            <h1 style={{ fontSize: 15, fontWeight: 600, color: '#0f172a' }}>
              {PAGE_TITLES[activeView] || 'FrankGrant'}
            </h1>
            {!user && (
              <SignInButton mode="modal">
                <button style={{ padding: '6px 16px', background: TEAL, border: 'none', borderRadius: 7, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Sign In</button>
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
