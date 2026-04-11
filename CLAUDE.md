# CLAUDE.md - Voice-Controlled Smart Display (Kiosk)

This project builds a voice-controlled smart display that shows the dashboard by default, and responds to voice commands to switch views. Alerts from Frigate, weather, or the alert engine force the display to the dashboard and play an alert chime. Runs on Jetson Nano 2GB (legacy) or Minisforum M1 (primary).

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│          KIOSK DEVICE (Minisforum M1 or Jetson Nano)                │
│  ┌────────────┐   ┌────────────┐   ┌─────────────────────────────┐ │
│  │ Wake Word  │──▶│ Whisper    │──▶│ Intent Resolver             │ │
│  │ (openWW)   │   │ Base/INT8  │   │ (Local pattern matching)    │ │
│  └────────────┘   └────────────┘   └──────────────┬──────────────┘ │
│                                                    │                 │
│  ┌─────────────────────────────────────────────────▼───────────────┐│
│  │              Chromium Kiosk (React Display App)                 ││
│  │   DashboardView (default) | ClockView | WeatherView |           ││
│  │   FrigateView | TimerView | AlertView                           ││
│  └─────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
                              │ REST API
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Dashboard Server                                        │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │         Dashboard server-go                                   │  │
│  │    - Dashboard/Chart/Connection APIs                         │  │
│  │    - SSE Streaming                                           │  │
│  │    - MongoDB database                                        │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

**Note:** The display app connects to the existing dashboard server rather than running a separate backend. This simplifies deployment and allows the voice display to show the same dashboards created in the main dashboard UI.

## Directory Structure

```
├── display/           # React display app (runs in Chromium kiosk)
│   └── src/
│       ├── views/     # ClockView, FrigateView, DashboardView, WeatherView, TimerView
│       ├── components/# Shared components
│       ├── hooks/     # Data fetching hooks
│       ├── api/       # API client
│       ├── services/  # WebSocket command receiver, MQTT client
│       ├── utils/     # Data transforms
│       └── theme/     # Carbon ECharts theme
├── voice/             # Python voice pipeline (runs on kiosk device)
│   ├── main.py        # Main entry point
│   ├── wake_word.py   # openWakeWord detector
│   ├── stt.py         # Whisper speech-to-text
│   ├── intent.py      # Local pattern matching
│   ├── commander.py   # WebSocket command sender + MQTT subscriber
│   ├── vad.py         # Voice activity detection (WebRTC VAD)
│   └── config.yaml    # Pipeline configuration
├── scripts/           # Deployment and setup scripts
├── server/            # Dashboard server config (optional separate instance)
├── systemd/           # Service definitions
└── sounds/            # Alert and alarm audio files
```

## Voice Commands

Wake word: **"Hey Jarvis"**

| Command | Examples | Action |
|---------|----------|--------|
| Show clock | "show the clock", "display time", "go to clock" | Switch to ClockView |
| Show cameras | "show cameras", "display video", "show frigate" | Switch to FrigateView |
| Show dashboard | "show dashboard", "go to dash" | Switch to DashboardView |
| Show weather | "show the weather", "show forecast" | Switch to WeatherView |
| Wake screen | "wake the screen", "turn on display" | Simulate mouse movement |
| Set timer | "set timer for 5 minutes", "timer 2 to 10 minutes" | Create timer in next/specified slot |
| Cancel timer | "cancel timer", "cancel timer 2", "stop all timers" | Remove timer(s), stop alarm |
| Reset timer | "reset timer", "restart timer 1" | Restart timer from original duration |
| Show timers | "show timers", "display timer" | Switch to TimerView |

## Commands

### Display App (React)
```bash
cd display
npm install
npm run dev           # Development server
npm run build         # Production build
```

### Voice Pipeline (Python)
```bash
cd voice
source venv/bin/activate
python main.py        # Run voice pipeline
```

### Systemd Services
```bash
# On kiosk device
sudo systemctl status kiosk-display          # X11 + Chromium (Minisforum only)
sudo systemctl status voice-display-ui       # HTTP server for React app
sudo systemctl status voice-display-voice    # Voice pipeline

sudo journalctl -u voice-display-voice -f   # Watch voice logs
sudo journalctl -u kiosk-display -f         # Watch display logs
```

## Configuration

### Voice Pipeline (voice/config.yaml)

```yaml
wake_word:
  model: "hey_jarvis"      # hey_jarvis, alexa, hey_mycroft
  sensitivity: 0.2         # Lower = more sensitive

whisper:
  model: "base"            # tiny, base, small, medium
  device: "cpu"            # cpu or cuda
  compute_type: "int8"     # int8, float16, float32
  max_recording_duration: 6

audio:
  device_index: null       # null = use system default
```

### Environment Variables (Display)
- `VITE_API_URL` - Backend API URL (default: http://YOUR_DASHBOARD_SERVER:3001)
- `VITE_FRIGATE_URL` - Frigate NVR URL
- `VITE_DASHBOARD_HOST` - Dashboard UI URL (for iframe embedding)
- `VITE_MQTT_WS_URL` - MQTT broker WebSocket URL (for weather data)

## Infrastructure

### Kiosk Device (Minisforum M1) — Primary
- CPU: Intel i9-12950HX, 32GB RAM
- OS: Ubuntu 24.04 LTS Server
- Python: 3.10 via pyenv (tflite-runtime requires <3.12), system Python is 3.12
- Display: X11 + xinit (no desktop environment, no window manager), HDMI to monitor
- Audio: EMEET M0 Plus conference speakerphone (4 AI mics, 360°), ALSA card 1
- Whisper model: base (INT8)

### Kiosk Device (Jetson Nano 2GB) — Legacy
- Display: HDMI connected to monitor
- Audio: EMEET M0 Plus conference speakerphone (4 AI mics, 360°)
- Python: 3.8 (from deadsnakes PPA)
- Whisper model: tiny (INT8)

## Swapping Monitors

The kiosk auto-detects monitor resolution via `xdpyinfo` in `.xinitrc` and passes `--window-size` / `--window-position=0,0` to Chromium. No window manager is running, so `--kiosk` alone won't fullscreen -- the explicit size flags are required.

**When connecting a new monitor:**

1. Restart the kiosk display: `sudo systemctl restart kiosk-display`
2. Verify resolution: `DISPLAY=:0 xrandr` (check the `*+` line for active mode)
3. Verify Chromium fills screen: `DISPLAY=:0 xdotool search --class chromium getwindowgeometry`
4. If the resolution isn't right, check available modes with `xrandr` and optionally force one:
   ```bash
   # In /etc/X11/xorg.conf.d/10-monitor-minisforum.conf, add:
   Section "Monitor"
       Identifier  "HDMI-1"
       Option      "PreferredMode" "1920x1080"
   EndSection
   ```
5. Update `alert_audio_device` in `voice/config.yaml` if ALSA card numbers change (check with `aplay -l`)
6. Restart: `sudo systemctl restart kiosk-display`

**Key files:**
- `~/.xinitrc` -- Chromium launch with dynamic resolution detection
- `/etc/X11/xorg.conf.d/10-monitor-minisforum.conf` -- X11 driver config (modesetting, auto-detect)
- `voice/config.yaml` -- `alert_audio_device` references ALSA card number

## Network Access

- Dashboard API: http://YOUR_DASHBOARD_SERVER:3001
- Display: http://localhost:5174 (dev) or Chromium kiosk (prod)
- Voice WebSocket: ws://localhost:8765 (voice pipeline to display)

## Development

To test locally on Mac:
```bash
cd display
npm install
VITE_API_URL=http://YOUR_DASHBOARD_SERVER:3001 npm run dev
```

Then open http://localhost:5174 in browser. Press 'c' for clock, 'd' for dashboard, 'v' for frigate, 'w' for weather.

## TODO

### Timer View
- [x] Create TimerView for cooking timers
  - Current time displayed at top of screen
  - Up to 3 timers (numbered slots), each in a rounded-edge rectangle, stacked vertically
  - Voice commands: "set timer for X minutes", "cancel timer 2", "reset timer", etc.
  - Expired timers show DONE with red pulse animation, alarm repeats every 15s
  - Keyboard shortcuts: t=60s timer, T=5s timer, x/X=cancel all
- [x] Timer priority behavior:
  - When any timer is active, TimerView becomes the "home" screen
  - Frigate alerts auto-return to TimerView instead of clock
  - "Show clock" temporarily shows clock for 20 seconds, then returns to TimerView
  - Once all timers are cancelled/dismissed, return to normal clock behavior

### Enhancements
- [x] Silence detection to stop recording early (WebRTC VAD with 3-phase state machine)
- [x] Audio feedback (beep) on wake word detection
- [x] Larger Whisper model when migrated to more powerful hardware (base on Minisforum M1)
