import { Component } from 'react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      const isProd = import.meta.env.PROD
      return (
        <div style={{ padding: 40, textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 16 }}>⚠️</div>
          <h2>Something went wrong.</h2>
          <p style={{ color: '#6b7280', marginBottom: 16 }}>Please refresh the page to continue.</p>
          {!isProd && (
            <pre style={{ color: '#dc2626', fontSize: 12, textAlign: 'left', maxWidth: 600, margin: '0 auto 16px', background: '#fef2f2', padding: 12, borderRadius: 6, overflowX: 'auto' }}>
              {this.state.error?.toString()}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{ padding: '10px 20px', background: '#0e7490', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 500 }}
          >
            Refresh Page
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
