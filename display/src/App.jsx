import { useState, useEffect, useCallback, useRef } from 'react'
import ClockView from './views/ClockView'
import DashboardView from './views/DashboardView'
import FrigateView from './views/FrigateView'
import TimerView from './views/TimerView'
import WeatherView from './views/WeatherView'
import { CommandSocket } from './services/commandSocket'

let nextTimerId = 1

export default function App() {
  const [currentView, setCurrentView] = useState('clock')
  const [connected, setConnected] = useState(false)
  const [lastCommand, setLastCommand] = useState(null)
  const [timers, setTimers] = useState([])
  const autoReturnTimerRef = useRef(null)
  const hasActiveTimersRef = useRef(false)
  const timersRef = useRef([])
  const socketRef = useRef(null)

  // Keep refs in sync with timer state (avoids stale closures in callbacks)
  useEffect(() => {
    hasActiveTimersRef.current = timers.length > 0
    timersRef.current = timers
  }, [timers])

  // Auto-return to clock when all timers removed
  const prevTimerCountRef = useRef(0)
  useEffect(() => {
    if (prevTimerCountRef.current > 0 && timers.length === 0 && currentView === 'timer') {
      setCurrentView('clock')
    }
    prevTimerCountRef.current = timers.length
  }, [timers, currentView])

  const clearAutoReturn = () => {
    if (autoReturnTimerRef.current) {
      clearTimeout(autoReturnTimerRef.current)
      autoReturnTimerRef.current = null
    }
  }

  const homeView = () => hasActiveTimersRef.current ? 'timer' : 'clock'

  // Send a message back to the voice pipeline via WebSocket
  const sendToVoice = (message) => {
    socketRef.current?.send(message)
  }

  // Use a ref to always have the latest handler accessible from WebSocket callbacks
  const handleCommandRef = useRef(null)

  handleCommandRef.current = (command) => {
    console.log('Received command:', command)
    setLastCommand(command)

    switch (command.action) {
      case 'show_clock':
        setCurrentView('clock')
        clearAutoReturn()
        if (hasActiveTimersRef.current) {
          autoReturnTimerRef.current = setTimeout(() => {
            setCurrentView('timer')
          }, 20000)
        }
        break

      case 'show_dashboard':
        setCurrentView('dashboard')
        clearAutoReturn()
        if (command.duration) {
          autoReturnTimerRef.current = setTimeout(() => {
            setCurrentView(homeView())
          }, command.duration * 1000)
        }
        break

      case 'show_frigate':
        setCurrentView('frigate')
        clearAutoReturn()
        if (command.duration) {
          const returnDelay = hasActiveTimersRef.current
            ? command.duration * 500   // Half duration when returning to timers
            : command.duration * 1000
          autoReturnTimerRef.current = setTimeout(() => {
            setCurrentView(homeView())
          }, returnDelay)
        }
        break

      case 'show_weather':
        setCurrentView('weather')
        clearAutoReturn()
        if (command.duration) {
          autoReturnTimerRef.current = setTimeout(() => {
            setCurrentView(homeView())
          }, command.duration * 1000)
        }
        break

      case 'show_timer':
        if (hasActiveTimersRef.current) {
          setCurrentView('timer')
          clearAutoReturn()
        }
        break

      case 'set_timer': {
        const duration = command.duration
        if (!duration || duration <= 0) break

        setTimers(prev => {
          let slot = command.slot
          if (slot) {
            // Target specific slot — overwrite if occupied
            if (slot < 1 || slot > 3) return prev
            const filtered = prev.filter(t => t.slot !== slot)
            return [...filtered, {
              id: nextTimerId++,
              slot,
              label: command.label || `${Math.ceil(duration / 60)} min`,
              totalSeconds: duration,
              startedAt: Date.now(),
              expired: false
            }].sort((a, b) => a.slot - b.slot)
          }

          // Auto-assign next available slot
          const usedSlots = new Set(prev.map(t => t.slot))
          slot = null
          for (let s = 1; s <= 3; s++) {
            if (!usedSlots.has(s)) { slot = s; break }
          }
          if (!slot) {
            // All 3 slots full — send error
            sendToVoice({ action: 'timer_error' })
            return prev
          }

          return [...prev, {
            id: nextTimerId++,
            slot,
            label: command.label || `${Math.ceil(duration / 60)} min`,
            totalSeconds: duration,
            startedAt: Date.now(),
            expired: false
          }].sort((a, b) => a.slot - b.slot)
        })

        setCurrentView('timer')
        clearAutoReturn()
        break
      }

      case 'cancel_timer': {
        // Read from ref to always get latest state (closure value can be stale)
        const currentTimers = timersRef.current

        if (command.which === 'all') {
          for (const t of currentTimers) {
            if (t.expired) sendToVoice({ action: 'timer_alarm_stop', timer_id: t.id })
          }
          setTimers([])
          setCurrentView('clock')
          clearAutoReturn()
          break
        }

        if (currentTimers.length === 0) break

        let target
        if (command.slot) {
          target = currentTimers.find(t => t.slot === command.slot)
        } else if (currentTimers.length === 1) {
          target = currentTimers[0]
        } else {
          sendToVoice({ action: 'timer_error' })
          break
        }

        if (!target) break

        if (target.expired) {
          sendToVoice({ action: 'timer_alarm_stop', timer_id: target.id })
        }

        const remaining = currentTimers.filter(t => t.id !== target.id)
        setTimers(remaining)
        if (remaining.length === 0) {
          setCurrentView('clock')
          clearAutoReturn()
        }
        break
      }

      case 'reset_timer': {
        setTimers(prev => {
          if (prev.length === 0) return prev

          let target
          if (command.slot) {
            target = prev.find(t => t.slot === command.slot)
          } else if (prev.length === 1) {
            target = prev[0]
          } else {
            sendToVoice({ action: 'timer_error' })
            return prev
          }

          if (!target) return prev

          if (target.expired) {
            sendToVoice({ action: 'timer_alarm_stop', timer_id: target.id })
          }

          return prev.map(t =>
            t.id === target.id
              ? { ...t, startedAt: Date.now(), expired: false }
              : t
          )
        })
        break
      }

      default:
        console.warn('Unknown command action:', command.action)
    }
  }

  // Stable wrapper that always calls the latest handler via ref
  const handleCommand = useCallback((cmd) => {
    handleCommandRef.current?.(cmd)
  }, [])

  // Timer expiration callback from TimerView
  const handleTimerExpired = useCallback((timerId) => {
    setTimers(prev =>
      prev.map(t => t.id === timerId ? { ...t, expired: true } : t)
    )
    sendToVoice({ action: 'timer_expired', timer_id: timerId })
  }, [])

  // Connect to command WebSocket — runs once on mount
  useEffect(() => {
    const socket = new CommandSocket({
      onCommand: (cmd) => handleCommandRef.current?.(cmd),
      onConnect: () => setConnected(true),
      onDisconnect: () => setConnected(false)
    })

    socket.connect()
    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
      clearAutoReturn()
    }
  }, [])

  // Keyboard shortcuts for testing
  // Use capture phase to intercept keys before iframes
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_clock' })
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_dashboard' })
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_frigate' })
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_weather' })
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_clock' })
      } else if (e.key === 't') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 60, label: '1 minute' })
      } else if (e.key === 'T') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 5, label: '5 seconds' })
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        e.stopPropagation()
        handleCommandRef.current?.({ action: 'cancel_timer', which: 'all' })
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Reclaim focus from iframes so keyboard shortcuts work
  // Cross-origin iframes swallow all keyboard events; polling focus is
  // the only reliable way to intercept keys in the parent document
  useEffect(() => {
    if (currentView === 'clock' || currentView === 'timer') return

    const interval = setInterval(() => {
      if (document.activeElement?.tagName === 'IFRAME') {
        window.focus()
      }
    }, 500)

    return () => clearInterval(interval)
  }, [currentView])

  return (
    <div style={{
      width: '100vw',
      height: '100vh',
      backgroundColor: 'var(--cds-background)',
      position: 'relative',
      overflow: 'hidden'
    }}>
      {/* Connection status indicator */}
      <div style={{
        position: 'absolute',
        top: 8,
        right: 8,
        width: 12,
        height: 12,
        borderRadius: '50%',
        backgroundColor: connected ? 'var(--cds-support-success)' : 'var(--cds-support-error)',
        opacity: 0.6,
        zIndex: 100
      }} />

      {/* View content — all views stay mounted, visibility toggled via CSS.
           Mount/unmount caused the Frigate iframe teardown to block rendering
           on the Jetson Nano's single CPU core, preventing clock from appearing. */}
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'clock' ? 'visible' : 'hidden',
          zIndex: currentView === 'clock' ? 1 : 0
        }}>
          <ClockView />
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'timer' ? 'visible' : 'hidden',
          zIndex: currentView === 'timer' ? 1 : 0
        }}>
          <TimerView
            timers={timers}
            onTimerExpired={handleTimerExpired}
          />
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'dashboard' ? 'visible' : 'hidden',
          zIndex: currentView === 'dashboard' ? 1 : 0
        }}>
          <DashboardView active={currentView === 'dashboard'} />
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'frigate' ? 'visible' : 'hidden',
          zIndex: currentView === 'frigate' ? 1 : 0
        }}>
          <FrigateView active={currentView === 'frigate'} />
        </div>
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'weather' ? 'visible' : 'hidden',
          zIndex: currentView === 'weather' ? 1 : 0
        }}>
          <WeatherView />
        </div>
      </div>

      {/* Navigation buttons - shown on iframe views */}
      {(currentView === 'dashboard' || currentView === 'frigate' || currentView === 'weather') && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          zIndex: 1000
        }}>
          <button
            onClick={() => handleCommand({ action: 'show_clock' })}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Clock (C)
          </button>
          <button
            onClick={() => handleCommand({ action: 'show_dashboard' })}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: currentView === 'dashboard' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Dashboard (D)
          </button>
          <button
            onClick={() => handleCommand({ action: 'show_frigate' })}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: currentView === 'frigate' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Video (V)
          </button>
          <button
            onClick={() => handleCommand({ action: 'show_weather' })}
            style={{
              padding: '12px 24px',
              fontSize: 16,
              fontWeight: 600,
              backgroundColor: currentView === 'weather' ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.7)',
              color: '#fff',
              border: '1px solid rgba(255, 255, 255, 0.3)',
              borderRadius: 8,
              cursor: 'pointer'
            }}
          >
            Weather (W)
          </button>
        </div>
      )}

    </div>
  )
}
