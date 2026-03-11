import { useEffect, useRef, useState } from 'react'

// Format time as H:MM AM/PM
function formatCurrentTime(date) {
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const hour12 = hours % 12 || 12
  const ampm = hours >= 12 ? 'PM' : 'AM'
  return `${hour12}:${minutes} ${ampm}`
}

// Format countdown: M:SS or H:MM:SS
function formatCountdown(seconds) {
  if (seconds <= 0) return '0:00'
  const s = Math.ceil(seconds)
  const hrs = Math.floor(s / 3600)
  const mins = Math.floor((s % 3600) / 60)
  const secs = s % 60
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

export default function TimerView({ timers, onTimerExpired }) {
  const [now, setNow] = useState(Date.now())
  const expiredRef = useRef(new Set())

  useEffect(() => {
    let animationId
    let lastSecond = -1

    const tick = () => {
      const current = Date.now()
      const currentSecond = Math.floor(current / 1000)
      if (currentSecond !== lastSecond) {
        lastSecond = currentSecond
        setNow(current)
      }
      animationId = requestAnimationFrame(tick)
    }

    animationId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationId)
  }, [])

  // Check for newly expired timers
  useEffect(() => {
    for (const timer of timers) {
      if (timer.expired) continue
      const elapsed = (now - timer.startedAt) / 1000
      const remaining = timer.totalSeconds - elapsed
      if (remaining <= 0 && !expiredRef.current.has(timer.id)) {
        expiredRef.current.add(timer.id)
        onTimerExpired(timer.id)
      }
    }
  }, [now, timers, onTimerExpired])

  // Clean up expired tracking when timers are removed
  useEffect(() => {
    const activeIds = new Set(timers.map(t => t.id))
    for (const id of expiredRef.current) {
      if (!activeIds.has(id)) expiredRef.current.delete(id)
    }
  }, [timers])

  const currentTime = formatCurrentTime(new Date(now))

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: '#000000',
      color: '#ffffff',
      userSelect: 'none',
      fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
      padding: 'min(3vw, 3vh)'
    }}>
      {/* Current time header */}
      <div style={{
        fontSize: timers.length <= 1 ? 'min(31.2vw, 26vh)' : 'min(15.6vw, 13vh)',
        fontWeight: 300,
        letterSpacing: '0.05em',
        color: '#c6c6c6',
        marginBottom: 'min(2vw, 2vh)',
        fontVariantNumeric: 'tabular-nums'
      }}>
        {currentTime}
      </div>

      {/* Timer cards or empty state */}
      <div style={{
        flex: 1,
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        gap: 'min(2.5vw, 2.5vh)'
      }}>
        {timers.length === 0 ? (
          <div style={{
            fontSize: 'min(5vw, 5vh)',
            fontWeight: 400,
            letterSpacing: '0.15em',
            color: '#8d8d8d'
          }}>
            NO ACTIVE TIMERS
          </div>
        ) : timers.length === 1 ? (
          /* Solo timer — large display */
          (() => {
            const timer = timers[0]
            const elapsed = (now - timer.startedAt) / 1000
            const remaining = timer.totalSeconds - elapsed
            const isExpired = timer.expired || remaining <= 0

            return (
              <div
                key={timer.id}
                style={{
                  width: '90%',
                  maxWidth: '1200px',
                  backgroundColor: isExpired ? '#da1e28' : '#262626',
                  border: `1px solid ${isExpired ? '#ff8389' : '#393939'}`,
                  borderRadius: 'min(2vw, 2vh)',
                  padding: 'min(6vw, 6vh) min(4vw, 4vh)',
                  display: 'flex',
                  alignItems: 'center',
                  animation: isExpired ? 'pulse 2s ease-in-out infinite' : 'none'
                }}
              >
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ fontSize: 'min(28vw, 28vh)', fontWeight: 700, lineHeight: 1 }}>
                    #{timer.slot}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ fontSize: 'min(28vw, 28vh)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {isExpired ? 'DONE' : formatCountdown(remaining)}
                  </div>
                </div>
              </div>
            )
          })()
        ) : (
          /* Multiple timers — always show 3 rows, empty slots as placeholders */
          [1, 2, 3].map(slot => {
            const timer = timers.find(t => t.slot === slot)

            if (!timer) {
              return (
                <div
                  key={slot}
                  style={{
                    width: '90%',
                    maxWidth: '1200px',
                    borderRadius: 'min(2vw, 2vh)',
                    padding: 'min(3vw, 3vh) min(4vw, 4vh)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center'
                  }}
                >
                  <div style={{
                    fontSize: 'min(14vw, 14vh)',
                    fontWeight: 700,
                    lineHeight: 1,
                    color: '#393939'
                  }}>
                    #{slot}
                  </div>
                </div>
              )
            }

            const elapsed = (now - timer.startedAt) / 1000
            const remaining = timer.totalSeconds - elapsed
            const isExpired = timer.expired || remaining <= 0

            return (
              <div
                key={slot}
                style={{
                  width: '90%',
                  maxWidth: '1200px',
                  backgroundColor: isExpired ? '#da1e28' : '#262626',
                  border: `1px solid ${isExpired ? '#ff8389' : '#393939'}`,
                  borderRadius: 'min(2vw, 2vh)',
                  padding: 'min(3vw, 3vh) min(4vw, 4vh)',
                  display: 'flex',
                  alignItems: 'center',
                  animation: isExpired ? 'pulse 2s ease-in-out infinite' : 'none'
                }}
              >
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ fontSize: 'min(14vw, 14vh)', fontWeight: 700, lineHeight: 1 }}>
                    #{slot}
                  </div>
                </div>
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                  <div style={{ fontSize: 'min(14vw, 14vh)', fontWeight: 600, fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em', lineHeight: 1 }}>
                    {isExpired ? 'DONE' : formatCountdown(remaining)}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
