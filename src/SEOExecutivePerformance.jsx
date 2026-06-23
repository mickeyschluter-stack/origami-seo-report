import React, { useState, useEffect, useMemo } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell,
} from 'recharts'
import { downloadCsv, csvFmtPct, csvFmtChg } from './csvExport'

// Small visual button used by every "Export CSV" affordance
function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}
      title="Export this table as CSV"
    >📥 CSV</button>
  )
}

// ── Formatting helpers ──
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString()
const fmtPct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%'
const fmtChg = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
const pctChange = (c, p) => p === 0 ? (c > 0 ? 1 : null) : (c - p) / p

// ── Date helpers ──
const ymOf = d => (d || '').slice(0, 7)
const lastFullMonth = () => {
  // "Previous month" relative to today, using full-month boundaries.
  const n = new Date()
  const y = n.getFullYear(), m = n.getMonth() // 0-indexed; previous month = m - 1
  const prev = new Date(y, m - 1, 1)
  return prev.toISOString().slice(0, 7)
}
const prevMonth = ym => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 2, 1) // m is 1-indexed; previous = m-2 in JS
  return d.toISOString().slice(0, 7)
}
const yoyMonth = ym => {
  const [y, m] = ym.split('-').map(Number)
  return `${y - 1}-${String(m).padStart(2, '0')}`
}
const monthLabel = ym => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}

// Build the last N months as YYYY-MM strings, ending at the given month.
function lastNMonths(endYm, n) {
  const out = []
  let [y, m] = endYm.split('-').map(Number)
  for (let i = 0; i < n; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`)
    m -= 1
    if (m === 0) { m = 12; y -= 1 }
  }
  return out
}

const RANK_ORDER = ['Position 1-3', 'Position 4-10', 'Page 2', 'Page 3+']
const RANK_COLOR = {
  'Position 1-3': '#38a169',
  'Position 4-10': '#3182ce',
  'Page 2': '#e8a838',
  'Page 3+': '#e53e3e',
}

// Bar metrics — raw, summable volumes (left axis)
const BAR_METRICS = [
  { key: 'impressions', label: 'Impressions', fmt, color: '#2c5282', source: 'GSC' },
  { key: 'clicks', label: 'Clicks', fmt, color: '#3182ce', source: 'GSC' },
  { key: 'top10', label: 'Top-10 Keywords', fmt, color: '#38a169', monthlyOnly: true, source: 'GSC' },
  { key: 'sessions', label: 'Organic Sessions', fmt, color: '#319795', source: 'GA4' },
  { key: 'conversions', label: 'Conversions (Leads)', fmt, color: '#805ad5', source: 'GA4' },
  { key: 'engagedSessions', label: 'Engaged Sessions', fmt, color: '#38a169', source: 'GA4' },
  { key: 'newUsers', label: 'New Users', fmt, color: '#d69e2e', source: 'GA4' },
]

// Line metrics — calculated rates / averages (right axis)
const LINE_METRICS = [
  { key: 'ctr', label: 'CTR', fmt: fmtPct, color: '#e8a838', source: 'GSC' },
  { key: 'avgPosition', label: 'Avg Position', fmt: v => v == null ? '—' : v.toFixed(1), color: '#805ad5', lowerBetter: true, reversed: true, source: 'GSC' },
  { key: 'clicksPerKeyword', label: 'Clicks / Top-10 KW', fmt: v => v == null ? '—' : v.toFixed(1), color: '#d69e2e', monthlyOnly: true, source: 'GSC' },
  { key: 'impressionsPerKeyword', label: 'Impressions / Top-10 KW', fmt: v => v == null ? '—' : Math.round(v).toLocaleString(), color: '#319795', monthlyOnly: true, source: 'GSC' },
  { key: 'conversionRate', label: 'Conversion Rate (Leads)', fmt: fmtPct, color: '#e53e3e', source: 'GA4' },
  { key: 'engagementRate', label: 'Engagement Rate', fmt: fmtPct, color: '#3182ce', source: 'GA4' },
]
const ALL_METRICS = [...BAR_METRICS, ...LINE_METRICS]

// Dimensions for trending detail grid (the row in the table)
const TREND_METRICS = [
  { key: 'keywordCount', label: 'Keyword Count', fmt },
  { key: 'impressions', label: 'Impressions', fmt },
  { key: 'clicks', label: 'Clicks', fmt },
  { key: 'ctr', label: 'CTR', fmt: fmtPct },
]

export default function SEOExecutivePerformance() {
  const [daily, setDaily] = useState([])
  const [monthlyRanks, setMonthlyRanks] = useState([])
  const [top10Monthly, setTop10Monthly] = useState([])
  const [ga4Daily, setGa4Daily] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [barMetric, setBarMetric] = useState('clicks')
  const [lineMetric, setLineMetric] = useState('ctr')
  const [chartGran, setChartGran] = useState('Month') // Day | Week | Month
  const [expanded, setExpanded] = useState({}) // { ym: bool } for drill-down

  useEffect(() => {
    let cancelled = false
    fetch('/api/seo')
      .then(r => { if (!r.ok) throw new Error(`Server error: ${r.status}`); return r.json() })
      .then(d => {
        if (cancelled) return
        setDaily(d.daily || [])
        setMonthlyRanks(d.monthlyRanks || [])
        setTop10Monthly(d.top10Monthly || [])
        setGa4Daily(d.ga4Daily || [])
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Web-search only — non-web search_type rows (image, video, news, discover) are
  // excluded from the daily-level GSC aggregations so the top cards reflect web SEO only.
  const dailyWeb = useMemo(() => daily.filter(r => r.searchType === 'web'), [daily])

  // ── Daily-level monthly aggregation (impressions, clicks, avg position, ctr) — web only ──
  const dailyMonthly = useMemo(() => {
    const m = new Map()
    for (const r of dailyWeb) {
      const ym = ymOf(r.d)
      if (!ym) continue
      const ex = m.get(ym) || { ym, impressions: 0, clicks: 0, posWeighted: 0 }
      ex.impressions += r.impressions
      ex.clicks += r.clicks
      // avgPosition is daily; weight by impressions to get monthly avg
      ex.posWeighted += (r.avgPosition || 0) * (r.impressions || 0)
      m.set(ym, ex)
    }
    return [...m.values()].map(v => ({
      ym: v.ym,
      impressions: v.impressions,
      clicks: v.clicks,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      avgPosition: v.impressions > 0 ? v.posWeighted / v.impressions : null,
    })).sort((a, b) => a.ym.localeCompare(b.ym))
  }, [dailyWeb])

  const top10ByYm = useMemo(() => {
    const m = {}
    for (const r of top10Monthly) m[r.ym] = r.top10Count
    return m
  }, [top10Monthly])

  // ── GA4 monthly rollup (organic) — one row per day on this table (no device split) ──
  const ga4Monthly = useMemo(() => {
    const m = new Map()
    for (const r of ga4Daily) {
      const ym = ymOf(r.d)
      if (!ym) continue
      const ex = m.get(ym) || {
        ym, sessions: 0, newUsers: 0, pageviews: 0, conversions: 0, engagedSessions: 0,
      }
      ex.sessions += r.sessions
      ex.newUsers += r.newUsers
      ex.pageviews += r.pageviews
      ex.conversions += r.conversions
      ex.engagedSessions += r.engagedSessions
      m.set(ym, ex)
    }
    return [...m.values()].map(v => ({
      ...v,
      conversionRate: v.sessions > 0 ? v.conversions / v.sessions : 0,
      engagementRate: v.sessions > 0 ? v.engagedSessions / v.sessions : 0,
    })).sort((a, b) => a.ym.localeCompare(b.ym))
  }, [ga4Daily])

  const ga4ByYm = useMemo(() => {
    const m = {}
    for (const r of ga4Monthly) m[r.ym] = r
    return m
  }, [ga4Monthly])

  // Day-of-month counts per ym so we can flag partial GA4 coverage
  const ga4DayCountByYm = useMemo(() => {
    const m = {}
    for (const r of ga4Daily) {
      const ym = ymOf(r.d)
      if (!ym) continue
      if (!m[ym]) m[ym] = new Set()
      m[ym].add(r.d)
    }
    const out = {}
    for (const ym of Object.keys(m)) out[ym] = m[ym].size
    return out
  }, [ga4Daily])

  const ga4Range = useMemo(() => {
    if (!ga4Daily.length) return null
    return { first: ga4Daily[0].d, last: ga4Daily[ga4Daily.length - 1].d, days: new Set(ga4Daily.map(r => r.d)).size }
  }, [ga4Daily])

  // Days in a given YYYY-MM (calendar days)
  const daysInMonth = ym => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(y, m, 0).getDate()
  }

  // ── Focus month: always the previous full calendar month.
  //    Falls back to the latest GSC month only if "previous month" has no GSC data at all. ──
  const focusYm = useMemo(() => {
    const previous = lastFullMonth()
    if (dailyMonthly.some(r => r.ym === previous)) return previous
    return dailyMonthly.length > 0 ? dailyMonthly[dailyMonthly.length - 1].ym : previous
  }, [dailyMonthly])

  // ── KPI data for focus month, prev month, YoY month ──
  const monthMetrics = useMemo(() => {
    const findD = ym => dailyMonthly.find(r => r.ym === ym)
    const buildKpis = ym => {
      const d = findD(ym)
      const g = ga4ByYm[ym]
      const impressions = d ? d.impressions : 0
      const clicks = d ? d.clicks : 0
      const conversions = g ? g.conversions : 0
      const sessions = g ? g.sessions : 0
      return {
        impressions,
        clicks,
        top10: top10ByYm[ym] || 0,
        conversions,
        engagedSessions: g ? g.engagedSessions : 0,
        sessions,
        ctr: impressions > 0 ? clicks / impressions : null,
        conversionRate: sessions > 0 ? conversions / sessions : null,
        avgPosition: d ? d.avgPosition : null,
      }
    }
    return {
      current: buildKpis(focusYm),
      prev: buildKpis(prevMonth(focusYm)),
      yoy: buildKpis(yoyMonth(focusYm)),
    }
  }, [dailyMonthly, top10ByYm, ga4ByYm, focusYm])

  // ── Dynamic chart data (last 15 months, granularity selectable) ──
  const chartData = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15)
    const lookup = new Map(dailyMonthly.map(r => [r.ym, r]))

    if (chartGran === 'Month') {
      return last15.map(ym => {
        const r = lookup.get(ym) || { impressions: 0, clicks: 0, ctr: 0, avgPosition: null }
        const top10 = top10ByYm[ym] || 0
        const g = ga4ByYm[ym]
        return {
          period: ym,
          label: monthLabel(ym),
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: r.ctr,
          avgPosition: r.avgPosition,
          top10,
          clicksPerKeyword: top10 > 0 ? r.clicks / top10 : null,
          impressionsPerKeyword: top10 > 0 ? r.impressions / top10 : null,
          // GA4
          sessions: g ? g.sessions : 0,
          conversions: g ? g.conversions : 0,
          engagedSessions: g ? g.engagedSessions : 0,
          newUsers: g ? g.newUsers : 0,
          conversionRate: g ? g.conversionRate : 0,
          engagementRate: g ? g.engagementRate : 0,
        }
      })
    }

    // Day / Week — fall back to the daily series for the same 15-month window
    const startYm = last15[0]
    const startStr = `${startYm}-01`
    const filtered = dailyWeb.filter(d => d.d >= startStr) // web-only, matches the KPI cards
    const ga4Filtered = ga4Daily.filter(d => d.d >= startStr)

    const newGa4Bucket = () => ({ sessions: 0, conversions: 0, engagedSessions: 0, newUsers: 0 })
    const finalizeBucket = v => ({
      period: v.period,
      label: v.label,
      impressions: v.impressions,
      clicks: v.clicks,
      ctr: v.impressions > 0 ? v.clicks / v.impressions : 0,
      avgPosition: v.impressions > 0 ? v.posWeighted / v.impressions : null,
      top10: null,
      clicksPerKeyword: null,
      impressionsPerKeyword: null,
      sessions: v.sessions,
      conversions: v.conversions,
      engagedSessions: v.engagedSessions,
      newUsers: v.newUsers,
      conversionRate: v.sessions > 0 ? v.conversions / v.sessions : 0,
      engagementRate: v.sessions > 0 ? v.engagedSessions / v.sessions : 0,
    })

    if (chartGran === 'Day') {
      // collapse search_type splits per day + merge GA4 daily by date (summing across devices)
      const m = new Map()
      for (const r of filtered) {
        const ex = m.get(r.d) || { period: r.d, label: r.d.slice(5), impressions: 0, clicks: 0, posWeighted: 0, ...newGa4Bucket() }
        ex.impressions += r.impressions
        ex.clicks += r.clicks
        ex.posWeighted += (r.avgPosition || 0) * (r.impressions || 0)
        m.set(r.d, ex)
      }
      for (const g of ga4Filtered) {
        const ex = m.get(g.d) || { period: g.d, label: g.d.slice(5), impressions: 0, clicks: 0, posWeighted: 0, ...newGa4Bucket() }
        ex.sessions += g.sessions
        ex.conversions += g.conversions
        ex.engagedSessions += g.engagedSessions
        ex.newUsers += g.newUsers
        m.set(g.d, ex)
      }
      return [...m.values()].map(finalizeBucket).sort((a, b) => a.period.localeCompare(b.period))
    }

    // Week — Saturday-ending buckets
    const getSat = ds => {
      const dt = new Date(ds + 'T12:00:00')
      const day = dt.getDay()
      dt.setDate(dt.getDate() - (day >= 6 ? 0 : day + 1))
      return dt.toISOString().slice(0, 10)
    }
    const m = new Map()
    for (const r of filtered) {
      const wk = getSat(r.d)
      const ex = m.get(wk) || { period: wk, label: wk.slice(5), impressions: 0, clicks: 0, posWeighted: 0, ...newGa4Bucket() }
      ex.impressions += r.impressions
      ex.clicks += r.clicks
      ex.posWeighted += (r.avgPosition || 0) * (r.impressions || 0)
      m.set(wk, ex)
    }
    for (const g of ga4Filtered) {
      const wk = getSat(g.d)
      const ex = m.get(wk) || { period: wk, label: wk.slice(5), impressions: 0, clicks: 0, posWeighted: 0, ...newGa4Bucket() }
      ex.sessions += g.sessions
      ex.conversions += g.conversions
      ex.engagedSessions += g.engagedSessions
      ex.newUsers += g.newUsers
      m.set(wk, ex)
    }
    return [...m.values()].map(finalizeBucket).sort((a, b) => a.period.localeCompare(b.period))
  }, [dailyMonthly, dailyWeb, ga4Daily, ga4ByYm, top10ByYm, focusYm, chartGran])

  // ── 15-month trending table data (year-month + drill-down to rank) ──
  const trendingTable = useMemo(() => {
    // Newest month first — descending order for the table.
    const last15 = lastNMonths(focusYm, 15).slice().reverse()

    // ym → totals across all ranks
    const totalsByYm = new Map()
    // ym + rank → row
    const rowByYmRank = new Map()
    for (const r of monthlyRanks) {
      rowByYmRank.set(`${r.ym}|${r.rank}`, r)
      const t = totalsByYm.get(r.ym) || { ym: r.ym, keywordCount: 0, impressions: 0, clicks: 0 }
      t.keywordCount += r.keywordCount
      t.impressions += r.impressions
      t.clicks += r.clicks
      totalsByYm.set(r.ym, t)
    }

    return last15.map(ym => {
      const t = totalsByYm.get(ym) || { ym, keywordCount: 0, impressions: 0, clicks: 0 }
      const ranks = RANK_ORDER.map(rk => {
        const r = rowByYmRank.get(`${ym}|${rk}`) || { ym, rank: rk, keywordCount: 0, impressions: 0, clicks: 0, ctr: 0 }
        return r
      })
      return {
        ym,
        label: monthLabel(ym),
        keywordCount: t.keywordCount,
        impressions: t.impressions,
        clicks: t.clicks,
        ctr: t.impressions > 0 ? t.clicks / t.impressions : 0,
        ranks,
      }
    })
  }, [monthlyRanks, focusYm])

  // ── 15-month GA4 trending table (organic) ──
  const ga4MonthlyForTable = useMemo(() => {
    const m = new Map()
    for (const r of ga4Daily) {
      const ym = ymOf(r.d)
      if (!ym) continue
      const ex = m.get(ym) || { ym, sessions: 0, newUsers: 0, conversions: 0, engagedSessions: 0 }
      ex.sessions += r.sessions
      ex.newUsers += r.newUsers
      ex.conversions += r.conversions
      ex.engagedSessions += r.engagedSessions
      m.set(ym, ex)
    }
    return m
  }, [ga4Daily])

  const ga4TrendingTable = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15).slice().reverse()
    return last15.map(ym => {
      const g = ga4MonthlyForTable.get(ym)
      const sessions = g ? g.sessions : 0
      const conversions = g ? g.conversions : 0
      const engagedSessions = g ? g.engagedSessions : 0
      const days = ga4DayCountByYm[ym] || 0
      return {
        ym,
        label: monthLabel(ym),
        sessions,
        newUsers: g ? g.newUsers : 0,
        conversions,
        cvr: sessions > 0 ? conversions / sessions : null,
        engagementRate: sessions > 0 ? engagedSessions / sessions : null,
        engagedSessions,
        days,
        expectedDays: daysInMonth(ym),
      }
    })
  }, [ga4MonthlyForTable, ga4DayCountByYm, focusYm])

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#1a3a5c' }}><div style={{ fontSize: '1.5rem' }}>Loading SEO data...</div></div>
  if (error) return <div style={{ textAlign: 'center', padding: '4rem', color: '#e53e3e' }}><div style={{ fontSize: '1.3rem' }}>Failed to load</div><div style={{ color: '#666' }}>{error}</div></div>

  const chgCell = (c, p, opts = {}) => {
    const v = pctChange(c, p)
    const lower = !!opts.lowerBetter
    const good = v == null ? null : (lower ? v <= 0 : v >= 0)
    const color = v == null ? '#a0aec0' : v === 0 ? '#718096' : good ? '#38a169' : '#e53e3e'
    return <span style={{ fontSize: 10, fontWeight: 600, color }}>{fmtChg(v)}</span>
  }

  // KPI card metric definitions
  const KPI_DEFS = [
    { key: 'top10', label: 'Top 10 Ranking Keywords', fmt, source: 'GSC' },
    { key: 'avgPosition', label: 'Avg Position', fmt: v => v == null ? '—' : v.toFixed(0), source: 'GSC', lowerBetter: true },
    { key: 'impressions', label: 'Impressions', fmt, source: 'GSC' },
    { key: 'clicks', label: 'Clicks', fmt, source: 'GSC' },
    { key: 'ctr', label: 'CTR', fmt: fmtPct, source: 'GSC' },
    { key: 'conversions', label: 'Conversions (Leads)', fmt, source: 'GA4' },
    { key: 'engagedSessions', label: 'Engaged Sessions', fmt, source: 'GA4' },
    { key: 'conversionRate', label: 'Conversion Rate', fmt: fmtPct, source: 'GA4' },
  ]

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a5c' }}>📊 Executive Performance · {monthLabel(focusYm)}</div>
          <div style={{ fontSize: 10, color: '#718096' }}>
            Sources: GSC <code>sc-domain:origamirisk.com</code> + GA4 <code>account 328179682</code> (Organic Search · <code>session_default_channel_group = 'Organic Search'</code>) · MoM vs {monthLabel(prevMonth(focusYm))} · YoY vs {monthLabel(yoyMonth(focusYm))}
          </div>
        </div>
      </div>

      {/* GA4 backfill banner — shown only when GA4 data window is incomplete */}
      {(() => {
        if (!ga4Range) {
          return (
            <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef5e7', border: '1px solid #f6e05e', borderRadius: 6, fontSize: 11, color: '#744210' }}>
              <strong>⚠️ GA4 data unavailable</strong> — Conversions and Engaged Sessions cards will populate once the GA4 source backfills. All other KPIs are live.
            </div>
          )
        }
        // Check if focus month has full coverage of GA4
        const focusDays = ga4DayCountByYm[focusYm] || 0
        const focusExpected = daysInMonth(focusYm)
        const partialFocus = focusDays > 0 && focusDays < focusExpected
        // Heuristic: show banner if GA4 data window < 60 days OR focus month is partial
        const showBanner = ga4Range.days < 60 || partialFocus
        if (!showBanner) return null
        return (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: '#fef5e7', border: '1px solid #f6e05e', borderRadius: 6, fontSize: 11, color: '#744210', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <div>
              <strong>⏳ GA4 backfill in progress</strong> — only {ga4Range.days} day{ga4Range.days === 1 ? '' : 's'} of GA4 data available so far ({ga4Range.first} → {ga4Range.last}).
              {partialFocus && <> Focus month <strong>{monthLabel(focusYm)}</strong> has {focusDays} of {focusExpected} days; MoM/YoY for GA4 KPIs will be unreliable until more history loads.</>}
            </div>
            <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 3, background: '#fed7aa', color: '#7b341e', fontWeight: 700 }}>GSC: full history</span>
          </div>
        )
      })()}

      {/* KPI Cards — MoM + YoY */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${KPI_DEFS.length}, 1fr)`, gap: 8, marginBottom: 16 }}>
        {KPI_DEFS.map(k => {
          const cur = monthMetrics.current[k.key]
          const prev = monthMetrics.prev[k.key]
          const yoy = monthMetrics.yoy[k.key]
          const isGa4 = k.source === 'GA4'
          // Partial-data detection for GA4 cards: focus / prev / yoy might have incomplete days
          const focusDays = isGa4 ? (ga4DayCountByYm[focusYm] || 0) : null
          const prevDays = isGa4 ? (ga4DayCountByYm[prevMonth(focusYm)] || 0) : null
          const yoyDays = isGa4 ? (ga4DayCountByYm[yoyMonth(focusYm)] || 0) : null
          const focusExpected = isGa4 ? daysInMonth(focusYm) : null
          const prevExpected = isGa4 ? daysInMonth(prevMonth(focusYm)) : null
          const focusPartial = isGa4 && focusDays > 0 && focusDays < focusExpected
          // Suppress MoM/YoY when comparison side has zero GA4 days — the % change would be meaningless
          const showMom = !isGa4 || (focusDays > 0 && prevDays > 0)
          const showYoy = !isGa4 || (focusDays > 0 && yoyDays > 0)
          const mom = showMom ? pctChange(cur, prev) : null
          const goodMom = mom == null ? null : (k.lowerBetter ? mom <= 0 : mom >= 0)
          const cardClass = isGa4 && focusDays === 0 ? '' : (mom == null ? '' : goodMom ? 'sp-kpi-good' : 'sp-kpi-bad')
          return (
            <div key={k.key} className={`sp-kpi-card ${cardClass}`} style={isGa4 && focusDays === 0 ? { opacity: 0.6 } : {}}>
              <div className="sp-kpi-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{k.label}</span>
                <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 2, background: k.source === 'GA4' ? '#fef5e7' : '#e6f4ea', color: k.source === 'GA4' ? '#b7791f' : '#2f855a', fontWeight: 700 }}>{k.source}</span>
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: focusPartial ? '#b7791f' : '#1a3a5c', marginTop: 4 }}>
                {isGa4 && focusDays === 0 ? <span style={{ color: '#a0aec0', fontSize: 13, fontWeight: 500 }}>no data</span> : k.fmt(cur)}
              </div>
              {isGa4 && focusDays > 0 && (
                <div style={{ marginTop: 2, fontSize: 8, color: focusPartial ? '#b7791f' : '#38a169', fontWeight: 600 }}>
                  {focusPartial ? `partial · ${focusDays}/${focusExpected} days` : `complete · ${focusDays}/${focusExpected} days`}
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: '#718096' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>MoM</div>
                  <div>{showMom ? chgCell(cur, prev, { lowerBetter: k.lowerBetter }) : <span style={{ color: '#a0aec0' }}>—</span>}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>YoY</div>
                  <div>{showYoy ? chgCell(cur, yoy, { lowerBetter: k.lowerBetter }) : <span style={{ color: '#a0aec0' }}>—</span>}</div>
                </div>
              </div>
              <div style={{ marginTop: 4, fontSize: 8, color: '#a0aec0' }}>
                Prev: {showMom ? k.fmt(prev) : '—'} · LY: {showYoy ? k.fmt(yoy) : '—'}
              </div>
            </div>
          )
        })}
      </div>

      {/* Dynamic bar+line chart — bar = raw volume, line = calculated rate */}
      {(() => {
        const barDef = BAR_METRICS.find(m => m.key === barMetric)
        const lineDef = LINE_METRICS.find(m => m.key === lineMetric)
        const granIsMonth = chartGran === 'Month'
        const barAvailable = barDef && (granIsMonth || !barDef.monthlyOnly)
        const lineAvailable = lineDef && (granIsMonth || !lineDef.monthlyOnly)
        const fmtForKey = key => ALL_METRICS.find(m => m.key === key)?.fmt || (v => v)
        const labelForKey = key => ALL_METRICS.find(m => m.key === key)?.label || key

        return (
          <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>📈 Trend · {barAvailable ? barDef.label : '—'} <span style={{ color: '#718096', fontWeight: 400 }}>vs</span> {lineAvailable ? lineDef.label : '—'}</div>
                <div style={{ fontSize: 9, color: '#718096' }}>Last 15 months · {chartGran} view · bar = volume (left axis), line = rate (right axis)</div>
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 10, background: barDef?.color || '#2c5282', marginRight: 4, verticalAlign: 'middle', borderRadius: 1 }}></span>
                    Bar (raw)
                  </label>
                  <select value={barMetric} onChange={e => setBarMetric(e.target.value)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', minWidth: 200 }}>
                    {BAR_METRICS.map(m => <option key={m.key} value={m.key} disabled={!granIsMonth && m.monthlyOnly}>[{m.source}] {m.label}{!granIsMonth && m.monthlyOnly ? ' (monthly only)' : ''}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    <span style={{ display: 'inline-block', width: 10, height: 2, background: lineDef?.color || '#e8a838', marginRight: 4, verticalAlign: 'middle' }}></span>
                    Line (calculated)
                  </label>
                  <select value={lineMetric} onChange={e => setLineMetric(e.target.value)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border)', minWidth: 220 }}>
                    {LINE_METRICS.map(m => <option key={m.key} value={m.key} disabled={!granIsMonth && m.monthlyOnly}>[{m.source}] {m.label}{!granIsMonth && m.monthlyOnly ? ' (monthly only)' : ''}</option>)}
                  </select>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>Granularity</label>
                  <div style={{ display: 'flex', gap: 3 }}>
                    {['Day', 'Week', 'Month'].map(g => (
                      <button key={g} onClick={() => setChartGran(g)} style={{ fontSize: 10, padding: '4px 12px', borderRadius: 4, border: '1px solid var(--border)', background: chartGran === g ? 'var(--primary, #2c5282)' : 'var(--bg, #fff)', color: chartGran === g ? '#fff' : 'var(--text, #1a3a5c)', cursor: 'pointer', fontWeight: 600 }}>{g}</button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {!barAvailable && !lineAvailable ? (
              <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#a0aec0', fontSize: 12 }}>
                Selected metrics aren't available at {chartGran} granularity. Switch to Month view or pick different metrics.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={320}>
                <ComposedChart data={chartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                  <XAxis dataKey="label" tick={{ fontSize: 9 }} interval={chartGran === 'Day' ? 14 : chartGran === 'Week' ? 2 : 0} angle={-30} textAnchor="end" height={48} />
                  <YAxis
                    yAxisId="left"
                    tick={{ fontSize: 9 }}
                    width={60}
                    tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : Math.round(v)}
                  />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 9 }}
                    width={60}
                    reversed={!!lineDef?.reversed}
                    tickFormatter={v => {
                      if (lineDef?.key === 'ctr') return (v * 100).toFixed(1) + '%'
                      if (lineDef?.key === 'avgPosition') return v.toFixed(1)
                      return typeof v === 'number' ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v.toFixed(1)) : v
                    }}
                  />
                  <Tooltip
                    formatter={(v, name) => {
                      const meta = ALL_METRICS.find(m => m.label === name)
                      return [meta ? meta.fmt(v) : v, name]
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {barAvailable && (
                    <Bar yAxisId="left" dataKey={barMetric} name={barDef.label} fill={barDef.color} opacity={0.85} />
                  )}
                  {lineAvailable && (
                    <Line yAxisId="right" type="monotone" dataKey={lineMetric} name={lineDef.label} stroke={lineDef.color} strokeWidth={2.5} dot={{ r: 3, fill: lineDef.color }} connectNulls />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            )}
          </div>
        )
      })()}

      {/* 15-month keyword trending table by position — every metric + MoM + YoY in one grid */}
      {(() => {
        const groupBorderL = { borderLeft: '2px solid #e2e8f0' }
        const metricCellW = '76px'
        const chgCellW = '60px'
        const exportGscTrending = () => {
          const rows = []
          for (const row of trendingTable) {
            const prevRow = trendingTable.find(x => x.ym === prevMonth(row.ym))
            const yoyRow = trendingTable.find(x => x.ym === yoyMonth(row.ym))
            const buildRow = (level, source, prevSrc, yoySrc) => ({
              ym: row.label,
              level,
              keywordCount: source.keywordCount, kwMom: pctChange(source.keywordCount, prevSrc?.keywordCount), kwYoy: pctChange(source.keywordCount, yoySrc?.keywordCount),
              impressions: source.impressions, impMom: pctChange(source.impressions, prevSrc?.impressions), impYoy: pctChange(source.impressions, yoySrc?.impressions),
              clicks: source.clicks, clkMom: pctChange(source.clicks, prevSrc?.clicks), clkYoy: pctChange(source.clicks, yoySrc?.clicks),
              ctr: source.ctr, ctrMom: pctChange(source.ctr, prevSrc?.ctr), ctrYoy: pctChange(source.ctr, yoySrc?.ctr),
            })
            rows.push(buildRow('Total', row, prevRow, yoyRow))
            for (const rk of row.ranks) {
              const prevRk = prevRow?.ranks.find(x => x.rank === rk.rank)
              const yoyRk = yoyRow?.ranks.find(x => x.rank === rk.rank)
              rows.push(buildRow(rk.rank, rk, prevRk, yoyRk))
            }
          }
          downloadCsv('origami-seo-gsc-keyword-trending.csv', [
            { header: 'Year-Month', accessor: r => r.ym },
            { header: 'Level', accessor: r => r.level },
            { header: 'Keyword Count', accessor: r => r.keywordCount },
            { header: 'KW Count MoM', accessor: r => csvFmtChg(r.kwMom) },
            { header: 'KW Count YoY', accessor: r => csvFmtChg(r.kwYoy) },
            { header: 'Impressions', accessor: r => r.impressions },
            { header: 'Impressions MoM', accessor: r => csvFmtChg(r.impMom) },
            { header: 'Impressions YoY', accessor: r => csvFmtChg(r.impYoy) },
            { header: 'Clicks', accessor: r => r.clicks },
            { header: 'Clicks MoM', accessor: r => csvFmtChg(r.clkMom) },
            { header: 'Clicks YoY', accessor: r => csvFmtChg(r.clkYoy) },
            { header: 'CTR', accessor: r => csvFmtPct(r.ctr) },
            { header: 'CTR MoM', accessor: r => csvFmtChg(r.ctrMom) },
            { header: 'CTR YoY', accessor: r => csvFmtChg(r.ctrYoy) },
          ], rows)
        }
        return (
          <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>📋 15-Month Keyword Trending by Position</div>
                <div style={{ fontSize: 9, color: '#718096' }}>Click a year-month to drill into rank buckets · MoM &amp; YoY shown for every metric</div>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <div style={{ fontSize: 9, color: '#718096' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#38a169', marginRight: 4 }}></span>up
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e53e3e', margin: '0 4px 0 8px' }}></span>down
                </div>
                <ExportButton onClick={exportGscTrending} />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: '#f7fafc' }}>
                    <th rowSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #e2e8f0', position: 'sticky', left: 0, background: '#f7fafc', zIndex: 1 }}>Year-Month</th>
                    {TREND_METRICS.map((m, idx) => (
                      <th key={m.key} colSpan={3} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, color: '#1a3a5c', borderBottom: '1px solid #e2e8f0', ...(idx > 0 ? groupBorderL : {}) }}>{m.label}</th>
                    ))}
                  </tr>
                  <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {TREND_METRICS.map((m, idx) => (
                      <React.Fragment key={m.key}>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: metricCellW, ...(idx > 0 ? groupBorderL : {}) }}>Value</th>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: chgCellW }}>MoM</th>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: chgCellW }}>YoY</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trendingTable.map((row) => {
                    const ymPrev = prevMonth(row.ym)
                    const ymYoy = yoyMonth(row.ym)
                    const prevRow = trendingTable.find(x => x.ym === ymPrev)
                    const yoyRow = trendingTable.find(x => x.ym === ymYoy)
                    const isOpen = !!expanded[row.ym]
                    return (
                      <React.Fragment key={row.ym}>
                        <tr style={{ borderBottom: '1px solid #edf2f7', cursor: 'pointer' }} onClick={() => setExpanded(p => ({ ...p, [row.ym]: !p[row.ym] }))}>
                          <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600, position: 'sticky', left: 0, background: '#fff', zIndex: 1 }}>
                            <span style={{ display: 'inline-block', width: 12, color: '#718096' }}>{isOpen ? '▾' : '▸'}</span>
                            {row.label}
                          </td>
                          {TREND_METRICS.map((m, idx) => (
                            <React.Fragment key={m.key}>
                              <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 600, color: '#1a3a5c', ...(idx > 0 ? groupBorderL : {}) }}>{m.fmt(row[m.key])}</td>
                              <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                                {prevRow ? chgCell(row[m.key], prevRow[m.key]) : <span style={{ fontSize: 10, color: '#a0aec0' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                                {yoyRow ? chgCell(row[m.key], yoyRow[m.key]) : <span style={{ fontSize: 10, color: '#a0aec0' }}>—</span>}
                              </td>
                            </React.Fragment>
                          ))}
                        </tr>
                        {isOpen && row.ranks.map(rk => {
                          const prevRk = prevRow?.ranks.find(x => x.rank === rk.rank)
                          const yoyRk = yoyRow?.ranks.find(x => x.rank === rk.rank)
                          return (
                            <tr key={row.ym + '|' + rk.rank} style={{ borderBottom: '1px solid #f7fafc', background: '#fafbfc' }}>
                              <td style={{ textAlign: 'left', padding: '4px 8px 4px 28px', fontSize: 10, color: '#4a5568', position: 'sticky', left: 0, background: '#fafbfc', zIndex: 1 }}>
                                <span style={{ display: 'inline-block', width: 10, height: 10, background: RANK_COLOR[rk.rank], borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>
                                {rk.rank}
                              </td>
                              {TREND_METRICS.map((m, idx) => (
                                <React.Fragment key={m.key}>
                                  <td style={{ textAlign: 'center', padding: '4px 6px', fontSize: 10, color: '#4a5568', ...(idx > 0 ? groupBorderL : {}) }}>{m.fmt(rk[m.key])}</td>
                                  <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                                    {prevRk ? chgCell(rk[m.key], prevRk[m.key]) : <span style={{ fontSize: 9, color: '#a0aec0' }}>—</span>}
                                  </td>
                                  <td style={{ textAlign: 'center', padding: '4px 6px' }}>
                                    {yoyRk ? chgCell(rk[m.key], yoyRk[m.key]) : <span style={{ fontSize: 9, color: '#a0aec0' }}>—</span>}
                                  </td>
                                </React.Fragment>
                              ))}
                            </tr>
                          )
                        })}
                      </React.Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      {/* 15-month GA4 trending table — organic search outcomes */}
      {(() => {
        const groupBorderL = { borderLeft: '2px solid #e2e8f0' }
        const metricCellW = '76px'
        const chgCellW = '60px'
        const GA4_METRICS = [
          { key: 'sessions', label: 'Sessions', fmt },
          { key: 'newUsers', label: 'New Users', fmt },
          { key: 'conversions', label: 'Conversions', fmt },
          { key: 'cvr', label: 'CVR', fmt: fmtPct },
          { key: 'engagementRate', label: 'Engagement Rate', fmt: fmtPct },
          { key: 'engagedSessions', label: 'Engaged Sessions', fmt },
        ]
        const exportGa4Trending = () => {
          const rows = []
          for (const row of ga4TrendingTable) {
            const prevRow = ga4TrendingTable.find(x => x.ym === prevMonth(row.ym))
            const yoyRow = ga4TrendingTable.find(x => x.ym === yoyMonth(row.ym))
            const out = { ym: row.label, days: `${row.days}/${row.expectedDays}` }
            for (const m of GA4_METRICS) {
              const c = row[m.key]
              const p = prevRow ? prevRow[m.key] : null
              const y = yoyRow ? yoyRow[m.key] : null
              out[m.key] = c
              out[m.key + '_mom'] = pctChange(c, p)
              out[m.key + '_yoy'] = pctChange(c, y)
            }
            rows.push(out)
          }
          const cols = [
            { header: 'Year-Month', accessor: r => r.ym },
            { header: 'GA4 Days (actual/expected)', accessor: r => r.days },
          ]
          for (const m of GA4_METRICS) {
            cols.push({ header: m.label, accessor: r => r[m.key] })
            cols.push({ header: `${m.label} MoM`, accessor: r => csvFmtChg(r[m.key + '_mom']) })
            cols.push({ header: `${m.label} YoY`, accessor: r => csvFmtChg(r[m.key + '_yoy']) })
          }
          downloadCsv('origami-seo-ga4-trending-organic.csv', cols, rows)
        }
        return (
          <div style={{ marginTop: 16, background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 700 }}>📊 15-Month GA4 Trending (Organic Search)</div>
                <div style={{ fontSize: 9, color: '#718096' }}>MoM &amp; YoY shown for every metric · partial months marked with day count</div>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ fontSize: 9, color: '#718096' }}>
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#38a169', marginRight: 4 }}></span>up
                  <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: '#e53e3e', margin: '0 4px 0 8px' }}></span>down
                  <span style={{ marginLeft: 8, color: '#b7791f' }}>amber = partial-month</span>
                </div>
                <ExportButton onClick={exportGa4Trending} />
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1100 }}>
                <thead>
                  <tr style={{ background: '#f7fafc' }}>
                    <th rowSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #e2e8f0', position: 'sticky', left: 0, background: '#f7fafc', zIndex: 1 }}>Year-Month</th>
                    {GA4_METRICS.map((m, idx) => (
                      <th key={m.key} colSpan={3} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, color: '#1a3a5c', borderBottom: '1px solid #e2e8f0', ...(idx > 0 ? groupBorderL : {}) }}>{m.label}</th>
                    ))}
                  </tr>
                  <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {GA4_METRICS.map((m, idx) => (
                      <React.Fragment key={m.key}>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: metricCellW, ...(idx > 0 ? groupBorderL : {}) }}>Value</th>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: chgCellW }}>MoM</th>
                        <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', minWidth: chgCellW }}>YoY</th>
                      </React.Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ga4TrendingTable.map(row => {
                    const ymPrev = prevMonth(row.ym)
                    const ymYoy = yoyMonth(row.ym)
                    const prevRow = ga4TrendingTable.find(x => x.ym === ymPrev)
                    const yoyRow = ga4TrendingTable.find(x => x.ym === ymYoy)
                    const partial = row.days > 0 && row.days < row.expectedDays
                    const noData = row.days === 0
                    return (
                      <tr key={row.ym} style={{ borderBottom: '1px solid #edf2f7', opacity: noData ? 0.45 : 1 }}>
                        <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600, position: 'sticky', left: 0, background: '#fff', zIndex: 1, color: partial ? '#b7791f' : '#1a3a5c' }}>
                          {row.label}
                          {partial && <span style={{ fontSize: 8, marginLeft: 6, color: '#b7791f', fontWeight: 600 }}>· {row.days}/{row.expectedDays}d</span>}
                          {noData && <span style={{ fontSize: 8, marginLeft: 6, color: '#a0aec0', fontWeight: 600 }}>· no data</span>}
                        </td>
                        {GA4_METRICS.map((m, idx) => {
                          const val = row[m.key]
                          // Suppress MoM/YoY when either side has no GA4 data — prevents bogus +∞ %
                          const prevHasData = prevRow && prevRow.days > 0
                          const yoyHasData = yoyRow && yoyRow.days > 0
                          const showMom = !noData && prevHasData
                          const showYoy = !noData && yoyHasData
                          return (
                            <React.Fragment key={m.key}>
                              <td style={{ textAlign: 'center', padding: '5px 6px', fontWeight: 600, color: partial ? '#b7791f' : '#1a3a5c', ...(idx > 0 ? groupBorderL : {}) }}>{m.fmt(val)}</td>
                              <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                                {showMom ? chgCell(val, prevRow[m.key], { lowerBetter: m.lowerBetter }) : <span style={{ fontSize: 10, color: '#a0aec0' }}>—</span>}
                              </td>
                              <td style={{ textAlign: 'center', padding: '5px 6px' }}>
                                {showYoy ? chgCell(val, yoyRow[m.key], { lowerBetter: m.lowerBetter }) : <span style={{ fontSize: 10, color: '#a0aec0' }}>—</span>}
                              </td>
                            </React.Fragment>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      })()}

      <div style={{ marginTop: 12, fontSize: 9, color: '#a0aec0', textAlign: 'right' }}>
        GA4 metrics filtered to <code>session_default_channel_group = 'Organic Search'</code>. Position-bucket rules: 1-3 = positions ≤ 3, 4-10 = 4–10, Page 2 = 11–20, Page 3+ = 21+.
      </div>
    </div>
  )
}
