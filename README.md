# Voice-Controlled Smart Display

A voice-controlled smart display for kitchen/home use. Shows a clock by default and responds to voice commands to switch views.

## Features

- **Wake Word Detection**: "Hey Jarvis" using openWakeWord
- **Speech-to-Text**: Whisper (tiny model, runs on CPU)
- **Local Intent Resolution**: No cloud API required for command recognition
- **Views**: Clock, Frigate cameras, Dashboard

## Hardware

- Jetson Nano 2GB (or any Linux device with microphone)
- USB Speakerphone (EMEET M0 Plus, 4 AI mics 360°)
- HDMI Display

## Quick Start

### 1. Install Dependencies

```bash
# On Jetson/Linux
sudo apt install python3.8 python3.8-venv libportaudio2 xdotool

cd voice
python3.8 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
pip install pyaudio
```

### 2. Configure

Edit `voice/config.yaml`:

```yaml
wake_word:
  model: "hey_jarvis"
  sensitivity: 0.2

whisper:
  model: "tiny"
  device: "cpu"
  compute_type: "int8"
```

### 3. Run

```bash
# Voice pipeline
cd voice
source venv/bin/activate
python main.py

# Display (in another terminal)
cd display
npm install
npm run dev
```

### 4. Install as Services

```bash
sudo cp systemd/*.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable voice-display-ui voice-display-voice
sudo systemctl start voice-display-ui voice-display-voice
```

## Voice Commands

Say "Hey Jarvis" followed by:

| Command | Action |
|---------|--------|
| "show the clock" | Display clock view |
| "show cameras" / "show frigate" | Display camera feeds |
| "show dashboard" | Display dashboard |
| "wake the screen" | Wake display from sleep |

## Architecture

```
Microphone → Wake Word (openWakeWord) → STT (Whisper) → Intent (regex) → WebSocket → Display
```

All processing is local - no cloud APIs required.

## Configuration

See `voice/config.yaml` for all options:

- Wake word model and sensitivity
- Whisper model size and compute type
- Recording duration
- WebSocket port

## Kiosk Display Configuration

The display is configured to stay on 24/7 without sleeping or showing system dialogs.

### Disabled Services

These are disabled via `~/.config/autostart/*.desktop` files with `Hidden=true`:

- `xscreensaver` - Screen saver
- `gnome-screensaver` - GNOME screen saver
- `org.gnome.SettingsDaemon.Power` - GNOME power management (puts monitor to sleep)
- `org.gnome.SettingsDaemon.ScreensaverProxy` - GNOME screensaver proxy

### Removed Packages

- `update-notifier` - Was popping up upgrade dialogs over the kiosk

### Keep Display Awake

Cron job runs every 10 minutes to wiggle the mouse (prevents any remaining sleep triggers):

```bash
#!/bin/bash
DISPLAY=:0 xdotool mousemove_relative 1 1
DISPLAY=:0 xdotool mousemove_relative -- -1 -1
```

```cron
*/10 * * * * /home/<user>/keep-display-awake.sh
```

### Kiosk Autostart

The `~/.config/autostart/voice-display-kiosk.desktop` launches Chromium in kiosk mode with display sleep disabled:

```bash
xset s off && xset -dpms && xset s noblank && chromium-browser --kiosk ...
```

## Troubleshooting

**Wake word not detecting:**
- Check microphone is set as default PulseAudio source
- Try lowering sensitivity in config.yaml
- Check logs: `journalctl -u voice-display-voice -f`

**Audio issues:**
- Verify mic works: `arecord -d 3 test.wav && aplay test.wav`
- Check PulseAudio: `pactl list sources`

**Display not switching:**
- Check WebSocket connection in browser console
- Verify voice service is running: `systemctl status voice-display-voice`

**Display going to sleep:**
- Verify cron job is running: `crontab -l`
- Check for rogue power management: `ps aux | grep -E 'power|screensaver'`
- Re-run xset commands: `xset s off && xset -dpms && xset s noblank`

## License

MIT
