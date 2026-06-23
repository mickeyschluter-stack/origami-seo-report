import React, { useState, useEffect, useCallback } from 'react'
import SEOExecutivePerformance from './SEOExecutivePerformance'
import SEOKeywordsPerformance from './SEOKeywordsPerformance'
import SEOLandingPagePerformance from './SEOLandingPagePerformance'
import SEOAIVisibility from './SEOAIVisibility'
import SEOAgentTraffic from './SEOAgentTraffic'

function timeAgo(date) {
  if (!date) return ''
  const sec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  return `${hr}h ago`
}

const TABS = [
  { key: 'exec', label: 'Executive Performance',    component: SEOExecutivePerformance },
  { key: 'kw',   label: 'Keywords Performance',     component: SEOKeywordsPerformance },
  { key: 'lp',   label: 'Landing Page Performance', component: SEOLandingPagePerformance },
  { key: 'ai',   label: 'AI Visibility',            component: SEOAIVisibility },
  { key: 'agent', label: 'AI Agent Traffic',        component: SEOAgentTraffic },
]

export default function SEODashboard({ user, onLogout, onSwitchDashboard }) {
  const [activeTab, setActiveTab] = useState(0)
  const [lastRefreshed, setLastRefreshed] = useState(new Date())
  const [refreshing, setRefreshing] = useState(false)
  const [, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(id)
  }, [])

  const refreshData = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetch('/api/seo')
      setLastRefreshed(new Date())
      setActiveTab(a => a)
      window.dispatchEvent(new CustomEvent('seo-refresh'))
    } catch (err) {
      console.error('SEO refresh failed:', err)
    }
    setRefreshing(false)
  }, [])

  const ActiveComponent = TABS[activeTab]?.component

  return (
    <div className="dashboard">
      <header className="topbar" style={{ background: '#fff', color: '#0B1F3A', borderBottom: '2px solid #1A7FE0' }}>
        <div className="topbar-left" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <img src="/origami-logo.svg" alt="Origami Risk" style={{ height: 34, width: 'auto', display: 'block' }} />
          <h2 style={{ color: '#0B1F3A', margin: 0 }}>SEO &amp; AI Visibility Report</h2>
          <span style={{ color: '#1A7FE0', fontSize: 11, marginLeft: 4 }}>
            origamirisk.com · Google Search Console + GA4 + Scrunch (AI)
          </span>
        </div>
        <div className="topbar-right" style={{ color: '#0B1F3A', display: 'flex', alignItems: 'center', gap: 14 }}>
          <span>Welcome, {user.name}</span>
          <a href="/__logout" style={{ color: '#1A7FE0', fontSize: 12, fontWeight: 600, textDecoration: 'none' }}>Sign out</a>
        </div>
      </header>

      <nav className="tabs-bar">
        {TABS.map((t, i) => (
          <button
            key={t.key}
            className={`tab-btn ${activeTab === i ? 'active' : ''}`}
            onClick={() => setActiveTab(i)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <div className="filter-topbar">
        <div className="filter-topbar-meta" style={{ marginLeft: 'auto' }}>
          <button className="refresh-btn" onClick={refreshData} disabled={refreshing}>
            {refreshing ? 'Refreshing...' : 'Refresh'}
          </button>
          {lastRefreshed && <span className="last-refreshed">Last: {timeAgo(lastRefreshed)}</span>}
        </div>
      </div>

      <div className="content content-full">
        {ActiveComponent ? <ActiveComponent /> : <div style={{ padding: 24, color: '#718096' }}>Tab not found.</div>}
      </div>
    </div>
  )
}
