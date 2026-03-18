import { useState } from 'react'
import { useApi } from '../hooks/useApi'
import { EXTRACT_STUDY_SYSTEM, PROFESSOR_SYSTEM, professorWritePrompt } from '../lib/personas'
import { MECHANISMS, SECTIONS } from '../lib/nih'
import { countWords, estimatePages, createSectionSummary } from '../lib/compression'

const HAIKU = 'claude-haiku-4-5-20251001'
const SONNET = 'claude-sonnet-4-20250514'

export default function GrantWizard({ onComplete, onCancel }) {
  const api = useApi()
  const [step, setStep] = useState('describe') // 'describe', 'review', 'generating'
  const [description, setDescription] = useState('')
  const [extracting, setExtracting] = useState(false)
  const [extracted, setExtracted] = useState(null)
  const [generating, setGenerating] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0, section: '' })
  const [generatedSections, setGeneratedSections] = useState({})
  const [scores, setScores] = useState({})

  async function extractStudy() {
    if (!description.trim()) return
    setExtracting(true)
    try {
      const result = await api.callAI({
        model: HAIKU, // Use Haiku for extraction
        max_tokens: 500,
        system: EXTRACT_STUDY_SYSTEM,
        messages: [{ role: 'user', content: description }]
      }, 'extract_study')

      const text = result.content[0].text.replace(/```json|```/g, '').trim()
      const data = JSON.parse(text)
      setExtracted(data)
      setStep('review')
    } catch (e) {
      alert('Failed to extract study information: ' + e.message)
    }
    setExtracting(false)
  }

  async function generateAllSections() {
    setStep('generating')
    setGenerating(true)

    const project = {
      title: extracted.title,
      pi: extracted.pi,
      partner: extracted.partner,
      disease: extracted.disease,
      biology: extracted.biology,
      aims: extracted.aims,
      pa: extracted.pa,
      commercial: extracted.commercial
    }

    const mechanism = extracted.mechanism || 'STTR-I'
    const m = MECHANISMS[mechanism]
    const sectionsToGenerate = SECTIONS.filter(s =>
      s.id !== 'commercial' || m.needsCommercial
    )

    setProgress({ current: 0, total: sectionsToGenerate.length, section: '' })

    const sections = {}
    const scoreResults = {}
    const sectionSummaries = {}

    for (let i = 0; i < sectionsToGenerate.length; i++) {
      const sec = sectionsToGenerate[i]
      setProgress({ current: i, total: sectionsToGenerate.length, section: sec.label })

      try {
        // Determine appropriate model and max_tokens based on section
        const isApproach = sec.id === 'approach'
        const writeModel = SONNET
        const writeMaxTokens = isApproach ? 2500 : (sec.id === 'aims' ? 1200 : 1500)

        // Generate section using Sonnet
        const writeResult = await api.callAI({
          model: writeModel,
          max_tokens: writeMaxTokens,
          system: PROFESSOR_SYSTEM,
          messages: [{ role: 'user', content: professorWritePrompt(sec.id, project, mechanism) }]
        }, `write_${sec.id}`)

        const text = writeResult.content[0].text
        sections[sec.id] = text
        setGeneratedSections({ ...sections })

        // Create section summary using Haiku for progressive context
        if (text && text.length > 100) {
          try {
            const summaryResult = await api.callAI({
              model: HAIKU,
              max_tokens: 300,
              system: 'You are a technical summarizer. Compress this grant section into exactly 200 words preserving all key scientific content.',
              messages: [{ role: 'user', content: `Summarize this ${sec.label} section:\n\n${text.slice(0, 4000)}` }]
            }, 'section_summary')

            sectionSummaries[sec.id] = summaryResult.content[0].text
          } catch (e) {
            console.error(`Summary ${sec.id} failed:`, e)
          }
        }

        // Score section immediately using Haiku
        if (text && text.length > 50) {
          try {
            const scoreResult = await api.callAI({
              model: HAIKU,
              max_tokens: 600,
              system: `You are an expert NIH grant reviewer. Score this section on the NIH 1-9 scale (1=best). Return ONLY valid JSON: {"score":2,"descriptor":"Outstanding","strengths":["..."],"weaknesses":["..."],"narrative":"..."}`,
              messages: [{ role: 'user', content: `Section: ${sec.label}\n\n${text.slice(0, 4000)}\n\nScore this section. Return only JSON.` }]
            }, 'score_section')

            const raw = scoreResult.content[0].text.replace(/```json|```/g, '').trim()
            const scored = JSON.parse(raw)
            scoreResults[sec.id] = scored
            setScores({ ...scoreResults })
          } catch (e) {
            console.error(`Scoring ${sec.id} failed:`, e)
          }
        }
      } catch (e) {
        alert(`Failed to generate ${sec.label}: ` + e.message)
      }
    }

    setProgress({ current: sectionsToGenerate.length, total: sectionsToGenerate.length, section: 'Complete!' })
    setGenerating(false)

    // Create the project
    const newProject = {
      title: extracted.title,
      mechanism: mechanism,
      setup: {
        pi: extracted.pi,
        partner: extracted.partner,
        disease: extracted.disease,
        biology: extracted.biology,
        aims: extracted.aims,
        pa: extracted.pa,
        commercial: extracted.commercial,
        institute: extracted.institute || ''
      },
      sections,
      scores: scoreResults,
      section_summaries: sectionSummaries
    }

    // Call onComplete with the new project
    onComplete(newProject)
  }

  return (
    <div style={{ maxWidth: 800, margin: '0 auto', padding: '2rem 1.5rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: '2rem' }}>
        <button onClick={onCancel} style={backBtn}>← Back</button>
        <h1 style={{ fontSize: 22, fontWeight: 500 }}>Grant Writing Wizard</h1>
      </div>

      {/* Step 1: Describe Study */}
      {step === 'describe' && (
        <div>
          <p style={{ fontSize: 14, color: '#666', marginBottom: '1rem', lineHeight: 1.6 }}>
            Describe your study in plain language. Include: what disease/condition you're targeting,
            what you plan to do, why it's important, your preliminary data (if any), and who the team is.
            Claude will extract structured information and generate a complete grant.
          </p>

          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="Example: We are developing a novel drug delivery system for platinum-resistant ovarian cancer. Our small business, COARE Holdings, has partnered with OUHSC. We discovered that extracellular vesicles can penetrate the tumor microenvironment and deliver chemotherapy directly to cancer stem cells. Preliminary data shows 10x better tumor penetration vs. free drug. We will validate the mechanism in patient-derived xenografts and optimize the formulation for Phase II clinical trials. Budget is $400K over 2 years..."
            style={{
              width: '100%',
              minHeight: 280,
              padding: '1rem',
              fontSize: 14,
              lineHeight: 1.8,
              border: '0.5px solid #e5e5e5',
              borderRadius: 8,
              fontFamily: 'inherit',
              resize: 'vertical'
            }}
          />

          <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
            <button
              onClick={extractStudy}
              disabled={extracting || !description.trim()}
              style={{
                ...btnStyle,
                opacity: !description.trim() ? 0.5 : 1
              }}
            >
              {extracting ? 'Analyzing...' : 'Analyze & Extract Fields →'}
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Review Extracted Fields */}
      {step === 'review' && extracted && (
        <div>
          <div style={{
            background: '#f8f8f8',
            border: '0.5px solid #e5e5e5',
            borderRadius: 8,
            padding: '1rem',
            marginBottom: '1.5rem'
          }}>
            <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '0.5rem' }}>Extracted Information</h3>
            <p style={{ fontSize: 13, color: '#666' }}>Review and edit if needed before generating the full grant</p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            <Field label="Grant Title">
              <input
                style={inputStyle}
                value={extracted.title}
                onChange={e => setExtracted({ ...extracted, title: e.target.value })}
              />
            </Field>

            <Field label="Recommended Mechanism">
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {Object.keys(MECHANISMS).map(key => (
                  <button
                    key={key}
                    onClick={() => setExtracted({ ...extracted, mechanism: key })}
                    style={{
                      ...mechBtn,
                      background: extracted.mechanism === key ? '#111' : '#fff',
                      color: extracted.mechanism === key ? '#fff' : '#111'
                    }}
                  >
                    {MECHANISMS[key].label}
                  </button>
                ))}
              </div>
              {extracted.mechanism_justification && (
                <div style={{ fontSize: 12, color: '#666', marginTop: 6, fontStyle: 'italic' }}>
                  Recommendation: {extracted.mechanism_justification}
                </div>
              )}
            </Field>

            <Field label="PI / Small Business">
              <input
                style={inputStyle}
                value={extracted.pi || ''}
                onChange={e => setExtracted({ ...extracted, pi: e.target.value })}
              />
            </Field>

            {(extracted.mechanism?.startsWith('STTR') || extracted.mechanism?.startsWith('FAST')) && (
              <Field label="Academic Partner">
                <input
                  style={inputStyle}
                  value={extracted.partner || ''}
                  onChange={e => setExtracted({ ...extracted, partner: e.target.value })}
                />
              </Field>
            )}

            <Field label="Disease / Indication">
              <input
                style={inputStyle}
                value={extracted.disease || ''}
                onChange={e => setExtracted({ ...extracted, disease: e.target.value })}
              />
            </Field>

            <Field label="Scientific Premise / Biology">
              <textarea
                style={{ ...inputStyle, minHeight: 100, resize: 'vertical' }}
                value={extracted.biology || ''}
                onChange={e => setExtracted({ ...extracted, biology: e.target.value })}
              />
            </Field>

            <Field label="Specific Aims Outline">
              <textarea
                style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                value={extracted.aims || ''}
                onChange={e => setExtracted({ ...extracted, aims: e.target.value })}
              />
            </Field>

            <Field label="NIH Institute / PA">
              <input
                style={inputStyle}
                value={extracted.pa || ''}
                onChange={e => setExtracted({ ...extracted, pa: e.target.value })}
                placeholder="e.g., NCI PA-24-185"
              />
            </Field>

            {MECHANISMS[extracted.mechanism]?.needsCommercial && (
              <Field label="Commercialization Path">
                <textarea
                  style={{ ...inputStyle, minHeight: 80, resize: 'vertical' }}
                  value={extracted.commercial || ''}
                  onChange={e => setExtracted({ ...extracted, commercial: e.target.value })}
                  placeholder="Market opportunity, IP strategy, regulatory pathway, Phase II milestones..."
                />
              </Field>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: '1.5rem' }}>
            <button onClick={() => setStep('describe')} style={backBtn}>← Edit Description</button>
            <button onClick={generateAllSections} style={btnStyle}>
              Generate Full Grant →
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Generating Progress */}
      {step === 'generating' && (
        <div>
          <div style={{
            background: '#f8f8f8',
            border: '0.5px solid #e5e5e5',
            borderRadius: 8,
            padding: '1.5rem',
            textAlign: 'center',
            marginBottom: '1.5rem'
          }}>
            <div style={{ fontSize: 24, fontWeight: 500, marginBottom: 8 }}>
              {generating ? 'Generating...' : 'Complete!'}
            </div>
            <div style={{ fontSize: 14, color: '#666', marginBottom: '1rem' }}>
              {progress.section}
            </div>
            <div style={{
              width: '100%',
              height: 8,
              background: '#e5e5e5',
              borderRadius: 4,
              overflow: 'hidden',
              marginBottom: 8
            }}>
              <div style={{
                width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
                height: '100%',
                background: '#111',
                transition: 'width 0.3s'
              }} />
            </div>
            <div style={{ fontSize: 12, color: '#999' }}>
              Section {progress.current} of {progress.total}
            </div>
          </div>

          {/* Show generated sections as they complete */}
          {Object.keys(generatedSections).length > 0 && (
            <div>
              <h3 style={{ fontSize: 15, fontWeight: 500, marginBottom: '1rem' }}>Generated Sections</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {Object.entries(generatedSections).map(([secId, text]) => {
                  const sec = SECTIONS.find(s => s.id === secId)
                  const score = scores[secId]
                  return (
                    <div key={secId} style={{
                      border: '0.5px solid #e5e5e5',
                      borderRadius: 8,
                      padding: '1rem',
                      background: '#fff'
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 500 }}>{sec?.label}</div>
                        {score && (
                          <div style={{ fontSize: 12, color: '#666' }}>
                            Score: {score.score} — {score.descriptor}
                          </div>
                        )}
                      </div>
                      <div style={{ fontSize: 12, color: '#999', marginBottom: 4 }}>
                        {countWords(text)} words · ~{wordsToPages(countWords(text)).toFixed(1)} pages
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Field({ label, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 12, fontWeight: 500, color: '#111' }}>{label}</label>
      {children}
    </div>
  )
}

const backBtn = {
  padding: '7px 14px',
  fontSize: 13,
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  cursor: 'pointer',
  background: '#fff',
  color: '#666'
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
  flex: 1
}

const inputStyle = {
  border: '0.5px solid #e5e5e5',
  borderRadius: 8,
  padding: '8px 12px',
  fontSize: 13,
  fontFamily: 'inherit',
  width: '100%'
}

const mechBtn = {
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 500,
  border: '0.5px solid #ccc',
  borderRadius: 6,
  cursor: 'pointer',
  transition: 'all 0.2s'
}
