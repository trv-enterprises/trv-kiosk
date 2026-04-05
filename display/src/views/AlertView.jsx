import { useState, useEffect } from 'react'

const SEVERITY_COLORS = {
  critical: '#da1e28',
  alert: '#da1e28',
  warning: '#f1c21b',
  info: '#4589ff',
}

const SOURCE_LABELS = {
  alert_engine: 'Sensor',
  frigate: 'Camera',
  weather: 'Weather',
}

function formatRelativeTime(receivedAt) {
  const seconds = Math.floor((Date.now() - receivedAt) / 1000)
  if (seconds < 60) return 'Just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function AlertView({ alerts, active }) {
  // Force re-render every 30s to update relative timestamps
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return
    const interval = setInterval(() => setTick(t => t + 1), 30000)
    return () => clearInterval(interval)
  }, [active])

  return (
    <div style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      backgroundColor: '#000000',
      color: '#ffffff',
      userSelect: 'none',
      fontFamily: "'IBM Plex Sans', 'Helvetica Neue', Arial, sans-serif",
      padding: '40px 60px',
      boxSizing: 'border-box',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        marginBottom: 32,
      }}>
        <span style={{
          fontSize: 36,
          fontWeight: 600,
          letterSpacing: '0.08em',
        }}>
          ACTIVE ALERTS
        </span>
        {alerts.length > 0 && (
          <span style={{
            backgroundColor: '#da1e28',
            color: '#fff',
            borderRadius: '50%',
            width: 40,
            height: 40,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            fontWeight: 700,
          }}>
            {alerts.length}
          </span>
        )}
      </div>

      {/* Alert cards */}
      {alerts.length === 0 ? (
        <div style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#6f6f6f',
          fontSize: 24,
          letterSpacing: '0.05em',
        }}>
          No active alerts
        </div>
      ) : (
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          overflow: 'hidden',
        }}>
          {[...alerts]
            .sort((a, b) => (b.receivedAt || 0) - (a.receivedAt || 0))
            .map(alert => {
              const severityColor = SEVERITY_COLORS[alert.severity] || SEVERITY_COLORS.warning
              const sourceLabel = SOURCE_LABELS[alert.source] || alert.source

              return (
                <div key={alert.rule} style={{
                  display: 'flex',
                  alignItems: 'stretch',
                  backgroundColor: '#262626',
                  borderRadius: 8,
                  overflow: 'hidden',
                  minHeight: 80,
                }}>
                  {/* Severity bar */}
                  <div style={{
                    width: 6,
                    backgroundColor: severityColor,
                    flexShrink: 0,
                  }} />

                  {/* Content */}
                  <div style={{
                    flex: 1,
                    padding: '16px 24px',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    gap: 4,
                  }}>
                    {/* Top row: source badge + device name */}
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                    }}>
                      <span style={{
                        fontSize: 12,
                        fontWeight: 600,
                        letterSpacing: '0.05em',
                        textTransform: 'uppercase',
                        color: severityColor,
                        backgroundColor: `${severityColor}20`,
                        padding: '2px 8px',
                        borderRadius: 4,
                      }}>
                        {sourceLabel}
                      </span>
                      <span style={{
                        fontSize: 20,
                        fontWeight: 600,
                        color: '#f4f4f4',
                      }}>
                        {alert.device || alert.rule}
                      </span>
                    </div>

                    {/* Message */}
                    <div style={{
                      fontSize: 16,
                      color: '#c6c6c6',
                      lineHeight: 1.4,
                    }}>
                      {alert.message}
                    </div>
                  </div>

                  {/* Timestamp */}
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '16px 24px',
                    color: '#8d8d8d',
                    fontSize: 14,
                    flexShrink: 0,
                  }}>
                    {alert.receivedAt ? formatRelativeTime(alert.receivedAt) : ''}
                  </div>
                </div>
              )
            })
          }
        </div>
      )}
    </div>
  )
}
