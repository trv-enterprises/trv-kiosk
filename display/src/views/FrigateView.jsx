// Frigate NVR view - embeds the Frigate UI
// Accepts active prop to suspend/resume the iframe when not visible,
// preventing it from consuming CPU/GPU on the Jetson Nano

import { useRef, useEffect } from 'react'

const FRIGATE_URL = import.meta.env.VITE_FRIGATE_URL || 'http://YOUR_FRIGATE_HOST:5000'

export default function FrigateView({ active }) {
  const iframeRef = useRef(null)
  const hasLoaded = useRef(false)

  useEffect(() => {
    if (!iframeRef.current) return

    if (active) {
      // Restore src if it was blanked
      if (hasLoaded.current && iframeRef.current.src !== FRIGATE_URL) {
        iframeRef.current.src = FRIGATE_URL
      }
      hasLoaded.current = true
    } else if (hasLoaded.current) {
      // Blank the iframe to stop its rendering pipeline
      iframeRef.current.src = 'about:blank'
    }
  }, [active])

  return (
    <iframe
      ref={iframeRef}
      src={active || !hasLoaded.current ? FRIGATE_URL : 'about:blank'}
      style={{
        width: '100%',
        height: '100%',
        border: 'none',
        backgroundColor: '#161616'
      }}
      title="Frigate NVR"
    />
  )
}
