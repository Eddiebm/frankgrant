import { SignedIn, SignedOut, SignIn } from '@clerk/clerk-react'
import Dashboard from './components/Dashboard'
import ErrorBoundary from './components/ErrorBoundary'
import FeedbackButton from './components/FeedbackButton'

export default function App() {
  return (
    <ErrorBoundary>
      <SignedOut>
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1.5rem',
          padding: '2rem',
        }}>
          <div style={{ textAlign: 'center', marginBottom: '1rem' }}>
            <h1 style={{ fontSize: '28px', fontWeight: '500', marginBottom: '6px' }}>FrankGrant</h1>
            <p style={{ fontSize: '14px', color: '#666' }}>NIH grant writing & scoring · COARE Holdings</p>
          </div>
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        <Dashboard />
        <FeedbackButton />
      </SignedIn>
    </ErrorBoundary>
  )
}
