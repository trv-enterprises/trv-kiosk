import { useState, useEffect, useRef } from 'react'
import { MqttWeatherClient } from '../services/mqttClient'

// Map Visual Crossing icon names to Bas Milius weather-icons
// https://github.com/basmilius/weather-icons
const ICON_MAP = {
  'clear-day': 'clear-day',
  'clear-night': 'clear-night',
  'partly-cloudy-day': 'partly-cloudy-day',
  'partly-cloudy-night': 'partly-cloudy-night',
  'cloudy': 'cloudy',
  'rain': 'rain',
  'showers-day': 'partly-cloudy-day-rain',
  'showers-night': 'partly-cloudy-night-rain',
  'snow': 'snow',
  'snow-showers-day': 'partly-cloudy-day-snow',
  'snow-showers-night': 'partly-cloudy-night-snow',
  'thunder-rain': 'thunderstorms-rain',
  'thunder-showers-day': 'thunderstorms-day',
  'thunder-showers-night': 'thunderstorms-night',
  'fog': 'fog',
  'wind': 'wind',
  'hail': 'hail',
  'sleet': 'sleet',
}

function weatherIcon(icon, size = 96) {
  const mapped = ICON_MAP[icon] || 'not-available'
  return (
    <img
      src={`https://basmilius.github.io/weather-icons/production/fill/all/${mapped}.svg`}
      alt={icon}
      width={size}
      height={size}
      style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.15))' }}
    />
  )
}

function formatHour(datetime) {
  // datetime is "HH:MM:SS"
  const hour = parseInt(datetime.split(':')[0], 10)
  if (hour === 0) return '12AM'
  if (hour === 12) return '12PM'
  return hour > 12 ? `${hour - 12}PM` : `${hour}AM`
}

function formatDay(datetime) {
  // datetime is "YYYY-MM-DD"
  const date = new Date(datetime + 'T12:00:00')
  const days = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return days[date.getDay()]
}

function windDirection(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  return dirs[Math.round(deg / 45) % 8]
}

// Current conditions hero
function CurrentConditions({ data }) {
  if (!data) return null

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 32,
      padding: '12px 32px',
    }}>
      {/* Icon */}
      <div style={{ flexShrink: 0 }}>
        {weatherIcon(data.icon, 140)}
      </div>

      {/* Temp + conditions */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{
            fontSize: 96,
            fontWeight: 600,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums',
          }}>
            {Math.round(data.temp)}°
          </span>
          <span style={{ fontSize: 20, opacity: 0.6, fontWeight: 400 }}>
            Feels {Math.round(data.feelslike)}°
          </span>
        </div>
        <div style={{ fontSize: 24, fontWeight: 400, opacity: 0.8, marginTop: 4 }}>
          {data.conditions}
        </div>
      </div>

      {/* Details grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: '8px 24px',
        fontSize: 16,
        opacity: 0.7,
        flexShrink: 0,
      }}>
        <DetailItem label="Humidity" value={`${Math.round(data.humidity)}%`} />
        <DetailItem label="Wind" value={`${Math.round(data.windspeed)} mph ${windDirection(data.winddir)}`} />
        <DetailItem label="UV Index" value={data.uvindex} />
        <DetailItem label="Pressure" value={`${data.pressure} mb`} />
        <DetailItem label="Visibility" value={`${data.visibility} mi`} />
        <DetailItem label="Dew Point" value={`${Math.round(data.dew)}°`} />
      </div>
    </div>
  )
}

function DetailItem({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.5 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 500 }}>
        {value}
      </div>
    </div>
  )
}

// Hourly forecast — horizontal rows, 6 hours
function HourlyForecast({ data }) {
  if (!data || data.length === 0) return null

  // Show next 6 hours starting from current hour
  const now = new Date()
  const currentHour = now.getHours()
  const upcoming = data.filter(h => {
    const hour = parseInt(h.datetime.split(':')[0], 10)
    return hour >= currentHour
  }).slice(0, 6)

  const hours = upcoming.length > 0 ? upcoming : data.slice(0, 6)

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 3,
      flex: 1,
    }}>
      {hours.map((h, i) => (
        <div key={i} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '2px 10px',
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: 8,
          flex: 1,
        }}>
          <div style={{ fontSize: 18, fontWeight: 500, opacity: 0.6, width: 48, flexShrink: 0 }}>
            {formatHour(h.datetime)}
          </div>
          {weatherIcon(h.icon, 28)}
          <div style={{ fontSize: 22, fontWeight: 600, flexShrink: 0 }}>
            {Math.round(h.temp)}°
          </div>
          {h.precipprob > 20 && (
            <div style={{ fontSize: 16, color: '#78a9ff', fontWeight: 500, marginLeft: 'auto' }}>
              {Math.round(h.precipprob)}%
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Daily forecast cards
function DailyForecast({ data }) {
  if (!data || data.length === 0) return null

  // Skip today, show next 5 days
  const days = data.slice(1, 6)

  return (
    <div style={{
      display: 'flex',
      gap: 8,
      flex: 1,
    }}>
      {days.map((d, i) => (
        <div key={i} style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
          padding: '6px 4px',
          backgroundColor: 'rgba(255,255,255,0.04)',
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '0.05em' }}>
            {formatDay(d.datetime)}
          </div>
          {weatherIcon(d.icon, 48)}
          <div style={{ display: 'flex', gap: 16, fontSize: 26 }}>
            <span style={{ fontWeight: 600 }}>{Math.round(d.tempmax)}°</span>
            <span style={{ opacity: 0.4, fontWeight: 400 }}>{Math.round(d.tempmin)}°</span>
          </div>
          {d.precipprob > 20 && (
            <div style={{ fontSize: 18, color: '#78a9ff', fontWeight: 500 }}>
              {Math.round(d.precipprob)}%
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// Alert banner
function AlertBanner({ alerts }) {
  const [currentIndex, setCurrentIndex] = useState(0)

  useEffect(() => {
    if (!alerts || alerts.length <= 1) return
    const interval = setInterval(() => {
      setCurrentIndex(i => (i + 1) % alerts.length)
    }, 8000)
    return () => clearInterval(interval)
  }, [alerts])

  if (!alerts || alerts.length === 0) return null

  const alert = alerts[currentIndex]

  return (
    <div style={{
      padding: '10px 24px',
      backgroundColor: 'rgba(218, 30, 40, 0.85)',
      color: '#fff',
      fontSize: 17,
      fontWeight: 500,
      display: 'flex',
      alignItems: 'center',
      gap: 12,
    }}>
      <span style={{ fontSize: 22 }}>⚠</span>
      <div style={{ flex: 1 }}>
        <span style={{ fontWeight: 700 }}>{alert.event}</span>
        {alert.headline && (
          <span style={{ opacity: 0.9, marginLeft: 8 }}>
            — {alert.headline}
          </span>
        )}
      </div>
      {alerts.length > 1 && (
        <span style={{ opacity: 0.6, fontSize: 12, flexShrink: 0 }}>
          {currentIndex + 1}/{alerts.length}
        </span>
      )}
    </div>
  )
}

// Sunrise/sunset bar
function SunBar({ data }) {
  if (!data || !data.sunrise) return null

  return (
    <div style={{
      display: 'flex',
      justifyContent: 'center',
      gap: 32,
      padding: '4px 16px',
      fontSize: 16,
      opacity: 0.5,
    }}>
      <span>☀ Sunrise {data.sunrise.slice(0, 5)}</span>
      <span>☽ Sunset {data.sunset.slice(0, 5)}</span>
    </div>
  )
}

export default function WeatherView() {
  const [current, setCurrent] = useState(null)
  const [alerts, setAlerts] = useState([])
  const [hourly, setHourly] = useState([])
  const [daily, setDaily] = useState([])
  const [mqttConnected, setMqttConnected] = useState(false)
  const clientRef = useRef(null)

  useEffect(() => {
    const client = new MqttWeatherClient({
      onWeatherUpdate: (data) => setCurrent(data),
      onAlertUpdate: (data) => setAlerts(data || []),
      onForecastUpdate: ({ type, data }) => {
        if (type === 'hourly') setHourly(data || [])
        if (type === 'daily') setDaily(data || [])
      },
      onConnect: () => setMqttConnected(true),
      onDisconnect: () => setMqttConnected(false),
    })

    client.connect()
    clientRef.current = client

    return () => {
      client.disconnect()
      clientRef.current = null
    }
  }, [])

  if (!current) {
    return (
      <div style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#000',
        color: '#fff',
        fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
        fontSize: 20,
        opacity: 0.4,
      }}>
        {mqttConnected ? 'Waiting for weather data...' : 'Connecting to weather service...'}
      </div>
    )
  }

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#000',
      color: '#fff',
      fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
      userSelect: 'none',
      overflow: 'hidden',
    }}>
      {/* Alert banner */}
      <AlertBanner alerts={alerts} />

      {/* Current conditions hero */}
      <CurrentConditions data={current} />

      {/* Sun times */}
      <SunBar data={current} />

      {/* Divider */}
      <div style={{ height: 1, backgroundColor: 'rgba(255,255,255,0.08)', margin: '2px 24px' }} />

      {/* Bottom half: hourly (left) + daily (right) side by side */}
      <div style={{ flex: 1, display: 'flex', gap: 8, padding: '4px 16px 8px', overflow: 'hidden' }}>
        {/* Hourly column */}
        <div style={{ width: 220, flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.3, paddingLeft: 4, marginBottom: 4 }}>
            Hourly
          </div>
          <HourlyForecast data={hourly} />
        </div>

        {/* Vertical divider */}
        <div style={{ width: 1, backgroundColor: 'rgba(255,255,255,0.08)', alignSelf: 'stretch', margin: '0 4px' }} />

        {/* Daily column */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 14, textTransform: 'uppercase', letterSpacing: '0.1em', opacity: 0.3, paddingLeft: 4, marginBottom: 4 }}>
            5-Day Forecast
          </div>
          <DailyForecast data={daily} />
        </div>
      </div>
    </div>
  )
}
