import { useState } from 'react'
import { useApi } from '../hooks/useApi'

const TEAL = '#0e7490'

function PassStep({ number, label, status, result }) {
  const [expanded, setExpanded] = useState(false)
  const statusConfig = {
    pending: { icon: '○', bg: '#f9fafb', border: '#e5e7eb', color: '#9ca3af', label: 'Pending' },
    running: { icon: '⟳', bg: '#eff6ff', border: '#bfdbfe', color: '#2563eb', label: 'Running…' },
    passed: { icon: '✓', bg: '#f0fdf4', border: '#86efac', color: '#16a34a', label: 'Passed' },
    failed: { icon: '✕', bg: '#fef2f2', border: '#fca5a5', color: '#dc2626', label: 'Failed' },
  }
  const cfg = statusConfig[status] || statusConfig.pending

  return (
    <div style={{ border: `1px solid ${cfg.border}`, borderRadius: 8, overflow: 'hidden', marginBottom: 8 }}>
      <button
        onClick={() => result && setExpanded(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: cfg.bg, border: 'none', cursor: result ? 'pointer' : 'default', textAlign: 'left' }}
      >
        <div style={{ width: 24, height: 24, borderRadius: '50%', background: cfg.color, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span style={{ color: '#fff', fontSize: 13, fontWeight: 700, animation: status === 'running' ? 'spin 1s linear infinite' : 'none' }}>{cfg.icon}</span>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#111' }}>Pass {number}: {label}</div>
          <div style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>{cfg.label}</div>
        </div>
        {result && <span style={{ fontSize: 11, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>}
      </button>

      {expanded && result && (
        <div style={{ padding: '12px 14px', background: '#fff', borderTop: `1px solid ${cfg.border}` }}>
          {/* Pass 1 details */}
          {number === 1 && (
            <div>
              <div style={{ display: 'flex', gap: 16, marginBottom: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 24, fontWeight: 700, color: (result.accuracy_score || 0) >= 80 ? '#16a34a' : (result.accuracy_score || 0) >= 70 ? '#d97706' : '#dc2626' }}>{result.accuracy_score || 0}</div>
                  <div style={{ fontSize: 10, color: '#9ca3af' }}>Accuracy</div>
                </div>
                {result.citation_verification && (
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 24, fontWeight: 700, color: TEAL }}>{result.citation_verification.total_citations}</div>
                    <div style={{ fontSize: 10, color: '#9ca3af' }}>Citations</div>
                  </div>
                )}
              </div>
              {result.citation_verification && (
                <div style={{ fontSize: 12, color: '#374151', marginBottom: 8 }}>
                  <span style={{ color: '#16a34a' }}>{result.citation_verification.verified} verified</span>
                  {result.citation_verification.likely_real > 0 && <span style={{ color: '#d97706' }}> · {result.citation_verification.likely_real} likely real</span>}
                  {result.citation_verification.not_found > 0 && <span style={{ color: '#dc2626', fontWeight: 700 }}> · {result.citation_verification.not_found} NOT FOUND</span>}
                </div>
              )}
              {(result.invented_claims || []).length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#dc2626', marginBottom: 4 }}>Potential Invented Claims</div>
                  {result.invented_claims.slice(0, 3).map((c, i) => (
                    <div key={i} style={{ fontSize: 11, color: '#374151', padding: '4px 8px', background: '#fef2f2', borderRadius: 4, marginBottom: 3 }}>
                      [{c.section}] {c.claim} — {c.concern}
                    </div>
                  ))}
                </div>
              )}
              {/* Not-found citations with database grid */}
              {result.citation_verification?.problem_citations?.filter(c => c.status === 'not_found').map((cit, i) => (
                <div key={i} style={{ marginTop: 8, padding: '8px 10px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 6 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#dc2626', marginBottom: 4 }}>❌ {cit.raw_text}</div>
                  <div style={{ fontSize: 11, color: '#b91c1c', marginBottom: 6 }}>Not found in any of 5 scholarly databases — may be hallucinated</div>
                  <DatabaseGrid dbResults={cit.database_results} />
                  <a
                    href={`https://pubmed.ncbi.nlm.nih.gov/?term=${encodeURIComponent(cit.raw_text)}`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: TEAL, textDecoration: 'underline' }}
                  >Search PubMed</a>
                </div>
              ))}
            </div>
          )}

          {/* Pass 2 details */}
          {number === 2 && (
            <div>
              <div style={{ fontSize: 13, marginBottom: 8 }}>
                <span style={{ fontWeight: 700, color: (result.compliance_score || 0) >= 80 ? '#16a34a' : '#dc2626' }}>{result.compliance_score}%</span>
                <span style={{ color: '#9ca3af', fontSize: 11 }}> compliance · {result.critical_failures} critical failures · {result.warnings} warnings</span>
              </div>
              {(result.checks || []).filter(c => c.passed === false).map((c, i) => (
                <div key={i} style={{ fontSize: 11, padding: '4px 8px', background: '#fef2f2', borderRadius: 4, marginBottom: 3, color: '#b91c1c' }}>
                  ❌ {c.check}: {c.value} (limit: {c.limit})
                </div>
              ))}
              {(result.content_issues || []).filter(c => c.severity === 'critical').map((c, i) => (
                <div key={i} style={{ fontSize: 11, padding: '4px 8px', background: '#fef2f2', borderRadius: 4, marginBottom: 3, color: '#b91c1c' }}>
                  ❌ {c.issue} [{c.section}] — {c.fix}
                </div>
              ))}
            </div>
          )}

          {/* Pass 3 details */}
          {number === 3 && (
            <div>
              {result.study_section_score !== null && result.study_section_score !== undefined && (
                <div style={{ fontSize: 13, marginBottom: 8 }}>
                  Impact score: <span style={{ fontWeight: 700, color: result.study_section_score <= 20 ? '#16a34a' : result.study_section_score <= 40 ? '#d97706' : '#dc2626' }}>{result.study_section_score}</span>
                  <span style={{ fontSize: 11, color: '#9ca3af' }}> (target: ≤40 for competitiveness)</span>
                </div>
              )}
              {(result.issues || []).map((issue, i) => (
                <div key={i} style={{ fontSize: 11, padding: '4px 8px', background: issue.severity === 'critical' ? '#fef2f2' : '#fffbeb', borderRadius: 4, marginBottom: 3, color: issue.severity === 'critical' ? '#b91c1c' : '#92400e' }}>
                  {issue.severity === 'critical' ? '❌' : '⚠️'} {issue.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function DatabaseGrid({ dbResults }) {
  if (!dbResults) return null
  const dbs = [
    { key: 'pubmed', label: 'PubMed' },
    { key: 'crossref', label: 'CrossRef' },
    { key: 'semantic_scholar', label: 'Semantic Scholar' },
    { key: 'open_alex', label: 'OpenAlex' },
    { key: 'europe_pmc', label: 'Europe PMC' },
  ]
  return (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 6 }}>
      {dbs.map(db => {
        const result = dbResults[db.key]
        const found = result?.found
        const errored = result?.error
        return (
          <div
            key={db.key}
            title={found ? `Found in ${db.label}: ${result.record?.title || ''}` : errored ? `${db.label}: error` : `Not found in ${db.label}`}
            style={{ fontSize: 10, padding: '2px 6px', borderRadius: 4, background: found ? '#f0fdf4' : errored ? '#fffbeb' : '#fef2f2', border: `1px solid ${found ? '#86efac' : errored ? '#fcd34d' : '#fca5a5'}`, color: found ? '#15803d' : errored ? '#92400e' : '#b91c1c', cursor: 'default' }}
          >
            {found ? '✓' : errored ? '?' : '✕'} {db.label}
          </div>
        )
      })}
    </div>
  )
}

export default function QualityReviewPanel({ project, onRewriteRequest }) {
  const api = useApi()
  const [running, setRunning] = useState(false)
  const [passStatus, setPassStatus] = useState({ 1: 'pending', 2: 'pending', 3: 'pending' })
  const [results, setResults] = useState({
    pass1: project.quality_pass1_results || null,
    pass2: project.quality_pass2_results || null,
    pass3: project.quality_pass3_results || null,
  })
  const [allResult, setAllResult] = useState(null)
  const [error, setError] = useState(null)
  const [collapsed, setCollapsed] = useState(!project.quality_certified)

  const certified = project.quality_certified
  const deliveryReady = project.delivery_ready

  async function runAll() {
    setRunning(true)
    setError(null)
    setAllResult(null)
    setPassStatus({ 1: 'running', 2: 'pending', 3: 'pending' })

    try {
      // Run all — the backend does it sequentially; we show pass 1 as running
      const result = await api.runQualityAll(project.id)
      setAllResult(result)

      // Update pass statuses based on result
      const p1Status = result.pass1 ? (result.pass1.passed ? 'passed' : 'failed') : 'pending'
      const p2Status = result.pass2 ? (result.pass2.passed ? 'passed' : 'failed') : 'pending'
      const p3Status = result.pass3 ? (result.pass3.passed ? 'passed' : 'failed') : 'pending'
      setPassStatus({ 1: p1Status, 2: p2Status, 3: p3Status })
      setResults({ pass1: result.pass1, pass2: result.pass2, pass3: result.pass3 })

      if (!result.all_passed) {
        setError(`Quality review failed at ${result.failed_at === 'pass1' ? 'Pass 1 (Scientific Accuracy)' : result.failed_at === 'pass2' ? 'Pass 2 (NIH Compliance)' : 'Pass 3 (Reviewer Simulation)'}`)
      }
    } catch (e) {
      setError('Quality review failed: ' + e.message)
      setPassStatus({ 1: 'pending', 2: 'pending', 3: 'pending' })
    }
    setRunning(false)
  }

  const contentEdited = !certified && (results.pass1 || results.pass2 || results.pass3)

  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
      {/* Header */}
      <button
        onClick={() => setCollapsed(v => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: certified ? '#f0fdf4' : '#f8fafc', border: 'none', cursor: 'pointer', textAlign: 'left' }}
      >
        <span style={{ fontSize: 14, fontWeight: 600, color: '#374151', flex: 1 }}>
          🔍 Quality Review
          {certified && <span style={{ marginLeft: 8, fontSize: 11, color: '#16a34a', fontWeight: 700, background: '#dcfce7', padding: '1px 6px', borderRadius: 10 }}>✓ Certified</span>}
          {!certified && (results.pass1 || results.pass2 || results.pass3) && <span style={{ marginLeft: 8, fontSize: 11, color: '#d97706', fontWeight: 600, background: '#fef9c3', padding: '1px 6px', borderRadius: 10 }}>⚠ Not Certified</span>}
        </span>
        <span style={{ color: '#9ca3af', fontSize: 12 }}>{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <div style={{ padding: '14px 14px 16px' }}>
          {/* Re-certification amber notice */}
          {contentEdited && !running && (
            <div style={{ padding: '8px 12px', background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 6, fontSize: 12, color: '#92400e', marginBottom: 12 }}>
              ⚠️ Content was edited — re-run Quality Review before delivery.
            </div>
          )}

          {/* Certified banner */}
          {certified && !running && (
            <div style={{ padding: '12px 16px', background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 8, marginBottom: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: '#15803d' }}>✅ Quality Certified — Ready to Deliver</div>
              {project.quality_certified_at && (
                <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>
                  Certified {new Date(project.quality_certified_at * 1000).toLocaleString()}
                </div>
              )}
            </div>
          )}

          {/* Failed banner */}
          {error && !running && (
            <div style={{ padding: '10px 12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: 8, marginBottom: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>⚠️ {error}</div>
              {onRewriteRequest && (
                <button
                  onClick={onRewriteRequest}
                  style={{ marginTop: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, background: TEAL, color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
                >
                  ✍️ Fix These Issues with Rewrite
                </button>
              )}
            </div>
          )}

          {/* Three pass steps */}
          <PassStep number={1} label="Scientific Accuracy" status={running && passStatus[1] === 'running' ? 'running' : passStatus[1]} result={results.pass1} />
          <PassStep number={2} label="NIH Compliance" status={running && passStatus[2] === 'running' ? 'running' : passStatus[2]} result={results.pass2} />
          <PassStep number={3} label="Reviewer Simulation" status={running && passStatus[3] === 'running' ? 'running' : passStatus[3]} result={results.pass3} />

          {/* Run button */}
          <button
            onClick={runAll}
            disabled={running}
            style={{ width: '100%', marginTop: 4, padding: '10px', fontSize: 14, fontWeight: 700, background: running ? '#e5e7eb' : TEAL, color: running ? '#9ca3af' : '#fff', border: 'none', borderRadius: 8, cursor: running ? 'not-allowed' : 'pointer' }}
          >
            {running ? '⟳ Running Quality Review…' : certified ? '🔄 Re-run Quality Review' : '🔍 Run Quality Review'}
          </button>

          <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af', textAlign: 'center' }}>
            Takes 2–4 minutes · Checks accuracy, compliance, and reviewer scores
          </div>
        </div>
      )}
    </div>
  )
}
