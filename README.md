# FrankGrant

NIH grant writing & scoring studio — internal tool for COARE Holdings Inc.

## Stack

- **Frontend**: React + Vite → Cloudflare Pages
- **Backend**: Cloudflare Workers (AI proxy, auth, CRUD)
- **Database**: Cloudflare D1 (SQLite)
- **Auth**: Clerk
- **AI**: Anthropic Claude (via Worker proxy — key never in browser)

## Setup

### 1. Clone and install

```bash
git clone https://github.com/Eddiebm/frankgrant.git
cd frankgrant
npm install
```

### 2. Set up Clerk

1. Create account at https://clerk.com
2. Create a new application
3. Copy your **Publishable Key** → paste in `.env.local`
4. Copy your **Secret Key** → use in step 5 (Worker secrets)
5. In Clerk dashboard → API Keys → copy the **PEM public key**

```bash
cp .env.example .env.local
# Edit .env.local with your Clerk publishable key
```

### 3. Set up Cloudflare

```bash
# Login to Cloudflare
npx wrangler login

# Create D1 database
npx wrangler d1 create frankgrant-db
# Copy the database_id into wrangler.toml

# Create KV namespace (for rate limiting)
npx wrangler kv:namespace create FRANKGRANT_KV
# Copy the id into wrangler.toml

# Initialize the database schema
npm run db:init          # local dev
npm run db:init:remote   # Cloudflare (production)
```

### 4. Set Worker secrets

```bash
npx wrangler secret put ANTHROPIC_API_KEY
# paste your Anthropic API key

npx wrangler secret put CLERK_SECRET_KEY
# paste your Clerk secret key

npx wrangler secret put CLERK_PEM_PUBLIC_KEY
# paste your Clerk PEM public key (multi-line — paste then Ctrl+D)
```

### 5. Run locally

```bash
# Terminal 1: Worker
npm run worker:dev

# Terminal 2: Frontend
npm run dev
```

Visit http://localhost:5173

### 6. Deploy

```bash
# Deploy Worker
npm run worker:deploy

# Update VITE_WORKER_URL in .env.local to your deployed Worker URL
# Then deploy frontend
npm run deploy
```

Add your custom domain in the Cloudflare Pages dashboard.

## Project structure

```
frankgrant/
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx     # Project list
│   │   └── GrantEditor.jsx   # Main grant writing UI
│   ├── hooks/
│   │   └── useApi.js         # Worker API client (Clerk token auto-attached)
│   ├── lib/
│   │   ├── nih.js            # NIH page limits, mechanisms, compliance logic
│   │   └── prompts.js        # Write + score system prompts
│   ├── App.jsx               # Auth gate
│   ├── main.jsx              # React entry
│   └── index.css
├── workers/
│   └── api.js                # Cloudflare Worker: auth, AI proxy, CRUD
├── schema.sql                # D1 database schema
├── wrangler.toml             # Cloudflare config
├── vite.config.js
└── package.json
```

## NIH compliance

FrankGrant enforces per-mechanism NIH formatting rules:

| Mechanism | Specific Aims | Research Strategy | Commercialization |
|-----------|--------------|-------------------|-------------------|
| STTR/SBIR Phase I (R41/R43), R21 | 1 page | 6 pages | — |
| STTR/SBIR Phase II (R42/R44), R01 | 1 page | 12 pages | 12 pages |

Font: ≥11pt (Arial, Helvetica, Palatino Linotype, or Georgia)
Margins: ≥0.5" all sides · No headers/footers · Single-column

Word count uses 275 words/page as the NIH standard estimate.
Always verify actual page count in your final PDF before submitting.
