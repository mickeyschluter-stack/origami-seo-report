# wacoal-seo — deploy & setup

Standalone Wacoal SEO Report. Deploys to its own `wacoal-seo` Netlify site,
independent of any other Direct Agents dashboard.

## What's in this folder

```
src/
  App.jsx                        ← SEO-only entry
  SEODashboard.jsx               ← tab shell (Exec / Keywords / Landing Pages)
  SEOExecutivePerformance.jsx    ← GSC + GA4 executive view
  SEOKeywordsPerformance.jsx     ← keyword performance
  SEOLandingPagePerformance.jsx  ← landing page performance (with device filter)
  csvExport.js                   ← shared CSV export helper
  PasswordGate.jsx               ← simple password wall

server/
  app.js                         ← Express app (SEO endpoint only)
  db.js                          ← Azure SQL pool (DA_Improvado)
  index.js                       ← local dev entry
  queries/seo.js                 ← GSC + GA4 query

netlify/functions/
  api.mjs                        ← wraps server/app.js with serverless-http
  cron-refresh-background.mjs    ← Netlify scheduled background function (daily 14:30 UTC)
```

## Data sources

- GSC account: `sc-domain:wacoal-america.com`
- GA4 account_id: `239787351`, filtered to `session_medium = 'organic'`
- Tables (all in `DA_Improvado`):
  - `dbo.gsc_highlevel_keyword_performance`
  - `dbo.google_search_console_query_by_month`
  - `dbo.ga4_landing_page_path_with_country_device`

## One-time setup

### Netlify env vars on the `wacoal-seo` site

- `AZURE_SQL_SERVER` = `daazure1.database.windows.net`
- `AZURE_SQL_PORT` = `1433`
- `AZURE_SQL_DATABASE` = `DA_Improvado`
- `AZURE_SQL_USER` = (same DB user used by other DA dashboards)
- `AZURE_SQL_PASSWORD` = (same DB password, secret)
- `CRON_SECRET` = (any random string — gates `/api/cron-refresh`)
- `VITE_DASH_PASSWORD` = (sign-in password shared with the client)

### Local dev

```bash
npm install
npm run dev
```

Server runs on `:3001`, Vite on `:5180`. Vite proxies `/api/*` to Express.

## Deploy

```bash
cd "C:\Users\Nancy Nan\Downloads\wacoal-seo-source"
npm install         # first time only
npm run build       # produces dist/
netlify deploy --prod --dir dist --functions netlify/functions --site wacoal-seo
```

After first prod deploy verify:

- `https://wacoal-seo.netlify.app/api/health` → `status: ok`
- `https://wacoal-seo.netlify.app/api/seo` → JSON with `daily`, `monthlyRanks`, `ga4Daily`, `ga4Pages`
- Dashboard shows three tabs: **Executive Performance**, **Keywords Performance**, **Landing Page Performance**

## Cron / scheduled refresh

`netlify/functions/cron-refresh-background.mjs` runs daily at 14:30 UTC
(9:30 AM EST) as a Background Function (15-min timeout). It warms the SEO
cache so the first request after the daily ETL completes in <1s.

## API surface

| Endpoint                    | Purpose                                    |
|-----------------------------|--------------------------------------------|
| `GET /api/seo`              | SEO tabs payload (GSC + GA4)               |
| `GET /api/cron-refresh`     | Cron-triggered refresh (gated by CRON_SECRET) |
| `GET /api/health`           | Cache-age probe                            |
