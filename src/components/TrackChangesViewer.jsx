import { useState, useRef, useCallback } from 'react'
import { wordDiff, renderDiffStats } from '../lib/diffEngine'

const TEAL = '#0e7490'
const ADDED_COLOR = '#0d9488'
const ADDED_BG = 'rgba(13,148,136,0.10)'
const REMOVED_COLOR = '#dc2626'

function splitParagraphs(text) {
  return text.split(/\n\n+/).filter(p => p.trim().length > 0)
}

function ParagraphDiff({ originalPara, rewrittenPara, index, decision, onAccept, onReject }) {
  const [hovered, setHovered] = useState(false)
  const diff = wordDiff(originalPara, rewrittenPara)

  if (decision === 'accepted') {
    return (
      <div style={{ position: 'relative', padding: '10px 12px', marginBottom: 12, background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8 }}>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: '#15803d', whiteSpace: 'pre-wrap' }}>{rewrittenPara}</div>
        <span style={{ position: 'absolute', top: 8, right: 10, fontSize: 12, color: '#16a34a', fontWeight: 600 }}>✓ Accepted</span>
      </div>
    )
  }
  if (decision === 'rejected') {
    return (
      <div style={{ position: 'relative', padding: '10px 12px', marginBottom: 12, background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <div style={{ fontSize: 13, lineHeight: 1.65, color: '#374151', whiteSpace: 'pre-wrap' }}>{originalPara}</div>
        <span style={{ position: 'absolute', top: 8, right: 10, fontSize: 12, color: '#9ca3af', fontWeight: 600 }}>↩ Reverted</span>
      </div>
    )
  }

  return (
    <div
      style={{ position: 'relative', padding: '10px 12px', marginBottom: 12, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, transition: 'border-color 0.15s' }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ fontSize: 13, lineHeight: 1.7 }}>
        {diff.map((d, i) => {
          if (d.type === 'unchanged') return <span key={i}>{d.token}</span>
          if (d.type === 'added') return <span key={i} style={{ color: ADDED_COLOR, background: ADDED_BG, borderRadius: 2 }}>{d.token}</span>
          if (d.type === 'removed') return <span key={i} style={{ color: REMOVED_COLOR, textDecoration: 'line-through', opacity: 0.6 }}>{d.token}</span>
          return null
        })}
      </div>
      {hovered && (
        <div style={{ position: 'absolute', top: 6, right: 8, display: 'flex', gap: 6 }}>
          <button
            onClick={() => onAccept(index)}
            style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 5, cursor: 'pointer' }}
          >
            ✓ Accept
          </button>
          <button
            onClick={() => onReject(index)}
            style={{ padding: '3px 10px', fontSize: 11, fontWeight: 600, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 5, cursor: 'pointer' }}
          >
            ✕ Reject
          </button>
        </div>
      )}
    </div>
  )
}

export default function TrackChangesViewer({
  originalText,
  rewrittenText,
  sectionName,
  cyclesRemaining,
  onAcceptAll,
  onRejectAll,
  onClose,
}) {
  const [viewMode, setViewMode] = useState('track_changes')
  const [decisions, setDecisions] = useState({})
  const leftRef = useRef(null)
  const rightRef = useRef(null)

  const origParas = splitParagraphs(originalText || '')
  const newParas = splitParagraphs(rewrittenText || '')
  const maxParas = Math.max(origParas.length, newParas.length)

  const diff = wordDiff(originalText || '', rewrittenText || '')
  const stats = renderDiffStats(diff)

  const acceptParagraph = useCallback((idx) => {
    setDecisions(d => ({ ...d, [idx]: 'accepted' }))
  }, [])

  const rejectParagraph = useCallback((idx) => {
    setDecisions(d => ({ ...d, [idx]: 'rejected' }))
  }, [])

  function buildFinalText() {
    return newParas.map((p, i) => decisions[i] === 'rejected' ? origParas[i] || p : p).join('\n\n')
  }

  function allDecided() {
    return Object.keys(decisions).length === newParas.length
  }

  const syncScroll = (sourceRef, targetRef) => (e) => {
    if (targetRef.current) {
      targetRef.current.scrollTop = e.target.scrollTop
    }
  }

  return (
    <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', background: '#f8fafc' }}>
        <div style={{ fontWeight: 600, fontSize: 14, color: '#111', flex: 1 }}>{sectionName} — Rewrite</div>
        <div style={{ fontSize: 12, color: '#6b7280' }}>
          <span style={{ color: ADDED_COLOR, fontWeight: 600 }}>+{stats.additions}</span> additions ·
          <span style={{ color: REMOVED_COLOR, fontWeight: 600, marginLeft: 4 }}>−{stats.removals}</span> removals
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {[['track_changes', '⟳ Track Changes'], ['clean', '◻ Clean'], ['side_by_side', '⟺ Side by Side']].map(([v, label]) => (
            <button
              key={v}
              onClick={() => setViewMode(v)}
              style={{ padding: '4px 10px', fontSize: 11, fontWeight: 600, border: `1px solid ${viewMode === v ? TEAL : '#d1d5db'}`, borderRadius: 6, cursor: 'pointer', background: viewMode === v ? TEAL : '#fff', color: viewMode === v ? '#fff' : '#374151' }}
            >
              {label}
            </button>
          ))}
        </div>
        <button onClick={() => onAcceptAll(rewrittenText)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#0d9488', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}>Accept All</button>
        <button onClick={() => onRejectAll(originalText)} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 600, background: '#fee2e2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: 6, cursor: 'pointer' }}>Reject All</button>
        {onClose && <button onClick={onClose} style={{ padding: '5px 8px', fontSize: 12, background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', color: '#6b7280' }}>✕</button>}
      </div>

      <div style={{ padding: '8px 16px', background: '#fffbeb', borderBottom: '1px solid #fef3c7', fontSize: 12, color: '#92400e' }}>
        Rewrite cycle used. <strong>{cyclesRemaining}</strong> cycle{cyclesRemaining !== 1 ? 's' : ''} remaining on this grant.
      </div>

      {/* Content */}
      <div style={{ padding: viewMode === 'side_by_side' ? 0 : '16px', maxHeight: 600, overflowY: viewMode === 'side_by_side' ? 'hidden' : 'auto' }}>

        {viewMode === 'track_changes' && (
          <div>
            {newParas.map((para, i) => (
              <ParagraphDiff
                key={i}
                index={i}
                originalPara={origParas[i] || ''}
                rewrittenPara={para}
                decision={decisions[i]}
                onAccept={acceptParagraph}
                onReject={rejectParagraph}
              />
            ))}
          </div>
        )}

        {viewMode === 'clean' && (
          <div style={{ fontSize: 13, lineHeight: 1.7, color: '#111', whiteSpace: 'pre-wrap' }}>
            {rewrittenText}
          </div>
        )}

        {viewMode === 'side_by_side' && (
          <div style={{ display: 'flex', height: 500 }}>
            <div
              ref={leftRef}
              onScroll={syncScroll(leftRef, rightRef)}
              style={{ flex: 1, overflowY: 'auto', padding: 16, borderRight: '1px solid #e5e7eb' }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Original</div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                {diff.filter(d => d.type !== 'added').map((d, i) => (
                  <span key={i} style={d.type === 'removed' ? { background: '#fef2f2', color: REMOVED_COLOR } : {}}>
                    {d.token}
                  </span>
                ))}
              </div>
            </div>
            <div
              ref={rightRef}
              onScroll={syncScroll(rightRef, leftRef)}
              style={{ flex: 1, overflowY: 'auto', padding: 16 }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: '#9ca3af', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Rewritten</div>
              <div style={{ fontSize: 13, lineHeight: 1.7 }}>
                {diff.filter(d => d.type !== 'removed').map((d, i) => (
                  <span key={i} style={d.type === 'added' ? { background: ADDED_BG, color: ADDED_COLOR } : {}}>
                    {d.token}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Completion banner */}
      {allDecided() && viewMode === 'track_changes' && (
        <div style={{ padding: '12px 16px', background: '#f0fdf4', borderTop: '1px solid #86efac', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: '#15803d', fontWeight: 600 }}>✓ All paragraphs decided.</span>
          <button
            onClick={() => onAcceptAll(buildFinalText())}
            style={{ padding: '6px 14px', fontSize: 12, fontWeight: 600, background: '#15803d', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            Save Decisions
          </button>
        </div>
      )}
    </div>
  )
}
