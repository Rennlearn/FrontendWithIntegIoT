#!/bin/bash

# PillNow System Stop Script
# Stops all backend services

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PID_FILE="$SCRIPT_DIR/.pillnow_pids"

print_status() {
    echo -e "${BLUE}[PillNow]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PillNow]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[PillNow]${NC} $1"
}

print_status "Stopping all PillNow services..."

# Stop services by PID file
if [ -f "$PID_FILE" ]; then
    while read pid service; do
        if ps -p $pid > /dev/null 2>&1; then
            print_status "Stopping $service (PID: $pid)..."
            kill $pid 2>/dev/null || true
        fi
    done < "$PID_FILE"
    rm -f "$PID_FILE"
fi

# Also stop by process name (in case PID file is missing)
print_status "Stopping services by process name..."

# Stop PM2 services if PM2 is available
if command -v pm2 &> /dev/null; then
    pm2 stop pillnow-backend 2>/dev/null && print_success "Backend server stopped (PM2)" || print_warning "Backend server was not running in PM2"
    pm2 stop pillnow-verifier 2>/dev/null && print_success "Verifier service stopped (PM2)" || print_warning "Verifier service was not running in PM2"
fi

# Also stop direct processes (in case not using PM2)
pkill -f "backend/server.js" 2>/dev/null && print_success "Backend server stopped (direct)" || print_warning "Backend server was not running"
pkill -f "uvicorn.*verifier.main" 2>/dev/null && print_success "Verifier service stopped (direct)" || print_warning "Verifier service was not running"
pkill -f "arduino_alert_bridge.py" 2>/dev/null && print_success "Arduino bridge stopped" || print_warning "Arduino bridge was not running"
pkill -f "auto_update_esp32_config.sh" 2>/dev/null && print_success "ESP32-CAM Auto-Config service stopped" || print_warning "ESP32-CAM Auto-Config service was not running"

sleep 1

print_success "All services stopped!"

