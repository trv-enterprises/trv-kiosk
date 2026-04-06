#!/bin/bash
# Setup script for Minisforum M1 (Ubuntu 24.04 Server)
# One-time setup for the voice-controlled kiosk
#
# Run as root: sudo bash setup-minisforum.sh
#
# This covers: Tailscale, system packages, Node.js 20, user setup,
# X11 kiosk config, Python venv, systemd services, and cron job.

set -e

KIOSK_USER="${KIOSK_USER:-$USER}"
DEPLOY_DIR="/home/${KIOSK_USER}/voice-display"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Minisforum M1 Kiosk Setup ==="
echo "Target user: $KIOSK_USER"
echo "Deploy dir:  $DEPLOY_DIR"
echo ""

# Must run as root
if [ "$EUID" -ne 0 ]; then
    echo "Error: Please run as root (sudo bash setup-minisforum.sh)"
    exit 1
fi

# ─────────────────────────────────────────────
# Tailscale
# ─────────────────────────────────────────────
echo "=== Installing Tailscale ==="
if ! command -v tailscale &> /dev/null; then
    curl -fsSL https://tailscale.com/install.sh | sh
    echo ""
    echo "Tailscale installed. Starting authentication..."
    echo "Complete the auth URL in your browser, then press Enter to continue."
    tailscale up
    echo ""
    echo "Tailscale IP: $(tailscale ip -4)"
    read -p "Press Enter to continue after noting the Tailscale IP..." _
else
    echo "Tailscale already installed. IP: $(tailscale ip -4)"
fi

# ─────────────────────────────────────────────
# System packages
# ─────────────────────────────────────────────
echo ""
echo "=== Installing system packages ==="
apt-get update
apt-get install -y \
    xorg xinit xdotool \
    chromium-browser \
    pulseaudio alsa-utils \
    python3-venv python3-pip python3-dev \
    portaudio19-dev libsndfile1 \
    mpv \
    curl wget git openssh-server

# ─────────────────────────────────────────────
# Node.js 20 LTS
# ─────────────────────────────────────────────
echo ""
echo "=== Installing Node.js 20 LTS ==="
if ! command -v node &> /dev/null || ! node --version | grep -q "^v20"; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
fi
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"

# ─────────────────────────────────────────────
# User setup
# ─────────────────────────────────────────────
echo ""
echo "=== Configuring user ==="
if ! id "$KIOSK_USER" &> /dev/null; then
    useradd -m -s /bin/bash "$KIOSK_USER"
    echo "Created user $KIOSK_USER"
fi

usermod -aG audio,video,tty "$KIOSK_USER"
echo "User groups: $(id -nG $KIOSK_USER)"

# Enable linger so PulseAudio user service starts at boot
loginctl enable-linger "$KIOSK_USER"
echo "Linger enabled for $KIOSK_USER"

# ─────────────────────────────────────────────
# X11 kiosk configuration
# ─────────────────────────────────────────────
echo ""
echo "=== Configuring X11 kiosk ==="

# Xorg monitor config
mkdir -p /etc/X11/xorg.conf.d
if [ -f "$SCRIPT_DIR/10-monitor-minisforum.conf" ]; then
    cp "$SCRIPT_DIR/10-monitor-minisforum.conf" /etc/X11/xorg.conf.d/
    echo "Copied monitor config to /etc/X11/xorg.conf.d/"
else
    echo "Warning: 10-monitor-minisforum.conf not found in $SCRIPT_DIR"
fi

# Allow xinit from systemd (non-console user)
cat > /etc/X11/Xwrapper.config << 'EOF'
allowed_users=anybody
needs_root_rights=yes
EOF
echo "Set Xwrapper.config: allowed_users=anybody"

# Create .xinitrc for kiosk user
# Note: No window manager runs, so --kiosk alone won't fullscreen.
# We detect resolution dynamically and pass explicit --window-size.
cat > /home/${KIOSK_USER}/.xinitrc << 'EOF'
#!/bin/sh
# Disable screen blanking and power management
xset s off
xset -dpms
xset s noblank

# Get screen resolution dynamically (works with any monitor)
SCREEN_RES=$(xdpyinfo | grep dimensions | awk '{print $2}')
WIDTH=$(echo $SCREEN_RES | cut -dx -f1)
HEIGHT=$(echo $SCREEN_RES | cut -dx -f2)

# Launch Chromium fullscreen at exact screen resolution
exec chromium-browser \
    --kiosk \
    --start-fullscreen \
    --window-size=${WIDTH},${HEIGHT} \
    --window-position=0,0 \
    --disable-infobars \
    --noerrdialogs \
    --disable-session-crashed-bubble \
    --disable-translate \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-features=TranslateUI,BackForwardCache \
    --disk-cache-dir=/tmp/chromium \
    http://localhost:5174
EOF
chown ${KIOSK_USER}:${KIOSK_USER} /home/${KIOSK_USER}/.xinitrc
chmod +x /home/${KIOSK_USER}/.xinitrc
echo "Created /home/${KIOSK_USER}/.xinitrc"

# ─────────────────────────────────────────────
# Deployment directory
# ─────────────────────────────────────────────
echo ""
echo "=== Creating deployment directory ==="
sudo -u "$KIOSK_USER" mkdir -p "$DEPLOY_DIR/sounds"
echo "Created $DEPLOY_DIR"

# ─────────────────────────────────────────────
# Python virtual environment
# ─────────────────────────────────────────────
echo ""
echo "=== Setting up Python venv ==="
if [ ! -d "$DEPLOY_DIR/voice/venv" ]; then
    sudo -u "$KIOSK_USER" mkdir -p "$DEPLOY_DIR/voice"
    sudo -u "$KIOSK_USER" python3 -m venv "$DEPLOY_DIR/voice/venv"
    echo "Created Python venv at $DEPLOY_DIR/voice/venv"
else
    echo "Python venv already exists"
fi

# ─────────────────────────────────────────────
# Systemd services
# ─────────────────────────────────────────────
echo ""
echo "=== Installing systemd services ==="
SYSTEMD_SRC="$(dirname "$SCRIPT_DIR")/systemd"
if [ -d "$SYSTEMD_SRC" ]; then
    cp "$SYSTEMD_SRC"/*.service /etc/systemd/system/
    systemctl daemon-reload
    systemctl enable voice-display-ui.service
    systemctl enable voice-display-voice.service
    systemctl enable kiosk-display.service
    echo "Systemd services installed and enabled"
else
    echo "Warning: systemd directory not found at $SYSTEMD_SRC"
    echo "Services will be installed during deployment"
fi

# ─────────────────────────────────────────────
# Cron job: mouse wiggle to prevent display sleep
# ─────────────────────────────────────────────
echo ""
echo "=== Setting up mouse wiggle cron ==="
CRON_LINE="*/10 * * * * DISPLAY=:0 xdotool mousemove_relative 1 0 && sleep 0.1 && DISPLAY=:0 xdotool mousemove_relative -- -1 0"
(crontab -u "$KIOSK_USER" -l 2>/dev/null | grep -v "xdotool mousemove"; echo "$CRON_LINE") | crontab -u "$KIOSK_USER" -
echo "Mouse wiggle cron installed (every 10 min)"

# ─────────────────────────────────────────────
# Done
# ─────────────────────────────────────────────
echo ""
echo "=== Setup complete! ==="
echo ""
echo "Tailscale IP: $(tailscale ip -4 2>/dev/null || echo 'not configured')"
echo ""
echo "Next steps:"
echo "  1. Note the Tailscale IP"
echo "  2. Deploy kiosk code via deploy.sh or your deployment tool"
echo "  3. Start services:"
echo "     sudo systemctl start kiosk-display voice-display-ui voice-display-voice"
echo "  4. Verify display: Chromium should show clock on HDMI"
echo "  5. Verify audio: pactl list sources short (look for EMEET)"
echo ""
