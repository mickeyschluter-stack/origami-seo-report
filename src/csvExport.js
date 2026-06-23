// Lightweight CSV export utility used by all SEO tables.
// columns: [{ header: string, accessor: (row) => any }, ...]
// rows: array of any
export function downloadCsv(filename, columns, rows) {
  const escape = v => {
    if (v == null || v === undefined) return ''
    const s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : String(v)
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
    return s
  }
  const headerLine = columns.map(c => escape(c.header)).join(',')
  const bodyLines = rows.map(r => columns.map(c => escape(c.accessor(r))).join(','))
  // BOM so Excel opens UTF-8 correctly
  const csv = '﻿' + [headerLine, ...bodyLines].join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// Helpers shared across the SEO tables
export const csvFmtNum = v => v == null ? '' : Math.round(v * 100) / 100
export const csvFmtPct = v => v == null || !isFinite(v) ? '' : (v * 100).toFixed(2) + '%'
export const csvFmtChg = v => v == null || !isFinite(v) ? '' : (v > 0 ? '+' : '') + (v * 100).toFixed(1) + '%'
