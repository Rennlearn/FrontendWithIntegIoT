# PillNow System Startup Guide

## 🚀 Quick Start (After Laptop Restart)

After your laptop restarts, run this **ONE COMMAND** to start everything:

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./start-all.sh
```

That's it! This will start all services automatically.

---

## 📋 What Gets Started

The `start-all.sh` script automatically starts:

1. ✅ **MQTT Broker (Mosquitto)** - Port 1883
   - Handles communication with ESP32-CAM devices
   - Required for all IoT functionality

2. ✅ **Backend Server** - Port 5001
   - Main API server
   - Handles schedules, alarms, captures
   - Auto-syncs schedules from database on startup

3. ✅ **Verifier Service** - Port 8000
   - Pill detection and verification (YOLO model)
   - Processes ESP32-CAM images

4. ✅ **Arduino Bridge**
   - Forwards MQTT messages to Arduino
   - Arduino sends to app via Bluetooth
   - Required for alarm modals

5. ✅ **ESP32-CAM Auto-Config Service**
   - Monitors your Mac's IP address
   - Auto-updates ESP32-CAM devices when IP changes
   - Prevents "IP changed" errors

---

## 🔧 Step-by-Step Manual Startup (If Needed)

If `start-all.sh` doesn't work, follow these steps:

### Step 1: Start MQTT Broker

```bash
# macOS (Homebrew)
brew services start mosquitto

# Or start directly
mosquitto -d

# Verify it's running
lsof -i :1883
```

### Step 2: Start Backend Server

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"

# Using PM2 (recommended)
pm2 start backend/server.js --name pillnow-backend

# Or directly
node backend/server.js
```

### Step 3: Start Verifier Service

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"

# Using PM2 (recommended)
pm2 start "python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000" --name pillnow-verifier --interpreter python3

# Or directly
python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000
```

### Step 4: Start Arduino Bridge

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
python3 backend/arduino_alert_bridge.py > backend/arduino_bridge_runtime.log 2>&1 &
```

### Step 5: Start ESP32-CAM Auto-Config Service

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./scripts/start_auto_config.sh
```

---

## ✅ Verify Everything is Running

Run this command to check all services:

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./status.sh
```

Or check manually:

```bash
# Check MQTT
lsof -i :1883

# Check Backend
curl http://localhost:5001/test

# Check Verifier
curl http://localhost:8000/health

# Check Bridge
pgrep -f "arduino_alert_bridge.py"

# Check Auto-Config
pgrep -f "auto_update_esp32_config.sh"

# Check PM2 services
pm2 list
```

---

## 🛑 Stop All Services

To stop everything:

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./stop-all.sh
```

Or manually:

```bash
# Stop PM2 services
pm2 stop pillnow-backend
pm2 stop pillnow-verifier

# Stop other services
pkill -f "arduino_alert_bridge.py"
pkill -f "auto_update_esp32_config.sh"

# Stop MQTT (if started with brew)
brew services stop mosquitto
```

---

## 🔍 Troubleshooting

### Issue: "Port 5001 already in use"

**Solution:**
```bash
# Find and kill the process
lsof -ti :5001 | xargs kill -9

# Or restart with start-all.sh (it handles this)
./start-all.sh
```

### Issue: "MQTT broker not running"

**Solution:**
```bash
# Start Mosquitto
brew services start mosquitto

# Or start directly
mosquitto -d

# Verify
lsof -i :1883
```

### Issue: "ESP32-CAM IP changed error"

**Solution:**
The auto-config service should handle this automatically. If not:

```bash
# Restart auto-config service
pkill -f "auto_update_esp32_config.sh"
./scripts/start_auto_config.sh

# Check current Mac IP
ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'

# Manually publish config (if needed)
mosquitto_pub -h 127.0.0.1 -p 1883 -t "pillnow/container1/config" -m '{"mqtt_host":"YOUR_IP","mqtt_port":1883,"backend_host":"YOUR_IP","backend_port":5001}' -r
```

### Issue: "Backend unreachable in app"

**Solution:**
1. Check backend is running: `curl http://localhost:5001/test`
2. Get current Mac IP: `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`
3. In app: Monitor & Manage → Backend IP → Edit → Enter: `http://YOUR_IP:5001`
4. The app will auto-update when IP changes (every 10 seconds)

### Issue: "Alarms not firing"

**Solution:**
1. Check bridge is running: `pgrep -f "arduino_alert_bridge.py"`
2. Check schedules are synced: `curl http://localhost:5001/get-pill-config/container1`
3. Manually sync schedules: `curl -X POST http://localhost:5001/sync-schedules-from-database -H "Content-Type: application/json"`
4. Check backend logs: `pm2 logs pillnow-backend`

---

## 📱 App Configuration

After services are running:

1. **Open the app**
2. **Go to Monitor & Manage screen**
3. **Check Backend IP status** - Should show "Reachable"
   - If "Unreachable", tap "Edit" and enter your Mac's IP
   - The app will auto-update when IP changes
4. **Load schedules** - App will auto-sync to backend

---

## 🔄 Auto-Start on Boot (Optional)

To automatically start services when your laptop boots:

### macOS (using launchd)

1. Create a launch agent:

```bash
cat > ~/Library/LaunchAgents/com.pillnow.startup.plist << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.pillnow.startup</string>
    <key>ProgramArguments</key>
    <array>
        <string>/bin/bash</string>
        <string>/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT/start-all.sh</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <false/>
</dict>
</plist>
EOF
```

2. Load the agent:

```bash
launchctl load ~/Library/LaunchAgents/com.pillnow.startup.plist
```

3. To disable:

```bash
launchctl unload ~/Library/LaunchAgents/com.pillnow.startup.plist
```

---

## 📊 Service Status Check

Create a quick status script:

```bash
cat > status.sh << 'EOF'
#!/bin/bash
echo "=== PillNow Service Status ==="
echo ""
echo "MQTT Broker (1883):"
lsof -i :1883 > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"
echo ""
echo "Backend (5001):"
curl -s http://localhost:5001/test > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"
echo ""
echo "Verifier (8000):"
curl -s http://localhost:8000/health > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"
echo ""
echo "Arduino Bridge:"
pgrep -f "arduino_alert_bridge.py" > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"
echo ""
echo "ESP32-CAM Auto-Config:"
pgrep -f "auto_update_esp32_config.sh" > /dev/null && echo "  ✅ Running" || echo "  ❌ Not running"
echo ""
echo "Current Mac IP:"
ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print "  " $2}' || echo "  Not found"
EOF

chmod +x status.sh
```

---

## 🎯 Quick Reference

| Service | Port | Command to Start | Command to Check |
|--------|------|------------------|------------------|
| MQTT Broker | 1883 | `brew services start mosquitto` | `lsof -i :1883` |
| Backend | 5001 | `pm2 start backend/server.js --name pillnow-backend` | `curl http://localhost:5001/test` |
| Verifier | 8000 | `pm2 start "python3 -m uvicorn..." --name pillnow-verifier` | `curl http://localhost:8000/health` |
| Bridge | - | `python3 backend/arduino_alert_bridge.py &` | `pgrep -f arduino_alert_bridge.py` |
| Auto-Config | - | `./scripts/start_auto_config.sh` | `pgrep -f auto_update_esp32_config.sh` |

---

## 💡 Pro Tips

1. **Always use `start-all.sh`** - It handles everything automatically
2. **Check status first** - Run `./status.sh` before troubleshooting
3. **Check logs** - Most issues are visible in logs:
   - Backend: `pm2 logs pillnow-backend`
   - Verifier: `pm2 logs pillnow-verifier`
   - Bridge: `tail -f backend/arduino_bridge_runtime.log`
   - Auto-Config: `tail -f backend/auto_config_runtime.log`
4. **IP changes are handled automatically** - The auto-config service updates ESP32-CAM devices, and the app auto-updates its backend URL
5. **Schedules auto-sync** - When you load schedules in the app, they're automatically synced to the backend for alarm firing

---

## 🆘 Still Having Issues?

1. **Check all services are running**: `./status.sh`
2. **Check logs for errors**: `pm2 logs` or individual service logs
3. **Restart everything**: `./stop-all.sh && ./start-all.sh`
4. **Verify network**: Make sure your Mac and phone (if using hotspot) are on the same network
5. **Check ESP32-CAM WiFi**: Ensure ESP32-CAM devices are connected to WiFi

---

**Last Updated**: 2026-01-07
**Version**: 1.0

