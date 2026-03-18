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
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          textAlign: 'center'
        }}>
          <div style={{
            maxWidth: 500,
            padding: '2rem',
            border: '0.5px solid #e5e5e5',
            borderRadius: 12,
            background: '#fafafa'
          }}>
            <h1 style={{ fontSize: 20, fontWeight: 500, marginBottom: '0.5rem' }}>
              Something went wrong
            </h1>
            <p style={{ fontSize: 14, color: '#666', marginBottom: '1.5rem', lineHeight: 1.6 }}>
              An unexpected error occurred. Please refresh the page and try again.
            </p>
            <div style={{
              padding: '0.75rem',
              background: '#fff',
              border: '0.5px solid #e5e5e5',
              borderRadius: 6,
              fontSize: 12,
              fontFamily: 'monospace',
              color: '#dc2626',
              textAlign: 'left',
              marginBottom: '1.5rem',
              maxHeight: 200,
              overflowY: 'auto'
            }}>
              {this.state.error?.toString()}
            </div>
            <button
              onClick={() => window.location.reload()}
              style={{
                padding: '10px 20px',
                fontSize: 14,
                fontWeight: 500,
                border: 'none',
                borderRadius: 8,
                cursor: 'pointer',
                background: '#111',
                color: '#fff'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
