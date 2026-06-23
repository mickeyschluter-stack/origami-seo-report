import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './App.css'

// Access control is enforced at the CDN edge by netlify/edge-functions/auth.js
// (server-validated da_session_origami cookie), so no client-side gate is needed.
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
