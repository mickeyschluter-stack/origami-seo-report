import React, { useEffect, useMemo, useState } from 'react'

const BRAND = '#1A7FE0'
const NAVY = '#0B1F3A'
const GREEN = '#2f9e6f'
const PURPLE = '#805ad5'
const GREY = '#a0aec0'

const BRAND_NAME = 'Origami Risk'

// agent_type → display config
const TYPE_META = {
  retrieval: { label: 'Retrieval', color: GREEN,  blurb: 'answer engines fetching the live page for a user question' },
  indexer:   { label: 'Indexer',   color: BRAND,  blurb: 'crawlers building search & AI indexes' },
  training:  { label: 'Training',  color: PURPLE, blurb: 'bots ingesting content for model training' },
}
const TYPE_ORDER = ['retrieval', 'indexer', 'training']

// raw agent_source → friendly label
const AGENT_LABELS = {
  'chatgpt-user': 'ChatGPT-User',
  'perplexity-user': 'Perplexity-User',
  'perplexitybot': 'PerplexityBot',
  'oai-searchbot': 'OAI-SearchBot',
  'gptbot': 'GPTBot',
  'claude': 'ClaudeBot',
  'bingbot': 'Bingbot',
  'googlebot': 'Googlebot',
  'amazonbot': 'Amazonbot',
  'petalbot': 'PetalBot',
  'applebot': 'Applebot',
  'baiduspider': 'Baiduspider',
  'yandexbot': 'YandexBot',
  'meta-externalagent': 'Meta-ExternalAgent',
  'bytespider': 'Bytespider',
  'ccbot': 'CCBot',
}
const agentLabel = s => AGENT_LABELS[s] || s.replace(/(^|[-_])([a-z])/g, (_, p, c) => (p ? p : '') + c.toUpperCase())

function KPICard({ label, value, sub, accent, delta }) {
  // delta is a preformatted string like "+11.2%" or "-0.5 pts" (or null)
  const deltaColor = delta == null ? '#718096' : delta.startsWith('-') ? '#c0392b' : GREEN
  return (
    <div className="kpi-card" style={{ borderLeftColor: accent || '#e2e8f0', borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: accent || '#2d3748', fontSize: 22 }}>{value}</div>
      <div className="kpi-lytd" style={{ fontSize: 10.5 }}>
        {delta != null && <span style={{ color: deltaColor, fontWeight: 700 }}>{delta} · </span>}
        {sub}
      </div>
    </div>
  )
}

function TypeStat({ type, requests, share, delta }) {
  const meta = TYPE_META[type]
  return (
    <div style={{ flex: 1, background: '#fff', border: '1px solid #e2e8f0', borderTop: `3px solid ${meta.color}`, borderRadius: 8, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 6 }}>
        <span style={{ width: 9, height: 9, background: meta.color, borderRadius: '50%', display: 'inline-block' }} />
        <span style={{ fontSize: 12, fontWeight: 700, color: NAVY }}>{meta.label}</span>
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: meta.color }}>{requests.toLocaleString()}</div>
      <div style={{ fontSize: 11, color: '#718096', marginTop: 2 }}>
        {share.toFixed(1)}% of agent requests
        {delta != null && <span style={{ color: delta >= 0 ? GREEN : '#c0392b', fontWeight: 600 }}> · {delta >= 0 ? '+' : ''}{delta.toFixed(1)} pts</span>}
      </div>
      <div style={{ fontSize: 10.5, color: '#a0aec0', marginTop: 6, lineHeight: 1.4 }}>{meta.blurb}</div>
    </div>
  )
}

function AgentRow({ source, type, requests, max }) {
  const meta = TYPE_META[type] || { label: type, color: GREY }
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#2d3748', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, background: meta.color, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
          {agentLabel(source)}
          <span style={{ fontSize: 10, fontWeight: 500, color: '#a0aec0', background: '#f1f5f9', borderRadius: 4, padding: '1px 6px' }}>{meta.label}</span>
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: meta.color }}>{requests.toLocaleString()}</span>
      </div>
      <div style={{ height: 7, background: '#edf2f7', borderRadius: 4 }}>
        <div style={{ height: '100%', width: `${max > 0 ? Math.min((requests / max) * 100, 100).toFixed(1) : 0}%`, background: meta.color, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function summarizeWeek(week) {
  if (!week) return null
  const agents = (week.agents || []).slice().sort((a, b) => b.requests - a.requests)
  const total = agents.reduce((s, a) => s + a.requests, 0)
  const byType = { retrieval: 0, indexer: 0, training: 0 }
  for (const a of agents) byType[a.type] = (byType[a.type] || 0) + a.requests
  return { week: week.week, total, byType, agents, distinct: agents.length }
}

export default function SEOAgentTraffic() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/agent-traffic')
      .then(r => { if (!r.ok) throw new Error(`Server error: ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const model = useMemo(() => {
    if (!data) return null
    const complete = (data.weeks || []).filter(w => w.complete)
      .slice().sort((a, b) => new Date(a.start) - new Date(b.start))
    const latest = summarizeWeek(complete[complete.length - 1])
    const prior = summarizeWeek(complete[complete.length - 2])
    if (!latest) return { empty: true, updated: data._updated }

    const share = (n, d) => (d > 0 ? (n / d) * 100 : 0)
    const retrievalShare = share(latest.byType.retrieval, latest.total)
    const priorRetrievalShare = prior ? share(prior.byType.retrieval, prior.total) : null

    const pctChg = (a, b) => (b > 0 ? ((a - b) / b) * 100 : null)
    return {
      updated: data._updated,
      weekLabel: latest.week,
      total: latest.total,
      distinct: latest.distinct,
      retrieval: latest.byType.retrieval,
      retrievalShare,
      byType: latest.byType,
      agents: latest.agents,
      maxAgent: latest.agents[0]?.requests || 0,
      deltaTotal: prior ? pctChg(latest.total, prior.total) : null,
      deltaRetrieval: prior ? pctChg(latest.byType.retrieval, prior.byType.retrieval) : null,
      deltaRetrievalShare: priorRetrievalShare != null ? retrievalShare - priorRetrievalShare : null,
      deltaIndexerShare: prior ? share(latest.byType.indexer, latest.total) - share(prior.byType.indexer, prior.total) : null,
      deltaTrainingShare: prior ? share(latest.byType.training, latest.total) - share(prior.byType.training, prior.total) : null,
    }
  }, [data])

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#1a3a5c' }}><div style={{ fontSize: '1.5rem' }}>Loading AI agent traffic...</div></div>
  if (error) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: '#e53e3e' }}>
      <div style={{ fontSize: '1.3rem' }}>AI agent traffic unavailable</div>
      <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>{error}</div>
    </div>
  )
  if (model.empty) return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: NAVY }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>No complete week of agent traffic yet</div>
      <div style={{ color: '#4a5568', marginTop: 10, fontSize: 13 }}>The snapshot has no finalized week to report.</div>
    </div>
  )

  const m = model
  const fmtPct = v => (v == null ? null : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Context banner */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#eef5fd', border: '1px solid #c7e0fa', borderRadius: 8, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: NAVY }}>
          <strong>AI Agent Traffic</strong> · How often AI &amp; search bots crawl <strong>origamirisk.com</strong> — the upstream signal behind AI visibility. Source: Scrunch agent logs.
        </span>
        <span style={{ fontSize: 11, color: BRAND }}>
          Week of {m.weekLabel} · refreshed {m.updated}
        </span>
      </div>

      {/* KPI cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
        <KPICard
          label="Total Agent Requests"
          value={m.total.toLocaleString()}
          sub="bot requests this week"
          accent={BRAND}
          delta={m.deltaTotal != null ? fmtPct(m.deltaTotal) : null}
        />
        <KPICard
          label="Answer-Engine Fetches"
          value={m.retrieval.toLocaleString()}
          sub="live fetches for AI answers (retrieval)"
          accent={GREEN}
          delta={m.deltaRetrieval != null ? fmtPct(m.deltaRetrieval) : null}
        />
        <KPICard
          label="Distinct AI Agents"
          value={m.distinct}
          sub="unique bots crawling the site"
        />
        <KPICard
          label="Retrieval Share"
          value={`${m.retrievalShare.toFixed(1)}%`}
          sub="of agent requests are live answer fetches"
          accent={GREEN}
          delta={m.deltaRetrievalShare != null ? `${m.deltaRetrievalShare >= 0 ? '+' : ''}${m.deltaRetrievalShare.toFixed(1)} pts` : null}
        />
      </div>

      {/* By engine type */}
      <div>
        <div style={{ marginBottom: 10 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#2d3748', margin: '0 0 2px' }}>By Engine Type</h4>
          <span style={{ fontSize: 11, color: '#718096' }}>What each bot is doing when it visits — week of {m.weekLabel}</span>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          {TYPE_ORDER.map(t => (
            <TypeStat
              key={t}
              type={t}
              requests={m.byType[t] || 0}
              share={m.total > 0 ? ((m.byType[t] || 0) / m.total) * 100 : 0}
              delta={t === 'retrieval' ? m.deltaRetrievalShare : t === 'indexer' ? m.deltaIndexerShare : m.deltaTrainingShare}
            />
          ))}
        </div>
      </div>

      {/* Agent leaderboard */}
      <div className="sp-chart-section">
        <div style={{ marginBottom: 12 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, color: '#2d3748', margin: '0 0 2px' }}>AI Agents Crawling {BRAND_NAME}</h4>
          <span style={{ fontSize: 11, color: '#718096' }}>Requests by bot · week of {m.weekLabel}</span>
        </div>
        {m.agents.map(a => (
          <AgentRow key={a.source} source={a.source} type={a.type} requests={a.requests} max={m.maxAgent} />
        ))}
      </div>

      <p style={{ fontSize: 10.5, color: '#a0aec0', lineHeight: 1.5, margin: 0 }}>
        Agent traffic = server-side bot request logs from Scrunch for origamirisk.com. <strong>Retrieval</strong> bots
        (ChatGPT-User, Perplexity-User) fetch the live page to answer a user's question — the closest proxy to AI-driven
        demand. <strong>Indexer</strong> bots build search &amp; AI indexes; <strong>training</strong> bots ingest content
        for model training. This view is a scheduled snapshot, not real-time. Data refreshed {m.updated}.
      </p>
    </div>
  )
}
