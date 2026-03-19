import { useState } from 'react'

export default function ReferenceVerifier({ results, onClose }) {
  const [expanded, setExpanded] = useState(false)
  const [marking, setMarking] = useState({})

  if (!results) return null

  const { results: citations = [], verified_count = 0, uncertain_count = 0, not_found_count = 0, checked_at } = results

  const statusIcon = { verified: '✅', uncertain: '⚠️', not_found: '❌' }
  const statusColor = { verified: '#16a34a', uncertain: '#d97706', not_found: '#dc2626' }
  const statusBg = { verified: '#f0fdf4', uncertain: '#fffbeb', not_found: '#fef2f2' }
  const statusBorder = { verified: '#86efac', uncertain: '#fcd34d', not_found: '#fca5a5' }

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
              {verified_count > 0 && <span style={{ color: '#16a34a' }}>{verified_count} ✅ </span>}
              {uncertain_count > 0 && <span style={{ color: '#d97706' }}>{uncertain_count} ⚠️ </span>}
              {not_found_count > 0 && <span style={{ color: '#dc2626' }}>{not_found_count} ❌ </span>}
            </span>
          )}
        </span>
        {checked_at && (
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            Checked {new Date(checked_at * 1000).toLocaleDateString()}
          </span>
        )}
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          {citations.length === 0 && (
            <div style={{ fontSize: 13, color: '#9ca3af', textAlign: 'center', padding: '12px 0' }}>No citations found in this section.</div>
          )}
          {citations.map((cit, i) => (
            <div
              key={i}
              style={{ padding: '10px 12px', background: statusBg[cit.status] || '#f9fafb', border: `1px solid ${statusBorder[cit.status] || '#e5e7eb'}`, borderRadius: 8 }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <span style={{ fontSize: 16, flexShrink: 0 }}>{statusIcon[cit.status] || '❓'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: cit.status === 'not_found' ? 700 : 500, color: statusColor[cit.status] || '#374151', wordBreak: 'break-word' }}>
                    {cit.raw_text}
                  </div>

                  {cit.status === 'verified' && cit.pmid && (
                    <div style={{ marginTop: 4 }}>
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${cit.pmid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: 11, color: '#0e7490', textDecoration: 'none' }}
                      >
                        PMID {cit.pmid}
                      </a>
                      {cit.pubmed_title && (
                        <div style={{ fontSize: 11, color: '#6b7280', fontStyle: 'italic', marginTop: 2 }}>{cit.pubmed_title}</div>
                      )}
                    </div>
                  )}

                  {cit.status === 'uncertain' && (
                    <div style={{ marginTop: 4, fontSize: 11, color: '#b45309' }}>
                      {cit.pmid ? `Found ${cit.pmid ? '1' : '0'} paper — verify manually` : 'Low confidence match'}
                      <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none', cursor: 'pointer' }}
                        >
                          Search PubMed
                        </a>
                        {!marking[i] && (
                          <button
                            onClick={() => setMarking(m => ({ ...m, [i]: 'verified' }))}
                            style={{ fontSize: 11, padding: '2px 8px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 4, color: '#15803d', cursor: 'pointer' }}
                          >
                            Mark Verified
                          </button>
                        )}
                        {marking[i] === 'verified' && <span style={{ fontSize: 11, color: '#15803d' }}>✓ Marked verified</span>}
                      </div>
                    </div>
                  )}

                  {cit.status === 'not_found' && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 11, color: '#b91c1c', fontWeight: 600, marginBottom: 4 }}>Not found in PubMed — may be hallucinated</div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <a
                          href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 11, padding: '2px 8px', background: '#fff', border: '1px solid #d1d5db', borderRadius: 4, color: '#374151', textDecoration: 'none' }}
                        >
                          Search PubMed
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
