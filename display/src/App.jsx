import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import ClockView from './views/ClockView'
import DashboardView from './views/DashboardView'
import FrigateView from './views/FrigateView'
import TimerView from './views/TimerView'
import WeatherView from './views/WeatherView'
import AlertView from './views/AlertView'
import { CommandSocket } from './services/commandSocket'

let nextTimerId = 1

const DWELL_TIMES = { clock: 15000, dashboard: 8000, weather: 8000, alerts: 8000 }
const INACTIVITY_TIMEOUT = 60000
const CAMERA_ALERT_TTL = 5 * 60 * 1000 // 5 minutes

export default function App() {
  // --- Display manager state ---
  const [mode, setMode] = useState('carousel')       // 'carousel' | 'paused' | 'interrupt'
  const [currentView, setCurrentView] = useState('clock')
  const [carouselIndex, setCarouselIndex] = useState(0)
  const [alertQueue, setAlertQueue] = useState([])
  const [connected, setConnected] = useState(false)
  const [lastCommand, setLastCommand] = useState(null)
  const [timers, setTimers] = useState([])

  // --- Refs ---
  const carouselTimerRef = useRef(null)
  const inactivityTimerRef = useRef(null)
  const interruptTimerRef = useRef(null)
  const autoReturnTimerRef = useRef(null)
  const hasActiveTimersRef = useRef(false)
  const timersRef = useRef([])
  const socketRef = useRef(null)
  const modeRef = useRef('carousel')
  const currentViewRef = useRef('clock')
  const alertQueueRef = useRef([])
  const inactivityResetRef = useRef(null)
  const interruptReturnModeRef = useRef('carousel')
  const interruptReturnViewRef = useRef(null)
  const handleCommandRef = useRef(null)

  // Keep refs in sync with state
  useEffect(() => {
    hasActiveTimersRef.current = timers.length > 0
    timersRef.current = timers
  }, [timers])

  useEffect(() => { modeRef.current = mode }, [mode])
  useEffect(() => { currentViewRef.current = currentView }, [currentView])
  useEffect(() => { alertQueueRef.current = alertQueue }, [alertQueue])

  // --- Carousel rotation array ---
  const carouselViews = useMemo(() => {
    const base = ['clock', 'dashboard', 'weather']
    if (alertQueue.length > 0) base.push('alerts')
    return base
  }, [alertQueue.length])

  // --- Helpers ---
  const clearAllTimers = () => {
    clearTimeout(carouselTimerRef.current)
    clearTimeout(inactivityTimerRef.current)
    clearTimeout(interruptTimerRef.current)
    clearTimeout(autoReturnTimerRef.current)
    carouselTimerRef.current = null
    inactivityTimerRef.current = null
    interruptTimerRef.current = null
    autoReturnTimerRef.current = null
  }

  const sendToVoice = (message) => {
    socketRef.current?.send(message)
  }

  // --- Carousel engine ---
  useEffect(() => {
    if (mode !== 'carousel') {
      clearTimeout(carouselTimerRef.current)
      carouselTimerRef.current = null
      return
    }

    const idx = carouselIndex % carouselViews.length
    const view = carouselViews[idx]
    setCurrentView(view)

    // Play chime when rotating TO alerts view with active alerts
    if (view === 'alerts' && alertQueueRef.current.length > 0) {
      sendToVoice({ action: 'play_chime' })
    }

    const dwell = DWELL_TIMES[view] || 8000
    carouselTimerRef.current = setTimeout(() => {
      setCarouselIndex(prev => prev + 1)
    }, dwell)

    return () => clearTimeout(carouselTimerRef.current)
  }, [mode, carouselIndex, carouselViews])

  // --- Inactivity auto-resume ---
  useEffect(() => {
    if (mode !== 'paused') {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = null
      inactivityResetRef.current = null
      return
    }

    const resetInactivity = () => {
      clearTimeout(inactivityTimerRef.current)
      inactivityTimerRef.current = setTimeout(() => {
        setMode('carousel')
        setCarouselIndex(0)
      }, INACTIVITY_TIMEOUT)
    }

    resetInactivity()
    inactivityResetRef.current = resetInactivity

    return () => {
      clearTimeout(inactivityTimerRef.current)
      inactivityResetRef.current = null
    }
  }, [mode])

  // --- Alert TTL expiration (camera alerts auto-expire after 5 min) ---
  useEffect(() => {
    const interval = setInterval(() => {
      setAlertQueue(prev => prev.filter(a => {
        if (a.source === 'frigate') return Date.now() - a.receivedAt < CAMERA_ALERT_TTL
        return true
      }))
    }, 30000)
    return () => clearInterval(interval)
  }, [])

  // --- Timer removal: resume carousel when all timers dismissed ---
  const prevTimerCountRef = useRef(0)
  useEffect(() => {
    if (prevTimerCountRef.current > 0 && timers.length === 0 && currentView === 'timer') {
      setMode('carousel')
      setCarouselIndex(0)
    }
    prevTimerCountRef.current = timers.length
  }, [timers, currentView])

  // --- Command handler ---
  handleCommandRef.current = (command) => {
    console.log('Received command:', command)
    setLastCommand(command)

    // Reset inactivity on any command
    inactivityResetRef.current?.()

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

      // --- View navigation (alert-triggered or voice) ---
      case 'show_clock':
      case 'show_dashboard':
      case 'show_frigate':
      case 'show_weather': {
        const viewMap = {
          show_clock: 'clock',
          show_dashboard: 'dashboard',
          show_frigate: 'frigate',
          show_weather: 'weather',
        }
        const targetView = viewMap[command.action]

        if (command.source === 'alert' && command.duration) {
          // Alert-triggered interrupt
          if (modeRef.current !== 'interrupt') {
            interruptReturnModeRef.current = modeRef.current
            interruptReturnViewRef.current = currentViewRef.current
          }
          setMode('interrupt')
          setCurrentView(targetView)

          clearTimeout(interruptTimerRef.current)
          interruptTimerRef.current = setTimeout(() => {
            if (interruptReturnModeRef.current === 'carousel') {
              setMode('carousel')
              // Resume at alerts view if alerts exist
              const views = ['clock', 'dashboard', 'weather']
              if (alertQueueRef.current.length > 0) views.push('alerts')
              const alertIdx = views.indexOf('alerts')
              setCarouselIndex(alertIdx >= 0 ? alertIdx : 0)
            } else {
              setMode('paused')
              setCurrentView(interruptReturnViewRef.current || 'clock')
            }
            interruptReturnModeRef.current = 'carousel'
            interruptReturnViewRef.current = null
          }, command.duration * 1000)
        } else {
          // Voice command — pause carousel
          setMode('paused')
          setCurrentView(targetView)
          clearTimeout(interruptTimerRef.current)
        }
        break
      }

      case 'show_timer':
        if (hasActiveTimersRef.current) {
          setMode('paused')
          setCurrentView('timer')
        }
        break

      // --- Carousel control ---
      case 'pause_carousel':
        setMode('paused')
        break

      case 'resume_carousel':
        setMode('carousel')
        setCarouselIndex(0)
        break

      // --- Timer commands (preserved from original) ---
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

        setMode('paused')
        setCurrentView('timer')
        clearTimeout(interruptTimerRef.current)
        break
      }

      case 'cancel_timer': {
        const currentTimers = timersRef.current

        if (command.which === 'all') {
          for (const t of currentTimers) {
            if (t.expired) sendToVoice({ action: 'timer_alarm_stop', timer_id: t.id })
          }
          setTimers([])
          setMode('carousel')
          setCarouselIndex(0)
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
          setMode('carousel')
          setCarouselIndex(0)
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
      onConnect: () => setConnected(true),
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
      } else if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'show_clock' })
      } else if (e.key === 't') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 60, label: '1 minute' })
      } else if (e.key === 'T') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'set_timer', duration: 5, label: '5 seconds' })
      } else if (e.key === 'x' || e.key === 'X') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'cancel_timer', which: 'all' })
      } else if (e.key === 'p') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'pause_carousel' })
      } else if (e.key === 'r') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({ action: 'resume_carousel' })
      } else if (e.key === 'a') {
        e.preventDefault(); e.stopPropagation()
        handleCommandRef.current?.({
          action: 'alert_update',
          alert: { type: 'new', source: 'alert_engine', severity: 'warning', rule: 'test_alert', message: 'Test alert — garage door open', device: 'Test Device' }
        })
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

  // Reclaim focus from iframes
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

      {/* Paused indicator */}
      {mode === 'paused' && (
        <div style={{
          position: 'absolute',
          top: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          padding: '4px 16px',
          backgroundColor: 'rgba(0, 0, 0, 0.7)',
          border: '1px solid rgba(255, 255, 255, 0.2)',
          borderRadius: 8,
          color: '#8d8d8d',
          fontSize: 13,
          fontWeight: 500,
          zIndex: 100,
          letterSpacing: '0.12em',
        }}>
          PAUSED
        </div>
      )}

      {/* Carousel progress dots */}
      {mode === 'carousel' && (
        <div style={{
          position: 'absolute',
          bottom: 8,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 6,
          zIndex: 100,
        }}>
          {carouselViews.map((view) => (
            <div key={view} style={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              backgroundColor: currentView === view ? '#ffffff' : 'rgba(255, 255, 255, 0.25)',
              transition: 'background-color 0.3s',
            }} />
          ))}
        </div>
      )}

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

      {/* Navigation buttons - shown when paused or on iframe views */}
      {(mode === 'paused' || currentView === 'dashboard' || currentView === 'frigate' || currentView === 'weather') && (
        <div style={{
          position: 'absolute',
          bottom: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          display: 'flex',
          gap: 12,
          zIndex: 1000
        }}>
          {[
            { action: 'show_clock', label: 'Clock', key: 'C', view: 'clock' },
            { action: 'show_dashboard', label: 'Dashboard', key: 'D', view: 'dashboard' },
            { action: 'show_frigate', label: 'Video', key: 'V', view: 'frigate' },
            { action: 'show_weather', label: 'Weather', key: 'W', view: 'weather' },
          ].map(btn => (
            <button
              key={btn.action}
              onClick={() => handleCommand({ action: btn.action })}
              style={{
                padding: '12px 24px',
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: currentView === btn.view ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.7)',
                color: '#fff',
                border: '1px solid rgba(255, 255, 255, 0.3)',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              {btn.label} ({btn.key})
            </button>
          ))}
          {mode === 'paused' && (
            <button
              onClick={() => handleCommand({ action: 'resume_carousel' })}
              style={{
                padding: '12px 24px',
                fontSize: 16,
                fontWeight: 600,
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                color: '#4589ff',
                border: '1px solid rgba(69, 137, 255, 0.5)',
                borderRadius: 8,
                cursor: 'pointer'
              }}
            >
              Resume (R)
            </button>
          )}
        </div>
      )}

    </div>
  )
}
