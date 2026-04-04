# ShelfRead — Newsletter-to-EPUB Service

ShelfRead turns email newsletters into beautifully typeset EPUBs, organized by series, and served to any EPUB reader app via a personal OPDS catalog.

It bridges the gap between the convenience of newsletter subscriptions and the deep-reading experience of e-books. ShelfRead uses AI to extract content and infer the visual identity of each newsletter, then generates EPUBs with styling that echoes the original design — color palette, typography mood, layout rhythm — adapted for reflowable e-reader screens.

Written with agent support.

## How It Works

```
Email arrives → Cloudflare Email Worker → Convex /ingest endpoint
  → Gemini extracts content + analyzes design
  → EPUB generated with per-series "design echo" CSS
  → Stored in Convex file storage
  → Served via OPDS catalog to Readest / KOReader / any OPDS reader
```

## Features

- **AI content extraction** — Gemini strips email chrome (headers, footers, tracking pixels, unsubscribe links) and extracts clean article content
- **Design echo** — AI analyzes each newsletter's visual identity (colors, typography, layout) and generates a per-series CSS theme for the EPUBs
- **Series auto-detection** — newsletters are automatically grouped into series by sender email
- **OPDS catalog** — browse and download EPUBs from any compatible reader app
- **Signed download URLs** — HMAC-signed, time-limited download links
- **Sender allowlist** — only process emails from approved senders
- **Duplicate detection** — skip duplicate issues within the same series
- **Web dashboard** — live-updating status, series management with design preview, settings
- **Email automation** — forward newsletters to `inbox@shelfread.xyz` and they appear as EPUBs

## Stack

| Layer | Technology |
|-------|-----------|
| Backend | [Convex](https://convex.dev) — database, serverless functions, file storage, scheduling |
| AI | Google Gemini 2.5 Flash — content extraction, design analysis |
| EPUB | [epub-gen-memory](https://github.com/cpiber/epub-gen-memory) — in-memory EPUB generation |
| Dashboard | React + Vite |
| Email | Cloudflare Email Workers (free) or any service that POSTs to a webhook |

## Quick Start

### Prerequisites

- Node.js 20+
- A [Convex](https://convex.dev) account (free)
- A [Google Gemini API key](https://aistudio.google.com) (free tier)

### 1. Clone and install

```bash
git clone https://github.com/johannesmauerer/shelfread.git
cd shelfread
npm install
cd web && npm install && cd ..
```

### 2. Initialize Convex

```bash
npx convex dev
```

This will prompt you to log in and create a project. It writes `.env.local` with your deployment URLs.

### 3. Set environment variables

In the [Convex dashboard](https://dashboard.convex.dev), go to your project > Settings > Environment Variables and add:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `OPDS_USERNAME` | No | Basic Auth username for OPDS (default: `shelf`) |
| `OPDS_PASSWORD` | No | Basic Auth password for OPDS (disabled if unset) |
| `DOWNLOAD_SECRET` | No | HMAC secret for signed download URLs (default: dev secret) |
| `SHELF_INGEST_KEY` | No | Shared secret for webhook authentication |

### 4. Start the dashboard

```bash
cd web && npm run dev
```

Open http://localhost:5173 — you should see the ShelfRead dashboard.

### 5. Test the pipeline

Use the Manual Ingest form on the dashboard, or POST directly:

```bash
curl -X POST https://YOUR-DEPLOYMENT.convex.site/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Author Name <author@example.com>",
    "subject": "My Newsletter Issue",
    "htmlBody": "<html><body><h1>Hello</h1><p>Newsletter content here.</p></body></html>"
  }'
```

The issue should appear in the dashboard, process through Gemini, and produce a downloadable EPUB within ~30 seconds.

## Connecting an OPDS Reader

### Readest / KOReader

Add this OPDS catalog URL in your reader app's library settings:

```
https://YOUR-DEPLOYMENT.convex.site/opds/shelf/catalog.xml
```

If your reader doesn't support navigation feeds, use the direct recent issues feed:

```
https://YOUR-DEPLOYMENT.convex.site/opds/shelf/recent.xml
```

The OPDS feed URL and credentials are also shown on the Settings page of the dashboard.

## Email Automation

ShelfRead accepts emails via any service that can POST to a webhook. The ingest endpoint supports:

- **JSON** — `{ "from": "...", "subject": "...", "htmlBody": "..." }`
- **multipart/form-data** — Mailgun-compatible format with `from`, `subject`, `body-html` fields

### Cloudflare Email Workers (recommended, free)

1. Register a cheap domain (e.g. `.xyz` for ~$1/year) on [Cloudflare Registrar](https://domains.cloudflare.com)
2. Enable Email Routing on the domain
3. Deploy the included email worker:

```bash
cd cloudflare-worker
npm install
npx wrangler login
npx wrangler deploy
```

4. In Cloudflare dashboard, create an Email Routing rule: `inbox@yourdomain.xyz` → Send to Worker → `shelf-email-worker`

See `cloudflare-worker/` for the full worker source code.

### Other services

Any email service that supports inbound webhooks works: Mailgun, Postmark, SendGrid, Forward Email. Configure them to POST to `https://YOUR-DEPLOYMENT.convex.site/ingest`.

## Project Structure

```
shelfread/
├── convex/                  # Convex backend
│   ├── schema.ts            # Database schema
│   ├── http.ts              # HTTP router (ingest, download, OPDS)
│   ├── ingest.ts            # Email ingestion endpoint
│   ├── process.ts           # AI extraction + EPUB generation pipeline
│   ├── series.ts            # Series CRUD
│   ├── issues.ts            # Issues CRUD
│   ├── opds.ts              # OPDS catalog feed generation
│   ├── download.ts          # EPUB download (direct + signed)
│   ├── settings.ts          # Key-value settings
│   └── lib/
│       ├── gemini.ts        # Gemini API client + prompts
│       ├── epub.ts          # EPUB generation
│       ├── css.ts           # Design echo CSS generator
│       ├── opdsXml.ts       # OPDS Atom/XML builder
│       ├── signing.ts       # URL signing/verification
│       └── types.ts         # Shared type definitions
├── cloudflare-worker/       # Email ingestion worker
│   ├── email-worker.js      # Cloudflare Email Worker
│   ├── wrangler.toml        # Worker config
│   └── package.json
├── web/                     # React dashboard
│   └── src/
│       ├── App.tsx          # Router + layout
│       ├── pages/
│       │   ├── Dashboard.tsx
│       │   ├── SeriesList.tsx
│       │   ├── SeriesDetail.tsx
│       │   └── Settings.tsx
│       └── components/
│           └── StatusBadge.tsx
├── epub-templates/
│   └── base-style.css       # Default EPUB stylesheet
├── convex.json              # Convex project config
├── .env.example             # Environment variable template
└── PRD.md                   # Product Requirements Document
```

## Design Echo

When ShelfRead encounters a new newsletter series, it uses Gemini to analyze the email's visual design and extract:

- **Color palette** — primary, secondary, accent colors
- **Typography mood** — serif-formal, sans-casual, mono-technical, etc.
- **Layout features** — dividers, pull quotes, callout boxes

This profile generates a per-series CSS stylesheet embedded in every EPUB. The result reads like a well-designed book that carries the newsletter's visual DNA, adapted for reflowable e-reader screens.

## OPDS Endpoints

| Path | Type | Description |
|------|------|-------------|
| `/opds/{secret}/catalog.xml` | Navigation | Root catalog |
| `/opds/{secret}/series.xml` | Navigation | All series |
| `/opds/{secret}/series/{slug}.xml` | Acquisition | Issues in a series |
| `/opds/{secret}/recent.xml` | Acquisition | Last 50 issues |
| `/dl/{signed-token}` | Download | Signed EPUB download |
| `/download?id={issueId}` | Download | Direct EPUB download |

## Development

```bash
# Terminal 1: Convex backend (watches for changes)
npx convex dev

# Terminal 2: Web dashboard
cd web && npm run dev
```

## License

MIT
