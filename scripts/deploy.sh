#!/bin/bash
# Deploy voice-display to kiosk device
# Run from the project directory on your Mac
#
# Usage:
#   ./deploy.sh                                    # Deploy to default kiosk
#   KIOSK_HOST=192.168.1.nnn ./deploy.sh           # Deploy to specific host
#   KIOSK_HOST=your-kiosk-hostname ./deploy.sh     # Deploy via hostname

set -e

# Configuration
KIOSK_HOST="${KIOSK_HOST:-YOUR_KIOSK_HOST}"
KIOSK_USER="${KIOSK_USER:-YOUR_USER}"
DEPLOY_DIR="/home/${KIOSK_USER}/voice-display"

echo "=== Deploying Voice Display to Kiosk ==="
echo "Host: $KIOSK_HOST"
echo "User: $KIOSK_USER"
echo "Deploy dir: $DEPLOY_DIR"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Create deployment directory on kiosk
echo "Creating deployment directory..."
ssh "${KIOSK_USER}@${KIOSK_HOST}" "mkdir -p $DEPLOY_DIR/sounds"

# Sync display app (excluding node_modules, use built dist)
echo ""
echo "Building display app..."
cd "$PROJECT_DIR/display"
npm run build

echo ""
echo "Syncing display app..."
rsync -avz --delete \
    --exclude 'node_modules' \
    "$PROJECT_DIR/display/" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/display/"

# Sync voice pipeline
echo ""
echo "Syncing voice pipeline..."
rsync -avz --delete \
    --exclude 'venv' \
    --exclude '__pycache__' \
    --exclude '*.pyc' \
    "$PROJECT_DIR/voice/" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/voice/"

# Sync sounds
echo ""
echo "Syncing sounds..."
rsync -avz --delete \
    "$PROJECT_DIR/sounds/" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/sounds/"

# Sync scripts and systemd files
echo ""
echo "Syncing scripts and services..."
rsync -avz --delete \
    "$PROJECT_DIR/scripts/" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/scripts/"

rsync -avz --delete \
    "$PROJECT_DIR/systemd/" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/systemd/"

# Sync CLAUDE.md for reference
rsync -avz \
    "$PROJECT_DIR/CLAUDE.md" \
    "${KIOSK_USER}@${KIOSK_HOST}:${DEPLOY_DIR}/"

# Install/update on kiosk
echo ""
echo "Installing dependencies on kiosk..."
ssh "${KIOSK_USER}@${KIOSK_HOST}" << EOF
    cd $DEPLOY_DIR

    # Display app dependencies
    cd display
    npm install --production
    cd ..

    # Voice pipeline dependencies (if venv doesn't exist)
    cd voice
    if [ ! -d "venv" ]; then
        python3 -m venv venv
    fi
    source venv/bin/activate
    pip install -r requirements.txt
    deactivate
    cd ..

    # Update systemd services
    sudo cp systemd/*.service /etc/systemd/system/
    sudo systemctl daemon-reload
EOF

echo ""
echo "=== Deployment complete! ==="
echo ""
echo "To start services:"
echo "  ssh $KIOSK_USER@$KIOSK_HOST"
echo "  sudo systemctl start kiosk-display voice-display-ui voice-display-voice"
echo ""
echo "To view logs:"
echo "  journalctl -u kiosk-display -f"
echo "  journalctl -u voice-display-ui -f"
echo "  journalctl -u voice-display-voice -f"
