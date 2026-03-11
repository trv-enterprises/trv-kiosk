// CommandSocket - WebSocket client for receiving voice commands
// The voice pipeline runs locally on the kiosk and sends commands via WebSocket

const DEFAULT_WS_URL = 'ws://localhost:8765'
const RECONNECT_DELAY = 3000

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
  }

  connect() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return
    }

    try {
      console.log(`[CommandSocket] Connecting to ${this.wsUrl}`)
      this.ws = new WebSocket(this.wsUrl)

      this.ws.onopen = () => {
        console.log('[CommandSocket] Connected')
        this.reconnectAttempts = 0
        this.onConnect()
      }

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data)
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

      this.ws.onclose = (event) => {
        console.log(`[CommandSocket] Disconnected (code: ${event.code})`)
        this.ws = null
        this.onDisconnect()

        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect()
        }
      }

      this.ws.onerror = (error) => {
        console.error('[CommandSocket] Error:', error)
        this.onError(error)
      }
    } catch (err) {
      console.error('[CommandSocket] Failed to connect:', err)
      this.scheduleReconnect()
    }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
    }

    const delay = Math.min(
      RECONNECT_DELAY * Math.pow(1.5, this.reconnectAttempts),
      30000 // Max 30 seconds
    )

    console.log(`[CommandSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`)

    this.reconnectTimer = setTimeout(() => {
      this.reconnectAttempts++
      this.connect()
    }, delay)
  }

  disconnect() {
    this.shouldReconnect = false

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    if (this.ws) {
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
