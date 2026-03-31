import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import mammoth from 'mammoth'

export default function Scorer({ onBack }) {
  const api = useApi()
  const [mode, setMode] = useState('research') // 'research' or 'commercial'
  const [file, setFile] = useState(null)
  const [extractedText, setExtractedText] = useState('')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function extractText(file) {
    if (file.type === 'application/pdf') {
      return await extractPDF(file)
    } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      return await extractDOCX(file)
    }
    throw new Error('Unsupported file type. Please upload PDF or DOCX.')
  }

  async function extractPDF(file) {
    // Load PDF.js from CDN if not already loaded
    if (!window.pdfjsLib) {
      await loadPDFJS()
    }

    const arrayBuffer = await file.arrayBuffer()
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise
    let fullText = ''

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map(item => item.str).join(' ')
      fullText += pageText + '\n\n'
    }

    return fullText
  }

  async function extractDOCX(file) {
    const arrayBuffer = await file.arrayBuffer()
    const result = await mammoth.extractRawText({ arrayBuffer })
    return result.value
  }

  function loadPDFJS() {
    return new Promise((resolve, reject) => {
      if (window.pdfjsLib) return resolve()

      const script = document.createElement('script')
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
      script.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'
        resolve()
      }
      script.onerror = reject
      document.head.appendChild(script)
    })
  }

  async function handleFileChange(e) {
    const selectedFile = e.target.files?.[0]
    if (!selectedFile) return

    setFile(selectedFile)
    setResult(null)
    setExtractedText('')

    try {
      const text = await extractText(selectedFile)
      setExtractedText(text)
    } catch (err) {
      alert('Error extracting text: ' + err.message)
      setFile(null)
    }
  }

  async function scoreDocument() {
    if (!extractedText) return

    setLoading(true)
    setResult(null)

    try {
      const prompt = mode === 'research'
        ? buildResearchPrompt(extractedText)
        : buildCommercialPrompt(extractedText)

      const response = await api.callAI({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 6000,
        temperature: 0,
        messages: [{
          role: 'user',
          content: prompt
        }]
      }, mode === 'research' ? 'score_research' : 'score_commercial')

      const reviewText = response.content[0].text
      const parsed = parseReview(reviewText)
      setResult(parsed)
    } catch (err) {
      alert('Error scoring document: ' + err.message)
    } finally {
      setLoading(false)
    }
  }

  function buildResearchPrompt(text) {
    return `You are an NIH peer reviewer. Score this Research Strategy against all five NIH review criteria. Provide scores (1-9, where 1=Exceptional, 9=Poor), strengths, weaknesses, and priority revisions for each criterion, plus an overall impact score and reviewer narrative.

Review criteria:
1. Significance: Does the project address an important problem or critical barrier to progress?
2. Innovation: Does the application challenge existing paradigms or develop novel concepts, approaches, methodologies, tools, or technologies?
3. Approach: Are the overall strategy, methodology, and analyses well-reasoned and appropriate to accomplish the specific aims?
4. Investigators: Are the PD/PIs, collaborators, and other researchers well suited to the project?
5. Environment: Will the scientific environment contribute to the probability of success?

Format your response EXACTLY as follows:

SIGNIFICANCE: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

INNOVATION: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

APPROACH: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

INVESTIGATORS: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

ENVIRONMENT: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

OVERALL IMPACT: [score 1-9]

REVIEWER NARRATIVE:
[2-3 paragraph synthesis of overall assessment, integration of criteria, and recommendation]

Research Strategy text:
${text.slice(0, 25000)}`
  }

  function buildCommercialPrompt(text) {
    return `You are an SBIR/STTR reviewer evaluating a Commercialization Plan. Score this plan against six key commercialization criteria. Provide scores (1-9, where 1=Exceptional, 9=Poor), strengths, weaknesses, and priority revisions for each criterion, plus an overall commercialization readiness score and reviewer narrative.

Commercialization criteria:
1. Market Opportunity: Is there a clear, sizable, and accessible market? Strong customer validation?
2. IP Strategy: Does the team have a clear path to protect their innovation?
3. Regulatory Pathway: Is the regulatory strategy realistic and well-planned?
4. Revenue Model: Is the business model sound with clear path to profitability?
5. Team Capability: Does the team have the right commercial expertise and advisory support?
6. Path to Phase II: Is there a compelling plan to achieve Phase II milestones?

Format your response EXACTLY as follows:

MARKET OPPORTUNITY: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

IP STRATEGY: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

REGULATORY PATHWAY: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

REVENUE MODEL: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

TEAM CAPABILITY: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

PATH TO PHASE II: [score 1-9]
Strengths: [bullet points]
Weaknesses: [bullet points]
Priority Revisions: [bullet points]

OVERALL COMMERCIALIZATION READINESS: [score 1-9]

REVIEWER NARRATIVE:
[2-3 paragraph assessment of overall commercialization readiness and recommendation]

Commercialization Plan text:
${text.slice(0, 25000)}`
  }

  function parseReview(text) {
    const sections = {}
    const lines = text.split('\n')
    let currentSection = null
    let currentField = null
    let overallScore = null
    let narrative = ''
    let inNarrative = false

    for (const line of lines) {
      const trimmed = line.trim()

      if (trimmed.match(/^(SIGNIFICANCE|INNOVATION|APPROACH|INVESTIGATORS|ENVIRONMENT|MARKET OPPORTUNITY|IP STRATEGY|REGULATORY PATHWAY|REVENUE MODEL|TEAM CAPABILITY|PATH TO PHASE II):\s*(\d)/i)) {
        const match = trimmed.match(/^(.+?):\s*(\d)/)
        currentSection = match[1].trim()
        sections[currentSection] = {
          score: parseInt(match[2]),
          strengths: [],
          weaknesses: [],
          revisions: []
        }
        currentField = null
        inNarrative = false
      } else if (trimmed.match(/^Strengths:/i)) {
        currentField = 'strengths'
      } else if (trimmed.match(/^Weaknesses:/i)) {
        currentField = 'weaknesses'
      } else if (trimmed.match(/^Priority Revisions:/i)) {
        currentField = 'revisions'
      } else if (trimmed.match(/^OVERALL (IMPACT|COMMERCIALIZATION READINESS):\s*(\d)/i)) {
        const match = trimmed.match(/:\s*(\d)/)
        overallScore = parseInt(match[1])
      } else if (trimmed.match(/^REVIEWER NARRATIVE:/i)) {
        inNarrative = true
        currentField = null
      } else if (inNarrative && trimmed) {
        narrative += trimmed + '\n\n'
      } else if (currentSection && currentField && trimmed.startsWith('-')) {
        sections[currentSection][currentField].push(trimmed.substring(1).trim())
      } else if (currentSection && currentField && trimmed && !trimmed.match(/^[A-Z\s]+:/)) {
        sections[currentSection][currentField].push(trimmed)
      }
    }

    return { sections, overallScore, narrative: narrative.trim() }
  }

  function getScoreColor(score) {
    if (score <= 2) return '#059669'
    if (score <= 4) return '#0891b2'
    if (score <= 6) return '#f59e0b'
    return '#dc2626'
  }

  function getScoreLabel(score) {
    const labels = {
      1: 'Exceptional', 2: 'Outstanding', 3: 'Excellent',
      4: 'Very Good', 5: 'Good', 6: 'Satisfactory',
      7: 'Fair', 8: 'Marginal', 9: 'Poor'
    }
    return labels[score] || 'N/A'
  }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '2rem 1.5rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
        <button onClick={onBack} style={backBtnStyle}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Grant Scorer</h1>
      </div>

      {/* Mode selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: '1.5rem' }}>
        <button
          onClick={() => { setMode('research'); setFile(null); setResult(null); setExtractedText('') }}
          style={{
            ...modeBtnStyle,
            background: mode === 'research' ? '#111' : '#fff',
            color: mode === 'research' ? '#fff' : '#111',
          }}
        >
          Research Strategy
        </button>
        <button
          onClick={() => { setMode('commercial'); setFile(null); setResult(null); setExtractedText('') }}
          style={{
            ...modeBtnStyle,
            background: mode === 'commercial' ? '#111' : '#fff',
            color: mode === 'commercial' ? '#fff' : '#111',
          }}
        >
          Commercialization Plan
        </button>
      </div>

      {/* Upload section */}
      <div style={{ marginBottom: '2rem' }}>
        <label style={labelStyle}>
          Upload {mode === 'research' ? 'Research Strategy' : 'Commercialization Plan'} (PDF or DOCX)
        </label>
        <input
          type="file"
          accept=".pdf,.docx"
          onChange={handleFileChange}
          style={fileInputStyle}
        />
        {file && (
          <div style={{ fontSize: 13, color: '#666', marginTop: 8 }}>
            ✓ {file.name} ({Math.round(file.size / 1024)} KB)
            {extractedText && ` — ${extractedText.split(/\s+/).length.toLocaleString()} words extracted`}
          </div>
        )}
      </div>

      {/* Score button */}
      {extractedText && !result && (
        <button
          onClick={scoreDocument}
          disabled={loading}
          style={{ ...btnStyle, width: '100%', marginBottom: '2rem' }}
        >
          {loading ? 'Scoring...' : `Score ${mode === 'research' ? 'Research Strategy' : 'Commercialization Plan'}`}
        </button>
      )}

      {/* Results */}
      {result && (
        <div>
          {/* Overall score */}
          <div style={{
            padding: '1.5rem',
            border: '0.5px solid #e5e5e5',
            borderRadius: 8,
            marginBottom: '1.5rem',
            background: '#fafafa'
          }}>
            <div style={{ fontSize: 13, color: '#666', marginBottom: 6 }}>
              Overall {mode === 'research' ? 'Impact Score' : 'Commercialization Readiness'}
            </div>
            <div style={{ fontSize: 32, fontWeight: 600, color: getScoreColor(result.overallScore) }}>
              {result.overallScore}
            </div>
            <div style={{ fontSize: 14, color: '#666' }}>
              {getScoreLabel(result.overallScore)}
            </div>
          </div>

          {/* Criteria scores */}
          <div style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>Criterion Scores</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {Object.entries(result.sections).map(([criterion, data]) => (
                <div key={criterion} style={criterionCardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{criterion}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 20, fontWeight: 600, color: getScoreColor(data.score) }}>
                        {data.score}
                      </span>
                      <span style={{ fontSize: 12, color: '#666' }}>
                        {getScoreLabel(data.score)}
                      </span>
                    </div>
                  </div>

                  {data.strengths.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#059669', marginBottom: 4 }}>
                        Strengths
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#333' }}>
                        {data.strengths.map((s, i) => <li key={i}>{s}</li>)}
                      </ul>
                    </div>
                  )}

                  {data.weaknesses.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#dc2626', marginBottom: 4 }}>
                        Weaknesses
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#333' }}>
                        {data.weaknesses.map((w, i) => <li key={i}>{w}</li>)}
                      </ul>
                    </div>
                  )}

                  {data.revisions.length > 0 && (
                    <div>
                      <div style={{ fontSize: 12, fontWeight: 500, color: '#f59e0b', marginBottom: 4 }}>
                        Priority Revisions
                      </div>
                      <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: '#333' }}>
                        {data.revisions.map((r, i) => <li key={i}>{r}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Reviewer narrative */}
          {result.narrative && (
            <div style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>Reviewer Narrative</h3>
              <div style={{
                padding: '1rem',
                border: '0.5px solid #e5e5e5',
                borderRadius: 8,
                background: '#fff',
                fontSize: 14,
                lineHeight: 1.6,
                color: '#333',
                whiteSpace: 'pre-wrap'
              }}>
                {result.narrative}
              </div>
            </div>
          )}

          {/* Score again */}
          <button
            onClick={() => { setFile(null); setResult(null); setExtractedText('') }}
            style={{ ...btnStyle, width: '100%' }}
          >
            Score Another Document
          </button>
        </div>
      )}
    </div>
  )
}

const backBtnStyle = {
  padding: '6px 12px',
  fontSize: 13,
  border: '0.5px solid #e5e5e5',
  borderRadius: 6,
  cursor: 'pointer',
  background: '#fff',
  color: '#666',
}

const modeBtnStyle = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 500,
  border: '0.5px solid #ccc',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'all 0.2s',
}

const labelStyle = {
  display: 'block',
  fontSize: 13,
  fontWeight: 500,
  marginBottom: 8,
  color: '#333',
}

const fileInputStyle = {
  display: 'block',
  width: '100%',
  padding: '10px',
  fontSize: 13,
  border: '0.5px solid #ccc',
  borderRadius: 8,
  cursor: 'pointer',
}

const btnStyle = {
  padding: '10px 16px',
  fontSize: 14,
  fontWeight: 500,
  border: 'none',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#111',
  color: '#fff',
}

const criterionCardStyle = {
  padding: '1rem',
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  background: '#fff',
}
