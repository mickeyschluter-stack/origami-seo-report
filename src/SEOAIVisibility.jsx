import React, { useEffect, useMemo, useState } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from 'recharts'

const BRAND = '#1A7FE0'
const NAVY = '#0B1F3A'
const GREEN = '#2f9e6f'
const ORANGE = '#dd8a1a'
const RED = '#c0392b'
const GREY = '#a0aec0'

const BRAND_NAME = 'Origami Risk'

const PLATFORM_COLORS = {
  'ChatGPT':            '#10a37f',
  'Claude':             '#CC785C',
  'Perplexity':         '#6366f1',
  'Meta':               '#1877f2',
  'Google AI Overview': '#4285f4',
  'Gemini':             '#805ad5',
  'Google AI Mode':     '#0891b2',
  'Copilot':            '#0078d4',
}

const COMP_PALETTE = ['#dd8a1a', '#0891b2', '#805ad5', '#2f9e6f', '#e53e3e', '#d69e2e', '#319795']

// ── Small building blocks ──

function KPICard({ label, value, sub, accent, rank }) {
  return (
    <div className="kpi-card" style={{ borderLeftColor: accent || '#e2e8f0', borderLeftWidth: 3, borderLeftStyle: 'solid' }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value" style={{ color: accent || '#2d3748', fontSize: 22 }}>
        {value}
        {rank && <span style={{ fontSize: 11, fontWeight: 700, color: GREEN, marginLeft: 6 }}>{rank}</span>}
      </div>
      <div className="kpi-lytd" style={{ fontSize: 10.5 }}>{sub}</div>
    </div>
  )
}

function HBar({ name, pct, color, highlight }) {
  const c = color || (highlight ? BRAND : GREY)
  return (
    <div style={{ marginBottom: 9 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: 12, fontWeight: highlight ? 700 : 500, color: highlight ? BRAND : '#2d3748' }}>
        <span>{name}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div style={{ height: 7, background: '#edf2f7', borderRadius: 4 }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100).toFixed(1)}%`, background: c, borderRadius: 4, transition: 'width 0.6s ease' }} />
      </div>
    </div>
  )
}

function PlatformRow({ platform, presence, responses }) {
  const color = PLATFORM_COLORS[platform] || GREY
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#2d3748', display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 9, height: 9, background: color, borderRadius: '50%', display: 'inline-block', flexShrink: 0 }} />
          {platform}
        </span>
        <span style={{ fontSize: 11, color: '#718096' }}>
          {responses.toLocaleString()} responses &nbsp;·&nbsp;
          <span style={{ fontWeight: 700, color }}>{presence.toFixed(1)}%</span>
        </span>
      </div>
      <div style={{ height: 7, background: '#edf2f7', borderRadius: 4 }}>
        <div style={{ height: '100%', width: `${Math.min(presence, 100).toFixed(1)}%`, background: color, borderRadius: 4 }} />
      </div>
    </div>
  )
}

function PresenceBar({ pct }) {
  const color = pct >= 50 ? GREEN : pct >= 30 ? ORANGE : RED
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
      <div style={{ flex: 1, height: 7, background: '#edf2f7', borderRadius: 4 }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100).toFixed(0)}%`, background: color, borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, fontWeight: 700, color, minWidth: 38, textAlign: 'right' }}>{pct.toFixed(1)}%</span>
    </div>
  )
}

function SectionHead({ title, sub }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <h4 style={{ fontSize: 13, fontWeight: 700, color: '#2d3748', margin: '0 0 2px' }}>{title}</h4>
      <span style={{ fontSize: 11, color: '#718096' }}>{sub}</span>
    </div>
  )
}

// ── Helpers ──

// Scrunch returns presence as a 0-1 fraction; render as a percentage.
const toPct = (v) => (Number(v) || 0) * 100

// date_week arrives as ISO "YYYYWW" (e.g. "202621"). Resolve to that week's Monday.
const isoWeekToDate = (s) => {
  const m = String(s).match(/^(\d{4})(\d{1,2})$/)
  if (!m) { const d = new Date(s); return isNaN(d.getTime()) ? null : d }
  const year = +m[1], week = +m[2]
  const jan4 = new Date(Date.UTC(year, 0, 4))
  const dow = jan4.getUTCDay() || 7
  const monday = new Date(jan4)
  monday.setUTCDate(jan4.getUTCDate() - dow + 1 + (week - 1) * 7)
  return monday
}

const fmtWeek = (s) => {
  const d = isoWeekToDate(s)
  return d ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : String(s)
}

const wAvg = (rows, key) => {
  let num = 0, den = 0
  for (const r of rows) {
    const w = Number(r.responses) || 0
    const v = Number(r[key])
    if (!Number.isFinite(v)) continue
    num += v * w
    den += w
  }
  return den > 0 ? num / den : 0
}

// ── Main component ──

export default function SEOAIVisibility() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [referrals, setReferrals] = useState(null)
  const [showAllComps, setShowAllComps] = useState(false)
  const [showAllPrompts, setShowAllPrompts] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch('/api/scrunch')
      .then(r => { if (!r.ok) throw new Error(`Server error: ${r.status}`); return r.json() })
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(e.message); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    fetch('/api/ai-referrals')
      .then(r => (r.ok ? r.json() : null))
      .then(d => { if (!cancelled && d) setReferrals(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [])

  const model = useMemo(() => {
    if (!data) return null

    const weekly = (data.weeklyTrend || [])
      .slice()
      .sort((a, b) => (isoWeekToDate(a.date_week) || 0) - (isoWeekToDate(b.date_week) || 0))
      .map(w => ({
        week: fmtWeek(w.date_week),
        presence: toPct(w.brand_presence_percentage),
        position: Number(w.brand_position_score) || 0,
        sentiment: Number(w.brand_sentiment_score) || 0,
        responses: Number(w.responses) || 0,
      }))

    const platforms = (data.platformBreakdown || []).map(p => ({
      platform: p.ai_platform,
      presence: toPct(p.brand_presence_percentage),
      responses: Number(p.responses) || 0,
    }))

    const topics = (data.topicBreakdown || []).map(t => ({
      topic: t.prompt_topic,
      presence: toPct(t.brand_presence_percentage),
      sentiment: Number(t.brand_sentiment_score) || 0,
      responses: Number(t.responses) || 0,
    })).sort((a, b) => b.presence - a.presence)

    const brandPresence = wAvg(weekly, 'presence')

    const competitors = [
      { name: BRAND_NAME, pct: brandPresence, isBrand: true },
      ...(data.competitorBreakdown || []).map(c => ({
        name: c.competitor_name,
        pct: toPct(c.competitor_presence_percentage),
      })),
    ].sort((a, b) => b.pct - a.pct)

    const brandRank = competitors.findIndex(c => c.isBrand) + 1
    const totalResponses = weekly.reduce((s, w) => s + w.responses, 0)
    const latest = weekly[weekly.length - 1]
    const prev = weekly[weekly.length - 2]
    const wow = latest && prev ? latest.presence - prev.presence : null

    const promptRows = (data.promptBreakdown || []).map(p => ({
      prompt: p.prompt,
      presence: toPct(p.brand_presence_percentage),
      sentiment: Number(p.brand_sentiment_score) || 0,
      responses: Number(p.responses) || 0,
    })).sort((a, b) => b.presence - a.presence)

    return {
      weekly, platforms, topics, competitors, brandPresence, brandRank,
      totalResponses, latest, wow, promptRows,
      prompts: Number(data.prompts) || 0,
    }
  }, [data])

  const refModel = useMemo(() => {
    if (!referrals) return null
    const trend = (referrals.trend || []).map(r => ({
      ym: r.ym,
      label: (() => {
        const d = new Date(`${r.ym}-01T00:00:00Z`)
        return isNaN(d.getTime()) ? r.ym : d.toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' })
      })(),
      sessions: Number(r.sessions) || 0,
      engagedSessions: Number(r.engagedSessions) || 0,
      conversions: Number(r.conversions) || 0,
    }))
    const totals = referrals.totals || { sessions: 0, engagedSessions: 0, conversions: 0 }
    const engRate = totals.sessions > 0 ? (totals.engagedSessions / totals.sessions) * 100 : 0
    const topPages = (referrals.topPages || []).slice(0, 8)
    return { trend, totals, engRate, topPages, hasData: totals.sessions > 0 }
  }, [referrals])

  if (loading) return <div style={{ textAlign: 'center', padding: '4rem', color: '#1a3a5c' }}><div style={{ fontSize: '1.5rem' }}>Loading AI visibility data...</div></div>
  if (error) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: '#e53e3e' }}>
      <div style={{ fontSize: '1.3rem' }}>AI visibility data unavailable</div>
      <div style={{ color: '#666', marginTop: 8, fontSize: 13 }}>{error}</div>
      <div style={{ color: '#a0aec0', marginTop: 12, fontSize: 12, maxWidth: 520, margin: '12px auto 0' }}>
        This tab reads the live Scrunch AI feed (brand 3475). If the Scrunch API key is not configured the endpoint returns 503.
      </div>
    </div>
  )

  const m = model
  const hasWeekly = m.weekly.length > 0
  const hasComp = m.competitors.length > 1
  const noData = m.prompts === 0 && !hasWeekly && m.platforms.length === 0 && m.topics.length === 0

  if (noData) return (
    <div style={{ textAlign: 'center', padding: '4rem 2rem', color: NAVY }}>
      <div style={{ fontSize: '1.3rem', fontWeight: 700 }}>AI visibility tracking not yet provisioned</div>
      <div style={{ color: '#4a5568', marginTop: 10, fontSize: 13, maxWidth: 560, margin: '10px auto 0', lineHeight: 1.6 }}>
        The Scrunch AI feed returned no data for the configured brand. {BRAND_NAME} needs to be set up as a
        tracked brand in Scrunch AI, with the correct brand ID and an API key that has access to it, before this
        tab populates. The rest of the dashboard (search and landing-page performance) reads live data independently.
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Context banner */}
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#eef5fd', border: '1px solid #c7e0fa', borderRadius: 8, padding: '10px 14px' }}>
        <span style={{ fontSize: 12, color: NAVY }}>
          <strong>AI Search Visibility</strong> · How {BRAND_NAME} shows up in answers from ChatGPT, Gemini, Google AI, Perplexity, Claude &amp; Copilot. Source: Scrunch AI (live).
        </span>
        <span style={{ fontSize: 11, color: BRAND }}>
          {m.totalResponses.toLocaleString()} responses analyzed · {m.platforms.length} AI platforms
        </span>
      </div>

      {/* ── KPI Row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
        <KPICard
          label="AI Presence Rate"
          value={`${m.brandPresence.toFixed(1)}%`}
          sub={`of AI responses mention ${BRAND_NAME}`}
          accent={BRAND}
          rank={hasComp ? `#${m.brandRank} of ${m.competitors.length}` : null}
        />
        <KPICard
          label="Latest Week Presence"
          value={m.latest ? `${m.latest.presence.toFixed(1)}%` : '—'}
          sub={m.wow != null ? `${m.wow >= 0 ? '+' : ''}${m.wow.toFixed(1)} pts vs prior week` : 'most recent week'}
          accent={m.wow != null && m.wow < 0 ? RED : GREEN}
        />
        <KPICard label="Prompts Monitored" value={m.prompts.toLocaleString()} sub={`${m.platforms.length} AI platforms tracked`} />
        <KPICard label="Topics Monitored" value={m.topics.length} sub="prompt themes tracked" />
        <KPICard label="Responses Analyzed" value={m.totalResponses.toLocaleString()} sub="AI answers sampled in window" />
        <KPICard
          label="Top Topic Presence"
          value={m.topics.length ? `${m.topics[0].presence.toFixed(1)}%` : '—'}
          sub={m.topics.length ? m.topics[0].topic : 'strongest theme'}
          accent={GREEN}
        />
      </div>

      {/* ── Presence trend + competitive ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: 12, alignItems: 'start' }}>
        <div className="sp-chart-section">
          <SectionHead title="AI Presence Trend" sub={`% of AI responses mentioning ${BRAND_NAME}, by week`} />
          {hasWeekly ? (
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={m.weekly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="pct" domain={[0, 'auto']} tickFormatter={v => `${v}%`} tick={{ fontSize: 10 }} width={38} />
                <YAxis yAxisId="resp" orientation="right" tick={{ fontSize: 10 }} width={40} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(val, name) => name === 'Responses' ? [Number(val).toLocaleString(), name] : [`${Number(val).toFixed(1)}%`, name]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="resp" dataKey="responses" name="Responses" fill="#edf2f7" radius={[2, 2, 0, 0]} />
                <Line yAxisId="pct" type="monotone" dataKey="presence" name="Presence" stroke={BRAND} strokeWidth={3} dot={{ r: 4, fill: BRAND }} activeDot={{ r: 5 }} />
              </ComposedChart>
            </ResponsiveContainer>
          ) : <p style={{ fontSize: 12, color: GREY }}>No weekly trend data in the current window.</p>}
        </div>

        <div className="sp-chart-section">
          <SectionHead title="Competitive Presence" sub="window average · % of AI responses mentioning each brand" />
          {(showAllComps ? m.competitors : m.competitors.slice(0, 10)).map((c, i) => (
            <HBar
              key={c.name}
              name={c.name}
              pct={c.pct}
              highlight={c.isBrand}
              color={c.isBrand ? BRAND : COMP_PALETTE[i % COMP_PALETTE.length]}
            />
          ))}
          {m.competitors.length > 10 && (
            <button
              onClick={() => setShowAllComps(v => !v)}
              style={{ background: 'none', border: 'none', color: BRAND, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '4px 0', marginTop: 2 }}
            >
              {showAllComps ? '▲ Show top 10' : `▼ Show all ${m.competitors.length} brands`}
            </button>
          )}
          <p style={{ fontSize: 10, color: '#a0aec0', marginTop: 10, lineHeight: 1.4 }}>
            Brands are measured independently, not as shares of a fixed total. Higher presence means the brand is mentioned in more AI answers for the monitored prompts.
          </p>
        </div>
      </div>

      {/* ── Platform + Topic ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div className="sp-chart-section">
          <SectionHead title="Presence by AI Platform" sub={`how often ${BRAND_NAME} appears on each engine (window aggregate)`} />
          {m.platforms.length ? m.platforms.map(p => (
            <PlatformRow key={p.platform} platform={p.platform} presence={p.presence} responses={p.responses} />
          )) : <p style={{ fontSize: 12, color: GREY }}>No platform breakdown available.</p>}
        </div>

        <div className="sp-chart-section">
          <SectionHead title="Topic Performance" sub={`${BRAND_NAME} presence rate by prompt topic`} />
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Topic</th>
                  <th>Responses</th>
                  <th style={{ minWidth: 140, textAlign: 'left' }}>Presence Rate</th>
                </tr>
              </thead>
              <tbody>
                {m.topics.map(t => (
                  <tr key={t.topic}>
                    <td style={{ maxWidth: 200 }}>{t.topic}</td>
                    <td>{t.responses.toLocaleString()}</td>
                    <td style={{ textAlign: 'left', paddingRight: 12 }}><PresenceBar pct={t.presence} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.topics.length > 1 && (
            <p style={{ fontSize: 10, color: '#a0aec0', marginTop: 10, lineHeight: 1.4 }}>
              Strongest theme: <strong>{m.topics[0].topic}</strong> ({m.topics[0].presence.toFixed(1)}%). Lowest:{' '}
              <strong>{m.topics[m.topics.length - 1].topic}</strong> ({m.topics[m.topics.length - 1].presence.toFixed(1)}%) — the clearest content opportunity.
            </p>
          )}
        </div>
      </div>

      {/* ── Prompt-level visibility ── */}
      {m.promptRows.length > 0 && (
        <div className="sp-chart-section">
          <SectionHead
            title="Prompt-Level Visibility"
            sub={`how often ${BRAND_NAME} appears in AI answers for each monitored prompt`}
          />
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table" style={{ fontSize: 11 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left' }}>Prompt</th>
                  <th>Responses</th>
                  <th style={{ minWidth: 150, textAlign: 'left' }}>Presence Rate</th>
                  <th>Sentiment</th>
                </tr>
              </thead>
              <tbody>
                {(showAllPrompts ? m.promptRows : m.promptRows.slice(0, 10)).map((p, i) => (
                  <tr key={i}>
                    <td style={{ maxWidth: 460 }}>{p.prompt}</td>
                    <td>{p.responses.toLocaleString()}</td>
                    <td style={{ textAlign: 'left', paddingRight: 12 }}><PresenceBar pct={p.presence} /></td>
                    <td>{p.responses > 0 && p.presence > 0 ? p.sentiment.toFixed(0) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {m.promptRows.length > 10 && (
            <button
              onClick={() => setShowAllPrompts(v => !v)}
              style={{ background: 'none', border: 'none', color: BRAND, fontSize: 11, fontWeight: 600, cursor: 'pointer', padding: '6px 0 0' }}
            >
              {showAllPrompts ? '▲ Show top 10 prompts' : `▼ Show all ${m.promptRows.length} prompts`}
            </button>
          )}
          <p style={{ fontSize: 10, color: '#a0aec0', marginTop: 10, lineHeight: 1.4 }}>
            Presence = share of AI responses for that prompt that mention {BRAND_NAME}. Sentiment is a 0 to 100 composite score
            shown only where the brand is actually mentioned. Sorted by presence; prompts with 0% presence are the clearest content opportunities.
          </p>
        </div>
      )}

      {/* ── Position + Sentiment trend ── */}
      {hasWeekly && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="sp-chart-section">
            <SectionHead title="Answer Position Score" sub={`Scrunch position score for ${BRAND_NAME} when mentioned, by week`} />
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={m.weekly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} width={38} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(1)} />
                <Line type="monotone" dataKey="position" name="Position score" stroke={NAVY} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="sp-chart-section">
            <SectionHead title="Sentiment Score" sub={`Scrunch sentiment score for ${BRAND_NAME} mentions, by week`} />
            <ResponsiveContainer width="100%" height={180}>
              <ComposedChart data={m.weekly} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 'auto']} tick={{ fontSize: 10 }} width={38} />
                <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v) => Number(v).toFixed(1)} />
                <Line type="monotone" dataKey="sentiment" name="Sentiment score" stroke={GREEN} strokeWidth={2.5} dot={{ r: 3 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* ── AI Referral Traffic (GA4 "AI Assistant" channel) ── */}
      {refModel && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 6 }}>
          <div style={{ background: '#f5f0fb', border: '1px solid #ddd0f0', borderRadius: 8, padding: '10px 14px' }}>
            <span style={{ fontSize: 12, color: NAVY }}>
              <strong>AI Referral Traffic</strong> · People who clicked through to origamirisk.com from an AI answer (ChatGPT, Perplexity, Gemini, Copilot &amp; others). Source: GA4 native &ldquo;AI Assistant&rdquo; channel.
            </span>
          </div>

          {refModel.hasData ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                <KPICard label="AI Referral Sessions" value={refModel.totals.sessions.toLocaleString()} sub="humans arriving from AI engines" accent="#805ad5" />
                <KPICard label="Engagement Rate" value={`${refModel.engRate.toFixed(0)}%`} sub={`${refModel.totals.engagedSessions.toLocaleString()} engaged sessions`} accent={GREEN} />
                <KPICard label="Conversions" value={refModel.totals.conversions.toLocaleString()} sub="key events from AI referrals" accent={refModel.totals.conversions > 0 ? GREEN : GREY} />
                <KPICard label="Months Measured" value={refModel.trend.length} sub="channel live since Jun 2026" />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'start' }}>
                <div className="sp-chart-section">
                  <SectionHead title="AI Referral Sessions by Month" sub="sessions vs engaged sessions from the AI Assistant channel" />
                  {refModel.trend.length ? (
                    <ResponsiveContainer width="100%" height={200}>
                      <ComposedChart data={refModel.trend} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#edf2f7" />
                        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 10 }} width={38} />
                        <Tooltip contentStyle={{ fontSize: 11 }} formatter={(v, n) => [Number(v).toLocaleString(), n]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="sessions" name="Sessions" fill="#805ad5" radius={[2, 2, 0, 0]} />
                        <Line type="monotone" dataKey="engagedSessions" name="Engaged" stroke={GREEN} strokeWidth={2.5} dot={{ r: 3 }} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : <p style={{ fontSize: 12, color: GREY }}>No monthly data yet.</p>}
                </div>

                <div className="sp-chart-section">
                  <SectionHead title="Top Landing Pages from AI" sub="where AI referral visitors arrive" />
                  <div style={{ overflowX: 'auto' }}>
                    <table className="data-table" style={{ fontSize: 11 }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left' }}>Landing Page</th>
                          <th>Sessions</th>
                          <th>Engaged</th>
                          <th>Conv.</th>
                        </tr>
                      </thead>
                      <tbody>
                        {refModel.topPages.map(p => (
                          <tr key={p.landingPage}>
                            <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.landingPage}>{p.landingPage}</td>
                            <td>{Number(p.sessions).toLocaleString()}</td>
                            <td>{Number(p.engagedSessions).toLocaleString()}</td>
                            <td>{Number(p.conversions).toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <p style={{ fontSize: 10, color: '#a0aec0', lineHeight: 1.5, margin: '0 4px' }}>
                Source: GA4 default channel group &ldquo;AI Assistant&rdquo; (origamirisk.com), which began populating in June 2026, so the
                window is short and volumes are still small. GA4 does not expose the source/medium split for this channel here, so traffic
                cannot yet be broken out by individual engine (ChatGPT vs Perplexity, etc.). This counts humans clicking through from an AI
                answer, distinct from the AI Agent Traffic tab, which counts the AI crawlers and answer-engine bots themselves.
              </p>
            </>
          ) : (
            <p style={{ fontSize: 12, color: '#4a5568', lineHeight: 1.6, margin: '0 4px' }}>
              GA4&rsquo;s native &ldquo;AI Assistant&rdquo; channel (humans clicking through from an AI answer) is not yet registering
              measurable sessions for origamirisk.com. The channel began populating in June 2026 and remains very low volume. As AI-driven
              referral traffic grows, sessions, engagement, and conversions will surface here automatically.
            </p>
          )}
        </div>
      )}

      {/* Footnote */}
      <p style={{ fontSize: 10, color: '#a0aec0', lineHeight: 1.5, margin: '0 4px' }}>
        Data: Scrunch AI (brand 3475), live feed (cached hourly). Presence = % of AI responses mentioning the brand for the monitored prompts.
        Position and sentiment are Scrunch composite scores computed over responses where {BRAND_NAME} is mentioned. Competitive presence is measured per brand, not as a share of a fixed total.
      </p>

    </div>
  )
}
