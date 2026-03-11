# Voice Display Server
# Uses the dashboard server-go binary with voice-display specific config

# Dashboard server-go location
DASHBOARD_SERVER ?= $(HOME)/Documents/GitHub/dashboard/server-go

# Configuration
CONFIG_DIR = $(CURDIR)/config

.PHONY: build run dev clean help

help:
	@echo "Voice Display Server (using dashboard server-go)"
	@echo ""
	@echo "Commands:"
	@echo "  make build     - Build the server binary"
	@echo "  make run       - Run the server"
	@echo "  make dev       - Run in development mode"
	@echo "  make clean     - Clean build artifacts"
	@echo ""
	@echo "Environment:"
	@echo "  DASHBOARD_SERVER - Path to dashboard server-go (default: ~/Documents/GitHub/dashboard/server-go)"

build:
	@echo "Building server from $(DASHBOARD_SERVER)..."
	cd $(DASHBOARD_SERVER) && go build -o $(CURDIR)/bin/server ./cmd/server

run: build
	@echo "Running voice-display server..."
	cd $(CURDIR) && ./bin/server

dev:
	@echo "Running in development mode..."
	cd $(DASHBOARD_SERVER) && go run ./cmd/server

# Deploy to voice-display host
deploy: build
	@echo "Deploying to voice-display host..."
	ssh <user>@<host> "mkdir -p /opt/voice-display/server"
	scp bin/server <user>@<host>:/opt/voice-display/server/
	scp -r config <user>@<host>:/opt/voice-display/server/
	ssh <user>@<host> "sudo systemctl restart voice-display-server || true"

clean:
	rm -rf bin/
