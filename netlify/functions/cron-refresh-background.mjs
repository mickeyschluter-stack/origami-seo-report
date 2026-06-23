import 'dotenv/config';
import { schedule } from '@netlify/functions';
import { getPool } from '../../server/db.js';
import fetchSEO from '../../server/queries/seo.js';

// Daily refresh at 14:30 UTC (9:30 AM EST).
// Filename ends in "-background" so Netlify runs it as a Background Function
// (15-minute timeout). Warms the SEO cache against DA_Improvado so the first
// request after the daily ETL completes in <1s instead of 20+s.
export const handler = schedule('30 14 * * *', async () => {
  const startedAt = new Date().toISOString();
  console.log(`[cron-bg] start ${startedAt}`);
  const summary = { ok: true, startedAt, steps: {} };

  try {
    const pool = await getPool();
    const data = await fetchSEO(pool);
    summary.steps.seo = {
      ok: true,
      daily: data.daily.length,
      keywords: Object.values(data.keywordsByMonth).reduce((s, a) => s + a.length, 0),
    };
    console.log(`[cron-bg] SEO cache: ${data.daily.length} daily rows`);
  } catch (err) {
    summary.steps.seo = { ok: false, error: err.message };
    console.error('[cron-bg] SEO refresh failed:', err.message);
  }

  summary.endedAt = new Date().toISOString();
  console.log(`[cron-bg] done ${summary.endedAt}: ${JSON.stringify(summary.steps)}`);
  return { statusCode: 200 };
});
