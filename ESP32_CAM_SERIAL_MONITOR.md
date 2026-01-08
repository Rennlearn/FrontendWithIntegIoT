# ESP32-CAM Serial Monitor - External Power Guide

## 🎯 Problem

When ESP32-CAM is powered by external power supply:
- Device works independently
- **NOT connected to computer via USB**
- **Cannot see Serial Monitor output** directly

## ✅ Solutions

### Solution 1: Connect USB Cable for Monitoring (Recommended)

**You can connect BOTH external power AND USB cable at the same time!**

**How it works:**
- ESP32-CAM can receive power from **external power supply**
- USB cable is connected **only for Serial Monitor communication** (not for power)
- Arduino IDE Serial Monitor will show all debug messages

**Steps:**
1. **Keep external power supply connected** (ESP32-CAM powered via external supply)
2. **Connect USB cable** from ESP32-CAM to your Mac
3. **Open Arduino IDE**
4. **Select correct serial port** (Tools → Port → select ESP32-CAM port)
5. **Open Serial Monitor** (Tools → Serial Monitor)
6. **Set baud rate to 115200**
7. **You'll see all Serial.println() messages** including:
   ```
   WiFi OK
   Connecting MQTT to 10.165.11.91:1883
   ✅ MQTT connected!
   📨 MQTT MESSAGE RECEIVED
   Topic: pillnow/container1/config
   📥 Received config message — parsing and applying
   ```

**Note:** 
- USB cable provides **communication only** (not power)
- External power supply provides **actual power**
- This is safe and recommended for monitoring

---

### Solution 2: Monitor via MQTT Status Messages

**Even without USB, you can verify ESP32-CAM is working:**

```bash
# Monitor ESP32-CAM status messages
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v
```

**You'll see:**
```
pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91","mqtt_port":1883,...}
```

**What this tells you:**
- ✅ ESP32-CAM is online
- ✅ Connected to WiFi
- ✅ Connected to MQTT
- ✅ Current IP configuration

**To see config messages being received:**
- ESP32-CAM publishes status after receiving config
- Status message shows current `mqtt_host` and `backend_host`
- If IP changes, you'll see it in the next status message

---

### Solution 3: Check Backend Logs

**Backend logs show when ESP32-CAMs connect and capture:**

```bash
# Check backend logs
pm2 logs pillnow-backend --lines 50

# Look for:
# - ESP32-CAM online status
# - Capture commands being sent
# - Image uploads received
```

**You'll see:**
```
[backend] 📤 Publishing MQTT message:
[backend] ✅ MQTT message published successfully to pillnow/container1/cmd
[backend] 📸 Ingest received for container1
[backend] ✅ Image saved to: backend/captures/container1_xxx.jpg
```

---

### Solution 4: Use ESP32-CAM Web Server (Optional)

**If your ESP32-CAM firmware includes a web server:**
- You can access it via web browser at `http://ESP32_CAM_IP`
- View status and logs via web interface
- Not available in current firmware, but can be added

---

## 🔍 Verifying Config Updates Without Serial Monitor

### Method 1: Check MQTT Status Messages

```bash
# Monitor ESP32-CAM status (shows current IP)
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/status' -v
```

**When IP changes:**
1. Auto-config publishes new config
2. ESP32-CAM receives config (you won't see this without USB)
3. ESP32-CAM publishes new status with updated IP
4. **You'll see the new IP in status message!**

**Example:**
```
# Before IP change:
pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91",...}

# After IP change (ESP32-CAM reconnects):
pillnow/container1/status {"state":"online","mqtt_host":"192.168.1.100",...}
```

### Method 2: Test Capture Functionality

**If captures work, ESP32-CAM has correct IP:**

```bash
# Trigger capture
curl -X POST http://localhost:5001/trigger-capture/container1 \
  -H "Content-Type: application/json" \
  -d '{"expected":{"count":1}}'

# Check if image received
ls -lt backend/captures/ | head -3
```

**If image appears:**
- ✅ ESP32-CAM is online
- ✅ Has correct IP
- ✅ Receiving MQTT commands
- ✅ Uploading images

---

## 📋 Recommended Setup

### For Development/Debugging:
```
ESP32-CAM ──USB──> Mac (for Serial Monitor)
     └──External Power Supply
```

**Benefits:**
- See all Serial Monitor messages
- Real-time debugging
- Verify config updates immediately

### For Production/Deployment:
```
ESP32-CAM ──External Power Supply only
     └──(No USB cable)
```

**Monitor via:**
- MQTT status messages (`mosquitto_sub`)
- Backend logs (`pm2 logs`)
- Test captures (verify functionality)

---

## 🔧 How to See Config Messages

### With USB Connected:

**Arduino IDE Serial Monitor (115200 baud):**
```
WiFi OK
Connecting MQTT to 10.165.11.91:1883
✅ MQTT connected!
📡 Subscribing to config: pillnow/container1/config
✅ Config subscription successful

[Later, when IP changes...]

📨 MQTT MESSAGE RECEIVED
Topic: pillnow/container1/config
Payload: {"mqtt_host":"192.168.1.100","mqtt_port":1883,...}
📥 Received config message — parsing and applying
🔧 Config changed — applying and reconnecting MQTT immediately
New MQTT: 192.168.1.100:1883
🔄 Forcing immediate MQTT reconnection...
✅ MQTT connected!
✅ New IP configuration is now active!
```

### Without USB (MQTT Monitoring):

**Monitor status messages:**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/status' -v
```

**You'll see:**
```
# Initial connection:
pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91",...}

# After config update (ESP32-CAM reconnects):
pillnow/container1/status {"state":"online","mqtt_host":"192.168.1.100",...}
# ^ This confirms config was received and applied!
```

**Monitor config topic:**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/config' -v
```

**You'll see:**
```
pillnow/container1/config {"mqtt_host":"192.168.1.100","mqtt_port":1883,...}
# ^ This is what ESP32-CAM receives
```

---

## 🎯 Summary

**To see Serial Monitor output:**

1. **Connect USB cable** (even with external power)
   - USB provides communication only
   - External power supply provides actual power
   - Arduino IDE Serial Monitor will work

2. **Or monitor via MQTT:**
   - Check status messages: `mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v`
   - Check config messages: `mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v`
   - Check backend logs: `pm2 logs pillnow-backend`

3. **Verify by testing:**
   - Trigger capture from app
   - Check if images received
   - If working, ESP32-CAM has correct IP and is online

---

**Best Practice:**
- During setup/testing: Use USB cable + external power (see Serial Monitor)
- In production: Use external power only (monitor via MQTT/backend logs)

---

**Last Updated**: 2026-01-08

