import { useState, useEffect, useCallback, useRef } from 'react'
import ClockView from './views/ClockView'
import DashboardView from './views/DashboardView'
import FrigateView from './views/FrigateView'
import TimerView from './views/TimerView'
import WeatherView from './views/WeatherView'
import AlertView from './views/AlertView'
import { CommandSocket } from './services/commandSocket'

let nextTimerId = 1

// Dashboard is the home view. The display loads on dashboard and stays
// there unless the user issues a voice command, an alert fires, or a
// timer is set. There is no auto-rotating carousel.
const HOME_VIEW = 'dashboard'

// When a timer is active and the user is watching the timer view, peek
// at the dashboard briefly once per minute so they get a glimpse of
// other state without losing the timer.
const TIMER_PEEK_INTERVAL_MS = 60 * 1000
const TIMER_PEEK_DURATION_MS = 5 * 1000

// When an alert fires while the user is on the timer view, peek at the
// dashboard for this long before returning to the timer view. Longer
// than a normal timer peek because the alert warrants more attention.
const ALERT_PEEK_DURATION_MS = 10 * 1000

// Frigate-sourced alerts auto-expire from the queue after this long
// (cameras don't have a resolution signal, so we age them out).
const CAMERA_ALERT_TTL = 5 * 60 * 1000

export default function App() {
  // --- State ---
  const [currentView, setCurrentView] = useState(HOME_VIEW)
  const [alertQueue, setAlertQueue] = useState([])
  const [connected, setConnected] = useState(false)
  const [timers, setTimers] = useState([])

  // --- Refs ---
  const hasActiveTimersRef = useRef(false)
  const timersRef = useRef([])
  const socketRef = useRef(null)
  const currentViewRef = useRef(HOME_VIEW)
  const alertQueueRef = useRef([])
  const handleCommandRef = useRef(null)

  // Peek management: when we're in the middle of a dashboard "peek"
  // (either from the minute-by-minute timer tick or an alert that
  // arrived while on timer view), we track where to return to.
  const peekReturnTimerRef = useRef(null)
  const peekReturnViewRef = useRef(null)
  // Minute-by-minute interval for timer peek ticks
  const timerPeekIntervalRef = useRef(null)

  // Keep refs in sync with state
  useEffect(() => {
    hasActiveTimersRef.current = timers.length > 0
    timersRef.current = timers
  }, [timers])

  useEffect(() => {
    currentViewRef.current = currentView
    // Notify the voice pipeline so it can gate context-dependent voice
    // commands (e.g. frigate-alert MQTT publishes only fire on dashboard).
    socketRef.current?.send({ action: 'view_changed', view: currentView })
  }, [currentView])
  useEffect(() => { alertQueueRef.current = alertQueue }, [alertQueue])

  // --- Helpers ---
  const clearPeekReturnTimer = () => {
    clearTimeout(peekReturnTimerRef.current)
    peekReturnTimerRef.current = null
  }

  const clearTimerPeekInterval = () => {
    clearInterval(timerPeekIntervalRef.current)
    timerPeekIntervalRef.current = null
  }

  const clearAllTimers = () => {
    clearPeekReturnTimer()
    clearTimerPeekInterval()
  }

  const sendToVoice = (message) => {
    socketRef.current?.send(message)
  }

  // --- Alert TTL expiration ---
  // Camera (Frigate) alerts don't have a resolution event — age them
  // out of the queue after CAMERA_ALERT_TTL so stale entries don't
  // accumulate. Other alert sources use explicit resolve events.
  useEffect(() => {
    const interval = setInterval(() => {
      setAlertQueue(prev => prev.filter(a => {
        if (a.source === 'frigate') return Date.now() - a.receivedAt < CAMERA_ALERT_TTL
        return true
      }))
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // --- Timer view peek engine ---
  // While the user is on the timer view and at least one timer is
  // active, briefly jump to the dashboard once per minute so they can
  // see what's changed in the rest of the world. Cleans up whenever
  // we leave the timer view or the timer list empties.
  useEffect(() => {
    const shouldPeek = currentView === 'timer' && timers.length > 0
    if (!shouldPeek) {
      clearTimerPeekInterval()
      return
    }

    // Schedule a peek tick every TIMER_PEEK_INTERVAL_MS
    timerPeekIntervalRef.current = setInterval(() => {
      // Only peek if we're still on the timer view (voice command or
      // alert may have moved us elsewhere since the interval fired).
      if (currentViewRef.current !== 'timer') return

      // Switch to dashboard, schedule a return
      peekReturnViewRef.current = 'timer'
      setCurrentView('dashboard')
      clearPeekReturnTimer()
      peekReturnTimerRef.current = setTimeout(() => {
        // Only return if nothing else has pulled us away from the
        // dashboard in the meantime, and we still have timers.
        if (currentViewRef.current === 'dashboard' && hasActiveTimersRef.current) {
          setCurrentView('timer')
        }
        peekReturnViewRef.current = null
      }, TIMER_PEEK_DURATION_MS)
    }, TIMER_PEEK_INTERVAL_MS)

    return () => clearTimerPeekInterval()
  }, [currentView, timers.length])

  // --- Timer removal: when last timer is dismissed, go to dashboard ---
  const prevTimerCountRef = useRef(0)
  useEffect(() => {
    if (prevTimerCountRef.current > 0 && timers.length === 0 && currentView === 'timer') {
      setCurrentView('dashboard')
    }
    prevTimerCountRef.current = timers.length
  }, [timers, currentView])

  // --- Command handler ---
  handleCommandRef.current = (command) => {
    console.log('Received command:', command)

    switch (command.action) {
      // --- Alert queue management ---
      case 'alert_update': {
        const alert = command.alert
        if (!alert) break

        if (alert.type === 'new') {
          setAlertQueue(prev => {
            const existing = prev.findIndex(a => a.rule === alert.rule)
            if (existing >= 0) {
              const updated = [...prev]
              updated[existing] = { ...updated[existing], ...alert, receivedAt: Date.now() }
              return updated
            }
            return [...prev, { ...alert, receivedAt: Date.now() }]
          })
        } else if (alert.type === 'repeat') {
          setAlertQueue(prev => prev.map(a =>
            a.rule === alert.rule ? { ...a, message: alert.message || a.message, receivedAt: Date.now() } : a
          ))
        } else if (alert.type === 'resolved') {
          setAlertQueue(prev => prev.filter(a => a.rule !== alert.rule))
        }
        break
      }

      // --- View navigation ---
      // All alert-triggered interrupts arrive as show_dashboard with
      // source: 'alert'. Voice commands and button clicks arrive as
      // show_* without a source field. Alerts always play the chime.
      // If the user is currently on the timer view and an alert fires,
      // we peek at the dashboard for ALERT_PEEK_DURATION_MS and then
      // return to the timer view. Otherwise we switch to dashboard and
      // stay there.
      case 'show_clock':
      case 'show_dashboard':
      case 'show_frigate':
      case 'show_weather':
      case 'show_alerts': {
        const viewMap = {
          show_clock: 'clock',
          show_dashboard: 'dashboard',
          show_frigate: 'frigate',
          show_weather: 'weather',
          show_alerts: 'alerts',
        }
        const targetView = viewMap[command.action]

        if (command.source === 'alert') {
          // Alerts always play the chime.
          sendToVoice({ action: 'play_chime' })

          // Alerts always drive the user to the dashboard. Two sub-cases:
          // 1. User is on timer view (or already mid-peek from timer) —
          //    switch/stay on dashboard and set a 10-second return timer
          //    back to timer. An alert arriving mid-peek resets this
          //    timer, extending the dashboard visit.
          // 2. User is anywhere else — switch to dashboard and stay.
          const onTimerOrPeekingFromTimer =
            (currentViewRef.current === 'timer' ||
             peekReturnViewRef.current === 'timer') &&
            hasActiveTimersRef.current

          if (onTimerOrPeekingFromTimer) {
            peekReturnViewRef.current = 'timer'
            setCurrentView('dashboard')
            clearPeekReturnTimer()
            peekReturnTimerRef.current = setTimeout(() => {
              if (currentViewRef.current === 'dashboard' && hasActiveTimersRef.current) {
                setCurrentView('timer')
              }
              peekReturnViewRef.current = null
            }, ALERT_PEEK_DURATION_MS)
          } else {
            clearPeekReturnTimer()
            peekReturnViewRef.current = null
            setCurrentView('dashboard')
          }
        } else {
          // Non-alert navigation: just go to the requested view and
          // cancel any pending peek return.
          clearPeekReturnTimer()
          setCurrentView(targetView)
        }
        break
      }

      case 'show_timer':
        if (hasActiveTimersRef.current) {
          clearPeekReturnTimer()
          setCurrentView('timer')
        }
        break

      // --- Timer commands ---
      case 'set_timer': {
        const duration = command.duration
        if (!duration || duration <= 0) break

        setTimers(prev => {
          let slot = command.slot
          if (slot) {
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

          const usedSlots = new Set(prev.map(t => t.slot))
          slot = null
          for (let s = 1; s <= 3; s++) {
            if (!usedSlots.has(s)) { slot = s; break }
          }
          if (!slot) {
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

        clearPeekReturnTimer()
        setCurrentView('timer')
        break
      }

      case 'cancel_timer': {
        const currentTimers = timersRef.current

        if (command.which === 'all') {
          for (const t of currentTimers) {
            if (t.expired) sendToVoice({ action: 'timer_alarm_stop', timer_id: t.id })
          }
          setTimers([])
          // If we were on the timer view, the effect on `timers` will
          // move us to dashboard once timers empty.
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

  // Connect to command WebSocket
  useEffect(() => {
    const socket = new CommandSocket({
      onCommand: (cmd) => handleCommandRef.current?.(cmd),
      onConnect: () => {
        setConnected(true)
        // Re-sync view state so the voice pipeline's gate for
        // context-dependent commands survives voice restarts.
        socket.send({ action: 'view_changed', view: currentViewRef.current })
      },
      onDisconnect: () => setConnected(false)
    })

    socket.connect()
    socketRef.current = socket

    return () => {
      socket.disconnect()
      socketRef.current = null
      clearAllTimers()
    }
  }, [])

  // Keyboard shortcuts for testing
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_clock' })
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_dashboard' })
      } else if (e.key === 'v' || e.key === 'V') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_frigate' })
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_weather' })
      } else if (e.key === 'n' || e.key === 'N') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_alerts' })
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_dashboard' })
      } else if (e.key === 't') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 60, label: '1 minute' })
      } else if (e.key === 'T') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 5, label: '5 seconds' })
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'cancel_timer', which: 'all' })
      } else if (e.key === 'a') {
        e.preventDefault(); e.stopPropagation()
        // Simulate an incoming garage-door alert
        handleCommandRef.current?.({
          action: 'alert_update',
          alert: { type: 'new', source: 'alert_engine', severity: 'warning', rule: 'test_alert', message: 'Test alert — garage door open', device: 'Test Device' }
        })
        handleCommandRef.current?.({ action: 'show_dashboard', source: 'alert' })
      } else if (e.key === 'A') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({
          action: 'alert_update',
          alert: { type: 'resolved', rule: 'test_alert' }
        })
      }
    }

    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [])

  // Reclaim focus from iframes so keyboard shortcuts work
  useEffect(() => {
    if (currentView === 'clock' || currentView === 'timer' || currentView === 'alerts') return

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

      {/* View content — all views stay mounted, visibility toggled via CSS */}
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
        <div style={{
          position: 'absolute', inset: 0,
          visibility: currentView === 'alerts' ? 'visible' : 'hidden',
          zIndex: currentView === 'alerts' ? 1 : 0
        }}>
          <AlertView alerts={alertQueue} active={currentView === 'alerts'} />
        </div>
      </div>

      {/* Navigation buttons - always visible except on clock view (for clean look).
          Single row, compact sizing. No keyboard key hints - those were useful
          for laptop dev but clutter the wall-mounted kiosk. */}
      {currentView !== 'clock' && (
        <div style={{
          position: 'absolute',
          bottom: 12,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          flexWrap: 'nowrap',
          gap: 8,
          zIndex: 1000,
          whiteSpace: 'nowrap',
        }}>
          {[
            { action: 'show_dashboard', label: 'Dashboard', view: 'dashboard' },
            { action: 'show_clock', label: 'Clock', view: 'clock' },
            { action: 'show_frigate', label: 'Video', view: 'frigate' },
            { action: 'show_weather', label: 'Weather', view: 'weather' },
            { action: 'show_alerts', label: 'Alerts', view: 'alerts' },
          ].map(btn => (
            <button
              key={btn.action}
              onClick={() => handleCommand({ action: btn.action })}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                fontWeight: 600,
                backgroundColor: currentView === btn.view ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: 6,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}

    </div>
  )
}
