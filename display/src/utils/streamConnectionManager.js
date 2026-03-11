/**
 * Stream Connection Manager
 * Singleton manager for SSE/EventSource connections to socket datasources.
 */

import { API_BASE } from '../api/client'

class StreamConnectionManager {
  static instance = null

  constructor() {
    this.connections = new Map()
    this.subscribers = new Map()
    this.buffers = new Map()
    this.maxBufferSize = 1000
  }

  static getInstance() {
    if (!StreamConnectionManager.instance) {
      StreamConnectionManager.instance = new StreamConnectionManager()
    }
    return StreamConnectionManager.instance
  }

  subscribe(datasourceId, callback, options = {}) {
    if (!datasourceId) return () => {}

    if (!this.subscribers.has(datasourceId)) {
      this.subscribers.set(datasourceId, new Set())
    }

    const subscriber = {
      callback,
      onConnect: options.onConnect || (() => {}),
      onDisconnect: options.onDisconnect || (() => {}),
      onError: options.onError || (() => {}),
      onReconnecting: options.onReconnecting || (() => {})
    }

    this.subscribers.get(datasourceId).add(subscriber)

    const connection = this.connections.get(datasourceId)
    if (connection?.connected) {
      subscriber.onConnect()
      const buffer = this.buffers.get(datasourceId)
      if (buffer?.length > 0) {
        buffer.forEach(record => subscriber.callback(record))
      }
    }

    if (!connection) {
      this._connect(datasourceId)
    }

    return () => this._unsubscribe(datasourceId, subscriber)
  }

  _connect(datasourceId) {
    if (this.connections.has(datasourceId)) return

    this.connections.set(datasourceId, {
      eventSource: null,
      connected: false,
      reconnecting: false,
      reconnectTimeout: null,
      reconnectAttempts: 0
    })

    this.buffers.set(datasourceId, [])
    this._createEventSource(datasourceId)
  }

  _createEventSource(datasourceId) {
    const connection = this.connections.get(datasourceId)
    if (!connection) return

    const url = `${API_BASE}/api/connections/${datasourceId}/stream`
    console.log(`[StreamConnectionManager] Connecting to ${datasourceId}`)

    const eventSource = new EventSource(url)
    connection.eventSource = eventSource

    eventSource.onopen = () => {
      console.log(`[StreamConnectionManager] Connected to ${datasourceId}`)
      connection.connected = true
      connection.reconnecting = false
      connection.reconnectAttempts = 0

      const subscribers = this.subscribers.get(datasourceId)
      if (subscribers) {
        subscribers.forEach(sub => sub.onConnect())
      }
    }

    eventSource.addEventListener('record', (event) => {
      try {
        const record = JSON.parse(event.data)
        const buffer = this.buffers.get(datasourceId) || []
        buffer.push(record)
        if (buffer.length > this.maxBufferSize) buffer.shift()
        this.buffers.set(datasourceId, buffer)

        const subscribers = this.subscribers.get(datasourceId)
        if (subscribers) {
          subscribers.forEach(sub => sub.callback(record))
        }
      } catch (err) {
        console.error('[StreamConnectionManager] Error parsing record:', err)
      }
    })

    eventSource.onerror = () => {
      eventSource.close()
      connection.eventSource = null
      connection.connected = false

      const subscribers = this.subscribers.get(datasourceId)
      if (!subscribers || subscribers.size === 0) {
        this._cleanup(datasourceId)
        return
      }

      subscribers.forEach(sub => sub.onDisconnect())

      connection.reconnecting = true
      connection.reconnectAttempts++

      const delay = Math.min(1000 * Math.pow(2, connection.reconnectAttempts - 1), 30000)
      subscribers.forEach(sub => sub.onReconnecting(connection.reconnectAttempts, delay))

      connection.reconnectTimeout = setTimeout(() => {
        if (this.connections.has(datasourceId)) {
          this._createEventSource(datasourceId)
        }
      }, delay)
    }
  }

  _unsubscribe(datasourceId, subscriber) {
    const subscribers = this.subscribers.get(datasourceId)
    if (!subscribers) return

    subscribers.delete(subscriber)

    if (subscribers.size === 0) {
      this._cleanup(datasourceId)
    }
  }

  _cleanup(datasourceId) {
    const connection = this.connections.get(datasourceId)
    if (connection) {
      if (connection.eventSource) connection.eventSource.close()
      if (connection.reconnectTimeout) clearTimeout(connection.reconnectTimeout)
    }

    this.connections.delete(datasourceId)
    this.subscribers.delete(datasourceId)
    this.buffers.delete(datasourceId)
  }

  getStatus(datasourceId) {
    const connection = this.connections.get(datasourceId)
    const subscribers = this.subscribers.get(datasourceId)
    const buffer = this.buffers.get(datasourceId)

    return {
      connected: connection?.connected || false,
      reconnecting: connection?.reconnecting || false,
      reconnectAttempts: connection?.reconnectAttempts || 0,
      subscriberCount: subscribers?.size || 0,
      bufferSize: buffer?.length || 0
    }
  }

  getBuffer(datasourceId) {
    return this.buffers.get(datasourceId) || []
  }
}

export default StreamConnectionManager
