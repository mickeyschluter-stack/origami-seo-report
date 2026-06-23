import React, { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ScatterChart, Scatter, ZAxis, Cell, LabelList, ReferenceArea,
} from 'recharts'
import { downloadCsv, csvFmtPct, csvFmtChg } from './csvExport'

function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}
      title="Export this table as CSV"
    >📥 CSV</button>
  )
}

// ── Formatting ──
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString()
const fmtPct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%'
const fmtPos = v => v == null ? '—' : v.toFixed(1)
const fmtChg = v => v == null || !isFinite(v) ? '—' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
const pctChange = (c, p) => p == null || p === 0 ? null : (c - p) / p

// ── Date helpers ──
const monthLabel = ym => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-US', { month: 'short', year: '2-digit' })
}
const lastFullMonth = () => {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth() - 1, 1).toISOString().slice(0, 7)
}
const prevMonth = ym => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 2, 1).toISOString().slice(0, 7)
}
const yoyMonth = ym => {
  const [y, m] = ym.split('-').map(Number)
  return `${y - 1}-${String(m).padStart(2, '0')}`
}
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
// Inclusive list of YYYY-MM strings between two months
function monthsBetween(startYm, endYm) {
  if (!startYm || !endYm || startYm > endYm) return []
  const out = []
  let [y, m] = startYm.split('-').map(Number)
  const [eY, eM] = endYm.split('-').map(Number)
  while (y < eY || (y === eY && m <= eM)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`)
    m += 1
    if (m === 13) { m = 1; y += 1 }
  }
  return out
}
// Shift a [start, end] range back by `monthsBack` months
function shiftRange(startYm, endYm, monthsBack) {
  const shift = ym => {
    let [y, m] = ym.split('-').map(Number)
    m -= monthsBack
    while (m <= 0) { m += 12; y -= 1 }
    return `${y}-${String(m).padStart(2, '0')}`
  }
  return [shift(startYm), shift(endYm)]
}
// Number of months in inclusive range
function rangeLength(startYm, endYm) {
  const [sY, sM] = startYm.split('-').map(Number)
  const [eY, eM] = endYm.split('-').map(Number)
  return (eY - sY) * 12 + (eM - sM) + 1
}

// ── Constants ──
const RANK_ORDER = ['Position 1-3', 'Position 4-10', 'Page 2', 'Page 3+']
const RANK_COLOR = {
  'Position 1-3': '#38a169',
  'Position 4-10': '#3182ce',
  'Page 2': '#e8a838',
  'Page 3+': '#e53e3e',
}
// Search Intent buckets — standard SEO framework. Most specific bucket wins.
const INTENT_ORDER = ['Navigational', 'Transactional', 'Commercial', 'Informational', 'Generic']
const INTENT_COLOR = {
  'Navigational': '#805ad5',
  'Transactional': '#38a169',
  'Commercial': '#d69e2e',
  'Informational': '#3182ce',
  'Generic': '#718096',
}
const INTENT_DESC = {
  'Navigational': 'brand or competitor mentions',
  'Transactional': 'demo / pricing / trial / contact / quote',
  'Commercial': 'best / vs / software / platform / vendors / Gartner',
  'Informational': 'how / what / guide / compliance / regulation',
  'Generic': 'head terms (no specific intent signal)',
}
const ORIGAMI_BRAND_PATTERN = /\borigami\s*risk\b|\borigami\b/i
const COMPETITOR_BRANDS = /\b(riskonnect|rsa\s*archer|archer\s*(?:irm|grc)|logicgate|resolver|ventiv|sapiens|ideagen|cority|intelex|enablon|gensuite|processmap|velocityehs|velocity\s*ehs|aclaimant|clearsight|marsh\s*clearsight|mitratech|metricstream|auditboard|onspring|sai360|servicenow|diligent|a1\s*tracker|ecesis)\b/i
function searchIntentOf(kw) {
  if (!kw) return 'Generic'
  const k = kw.toLowerCase()
  if (ORIGAMI_BRAND_PATTERN.test(k) || COMPETITOR_BRANDS.test(k)) return 'Navigational'
  if (/\b(demo|free\s*trial|trial|pricing|price|cost|quote|buy|purchase|contact|sign\s*up|get\s*started|request|book\s*a)\b/i.test(k)) return 'Transactional'
  if (/\b(best|top|vs\.?|versus|review|reviews|comparison|compared|alternative|alternatives|software|platform|solution|solutions|system|systems|tool|tools|vendor|vendors|provider|providers|gartner|companies)\b/i.test(k)) return 'Commercial'
  if (/\b(how|what|why|when|where|who|which|can|does|do|is|are|guide|guides|checklist|template|templates|example|examples|definition|meaning|types?|process|compliance|regulation|regulations|requirements?|standards?|framework|frameworks)\b/i.test(k)) return 'Informational'
  return 'Generic'
}

const LINE_METRICS = [
  { key: 'clicks', label: 'Clicks', fmt },
  { key: 'impressions', label: 'Impressions', fmt },
  { key: 'ctr', label: 'CTR', fmt: fmtPct, isRate: true },
  { key: 'avgPosition', label: 'Avg Position', fmt: fmtPos, isRate: true, lowerBetter: true },
]

// Color helper for change cells
function ChgCell({ val, lowerBetter, sm }) {
  if (val == null || !isFinite(val)) return <span style={{ fontSize: sm ? 9 : 10, color: '#a0aec0' }}>—</span>
  const good = lowerBetter ? val <= 0 : val >= 0
  const color = val === 0 ? '#718096' : good ? '#38a169' : '#e53e3e'
  return <span style={{ fontSize: sm ? 9 : 10, fontWeight: 600, color }}>{fmtChg(val)}</span>
}

export default function SEOKeywordsPerformance() {
  const [monthlyTotals, setMonthlyTotals] = useState([])
  const [monthlyRanks, setMonthlyRanks] = useState([])
  const [monthlyRanksByBrand, setMonthlyRanksByBrand] = useState([])
  const [keywordsByMonth, setKeywordsByMonth] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // KPI controls
  const [bucket, setBucket] = useState('All') // 'All' | rank
  const [rangeStart, setRangeStart] = useState(lastFullMonth())
  const [rangeEnd, setRangeEnd] = useState(lastFullMonth())

  // Top chart controls
  const [lineMetric, setLineMetric] = useState('clicks')
  const [barView, setBarView] = useState('mom') // 'mom' | 'yoy'

  // Stacked column toggle
  const [stackedBrand, setStackedBrand] = useState('All')

  // Drill-down expansion state
  const [expandedBrand, setExpandedBrand] = useState({})
  const [expandedIntent, setExpandedIntent] = useState({})

  useEffect(() => {
    let cancelled = false
    fetch('/api/seo')
      .then(r => { if (!r.ok) throw new Error(`Server error: ${r.status}`); return r.json() })
      .then(d => {
        if (cancelled) return
        setMonthlyTotals(d.monthlyTotals || [])
        setMonthlyRanks(d.monthlyRanks || [])
        setMonthlyRanksByBrand(d.monthlyRanksByBrand || [])
        setKeywordsByMonth(d.keywordsByMonth || {})
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // Default focus: previous full month, or latest data month if previous isn't available.
  const focusYm = useMemo(() => {
    const previous = lastFullMonth()
    if (monthlyTotals.some(r => r.ym === previous)) return previous
    return monthlyTotals.length > 0 ? monthlyTotals[monthlyTotals.length - 1].ym : previous
  }, [monthlyTotals])

  // Reset KPI date range to last-full-month default once data lands (only on first load).
  useEffect(() => {
    if (monthlyTotals.length > 0 && !monthlyTotals.some(r => r.ym === rangeStart)) {
      setRangeStart(focusYm)
      setRangeEnd(focusYm)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusYm])

  // ── KPI Cards ──
  // Aggregate monthlyRanks across the selected date range and bucket(s)
  const kpiAgg = useMemo(() => {
    const months = monthsBetween(rangeStart, rangeEnd)
    const aggregate = (mList) => {
      let imp = 0, clk = 0, posW = 0, posI = 0
      for (const r of monthlyRanks) {
        if (!mList.includes(r.ym)) continue
        if (bucket !== 'All' && r.rank !== bucket) continue
        imp += r.impressions
        clk += r.clicks
        posW += r.posWeighted
        posI += r.posImps
      }
      return {
        impressions: imp,
        clicks: clk,
        ctr: imp > 0 ? clk / imp : null,
        avgPosition: posI > 0 ? posW / posI : null,
      }
    }
    const len = rangeLength(rangeStart, rangeEnd)
    const [pStart, pEnd] = shiftRange(rangeStart, rangeEnd, len) // immediately preceding period
    const [yStart, yEnd] = shiftRange(rangeStart, rangeEnd, 12)  // year-over-year
    return {
      current: aggregate(months),
      prev: aggregate(monthsBetween(pStart, pEnd)),
      yoy: aggregate(monthsBetween(yStart, yEnd)),
      pStart, pEnd, yStart, yEnd, months,
    }
  }, [monthlyRanks, bucket, rangeStart, rangeEnd])

  // ── Top dynamic chart data ──
  const totalsByYm = useMemo(() => {
    const m = {}
    for (const r of monthlyTotals) m[r.ym] = r
    return m
  }, [monthlyTotals])

  const topChartData = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15)
    return last15.map(ym => {
      const cur = totalsByYm[ym]
      const prev = totalsByYm[prevMonth(ym)]
      const yoy = totalsByYm[yoyMonth(ym)]
      const lineVal = cur ? cur[lineMetric] : null
      const clkCur = cur ? cur.clicks : null
      const clkPrev = prev ? prev.clicks : null
      const clkYoy = yoy ? yoy.clicks : null
      return {
        ym,
        label: monthLabel(ym),
        line: lineVal,
        momClicks: pctChange(clkCur, clkPrev),
        yoyClicks: pctChange(clkCur, clkYoy),
        clicks: clkCur,
      }
    })
  }, [totalsByYm, lineMetric, focusYm])

  // ── Scatter: top 10 NB keywords for the focus month ──
  const scatterRows = useMemo(() => {
    const ym = focusYm
    const all = keywordsByMonth[ym] || []
    const nb = all.filter(k => k.brand === 'Non-Brand').slice(0, 10)
    return { ym, rows: nb }
  }, [keywordsByMonth, focusYm])

  // ── Stacked column ──
  const stackedData = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15)
    const source = stackedBrand === 'All'
      ? monthlyRanks.map(r => ({ ym: r.ym, rank: r.rank, keywordCount: r.keywordCount }))
      : monthlyRanksByBrand.filter(r => r.brand === stackedBrand).map(r => ({ ym: r.ym, rank: r.rank, keywordCount: r.keywordCount }))
    const m = new Map()
    for (const r of source) {
      const ex = m.get(r.ym) || { ym: r.ym, label: monthLabel(r.ym) }
      ex[r.rank] = (ex[r.rank] || 0) + r.keywordCount
      m.set(r.ym, ex)
    }
    return last15.map(ym => {
      const row = m.get(ym) || { ym, label: monthLabel(ym) }
      for (const r of RANK_ORDER) row[r] = row[r] || 0
      row.total = RANK_ORDER.reduce((s, r) => s + row[r], 0)
      return row
    })
  }, [monthlyRanks, monthlyRanksByBrand, stackedBrand, focusYm])

  // ── 15-month position overview table ──
  const positionTable = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15).slice().reverse()
    const lookup = new Map()
    for (const r of monthlyRanks) lookup.set(`${r.ym}|${r.rank}`, r)
    return last15.map(ym => {
      const row = { ym, label: monthLabel(ym) }
      let total = 0
      for (const r of RANK_ORDER) {
        const k = lookup.get(`${ym}|${r}`)
        row[r] = k ? k.keywordCount : 0
        total += row[r]
      }
      row.total = total
      return row
    })
  }, [monthlyRanks, focusYm])

  // ── Brand-vs-NB keyword table (last full month with MoM/YoY) ──
  const brandKeywordTable = useMemo(() => {
    const ym = focusYm
    const ymPrev = prevMonth(ym)
    const ymYoy = yoyMonth(ym)
    const cur = keywordsByMonth[ym] || []
    const prevMap = new Map((keywordsByMonth[ymPrev] || []).map(k => [k.keyword, k]))
    const yoyMap = new Map((keywordsByMonth[ymYoy] || []).map(k => [k.keyword, k]))
    // Group by brand
    const groups = { Brand: [], 'Non-Brand': [] }
    for (const k of cur) {
      const p = prevMap.get(k.keyword)
      const y = yoyMap.get(k.keyword)
      groups[k.brand].push({
        keyword: k.keyword,
        impressions: k.impressions,
        clicks: k.clicks,
        ctr: k.ctr,
        avgPosition: k.avgPosition,
        prev: p ? { impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, avgPosition: p.avgPosition } : null,
        yoy: y ? { impressions: y.impressions, clicks: y.clicks, ctr: y.ctr, avgPosition: y.avgPosition } : null,
      })
    }
    // Group totals
    const totalize = (rows) => {
      const sumImp = rows.reduce((s, r) => s + r.impressions, 0)
      const sumClk = rows.reduce((s, r) => s + r.clicks, 0)
      const posWeighted = rows.reduce((s, r) => s + (r.avgPosition || 0) * r.impressions, 0)
      const totalAvgPos = sumImp > 0 ? posWeighted / sumImp : null
      return {
        impressions: sumImp,
        clicks: sumClk,
        ctr: sumImp > 0 ? sumClk / sumImp : null,
        avgPosition: totalAvgPos,
      }
    }
    const sumOf = (rows, picker) => {
      const sumImp = rows.reduce((s, r) => s + (picker(r)?.impressions || 0), 0)
      const sumClk = rows.reduce((s, r) => s + (picker(r)?.clicks || 0), 0)
      const posWeighted = rows.reduce((s, r) => {
        const p = picker(r); if (!p) return s; return s + (p.avgPosition || 0) * (p.impressions || 0)
      }, 0)
      return {
        impressions: sumImp,
        clicks: sumClk,
        ctr: sumImp > 0 ? sumClk / sumImp : null,
        avgPosition: sumImp > 0 ? posWeighted / sumImp : null,
      }
    }
    // True totals from the unaggregated brand-split rank rollup — uncapped.
    // monthlyRanksByBrand has keywordCount per (ym, rank, brand); summing across
    // ranks for a brand gives the real unique-keyword count for that month.
    const totalKeywordCountByBrand = { Brand: 0, 'Non-Brand': 0 }
    for (const r of monthlyRanksByBrand) {
      if (r.ym !== ym) continue
      totalKeywordCountByBrand[r.brand] = (totalKeywordCountByBrand[r.brand] || 0) + (r.keywordCount || 0)
    }
    return ['Brand', 'Non-Brand'].map(b => {
      const rows = groups[b].sort((a, b) => b.clicks - a.clicks)
      return {
        type: b,
        cur: totalize(rows),
        prev: sumOf(rows, r => r.prev),
        yoy: sumOf(rows, r => r.yoy),
        keywords: rows,
        trueTotal: totalKeywordCountByBrand[b] || 0,
      }
    })
  }, [keywordsByMonth, monthlyRanksByBrand, focusYm])

  // ── Search Intent drill-down table ──
  const intentTable = useMemo(() => {
    const ym = focusYm
    const ymPrev = prevMonth(ym)
    const ymYoy = yoyMonth(ym)
    const cur = keywordsByMonth[ym] || []
    const prevMap = new Map((keywordsByMonth[ymPrev] || []).map(k => [k.keyword, k]))
    const yoyMap = new Map((keywordsByMonth[ymYoy] || []).map(k => [k.keyword, k]))
    const groups = {}
    for (const intent of INTENT_ORDER) groups[intent] = []
    for (const k of cur) {
      const intent = k.intent || searchIntentOf(k.keyword)
      const p = prevMap.get(k.keyword)
      const y = yoyMap.get(k.keyword)
      ;(groups[intent] = groups[intent] || []).push({
        keyword: k.keyword,
        impressions: k.impressions,
        clicks: k.clicks,
        ctr: k.ctr,
        avgPosition: k.avgPosition,
        prev: p ? { impressions: p.impressions, clicks: p.clicks, ctr: p.ctr, avgPosition: p.avgPosition } : null,
        yoy: y ? { impressions: y.impressions, clicks: y.clicks, ctr: y.ctr, avgPosition: y.avgPosition } : null,
      })
    }
    const totalize = rows => {
      const sumImp = rows.reduce((s, r) => s + r.impressions, 0)
      const sumClk = rows.reduce((s, r) => s + r.clicks, 0)
      const posW = rows.reduce((s, r) => s + (r.avgPosition || 0) * r.impressions, 0)
      return {
        impressions: sumImp,
        clicks: sumClk,
        ctr: sumImp > 0 ? sumClk / sumImp : null,
        avgPosition: sumImp > 0 ? posW / sumImp : null,
      }
    }
    const sumOf = (rows, picker) => {
      const sumImp = rows.reduce((s, r) => s + (picker(r)?.impressions || 0), 0)
      const sumClk = rows.reduce((s, r) => s + (picker(r)?.clicks || 0), 0)
      const posW = rows.reduce((s, r) => {
        const p = picker(r); if (!p) return s; return s + (p.avgPosition || 0) * (p.impressions || 0)
      }, 0)
      return {
        impressions: sumImp,
        clicks: sumClk,
        ctr: sumImp > 0 ? sumClk / sumImp : null,
        avgPosition: sumImp > 0 ? posW / sumImp : null,
      }
    }
    return INTENT_ORDER.filter(intent => (groups[intent] || []).length > 0).map(intent => {
      const rows = (groups[intent] || []).sort((a, b) => b.clicks - a.clicks)
      return {
        intent,
        cur: totalize(rows),
        prev: sumOf(rows, r => r.prev),
        yoy: sumOf(rows, r => r.yoy),
        keywords: rows,
      }
    })
  }, [keywordsByMonth, focusYm])

  // Shared CSV exporter for the Brand-vs-NB and Search-Intent drill-down tables.
  // Emits one row per group total + one row per keyword detail.
  const exportKeywordTable = (groups, filename, groupHeader, groupKey) => {
    const rows = []
    for (const g of groups) {
      const buildPerf = (cur, prev, yoy) => ({
        impressions: cur.impressions, impMom: pctChange(cur.impressions, prev?.impressions), impYoy: pctChange(cur.impressions, yoy?.impressions),
        clicks: cur.clicks, clkMom: pctChange(cur.clicks, prev?.clicks), clkYoy: pctChange(cur.clicks, yoy?.clicks),
        ctr: cur.ctr, ctrMom: pctChange(cur.ctr, prev?.ctr), ctrYoy: pctChange(cur.ctr, yoy?.ctr),
        avgPosition: cur.avgPosition, posMom: pctChange(cur.avgPosition, prev?.avgPosition), posYoy: pctChange(cur.avgPosition, yoy?.avgPosition),
      })
      // Total row for the group
      rows.push({
        groupValue: groupKey(g),
        level: 'Total',
        keyword: '',
        ...buildPerf(g.cur, g.prev, g.yoy),
      })
      // One row per keyword
      for (const kw of g.keywords) {
        rows.push({
          groupValue: groupKey(g),
          level: 'Keyword',
          keyword: kw.keyword,
          ...buildPerf(kw, kw.prev || {}, kw.yoy || {}),
        })
      }
    }
    downloadCsv(filename, [
      { header: groupHeader, accessor: r => r.groupValue },
      { header: 'Level', accessor: r => r.level },
      { header: 'Keyword', accessor: r => r.keyword },
      { header: 'Impressions', accessor: r => r.impressions },
      { header: 'Impressions MoM', accessor: r => csvFmtChg(r.impMom) },
      { header: 'Impressions YoY', accessor: r => csvFmtChg(r.impYoy) },
      { header: 'Clicks', accessor: r => r.clicks },
      { header: 'Clicks MoM', accessor: r => csvFmtChg(r.clkMom) },
      { header: 'Clicks YoY', accessor: r => csvFmtChg(r.clkYoy) },
      { header: 'CTR', accessor: r => csvFmtPct(r.ctr) },
      { header: 'CTR MoM', accessor: r => csvFmtChg(r.ctrMom) },
      { header: 'CTR YoY', accessor: r => csvFmtChg(r.ctrYoy) },
      { header: 'Avg Position', accessor: r => r.avgPosition == null ? '' : r.avgPosition.toFixed(2) },
      { header: 'Avg Position MoM', accessor: r => csvFmtChg(r.posMom) },
      { header: 'Avg Position YoY', accessor: r => csvFmtChg(r.posYoy) },
    ], rows)
  }

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#1a3a5c' }}><div style={{ fontSize: '1.5rem' }}>Loading keywords data...</div></div>
  if (error) return <div style={{ textAlign: 'center', padding: '4rem', color: '#e53e3e' }}><div style={{ fontSize: '1.3rem' }}>Failed to load</div><div style={{ color: '#666' }}>{error}</div></div>

  const lineDef = LINE_METRICS.find(m => m.key === lineMetric)
  const monthOptions = monthlyTotals.map(t => t.ym)
  const rangeLabel = rangeStart === rangeEnd ? monthLabel(rangeStart) : `${monthLabel(rangeStart)} → ${monthLabel(rangeEnd)}`
  const prevLabel = kpiAgg.pStart === kpiAgg.pEnd ? monthLabel(kpiAgg.pStart) : `${monthLabel(kpiAgg.pStart)} → ${monthLabel(kpiAgg.pEnd)}`
  const yoyLabel = kpiAgg.yStart === kpiAgg.yEnd ? monthLabel(kpiAgg.yStart) : `${monthLabel(kpiAgg.yStart)} → ${monthLabel(kpiAgg.yEnd)}`

  // KPI defs (with lowerBetter for Avg Position)
  const KPI_DEFS = [
    { key: 'impressions', label: 'Impressions', fmt },
    { key: 'clicks', label: 'Clicks', fmt },
    { key: 'ctr', label: 'CTR', fmt: fmtPct },
    { key: 'avgPosition', label: 'Avg Position', fmt: fmtPos, lowerBetter: true },
  ]

  // Scatter: scale ranges + best-zone highlight thresholds
  const scatterClicks = scatterRows.rows.map(r => r.clicks)
  const scatterPositions = scatterRows.rows.map(r => r.avgPosition || 0)
  const maxClicks = scatterClicks.length ? Math.max(...scatterClicks) : 0
  const minPos = scatterPositions.length ? Math.max(1, Math.floor(Math.min(...scatterPositions) - 1)) : 1
  const maxPos = scatterPositions.length ? Math.ceil(Math.max(...scatterPositions) + 2) : 30
  // Best zone: top-right quadrant — position ≤ 10 AND clicks ≥ median of dataset
  const sortedClicks = [...scatterClicks].sort((a, b) => a - b)
  const medianClicks = sortedClicks.length ? sortedClicks[Math.floor(sortedClicks.length / 2)] : 0
  const bestZoneX2 = Math.min(10, maxPos)
  const bestZoneY1 = medianClicks * 0.6 // a bit looser than median to give the band visual presence

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a5c' }}>🔑 Keywords Performance · {monthLabel(focusYm)}</div>
        <div style={{ fontSize: 10, color: '#718096' }}>Source: GSC keyword-level (<code>google_search_console_query_by_month</code>) · Brand = query contains "origami risk" or "origami"</div>
      </div>

      {/* KPI controls */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10, padding: '8px 12px', background: '#f7fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>Position Bucket</label>
          <div style={{ display: 'flex', gap: 3 }}>
            {['All', ...RANK_ORDER].map(b => (
              <button key={b} onClick={() => setBucket(b)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: bucket === b ? 'var(--primary, #2c5282)' : '#fff', color: bucket === b ? '#fff' : '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}>{b}</button>
            ))}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>From</label>
          <select value={rangeStart} onChange={e => { const v = e.target.value; setRangeStart(v); if (v > rangeEnd) setRangeEnd(v) }} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e0', minWidth: 120 }}>
            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>To</label>
          <select value={rangeEnd} onChange={e => { const v = e.target.value; setRangeEnd(v); if (v < rangeStart) setRangeStart(v) }} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 4, border: '1px solid #cbd5e0', minWidth: 120 }}>
            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <button onClick={() => { setRangeStart(focusYm); setRangeEnd(focusYm); setBucket('All') }} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}>Reset to Last Month</button>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#718096' }}>
          Showing: <strong>{rangeLabel}</strong> · {bucket} · vs prev period {prevLabel} · vs YoY {yoyLabel}
        </div>
      </div>

      {/* KPI Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${KPI_DEFS.length}, 1fr)`, gap: 8, marginBottom: 16 }}>
        {KPI_DEFS.map(k => {
          const cur = kpiAgg.current[k.key]
          const prev = kpiAgg.prev[k.key]
          const yoy = kpiAgg.yoy[k.key]
          const mom = pctChange(cur, prev)
          const goodMom = mom == null ? null : (k.lowerBetter ? mom <= 0 : mom >= 0)
          const cardClass = mom == null ? '' : goodMom ? 'sp-kpi-good' : 'sp-kpi-bad'
          return (
            <div key={k.key} className={`sp-kpi-card ${cardClass}`}>
              <div className="sp-kpi-label">{k.label}</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: '#1a3a5c', marginTop: 4 }}>{k.fmt(cur)}</div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 9, color: '#718096' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>vs Prev</div>
                  <div><ChgCell val={mom} lowerBetter={k.lowerBetter} /></div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 600 }}>YoY</div>
                  <div><ChgCell val={pctChange(cur, yoy)} lowerBetter={k.lowerBetter} /></div>
                </div>
              </div>
              <div style={{ marginTop: 4, fontSize: 8, color: '#a0aec0' }}>
                Prev: {k.fmt(prev)} · LY: {k.fmt(yoy)}
              </div>
            </div>
          )
        })}
      </div>

      {/* Top dynamic chart — line = selected metric, bar = clicks MoM/YoY % */}
      <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 8, flexWrap: 'wrap', gap: 10 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>📈 15-Month Trend · Bar = Clicks {barView === 'mom' ? 'MoM %' : 'YoY %'} · Line = {lineDef.label}</div>
            <div style={{ fontSize: 9, color: '#718096' }}>{monthLabel(lastNMonths(focusYm, 15)[0])} → {monthLabel(focusYm)} · aggregated across all keywords</div>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>Line metric</label>
              <div style={{ display: 'flex', gap: 3 }}>
                {LINE_METRICS.map(m => (
                  <button key={m.key} onClick={() => setLineMetric(m.key)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: lineMetric === m.key ? 'var(--primary, #2c5282)' : '#fff', color: lineMetric === m.key ? '#fff' : '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}>{m.label}</button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>Bar (clicks)</label>
              <div style={{ display: 'flex', gap: 3 }}>
                {[{ k: 'mom', l: 'MoM %' }, { k: 'yoy', l: 'YoY %' }].map(v => (
                  <button key={v.k} onClick={() => setBarView(v.k)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: barView === v.k ? 'var(--primary, #2c5282)' : '#fff', color: barView === v.k ? '#fff' : '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}>{v.l}</button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <ComposedChart data={topChartData} margin={{ top: 16, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={48} />
            <YAxis yAxisId="left" tick={{ fontSize: 9 }} width={60} tickFormatter={v => v == null ? '' : (lineDef.key === 'ctr' ? (v * 100).toFixed(1) + '%' : lineDef.key === 'avgPosition' ? v.toFixed(1) : v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v)} reversed={lineDef.key === 'avgPosition'} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} width={50} tickFormatter={v => (v * 100).toFixed(0) + '%'} />
            <Tooltip
              formatter={(v, name, props) => {
                if (name === 'Clicks ' + (barView === 'mom' ? 'MoM %' : 'YoY %')) return [fmtChg(v), name]
                return [lineDef.fmt(v), name]
              }}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="right" dataKey={barView === 'mom' ? 'momClicks' : 'yoyClicks'} name={'Clicks ' + (barView === 'mom' ? 'MoM %' : 'YoY %')}>
              {topChartData.map((d, i) => {
                const v = d[barView === 'mom' ? 'momClicks' : 'yoyClicks']
                const color = v == null ? '#cbd5e0' : v >= 0 ? '#38a169' : '#e53e3e'
                return <Cell key={i} fill={color} />
              })}
              <LabelList dataKey={barView === 'mom' ? 'momClicks' : 'yoyClicks'} position="top" formatter={v => v == null ? '' : fmtChg(v)} style={{ fontSize: 8, fill: '#4a5568', fontWeight: 600 }} />
            </Bar>
            <Line yAxisId="left" type="monotone" dataKey="line" name={lineDef.label} stroke="#2c5282" strokeWidth={2.5} dot={{ r: 3, fill: '#2c5282' }} connectNulls>
              <LabelList dataKey="line" position="top" formatter={v => v == null ? '' : (lineDef.key === 'ctr' ? (v * 100).toFixed(1) + '%' : lineDef.key === 'avgPosition' ? v.toFixed(1) : v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString())} style={{ fontSize: 8, fill: '#2c5282', fontWeight: 700 }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Side-by-side: scatter (left) + stacked column (right) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        {/* Scatter */}
        <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 700 }}>🎯 Top 10 Non-Brand Keywords · {scatterRows.ym ? monthLabel(scatterRows.ym) : '—'}</div>
            <div style={{ fontSize: 9, color: '#718096' }}>X = avg position (big → small) · Y = clicks · bubble size = CTR · upper-right (large + low position) is best</div>
          </div>
          <ResponsiveContainer width="100%" height={360}>
            <ScatterChart margin={{ top: 24, right: 32, left: 8, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
              <XAxis
                type="number"
                dataKey="avgPosition"
                name="Avg Position"
                tick={{ fontSize: 10 }}
                reversed
                domain={[minPos, maxPos]}
                allowDecimals={false}
                label={{ value: 'Avg Position (big → small ranking)', position: 'insideBottom', offset: -22, style: { fontSize: 10, fill: '#4a5568' } }}
              />
              <YAxis
                type="number"
                dataKey="clicks"
                name="Clicks"
                tick={{ fontSize: 10 }}
                width={60}
                tickFormatter={fmt}
                domain={[0, 'dataMax + 10%']}
                label={{ value: 'Clicks', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#4a5568' } }}
              />
              <ZAxis type="number" dataKey="ctr" range={[80, 600]} name="CTR" />
              {/* Best zone: small position + high clicks. Declared AFTER axes so Recharts can resolve coordinates. */}
              <ReferenceArea
                x1={minPos}
                x2={bestZoneX2}
                y1={bestZoneY1}
                y2={Math.max(maxClicks * 1.15, 1)}
                fill="#38a169"
                fillOpacity={0.22}
                stroke="#2f855a"
                strokeOpacity={0.7}
                strokeWidth={1.5}
                strokeDasharray="5 3"
                ifOverflow="extendDomain"
                label={{ value: '✨ Best zone', position: 'insideTopRight', fontSize: 11, fill: '#1f5938', fontWeight: 800, offset: 6 }}
              />
              <Tooltip
                cursor={{ strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null
                  const d = payload[0].payload
                  return (
                    <div style={{ background: '#fff', padding: 8, border: '1px solid #e2e8f0', borderRadius: 4, fontSize: 11 }}>
                      <div style={{ fontWeight: 700, color: '#1a3a5c', marginBottom: 4 }}>{d.keyword}</div>
                      <div>Avg position: <strong>{fmtPos(d.avgPosition)}</strong></div>
                      <div>Clicks: <strong>{fmt(d.clicks)}</strong></div>
                      <div>Impressions: <strong>{fmt(d.impressions)}</strong></div>
                      <div>CTR: <strong>{fmtPct(d.ctr)}</strong></div>
                    </div>
                  )
                }}
              />
              <Scatter data={scatterRows.rows} fill="#2c5282" fillOpacity={0.75}>
                <LabelList dataKey="keyword" position="top" style={{ fontSize: 9, fill: '#1a3a5c', fontWeight: 600 }} formatter={v => v.length > 22 ? v.slice(0, 22) + '…' : v} />
                <LabelList dataKey="clicks" position="bottom" style={{ fontSize: 8, fill: '#718096', fontWeight: 600 }} formatter={v => fmt(v)} />
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>

        {/* Stacked column */}
        <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700 }}>🪜 Monthly Keyword Count by Position</div>
              <div style={{ fontSize: 9, color: '#718096' }}>{monthLabel(lastNMonths(focusYm, 15)[0])} → {monthLabel(focusYm)} · click toggle to filter Brand vs Non-Brand</div>
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              {['All', 'Brand', 'Non-Brand'].map(b => (
                <button key={b} onClick={() => setStackedBrand(b)} style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid var(--border)', background: stackedBrand === b ? 'var(--primary, #2c5282)' : '#fff', color: stackedBrand === b ? '#fff' : '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}>{b}</button>
              ))}
            </div>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <ComposedChart data={stackedData} margin={{ top: 16, right: 16, left: 0, bottom: 8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
              <XAxis dataKey="label" tick={{ fontSize: 9 }} angle={-30} textAnchor="end" height={48} />
              <YAxis tick={{ fontSize: 9 }} width={50} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
              <Tooltip formatter={(v, name) => [fmt(v), name]} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              {RANK_ORDER.map((r, idx) => (
                <Bar key={r} dataKey={r} stackId="ranks" name={r} fill={RANK_COLOR[r]}>
                  {/* Inline segment value — only show if the segment has a meaningful share */}
                  <LabelList dataKey={r} position="center" formatter={v => v >= 5 ? fmt(v) : ''} style={{ fontSize: 8, fill: '#fff', fontWeight: 700 }} />
                  {/* Total label on top of the last (top) segment */}
                  {idx === RANK_ORDER.length - 1 && (
                    <LabelList dataKey="total" position="top" formatter={v => v > 0 ? fmt(v) : ''} style={{ fontSize: 9, fill: '#1a3a5c', fontWeight: 700 }} />
                  )}
                </Bar>
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Brand vs NB MoM/YoY drill-down table — placed above the position overview
          so the headline brand split lands first when scrolling */}
      <BrandVsNbTable
        rows={brandKeywordTable}
        ym={focusYm}
        expanded={expandedBrand}
        setExpanded={setExpandedBrand}
        onExport={() => exportKeywordTable(brandKeywordTable, 'origami-seo-brand-vs-nb.csv', 'Type', g => g.type)}
      />

      {/* 15-month position overview table */}
      <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>📋 15-Month Position Overview</div>
            <div style={{ fontSize: 9, color: '#718096' }}>{monthLabel(lastNMonths(focusYm, 15)[0])} → {monthLabel(focusYm)} · unique keyword count in each position bucket · newest month first</div>
          </div>
          <ExportButton onClick={() => {
            const cols = [
              { header: 'Year-Month', accessor: r => r.label },
              ...RANK_ORDER.map(r => ({ header: r, accessor: row => row[r] })),
              { header: 'Total', accessor: r => r.total },
            ]
            downloadCsv('origami-seo-position-overview.csv', cols, positionTable)
          }} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 700 }}>
            <thead>
              <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10 }}>Year-Month</th>
                {RANK_ORDER.map(r => (
                  <th key={r} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, color: '#1a3a5c' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, background: RANK_COLOR[r], borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }}></span>{r}
                  </th>
                ))}
                <th style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderLeft: '2px solid #e2e8f0' }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {positionTable.map(row => (
                <tr key={row.ym} style={{ borderBottom: '1px solid #edf2f7' }}>
                  <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 600, color: '#1a3a5c' }}>{row.label}</td>
                  {RANK_ORDER.map(r => (
                    <td key={r} style={{ textAlign: 'center', padding: '5px 8px', color: '#4a5568' }}>{fmt(row[r])}</td>
                  ))}
                  <td style={{ textAlign: 'center', padding: '5px 8px', fontWeight: 700, color: '#1a3a5c', borderLeft: '2px solid #e2e8f0' }}>{fmt(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Search Intent drill-down table */}
      <SearchIntentTable
        rows={intentTable}
        ym={focusYm}
        expanded={expandedIntent}
        setExpanded={setExpandedIntent}
        onExport={() => exportKeywordTable(intentTable, 'origami-seo-search-intent.csv', 'Search Intent', g => g.intent)}
      />
    </div>
  )
}

// ── Shared drill-down table renderer ──
const KW_METRICS = [
  { key: 'impressions', label: 'Impressions', fmt },
  { key: 'clicks', label: 'Clicks', fmt },
  { key: 'ctr', label: 'CTR', fmt: fmtPct },
  { key: 'avgPosition', label: 'Avg Position', fmt: fmtPos, lowerBetter: true },
]

function MetricRow({ cur, prev, yoy, sm }) {
  return (
    <>
      {KW_METRICS.map((m, idx) => {
        const c = cur[m.key]
        const p = prev[m.key]
        const y = yoy[m.key]
        const groupBorder = idx > 0 ? { borderLeft: '2px solid #e2e8f0' } : {}
        return (
          <React.Fragment key={m.key}>
            <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px', fontWeight: sm ? 500 : 600, color: '#1a3a5c', ...groupBorder, fontSize: sm ? 10 : 11 }}>{m.fmt(c)}</td>
            <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px' }}><ChgCell val={pctChange(c, p)} lowerBetter={m.lowerBetter} sm={sm} /></td>
            <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px' }}><ChgCell val={pctChange(c, y)} lowerBetter={m.lowerBetter} sm={sm} /></td>
          </React.Fragment>
        )
      })}
    </>
  )
}

function MetricHeader() {
  const groupBorderL = { borderLeft: '2px solid #e2e8f0' }
  return (
    <>
      {KW_METRICS.map((m, idx) => (
        <th key={m.key} colSpan={3} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, color: '#1a3a5c', borderBottom: '1px solid #e2e8f0', ...(idx > 0 ? groupBorderL : {}) }}>{m.label}</th>
      ))}
    </>
  )
}
function MetricSubHeader() {
  const groupBorderL = { borderLeft: '2px solid #e2e8f0' }
  return (
    <>
      {KW_METRICS.map((m, idx) => (
        <React.Fragment key={m.key}>
          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', ...(idx > 0 ? groupBorderL : {}) }}>Value</th>
          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568' }}>MoM</th>
          <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568' }}>YoY</th>
        </React.Fragment>
      ))}
    </>
  )
}

function BrandVsNbTable({ rows, ym, expanded, setExpanded, onExport }) {
  return (
    <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>📊 Brand vs Non-Brand Keywords · {monthLabel(ym)} (MoM &amp; YoY)</div>
          <div style={{ fontSize: 9, color: '#718096' }}>Drill-down shows the top 1,000 keywords by clicks per month; the "total" count next to each segment is the uncapped unique keyword count from the rank-bucket rollup.</div>
        </div>
        {onExport && <ExportButton onClick={onExport} />}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1000 }}>
          <thead>
            <tr style={{ background: '#f7fafc' }}>
              <th rowSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #e2e8f0' }}>Type</th>
              <MetricHeader />
            </tr>
            <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
              <MetricSubHeader />
            </tr>
          </thead>
          <tbody>
            {rows.map(group => {
              const isOpen = !!expanded[group.type]
              return (
                <React.Fragment key={group.type}>
                  <tr style={{ borderBottom: '1px solid #edf2f7', cursor: 'pointer', background: '#fafbfc' }} onClick={() => setExpanded(p => ({ ...p, [group.type]: !p[group.type] }))}>
                    <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 700, color: '#1a3a5c' }}>
                      <span style={{ display: 'inline-block', width: 12, color: '#718096' }}>{isOpen ? '▾' : '▸'}</span>
                      {group.type} <span style={{ fontSize: 9, color: '#718096', fontWeight: 400 }}>
                        {group.trueTotal && group.trueTotal > group.keywords.length
                          ? `(${group.keywords.length.toLocaleString()} shown · ${group.trueTotal.toLocaleString()} total)`
                          : `(${group.keywords.length.toLocaleString()})`}
                      </span>
                    </td>
                    <MetricRow cur={group.cur} prev={group.prev} yoy={group.yoy} />
                  </tr>
                  {isOpen && group.keywords.map(kw => (
                    <tr key={kw.keyword} style={{ borderBottom: '1px solid #f7fafc' }}>
                      <td style={{ textAlign: 'left', padding: '4px 8px 4px 28px', fontSize: 10, color: '#4a5568', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={kw.keyword}>{kw.keyword}</td>
                      <MetricRow cur={kw} prev={kw.prev || {}} yoy={kw.yoy || {}} sm />
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function SearchIntentTable({ rows, ym, expanded, setExpanded, onExport }) {
  return (
    <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
        <div>
          <div style={{ fontSize: 12, fontWeight: 700 }}>🎯 Search Intent Drill-Down · {monthLabel(ym)} (MoM &amp; YoY)</div>
          <div style={{ fontSize: 9, color: '#718096' }}>B2B SEO funnel framework: Navigational (brand/competitor) · Transactional (demo/pricing/trial) · Commercial (best/vs/software/vendors) · Informational (how/what/guide/compliance) · Generic (head terms)</div>
        </div>
        {onExport && <ExportButton onClick={onExport} />}
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1000 }}>
          <thead>
            <tr style={{ background: '#f7fafc' }}>
              <th rowSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #e2e8f0' }}>Search Intent</th>
              <MetricHeader />
            </tr>
            <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
              <MetricSubHeader />
            </tr>
          </thead>
          <tbody>
            {rows.map(group => {
              const isOpen = !!expanded[group.intent]
              return (
                <React.Fragment key={group.intent}>
                  <tr style={{ borderBottom: '1px solid #edf2f7', cursor: 'pointer', background: '#fafbfc' }} onClick={() => setExpanded(p => ({ ...p, [group.intent]: !p[group.intent] }))}>
                    <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 700, color: '#1a3a5c' }} title={INTENT_DESC[group.intent]}>
                      <span style={{ display: 'inline-block', width: 12, color: '#718096' }}>{isOpen ? '▾' : '▸'}</span>
                      <span style={{ display: 'inline-block', width: 10, height: 10, background: INTENT_COLOR[group.intent] || '#718096', borderRadius: 2, marginRight: 6, verticalAlign: 'middle' }}></span>
                      {group.intent} <span style={{ fontSize: 9, color: '#718096', fontWeight: 400 }}>({group.keywords.length})</span>
                    </td>
                    <MetricRow cur={group.cur} prev={group.prev} yoy={group.yoy} />
                  </tr>
                  {isOpen && group.keywords.map(kw => (
                    <tr key={kw.keyword} style={{ borderBottom: '1px solid #f7fafc' }}>
                      <td style={{ textAlign: 'left', padding: '4px 8px 4px 28px', fontSize: 10, color: '#4a5568', maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={kw.keyword}>{kw.keyword}</td>
                      <MetricRow cur={kw} prev={kw.prev || {}} yoy={kw.yoy || {}} sm />
                    </tr>
                  ))}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
