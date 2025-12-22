#!/bin/bash

# PillNow System Startup Script
# Starts all backend services required for the PillNow IoT system

set -e  # Exit on error

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where this script is located
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# PID file to track running processes
PID_FILE="$SCRIPT_DIR/.pillnow_pids"

# Function to print colored messages
print_status() {
    echo -e "${BLUE}[PillNow]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[PillNow]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[PillNow]${NC} $1"
}

print_error() {
    echo -e "${RED}[PillNow]${NC} $1"
}

# Function to check if a port is in use
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1 ; then
        return 0  # Port is in use
    else
        return 1  # Port is free
    fi
}

# Function to check if a process is running
is_process_running() {
    local pid=$1
    if ps -p $pid > /dev/null 2>&1; then
        return 0  # Process is running
    else
        return 1  # Process is not running
    fi
}

# Function to stop existing services
stop_services() {
    print_status "Checking for existing services..."
    
    if [ -f "$PID_FILE" ]; then
        while read pid service; do
            if is_process_running $pid; then
                print_warning "Stopping existing $service (PID: $pid)..."
                kill $pid 2>/dev/null || true
            fi
        done < "$PID_FILE"
        rm -f "$PID_FILE"
    fi
    
    # Also check for processes by name
    pkill -f "backend/server.js" 2>/dev/null || true
    pkill -f "uvicorn.*verifier.main" 2>/dev/null || true
    pkill -f "arduino_alert_bridge.py" 2>/dev/null || true
    
    sleep 2
}

# Function to start a service and save its PID
start_service() {
    local service_name=$1
    local command=$2
    local port=$3
    
    print_status "Starting $service_name..."
    
    # Check if port is already in use
    if [ ! -z "$port" ] && check_port $port; then
        print_warning "Port $port is already in use. Skipping $service_name..."
        return 1
    fi
    
    # Start the service in background
    eval "$command" > "$SCRIPT_DIR/backend/${service_name}_runtime.log" 2>&1 &
    local pid=$!
    
    # Wait a moment to see if it starts successfully
    sleep 1
    
    if is_process_running $pid; then
        echo "$pid $service_name" >> "$PID_FILE"
        print_success "$service_name started (PID: $pid)"
        return 0
    else
        print_error "$service_name failed to start. Check logs: backend/${service_name}_runtime.log"
        return 1
    fi
}

# Main startup function
main() {
    print_status "========================================="
    print_status "   PillNow System Startup"
    print_status "========================================="
    echo ""
    
    # Stop any existing services
    stop_services
    
    # Check prerequisites
    print_status "Checking prerequisites..."
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed. Please install Node.js first."
        exit 1
    fi
    
    # Check Python3
    if ! command -v python3 &> /dev/null; then
        print_error "Python3 is not installed. Please install Python3 first."
        exit 1
    fi
    
    # Check if MQTT broker is running (Mosquitto)
    if ! check_port 1883; then
        print_warning "MQTT broker (port 1883) is not running."
        print_warning "Please start Mosquitto MQTT broker first:"
        print_warning "  brew services start mosquitto  (macOS)"
        print_warning "  sudo systemctl start mosquitto  (Linux)"
        print_warning "Continuing anyway, but MQTT features may not work..."
    else
        print_success "MQTT broker is running on port 1883"
    fi
    
    echo ""
    print_status "Starting services..."
    echo ""
    
    # Start Backend Server (Node.js)
    start_service "backend" \
        "cd '$SCRIPT_DIR' && node backend/server.js" \
        "5001"
    
    sleep 2
    
    # Start Verifier Service (FastAPI/Python)
    start_service "verifier" \
        "cd '$SCRIPT_DIR' && python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000" \
        "8000"
    
    sleep 2
    
    # Start Arduino Alert Bridge (Python)
    start_service "arduino_bridge" \
        "cd '$SCRIPT_DIR' && python3 backend/arduino_alert_bridge.py" \
        ""
    
    sleep 2
    
    echo ""
    print_status "========================================="
    print_status "   Service Status"
    print_status "========================================="
    echo ""
    
    # Check service status
    if check_port 5001; then
        print_success "✓ Backend Server running on http://localhost:5001"
    else
        print_error "✗ Backend Server not running"
    fi
    
    if check_port 8000; then
        print_success "✓ Verifier Service running on http://localhost:8000"
    else
        print_error "✗ Verifier Service not running"
    fi
    
    if pgrep -f "arduino_alert_bridge.py" > /dev/null; then
        print_success "✓ Arduino Bridge running"
    else
        print_error "✗ Arduino Bridge not running"
    fi
    
    echo ""
    print_status "========================================="
    print_success "All services started!"
    print_status "========================================="
    echo ""
    print_status "To stop all services, run:"
    print_status "  ./stop-all.sh"
    echo ""
    print_status "To check service status, run:"
    print_status "  ./status.sh"
    echo ""
    print_status "Logs are available in:"
    print_status "  - backend/backend_runtime.log"
    print_status "  - backend/verifier_runtime.log"
    print_status "  - backend/arduino_bridge_runtime.log"
    echo ""
}

# Run main function
main

