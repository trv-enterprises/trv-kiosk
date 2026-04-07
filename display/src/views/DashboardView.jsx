// Dashboard view - embeds the main dashboard UI
// Accepts active prop to suspend/resume the iframe when not visible

import { useRef, useEffect } from 'react'

const USER_ID = import.meta.env.VITE_DASHBOARD_USER_ID || 'default'
const DASHBOARD_HOST = import.meta.env.VITE_DASHBOARD_HOST || 'http://YOUR_DASHBOARD_HOST'

function dashboardUrl() {
  return `${DASHBOARD_HOST}?user=${USER_ID}&_t=${Date.now()}`
}

export default function DashboardView({ active }) {
  const iframeRef = useRef(null)
  const hasLoaded = useRef(false)

  useEffect(() => {
    if (!iframeRef.current) return

    if (active) {
      if (hasLoaded.current && iframeRef.current.src !== 'about:blank') {
        // Already showing dashboard, don't reload
        return
      }
      iframeRef.current.src = dashboardUrl()
      hasLoaded.current = true
    } else if (hasLoaded.current) {
      iframeRef.current.src = 'about:blank'
    }
  }, [active])

  return (
    <iframe
      ref={iframeRef}
      src={active || !hasLoaded.current ? dashboardUrl() : 'about:blank'}
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
