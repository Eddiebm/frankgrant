import { useState } from 'react'
import { useApi } from '../hooks/useApi'

export default function FeedbackButton() {
  const api = useApi()
  const [isOpen, setIsOpen] = useState(false)
  const [feedbackType, setFeedbackType] = useState('general')
  const [message, setMessage] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function submitFeedback() {
    if (!message.trim()) return

    setSubmitting(true)
    try {
      await fetch(`${import.meta.env.VITE_WORKER_URL}/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${await api.getToken()}`
        },
        body: JSON.stringify({
          feedback_type: feedbackType,
          message: message.trim(),
          page: window.location.pathname
        })
      })

      alert('Thank you for your feedback!')
      setMessage('')
      setIsOpen(false)
    } catch (e) {
      alert('Failed to submit feedback: ' + e.message)
    }
    setSubmitting(false)
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          width: 50,
          height: 50,
          borderRadius: '50%',
          background: '#111',
          color: '#fff',
          border: 'none',
          fontSize: 20,
          cursor: 'pointer',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          zIndex: 1000,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
        title="Send feedback"
      >
        💬
      </button>

      {isOpen && (
        <>
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              background: 'rgba(0,0,0,0.5)',
              zIndex: 1001
            }}
          />
          <div
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              background: '#fff',
              borderRadius: 12,
              padding: '2rem',
              width: '90%',
              maxWidth: 500,
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
              zIndex: 1002
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 500, marginBottom: '1rem' }}>Send Feedback</h2>

            <div style={{ marginBottom: '1rem' }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Type
              </label>
              <select
                value={feedbackType}
                onChange={e => setFeedbackType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  border: '0.5px solid #e5e5e5',
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: 'inherit'
                }}
              >
                <option value="bug">Bug Report</option>
                <option value="feature">Feature Request</option>
                <option value="general">General Feedback</option>
                <option value="compliment">Compliment</option>
              </select>
            </div>

            <div style={{ marginBottom: '1.5rem' }}>
              <label style={{ fontSize: 13, fontWeight: 500, display: 'block', marginBottom: 6 }}>
                Message
              </label>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Tell us what's on your mind..."
                style={{
                  width: '100%',
                  minHeight: 120,
                  padding: '8px 12px',
                  border: '0.5px solid #e5e5e5',
                  borderRadius: 8,
                  fontSize: 13,
                  fontFamily: 'inherit',
                  resize: 'vertical'
                }}
              />
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setIsOpen(false)}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  fontSize: 14,
                  border: '0.5px solid #e5e5e5',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: '#fff',
                  color: '#666'
                }}
              >
                Cancel
              </button>
              <button
                onClick={submitFeedback}
                disabled={submitting || !message.trim()}
                style={{
                  flex: 1,
                  padding: '10px 16px',
                  fontSize: 14,
                  fontWeight: 500,
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  background: '#111',
                  color: '#fff',
                  opacity: submitting || !message.trim() ? 0.5 : 1
                }}
              >
                {submitting ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  )
}
