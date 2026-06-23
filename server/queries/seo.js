/**
 * Origami Risk SEO — Google Search Console performance + GA4 organic outcomes
 * Sources:
 *   - dbo.gsc_highlevel_keyword_performance        (daily GSC totals)
 *   - dbo.google_search_console_query_by_month     (monthly keyword-level; date = month-1st)
 *   - dbo.ga4_landing_page                         (daily landing-page outcomes, organic channel group)
 * Accounts: sc-domain:origamirisk.com  /  GA4 account_id = 328179682
 *
 * Origami Risk is B2B SaaS (risk / insurance / EHS management software). The primary
 * outcome is CONVERSIONS (demo requests / form-fill leads) — there is no ecommerce
 * revenue or transactions, so this report tracks conversions and engagement, not
 * revenue / AOV / ROAS. The GA4 table has no device dimension.
 */

const GSC_ACCOUNT = 'sc-domain:origamirisk.com';
const GA4_ACCOUNT_ID = 328179682;
// GA4 organic is identified by the default channel group, not session_medium.
const ORGANIC_CHANNEL_GROUP = 'Organic Search';

function rankBucket(pos) {
  if (pos == null) return 'Page 3+';
  if (pos <= 3) return 'Position 1-3';
  if (pos <= 10) return 'Position 4-10';
  if (pos <= 20) return 'Page 2';
  return 'Page 3+';
}

function parsePagePath(landingPage) {
  if (!landingPage) return { level1: '(unknown)', level2: '(unknown)' };
  const path = String(landingPage).split('?')[0].split('#')[0];
  if (!path || path === '/' || path === '') return { level1: '(homepage)', level2: '(homepage)' };
  const segs = path.split('/').filter(Boolean);
  if (segs.length === 0) return { level1: '(homepage)', level2: '(homepage)' };
  return {
    level1: segs[0] || '(homepage)',
    level2: segs[1] || '(none)',
  };
}

// Brand classification — Origami Risk corporate brand.
const BRAND_PATTERNS = [
  /\borigami\s*risk\b/i,
  /\borigami\b/i,
];
function isBrandKeyword(kw) {
  if (!kw) return false;
  return BRAND_PATTERNS.some(re => re.test(kw));
}

function subQuestion(kw) {
  if (!kw) return 'Non-Questions';
  const k = kw.toLowerCase();
  if (k.includes('what')) return 'What';
  if (k.startsWith('how')) return 'How';
  if (k.includes('where')) return 'Where';
  if (k.includes('why')) return 'Why';
  if (k.includes('when')) return 'When';
  return 'Non-Questions';
}

// Risk / insurance / EHS software competitors (RMIS + GRC + EHS landscape) — match triggers Navigational intent.
const COMPETITOR_BRANDS = /\b(riskonnect|rsa\s*archer|archer\s*(?:irm|grc)|logicgate|resolver|ventiv|sapiens|ideagen|cority|intelex|enablon|gensuite|processmap|velocityehs|velocity\s*ehs|aclaimant|clearsight|marsh\s*clearsight|mitratech|metricstream|auditboard|onspring|sai360|servicenow|diligent|a1\s*tracker|ecesis)\b/i;
function searchIntent(kw) {
  if (!kw) return 'Generic';
  const k = kw.toLowerCase();
  if (isBrandKeyword(k) || COMPETITOR_BRANDS.test(k)) return 'Navigational';
  // B2B SaaS buying intent — demo / pricing / trial / contact / login
  if (/\b(demo|request\s*a?\s*demo|book\s*a?\s*demo|pricing|price|prices|cost|costs|quote|free\s*trial|trial|buy|purchase|subscription|subscribe|login|log\s*in|sign\s*in|sign\s*up|contact|get\s*started)\b/i.test(k)) return 'Transactional';
  // Vendor evaluation / comparison
  if (/\b(best|top|vs\.?|versus|review|reviews|comparison|compared|alternative|alternatives|options|vendors?|providers?|companies|leaders?|gartner|forrester|magic\s*quadrant|software|platform|solutions?|systems?|tools?)\b/i.test(k)) return 'Commercial';
  // Informational / research
  if (/\b(how|what|why|when|where|who|which|can|does|do|is|are|guide|guides|definition|define|meaning|example|examples|template|templates|checklist|requirements?|compliance|regulation|regulations?|standard|standards|process|framework|types?)\b/i.test(k)) return 'Informational';
  return 'Generic';
}

export default async function fetchSEO(pool) {
  console.log('[seo] Fetching Origami Risk GSC + GA4 data from Azure SQL...');

  // 24-month look-back so we can show 15-month trends with YoY comparisons
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - 24);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  const [dailyResult, keywordResult, ga4Result, ga4PageResult] = await Promise.all([
    // Daily GSC totals
    pool.request().query(`
      SELECT
        CONVERT(varchar, [date], 23) AS d,
        [search_type] AS searchType,
        SUM(CAST(ISNULL([impressions], 0) AS float)) AS impressions,
        SUM(CAST(ISNULL([clicks], 0) AS float)) AS clicks,
        SUM(CAST(ISNULL([sum_position], 0) AS float)) AS sumPosition,
        AVG(CAST(ISNULL([position], 0) AS float)) AS avgPosition
      FROM dbo.gsc_highlevel_keyword_performance
      WHERE account_id = '${GSC_ACCOUNT}'
        AND [date] >= '${cutoffStr}'
      GROUP BY CONVERT(varchar, [date], 23), [search_type]
    `),
    // Keyword-level (monthly grain — date is the month-1st)
    pool.request().query(`
      SELECT
        CONVERT(varchar, [date], 23) AS d,
        [query] AS keyword,
        SUM(CAST(ISNULL([impressions], 0) AS float)) AS impressions,
        SUM(CAST(ISNULL([clicks], 0) AS float)) AS clicks,
        AVG(CAST(ISNULL([position], 0) AS float)) AS position
      FROM dbo.google_search_console_query_by_month
      WHERE account_id = '${GSC_ACCOUNT}'
        AND [date] >= '${cutoffStr}'
      GROUP BY CONVERT(varchar, [date], 23), [query]
    `),
    // GA4 daily organic — no device dimension on this table
    pool.request().query(`
      SELECT
        CONVERT(varchar, [date], 23) AS d,
        SUM(CAST(ISNULL([sessions], 0) AS float))                   AS sessions,
        SUM(CAST(ISNULL([new_users], 0) AS float))                  AS newUsers,
        SUM(CAST(ISNULL([screen_page_views], 0) AS float))          AS pageviews,
        SUM(CAST(ISNULL([conversions], 0) AS float))                AS conversions,
        SUM(CAST(ISNULL([engaged_sessions], 0) AS float))           AS engagedSessions,
        -- bounce_rate is a rate, so weight it by sessions for a sane daily rollup
        SUM(CAST(ISNULL([bounce_rate], 0) AS float) * CAST(ISNULL([sessions], 0) AS float)) AS bounceRateWeighted
      FROM dbo.ga4_landing_page
      WHERE account_id = ${GA4_ACCOUNT_ID}
        AND [session_default_channel_group] = '${ORGANIC_CHANNEL_GROUP}'
        AND [date] >= '${cutoffStr}'
      GROUP BY CONVERT(varchar, [date], 23)
    `),
    // GA4 month × landing page — drives the Landing Page tab
    pool.request().query(`
      SELECT
        CONVERT(varchar, DATEFROMPARTS(YEAR([date]), MONTH([date]), 1), 23) AS ymStart,
        [landing_page_plus_query_string]                            AS landingPage,
        SUM(CAST(ISNULL([sessions], 0) AS float))                   AS sessions,
        SUM(CAST(ISNULL([new_users], 0) AS float))                  AS newUsers,
        SUM(CAST(ISNULL([screen_page_views], 0) AS float))          AS pageviews,
        SUM(CAST(ISNULL([conversions], 0) AS float))                AS conversions,
        SUM(CAST(ISNULL([engaged_sessions], 0) AS float))           AS engagedSessions,
        SUM(CAST(ISNULL([bounce_rate], 0) AS float) * CAST(ISNULL([sessions], 0) AS float)) AS bounceRateWeighted
      FROM dbo.ga4_landing_page
      WHERE account_id = ${GA4_ACCOUNT_ID}
        AND [session_default_channel_group] = '${ORGANIC_CHANNEL_GROUP}'
        AND [date] >= '${cutoffStr}'
        AND [landing_page_plus_query_string] IS NOT NULL
      GROUP BY DATEFROMPARTS(YEAR([date]), MONTH([date]), 1), [landing_page_plus_query_string]
      HAVING SUM(CAST(ISNULL([sessions], 0) AS float)) > 0
    `),
  ]);

  // ── GSC daily rows ──
  const daily = dailyResult.recordset.map(r => ({
    d: r.d,
    searchType: r.searchType || 'web',
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    sumPosition: r.sumPosition || 0,
    avgPosition: r.avgPosition || 0,
  })).sort((a, b) => a.d.localeCompare(b.d));

  // ── Keyword × month aggregation ──
  const kwMonth = new Map();
  for (const r of keywordResult.recordset) {
    const ym = (r.d || '').slice(0, 7);
    if (!ym) continue;
    const k = `${ym}|${r.keyword || ''}`;
    const existing = kwMonth.get(k) || { keyword: r.keyword || '', ym, impressions: 0, clicks: 0, posWeighted: 0, posImps: 0 };
    existing.impressions += r.impressions || 0;
    existing.clicks += r.clicks || 0;
    existing.posWeighted += (r.position || 0) * (r.impressions || 0);
    existing.posImps += r.impressions || 0;
    kwMonth.set(k, existing);
  }

  const monthlyMap = new Map();
  const monthlyByBrandMap = new Map();
  const monthlyTotalsMap = new Map();
  const top10ByMonth = new Map();
  const overallTop10 = new Set();

  for (const v of kwMonth.values()) {
    const avgPos = v.posImps > 0 ? v.posWeighted / v.posImps : null;
    const rank = rankBucket(avgPos);
    const brand = isBrandKeyword(v.keyword) ? 'Brand' : 'Non-Brand';

    const k1 = `${v.ym}|${rank}`;
    const r1 = monthlyMap.get(k1) || { ym: v.ym, rank, keywords: new Set(), impressions: 0, clicks: 0, posWeighted: 0, posImps: 0 };
    r1.keywords.add(v.keyword);
    r1.impressions += v.impressions;
    r1.clicks += v.clicks;
    r1.posWeighted += v.posWeighted;
    r1.posImps += v.posImps;
    monthlyMap.set(k1, r1);

    const k2 = `${v.ym}|${rank}|${brand}`;
    const r2 = monthlyByBrandMap.get(k2) || { ym: v.ym, rank, brand, keywords: new Set(), impressions: 0, clicks: 0 };
    r2.keywords.add(v.keyword);
    r2.impressions += v.impressions;
    r2.clicks += v.clicks;
    monthlyByBrandMap.set(k2, r2);

    const t = monthlyTotalsMap.get(v.ym) || { ym: v.ym, keywords: new Set(), impressions: 0, clicks: 0, posWeighted: 0, posImps: 0 };
    t.keywords.add(v.keyword);
    t.impressions += v.impressions;
    t.clicks += v.clicks;
    t.posWeighted += v.posWeighted;
    t.posImps += v.posImps;
    monthlyTotalsMap.set(v.ym, t);

    if (avgPos != null && avgPos <= 10 && v.impressions > 0) {
      if (!top10ByMonth.has(v.ym)) top10ByMonth.set(v.ym, new Set());
      top10ByMonth.get(v.ym).add(v.keyword);
      overallTop10.add(v.keyword);
    }
  }

  const monthlyRanks = [...monthlyMap.values()].map(v => ({
    ym: v.ym,
    rank: v.rank,
    keywordCount: v.keywords.size,
    impressions: v.impressions,
    clicks: v.clicks,
    ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    avgPosition: v.posImps > 0 ? v.posWeighted / v.posImps : null,
    posWeighted: v.posWeighted,
    posImps: v.posImps,
  })).sort((a, b) => a.ym.localeCompare(b.ym));

  const monthlyRanksByBrand = [...monthlyByBrandMap.values()].map(v => ({
    ym: v.ym,
    rank: v.rank,
    brand: v.brand,
    keywordCount: v.keywords.size,
    impressions: v.impressions,
    clicks: v.clicks,
    ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
  })).sort((a, b) => a.ym.localeCompare(b.ym));

  const monthlyTotals = [...monthlyTotalsMap.values()].map(v => ({
    ym: v.ym,
    keywordCount: v.keywords.size,
    impressions: v.impressions,
    clicks: v.clicks,
    ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    avgPosition: v.posImps > 0 ? v.posWeighted / v.posImps : null,
  })).sort((a, b) => a.ym.localeCompare(b.ym));

  const top10Monthly = [...top10ByMonth.entries()]
    .map(([ym, set]) => ({ ym, top10Count: set.size }))
    .sort((a, b) => a.ym.localeCompare(b.ym));

  // Top non-brand keywords by month (latest 3)
  const latestYm = monthlyTotals.length > 0 ? monthlyTotals[monthlyTotals.length - 1].ym : null;
  const topNbKeywordsByMonth = new Map();
  if (latestYm) {
    const ymSet = new Set(monthlyTotals.slice(-3).map(t => t.ym));
    const byYm = new Map();
    for (const v of kwMonth.values()) {
      if (!ymSet.has(v.ym)) continue;
      if (isBrandKeyword(v.keyword)) continue;
      if (v.impressions <= 0) continue;
      const arr = byYm.get(v.ym) || [];
      arr.push({
        keyword: v.keyword,
        clicks: v.clicks,
        impressions: v.impressions,
        avgPosition: v.posImps > 0 ? v.posWeighted / v.posImps : null,
        ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      });
      byYm.set(v.ym, arr);
    }
    for (const [ym, arr] of byYm.entries()) {
      arr.sort((a, b) => b.clicks - a.clicks);
      topNbKeywordsByMonth.set(ym, arr.slice(0, 30));
    }
  }
  const topNbKeywords = [...topNbKeywordsByMonth.entries()].map(([ym, kws]) => ({ ym, keywords: kws }));

  // Top keyword pool per month — last 15 months, capped to top 800 by clicks
  const monthsForKeywords = monthlyTotals.slice(-15).map(t => t.ym);
  const monthsSet = new Set(monthsForKeywords);
  const byYmAll = new Map();
  for (const v of kwMonth.values()) {
    if (!monthsSet.has(v.ym)) continue;
    if (v.impressions <= 0) continue;
    const arr = byYmAll.get(v.ym) || [];
    arr.push({
      keyword: v.keyword,
      brand: isBrandKeyword(v.keyword) ? 'Brand' : 'Non-Brand',
      subQuestion: subQuestion(v.keyword),
      intent: searchIntent(v.keyword),
      impressions: v.impressions,
      clicks: v.clicks,
      avgPosition: v.posImps > 0 ? v.posWeighted / v.posImps : null,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
    });
    byYmAll.set(v.ym, arr);
  }
  const keywordsByMonth = {};
  for (const ym of monthsForKeywords) {
    const arr = byYmAll.get(ym) || [];
    arr.sort((a, b) => b.clicks - a.clicks);
    keywordsByMonth[ym] = arr.slice(0, 800);
  }

  // ── GA4 daily organic (no device split on this table) ──
  const ga4Daily = ga4Result.recordset.map(r => ({
    d: r.d,
    sessions: r.sessions || 0,
    newUsers: r.newUsers || 0,
    pageviews: r.pageviews || 0,
    conversions: r.conversions || 0,
    engagedSessions: r.engagedSessions || 0,
    bounceRateWeighted: r.bounceRateWeighted || 0,
  })).sort((a, b) => a.d.localeCompare(b.d));

  // ── GA4 page-month rollups ──
  // Rank pages by total sessions within each month; keep the top 200 pages plus
  // any page that drove conversions (preserves the lead-attribution tail). One
  // row per (month, landing page) — no device split on this table.
  const pagesByKey = new Map();
  for (const r of ga4PageResult.recordset) {
    const ym = (r.ymStart || '').slice(0, 7);
    const lp = r.landingPage || '';
    const key = `${ym}|${lp}`;
    if (!pagesByKey.has(key)) {
      const { level1, level2 } = parsePagePath(lp);
      pagesByKey.set(key, {
        ym, landingPage: lp, level1, level2,
        sessions: 0, newUsers: 0, pageviews: 0,
        conversions: 0, engagedSessions: 0, bounceRateWeighted: 0,
      });
    }
    const ex = pagesByKey.get(key);
    ex.sessions += r.sessions || 0;
    ex.newUsers += r.newUsers || 0;
    ex.pageviews += r.pageviews || 0;
    ex.conversions += r.conversions || 0;
    ex.engagedSessions += r.engagedSessions || 0;
    ex.bounceRateWeighted += r.bounceRateWeighted || 0;
  }
  const ga4PagesRaw = [...pagesByKey.values()];

  const ga4PagesGroupedByYm = new Map();
  for (const p of ga4PagesRaw) {
    if (!ga4PagesGroupedByYm.has(p.ym)) ga4PagesGroupedByYm.set(p.ym, []);
    ga4PagesGroupedByYm.get(p.ym).push(p);
  }
  const ga4Pages = [];
  for (const [, rows] of ga4PagesGroupedByYm.entries()) {
    const ranked = [...rows].sort((a, b) => b.sessions - a.sessions);
    const topPages = new Set(ranked.slice(0, 200).map(r => r.landingPage));
    for (const p of ranked) {
      if (topPages.has(p.landingPage) || p.conversions > 0) {
        ga4Pages.push({
          ym: p.ym, landingPage: p.landingPage,
          sessions: p.sessions, newUsers: p.newUsers, pageviews: p.pageviews,
          conversions: p.conversions, engagedSessions: p.engagedSessions,
        });
      }
    }
  }
  ga4Pages.sort((a, b) => a.ym.localeCompare(b.ym));

  const keywordsByMonthCount = Object.values(keywordsByMonth).reduce((s, arr) => s + arr.length, 0);
  console.log(
    `[seo] Fetched ${daily.length} GSC daily rows, ${monthlyRanks.length} month-rank rollups, ` +
    `${monthlyRanksByBrand.length} brand-split rank rollups, ${monthlyTotals.length} monthly totals, ` +
    `${topNbKeywords.length} months with top NB keywords, ${keywordsByMonthCount} top-800 keyword-month rows, ` +
    `${top10Monthly.length} months with top-10 keywords (${overallTop10.size} unique top-10 all-time), ` +
    `${ga4Daily.length} GA4 organic daily rows, ${ga4Pages.length} GA4 page-month rows`
  );

  return {
    main: {
      daily,
      monthlyRanks,
      monthlyRanksByBrand,
      monthlyTotals,
      topNbKeywords,
      keywordsByMonth,
      top10Monthly,
      ga4Daily,
      fetchedAt: new Date().toISOString(),
    },
    pages: {
      ga4Pages,
      fetchedAt: new Date().toISOString(),
    },
  };
}

export function emptySEO() {
  return {
    main: { daily: [], monthlyRanks: [], monthlyRanksByBrand: [], monthlyTotals: [], topNbKeywords: [], keywordsByMonth: {}, top10Monthly: [], ga4Daily: [], fetchedAt: null },
    pages: { ga4Pages: [], fetchedAt: null },
  };
}
