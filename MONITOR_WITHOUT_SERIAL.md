# Monitor ESP32-CAM Without Serial Monitor

## 🎯 How to Verify ESP32-CAM Status Without Serial Monitor

You can monitor everything via **MQTT messages** and **backend logs** - no USB cable needed!

---

## ✅ Method 1: Monitor MQTT Status Messages (Best Method)

### Monitor ESP32-CAM Status

```bash
# Monitor all ESP32-CAM status messages
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v
```

**What you'll see:**

**When ESP32-CAM connects (WiFi OK, MQTT connected):**
```
pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91","mqtt_port":1883,"backend_host":"10.165.11.91","backend_port":5001}
```

**This confirms:**
- ✅ WiFi OK (device connected to WiFi)
- ✅ MQTT connected (device connected to MQTT broker)
- ✅ Current IP configuration (shows in `mqtt_host` and `backend_host`)

**When ESP32-CAM receives config update (IP changes):**
```
# Status message updates with new IP:
pillnow/container1/status {"state":"online","mqtt_host":"192.168.1.100","mqtt_port":1883,"backend_host":"192.168.1.100","backend_port":5001}
```

**This confirms:**
- ✅ Config message received (IP changed in status)
- ✅ Config applied (new IP is active)
- ✅ MQTT reconnected (new status published with new IP)

**Status updates every 30 seconds**, so you'll see the new IP within 30 seconds after config update.

---

## ✅ Method 2: Monitor Config Messages

### See What ESP32-CAM Receives

```bash
# Monitor config messages that ESP32-CAM receives
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v
```

**What you'll see:**

**When auto-config publishes new IP:**
```
pillnow/container1/config {"mqtt_host":"192.168.1.100","mqtt_port":1883,"backend_host":"192.168.1.100","backend_port":5001}
```

**This shows:**
- ✅ Auto-config detected IP change
- ✅ Config published to MQTT
- ✅ What ESP32-CAM will receive

**Note:** Config messages are **retained**, so you'll see the latest config even if ESP32-CAM was offline when it was published.

---

## ✅ Method 3: Monitor Backend Logs

### See ESP32-CAM Activity from Backend

```bash
# Check backend logs for ESP32-CAM activity
pm2 logs pillnow-backend --lines 100
```

**What to look for:**

**ESP32-CAM Online:**
- Status messages received (implicit - if captures work, device is online)

**ESP32-CAM Receiving Commands:**
```
[backend] 📤 Publishing MQTT message:
[backend]    Topic: pillnow/container1/cmd
[backend]    Payload: {"action":"capture",...}
[backend] ✅ MQTT message published successfully to pillnow/container1/cmd
```

**ESP32-CAM Uploading Images:**
```
[backend] 📸 Ingest received for container1
[backend] ✅ Raw capture saved to: backend/captures/container1_xxx.jpg
[backend] 🔍 Verification result for container1:
```

**This confirms:**
- ✅ ESP32-CAM received MQTT command
- ✅ ESP32-CAM captured image
- ✅ ESP32-CAM uploaded image to backend
- ✅ ESP32-CAM has correct IP (couldn't upload without correct IP)

---

## ✅ Method 4: Test Capture Functionality

### Verify Everything Works (Best Verification)

```bash
# Trigger capture from backend
curl -X POST http://localhost:5001/trigger-capture/container1 \
  -H "Content-Type: application/json" \
  -d '{"expected":{"count":1}}'

# Wait 5-8 seconds, then check for new image
ls -lt backend/captures/ | head -3
```

**If image appears:**
- ✅ ESP32-CAM is online
- ✅ WiFi OK (needed to connect)
- ✅ MQTT connected (needed to receive command)
- ✅ Has correct IP (needed to upload image)
- ✅ Config received and applied (if IP changed recently)

**This is the best proof that everything is working!**

---

## 📋 Complete Monitoring Setup

### Terminal 1: Monitor Status Messages

```bash
# Keep this running to see real-time status
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v
```

**Watch for:**
- Initial connection: `{"state":"online","mqtt_host":"10.165.11.91",...}`
- After IP change: `{"state":"online","mqtt_host":"192.168.1.100",...}`

### Terminal 2: Monitor Config Messages

```bash
# See what config is being published
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v
```

**Watch for:**
- Config updates when IP changes
- Current IP in config message

### Terminal 3: Monitor Backend Logs

```bash
# See backend activity
pm2 logs pillnow-backend --follow
```

**Watch for:**
- Capture commands published
- Image uploads received
- Verification results

---

## 🔍 Step-by-Step: Detecting Config Update Without Serial Monitor

### Scenario: IP Changes from `10.165.11.91` → `192.168.1.100`

**Step 1: Monitor Status Messages**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/status' -v
```

**Initial Status (old IP):**
```
pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91",...}
```
✅ ESP32-CAM is online with old IP

**Step 2: IP Changes**
- Auto-config detects IP change (within 10 seconds)
- Auto-config publishes new config to MQTT

**Step 3: Monitor Config Messages**
```bash
# In another terminal:
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/config' -v
```

**You'll see:**
```
pillnow/container1/config {"mqtt_host":"192.168.1.100",...}
```
✅ Config published - ESP32-CAM will receive this

**Step 4: ESP32-CAM Receives Config**
- ESP32-CAM receives config message (you won't see this without Serial Monitor)
- ESP32-CAM applies new IP
- ESP32-CAM reconnects to MQTT

**Step 5: New Status Published**
Back in Terminal 1 (status monitor), you'll see:
```
pillnow/container1/status {"state":"online","mqtt_host":"192.168.1.100",...}
```
✅ **This confirms config was received and applied!**

**Timeline:**
- IP changes → 0 seconds
- Auto-config detects → 0-10 seconds
- Config published → 10 seconds
- ESP32-CAM receives → 10-11 seconds (if online)
- ESP32-CAM reconnects → 11-12 seconds
- New status published → 12-42 seconds (status published every 30 seconds)

**You'll see the new IP in status message within 30 seconds!**

---

## 🎯 Quick Verification Commands

### Check if ESP32-CAM is Online

```bash
# See current status with IP
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/status' -v -W 5
```

**Output shows:**
- `{"state":"online",...}` = ✅ ESP32-CAM is online
- `"mqtt_host":"10.165.11.91"` = Current IP being used
- No output = ❌ ESP32-CAM is offline

### Check Current Config

```bash
# See what config is published
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/config' -v -W 2
```

**Output shows:**
- Current Mac IP in config message
- What ESP32-CAM will receive

### Test Full Functionality

```bash
# Trigger capture and check result
curl -X POST http://localhost:5001/trigger-capture/container1 \
  -H "Content-Type: application/json" \
  -d '{"expected":{"count":1}}'

# Wait 8 seconds
sleep 8

# Check if image received
ls -lt backend/captures/ | head -1
```

**If new image appears:**
- ✅ Everything working correctly
- ✅ ESP32-CAM has correct IP
- ✅ MQTT communication working

---

## 📊 Status Indicators Without Serial Monitor

### ✅ WiFi OK
**Indicator:** ESP32-CAM publishes status messages
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/status' -v
# If you see status messages → WiFi OK
```

### ✅ MQTT Connected
**Indicator:** Status messages show `"state":"online"`
```bash
# Status message contains: {"state":"online",...}
# If you see this → MQTT connected
```

### ✅ Config Message Received
**Indicator:** Status message IP changes to match config
```bash
# Before: {"mqtt_host":"10.165.11.91",...}
# After:  {"mqtt_host":"192.168.1.100",...}
# If IP changes in status → Config received and applied
```

### ✅ Config Applied & Reconnected
**Indicator:** Status message published with new IP
```bash
# New status message with new IP appears
# This confirms device reconnected with new IP
```

---

## 🎯 Summary

**To know ESP32-CAM status WITHOUT Serial Monitor:**

1. **Monitor MQTT status messages:**
   ```bash
   mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v
   ```
   - Shows: WiFi OK, MQTT connected, current IP
   - Updates every 30 seconds
   - IP change visible within 30 seconds

2. **Monitor config messages:**
   ```bash
   mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v
   ```
   - Shows: What config is published
   - Shows: Current Mac IP

3. **Test functionality:**
   ```bash
   # Trigger capture and check if image received
   curl -X POST http://localhost:5001/trigger-capture/container1 ...
   ```
   - If image appears → Everything working ✅

4. **Check backend logs:**
   ```bash
   pm2 logs pillnow-backend
   ```
   - Shows: Capture commands, image uploads, verification

**All of this can be done WITHOUT USB cable connection!**

---

**Last Updated**: 2026-01-08

