# ESP32-CAM Not Capturing - Complete Fix Guide

## 🔍 Diagnostic Results

### ✅ Working Components
- **Mac IP**: 10.165.11.91 ✅
- **All Services**: Running ✅
  - MQTT Broker (port 1883) ✅
  - Backend Server (port 5001) ✅
  - Verifier Service (port 8000) ✅
  - Auto-Config Service ✅
- **Backend Publishing**: MQTT commands being sent ✅
- **Auto-Config**: Publishing correct IP (10.165.11.91) ✅
- **MQTT Broker**: Working ✅

### ❌ Issues Found
- **ESP32-CAMs Offline**: No status messages received
- **No Recent Images**: Last uploads from Jan 8 02:00 (old)
- **WiFi Credentials**: Still placeholders in firmware

## 🎯 Root Cause

**ESP32-CAMs cannot connect because:**
1. WiFi credentials are placeholders (`YOUR_WIFI_SSID`, `YOUR_WIFI_PASSWORD`)
2. Without WiFi, devices cannot connect to MQTT
3. Without MQTT, devices cannot receive capture commands
4. Without capture commands, no images are captured/uploaded

## 🔧 Fix Steps

### Step 1: Configure WiFi Credentials (CRITICAL)

**File**: `arduino/esp32_cam_client/esp32_cam_client.ino`

**Lines 16-17**:
```cpp
static const char* WIFI_SSID = "YOUR_WIFI_SSID";      // <-- CHANGE THIS
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";  // <-- CHANGE THIS
```

**Action**:
1. Open Arduino IDE
2. Open `arduino/esp32_cam_client/esp32_cam_client.ino`
3. Replace with your actual WiFi credentials:
   ```cpp
   static const char* WIFI_SSID = "YourActualWiFiName";
   static const char* WIFI_PASS = "YourActualWiFiPassword";
   ```
4. For each ESP32-CAM:
   - Update `DEVICE_ID` (line 28) to: `container1`, `container2`, or `container3`
   - Upload code to device

### Step 2: Verify Connection

**After reflashing, check Serial Monitor (115200 baud):**

**Expected Output**:
```
Connecting WiFi...
WiFi OK
Connecting MQTT to 10.165.11.91:1883
✅ MQTT connected!
📡 Subscribing to: pillnow/container1/cmd
✅ Subscription successful
📡 Subscribing to config: pillnow/container1/config
✅ Config subscription successful
📥 Received config message — parsing and applying
✅ New IP configuration is now active!
📤 Published online status + config
```

**If you see errors:**
- `WiFi FAIL` → WiFi credentials wrong
- `MQTT connection FAILED` → Check MQTT broker IP, network connectivity
- `TCP test: FAILED` → Backend not reachable from ESP32-CAM

### Step 3: Test Capture

**Once devices are online:**

1. **Check ESP32-CAM Status**:
   ```bash
   mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v
   ```
   Should see:
   ```
   pillnow/container1/status {"state":"online","mqtt_host":"10.165.11.91",...}
   ```

2. **Trigger Capture from App**:
   - Open app → Monitor & Manage
   - Tap "Capture" for a container
   - Check backend logs: `pm2 logs pillnow-backend`

3. **Check ESP32-CAM Serial Output**:
   Should see:
   ```
   📨 MQTT MESSAGE RECEIVED
   Topic: pillnow/container1/cmd
   ✅ CAPTURE COMMAND RECEIVED - Starting capture...
   📸 Starting capture sequence...
   📤 Uploading image to http://10.165.11.91:5001/ingest/container1/container1...
   ✅ Image uploaded successfully
   ```

4. **Check Backend Logs**:
   ```bash
   pm2 logs pillnow-backend --lines 50
   ```
   Should see:
   ```
   [backend] 📥 Received image upload from container1
   [backend] ✅ Image saved to: backend/captures/container1_xxx.jpg
   ```

5. **Check Images**:
   ```bash
   ls -lt backend/captures/ | head -5
   ```

## 🔍 Troubleshooting

### Issue: ESP32-CAM Still Not Online

**Check 1: WiFi Connection**
- Serial Monitor should show: `WiFi OK`
- If `WiFi FAIL`: Check SSID/password, ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)

**Check 2: MQTT Connection**
- Serial Monitor should show: `✅ MQTT connected!`
- If connection fails: Check MQTT broker IP (should be Mac IP: 10.165.11.91)
- Test: `ping 10.165.11.91` from another device on same network

**Check 3: Network Connectivity**
- ESP32-CAM and Mac must be on same WiFi network
- Or use phone hotspot (phone creates hotspot, Mac connects)
- Check firewall: Mac firewall might block port 1883

### Issue: Capture Commands Not Received

**Check 1: MQTT Subscription**
- Serial Monitor should show: `✅ Subscription successful`
- Check topic: Should be `pillnow/container1/cmd` (or container2/container3)

**Check 2: Backend Publishing**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/cmd' -v
```
Then trigger capture from app. Should see:
```
pillnow/container1/cmd {"action":"capture","container":"container1",...}
```

**Check 3: ESP32-CAM Receiving**
- Serial Monitor should show: `📨 MQTT MESSAGE RECEIVED`
- If not: Check ESP32-CAM is subscribed to correct topic

### Issue: Images Not Uploading

**Check 1: Backend Reachable**
- ESP32-CAM Serial Monitor: `HTTP connect failed` → Backend not reachable
- Check backend IP in ESP32-CAM: Should be `10.165.11.91`
- Test: `curl http://10.165.11.91:5001/test` from another device

**Check 2: Backend Logs**
```bash
pm2 logs pillnow-backend | grep -i "ingest\|upload"
```
- Should see: `📥 Received image upload`
- If not: ESP32-CAM not uploading (check Serial Monitor)

**Check 3: HTTP Upload**
- ESP32-CAM Serial Monitor should show: `✅ Image uploaded successfully`
- If fails: Check backend IP, network connectivity, firewall

## 📋 Quick Diagnostic Commands

```bash
# 1. Check all services
./status.sh

# 2. Check ESP32-CAM status
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v

# 3. Check MQTT commands
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/cmd' -v

# 4. Check backend logs
pm2 logs pillnow-backend --lines 50

# 5. Check recent images
ls -lt backend/captures/ | head -5

# 6. Test backend endpoint
curl -X POST http://localhost:5001/trigger-capture/container1 \
  -H "Content-Type: application/json" \
  -d '{"expected":{"count":1}}'

# 7. Check auto-config
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v
```

## ✅ Verification Checklist

After fixing WiFi credentials:

- [ ] ESP32-CAM Serial Monitor shows: `WiFi OK`
- [ ] ESP32-CAM Serial Monitor shows: `✅ MQTT connected!`
- [ ] ESP32-CAM Serial Monitor shows: `✅ Subscription successful`
- [ ] ESP32-CAM status messages visible: `mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v`
- [ ] Auto-config config received: `📥 Received config message`
- [ ] Capture command received: `📨 MQTT MESSAGE RECEIVED` with `capture` action
- [ ] Image captured: `📸 Starting capture sequence...`
- [ ] Image uploaded: `✅ Image uploaded successfully`
- [ ] Backend received: `📥 Received image upload` in logs
- [ ] Image saved: `ls backend/captures/` shows new files

## 🚨 Still Not Working?

1. **Check ESP32-CAM Serial Output** (most important!)
   - Connect ESP32-CAM via USB
   - Open Serial Monitor (115200 baud)
   - Look for error messages

2. **Verify Network**
   - ESP32-CAM and Mac on same WiFi
   - Test: `ping 10.165.11.91` from another device

3. **Check Firewall**
   - Mac firewall might block ports 1883, 5001
   - Temporarily disable to test

4. **Restart Services**
   ```bash
   ./stop-all.sh
   ./start-all.sh
   ```

5. **Check Auto-Config**
   ```bash
   pgrep -f auto_update_esp32_config.sh
   # Should show PID
   ```

---

**Last Updated**: 2026-01-08  
**Current Mac IP**: 10.165.11.91  
**Status**: ESP32-CAMs offline - WiFi credentials need configuration

