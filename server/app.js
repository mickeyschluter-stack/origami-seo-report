/**
 * Express app for origami-seo (Origami Risk SEO & AI Visibility Report)
 *
 * Endpoints:
 *   GET  /api/seo            — Main GSC + GA4 organic payload (without per-page rollup)
 *   GET  /api/seo/pages      — GA4 page-month-device rollup (split out to stay under Netlify's 6 MB function payload cap)
 *   GET  /api/cron-refresh   — warms both caches
 *   GET  /api/health         — basic health probe
 *
 * Caching: 3-layer (in-memory → file (tmpdir) → DB fetch) with stale-while-revalidate.
 */
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getPool } from './db.js';
import fetchSEO, { emptySEO } from './queries/seo.js';
import fetchAIReferrals from './queries/aiReferrals.js';

const app = express();
app.use(cors());
app.use(compression());
app.use(express.json());

const CACHE_TTL = 15 * 60 * 1000;
// Single in-memory cache holds the whole { main, pages } structure; we split it
// at response time so each endpoint stays under Netlify's 6 MB function cap.
let seoCache = { data: null, timestamp: 0 };

function isFresh(c, ttl = CACHE_TTL) { return c.data && (Date.now() - c.timestamp) < ttl; }

const TMP = os.tmpdir();
// v2 suffix invalidates pre-schema-split cache files left in /tmp by older builds.
const FILE_CACHE_SEO = path.join(TMP, 'origami-seo-cache-seo-v1.json');

function writeFileCache(filePath, data) {
  try {
    fs.writeFileSync(filePath, JSON.stringify({ data, timestamp: Date.now() }), 'utf8');
  } catch (err) {
    console.error(`[file-cache] Write failed for ${filePath}:`, err.message);
  }
}

function readFileCache(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (err) {
    console.error(`[file-cache] Read failed for ${filePath}:`, err.message);
    return null;
  }
}

function loadFileCacheOnStartup() {
  const seoFile = readFileCache(FILE_CACHE_SEO);
  if (seoFile) seoCache = { data: seoFile.data, timestamp: seoFile.timestamp };
}
loadFileCacheOnStartup();

let seoRefreshing = false;

function triggerSeoRefresh() {
  if (seoRefreshing) return;
  seoRefreshing = true;
  (async () => { const pool = await getPool(); return fetchSEO(pool); })()
    .then(data => {
      seoCache = { data, timestamp: Date.now() };
      writeFileCache(FILE_CACHE_SEO, data);
      console.log(`[api] SEO bg refresh: ${data.main.daily.length} daily rows, ${data.pages.ga4Pages.length} page rows`);
    })
    .catch(err => console.error('[api] SEO bg refresh failed:', err.message))
    .finally(() => { seoRefreshing = false; });
}

function setCacheHeaders(res) {
  res.set('Cache-Control', 's-maxage=900, stale-while-revalidate=86400');
}

async function ensureFresh() {
  if (isFresh(seoCache)) return seoCache.data;
  if (seoCache.data) { triggerSeoRefresh(); return seoCache.data; }
  const pool = await getPool();
  const data = await fetchSEO(pool);
  seoCache = { data, timestamp: Date.now() };
  writeFileCache(FILE_CACHE_SEO, data);
  return data;
}

// ── Main SEO payload (everything except per-page rollup) ──
app.get('/api/seo', async (req, res) => {
  setCacheHeaders(res);
  try {
    const data = await ensureFresh();
    res.json(data.main);
  } catch (err) {
    console.error('[api] SEO error:', err.message);
    if (seoCache.data) return res.json(seoCache.data.main);
    res.json(emptySEO().main);
  }
});

// ── GA4 page-month-device rollup (split out to fit under Netlify's 6 MB cap) ──
app.get('/api/seo/pages', async (req, res) => {
  setCacheHeaders(res);
  try {
    const data = await ensureFresh();
    res.json(data.pages);
  } catch (err) {
    console.error('[api] SEO pages error:', err.message);
    if (seoCache.data) return res.json(seoCache.data.pages);
    res.json(emptySEO().pages);
  }
});

async function refreshAll() {
  try {
    const pool = await getPool();
    const data = await fetchSEO(pool);
    seoCache = { data, timestamp: Date.now() };
    writeFileCache(FILE_CACHE_SEO, data);
    console.log(`[cron] SEO cache refreshed: ${data.main.daily.length} daily rows, ${data.pages.ga4Pages.length} page rows`);
  } catch (err) {
    console.error('[cron] SEO refresh failed:', err.message);
  }
}

app.get('/api/cron-refresh', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  console.log('[cron] origami-seo refresh triggered');
  await refreshAll();
  res.json({
    ok: true,
    seoDailyRows: seoCache.data ? seoCache.data.main.daily.length : 0,
    ga4PageRows: seoCache.data ? seoCache.data.pages.ga4Pages.length : 0,
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    seoCacheAge: seoCache.data ? `${((Date.now() - seoCache.timestamp) / 1000).toFixed(0)}s` : 'empty',
  });
});

// ── Scrunch AI Visibility ──
const SCRUNCH_KEY = process.env.SCRUNCH_API_KEY;
const SCRUNCH_BRAND = 3475;
const SCRUNCH_API_BASE = 'https://api.scrunchai.com/v1';
let scrunchCache = { data: null, timestamp: 0 };
const SCRUNCH_TTL = 60 * 60 * 1000; // 1 hour

async function loadScrunch() {
  const h = { Authorization: `Bearer ${SCRUNCH_KEY}` };
  const b = `${SCRUNCH_API_BASE}/${SCRUNCH_BRAND}`;
  const q = f => fetch(`${b}/query?fields=${f}`, { headers: h }).then(r => r.json());

  const [promptsData, weekly, topics, competitors, platforms, prompts] = await Promise.all([
    fetch(`${b}/prompts?limit=1`, { headers: h }).then(r => r.json()),
    q('date_week,brand_presence_percentage,brand_position_score,brand_sentiment_score,responses'),
    q('prompt_topic,brand_presence_percentage,responses,brand_sentiment_score'),
    q('competitor_name,competitor_presence_percentage,responses'),
    q('ai_platform,brand_presence_percentage,responses'),
    q('prompt,brand_presence_percentage,brand_sentiment_score,responses'),
  ]);

  return {
    prompts: promptsData.total ?? 0,
    weeklyTrend: Array.isArray(weekly) ? weekly : [],
    topicBreakdown: (Array.isArray(topics) ? topics : []).filter(t => t.prompt_topic),
    competitorBreakdown: (Array.isArray(competitors) ? competitors : [])
      .filter(c => c.competitor_name)
      .sort((a, b) => b.competitor_presence_percentage - a.competitor_presence_percentage),
    platformBreakdown: (Array.isArray(platforms) ? platforms : [])
      .sort((a, b) => b.brand_presence_percentage - a.brand_presence_percentage),
    promptBreakdown: (Array.isArray(prompts) ? prompts : [])
      .filter(p => p.prompt)
      .sort((a, b) => b.brand_presence_percentage - a.brand_presence_percentage),
  };
}

// ── AI Agent Traffic (bot crawler logs) ──
// Served from a periodically-refreshed snapshot (server/agentTrafficSnapshot.json),
// because Scrunch's agent-traffic data is not exposed on the public REST API the
// rest of the dashboard uses. A scheduled job re-exports it into the snapshot file.
// Resolve from process.cwd() (repo root locally; Netlify function bundle root in
// prod, where netlify.toml `included_files` places it at server/agentTrafficSnapshot.json).
const AGENT_TRAFFIC_FILE = path.join(process.cwd(), 'server', 'agentTrafficSnapshot.json');

app.get('/api/agent-traffic', (req, res) => {
  setCacheHeaders(res);
  try {
    const snapshot = JSON.parse(fs.readFileSync(AGENT_TRAFFIC_FILE, 'utf8'));
    res.json(snapshot);
  } catch (err) {
    console.error('[agent-traffic]', err.message);
    res.status(502).json({ error: 'Agent traffic snapshot unavailable' });
  }
});

// ── AI Referral Traffic (GA4 "AI Assistant" channel — humans arriving from AI engines) ──
let aiReferralsCache = { data: null, timestamp: 0 };

app.get('/api/ai-referrals', async (req, res) => {
  setCacheHeaders(res);
  if (isFresh(aiReferralsCache)) return res.json(aiReferralsCache.data);
  try {
    const pool = await getPool();
    const data = await fetchAIReferrals(pool);
    aiReferralsCache = { data, timestamp: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('[ai-referrals]', err.message);
    if (aiReferralsCache.data) return res.json(aiReferralsCache.data);
    res.status(502).json({ error: 'AI referral data unavailable' });
  }
});

app.get('/api/scrunch', async (req, res) => {
  setCacheHeaders(res);
  if (!SCRUNCH_KEY) return res.status(503).json({ error: 'SCRUNCH_API_KEY not configured' });
  if (isFresh(scrunchCache, SCRUNCH_TTL)) return res.json(scrunchCache.data);
  try {
    const data = await loadScrunch();
    scrunchCache = { data, timestamp: Date.now() };
    res.json(data);
  } catch (err) {
    console.error('[scrunch]', err.message);
    if (scrunchCache.data) return res.json(scrunchCache.data);
    res.status(502).json({ error: 'Scrunch API unavailable' });
  }
});

export default app;
