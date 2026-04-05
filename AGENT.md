<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# ShelfRead — Developer Guide

## What This Is

Newsletter-to-EPUB service. Emails forwarded to `inbox@shelfread.xyz` are processed by AI (Gemini), converted to styled EPUBs, and served via OPDS catalog to e-reader apps.

## Architecture

```
Email → Cloudflare Email Worker → Convex HTTP /ingest → Gemini extraction → EPUB generation → OPDS feed
```

Three deployments:
1. **Convex** (`colorful-quail-252`) — backend, database, file storage, HTTP endpoints
2. **Cloudflare Worker** (`shelf-email-worker`) — parses incoming email MIME, POSTs to Convex
3. **Vite dev server** (localhost:5173) — React dashboard, not deployed anywhere

## Running Locally

```bash
cd ~/Engineering/shelfread

# Terminal 1: Convex backend (auto-deploys on save)
npx convex dev

# Terminal 2: Dashboard
cd web && npm run dev
```

Dashboard at http://localhost:5173. Convex functions deploy to cloud immediately.

## Key Files

### Backend (convex/)
- `schema.ts` — three tables: `series`, `issues`, `settings`
- `http.ts` — HTTP router: `/ingest`, `/download`, `/dl/*`, `/opds/*`
- `ingest.ts` — receives email POSTs (JSON or multipart), allowlist check, creates issue, schedules processing
- `process.ts` — orchestrator: Gemini extraction → series matching → design analysis → EPUB generation → storage. Has `"use node"` directive
- `series.ts` — series CRUD, slug generation, design storage
- `issues.ts` — issue CRUD, duplicate detection
- `opds.ts` — OPDS Atom/XML feed generation with Basic Auth + secret path
- `download.ts` — EPUB download (direct for dashboard, signed for OPDS)
- `lib/gemini.ts` — Gemini API calls for content extraction + design analysis. `"use node"`
- `lib/epub.ts` — EPUB generation via epub-gen-memory + JSZip post-processing for series metadata. `"use node"`
- `lib/css.ts` — generates per-series CSS from design profile (no `"use node"`)
- `lib/types.ts` — shared TypeScript interfaces (no `"use node"`)
- `lib/opdsXml.ts` — OPDS Atom feed XML builder (no `"use node"`)
- `lib/signing.ts` — HMAC URL signing via Web Crypto API (no `"use node"`)

### Convex `"use node"` rules
- Files with `"use node"` can only export `action`/`internalAction`, NOT queries/mutations
- Files without `"use node"` CANNOT import from files with it (except `import type`)
- Shared types go in `lib/types.ts` (no `"use node"`)

### Email Worker (cloudflare-worker/)
- `email-worker.js` — parses MIME via postal-mime, extracts original sender from forwarded emails, POSTs to Convex
- `wrangler.toml` — gitignored, contains deployment-specific config (ingest URL)
- `wrangler.toml.example` — template for new setups
- **Must use `workers_dev = true`** — otherwise `wrangler deploy` breaks the email routing binding

### Dashboard (web/)
- Hash-based routing: `#` (dashboard), `#series`, `#series/{id}`, `#settings`
- Imports Convex API from `../../../convex/_generated/api`
- Uses `import type` for dataModel imports (`.d.ts` only, no `.js` — Vite can't resolve runtime imports)
- Env vars loaded from parent dir via `envDir: '..'` and `envPrefix: ['VITE_', 'CONVEX_']` in vite.config.ts

## Convex Environment Variables

Set in Convex dashboard (dashboard.convex.dev) > Settings > Environment Variables:

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY` | Yes | Google Gemini API key |
| `OPDS_SECRET_PATH` | Yes (prod) | Secret UUID segment in OPDS URL path |
| `OPDS_USERNAME` | No | Basic Auth username (default: `shelf`) |
| `OPDS_PASSWORD` | Yes (prod) | Basic Auth password — use only alphanumeric (colons break Basic Auth) |
| `DOWNLOAD_SECRET` | Yes (prod) | HMAC secret for signed download URLs |
| `SHELF_INGEST_KEY` | No | Shared secret for webhook auth |

## Deploying Changes

### Convex functions
```bash
cd ~/Engineering/shelfread
npx convex dev --once
```

### Cloudflare Email Worker
```bash
cd ~/Engineering/shelfread/cloudflare-worker
npx wrangler deploy
```
**Important:** `wrangler.toml` is gitignored. Copy from `wrangler.toml.example` and set your ingest URL. After first deploy, create the email routing rule in Cloudflare dashboard (Email > Email Routing > Routing Rules).

### Dashboard
Not deployed — runs locally via `npm run dev` in `web/`.

## Processing Pipeline Detail

1. **Ingest** (`ingest.ts`): parse email, check allowlist (checks both `from` and `forwardedBy`), store raw HTML, match/create series by sender email, schedule processing
2. **Extract** (`process.ts` → `gemini.ts`): send HTML to Gemini, get structured JSON back (title, author, publication_name, sender_email, content_html, summary)
3. **Series resolution** (`process.ts`): if Gemini found a different sender_email than the series has, find/create the correct series. Update series name and slug from AI extraction.
4. **Design analysis** (`process.ts` → `gemini.ts`): on first issue of a new series, analyze visual design (colors, typography, layout). Store profile on series. Generate CSS via `css.ts`.
5. **EPUB generation** (`epub.ts`): generate EPUB via epub-gen-memory, post-process with JSZip to inject `belongs-to-collection` series metadata and remove TOC from spine.
6. **Storage**: store EPUB in Convex file storage, update issue status to `ready`.
7. **Retry**: on failure, exponential backoff (1min, 5min, 30min), max 3 retries.

## Gotchas & Lessons Learned

- **Gemini model**: use `gemini-2.5-flash` (not 2.0, which is deprecated)
- **epub-gen-memory**: use `new EPub().render().genEpub()` pattern, NOT the default export function
- **Forwarded emails**: `message.from` in Cloudflare worker is the forwarder, not the original newsletter sender. Worker extracts original sender from headers/body. Allowlist must check `forwardedBy` field.
- **OPDS passwords**: must be alphanumeric — colons break HTTP Basic Auth parsing
- **Convex `process.env`**: only available in actions, not queries/mutations
- **Vite env**: Convex writes `CONVEX_URL` (not `VITE_CONVEX_URL`). Dashboard uses `envPrefix: ['VITE_', 'CONVEX_']` to expose both.

## Data Management

To clear all data (issues, series, stored files), temporarily create `convex/cleanup.ts`:
```typescript
import { internalMutation } from "./_generated/server";
export const clearAll = internalMutation({
  args: {},
  handler: async (ctx) => {
    const issues = await ctx.db.query("issues").collect();
    for (const issue of issues) {
      if (issue.rawHtmlStorageId) await ctx.storage.delete(issue.rawHtmlStorageId);
      if (issue.epubFileId) await ctx.storage.delete(issue.epubFileId);
      await ctx.db.delete(issue._id);
    }
    const series = await ctx.db.query("series").collect();
    for (const s of series) {
      if (s.coverImageId) await ctx.storage.delete(s.coverImageId);
      await ctx.db.delete(s._id);
    }
    return { deletedIssues: issues.length, deletedSeries: series.length };
  },
});
```
Run with `npx convex run cleanup:clearAll`, then delete the file.
