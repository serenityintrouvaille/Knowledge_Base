# The Daily Archive

A private, mobile-first reading room. New posts from the sources you follow arrive in a
chronological **Today** inbox, each with a short brief, a clear availability label and a
one-tap link to the original.

Runs entirely on Cloudflare's free plan: one Worker serves the React app and the API, a
cron trigger does ingestion, and D1 stores everything.

## What's in Phase 1

- Password sign-in for a single owner (signed HttpOnly cookie, 180 days, rate-limited).
- **Today**: Today / Yesterday / Earlier unread, filters (All, Unread, Saved, Source), mark
  read, save, hide, "Show older" paging (no infinite scroll).
- **Article**: source, date, availability (Full text / Excerpt / Metadata only), the brief,
  the original text, reading time, text size, themes, saved reading position, share,
  mark unread, "Report inaccurate brief".
- **Library**: Saved, All, Recently opened, Hidden, filtered by source.
- **Search** across titles, text, excerpts, authors and source names (works for Korean).
- **Settings**: follow a source by pasting any link, add single articles, pause, rename,
  change check frequency, refresh, remove (with confirmation), per-source errors,
  theme and text size, JSON export, sign out.
- Home-screen install on iPhone (manifest + icons).

## Sources and how they're read

| Source | How |
|---|---|
| Naver blogs | `rss.blog.naver.com/{id}.xml` for new posts, then the public mobile post page is fetched **once** to get the full text for your own reading. |
| Substack publications | The publication's `/feed`. Paid posts only carry their public preview and are labelled **Excerpt**. |
| Any site with RSS/Atom | Feed discovery from the page, falling back to `/feed`, `/rss.xml`, etc. |
| Single articles | Settings → Add a single article. The page is fetched and its main text is extracted. |

Not supported: sites behind bot challenges (for example, research.4pillars.io uses Vercel's
checkpoint; follow `fourpillarsfp.substack.com` instead) and the logged-in `substack.com` inbox.

## Briefs

Phase 1 briefs are **extractive and built without AI**. They're the most representative
sentences from the text the site can access, in the author's own words and original order,
grouped into 2–3 paragraphs covering the opening, body and close. If there isn't enough
text, the page says "Summary unavailable" and shows the excerpt instead. Naver's robots.txt
prohibits bot access for AI/RAG use, so Naver content is never sent to an AI model.

## Running locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then set a password and a 64-char secret
npm run db:migrate:local
npm run dev                      # http://localhost:5173
npm test
```

## Deploying (first time)

```bash
npx wrangler login
npx wrangler d1 create daily-archive          # copy the database_id into wrangler.jsonc
npm run db:migrate:remote
npx wrangler secret put APP_PASSWORD          # choose your sign-in password
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET
npm run deploy
```

The site is served at `https://daily-archive.<your-subdomain>.workers.dev`. On iPhone, open
it in Safari → Share → **Add to Home Screen**.

To sign out every device, set a new `SESSION_SECRET`.

## How ingestion stays within the free plan

- The cron runs every 30 minutes. Each run checks only the sources that are due (default:
  every 6 hours) and then extracts text for at most 3 queued items, which keeps each
  invocation light.
- When a source is first added, posts older than 7 days start as read, and full text is
  only fetched automatically for the last 14 days. Older posts fetch on open.
- A failed check records the error on that source and never deletes existing items.
- Items that fail 3 times are retired and keep their excerpt.

## Layout

```
worker/   Hono API, auth, feed parser, HTML → text blocks, brief builder, ingestion
src/      React app (Today, Article, Library, Search, Settings)
shared/   Types shared by both
migrations/  D1 schema
test/     Unit tests for parsing, URLs and briefs
```
