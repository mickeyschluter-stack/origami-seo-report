import React from 'react'
import SEODashboard from './SEODashboard'

// SEO-only build — this site ships only the Origami Risk SEO & AI Visibility Report.
const DEFAULT_USER = { name: 'Origami Risk', email: 'origami@directagents.com' }

export default function App() {
  return <SEODashboard user={DEFAULT_USER} onLogout={() => {}} />
}
