import { useState, useEffect, useRef, useCallback } from 'react'
import { useAuth } from '@clerk/clerk-react'

const API_BASE = import.meta.env.VITE_WORKER_URL || '/api'

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

const NIH_SECTION_ORDER = [
  { id: 'summary', label: 'Project Summary' },
  { id: 'narrative', label: 'Project Narrative' },
  { id: 'aims', label: 'Specific Aims' },
  { id: 'sig', label: 'Significance' },
  { id: 'innov', label: 'Innovation' },
  { id: 'approach', label: 'Approach' },
  { id: 'data_mgmt', label: 'Data Management Plan' },
  { id: 'facilities', label: 'Facilities' },
  { id: 'commercial', label: 'Commercialization' },
]

const ELEVENLABS_VOICES = [
  { id: 'pNInz6obpgDQGcFmaJgB', label: 'Professional Male', name: 'Adam' },
  { id: '21m00Tcm4TlvDq8ikWAM', label: 'Professional Female', name: 'Rachel' },
  { id: 'ErXwobaYiN019PkySvjV', label: 'Academic Male', name: 'Antoni' },
  { id: 'MF3mGyEYCl7XYWbV9V8O', label: 'Academic Female', name: 'Elli' },
]

export default function VoiceMode({ project, onSectionGenerated, onSectionUpdated, onClose }) {
  const { getToken } = useAuth()

  const [voiceEnabled, setVoiceEnabled] = useState(null) // null=loading, true/false
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [lastResponse, setLastResponse] = useState('')
  const [conversationHistory, setConversationHistory] = useState([])
  const [sessionCost, setSessionCost] = useState(0)
  const [currentFocus, setCurrentFocus] = useState('General')
  const [paused, setPaused] = useState(false)

  // Read All mode
  const [readingAll, setReadingAll] = useState(false)
  const [readProgress, setReadProgress] = useState(null) // {current, total, sectionName}
  const readingAllRef = useRef(false)

  // Dictate mode
  const [dictateMode, setDictateMode] = useState(false)
  const [dictateSection, setDictateSection] = useState(null)
  const [dictateAccumulated, setDictateAccumulated] = useState('')
  const dictateRef = useRef(null)

  // Edit diff modal
  const [editModal, setEditModal] = useState(null) // {sectionId, original, edited}

  // Speed control
  const [speechRate, setSpeechRate] = useState(0.88)

  // Voice selection
  const [selectedVoiceId, setSelectedVoiceId] = useState(() => localStorage.getItem('fg_voice_id') || 'pNInz6obpgDQGcFmaJgB')
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)

  const recognitionRef = useRef(null)
  const audioRef = useRef(null)
  const peekRef = useRef(null)
  const isSpeakingRef = useRef(false)

  const setup = project?.setup || {}
  const piName = setup.pi || 'the researcher'
  const lastName = piName.trim().split(' ').pop() || 'there'
  const hour = new Date().getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const sectionsGenerated = Object.values(project?.sections || {}).filter(s => s?.length > 0).length

  useEffect(() => {
    injectCSS()
    async function init() {
      try {
        const token = await getToken()
        const res = await fetch(`${API_BASE}/users/me`, { headers: { Authorization: `Bearer ${token}` } })
        const data = await res.json()
        setVoiceEnabled(data.voice_enabled === true)
        if (data.voice_enabled === true) loadSession()
      } catch {
        setVoiceEnabled(false)
      }
    }
    init()
    return () => {
      if (recognitionRef.current) { try { recognitionRef.current.stop() } catch {} }
      if (dictateRef.current) { try { dictateRef.current.stop() } catch {} }
      if (peekRef.current) { try { peekRef.current.stop() } catch {} }
      if (audioRef.current) { audioRef.current.pause() }
      window.speechSynthesis?.cancel()
    }
  }, [])

  // Start/stop peek recognition when speaking starts/stops
  useEffect(() => {
    isSpeakingRef.current = isSpeaking
    if (isSpeaking) {
      startPeekRecognition()
    } else {
      stopPeekRecognition()
    }
  }, [isSpeaking])

  function startPeekRecognition() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    try {
      const r = new SR()
      peekRef.current = r
      r.continuous = false
      r.interimResults = true
      r.lang = 'en-US'
      r.onresult = (e) => {
        const spoken = e.results[0]?.[0]?.transcript?.trim()
        if (spoken && isSpeakingRef.current) {
          // User started speaking — interrupt playback
          window.speechSynthesis?.cancel()
          if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
          readingAllRef.current = false
          setReadingAll(false)
          setReadProgress(null)
          setIsSpeaking(false)
          isSpeakingRef.current = false
          setTranscript(spoken)
          setTimeout(() => startListening(), 100)
        }
      }
      r.onerror = () => {}
      r.onend = () => { if (isSpeakingRef.current) setTimeout(startPeekRecognition, 200) }
      r.start()
    } catch {}
  }

  function stopPeekRecognition() {
    if (peekRef.current) { try { peekRef.current.stop() } catch {}; peekRef.current = null }
  }

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
        body: JSON.stringify({ project_id: project.id, conversation_history: conversationHistory, session_cost: sessionCost, summary: null }),
      })
    } catch {}
  }

  const speakText = useCallback(async (text) => {
    if (!text) return
    setIsSpeaking(true)
    isSpeakingRef.current = true
    const wordCount = text.trim().split(/\s+/).length

    if (wordCount > 30) {
      try {
        const token = await getToken()
        const resp = await fetch(`${API_BASE}/voice/speak`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ text, use_elevenlabs: true, voice_id: selectedVoiceId }),
        })
        const contentType = resp.headers.get('Content-Type') || ''
        if (resp.ok && contentType.includes('audio')) {
          const buffer = await resp.arrayBuffer()
          const blob = new Blob([buffer], { type: 'audio/mpeg' })
          const url = URL.createObjectURL(blob)
          const audio = new Audio(url)
          audioRef.current = audio
          await new Promise((resolve) => {
            audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; setIsSpeaking(false); isSpeakingRef.current = false; resolve() }
            audio.onerror = () => { URL.revokeObjectURL(url); resolve(); useBrowserTTS(text) }
            audio.play().catch(() => { URL.revokeObjectURL(url); resolve(); useBrowserTTS(text) })
          })
          return
        }
      } catch {}
    }
    await useBrowserTTS(text)
  }, [getToken, selectedVoiceId, speechRate])

  function useBrowserTTS(text) {
    return new Promise((resolve) => {
      if (typeof window === 'undefined' || !window.speechSynthesis) { setIsSpeaking(false); isSpeakingRef.current = false; resolve(); return }
      window.speechSynthesis.cancel()
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = speechRate
      utterance.pitch = 1.0
      utterance.onend = () => { setIsSpeaking(false); isSpeakingRef.current = false; resolve() }
      utterance.onerror = () => { setIsSpeaking(false); isSpeakingRef.current = false; resolve() }
      window.speechSynthesis.speak(utterance)
    })
  }

  // ── Read All Sections ──────────────────────────────────────────────────────
  async function readAllSections() {
    const sections = project?.sections || {}
    const toRead = NIH_SECTION_ORDER.filter(s => sections[s.id]?.length > 20)
    if (toRead.length === 0) {
      await speakText('No sections have been generated yet. Try generating some sections first.')
      return
    }
    readingAllRef.current = true
    setReadingAll(true)
    setCurrentFocus('Reading All')
    await speakText(`Reading your complete ${project.mechanism || 'NIH'} application. ${toRead.length} sections. Say anything to interrupt.`)

    for (let i = 0; i < toRead.length; i++) {
      if (!readingAllRef.current) break
      const { id, label } = toRead[i]
      setReadProgress({ current: i + 1, total: toRead.length, sectionName: label })
      if (!readingAllRef.current) break
      await speakText(`Section ${i + 1} of ${toRead.length}. ${label}.`)
      if (!readingAllRef.current) break
      await speakText(sections[id])
      if (!readingAllRef.current) break
    }

    if (readingAllRef.current) {
      setReadProgress(null)
      await speakText("That's the complete application. What would you like to work on?")
    }
    readingAllRef.current = false
    setReadingAll(false)
  }

  function stopReadingAll() {
    readingAllRef.current = false
    setReadingAll(false)
    setReadProgress(null)
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    setIsSpeaking(false)
    isSpeakingRef.current = false
  }

  // ── Dictate Mode ───────────────────────────────────────────────────────────
  async function startDictateMode(sectionLabel, sectionId) {
    setDictateMode(true)
    setDictateSection({ label: sectionLabel, id: sectionId })
    setDictateAccumulated('')
    await speakText(`I'm listening. Describe your ${sectionLabel} in as much detail as you can. Say "done" when finished.`)

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { setDictateMode(false); return }

    const recognition = new SR()
    dictateRef.current = recognition
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    let finalText = ''
    recognition.onresult = (e) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript + ' '
        else interim = e.results[i][0].transcript
      }
      const combined = finalText + interim
      setDictateAccumulated(combined)
      setTranscript(combined.slice(-120))

      const lower = finalText.toLowerCase().trim()
      if (lower.endsWith('done.') || lower.endsWith(' done') || lower.endsWith('finish.') || lower.endsWith(' finish') || lower.endsWith("that's all.") || lower.endsWith("that's all")) {
        const cleaned = finalText.replace(/\b(done|finish|that'?s all)\b\.?\s*$/i, '').trim()
        recognition.stop()
        processDictation(cleaned, sectionId)
      }
    }
    recognition.onerror = (e) => { if (e.error !== 'no-speech') { setDictateMode(false); setTranscript('') } }
    recognition.onend = () => { if (dictateMode) {} }
    recognition.start()
  }

  async function processDictation(dictatedText, sectionId) {
    setDictateMode(false)
    setTranscript('')
    if (!dictatedText?.trim()) return
    setIsProcessing(true)
    await speakText("Processing your dictation. Writing this up in NIH style now.")

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/voice/dictate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ project_id: project.id, section_id: sectionId, transcript: dictatedText }),
      })
      const data = await res.json()
      if (data.content && onSectionUpdated) {
        onSectionUpdated(sectionId, data.content)
        setLastResponse(`I've written your ${sectionId} section from your dictation, preserving all your specific scientific details. Would you like me to read it back?`)
        await speakText(`I've written your ${sectionId} section from your dictation, preserving all your specific scientific details. Say "read it" to hear it.`)
      } else {
        await speakText("I had trouble processing your dictation. Please try again.")
      }
    } catch {
      await speakText("I had a connection issue processing your dictation. Please try again.")
    }
    setIsProcessing(false)
  }

  function stopDictate() {
    if (dictateRef.current) { try { dictateRef.current.stop() } catch {}; dictateRef.current = null }
    setDictateMode(false)
    setDictateAccumulated('')
    setTranscript('')
  }

  // ── Voice Edit ─────────────────────────────────────────────────────────────
  async function processVoiceEdit(instruction, sectionId) {
    const sections = project?.sections || {}
    const content = sections[sectionId]
    if (!content) { await speakText(`The ${sectionId} section hasn't been generated yet.`); return }

    setIsProcessing(true)
    await speakText(`Making that edit to your ${sectionId} section now.`)

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/voice/edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ section_id: sectionId, instruction, content }),
      })
      const data = await res.json()
      if (data.edited) {
        setEditModal({ sectionId, original: content, edited: data.edited })
        await speakText("I've made the edit. You can see the changes on screen. Say 'accept' to apply it, or 'discard' to keep the original.")
      } else {
        await speakText("I had trouble making that edit. Please try again.")
      }
    } catch {
      await speakText("Connection issue. Please try again.")
    }
    setIsProcessing(false)
  }

  async function acceptEdit() {
    if (!editModal) return
    if (onSectionUpdated) onSectionUpdated(editModal.sectionId, editModal.edited)
    setEditModal(null)
    await speakText("Edit applied. What would you like to work on next?")
  }

  async function discardEdit() {
    setEditModal(null)
    await speakText("Edit discarded. Original kept. What else would you like to do?")
  }

  // ── Voice Study Section ────────────────────────────────────────────────────
  async function runVoiceStudySection() {
    setIsProcessing(true)
    setCurrentFocus('Study Section')
    await speakText("Running the study section simulation. This takes about a minute. I'll update you every fifteen seconds.")

    const updateInterval = setInterval(async () => {
      const updates = [
        "Still running. Reviewer one is evaluating Significance and Innovation.",
        "Still running. Reviewer two is assessing clinical relevance.",
        "Nearly done. Synthesizing the three reviewer critiques.",
      ]
      const idx = Math.floor((Date.now() / 15000) % updates.length)
      const utterance = new SpeechSynthesisUtterance(updates[idx])
      utterance.rate = speechRate
      window.speechSynthesis.speak(utterance)
    }, 15000)

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/projects/${project.id}/study-section`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      })
      clearInterval(updateInterval)
      const data = await res.json()

      let resultText = "The study section is complete. "
      if (data.summary) {
        resultText += `Your impact score is ${data.summary.impact_score} out of 90. ${data.summary.fundability}. `
        if (data.summary.strengths?.length > 0) resultText += `Key strength: ${data.summary.strengths[0]}. `
        if (data.summary.weaknesses?.length > 0) resultText += `Primary weakness: ${data.summary.weaknesses[0]}. `
      }
      resultText += "Would you like to hear the full reviewer critiques?"
      setLastResponse(resultText)
      await speakText(resultText)
    } catch {
      clearInterval(updateInterval)
      await speakText("I had trouble running the study section. Please try again.")
    }
    setIsProcessing(false)
  }

  // ── Local command detection ────────────────────────────────────────────────
  function checkLocalCommands(text) {
    const lower = text.toLowerCase().trim()

    // Read all
    if (/read\s+(me\s+)?my\s+(whole|entire|full|complete)\s+grant|read\s+the\s+entire\s+application|start\s+from\s+the\s+beginning/.test(lower)) {
      readAllSections()
      return true
    }
    // Stop reading
    if (readingAll && /stop|pause|enough|that'?s\s+(enough|ok)|halt/.test(lower)) {
      stopReadingAll()
      setLastResponse('Stopped reading.')
      return true
    }

    // Dictate mode
    const dictateMatch = lower.match(/(?:let\s+me\s+describe\s+my|i\s+want\s+to\s+dictate|let'?s\s+write)\s+(.+?)(?:\s+together|$)/)
    if (dictateMatch || /i\s+want\s+to\s+dictate/.test(lower)) {
      let sectionLabel = 'approach', sectionId = 'approach'
      const labelMap = { aims: { label: 'Specific Aims', id: 'aims' }, significance: { label: 'Significance', id: 'sig' }, innovation: { label: 'Innovation', id: 'innov' }, approach: { label: 'Approach', id: 'approach' }, summary: { label: 'Project Summary', id: 'summary' }, narrative: { label: 'Project Narrative', id: 'narrative' } }
      if (dictateMatch?.[1]) {
        for (const [key, val] of Object.entries(labelMap)) {
          if (dictateMatch[1].includes(key)) { sectionLabel = val.label; sectionId = val.id; break }
        }
      }
      startDictateMode(sectionLabel, sectionId)
      return true
    }

    // Speed control
    if (/read\s+faster|speak\s+faster|faster\s+please/.test(lower)) {
      const newRate = Math.min(1.4, speechRate + 0.15)
      setSpeechRate(newRate)
      const label = newRate >= 1.3 ? 'fast' : newRate >= 1.1 ? 'faster' : 'normal'
      speakText(`Reading at ${label} speed.`)
      return true
    }
    if (/read\s+slower|speak\s+slower|slower\s+please/.test(lower)) {
      const newRate = Math.max(0.6, speechRate - 0.15)
      setSpeechRate(newRate)
      speakText(`Reading at slower speed.`)
      return true
    }
    if (/normal\s+speed|regular\s+speed/.test(lower)) {
      setSpeechRate(0.88)
      speakText('Reading at normal speed.')
      return true
    }

    // Study section by voice
    if (/run\s+the\s+study\s+section|simulate\s+peer\s+review|run\s+peer\s+review/.test(lower)) {
      runVoiceStudySection()
      return true
    }

    // Accept / discard edit
    if (editModal && /^accept\b/.test(lower)) { acceptEdit(); return true }
    if (editModal && /^discard\b/.test(lower)) { discardEdit(); return true }

    return false
  }

  // ── Recognition ───────────────────────────────────────────────────────────
  function startListening() {
    if (typeof window === 'undefined') return
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) { alert('Speech recognition not supported. Try Chrome or Edge.'); return }

    const recognition = new SR()
    recognitionRef.current = recognition
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onstart = () => setIsListening(true)
    recognition.onresult = (e) => {
      const result = e.results[e.results.length - 1]
      setTranscript(result[0].transcript)
      if (result.isFinal) recognition._finalTranscript = result[0].transcript
    }
    recognition.onend = () => {
      setIsListening(false)
      const finalTranscript = recognition._finalTranscript || transcript
      if (finalTranscript?.trim()) processMessage(finalTranscript)
    }
    recognition.onspeechend = () => {
      if (!recognition._finalTranscript) recognition._finalTranscript = transcript
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
      isSpeakingRef.current = false
      readingAllRef.current = false
      setReadingAll(false)
      setReadProgress(null)
    }
    if (isListening) stopListening()
    else { setTranscript(''); startListening() }
  }

  async function processMessage(text) {
    if (!text?.trim()) return
    setIsProcessing(true)
    setTranscript('')

    // Check local commands first (no API call needed)
    if (checkLocalCommands(text)) {
      setIsProcessing(false)
      return
    }

    const newHistory = [...conversationHistory, { role: 'user', content: text }]
    setConversationHistory(newHistory)

    try {
      const token = await getToken()
      const res = await fetch(`${API_BASE}/voice/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ message: text, project_id: project.id, conversation_history: newHistory.slice(-6), current_section: currentFocus }),
      })
      const data = await res.json()
      const responseText = data.response || 'I had trouble processing that. Could you repeat?'

      if (data.intent === 'READ_SECTION' || data.intent === 'EDIT_SECTION' || data.intent === 'GENERATE' || data.intent === 'NAVIGATION') {
        const sectionLabels = { aims: 'Specific Aims', sig: 'Significance', innov: 'Innovation', approach: 'Approach', summary: 'Summary', narrative: 'Narrative', data_mgmt: 'Data Management', facilities: 'Facilities', commercial: 'Commercialization' }
        const sec = data.action?.section
        if (sec) setCurrentFocus(sectionLabels[sec] || sec)
      } else if (data.intent === 'COMPLIANCE') setCurrentFocus('Compliance')
      else if (data.intent === 'PRELIM_DATA') setCurrentFocus('Prelim Data')
      else if (data.intent === 'STUDY_SECTION') setCurrentFocus('Study Section')

      const estimatedCost = (data.tokens_used || 0) / 1e6 * 15
      setSessionCost(c => c + estimatedCost)
      const updatedHistory = [...newHistory, { role: 'assistant', content: responseText }]
      setConversationHistory(updatedHistory)
      setLastResponse(responseText)

      if (data.action?.type === 'generate' && onSectionGenerated) {
        onSectionGenerated(data.action.section)
        await speakText(`I'm generating your ${data.action.section} section now. I'll let you know when it's ready.`)
      } else if (data.action?.type === 'edit' && data.action?.instruction && data.action?.section) {
        await processVoiceEdit(data.action.instruction, data.action.section)
      } else {
        await speakText(responseText)
      }

      if (updatedHistory.length % 6 === 0) saveSession()
    } catch {
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
    if (dictateRef.current) { try { dictateRef.current.stop() } catch {} }
    if (peekRef.current) { try { peekRef.current.stop() } catch {} }
    window.speechSynthesis?.cancel()
    if (audioRef.current) { audioRef.current.pause(); audioRef.current = null }
    await saveSession()
    onClose()
  }

  function selectVoice(id) {
    setSelectedVoiceId(id)
    localStorage.setItem('fg_voice_id', id)
    setShowVoiceSettings(false)
    const voice = ELEVENLABS_VOICES.find(v => v.id === id)
    speakText(`Switched to ${voice?.label || 'selected'} voice.`)
  }

  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.code === 'Space') { e.preventDefault(); if (dictateMode) stopDictate(); else toggleListening() }
      if (e.code === 'Escape') { if (showVoiceSettings) setShowVoiceSettings(false); else if (editModal) discardEdit(); else handleExit() }
      if (e.code === 'KeyP') handlePause()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isListening, isSpeaking, paused, dictateMode, showVoiceSettings, editModal])

  const focusLabels = {
    'General': '💬 General', 'Specific Aims': '📄 Aims', 'Significance': '📊 Significance',
    'Innovation': '💡 Innovation', 'Approach': '🔬 Approach', 'Compliance': '✅ Compliance',
    'Prelim Data': '📎 Prelim Data', 'Study Section': '🎓 Study Section', 'Summary': '📋 Summary',
    'Reading All': '📖 Reading', 'Dictating': '🎙 Dictating',
  }

  const barState = isListening ? 'listening' : isSpeaking ? 'speaking' : ''
  const statusText = dictateMode ? 'Dictating — say "done" to finish' : readingAll ? `Reading ${readProgress?.sectionName || ''}…` : isListening ? 'Listening…' : isProcessing ? 'Thinking…' : isSpeaking ? 'Speaking…' : 'Tap to speak'

  // Loading state while checking entitlement
  if (voiceEnabled === null) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}>
        <div style={{ color: 'rgba(255,255,255,0.4)', fontSize: 14 }}>Loading…</div>
      </div>
    )
  }

  // Upgrade modal when voice is not enabled
  if (voiceEnabled === false) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000, fontFamily: 'system-ui, -apple-system, sans-serif' }}>
        <div style={{ background: '#1a1a2e', border: '1px solid rgba(45,212,191,0.25)', borderRadius: 16, padding: '40px 48px', maxWidth: 440, textAlign: 'center', position: 'relative' }}>
          <button onClick={onClose} style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'rgba(255,255,255,0.4)', cursor: 'pointer', fontSize: 20, lineHeight: 1 }}>×</button>
          <div style={{ fontSize: 36, marginBottom: 12 }}>🎤</div>
          <h2 style={{ color: '#fff', margin: '0 0 8px', fontSize: 22, fontWeight: 700 }}>Voice Mode</h2>
          <div style={{ color: '#2dd4bf', fontWeight: 600, fontSize: 16, marginBottom: 20 }}>
            $49/month individual · $99/month lab
          </div>
          <p style={{ color: 'rgba(255,255,255,0.65)', fontSize: 14, lineHeight: 1.6, margin: '0 0 28px' }}>
            Work with your grant through conversation. Have sections read aloud, dictate edits hands-free, run the study section simulation, and ask questions about your application — all by voice.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            {['📖 Read entire grant aloud', '🎙️ Dictate section edits', '🔬 Voice study section', '✏️ Edit by instruction'].map(f => (
              <span key={f} style={{ background: 'rgba(45,212,191,0.1)', border: '1px solid rgba(45,212,191,0.2)', borderRadius: 20, padding: '4px 12px', fontSize: 12, color: '#2dd4bf' }}>{f}</span>
            ))}
          </div>
          <button
            onClick={() => { onClose(); window.location.hash = '/upgrade/voice' }}
            style={{ marginTop: 28, width: '100%', padding: '14px', background: 'linear-gradient(135deg,#2dd4bf,#7c3aed)', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, fontSize: 16, cursor: 'pointer' }}
          >
            Add Voice Mode
          </button>
          <p style={{ marginTop: 12, fontSize: 12, color: 'rgba(255,255,255,0.3)' }}>
            Contact your admin if you believe you should have access.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', zIndex: 2000, fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* Top bar */}
      <div style={{ position: 'absolute', top: 0, left: 0, right: 0, display: 'flex', alignItems: 'center', padding: '16px 24px', borderBottom: '0.5px solid rgba(255,255,255,0.08)' }}>
        <div style={{ flex: 1, fontSize: 12, color: 'rgba(255,255,255,0.4)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {(project?.title || 'Grant').slice(0, 40)}
        </div>
        <div style={{ fontSize: 12, color: '#2dd4bf', fontWeight: 500 }}>
          {focusLabels[currentFocus] || `💬 ${currentFocus}`}
        </div>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.4)' }}>${sessionCost.toFixed(4)}</span>
          <button onClick={() => setShowVoiceSettings(true)} title="Voice settings" style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', cursor: 'pointer', fontSize: 16 }}>⚙️</button>
        </div>
      </div>

      {/* Read progress banner */}
      {readProgress && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', background: 'rgba(45,212,191,0.15)', border: '1px solid rgba(45,212,191,0.3)', borderRadius: 20, padding: '6px 20px', fontSize: 13, color: '#2dd4bf', display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
          <span>Reading section {readProgress.current} of {readProgress.total} — {readProgress.sectionName}</span>
          <button onClick={stopReadingAll} style={{ background: 'none', border: '1px solid rgba(45,212,191,0.5)', borderRadius: 10, padding: '2px 10px', color: '#2dd4bf', cursor: 'pointer', fontSize: 12 }}>Stop</button>
        </div>
      )}

      {/* Dictate mode banner */}
      {dictateMode && (
        <div style={{ position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 20, padding: '6px 20px', fontSize: 13, color: '#f87171', display: 'flex', alignItems: 'center', gap: 12, whiteSpace: 'nowrap' }}>
          <span>🎙 Dictating {dictateSection?.label || 'section'} — say "done" when finished</span>
          <button onClick={stopDictate} style={{ background: 'none', border: '1px solid rgba(239,68,68,0.5)', borderRadius: 10, padding: '2px 10px', color: '#f87171', cursor: 'pointer', fontSize: 12 }}>Cancel</button>
        </div>
      )}

      {/* Center: Waveform + Status */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 24 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', height: 60, marginBottom: 8 }}>
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className={`voice-bar${barState ? ` ${barState}` : ''}`} />
          ))}
        </div>
        <div style={{ fontSize: 12, color: dictateMode ? '#f87171' : isListening ? '#2dd4bf' : isProcessing ? '#f59e0b' : isSpeaking ? '#a78bfa' : 'rgba(255,255,255,0.4)', fontWeight: 500, letterSpacing: '.05em', textTransform: 'uppercase' }}>
          {statusText}
        </div>
        {transcript && !dictateMode && (
          <div style={{ color: 'rgba(255,255,255,0.5)', fontSize: 14, fontStyle: 'italic', maxWidth: 500, textAlign: 'center', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            "{transcript}"
          </div>
        )}
        {dictateMode && dictateAccumulated && (
          <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, maxWidth: 520, textAlign: 'center', lineHeight: 1.6, display: '-webkit-box', WebkitLineClamp: 5, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {dictateAccumulated}
          </div>
        )}
        {lastResponse && !transcript && !dictateMode && (
          <div style={{ color: 'rgba(255,255,255,0.85)', fontSize: 15, maxWidth: 520, textAlign: 'center', lineHeight: 1.65, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
            {lastResponse}
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div style={{ position: 'absolute', bottom: 40, display: 'flex', alignItems: 'center', gap: 24 }}>
        {/* Pause — more prominent when reading/speaking */}
        <button onClick={handlePause} style={{ width: readingAll ? 52 : 44, height: readingAll ? 52 : 44, borderRadius: '50%', border: readingAll ? '1.5px solid #2dd4bf' : '0.5px solid rgba(255,255,255,0.2)', background: readingAll ? 'rgba(45,212,191,0.15)' : 'rgba(255,255,255,0.06)', color: readingAll ? '#2dd4bf' : 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s' }} title="Pause / Resume (P)">
          {paused ? '▶' : '⏸'}
        </button>

        {/* Mic button */}
        <button onClick={dictateMode ? stopDictate : toggleListening} disabled={isProcessing && !dictateMode} style={{ width: 72, height: 72, borderRadius: '50%', border: 'none', background: dictateMode ? '#ef4444' : isListening ? '#ef4444' : isProcessing ? '#374151' : 'rgba(255,255,255,0.9)', color: dictateMode || isListening ? '#fff' : '#111', cursor: isProcessing && !dictateMode ? 'not-allowed' : 'pointer', fontSize: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'all 0.2s', boxShadow: (isListening || dictateMode) ? '0 0 0 8px rgba(239,68,68,0.3)' : '0 4px 20px rgba(0,0,0,0.4)' }} title={dictateMode ? 'Stop dictating' : 'Toggle listening (Space)'}>
          {dictateMode ? '⏹' : isListening ? '■' : isProcessing ? '…' : '🎤'}
        </button>

        {/* Exit */}
        <button onClick={handleExit} style={{ width: 44, height: 44, borderRadius: '50%', border: '0.5px solid rgba(255,255,255,0.2)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.6)', cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center' }} title="Exit Voice Mode (Esc)">
          ✕
        </button>
      </div>

      <div style={{ position: 'absolute', bottom: 12, fontSize: 11, color: 'rgba(255,255,255,0.2)', letterSpacing: '.05em' }}>
        SPACE to speak · P to pause · ESC to exit
      </div>

      {/* Voice Settings Modal */}
      {showVoiceSettings && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 28, width: 340, zIndex: 100 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <div style={{ fontSize: 16, fontWeight: 600, color: '#e2e8f0' }}>Voice Selection</div>
            <button onClick={() => setShowVoiceSettings(false)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 20 }}>×</button>
          </div>
          {ELEVENLABS_VOICES.map(v => (
            <button key={v.id} onClick={() => selectVoice(v.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '12px 16px', background: selectedVoiceId === v.id ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${selectedVoiceId === v.id ? '#6366f1' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, marginBottom: 8, cursor: 'pointer', textAlign: 'left' }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: selectedVoiceId === v.id ? '#6366f1' : '#374151', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, flexShrink: 0 }}>
                {v.label.includes('Female') ? '👩' : '👨'}
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 500, color: '#e2e8f0' }}>{v.name}</div>
                <div style={{ fontSize: 12, color: '#64748b' }}>{v.label}</div>
              </div>
              {selectedVoiceId === v.id && <span style={{ marginLeft: 'auto', color: '#6366f1', fontSize: 18 }}>✓</span>}
            </button>
          ))}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
            <div style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>Reading speed</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[{ label: 'Slower', rate: 0.72 }, { label: 'Normal', rate: 0.88 }, { label: 'Faster', rate: 1.1 }].map(s => (
                <button key={s.rate} onClick={() => setSpeechRate(s.rate)} style={{ flex: 1, padding: '6px', background: Math.abs(speechRate - s.rate) < 0.1 ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)', border: `1px solid ${Math.abs(speechRate - s.rate) < 0.1 ? '#6366f1' : 'rgba(255,255,255,0.1)'}`, borderRadius: 6, color: '#e2e8f0', cursor: 'pointer', fontSize: 12 }}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Edit Diff Modal */}
      {editModal && (
        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 16, padding: 24, width: '80%', maxWidth: 600, maxHeight: '70vh', overflow: 'auto', zIndex: 100 }}>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', marginBottom: 16 }}>Voice Edit — {editModal.sectionId}</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div>
              <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Original</div>
              <div style={{ fontSize: 12, color: '#94a3b8', background: '#1e293b', padding: 12, borderRadius: 8, maxHeight: 200, overflow: 'auto', lineHeight: 1.6 }}>{editModal.original.slice(0, 800)}</div>
            </div>
            <div>
              <div style={{ fontSize: 11, color: '#22c55e', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>Edited</div>
              <div style={{ fontSize: 12, color: '#cbd5e1', background: '#052e16', padding: 12, borderRadius: 8, maxHeight: 200, overflow: 'auto', lineHeight: 1.6 }}>{editModal.edited.slice(0, 800)}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={acceptEdit} style={{ padding: '10px 24px', background: '#22c55e', border: 'none', borderRadius: 8, color: '#fff', cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>Accept</button>
            <button onClick={discardEdit} style={{ padding: '10px 24px', background: '#374151', border: 'none', borderRadius: 8, color: '#e2e8f0', cursor: 'pointer', fontSize: 14 }}>Discard</button>
          </div>
          <div style={{ textAlign: 'center', fontSize: 11, color: 'rgba(255,255,255,0.2)', marginTop: 10 }}>Say "accept" or "discard"</div>
        </div>
      )}
    </div>
  )
}
