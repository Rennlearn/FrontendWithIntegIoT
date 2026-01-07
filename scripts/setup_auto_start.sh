#!/bin/bash

# Setup automatic startup for all PillNow services
# This script configures services to start automatically on Mac boot/login

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_DIR="$( cd "$SCRIPT_DIR/.." && pwd )"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

echo "🚀 Setting up automatic startup for PillNow services..."
echo ""

# 1. Setup PM2 to start on boot (for backend and verifier)
echo "1. Configuring PM2 startup..."
if command -v pm2 &> /dev/null; then
    PM2_STARTUP=$(pm2 startup 2>&1 | grep "sudo" || echo "")
    if [ -n "$PM2_STARTUP" ]; then
        echo "   Run this command to enable PM2 startup:"
        echo "   $PM2_STARTUP"
        echo ""
        echo "   Then save PM2 processes:"
        echo "   pm2 save"
    else
        echo "   ✅ PM2 startup already configured"
    fi
else
    echo "   ⚠️  PM2 not found - skipping PM2 startup"
fi

# 2. Create LaunchAgent for auto-config service and other services
echo ""
echo "2. Creating LaunchAgent for auto-config service..."

PLIST_FILE="$LAUNCH_AGENTS_DIR/com.pillnow.autostart.plist"

mkdir -p "$LAUNCH_AGENTS_DIR"

cat > "$PLIST_FILE" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pillnow.autostart</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>$PROJECT_DIR/start-all.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
    <key>StandardOutPath</key>
    <string>$PROJECT_DIR/backend/launchd_autostart.log</string>
    <key>StandardErrorPath</key>
    <string>$PROJECT_DIR/backend/launchd_autostart_error.log</string>
    <key>WorkingDirectory</key>
    <string>$PROJECT_DIR</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    </dict>
</dict>
</plist>
EOF

echo "   ✅ Created LaunchAgent: $PLIST_FILE"

# 3. Load the LaunchAgent
echo ""
echo "3. Loading LaunchAgent..."
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE" 2>/dev/null && echo "   ✅ LaunchAgent loaded successfully" || echo "   ⚠️  Failed to load LaunchAgent (may need to run manually)"

echo ""
echo "========================================="
echo "✅ Automatic startup configured!"
echo "========================================="
echo ""
echo "📋 What was set up:"
echo "   1. LaunchAgent created: $PLIST_FILE"
echo "   2. Services will start automatically on login"
echo ""
echo "🔧 To complete PM2 setup (if needed):"
echo "   1. Run the PM2 startup command shown above"
echo "   2. Run: pm2 save"
echo ""
echo "📝 To manually start services:"
echo "   ./start-all.sh"
echo ""
echo "📝 To stop services:"
echo "   ./stop-all.sh"
echo ""
echo "📝 To disable automatic startup:"
echo "   launchctl unload $PLIST_FILE"
echo ""

