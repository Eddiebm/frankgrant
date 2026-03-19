export default function PrivacyPage() {
  const s = { maxWidth: 800, margin: '0 auto', padding: '40px 24px', fontFamily: 'Georgia, serif' }
  const h2 = { fontSize: 20, fontWeight: 700, color: '#111', marginTop: 32, marginBottom: 12 }
  const p = { fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 16 }

  return (
    <div style={{ background: '#fafafa', minHeight: '100vh' }}>
      <div style={{ background: '#0e7490', padding: '20px 24px', color: '#fff', textAlign: 'center' }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>FrankGrant Privacy Policy</div>
        <div style={{ fontSize: 13, color: '#a5f3fc', marginTop: 4 }}>Effective Date: January 1, 2026</div>
      </div>
      <div style={s}>
        <p style={p}>FrankGrant, operated by COARE Holdings, is committed to protecting your privacy. This Privacy Policy explains what data we collect, how we use it, and your rights regarding that data.</p>

        <h2 style={h2}>1. What Data We Collect</h2>
        <p style={p}><strong>Account information:</strong> Name, email address, and authentication data managed by Clerk (our identity provider). We do not store passwords directly.</p>
        <p style={p}><strong>Grant content:</strong> Research descriptions, preliminary data summaries, grant sections, and all content you create or upload within FrankGrant.</p>
        <p style={p}><strong>Usage data:</strong> Pages visited, features used, AI generation counts, and session timestamps. This helps us improve the product.</p>
        <p style={p}><strong>Payment data:</strong> Payment processing is handled by Stripe. FrankGrant does not store full credit card numbers. We retain payment amounts and transaction IDs for our records.</p>
        <p style={p}><strong>Feedback:</strong> Any feedback, bug reports, or feature requests you submit through the platform.</p>

        <h2 style={h2}>2. How We Use Your Data</h2>
        <p style={p}><strong>Service delivery:</strong> We use your data to provide the grant writing platform and done-for-you services you have requested.</p>
        <p style={p}><strong>Product improvement:</strong> We analyze usage patterns (in aggregate and anonymized form) to improve FrankGrant features and performance.</p>
        <p style={p}><strong>AI generation:</strong> Your grant content is sent to Anthropic's Claude API to generate text. Anthropic does not use your data to train their models per their enterprise data policies.</p>
        <p style={p}><strong>We never sell your data.</strong> FrankGrant does not sell, rent, or share your personal or scientific data with advertisers or data brokers.</p>

        <h2 style={h2}>3. Data Storage</h2>
        <p style={p}>Your data is stored in Cloudflare D1 (SQLite), hosted in Cloudflare's US data centers. Data is encrypted at rest and in transit using TLS 1.3. We use Cloudflare Workers for all server-side processing.</p>

        <h2 style={h2}>4. Data Retention</h2>
        <p style={p}>Grant content and account data are retained for 2 years after your last active session. You may request deletion of your data at any time by emailing <a href="mailto:privacy@frankgrant.app" style={{ color: '#0e7490' }}>privacy@frankgrant.app</a>. We will process deletion requests within 30 days.</p>

        <h2 style={h2}>5. Cookies</h2>
        <p style={p}>FrankGrant uses cookies only for authentication (managed by Clerk). We do not use advertising cookies, tracking pixels, or third-party analytics cookies. You may disable cookies in your browser, but this will prevent you from signing in.</p>

        <h2 style={h2}>6. Third-Party Services</h2>
        <p style={p}>We use the following third-party services to operate FrankGrant:</p>
        <ul style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 16, paddingLeft: 20 }}>
          <li><strong>Clerk</strong> — Authentication and user management</li>
          <li><strong>Anthropic (Claude)</strong> — AI text generation</li>
          <li><strong>Cloudflare</strong> — Hosting, database, and CDN</li>
          <li><strong>Stripe</strong> — Payment processing (done-for-you service only)</li>
          <li><strong>Resend</strong> — Transactional email delivery</li>
        </ul>
        <p style={p}>Each of these services has their own privacy policies governing how they handle data.</p>

        <h2 style={h2}>7. Your Rights (GDPR / CCPA)</h2>
        <p style={p}>If you are located in the European Union or California, you have the following rights:</p>
        <ul style={{ fontSize: 15, color: '#374151', lineHeight: 1.8, marginBottom: 16, paddingLeft: 20 }}>
          <li><strong>Access:</strong> Request a copy of all data we hold about you</li>
          <li><strong>Deletion:</strong> Request deletion of your account and all associated data</li>
          <li><strong>Portability:</strong> Request your grant content in a machine-readable format</li>
          <li><strong>Correction:</strong> Request correction of inaccurate personal data</li>
          <li><strong>Objection:</strong> Object to processing of your data for certain purposes</li>
        </ul>
        <p style={p}>To exercise any of these rights, email <a href="mailto:privacy@frankgrant.app" style={{ color: '#0e7490' }}>privacy@frankgrant.app</a>. We will respond within 30 days.</p>

        <h2 style={h2}>8. Security</h2>
        <p style={p}>We implement industry-standard security practices including TLS encryption, rate limiting, input sanitization, and access controls. All admin routes require authenticated admin credentials. We conduct periodic security reviews.</p>

        <h2 style={h2}>9. Changes to This Policy</h2>
        <p style={p}>We may update this Privacy Policy from time to time. We will notify you of material changes via email. Continued use of FrankGrant after changes constitutes acceptance of the updated policy.</p>

        <h2 style={h2}>Contact</h2>
        <p style={p}>Privacy questions: <a href="mailto:privacy@frankgrant.app" style={{ color: '#0e7490' }}>privacy@frankgrant.app</a></p>

        <div style={{ marginTop: 40, paddingTop: 20, borderTop: '1px solid #e5e7eb', fontSize: 12, color: '#9ca3af', textAlign: 'center' }}>
          © 2026 FrankGrant · COARE Holdings ·{' '}
          <a href="/#/terms" style={{ color: '#0e7490' }}>Terms</a> ·{' '}
          <a href="/#/privacy" style={{ color: '#0e7490' }}>Privacy</a>
        </div>
      </div>
    </div>
  )
}
