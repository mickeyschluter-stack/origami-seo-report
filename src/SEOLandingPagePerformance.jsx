import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, LabelList, Cell,
} from 'recharts'
import { downloadCsv, csvFmtPct, csvFmtChg } from './csvExport'

// ── Formatting ──
const fmt = v => v == null ? '—' : Math.round(v).toLocaleString()
const fmtPct = v => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%'
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
// Color helper for change cells
function ChgCell({ val, lowerBetter, sm }) {
  if (val == null || !isFinite(val)) return <span style={{ fontSize: sm ? 9 : 10, color: '#a0aec0' }}>—</span>
  const good = lowerBetter ? val <= 0 : val >= 0
  const color = val === 0 ? '#718096' : good ? '#38a169' : '#e53e3e'
  return <span style={{ fontSize: sm ? 9 : 10, fontWeight: 600, color }}>{fmtChg(val)}</span>
}

// ── Free-text chip filter: type a term + Enter (or comma) to add it as a chip. ──
// Each chip is a case-insensitive "contains" match; multiple chips are OR-ed together.
function ChipTextFilter({ label, terms, onChange, width = 260, placeholder = 'Type text, Enter to add' }) {
  const [input, setInput] = useState('')
  const addTerm = (raw) => {
    const t = (raw || '').trim()
    if (!t) return
    if (terms.some(x => x.toLowerCase() === t.toLowerCase())) { setInput(''); return }
    onChange([...terms, t])
    setInput('')
  }
  const removeTerm = (t) => onChange(terms.filter(x => x !== t))
  const onKeyDown = (e) => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTerm(input) }
    else if (e.key === 'Backspace' && input === '' && terms.length > 0) { removeTerm(terms[terms.length - 1]) }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: width }}>
      <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center', border: '1px solid #cbd5e0', borderRadius: 4, padding: '3px 5px', background: '#fff', minHeight: 26, width }}>
        {terms.map(t => (
          <span key={t} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, background: '#e8f1fb', color: '#0B1F3A', border: '1px solid #b9d6f2', borderRadius: 10, padding: '1px 6px' }}>
            {t}
            <span onClick={() => removeTerm(t)} title="Remove" style={{ cursor: 'pointer', fontWeight: 700, color: '#0B1F3A', lineHeight: 1 }}>×</span>
          </span>
        ))}
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={() => addTerm(input)}
          placeholder={terms.length === 0 ? placeholder : ''}
          style={{ flex: 1, minWidth: 60, border: 'none', outline: 'none', fontSize: 11, padding: '2px 2px', background: 'transparent' }}
        />
      </div>
    </div>
  )
}

// ── Multi-select dropdown filter with optional search box (used for path filters) ──
function MultiSelectFilter({ label, options, selected, onChange, searchable, width = 180 }) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef()
  useEffect(() => {
    const h = e => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch('') } }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])
  const allSelected = selected.length === 0 || selected.length === options.length
  const text = allSelected ? 'All' : selected.length === 1 ? selected[0] : `${selected.length} selected`
  const filtered = search ? options.filter(o => o.toLowerCase().includes(search.toLowerCase())) : options
  const toggle = (val) => {
    if (selected.includes(val)) onChange(selected.filter(v => v !== val))
    else onChange([...selected, val])
  }
  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 2, minWidth: width }}>
      <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>{label}</label>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{ fontSize: 11, padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 500, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: width - 30 }}>{text}</span>
        <span style={{ fontSize: 9, color: '#718096' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (() => {
        // Long values (e.g. landing page URLs) get a wider, wrapping dropdown so
        // the user can read every option in full. Short-string filters keep the
        // tight default width.
        const longest = options.reduce((m, o) => Math.max(m, (o || '').length), 0)
        const dropdownWidth = longest > 30 ? 520 : width
        const wrap = longest > 30
        return (
          <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: '#fff', border: '1px solid #cbd5e0', borderRadius: 4, boxShadow: '0 4px 12px rgba(0,0,0,0.08)', zIndex: 100, width: dropdownWidth, maxHeight: 360, overflowY: 'auto', overflowX: 'hidden', padding: 6 }}>
            {searchable && (
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search..."
                autoFocus
                style={{ width: 'calc(100% - 12px)', margin: '2px 6px 6px', padding: '4px 8px', fontSize: 11, borderRadius: 3, border: '1px solid #cbd5e0', boxSizing: 'border-box' }}
              />
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '4px 8px', cursor: 'pointer', borderBottom: '1px solid #edf2f7' }}>
              <input type="checkbox" checked={allSelected} onChange={() => onChange([])} />
              <span style={{ fontWeight: 600 }}>All</span>
            </label>
            {filtered.map(o => (
              <label key={o} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, fontSize: 11, padding: '3px 8px', cursor: 'pointer', minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={allSelected || selected.includes(o)}
                  onChange={() => { if (allSelected) onChange([o]); else toggle(o) }}
                  style={{ flexShrink: 0, marginTop: 2 }}
                />
                <span
                  style={wrap
                    ? { wordBreak: 'break-all', overflowWrap: 'anywhere', minWidth: 0, flex: 1, lineHeight: 1.35 }
                    : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0, flex: 1 }}
                  title={o}
                >{o}</span>
              </label>
            ))}
            {filtered.length === 0 && <div style={{ fontSize: 11, color: '#a0aec0', padding: 8 }}>No matches</div>}
          </div>
        )
      })()}
    </div>
  )
}

// Noise filter — these L1 segments are tracking pixels, customer IDs, or
// admin-only paths that obscure real performance trends.
function isNoiseLevel1(l1) {
  if (!l1) return true
  if (l1 === '(unknown)') return true
  if (/^web-pixels/i.test(l1)) return true
  if (/^\d+$/.test(l1)) return true        // purely numeric (e.g. customer / order IDs)
  if (/^\.+$/.test(l1)) return true        // dot-only paths
  if (l1 === 'products_preview') return true
  return false
}

// Display label for Page Path Level 1 — strip leading '/' (the server already does)
// and Title-Case the first letter so '/collections' → 'Collections'.
// Special markers like '(homepage)' / '(none)' stay lowercase.
function formatL1Label(l1) {
  if (!l1) return ''
  if (l1.startsWith('(')) return l1
  return l1.charAt(0).toUpperCase() + l1.slice(1)
}

function ExportButton({ onClick }) {
  return (
    <button
      onClick={onClick}
      style={{ fontSize: 10, padding: '4px 10px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 600 }}
      title="Export this table as CSV"
    >📥 CSV</button>
  )
}

export default function SEOLandingPagePerformance() {
  const [pages, setPages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Drill-down expansion: keyed by composite path
  const [expandedL1, setExpandedL1] = useState({})
  const [expandedL2, setExpandedL2] = useState({})

  // Path filters (multi-select). Empty array = "All".
  const [selL1, setSelL1] = useState([])
  const [selL2, setSelL2] = useState([])
  const [selLP, setSelLP] = useState([])
  // Free-text "contains" terms for landing pages (OR-ed together).
  const [lpTerms, setLpTerms] = useState([])

  // Date-range filters (drives the drill-down totals + comparisons; the top 15-month chart ignores this)
  const [rangeStart, setRangeStart] = useState(lastFullMonth())
  const [rangeEnd, setRangeEnd] = useState(lastFullMonth())

  useEffect(() => {
    let cancelled = false
    // The API splits page rollup into its own endpoint so each response
    // stays under Netlify's 6 MB function cap. We re-derive level1/level2 here
    // since the server no longer ships them.
    const parsePath = (lp) => {
      if (!lp) return { level1: '(unknown)', level2: '(unknown)' }
      const path = String(lp).split('?')[0].split('#')[0]
      if (!path || path === '/') return { level1: '(homepage)', level2: '(homepage)' }
      const segs = path.split('/').filter(Boolean)
      if (segs.length === 0) return { level1: '(homepage)', level2: '(homepage)' }
      return { level1: segs[0] || '(homepage)', level2: segs[1] || '(none)' }
    }
    fetch('/api/seo/pages')
      .then(r => { if (!r.ok) throw new Error(`Server error: ${r.status}`); return r.json() })
      .then(d => {
        if (cancelled) return
        const rows = (d.ga4Pages || []).map(p => ({ ...p, ...parsePath(p.landingPage) }))
        setPages(rows)
        setLoading(false)
      })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  // ── Filter option lists. L2 cascades from L1; LP cascades from L1 + L2. ──
  // Noise paths are pre-stripped so the dropdowns only surface meaningful options.
  const level1Options = useMemo(() => [...new Set(pages.filter(p => !isNoiseLevel1(p.level1)).map(p => p.level1))].sort(), [pages])
  const level2Options = useMemo(() => {
    const filtered = selL1.length > 0 ? pages.filter(p => selL1.includes(p.level1)) : pages
    return [...new Set(filtered.map(p => p.level2))].sort()
  }, [pages, selL1])
  const landingPageOptions = useMemo(() => {
    let filtered = pages
    if (selL1.length > 0) filtered = filtered.filter(p => selL1.includes(p.level1))
    if (selL2.length > 0) filtered = filtered.filter(p => selL2.includes(p.level2))
    return [...new Set(filtered.map(p => p.landingPage))].sort()
  }, [pages, selL1, selL2])

  // ── Apply path filters + noise filter to the page-month rows ──
  const filteredPages = useMemo(() => {
    const terms = lpTerms.map(t => t.toLowerCase())
    return pages.filter(p => {
      if (isNoiseLevel1(p.level1)) return false
      if (selL1.length > 0 && !selL1.includes(p.level1)) return false
      if (selL2.length > 0 && !selL2.includes(p.level2)) return false
      // Landing-page dimension: chips (contains, OR) combine with the exact picker (OR).
      // A page passes if it matches ANY chip OR is one of the explicitly-picked URLs.
      // If neither chips nor exact picks are active, all pages pass.
      const chipsActive = terms.length > 0
      const exactActive = selLP.length > 0
      if (chipsActive || exactActive) {
        const lp = (p.landingPage || '').toLowerCase()
        const matchChip = chipsActive && terms.some(t => lp.includes(t))
        const matchExact = exactActive && selLP.includes(p.landingPage)
        if (!matchChip && !matchExact) return false
      }
      return true
    })
  }, [pages, selL1, selL2, selLP, lpTerms])

  // Prune cascading selections when parent changes — drop child selections that
  // no longer exist under the new parent set.
  useEffect(() => {
    if (selL2.length > 0) {
      const valid = new Set(level2Options)
      const next = selL2.filter(v => valid.has(v))
      if (next.length !== selL2.length) setSelL2(next)
    }
  }, [level2Options]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (selLP.length > 0) {
      const valid = new Set(landingPageOptions)
      const next = selLP.filter(v => valid.has(v))
      if (next.length !== selLP.length) setSelLP(next)
    }
  }, [landingPageOptions]) // eslint-disable-line react-hooks/exhaustive-deps

  const filterActive = selL1.length + selL2.length + selLP.length + lpTerms.length > 0
  const clearFilters = () => { setSelL1([]); setSelL2([]); setSelLP([]); setLpTerms([]) }

  // Available year-months (sorted ascending) — fuels the From/To dropdowns
  const monthOptions = useMemo(() => [...new Set(pages.map(p => p.ym))].sort(), [pages])

  // Snap the range to actual data on first load (previous full month may not be in the data).
  useEffect(() => {
    if (monthOptions.length === 0) return
    const latest = monthOptions[monthOptions.length - 1]
    if (!monthOptions.includes(rangeStart)) setRangeStart(latest)
    if (!monthOptions.includes(rangeEnd)) setRangeEnd(latest)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthOptions.length])

  // ── focusYm follows rangeEnd; drives chart axis labels + drill-down anchor. ──
  const focusYm = rangeEnd

  // Pre-computed prev-period + YoY-period (used by the drill-down totals)
  const compareBounds = useMemo(() => {
    if (!rangeStart || !rangeEnd) return { months: [], prevMonths: [], yoyMonths: [] }
    const len = rangeLength(rangeStart, rangeEnd)
    const [pStart, pEnd] = shiftRange(rangeStart, rangeEnd, len) // immediately preceding period
    const [yStart, yEnd] = shiftRange(rangeStart, rangeEnd, 12)  // year-over-year
    return {
      months: monthsBetween(rangeStart, rangeEnd),
      prevMonths: monthsBetween(pStart, pEnd),
      yoyMonths: monthsBetween(yStart, yEnd),
      pStart, pEnd, yStart, yEnd,
    }
  }, [rangeStart, rangeEnd])

  // ── Top chart: 15-month Conversions + Sessions ──
  const topChartData = useMemo(() => {
    const last15 = lastNMonths(focusYm, 15)
    const m = new Map()
    for (const p of filteredPages) {
      const ex = m.get(p.ym) || { ym: p.ym, sessions: 0, conversions: 0 }
      ex.sessions += p.sessions
      ex.conversions += p.conversions
      m.set(p.ym, ex)
    }
    return last15.map(ym => {
      const r = m.get(ym) || { ym, sessions: 0, conversions: 0 }
      return { ...r, label: monthLabel(ym) }
    })
  }, [filteredPages, focusYm])

  // ── Drill-down table ──
  const drillRows = useMemo(() => {
    // Pull the three windows from filteredPages using sets for O(1) membership.
    // `cur` = the selected From-To range. `prev` = immediately preceding period
    // of the same length. `yoy` = same range shifted back 12 months.
    const curSet = new Set(compareBounds.months)
    const prevSet = new Set(compareBounds.prevMonths)
    const yoySet = new Set(compareBounds.yoyMonths)
    const cur = filteredPages.filter(p => curSet.has(p.ym))
    const prev = filteredPages.filter(p => prevSet.has(p.ym))
    const yoy = filteredPages.filter(p => yoySet.has(p.ym))
    const indexBy = (rows, fn) => {
      const m = new Map()
      for (const r of rows) {
        const k = fn(r)
        const ex = m.get(k) || { sessions: 0, newUsers: 0, conversions: 0, engagedSessions: 0 }
        ex.sessions += r.sessions
        ex.newUsers += r.newUsers
        ex.conversions += r.conversions
        ex.engagedSessions += r.engagedSessions
        m.set(k, ex)
      }
      // Compute conversion rate + engagement rate
      for (const v of m.values()) {
        v.cvr = v.sessions > 0 ? v.conversions / v.sessions : null
        v.engagementRate = v.sessions > 0 ? v.engagedSessions / v.sessions : null
      }
      return m
    }
    // Build hierarchical structure
    const tree = new Map() // level1 → { stats, level2: Map(level2 → { stats, pages: Map(landingPage → stats) }) }
    for (const p of cur) {
      const l1 = tree.get(p.level1) || { stats: null, level2: new Map() }
      const l2 = l1.level2.get(p.level2) || { stats: null, pages: new Map() }
      const pageStats = l2.pages.get(p.landingPage) || { sessions: 0, newUsers: 0, conversions: 0, engagedSessions: 0 }
      pageStats.sessions += p.sessions
      pageStats.newUsers += p.newUsers
      pageStats.conversions += p.conversions
      pageStats.engagedSessions += p.engagedSessions
      l2.pages.set(p.landingPage, pageStats)
      l1.level2.set(p.level2, l2)
      tree.set(p.level1, l1)
    }
    // Now compute aggregates + comparisons. We use indexBy on the comparison datasets to fetch prev/yoy for any key.
    const curByL1 = indexBy(cur, p => p.level1)
    const prevByL1 = indexBy(prev, p => p.level1)
    const yoyByL1 = indexBy(yoy, p => p.level1)
    const curByL12 = indexBy(cur, p => `${p.level1}|${p.level2}`)
    const prevByL12 = indexBy(prev, p => `${p.level1}|${p.level2}`)
    const yoyByL12 = indexBy(yoy, p => `${p.level1}|${p.level2}`)
    const prevByPage = indexBy(prev, p => p.landingPage)
    const yoyByPage = indexBy(yoy, p => p.landingPage)

    // Helpers
    const finalize = stats => ({
      ...stats,
      cvr: stats.sessions > 0 ? stats.conversions / stats.sessions : null,
      engagementRate: stats.sessions > 0 ? stats.engagedSessions / stats.sessions : null,
    })
    const emptyStats = () => ({ sessions: 0, newUsers: 0, conversions: 0, engagedSessions: 0 })

    const result = []
    const sortedL1 = [...curByL1.entries()].sort((a, b) => b[1].sessions - a[1].sessions)
    for (const [l1, l1Stats] of sortedL1) {
      const node = tree.get(l1) || { level2: new Map() }
      const sortedL2 = [...node.level2.entries()].sort((a, b) => {
        const aStats = curByL12.get(`${l1}|${a[0]}`) || { sessions: 0 }
        const bStats = curByL12.get(`${l1}|${b[0]}`) || { sessions: 0 }
        return bStats.sessions - aStats.sessions
      })
      const l1Children = []
      for (const [l2, l2Node] of sortedL2) {
        const l2Stats = curByL12.get(`${l1}|${l2}`) || emptyStats()
        const sortedPages = [...l2Node.pages.entries()].sort((a, b) => b[1].sessions - a[1].sessions)
        const pageRows = sortedPages.map(([landingPage, pageStats]) => ({
          key: `${l1}::${l2}::${landingPage}`,
          level: 'page',
          landingPage,
          cur: finalize(pageStats),
          prev: finalize(prevByPage.get(landingPage) || emptyStats()),
          yoy: finalize(yoyByPage.get(landingPage) || emptyStats()),
        }))
        l1Children.push({
          key: `${l1}::${l2}`,
          level: 'l2',
          level2: l2,
          cur: finalize(l2Stats),
          prev: finalize(prevByL12.get(`${l1}|${l2}`) || emptyStats()),
          yoy: finalize(yoyByL12.get(`${l1}|${l2}`) || emptyStats()),
          pages: pageRows,
        })
      }
      result.push({
        key: l1,
        level: 'l1',
        level1: l1,
        cur: finalize(l1Stats),
        prev: finalize(prevByL1.get(l1) || emptyStats()),
        yoy: finalize(yoyByL1.get(l1) || emptyStats()),
        children: l1Children,
      })
    }
    return result
  }, [filteredPages, compareBounds])

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#1a3a5c' }}><div style={{ fontSize: '1.5rem' }}>Loading landing page data...</div></div>
  if (error) return <div style={{ textAlign: 'center', padding: '4rem', color: '#e53e3e' }}><div style={{ fontSize: '1.3rem' }}>Failed to load</div><div style={{ color: '#666' }}>{error}</div></div>

  // ── Top chart export ──
  const exportTopChart = () => {
    downloadCsv('origami-seo-landing-page-monthly-summary.csv', [
      { header: 'Year-Month', accessor: r => r.label },
      { header: 'Sessions', accessor: r => r.sessions },
      { header: 'Conversions', accessor: r => r.conversions },
      { header: 'Conversion Rate', accessor: r => r.sessions > 0 ? (r.conversions / r.sessions).toFixed(4) : '' },
    ], topChartData)
  }

  // ── Drill-down export ──
  const exportDrill = () => {
    const rows = []
    const buildPerf = (cur, prev, yoy) => ({
      sessions: cur.sessions, sessionsMom: pctChange(cur.sessions, prev.sessions), sessionsYoy: pctChange(cur.sessions, yoy.sessions),
      newUsers: cur.newUsers, newUsersMom: pctChange(cur.newUsers, prev.newUsers), newUsersYoy: pctChange(cur.newUsers, yoy.newUsers),
      conversions: cur.conversions, conversionsMom: pctChange(cur.conversions, prev.conversions), conversionsYoy: pctChange(cur.conversions, yoy.conversions),
      cvr: cur.cvr, cvrMom: pctChange(cur.cvr, prev.cvr), cvrYoy: pctChange(cur.cvr, yoy.cvr),
      engagementRate: cur.engagementRate, engagementRateMom: pctChange(cur.engagementRate, prev.engagementRate), engagementRateYoy: pctChange(cur.engagementRate, yoy.engagementRate),
    })
    for (const l1 of drillRows) {
      rows.push({ level1: l1.level1, level2: '', landingPage: '', level: 'L1 Total', ...buildPerf(l1.cur, l1.prev, l1.yoy) })
      for (const l2 of l1.children) {
        rows.push({ level1: l1.level1, level2: l2.level2, landingPage: '', level: 'L2 Total', ...buildPerf(l2.cur, l2.prev, l2.yoy) })
        for (const pg of l2.pages) {
          rows.push({ level1: l1.level1, level2: l2.level2, landingPage: pg.landingPage, level: 'Page', ...buildPerf(pg.cur, pg.prev, pg.yoy) })
        }
      }
    }
    downloadCsv('origami-seo-landing-page-drilldown.csv', [
      { header: 'Page Path Level 1', accessor: r => r.level1 },
      { header: 'Page Path Level 2', accessor: r => r.level2 },
      { header: 'Landing Page', accessor: r => r.landingPage },
      { header: 'Level', accessor: r => r.level },
      { header: 'Sessions', accessor: r => r.sessions },
      { header: 'Sessions MoM', accessor: r => csvFmtChg(r.sessionsMom) },
      { header: 'Sessions YoY', accessor: r => csvFmtChg(r.sessionsYoy) },
      { header: 'New Users', accessor: r => r.newUsers },
      { header: 'New Users MoM', accessor: r => csvFmtChg(r.newUsersMom) },
      { header: 'New Users YoY', accessor: r => csvFmtChg(r.newUsersYoy) },
      { header: 'Conversions', accessor: r => r.conversions },
      { header: 'Conversions MoM', accessor: r => csvFmtChg(r.conversionsMom) },
      { header: 'Conversions YoY', accessor: r => csvFmtChg(r.conversionsYoy) },
      { header: 'Conversion Rate', accessor: r => csvFmtPct(r.cvr) },
      { header: 'Conversion Rate MoM', accessor: r => csvFmtChg(r.cvrMom) },
      { header: 'Conversion Rate YoY', accessor: r => csvFmtChg(r.cvrYoy) },
      { header: 'Engagement Rate', accessor: r => csvFmtPct(r.engagementRate) },
      { header: 'Engagement Rate MoM', accessor: r => csvFmtChg(r.engagementRateMom) },
      { header: 'Engagement Rate YoY', accessor: r => csvFmtChg(r.engagementRateYoy) },
    ], rows)
  }

  // Drill-down render helpers
  const METRICS = [
    { key: 'sessions', label: 'Sessions', fmt },
    { key: 'newUsers', label: 'New Users', fmt },
    { key: 'conversions', label: 'Conversions', fmt },
    { key: 'cvr', label: 'Conv. Rate', fmt: fmtPct },
    { key: 'engagementRate', label: 'Engagement Rate', fmt: fmtPct },
  ]
  const groupBorderL = { borderLeft: '2px solid #e2e8f0' }
  const renderMetricCells = (cur, prev, yoy, sm = false) => (
    <>
      {METRICS.map((m, idx) => (
        <React.Fragment key={m.key}>
          <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px', fontWeight: sm ? 500 : 600, color: '#1a3a5c', ...(idx > 0 ? groupBorderL : {}), fontSize: sm ? 10 : 11 }}>{m.fmt(cur[m.key])}</td>
          <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px' }}><ChgCell val={pctChange(cur[m.key], prev[m.key])} sm={sm} /></td>
          <td style={{ textAlign: 'center', padding: sm ? '4px 6px' : '5px 6px' }}><ChgCell val={pctChange(cur[m.key], yoy[m.key])} sm={sm} /></td>
        </React.Fragment>
      ))}
    </>
  )


  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1a3a5c' }}>📄 Landing Page Performance · {monthLabel(focusYm)}</div>
        <div style={{ fontSize: 10, color: '#718096' }}>Source: GA4 <code>account 328179682</code> · Organic Search (<code>session_default_channel_group = 'Organic Search'</code>) · Conversions = GA4 key events · Path levels parsed from <code>landing_page_plus_query_string</code></div>
      </div>

      {/* Sticky filter bar — applies to every visual on this tab */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        background: 'linear-gradient(180deg, #ffffff 80%, rgba(255,255,255,0.95))',
        padding: '10px 12px',
        marginBottom: 12,
        border: '1px solid #cbd5e0',
        borderRadius: 6,
        boxShadow: '0 2px 8px rgba(26, 58, 92, 0.06)',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
        flexWrap: 'wrap',
      }}>
        <MultiSelectFilter
          label="Page Path Level 1"
          options={level1Options}
          selected={selL1}
          onChange={setSelL1}
          searchable
          width={180}
        />
        <MultiSelectFilter
          label="Page Path Level 2"
          options={level2Options}
          selected={selL2}
          onChange={setSelL2}
          searchable
          width={200}
        />
        <ChipTextFilter
          label="Landing Page contains"
          terms={lpTerms}
          onChange={setLpTerms}
          width={260}
          placeholder="e.g. solutions, claims, demo - Enter to add"
        />
        <MultiSelectFilter
          label="Landing Page (exact)"
          options={landingPageOptions}
          selected={selLP}
          onChange={setSelLP}
          searchable
          width={300}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>From</label>
          <select
            value={rangeStart}
            onChange={e => { const v = e.target.value; setRangeStart(v); if (v > rangeEnd) setRangeEnd(v) }}
            style={{ fontSize: 11, padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e0', minWidth: 130 }}
          >
            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <label style={{ fontSize: 9, fontWeight: 700, color: '#4a5568', textTransform: 'uppercase', letterSpacing: 0.5 }}>To</label>
          <select
            value={rangeEnd}
            onChange={e => { const v = e.target.value; setRangeEnd(v); if (v < rangeStart) setRangeStart(v) }}
            style={{ fontSize: 11, padding: '5px 8px', borderRadius: 4, border: '1px solid #cbd5e0', minWidth: 130 }}
          >
            {monthOptions.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <button
          onClick={() => {
            const latest = monthOptions[monthOptions.length - 1] || lastFullMonth()
            setRangeStart(latest)
            setRangeEnd(latest)
          }}
          style={{ fontSize: 10, padding: '6px 12px', borderRadius: 4, border: '1px solid #cbd5e0', background: '#fff', color: '#1a3a5c', cursor: 'pointer', fontWeight: 600, height: 30 }}
          title="Snap From/To back to the most recent month with data"
        >
          Reset to Last Month
        </button>
        <button
          onClick={clearFilters}
          disabled={!filterActive}
          style={{ fontSize: 10, padding: '6px 12px', borderRadius: 4, border: '1px solid #cbd5e0', background: filterActive ? '#fff' : '#f7fafc', color: filterActive ? '#1a3a5c' : '#a0aec0', cursor: filterActive ? 'pointer' : 'not-allowed', fontWeight: 600, height: 30 }}
        >
          Clear path filters
        </button>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: '#718096', textAlign: 'right' }}>
          {filteredPages.length === pages.length
            ? <span><strong>{pages.length.toLocaleString()}</strong> page-month rows</span>
            : <span><strong>{filteredPages.length.toLocaleString()}</strong> of {pages.length.toLocaleString()} rows after filter</span>}
          <br/>
          <span style={{ color: '#a0aec0' }}>Range: {rangeStart === rangeEnd ? monthLabel(rangeStart) : `${monthLabel(rangeStart)} → ${monthLabel(rangeEnd)}`}</span>
        </div>
      </div>

      {/* Top: 15-month Conversions + Sessions */}
      <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>🎯 15-Month Conversions + Sessions</div>
            <div style={{ fontSize: 9, color: '#718096' }}>{monthLabel(lastNMonths(focusYm, 15)[0])} → {monthLabel(focusYm)} · bar = conversions (left axis), line = sessions (right axis)</div>
          </div>
          <ExportButton onClick={exportTopChart} />
        </div>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={topChartData} margin={{ top: 24, right: 24, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-30} textAnchor="end" height={48} />
            <YAxis yAxisId="left" tick={{ fontSize: 9 }} width={70} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9 }} width={60} tickFormatter={v => v >= 1000 ? (v / 1000).toFixed(0) + 'k' : v} />
            <Tooltip formatter={(v, name) => [fmt(v), name]} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            <Bar yAxisId="left" dataKey="conversions" name="Conversions" fill="#805ad5" opacity={0.85}>
              <LabelList dataKey="conversions" position="top" formatter={v => v > 0 ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString()) : ''} style={{ fontSize: 8, fill: '#553c9a', fontWeight: 700 }} />
            </Bar>
            <Line yAxisId="right" type="monotone" dataKey="sessions" name="Sessions" stroke="#2c5282" strokeWidth={2.5} dot={{ r: 3, fill: '#2c5282' }} connectNulls>
              <LabelList dataKey="sessions" position="top" formatter={v => v > 0 ? (v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v).toLocaleString()) : ''} style={{ fontSize: 8, fill: '#2c5282', fontWeight: 700 }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Drill-down table: L1 → L2 → Landing Page */}
      <div style={{ background: 'var(--card-bg)', borderRadius: 8, border: '1px solid var(--border)', boxShadow: 'var(--shadow)', padding: 14 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 700 }}>📋 Landing Page Drill-Down · {rangeStart === rangeEnd ? monthLabel(rangeStart) : `${monthLabel(rangeStart)} → ${monthLabel(rangeEnd)}`} (vs prev period & YoY)</div>
            <div style={{ fontSize: 9, color: '#718096' }}>Click ▸ to expand: Page Path L1 → L2 → individual landing page · sorted by sessions · prev = preceding {compareBounds.months.length}-month window, YoY = same window 12 months ago</div>
          </div>
          <ExportButton onClick={exportDrill} />
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, minWidth: 1100 }}>
            <thead>
              <tr style={{ background: '#f7fafc' }}>
                <th rowSpan={2} style={{ textAlign: 'left', padding: '6px 8px', fontWeight: 700, fontSize: 10, borderBottom: '2px solid #e2e8f0', minWidth: 280 }}>Page Path</th>
                {METRICS.map((m, idx) => (
                  <th key={m.key} colSpan={3} style={{ textAlign: 'center', padding: '6px 8px', fontWeight: 700, fontSize: 10, color: '#1a3a5c', borderBottom: '1px solid #e2e8f0', ...(idx > 0 ? groupBorderL : {}) }}>{m.label}</th>
                ))}
              </tr>
              <tr style={{ background: '#f7fafc', borderBottom: '2px solid #e2e8f0' }}>
                {METRICS.map((m, idx) => (
                  <React.Fragment key={m.key}>
                    <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568', ...(idx > 0 ? groupBorderL : {}) }}>Value</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568' }}>MoM</th>
                    <th style={{ textAlign: 'center', padding: '4px 6px', fontWeight: 600, fontSize: 9, color: '#4a5568' }}>YoY</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {drillRows.map(l1 => {
                const isOpen1 = !!expandedL1[l1.key]
                return (
                  <React.Fragment key={l1.key}>
                    <tr style={{ borderBottom: '1px solid #edf2f7', cursor: 'pointer', background: '#fafbfc' }} onClick={() => setExpandedL1(p => ({ ...p, [l1.key]: !p[l1.key] }))}>
                      <td style={{ textAlign: 'left', padding: '5px 8px', fontWeight: 700, color: '#1a3a5c' }}>
                        <span style={{ display: 'inline-block', width: 14, color: '#718096' }}>{isOpen1 ? '▾' : '▸'}</span>
                        {formatL1Label(l1.level1)} <span style={{ fontSize: 9, color: '#718096', fontWeight: 400 }}>({l1.children.length} L2)</span>
                      </td>
                      {renderMetricCells(l1.cur, l1.prev, l1.yoy)}
                    </tr>
                    {isOpen1 && l1.children.map(l2 => {
                      const isOpen2 = !!expandedL2[l2.key]
                      return (
                        <React.Fragment key={l2.key}>
                          <tr style={{ borderBottom: '1px solid #f7fafc', cursor: 'pointer', background: '#fff' }} onClick={() => setExpandedL2(p => ({ ...p, [l2.key]: !p[l2.key] }))}>
                            <td style={{ textAlign: 'left', padding: '4px 8px 4px 32px', fontSize: 10, color: '#4a5568', fontWeight: 600 }}>
                              <span style={{ display: 'inline-block', width: 14, color: '#718096' }}>{isOpen2 ? '▾' : '▸'}</span>
                              {formatL1Label(l1.level1)} / {l2.level2} <span style={{ fontSize: 9, color: '#a0aec0', fontWeight: 400 }}>({l2.pages.length} pages)</span>
                            </td>
                            {renderMetricCells(l2.cur, l2.prev, l2.yoy, true)}
                          </tr>
                          {isOpen2 && l2.pages.map(pg => (
                            <tr key={pg.key} style={{ borderBottom: '1px solid #f7fafc', background: '#fcfdfe' }}>
                              <td style={{ textAlign: 'left', padding: '3px 8px 3px 56px', fontSize: 9, color: '#4a5568', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pg.landingPage}>{pg.landingPage}</td>
                              {renderMetricCells(pg.cur, pg.prev, pg.yoy, true)}
                            </tr>
                          ))}
                        </React.Fragment>
                      )
                    })}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
