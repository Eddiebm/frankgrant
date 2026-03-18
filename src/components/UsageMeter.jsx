import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi'

export default function UsageMeter() {
  const api = useApi()
  const [usage, setUsage] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadUsage()
  }, [])

  async function loadUsage() {
    try {
      const data = await api.getUsage()
      setUsage(data)
    } catch (e) {
      console.error('Failed to load usage:', e)
    }
    setLoading(false)
  }

  if (loading || !usage) return null

  const { monthly } = usage
  const percentage = Math.min(100, monthly.percentage || 0)
  const isNearLimit = percentage > 80
  const isOverLimit = percentage >= 100

  const barColor = isOverLimit ? '#dc2626' : isNearLimit ? '#f59e0b' : '#059669'

  return (
    <div style={{
      padding: '0.75rem 1rem',
      background: '#f8f8f8',
      border: '0.5px solid #e5e5e5',
      borderRadius: 8,
      marginBottom: '1rem'
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={{ fontSize: 11, fontWeight: 500, color: '#666', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Monthly Usage ({monthly.tier})
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: barColor }}>
          ${monthly.cost.toFixed(2)} / ${monthly.limit.toFixed(2)}
        </span>
      </div>

      <div style={{
        width: '100%',
        height: 6,
        background: '#e5e5e5',
        borderRadius: 3,
        overflow: 'hidden',
        marginBottom: 4
      }}>
        <div style={{
          width: `${percentage}%`,
          height: '100%',
          background: barColor,
          transition: 'width 0.3s, background 0.3s'
        }} />
      </div>

      {isOverLimit && (
        <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>
          ⚠️ Monthly budget exceeded. Upgrade tier or wait until next month.
        </div>
      )}

      {isNearLimit && !isOverLimit && (
        <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 4 }}>
          ⚠️ Approaching monthly limit ({percentage.toFixed(0)}% used)
        </div>
      )}

      <details style={{ marginTop: 8 }}>
        <summary style={{ fontSize: 11, color: '#666', cursor: 'pointer', userSelect: 'none' }}>
          Show breakdown
        </summary>
        <div style={{ marginTop: 8, fontSize: 11, color: '#555' }}>
          {monthly.breakdown.map((item, i) => (
            <div key={i} style={{ marginBottom: 4 }}>
              <strong>{item.model === 'claude-sonnet-4-20250514' ? 'Sonnet' : 'Haiku'}:</strong>{' '}
              {item.calls} calls, {(item.input_tokens / 1000).toFixed(1)}K in, {(item.output_tokens / 1000).toFixed(1)}K out
              {item.cache_read_tokens > 0 && `, ${(item.cache_read_tokens / 1000).toFixed(1)}K cached`}
              {' - '}${item.cost.toFixed(2)}
            </div>
          ))}
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: '0.5px solid #e5e5e5', fontSize: 10, color: '#888' }}>
            All-time: {usage.all_time.total_calls} calls, {(usage.all_time.total_tokens / 1000).toFixed(1)}K tokens
          </div>
        </div>
      </details>
    </div>
  )
}
