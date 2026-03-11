#!/bin/bash
# Setup Node.js on Jetson Nano (Ubuntu 18.04)
# Run with: sudo ./setup-node.sh
#
# Note: Ubuntu 18.04 has glibc 2.27, so we use Node.js 16 (requires glibc 2.17+)
# Node.js 18+ requires glibc 2.28+ which is not available on Ubuntu 18.04

set -e

echo "=== Installing Node.js 16 on Jetson Nano ==="

# Check if already installed
if command -v node &> /dev/null; then
    echo "Node.js already installed: $(node --version)"
    echo "NPM version: $(npm --version)"
    exit 0
fi

# Clean up any previous NodeSource setup attempts
rm -f /etc/apt/sources.list.d/nodesource.list 2>/dev/null || true

# Install Node.js 16 from NodeSource (last LTS compatible with Ubuntu 18.04)
echo "Downloading NodeSource setup script for Node.js 16..."
curl -fsSL https://deb.nodesource.com/setup_16.x -o /tmp/nodesource_setup.sh

echo "Running NodeSource setup..."
bash /tmp/nodesource_setup.sh

echo "Installing Node.js..."
apt-get install -y nodejs

# Install Python venv if needed
echo "Installing Python3 venv..."
apt-get install -y python3-venv python3-pip

echo ""
echo "=== Installation complete! ==="
echo "Node.js: $(node --version)"
echo "NPM: $(npm --version)"
echo "Python3: $(python3 --version)"
