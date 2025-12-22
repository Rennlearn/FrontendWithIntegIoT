#!/bin/bash

# PillNow System Status Script
# Shows the status of all backend services

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

print_status() {
    echo -e "${BLUE}[PillNow]${NC} $1"
}

print_success() {
    echo -e "${GREEN}✓${NC} $1"
}

print_error() {
    echo -e "${RED}✗${NC} $1"
}

print_status "========================================="
print_status "   PillNow System Status"
print_status "========================================="
echo ""

# Check Backend Server
if check_port 5001; then
    print_success "Backend Server: Running on http://localhost:5001"
else
    print_error "Backend Server: Not running"
fi

# Check Verifier Service
if check_port 8000; then
    print_success "Verifier Service: Running on http://localhost:8000"
else
    print_error "Verifier Service: Not running"
fi

# Check Arduino Bridge
if pgrep -f "arduino_alert_bridge.py" > /dev/null; then
    print_success "Arduino Bridge: Running"
else
    print_error "Arduino Bridge: Not running"
fi

# Check MQTT Broker
if check_port 1883; then
    print_success "MQTT Broker: Running on port 1883"
else
    print_error "MQTT Broker: Not running (required for IoT features)"
fi

echo ""
print_status "========================================="

