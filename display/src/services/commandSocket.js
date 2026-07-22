// CommandSocket - WebSocket client for receiving voice commands
// The voice pipeline runs locally on the kiosk and sends commands via WebSocket

const DEFAULT_WS_URL = 'ws://localhost:8765'
const RECONNECT_DELAY = 3000

// Application-level heartbeat. The browser WebSocket API does not expose
// protocol-level ping/pong, so we send our own {action:"ping"} and expect a
// {action:"pong"} back. If we send N pings without seeing a pong, the socket
// is stalled (half-open) even though onclose may never fire -- force a reset.
const HEARTBEAT_INTERVAL = 5000
const HEARTBEAT_MAX_MISSED = 3

// App-level watchdog: independently of why a socket died, if we are not
// connected and not already mid-reconnect for this long, force a connect().
// This is the belt-and-suspenders against a lost scheduleReconnect timer chain.
const WATCHDOG_INTERVAL = 15000

export class CommandSocket {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || DEFAULT_WS_URL
    this.onCommand = options.onCommand || (() => {})
    this.onConnect = options.onConnect || (() => {})
    this.onDisconnect = options.onDisconnect || (() => {})
    this.onError = options.onError || (() => {})

    this.ws = null
    this.reconnectTimer = null
    this.shouldReconnect = true
    this.reconnectAttempts = 0
    this.maxReconnectAttempts = Infinity // Keep trying forever

    this.heartbeatTimer = null
    this.missedPongs = 0
    this.watchdogTimer = null

    this.startWatchdog()
  }

  connect() {
    if (this.ws) {
      const state = this.ws.readyState
      // Already open or mid-handshake -- don't stack a second socket.
      if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) {
        return
      }
    }

    try {
      console.log(`[CommandSocket] Connecting to ${this.wsUrl}`)
      const ws = new WebSocket(this.wsUrl)
      this.ws = ws

      ws.onopen = () => {
        // Guard against a stale socket's handler firing after we've moved on.
        if (this.ws !== ws) return
        console.log('[CommandSocket] Connected')
        this.reconnectAttempts = 0
        this.startHeartbeat()
        this.onConnect()
      }

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)

          // Heartbeat reply -- socket is alive, reset the missed counter.
          if (data.action === 'pong' || data.type === 'pong') {
            this.missedPongs = 0
            return
          }

          console.log('[CommandSocket] Received:', data)

          // Handle different message types
          if (data.type === 'command') {
            this.onCommand(data.payload || data)
          } else if (data.action) {
            // Direct command format
            this.onCommand(data)
          }
        } catch (err) {
          console.error('[CommandSocket] Failed to parse message:', err)
        }
      }

      ws.onclose = (event) => {
        if (this.ws !== ws) return
        console.log(`[CommandSocket] Disconnected (code: ${event.code})`)
        this.stopHeartbeat()
        this.ws = null
        this.onDisconnect()

        if (this.shouldReconnect) {
          this.scheduleReconnect()
        }
      }

      ws.onerror = (error) => {
        console.error('[CommandSocket] Error:', error)
        this.onError(error)
      }
    } catch (err) {
      console.error('[CommandSocket] Failed to connect:', err)
      this.scheduleReconnect()
    }
  }

  scheduleReconnect() {
    if (!this.shouldReconnect) return

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts),
      30000 // Max 30 seconds
    )

    console.log(`[CommandSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.reconnectAttempts++
      this.connect()
    }, delay)
  }

  // --- Heartbeat: detect a stalled-but-not-closed (half-open) socket ---

  startHeartbeat() {
    this.stopHeartbeat()
    this.missedPongs = 0
    this.heartbeatTimer = setInterval(() => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

      if (this.missedPongs >= HEARTBEAT_MAX_MISSED) {
        console.warn(
          `[CommandSocket] ${this.missedPongs} heartbeats missed -- socket is stale, forcing reconnect`
        )
        this.forceReconnect()
        return
      }

      this.missedPongs++
      try {
        this.ws.send(JSON.stringify({ action: 'ping' }))
      } catch (err) {
        console.warn('[CommandSocket] Heartbeat send failed, forcing reconnect:', err)
        this.forceReconnect()
      }
    }, HEARTBEAT_INTERVAL)
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    this.missedPongs = 0
  }

  // Tear down a dead/stale socket and reconnect immediately. Unlike a normal
  // close, we don't wait for onclose (which may never fire on a half-open
  // socket during a renderer stall).
  forceReconnect() {
    this.stopHeartbeat()

    const dead = this.ws
    this.ws = null
    if (dead) {
      // Detach handlers so its late onclose can't double-trigger reconnect.
      dead.onopen = dead.onmessage = dead.onclose = dead.onerror = null
      try {
        dead.close()
      } catch {
        // ignore
      }
    }

    this.onDisconnect()

    if (this.shouldReconnect) {
      // Reconnect promptly rather than via the backoff chain.
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer)
        this.reconnectTimer = null
      }
      this.connect()
    }
  }

  // --- Watchdog: force recovery regardless of why the socket died ---

  startWatchdog() {
    if (this.watchdogTimer) return
    this.watchdogTimer = setInterval(() => {
      if (!this.shouldReconnect) return
      if (this.isConnected()) return
      // A handshake is in flight -- give it a chance.
      if (this.ws && this.ws.readyState === WebSocket.CONNECTING) return
      // A backoff reconnect is already scheduled -- let it run.
      if (this.reconnectTimer) return

      console.warn('[CommandSocket] Watchdog: not connected and no reconnect pending, forcing connect')
      this.connect()
    }, WATCHDOG_INTERVAL)
  }

  stopWatchdog() {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer)
      this.watchdogTimer = null
    }
  }

  disconnect() {
    this.shouldReconnect = false

    this.stopHeartbeat()
    this.stopWatchdog()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
      this.ws.onopen = this.ws.onmessage = this.ws.onclose = this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }

  // Send a message back to the voice pipeline (for acknowledgments, etc.)
  send(message) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      const payload = typeof message === 'string' ? message : JSON.stringify(message)
      this.ws.send(payload)
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN
  }
}

export default CommandSocket
