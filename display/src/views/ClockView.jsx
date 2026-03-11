import { useState, useEffect } from 'react'

// Get time period (MORNING, AFTERNOON, EVENING, NIGHT)
function getTimePeriod(hours) {
  if (hours >= 5 && hours < 12) return 'MORNING'
  if (hours >= 12 && hours < 17) return 'AFTERNOON'
  if (hours >= 17 && hours < 21) return 'EVENING'
  return 'NIGHT'
}

// Format time as H:MM (no leading zero on hour)
function formatTime(date) {
  const hours = date.getHours()
  const minutes = date.getMinutes().toString().padStart(2, '0')
  const hour12 = hours % 12 || 12
  const ampm = hours >= 12 ? 'PM' : 'AM'
  return { time: `${hour12}:${minutes}`, ampm }
}

// Format day of week (uppercase)
function formatDayOfWeek(date) {
  return date.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase()
}

// Format date as "MONTH D, YYYY"
function formatDate(date) {
  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  }).toUpperCase()
}

export default function ClockView() {
  const [now, setNow] = useState(new Date())

  useEffect(() => {
    // Use requestAnimationFrame for smoother updates and less drift
    // Check time every frame, but only update state when second changes
    let lastSecond = -1
    let animationId

    const tick = () => {
      const current = new Date()
      const currentSecond = current.getSeconds()
      if (currentSecond !== lastSecond) {
        lastSecond = currentSecond
        setNow(current)
      }
      animationId = requestAnimationFrame(tick)
    }

    animationId = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(animationId)
  }, [])

  const dayOfWeek = formatDayOfWeek(now)
  const timePeriod = getTimePeriod(now.getHours())
  const { time, ampm } = formatTime(now)
  const dateStr = formatDate(now)

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#000000',
      color: '#ffffff',
      userSelect: 'none',
      fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif"
    }}>
      {/* Day of week */}
      <div style={{
        fontSize: 'min(21.5vw, 18vh)',
        fontWeight: 700,
        letterSpacing: '0.08em',
        marginBottom: '0'
      }}>
        {dayOfWeek}
      </div>

      {/* Time period */}
      <div style={{
        fontSize: 'min(14.4vw, 12vh)',
        fontWeight: 400,
        letterSpacing: '0.25em',
        marginBottom: '0'
      }}>
        {timePeriod}
      </div>

      {/* Time with AM/PM */}
      <div style={{
        display: 'flex',
        alignItems: 'baseline',
        marginBottom: '0'
      }}>
        <span style={{
          fontSize: 'min(34.2vw, 32vh)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          lineHeight: 1,
          fontVariantNumeric: 'tabular-nums'
        }}>
          {time}
        </span>
        <span style={{
          fontSize: 'min(14vw, 12vh)',
          fontWeight: 600,
          marginLeft: '0.05em',
          letterSpacing: '0.02em'
        }}>
          {ampm}
        </span>
      </div>

      {/* Date */}
      <div style={{
        fontSize: 'min(14.4vw, 12vh)',
        fontWeight: 400,
        letterSpacing: '0.15em'
      }}>
        {dateStr}
      </div>
    </div>
  )
}
