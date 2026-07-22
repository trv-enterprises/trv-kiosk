// Dashboard view - embeds the main dashboard UI
// Accepts active prop to suspend/resume the iframe when not visible.
//
// Auth model (dashboard v0.11.1+): the iframe URL carries an API
// key as `?key=trve_…`. The dashboard's bootstrap chain consumes
// the key, stamps it onto its apiClient (so subsequent API calls
// send Authorization: Bearer trve_…), and strips it from the URL
// bar. Generate the key from the dashboard's Manage → API Keys
// page using the user account the kiosk should authenticate as.

import { useRef, useEffect } from 'react'

const API_KEY = import.meta.env.VITE_DASHBOARD_API_KEY || ''
const DASHBOARD_HOST = import.meta.env.VITE_DASHBOARD_HOST || 'http://YOUR_DASHBOARD_HOST'
const DASHBOARD_URL = API_KEY
  ? `${DASHBOARD_HOST}?key=${API_KEY}`
  : DASHBOARD_HOST

export default function DashboardView({ active }) {
  const iframeRef = useRef(null)
  const hasLoaded = useRef(false)

  useEffect(() => {
    if (!iframeRef.current) return

    if (active) {
      if (hasLoaded.current && iframeRef.current.src !== DASHBOARD_URL) {
        iframeRef.current.src = DASHBOARD_URL
      }
      hasLoaded.current = true
    } else if (hasLoaded.current) {
      iframeRef.current.src = 'about:blank'
    }
  }, [active])

  return (
    <iframe
      ref={iframeRef}
      src={active || !hasLoaded.current ? DASHBOARD_URL : 'about:blank'}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: '#161616'
      }}
      title="Dashboard"
    />
  )
}
