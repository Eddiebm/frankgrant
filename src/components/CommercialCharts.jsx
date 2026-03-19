// Pure inline SVG commercial charts — no external library

function fmt(n) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}B`
  if (n >= 1) return `$${n.toFixed(0)}M`
  return `$${(n * 1000).toFixed(0)}K`
}

// TAM / SAM / SOM concentric funnel
export function MarketSizeChart({ data }) {
  if (!data) return null
  const { tam, sam, som, tam_label, sam_label, som_label } = data
  const max = Math.max(tam || 1, sam || 1, som || 1)
  const w = 280, h = 180, cx = w / 2

  const tamR = 85
  const samR = Math.max(20, (sam / max) * 85)
  const somR = Math.max(10, (som / max) * 85)

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      <circle cx={cx} cy={h / 2} r={tamR} fill="#dbeafe" stroke="#93c5fd" strokeWidth={1.5} />
      <circle cx={cx} cy={h / 2} r={samR} fill="#bfdbfe" stroke="#60a5fa" strokeWidth={1.5} />
      <circle cx={cx} cy={h / 2} r={somR} fill="#3b82f6" stroke="#1d4ed8" strokeWidth={1.5} />

      <text x={cx} y={h / 2 - somR - 4} textAnchor="middle" fontSize="9" fill="#1e40af" fontWeight="600">SOM</text>
      <text x={cx} y={h / 2 - somR + 9} textAnchor="middle" fontSize="8" fill="#1e40af">{fmt(som)}</text>

      <text x={cx + samR + 4} y={h / 2 - 14} textAnchor="start" fontSize="9" fill="#1d4ed8" fontWeight="600">SAM</text>
      <text x={cx + samR + 4} y={h / 2} textAnchor="start" fontSize="8" fill="#1d4ed8">{fmt(sam)}</text>

      <text x={cx + tamR + 4} y={h / 2 + 14} textAnchor="start" fontSize="9" fill="#2563eb" fontWeight="600">TAM</text>
      <text x={cx + tamR + 4} y={h / 2 + 28} textAnchor="start" fontSize="8" fill="#2563eb">{fmt(tam)}</text>
    </svg>
  )
}

// Revenue projection bar chart
export function RevenueChart({ data }) {
  if (!data || !data.length) return null
  const w = 280, h = 160, pad = { top: 16, right: 12, bottom: 30, left: 44 }
  const chartW = w - pad.left - pad.right
  const chartH = h - pad.top - pad.bottom
  const max = Math.max(...data.map(d => d.value || 0), 1)
  const barW = (chartW / data.length) * 0.6
  const gap = chartW / data.length

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {/* Y axis */}
      <line x1={pad.left} y1={pad.top} x2={pad.left} y2={pad.top + chartH} stroke="#e5e7eb" strokeWidth={1} />
      {/* X axis */}
      <line x1={pad.left} y1={pad.top + chartH} x2={pad.left + chartW} y2={pad.top + chartH} stroke="#e5e7eb" strokeWidth={1} />

      {/* Y grid lines and labels */}
      {[0, 0.25, 0.5, 0.75, 1].map(frac => {
        const y = pad.top + chartH - frac * chartH
        return (
          <g key={frac}>
            <line x1={pad.left} y1={y} x2={pad.left + chartW} y2={y} stroke="#f3f4f6" strokeWidth={1} />
            <text x={pad.left - 4} y={y + 4} textAnchor="end" fontSize="8" fill="#9ca3af">{fmt(max * frac)}</text>
          </g>
        )
      })}

      {data.map((d, i) => {
        const barH = ((d.value || 0) / max) * chartH
        const x = pad.left + i * gap + (gap - barW) / 2
        const y = pad.top + chartH - barH
        const gradId = `bar-grad-${i}`
        return (
          <g key={i}>
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>
            </defs>
            <rect x={x} y={y} width={barW} height={barH} fill={`url(#${gradId})`} rx={2} />
            <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize="8" fill="#1d4ed8" fontWeight="600">{fmt(d.value)}</text>
            <text x={x + barW / 2} y={pad.top + chartH + 12} textAnchor="middle" fontSize="8" fill="#6b7280">{d.year}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Competitive positioning 2×2 matrix
export function CompetitiveChart({ data }) {
  if (!data || !data.length) return null
  const w = 260, h = 220, pad = 36
  const plotW = w - pad * 2
  const plotH = h - pad * 2 - 16

  function px(v) { return pad + (v / 10) * plotW }
  function py(v) { return pad + plotH - (v / 10) * plotH }

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
      {/* Quadrant backgrounds */}
      <rect x={pad} y={pad} width={plotW / 2} height={plotH / 2} fill="#fef3c7" opacity={0.4} />
      <rect x={pad + plotW / 2} y={pad} width={plotW / 2} height={plotH / 2} fill="#dcfce7" opacity={0.4} />
      <rect x={pad} y={pad + plotH / 2} width={plotW / 2} height={plotH / 2} fill="#fee2e2" opacity={0.4} />
      <rect x={pad + plotW / 2} y={pad + plotH / 2} width={plotW / 2} height={plotH / 2} fill="#dbeafe" opacity={0.4} />

      {/* Axes */}
      <line x1={pad} y1={pad} x2={pad} y2={pad + plotH} stroke="#9ca3af" strokeWidth={1.5} />
      <line x1={pad} y1={pad + plotH} x2={pad + plotW} y2={pad + plotH} stroke="#9ca3af" strokeWidth={1.5} />
      {/* Axis labels */}
      <text x={pad + plotW / 2} y={h - 4} textAnchor="middle" fontSize="9" fill="#6b7280">Innovation →</text>
      <text x={8} y={pad + plotH / 2} textAnchor="middle" fontSize="9" fill="#6b7280" transform={`rotate(-90, 8, ${pad + plotH / 2})`}>Accessibility →</text>

      {data.map((d, i) => {
        const x = px(d.innovation || 5)
        const y = py(d.accessibility || 5)
        const isUs = d.is_us
        const label = d.name || `Comp ${i + 1}`
        return (
          <g key={i}>
            <circle cx={x} cy={y} r={isUs ? 7 : 5} fill={isUs ? '#2563eb' : '#e5e7eb'} stroke={isUs ? '#1d4ed8' : '#9ca3af'} strokeWidth={1.5} />
            {isUs && <circle cx={x} cy={y} r={3} fill="#fff" />}
            <text x={x} y={y - 9} textAnchor="middle" fontSize={isUs ? 8 : 7} fill={isUs ? '#1d4ed8' : '#6b7280'} fontWeight={isUs ? '700' : '400'}>
              {label.length > 12 ? label.slice(0, 11) + '…' : label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function CommercialChartsPanel({ chartData, onClose }) {
  if (!chartData) return null
  return (
    <div style={{ marginTop: 16, padding: '16px 20px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ fontWeight: 700, fontSize: 14 }}>📊 Commercialization Charts</div>
        {onClose && <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280', fontSize: 14 }}>✕</button>}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {chartData.market && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: '#374151' }}>Market Opportunity</div>
            <MarketSizeChart data={chartData.market} />
            <div style={{ marginTop: 10, display: 'flex', gap: 12, fontSize: 11, color: '#6b7280' }}>
              <span>🔵 SOM: {fmt(chartData.market.som)}</span>
              <span>⬤ SAM: {fmt(chartData.market.sam)}</span>
              <span>○ TAM: {fmt(chartData.market.tam)}</span>
            </div>
          </div>
        )}
        {chartData.revenue && chartData.revenue.length > 0 && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: '#374151' }}>Revenue Projection (5-Year)</div>
            <RevenueChart data={chartData.revenue} />
          </div>
        )}
        {chartData.competitors && chartData.competitors.length > 1 && (
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: '14px 16px' }}>
            <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 10, color: '#374151' }}>Competitive Landscape</div>
            <CompetitiveChart data={chartData.competitors} />
            <div style={{ marginTop: 6, fontSize: 10, color: '#6b7280' }}>🔵 = Our solution · ○ = Competitors</div>
          </div>
        )}
      </div>
    </div>
  )
}
