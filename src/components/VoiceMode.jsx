import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

// Waveform bar animation styles injected once
const WAVEFORM_CSS = `
@keyframes voiceBar {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}
.voice-bar {
  width: 4px; height: 40px; background: #2dd4bf;
  border-radius: 2px; margin: 0 3px; transform-origin: bottom;
  display: inline-block;
}
.voice-bar.listening { animation: voiceBar 0.6s ease-in-out infinite; }
.voice-bar.speaking  { animation: voiceBar 0.4s ease-in-out infinite; }
.voice-bar:nth-child(2) { animation-delay: 0.1s; }
.voice-bar:nth-child(3) { animation-delay: 0.2s; }
.voice-bar:nth-child(4) { animation-delay: 0.3s; }
.voice-bar:nth-child(5) { animation-delay: 0.4s; }
`

function injectCSS() {
  if (typeof document !== 'undefined' && !document.getElementById('voice-css')) {
    const style = document.createElement('style')
    style.id = 'voice-css'
    style.textContent = WAVEFORM_CSS
    document.head.appendChild(style)
  }
}

export default function VoiceMode({ project, onSectionGenerated, onSectionUpdated, onClose }) {
  const { getToken } = useAuth()

  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [lastResponse, setLastResponse] = useState('')
  const [conversationHistory, setConversationHistory] = useState([])
  const [sessionCost, setSessionCost] = useState(0)
  const [currentFocus, setCurrentFocus] = useState('General')
  const [paused, setPaused] = useState(false)

  const recognitionRef = useRef(null)
  const audioRef = useRef(null)

  const setup = project?.setup || {}
  const piName = setup.pi || 'the researcher'
  const lastName = piName.trim().split(' ').pop() || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const sectionsGenerated = Object.values(project?.sections || {}).filter(s => s?.length > 0).length

  useEffect(() => {
    injectCSS()
    loadSession()

    return () => {
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }
      if (audioRef.current) { audioRef.current.pause() }
      window.speechSynthesis?.cancel()
    }
  }, [])

  async function loadSession() {
    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/voice/session?project_id=${project.id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        if (data.conversation_history?.length > 0) {
          setConversationHistory(data.conversation_history)
          setSessionCost(data.session_cost || 0)
          await speakText(`Welcome back, Dr. ${lastName}. Ready to continue with your ${project.mechanism || 'grant'} application.`)
          return
        }
      }
    } catch {}

    // Welcome message
    const welcome = `${greeting}, Dr. ${lastName}. I'm ready to help with your ${project.mechanism || 'NIH'} application${setup.disease ? ` on ${setup.disease}` : ''}. You have ${sectionsGenerated} sections complete. What would you like to work on?`
    setLastResponse(welcome)
    await speakText(welcome)
  }

  async function saveSession() {
    try {
      const token = await getToken()
      await fetch(`${API_BASE}/voice/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          project_id: project.id,
          conversation_history: conversationHistory,
          session_cost: sessionCost,
          summary: null,
        }),
      })
    } catch {}
  }

  const speakText = useCallback(async (text) => {
    if (!text) return
    setIsSpeaking(true)

    const wordCount = text.trim().split(/\s+/).length

    if (wordCount > 50) {
      try {
        const token = await getToken()
        const resp = await fetch(`${API_BASE}/voice/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, use_elevenlabs: true }),
        })
        const contentType = resp.headers.get('Content-Type') || ''
        if (resp.ok && contentType.includes('audio')) {
          const buffer = await resp.arrayBuffer()
          const blob = new Blob([buffer], { type: 'audio/mpeg' })
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioRef.current = audio
          audio.onended = () => {
            URL.revokeObjectURL(url)
            audioRef.current = null
            setIsSpeaking(false)
          }
          audio.onerror = () => {
            URL.revokeObjectURL(url)
            setIsSpeaking(false)
            useBrowserTTS(text)
          }
          await audio.play()
          return
        }
      } catch {}
    }

    useBrowserTTS(text)
  }, [getToken])

  function useBrowserTTS(text) {
    if (typeof window === 'undefined' || !window.speechSynthesis) {
      setIsSpeaking(false)
      return
    }
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 0.88
    utterance.pitch = 1.0
    utterance.onend = () => setIsSpeaking(false)
    utterance.onerror = () => setIsSpeaking(false)
    window.speechSynthesis.speak(utterance)
  }

  function startListening() {
    if (typeof window === 'undefined') return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      alert('Speech recognition is not supported in this browser. Try Chrome or Edge.')
      return
    }

    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1]
      setTranscript(result[0].transcript)
    }
    recognition.onend = () => {
      setIsListening(false)
      const finalTranscript = recognitionRef.current?._finalTranscript
      if (finalTranscript) processMessage(finalTranscript)
    }
    recognition.onspeechend = () => {
      recognition._finalTranscript = transcript
      recognition.stop()
    }
    recognition.onerror = (e) => {
      if (e.error !== 'no-speech') console.error('Speech error:', e.error)
      setIsListening(false)
    }

    recognition._finalTranscript = ''
    recognition.start()
  }

  function stopListening() {
    if (recognitionRef.current) {
      recognitionRef.current._finalTranscript = transcript
      recognitionRef.current.stop()
    }
    setIsListening(false)
  }

  function toggleListening() {
    if (isSpeaking) {
      window.speechSynthesis?.cancel()
      if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
      setIsSpeaking(false)
    }
    if (isListening) {
      stopListening()
    } else {
      setTranscript('')
      startListening()
    }
  }

  async function processMessage(text) {
    if (!text?.trim()) return
    setIsProcessing(true)
    setTranscript('')

    const newHistory = [...conversationHistory, { role: 'user', content: text }]
    setConversationHistory(newHistory)

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/voice/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          project_id: project.id,
          conversation_history: newHistory.slice(-6),
          current_section: currentFocus,
        }),
      })
      const data = await res.json()
      const responseText = data.response || 'I had trouble processing that. Could you repeat?'

      // Update focus based on intent
      if (data.intent === 'READ_SECTION' || data.intent === 'EDIT_SECTION' || data.intent === 'GENERATE' || data.intent === 'NAVIGATION') {
        // Extract section from action or use a label
        const sectionLabels = { aims: 'Specific Aims', sig: 'Significance', innov: 'Innovation', approach: 'Approach', summary: 'Summary', narrative: 'Narrative', data_mgmt: 'Data Management', facilities: 'Facilities', commercial: 'Commercialization' }
        const sec = data.action?.section
        if (sec) setCurrentFocus(sectionLabels[sec] || sec)
      } else if (data.intent === 'COMPLIANCE') setCurrentFocus('Compliance')
      else if (data.intent === 'PRELIM_DATA') setCurrentFocus('Prelim Data')
      else if (data.intent === 'STUDY_SECTION') setCurrentFocus('Study Section')

      // Cost tracking (~$0.0045 per 300 token response)
      const estimatedCost = (data.tokens_used || 0) / 1e6 * 15
      setSessionCost(c => c + estimatedCost)

      const updatedHistory = [...newHistory, { role: 'assistant', content: responseText }]
      setConversationHistory(updatedHistory)
      setLastResponse(responseText)

      // Handle actions
      if (data.action?.type === 'generate' && onSectionGenerated) {
        onSectionGenerated(data.action.section)
        const confirmText = `I'm generating your ${data.action.section} section now. I'll let you know when it's ready.`
        await speakText(confirmText)
      } else if (data.action?.type === 'edit' && onSectionUpdated) {
        onSectionUpdated(data.action.section, text)
        await speakText(responseText)
      } else {
        await speakText(responseText)
      }

      // Every 6 exchanges, save session
      if (updatedHistory.length % 6 === 0) {
        saveSession()
      }
    } catch (e) {
      const errorText = 'I had a connection issue. Please try again.'
      setLastResponse(errorText)
      await speakText(errorText)
    }

    setIsProcessing(false)
  }

  function handlePause() {
    if (paused) {
      window.speechSynthesis?.resume()
      if (audioRef.current) audioRef.current.play()
      setPaused(false)
    } else {
      window.speechSynthesis?.pause()
      if (audioRef.current) audioRef.current.pause()
      setPaused(true)
    }
  }

  async function handleExit() {
    if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    await saveSession()
    onClose()
  }

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); toggleListening() }
      if (e.code === 'Escape') handleExit()
      if (e.code === 'KeyP') handlePause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isListening, isSpeaking, paused])

  const focusLabels = {
    'General': '💬 General',
    'Specific Aims': '📄 Aims',
    'Significance': '📊 Significance',
    'Innovation': '💡 Innovation',
    'Approach': '🔬 Approach',
    'Compliance': '✅ Compliance',
    'Prelim Data': '📎 Prelim Data',
    'Study Section': '🎓 Study Section',
    'Summary': '📋 Summary',
  }

  const barState = isListening ? 'listening' : isSpeaking ? 'speaking' : ''
  const statusText = isListening ? 'Listening...' : isProcessing ? 'Thinking...' : isSpeaking ? 'Speaking...' : 'Tap to speak'

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      zIndex: 2000, fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Top bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        display: 'flex', alignItems: 'center', padding: '16px 24px',
        borderBottom: '0.5px solid rgba(255,255,255,0.08)',
      }}>
        <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(project?.title || 'Grant').slice(0, 40)}
        </div>
        <div style={{ fontSize: 12, color: '#2dd4bf', fontWeight: 500 }}>
          {focusLabels[currentFocus] || `💬 ${currentFocus}`}
        </div>
        <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.4)', textAlign: 'right' }}>
          ${sessionCost.toFixed(4)}
        </div>
      </div>

      {/* Center: Waveform + Status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        {/* Waveform */}
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 60, marginBottom: 8 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`voice-bar${barState ? ` ${barState}` : ''}`} />
          ))}
        </div>

        {/* Status */}
        <div style={{ fontSize: 12, color: isListening ? '#2dd4bf' : isProcessing ? '#f59e0b' : isSpeaking ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase' }}>
          {statusText}
        </div>

        {/* Live transcript */}
        {transcript && (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, fontStyle: 'italic', maxWidth: 500, textAlign: 'center', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            "{transcript}"
          </div>
        )}

        {/* Last response */}
        {lastResponse && !transcript && (
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, maxWidth: 520, textAlign: 'center', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {lastResponse}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{ position: 'absolute', bottom: 40, display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Pause */}
        <button
          onClick={handlePause}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: '0.5px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Pause / Resume (P)"
        >
          {paused ? '▶' : '⏸'}
        </button>

        {/* Mic button */}
        <button
          onClick={toggleListening}
          disabled={isProcessing}
          style={{
            width: 72, height: 72, borderRadius: '50%', border: 'none',
            background: isListening ? '#ef4444' : isProcessing ? '#374151' : 'rgba(255,255,255,0.9)',
            color: isListening ? '#fff' : '#111',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.2s',
            boxShadow: isListening ? '0 0 0 8px rgba(239,68,68,0.3)' : '0 4px 20px rgba(0,0,0,0.4)',
          }}
          title="Toggle listening (Space)"
        >
          {isListening ? '■' : isProcessing ? '…' : '🎤'}
        </button>

        {/* Exit */}
        <button
          onClick={handleExit}
          style={{
            width: 44, height: 44, borderRadius: '50%', border: '0.5px solid rgba(255,255,255,0.2)',
            background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)',
            cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          title="Exit Voice Mode (Esc)"
        >
          ✕
        </button>
      </div>

      {/* Keyboard hint */}
      <div style={{ position: 'absolute', bottom: 12, fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '.05em' }}>
        SPACE to speak · P to pause · ESC to exit
      </div>
    </div>
  )
}
