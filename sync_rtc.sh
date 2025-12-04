#!/bin/bash
# Helper script to generate SETTIME command for Arduino RTC

# Get current date and time
Y=$(date +%Y)
M=$(date +%m)
D=$(date +%d)
h=$(date +%H)
m=$(date +%M)
s=$(date +%S)

# Format: SETTIME YYYY-MM-DD HH:MM:SS
COMMAND="SETTIME ${Y}-${M}-${D} ${h}:${m}:${s}"

echo "=== Arduino RTC Sync Command ==="
echo ""
echo "Current time: $(date)"
echo ""
echo "Send this command via:"
echo "  1. Serial Monitor (Arduino IDE)"
echo "  2. Bluetooth from app (use 'Sync RTC' button)"
echo ""
echo "Command:"
echo "  $COMMAND"
echo ""
echo "Copy and paste into Serial Monitor, or use the app's Bluetooth screen."

