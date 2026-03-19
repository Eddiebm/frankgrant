export default function TermsPage() {
  const s = { maxWidth: 800, margin: '0 auto', padding: '40px 24px', fontFamily: 'Georgia, serif' }
  const h2 = { fontSize: 20, fontWeight: 700, color: '#111', marginTop: 32, marginBottom: 12 }
  const p = { fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 16 }

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh' }}>
      <div style={{ background: '#0e7490', padding: '20px 24px', color: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>FrankGrant Terms of Service</div>
        <div style={{ fontSize: 13, color: '#a5f3fc', marginTop: 4 }}>Effective Date: January 1, 2026</div>
      </div>
      <div style={s}>
        <p style={p}>These Terms of Service ("Terms") govern your use of FrankGrant, a NIH grant writing assistance platform operated by COARE Holdings. By using FrankGrant, you agree to these Terms.</p>

        <h2 style={h2}>1. Service Description</h2>
        <p style={p}>FrankGrant provides two services: (1) a self-service AI-assisted grant writing platform ("Platform Service") accessed via subscription, and (2) a done-for-you professional grant writing service ("Done-For-You Service") where FrankGrant staff prepare grant applications on your behalf. These Terms apply to both services.</p>

        <h2 style={h2}>2. User Responsibilities</h2>
        <p style={p}>You are responsible for the accuracy and completeness of all scientific content you provide. You represent that all preliminary data, research descriptions, hypotheses, and scientific claims you submit are accurate to the best of your knowledge. You are solely responsible for reviewing all generated content before submission to NIH or any funding agency. FrankGrant does not verify the accuracy of scientific claims.</p>
        <p style={p}>You are responsible for complying with all NIH submission requirements, deadlines, and formatting rules. FrankGrant assists in preparing grant applications but does not guarantee compliance with any specific FOA requirements.</p>

        <h2 style={h2}>3. Intellectual Property and Ownership</h2>
        <p style={p}>You retain full ownership of all scientific content, research data, hypotheses, preliminary results, and intellectual property you provide to FrankGrant. The grant application content generated using your scientific input belongs to you. FrankGrant retains ownership of the platform, software, AI systems, and writing methodologies used to generate that content.</p>
        <p style={p}>FrankGrant will not use your scientific content to train AI models or share it with third parties without your consent, except as required to provide the service (e.g., sending to Anthropic's Claude API for generation).</p>

        <h2 style={h2}>4. Payment Terms — Platform Service</h2>
        <p style={p}>Platform subscriptions are billed monthly or annually in advance. Subscriptions automatically renew unless cancelled before the renewal date. Refunds are not provided for unused subscription periods. You may cancel at any time and retain access through the end of your paid period.</p>

        <h2 style={h2}>5. Payment Terms — Done-For-You Service</h2>
        <p style={p}><strong>Upfront Fee:</strong> A non-refundable upfront fee is due before work begins. The upfront fee covers grant preparation, quality review, and revisions as specified in your service agreement. Upfront fees are non-refundable once work has begun.</p>
        <p style={p}><strong>Success Fee:</strong> Upon receipt of a Notice of Award from NIH, a success fee equal to 3% of the total award amount is due within 30 days. The success fee is payable from your operating funds and not from grant funds. You agree to notify FrankGrant within 10 days of receiving a Notice of Award and to provide documentation of the award amount.</p>
        <p style={p}><strong>No Guarantee of Funding:</strong> FrankGrant makes no representation or warranty that any grant application will be funded. The success fee is only due upon actual funding. FrankGrant is not entitled to any compensation beyond the upfront fee if the application is not funded.</p>

        <h2 style={h2}>6. No Guarantee of Funding</h2>
        <p style={p}>FrankGrant's services improve the quality of grant applications but do not guarantee funding. NIH funding decisions are made by independent review committees and program officers. FrankGrant has no influence over funding decisions.</p>

        <h2 style={h2}>7. Limitation of Liability</h2>
        <p style={p}>FrankGrant's liability to you for any claim arising from these Terms or the services is limited to the amount you paid for the services in the 12 months preceding the claim. FrankGrant is not liable for indirect, incidental, special, or consequential damages, including lost funding, lost business, or missed deadlines.</p>

        <h2 style={h2}>8. Confidentiality</h2>
        <p style={p}>FrankGrant treats all scientific content, research descriptions, and grant materials as confidential. We will not disclose your scientific content to competitors or third parties except as required to provide the service or as required by law.</p>

        <h2 style={h2}>9. Governing Law</h2>
        <p style={p}>These Terms are governed by the laws of the State of Oklahoma, United States of America, without regard to conflict of law provisions. Any disputes shall be resolved in the courts of Oklahoma County, Oklahoma.</p>

        <h2 style={h2}>10. Changes to Terms</h2>
        <p style={p}>FrankGrant reserves the right to update these Terms. We will notify users of material changes via email. Continued use of the service after changes constitutes acceptance of the updated Terms.</p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>Questions about these Terms: <a href="mailto:legal@frankgrant.app" style={{ color: '#0e7490' }}>legal@frankgrant.app</a></p>

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          © 2026 FrankGrant · COARE Holdings ·{' '}
          <a href="/#/terms" style={{ color: '#0e7490' }}>Terms</a> ·{' '}
          <a href="/#/privacy" style={{ color: '#0e7490' }}>Privacy</a>
        </div>
      </div>
    </div>
  )
}
