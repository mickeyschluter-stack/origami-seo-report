/**
 * Origami Risk — AI referral traffic (humans arriving from AI assistants)
 * Source: dbo.ga4_landing_page, GA4 account_id = 328179682.
 *
 * GA4's native default channel group "AI Assistant" captures sessions referred
 * from recognized generative-AI engines (ChatGPT, Perplexity, Gemini, Copilot, etc.).
 * This is humans clicking through from an AI answer — distinct from the AI Agent
 * Traffic tab, which counts the bots/crawlers themselves.
 *
 * Caveat: this table's session_source_medium dimension is empty for Origami, so
 * the engine-level split (ChatGPT vs Perplexity) is not available here — only the
 * aggregate AI Assistant channel. The channel began populating in June 2026.
 */

const GA4_ACCOUNT_ID = 328179682;
const AI_CHANNEL_GROUP = 'AI Assistant';

export default async function fetchAIReferrals(pool) {
  console.log('[ai-referrals] Fetching Origami Risk GA4 AI Assistant channel...');

  // 13-month look-back (channel is new, so this captures all of it plus headroom)
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 13);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [trendResult, pageResult] = await Promise.all([
    pool.request().query(`
      SELECT
        CONVERT(varchar, DATEFROMPARTS(YEAR([date]), MONTH([date]), 1), 23) AS ym,
        SUM(CAST(ISNULL([sessions], 0) AS float))         AS sessions,
        SUM(CAST(ISNULL([engaged_sessions], 0) AS float)) AS engagedSessions,
        SUM(CAST(ISNULL([new_users], 0) AS float))        AS newUsers,
        SUM(CAST(ISNULL([conversions], 0) AS float))      AS conversions
      FROM dbo.ga4_landing_page
      WHERE account_id = ${GA4_ACCOUNT_ID}
        AND [session_default_channel_group] = '${AI_CHANNEL_GROUP}'
        AND [date] >= '${cutoffStr}'
      GROUP BY DATEFROMPARTS(YEAR([date]), MONTH([date]), 1)
    `),
    pool.request().query(`
      SELECT TOP 25
        [landing_page_plus_query_string]                  AS landingPage,
        SUM(CAST(ISNULL([sessions], 0) AS float))         AS sessions,
        SUM(CAST(ISNULL([engaged_sessions], 0) AS float)) AS engagedSessions,
        SUM(CAST(ISNULL([conversions], 0) AS float))      AS conversions
      FROM dbo.ga4_landing_page
      WHERE account_id = ${GA4_ACCOUNT_ID}
        AND [session_default_channel_group] = '${AI_CHANNEL_GROUP}'
        AND [date] >= '${cutoffStr}'
        AND [landing_page_plus_query_string] IS NOT NULL
      GROUP BY [landing_page_plus_query_string]
      HAVING SUM(CAST(ISNULL([sessions], 0) AS float)) > 0
      ORDER BY SUM(CAST(ISNULL([sessions], 0) AS float)) DESC
    `),
  ]);

  const trend = trendResult.recordset.map(r => ({
    ym: r.ym,
    sessions: r.sessions || 0,
    engagedSessions: r.engagedSessions || 0,
    newUsers: r.newUsers || 0,
    conversions: r.conversions || 0,
  })).sort((a, b) => a.ym.localeCompare(b.ym));

  const topPages = pageResult.recordset.map(r => ({
    landingPage: r.landingPage || '',
    sessions: r.sessions || 0,
    engagedSessions: r.engagedSessions || 0,
    conversions: r.conversions || 0,
  }));

  const totals = trend.reduce((acc, m) => ({
    sessions: acc.sessions + m.sessions,
    engagedSessions: acc.engagedSessions + m.engagedSessions,
    conversions: acc.conversions + m.conversions,
  }), { sessions: 0, engagedSessions: 0, conversions: 0 });

  console.log(`[ai-referrals] ${trend.length} months, ${topPages.length} landing pages, ${totals.sessions} total sessions`);

  return { trend, topPages, totals, fetchedAt: new Date().toISOString() };
}

export function emptyAIReferrals() {
  return { trend: [], topPages: [], totals: { sessions: 0, engagedSessions: 0, conversions: 0 }, fetchedAt: null };
}
