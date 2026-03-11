// MQTT Client — connects to Mosquitto via WebSocket
// Subscribes to weather/* topics and provides data to React components

import mqtt from 'mqtt'

const MQTT_WS_URL = import.meta.env.VITE_MQTT_WS_URL || 'ws://YOUR_MQTT_BROKER:9001'
const RECONNECT_DELAY = 3000

export class MqttWeatherClient {
  constructor(options = {}) {
    this.wsUrl = options.wsUrl || MQTT_WS_URL
    this.onWeatherUpdate = options.onWeatherUpdate || (() => {})
    this.onAlertUpdate = options.onAlertUpdate || (() => {})
    this.onForecastUpdate = options.onForecastUpdate || (() => {})
    this.onConnect = options.onConnect || (() => {})
    this.onDisconnect = options.onDisconnect || (() => {})

    this.client = null
    this.shouldReconnect = true
  }

  connect() {
    try {
      console.log(`[MQTT] Connecting to ${this.wsUrl}`)
      this.client = mqtt.connect(this.wsUrl, {
        clientId: `kiosk-display-${Math.random().toString(16).slice(2, 8)}`,
        clean: true,
        reconnectPeriod: RECONNECT_DELAY,
        connectTimeout: 10000,
      })

      this.client.on('connect', () => {
        console.log('[MQTT] Connected')
        this.client.subscribe('weather/#')
        this.onConnect()
      })

      this.client.on('message', (topic, message) => {
        try {
          const data = JSON.parse(message.toString())
          switch (topic) {
            case 'weather/current':
              this.onWeatherUpdate(data)
              break
            case 'weather/alerts':
              this.onAlertUpdate(data)
              break
            case 'weather/forecast/hourly':
              this.onForecastUpdate({ type: 'hourly', data })
              break
            case 'weather/forecast/daily':
              this.onForecastUpdate({ type: 'daily', data })
              break
          }
        } catch (err) {
          console.error('[MQTT] Failed to parse message:', err)
        }
      })

      this.client.on('close', () => {
        console.log('[MQTT] Disconnected')
        this.onDisconnect()
      })

      this.client.on('error', (err) => {
        console.error('[MQTT] Error:', err)
      })
    } catch (err) {
      console.error('[MQTT] Failed to connect:', err)
    }
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.client) {
      this.client.end()
      this.client = null
    }
  }
}

export default MqttWeatherClient
