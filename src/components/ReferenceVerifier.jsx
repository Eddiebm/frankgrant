import { useState } from 'react'

const DB_CONFIG = [
  { key: 'pubmed', label: 'PubMed' },
  { key: 'crossref', label: 'CrossRef' },
  { key: 'semantic_scholar', label: 'S2' },
  { key: 'open_alex', label: 'OpenAlex' },
  { key: 'europe_pmc', label: 'EuropePMC' },
]

function DatabaseGrid({ dbResults }) {
  if (!dbResults || Object.keys(dbResults).length === 0) return null
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', margin: '6px 0' }}>
      {DB_CONFIG.map(db => {
        const r = dbResults[db.key]
        const found = r?.found
        const errored = r?.error
        return (
          <div
            key={db.key}
            title={found ? `✓ ${db.label}: ${r.record?.title || ''}` : errored ? `${db.label}: error — ${r.error}` : `✕ ${db.label}: not found`}
            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: found ? '#f0fdf4' : errored ? '#fffbeb' : '#fef2f2', border: `1px solid ${found ? '#86efac' : errored ? '#fcd34d' : '#fca5a5'}`, color: found ? '#15803d' : errored ? '#92400e' : '#b91c1c', cursor: 'default', userSelect: 'none' }}
          >
            {found ? '✓' : errored ? '?' : '✕'} {db.label}
          </div>
        )
      })}
    </div>
  )
}

function CitationCard({ cit, index, marking, onMark }) {
  const hasMultiDB = cit.verification_status && cit.database_results && Object.keys(cit.database_results).length > 0

  // Determine effective status
  const status = hasMultiDB ? cit.verification_status : cit.status
  // Map to display config
  const config = {
    verified: { bg: '#f0fdf4', border: '#86efac', color: '#15803d', icon: '✅', label: 'Verified' },
    likely_real: { bg: '#f0fdfa', border: '#5eead4', color: '#0f766e', icon: '🔵', label: 'Likely Real' },
    not_found: { bg: '#fef2f2', border: '#fca5a5', color: '#b91c1c', icon: '❌', label: 'Not Found' },
    needs_manual_check: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', icon: '⚠️', label: 'Needs Manual Check' },
    uncertain: { bg: '#fffbeb', border: '#fcd34d', color: '#92400e', icon: '⚠️', label: 'Uncertain' },
  }
  const cfg = config[status] || config.uncertain

  const bestRecord = cit.matched_records?.[0] || null
  const pmid = bestRecord?.pmid || cit.pmid
  const doi = bestRecord?.doi || cit.doi
  const title = bestRecord?.title || cit.pubmed_title

  return (
    <div style={{ padding: '10px 12px', background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={{ fontSize: 16, flexShrink: 0 }}>{cfg.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: (status === 'not_found') ? 700 : 500, color: cfg.color, wordBreak: 'break-word' }}>
            {cit.raw_text}
          </div>

          {/* Database grid for multi-DB results */}
          {hasMultiDB && <DatabaseGrid dbResults={cit.database_results} />}

          {/* Verified record details */}
          {(status === 'verified' || status === 'likely_real') && (
            <div style={{ marginTop: 4 }}>
              {title && <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginBottom: 2 }}>{title}</div>}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {pmid && (
                  <a href={`https://pubmed.ncbi.nlm.nih.gov/${pmid}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0e7490', textDecoration: 'none' }}>
                    PMID {pmid}
                  </a>
                )}
                {doi && (
                  <a href={`https://doi.org/${doi.replace('https://doi.org/', '')}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, color: '#0e7490', textDecoration: 'none' }}>
                    DOI ↗
                  </a>
                )}
                {hasMultiDB && <span style={{ fontSize: 11, color: cfg.color, fontWeight: 600 }}>Found in {cit.databases_found}/{cit.databases_checked} databases</span>}
              </div>
              {status === 'likely_real' && !marking[index] && (
                <button onClick={() => onMark(index, 'verified')} style={{ marginTop: 6, fontSize: 11, padding: '2px 8px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, color: '#15803d', cursor: 'pointer' }}>
                  Mark Verified
                </button>
              )}
              {marking[index] === 'verified' && <span style={{ fontSize: 11, color: '#15803d', marginTop: 4, display: 'block' }}>✓ Marked verified</span>}
            </div>
          )}

          {/* Uncertain (legacy or needs_manual) */}
          {(status === 'uncertain' || status === 'needs_manual_check') && !hasMultiDB && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#b45309', marginBottom: 4 }}>
                {pmid ? 'Found — verify manually' : 'Low confidence match'}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none' }}>Search PubMed</a>
                {!marking[index] && <button onClick={() => onMark(index, 'verified')} style={{ fontSize: 11, padding: '2px 8px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, color: '#15803d', cursor: 'pointer' }}>Mark Verified</button>}
                {marking[index] === 'verified' && <span style={{ fontSize: 11, color: '#15803d' }}>✓ Marked verified</span>}
              </div>
            </div>
          )}

          {/* Not found */}
          {status === 'not_found' && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 700, marginBottom: 6 }}>
                {hasMultiDB ? 'Not found in any of 5 scholarly databases — may be hallucinated' : 'Not found in PubMed — may be hallucinated'}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none' }}>Search PubMed</a>
                <a href={`https://scholar.google.com/scholar?q=${encodeURIComponent(cit.raw_text)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none' }}>Google Scholar</a>
              </div>
            </div>
          )}

          {/* Needs manual check with DB grid */}
          {status === 'needs_manual_check' && hasMultiDB && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontSize: 11, color: '#92400e', marginBottom: 4 }}>Database errors prevented full check — verify manually</div>
              <a href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`} target="_blank" rel="noopener noreferrer" style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none' }}>Search PubMed</a>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ReferenceVerifier({ results, onClose }) {
  const [expanded, setExpanded] = useState(false)
  const [marking, setMarking] = useState({})

  if (!results) return null

  const { results: citations = [], verified_count = 0, uncertain_count = 0, not_found_count = 0, checked_at, overall_reliability } = results

  // Prefer new multi-DB counts if available
  const verifiedDisplay = citations.filter(c => c.verification_status === 'verified').length || verified_count
  const likelyRealDisplay = citations.filter(c => c.verification_status === 'likely_real').length
  const notFoundDisplay = citations.filter(c => c.verification_status === 'not_found').length || not_found_count
  const needsManualDisplay = citations.filter(c => c.verification_status === 'needs_manual_check').length

  const reliability = overall_reliability || (notFoundDisplay === 0 ? 'high' : notFoundDisplay <= 2 ? 'medium' : 'low')
  const reliabilityConfig = { high: { color: '#15803d', bg: '#f0fdf4', border: '#86efac', label: 'HIGH' }, medium: { color: '#d97706', bg: '#fffbeb', border: '#fcd34d', label: 'MEDIUM' }, low: { color: '#dc2626', bg: '#fef2f2', border: '#fca5a5', label: 'LOW' } }
  const relCfg = reliabilityConfig[reliability] || reliabilityConfig.medium

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginTop: 8 }}>
      {/* Header */}
      <button
        onClick={() => setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: '#f8fafc', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: '#374151', flex: 1 }}>
          🔍 Reference Check
          {citations.length > 0 && (
            <span style={{ marginLeft: 8, fontWeight: 400, fontSize: 12 }}>
              {verifiedDisplay > 0 && <span style={{ color: '#15803d' }}>{verifiedDisplay} ✅ </span>}
              {likelyRealDisplay > 0 && <span style={{ color: '#0f766e' }}>{likelyRealDisplay} 🔵 </span>}
              {uncertain_count > 0 && likelyRealDisplay === 0 && <span style={{ color: '#d97706' }}>{uncertain_count} ⚠️ </span>}
              {notFoundDisplay > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}>{notFoundDisplay} ❌ </span>}
            </span>
          )}
        </span>

        {/* Reliability badge */}
        {citations.length > 0 && (
          <span style={{ fontSize: 11, fontWeight: 700, color: relCfg.color, background: relCfg.bg, border: `1px solid ${relCfg.border}`, padding: '1px 6px', borderRadius: 4 }}>
            {relCfg.label}
          </span>
        )}

        {checked_at && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {new Date(checked_at * 1000).toLocaleDateString()}
          </span>
        )}
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '12px 14px' }}>
          {/* Summary reliability bar */}
          {citations.length > 0 && (
            <div style={{ padding: '8px 10px', background: relCfg.bg, border: `1px solid ${relCfg.border}`, borderRadius: 6, marginBottom: 10, fontSize: 12, color: relCfg.color, fontWeight: 600 }}>
              Reference reliability: {relCfg.label} — {verifiedDisplay} verified{likelyRealDisplay > 0 ? `, ${likelyRealDisplay} likely real` : ''}{notFoundDisplay > 0 ? `, ${notFoundDisplay} not found` : ''}
              {needsManualDisplay > 0 ? `, ${needsManualDisplay} need manual check` : ''}
              {' '}across {DB_CONFIG.length} scholarly databases
            </div>
          )}

          {citations.length === 0 && (
            <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '12px 0' }}>No citations found in this section.</div>
          )}

          {citations.map((cit, i) => (
            <CitationCard
              key={i}
              cit={cit}
              index={i}
              marking={marking}
              onMark={(idx, val) => setMarking(m => ({ ...m, [idx]: val }))}
            />
          ))}
        </div>
      )}
    </div>
  )
}
