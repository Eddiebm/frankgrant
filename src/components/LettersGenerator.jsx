import { useState, useEffect } from 'react'
import { useApi } from '../hooks/useApi'

const LETTER_TYPES = [
  {
    id: 'collaboration',
    name: 'Letter of Collaboration',
    icon: '🤝',
    description: 'Collaborator confirms role and commitment',
    fields: [
      { key: 'collaborator_name', label: 'Collaborator Name & Title', required: true },
      { key: 'collaborator_institution', label: 'Collaborator Institution', required: true },
      { key: 'role_description', label: 'Specific Role in Project', required: true },
      { key: 'resources_provided', label: 'Resources / Data Provided', required: false },
    ],
  },
  {
    id: 'support',
    name: 'Letter of Support',
    icon: '💼',
    description: 'Institutional or organizational endorsement',
    fields: [
      { key: 'supporter_name', label: 'Supporter Name & Title', required: true },
      { key: 'supporter_institution', label: 'Supporting Organization', required: true },
      { key: 'support_type', label: 'Type of Support (space, equipment, personnel)', required: true },
      { key: 'support_value', label: 'Estimated Value / FTE', required: false },
    ],
  },
  {
    id: 'mou',
    name: 'Memorandum of Understanding',
    icon: '📄',
    description: 'Formal agreement between institutions',
    fields: [
      { key: 'party_b_name', label: 'Second Party Name & Title', required: true },
      { key: 'party_b_institution', label: 'Second Institution', required: true },
      { key: 'agreement_scope', label: 'Scope of Agreement', required: true },
      { key: 'duration', label: 'Agreement Duration', required: false },
    ],
  },
  {
    id: 'pi_commitment',
    name: 'PI Commitment Letter',
    icon: '🎓',
    description: 'PI confirms effort and institutional support',
    fields: [
      { key: 'pi_name', label: 'PI Full Name & Degrees', required: true },
      { key: 'pi_institution', label: 'PI Institution', required: true },
      { key: 'effort_percent', label: 'Percent Effort on Project', required: true },
      { key: 'department_chair', label: 'Department Chair Name', required: false },
    ],
  },
  {
    id: 'mentor',
    name: 'Mentor Letter (K99/Career)',
    icon: '🧑‍🏫',
    description: 'Mentor commitment for career development grants',
    fields: [
      { key: 'mentor_name', label: 'Mentor Name & Title', required: true },
      { key: 'mentor_institution', label: 'Mentor Institution', required: true },
      { key: 'mentee_name', label: 'Mentee / Candidate Name', required: true },
      { key: 'mentoring_plan', label: 'Key Mentoring Activities', required: true },
      { key: 'lab_resources', label: 'Lab Resources Available', required: false },
    ],
  },
  {
    id: 'consultant',
    name: 'Consultant Letter',
    icon: '🔬',
    description: 'External expert confirms advisory role',
    fields: [
      { key: 'consultant_name', label: 'Consultant Name & Title', required: true },
      { key: 'consultant_institution', label: 'Consultant Institution', required: true },
      { key: 'expertise_area', label: 'Area of Expertise', required: true },
      { key: 'time_commitment', label: 'Time Commitment (days/year)', required: true },
    ],
  },
  {
    id: 'data_sharing',
    name: 'Data Sharing Agreement',
    icon: '📊',
    description: 'Data provider confirms access and terms',
    fields: [
      { key: 'data_provider_name', label: 'Data Provider Name', required: true },
      { key: 'data_provider_institution', label: 'Data Provider Institution', required: true },
      { key: 'dataset_description', label: 'Dataset Description & Size', required: true },
      { key: 'sharing_terms', label: 'Access Terms / Restrictions', required: false },
    ],
  },
  {
    id: 'irb_approval',
    name: 'IRB Approval (placeholder)',
    icon: '🏛️',
    description: 'IRB approval cover memo for application',
    fields: [
      { key: 'irb_number', label: 'IRB Protocol Number', required: true },
      { key: 'irb_institution', label: 'IRB Institution', required: true },
      { key: 'approval_date', label: 'Approval Date', required: true },
      { key: 'study_title', label: 'Study Title on IRB', required: false },
    ],
  },
  {
    id: 'patient_advocacy',
    name: 'Patient Advocacy Letter',
    icon: '❤️',
    description: 'Patient org endorses research significance',
    fields: [
      { key: 'org_name', label: 'Patient Organization Name', required: true },
      { key: 'org_leader', label: 'Organization Leader Name & Title', required: true },
      { key: 'patient_impact', label: 'How Research Impacts Patients', required: true },
      { key: 'org_mission', label: 'Organization Mission (brief)', required: false },
    ],
  },
  {
    id: 'industry_partner',
    name: 'Industry Partner Letter',
    icon: '🏭',
    description: 'Company confirms partnership and co-funding',
    fields: [
      { key: 'company_name', label: 'Company Name', required: true },
      { key: 'company_contact', label: 'Contact Name & Title', required: true },
      { key: 'partner_contribution', label: 'Financial / In-Kind Contribution', required: true },
      { key: 'commercial_interest', label: 'Company\'s Commercial Interest', required: false },
    ],
  },
  {
    id: 'key_personnel',
    name: 'Key Personnel Commitment',
    icon: '👤',
    description: 'Named personnel confirms role and availability',
    fields: [
      { key: 'personnel_name', label: 'Personnel Name & Title', required: true },
      { key: 'personnel_institution', label: 'Institution / Employer', required: true },
      { key: 'role_on_grant', label: 'Role on Grant', required: true },
      { key: 'effort_percent', label: 'Percent Effort', required: true },
    ],
  },
  {
    id: 'subcontract',
    name: 'Subcontract Intent Letter',
    icon: '🔗',
    description: 'Subcontractor confirms scope and budget intent',
    fields: [
      { key: 'sub_institution', label: 'Subcontractor Institution', required: true },
      { key: 'sub_pi', label: 'Subcontract PI Name', required: true },
      { key: 'sub_scope', label: 'Subcontract Scope of Work', required: true },
      { key: 'sub_budget', label: 'Approximate Budget', required: false },
    ],
  },
]

const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '16px 20px', cursor: 'pointer', transition: 'all 0.15s' }
const activeCard = { ...card, border: '2px solid #2563eb', background: '#eff6ff' }
const btn = (color = '#2563eb') => ({ background: color, color: '#fff', border: 'none', borderRadius: 6, padding: '8px 18px', cursor: 'pointer', fontSize: 14, fontWeight: 600 })
const inp = { border: '1px solid #d1d5db', borderRadius: 6, padding: '8px 12px', fontSize: 14, width: '100%', boxSizing: 'border-box' }
const label = { fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4, display: 'block' }

export default function LettersGenerator({ projects = [] }) {
  const { generateLetter } = useApi()

  const [selectedProject, setSelectedProject] = useState('')
  const [selectedType, setSelectedType] = useState(null)
  const [fields, setFields] = useState({})
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  const [copied, setCopied] = useState(false)

  const project = projects.find(p => p.id === selectedProject)

  function selectType(lt) {
    setSelectedType(lt)
    setFields({})
    setResult(null)
    setError(null)
  }

  async function handleGenerate() {
    if (!selectedProject) { setError('Select a project first'); return }
    const missing = (selectedType.fields || []).filter(f => f.required && !fields[f.key]?.trim())
    if (missing.length) { setError(`Fill in: ${missing.map(f => f.label).join(', ')}`); return }

    setLoading(true)
    setError(null)
    try {
      const data = await generateLetter(selectedType.id, selectedProject, fields)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText(result.letter_content || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleDownload() {
    const blob = new Blob([result.letter_content], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${selectedType.name.replace(/\s+/g, '_')}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ padding: '24px 32px', maxWidth: 1100, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700 }}>Letters Generator</h2>
      <p style={{ margin: '0 0 24px', color: '#6b7280', fontSize: 14 }}>
        Generate NIH-ready support and collaboration letters for your application.
      </p>

      {/* Project selector */}
      <div style={{ marginBottom: 24 }}>
        <div style={label}>Select Project</div>
        <select
          value={selectedProject}
          onChange={e => setSelectedProject(e.target.value)}
          style={{ ...inp, maxWidth: 420 }}
        >
          <option value="">— Choose a project —</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.title || 'Untitled Project'} ({p.mechanism || 'STTR-I'})</option>
          ))}
        </select>
      </div>

      {/* Letter type grid */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 12 }}>
          Choose Letter Type
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 12 }}>
          {LETTER_TYPES.map(lt => (
            <div
              key={lt.id}
              style={selectedType?.id === lt.id ? activeCard : card}
              onClick={() => selectType(lt)}
            >
              <div style={{ fontSize: 22, marginBottom: 6 }}>{lt.icon}</div>
              <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 4 }}>{lt.name}</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{lt.description}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Form + preview */}
      {selectedType && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          {/* Form */}
          <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 10, padding: '20px 24px' }}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 16 }}>
              {selectedType.icon} {selectedType.name}
            </div>

            {selectedType.fields.map(f => (
              <div key={f.key} style={{ marginBottom: 14 }}>
                <div style={label}>
                  {f.label}{f.required && <span style={{ color: '#ef4444', marginLeft: 2 }}>*</span>}
                </div>
                <input
                  style={inp}
                  placeholder={f.label}
                  value={fields[f.key] || ''}
                  onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                />
              </div>
            ))}

            {project && (
              <div style={{ marginBottom: 16, padding: '10px 14px', background: '#eff6ff', borderRadius: 6, fontSize: 12, color: '#1d4ed8' }}>
                Using: <strong>{project.title || 'Untitled'}</strong> · {project.mechanism} · {project.pi_name || 'PI not set'}
              </div>
            )}

            {error && <div style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</div>}

            <button
              style={btn(loading ? '#9ca3af' : '#2563eb')}
              onClick={handleGenerate}
              disabled={loading}
            >
              {loading ? 'Generating...' : '✨ Generate Letter'}
            </button>
          </div>

          {/* Preview */}
          <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 10, padding: '20px 24px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Preview</div>
              {result && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <button onClick={handleCopy} style={{ ...btn('#059669'), fontSize: 12, padding: '5px 12px' }}>
                    {copied ? '✓ Copied' : '📋 Copy'}
                  </button>
                  <button onClick={handleDownload} style={{ ...btn('#6d28d9'), fontSize: 12, padding: '5px 12px' }}>
                    ⬇ Download
                  </button>
                </div>
              )}
            </div>

            {result ? (
              <div>
                <div style={{ display: 'flex', gap: 12, marginBottom: 12, fontSize: 12, color: '#6b7280' }}>
                  <span>~{result.word_count} words</span>
                  <span>·</span>
                  <span>{result.template_name}</span>
                </div>
                <pre style={{
                  whiteSpace: 'pre-wrap', fontFamily: 'Georgia, serif', fontSize: 13, lineHeight: 1.7,
                  background: '#f9fafb', padding: 16, borderRadius: 6, border: '1px solid #e5e7eb',
                  maxHeight: 480, overflowY: 'auto', margin: 0,
                }}>
                  {result.letter_content}
                </pre>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: '#9ca3af', fontSize: 14 }}>
                Fill in the form and click Generate to see your letter
              </div>
            )}
          </div>
        </div>
      )}

      {!selectedType && (
        <div style={{ textAlign: 'center', padding: '40px 0', color: '#9ca3af', fontSize: 14 }}>
          Select a letter type above to get started
        </div>
      )}
    </div>
  )
}
