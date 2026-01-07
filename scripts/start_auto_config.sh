#!/bin/bash

# Start the ESP32-CAM auto-config service
# This will run in the background and update ESP32-CAM devices when IP changes

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR/.."

# Check if already running
if pgrep -f "auto_update_esp32_config.sh" > /dev/null; then
    echo "⚠️  Auto-config service is already running"
    exit 0
fi

# Start the service in background
nohup "$SCRIPT_DIR/auto_update_esp32_config.sh" > backend/auto_config_runtime.log 2>&1 &
PID=$!

echo "✅ ESP32-CAM Auto-Config Service started (PID: $PID)"
echo "   Logs: backend/auto_config_runtime.log"
echo "   To stop: pkill -f auto_update_esp32_config.sh"

