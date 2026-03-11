#!/bin/bash
# Setup script for Jetson Nano
# Installs dependencies and configures the voice display

set -e

echo "=== Voice Display Setup for Jetson Nano ==="

# Check if running on Jetson
if [ ! -f /etc/nv_tegra_release ]; then
    echo "Warning: This doesn't appear to be a Jetson device"
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "Project directory: $PROJECT_DIR"

# === System Dependencies ===
echo ""
echo "=== Installing system dependencies ==="
sudo apt-get update
sudo apt-get install -y \
    python3-pip \
    python3-venv \
    portaudio19-dev \
    libsndfile1 \
    nodejs \
    npm \
    chromium-browser \
    pulseaudio \
    alsa-utils

# === Python Environment ===
echo ""
echo "=== Setting up Python environment ==="
cd "$PROJECT_DIR/voice"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    python3 -m venv venv
fi

# Activate and install dependencies
source venv/bin/activate
pip install --upgrade pip wheel setuptools

# Install PyTorch for Jetson (CUDA)
# Note: This URL is for JetPack 5.x / L4T R35.x
# Adjust for your specific Jetson version
pip install --no-cache-dir torch torchvision torchaudio \
    --index-url https://developer.download.nvidia.com/compute/redist/jp/v512/pytorch/

# Install other dependencies
pip install -r requirements.txt

deactivate

# === Node.js / Display App ===
echo ""
echo "=== Setting up display app ==="
cd "$PROJECT_DIR/display"

# Install Node.js dependencies
npm install

# Build production bundle
npm run build

# === Chromium Kiosk Setup ===
echo ""
echo "=== Configuring Chromium kiosk ==="

# Create autostart directory
mkdir -p ~/.config/autostart

# Create kiosk autostart entry
cat > ~/.config/autostart/voice-display-kiosk.desktop << 'EOF'
[Desktop Entry]
Type=Application
Name=Voice Display Kiosk
Exec=/home/$USER/voice-display-kiosk.sh
X-GNOME-Autostart-enabled=true
EOF

# Create kiosk launch script
cat > ~/voice-display-kiosk.sh << 'EOF'
#!/bin/bash
# Wait for display and network
sleep 5

# Disable screen blanking
xset s off
xset -dpms
xset s noblank

# Start Chromium in kiosk mode
chromium-browser \
    --kiosk \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --noerrdialogs \
    --disable-translate \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-features=TranslateUI \
    --disk-cache-dir=/tmp/chromium \
    "http://localhost:5174"
EOF

chmod +x ~/voice-display-kiosk.sh

# === Systemd Services ===
echo ""
echo "=== Installing systemd services ==="
sudo cp "$PROJECT_DIR/systemd/voice-display-ui.service" /etc/systemd/system/
sudo cp "$PROJECT_DIR/systemd/voice-display-voice.service" /etc/systemd/system/

# Update service files with correct paths
sudo sed -i "s|/opt/voice-display|$PROJECT_DIR|g" /etc/systemd/system/voice-display-*.service
sudo sed -i "s|User=display|User=$USER|g" /etc/systemd/system/voice-display-*.service

sudo systemctl daemon-reload
sudo systemctl enable voice-display-ui.service
sudo systemctl enable voice-display-voice.service

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "1. Update voice/config.yaml with your server URL and MQTT broker"
echo "2. Start services: sudo systemctl start voice-display-ui voice-display-voice"
echo "3. Or reboot to start automatically"
echo ""
