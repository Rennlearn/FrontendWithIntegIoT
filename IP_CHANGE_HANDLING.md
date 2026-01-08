# IP Address Change Handling Guide

## 🎯 Automatic IP Updates (Recommended) ✅

**You don't need to do anything!** The system handles IP changes automatically.

### How It Works

1. **Auto-Config Service** (runs automatically)
   - Monitors your Mac's IP address every 10 seconds
   - Detects when IP changes (e.g., phone hotspot, WiFi reconnect)
   - Publishes config updates via MQTT to all ESP32-CAM devices
   - Config messages are **retained**, so devices get updates even if they reconnect later

2. **ESP32-CAM Firmware** (automatic)
   - Subscribes to config topic: `pillnow/container1/config`
   - Receives IP updates automatically
   - Updates stored IP configuration
   - Reconnects to MQTT with new IP immediately

### What Happens When IP Changes

**Scenario**: Mac IP changes from `10.165.11.91` → `192.168.1.100`

1. **Auto-config detects change** (within 10 seconds)
   ```
   [auto-config] 🔄 IP address changed: 10.165.11.91 -> 192.168.1.100
   [auto-config] Publishing config update: IP=192.168.1.100
   ```

2. **ESP32-CAM receives config** (if online)
   ```
   📨 MQTT MESSAGE RECEIVED
   Topic: pillnow/container1/config
   📥 Received config message — parsing and applying
   🔧 Config changed — applying and reconnecting MQTT immediately
   New MQTT: 192.168.1.100:1883
   🔄 Forcing immediate MQTT reconnection...
   ✅ MQTT connected!
   ✅ New IP configuration is now active!
   ```

3. **ESP32-CAM reconnects** (automatic, within seconds)
   - Disconnects from old MQTT broker
   - Connects to new MQTT broker IP
   - Continues working normally

4. **If ESP32-CAM was offline** (when IP changed)
   - Config message is **retained** by MQTT broker
   - When device reconnects, it receives the latest config immediately
   - Uses new IP automatically

---

## ✅ What You Need to Do

### Nothing! (It's Automatic)

The auto-config service is started automatically by `start-all.sh` and handles everything.

**To verify it's running:**
```bash
./status.sh
# Should show: ✅ ESP32-CAM Auto-Config: ✅ Running
```

**To check what IP is being published:**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v
# Should show current Mac IP in config messages
```

---

## 🔧 Manual Steps (If Needed)

### If Auto-Config Service Stops

**Restart it:**
```bash
./start-all.sh
# Or manually:
./scripts/start_auto_config.sh
```

**Check if running:**
```bash
pgrep -f auto_update_esp32_config.sh
# Should show a PID
```

### If ESP32-CAM Doesn't Update

**Option 1: Wait for config message** (recommended)
- Auto-config publishes every 10 seconds
- ESP32-CAM will receive update when it reconnects
- Config messages are retained, so device gets it even if offline

**Option 2: Force config update**
```bash
# Get current Mac IP
CURRENT_IP=$(ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}')

# Publish config manually
mosquitto_pub -h 127.0.0.1 -t 'pillnow/container1/config' \
  -m "{\"mqtt_host\":\"$CURRENT_IP\",\"mqtt_port\":1883,\"backend_host\":\"$CURRENT_IP\",\"backend_port\":5001}" \
  -r
```

**Option 3: Reflash ESP32-CAM** (last resort)
- Update `MQTT_HOST` and `BACKEND_HOST` in firmware
- Upload to device
- Device will use new compile-time IP

---

## 📋 Verification Checklist

After IP changes:

- [ ] Auto-config service running (`./status.sh`)
- [ ] Auto-config detected IP change (check logs)
- [ ] Config published to MQTT (`mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/config' -v`)
- [ ] ESP32-CAM received config (check Serial Monitor)
- [ ] ESP32-CAM reconnected with new IP (check Serial Monitor)
- [ ] ESP32-CAM online status visible (`mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/status' -v`)
- [ ] Capture works (test from app)

---

## 🔍 Troubleshooting

### Issue: ESP32-CAM Not Updating After IP Change

**Check 1: Auto-config service**
```bash
pgrep -f auto_update_esp32_config.sh
# If not running, start it: ./start-all.sh
```

**Check 2: Config messages published**
```bash
mosquitto_sub -h 127.0.0.1 -t 'pillnow/container1/config' -v
# Should see config with new IP
```

**Check 3: ESP32-CAM receiving config**
- Open Serial Monitor (115200 baud)
- Look for: `📥 Received config message`
- If not receiving: Check ESP32-CAM is subscribed to config topic

**Check 4: ESP32-CAM reconnecting**
- Serial Monitor should show: `🔄 Forcing immediate MQTT reconnection...`
- Should see: `✅ MQTT connected!` with new IP

### Issue: ESP32-CAM Using Wrong IP

**If stored IP is wrong:**
- The firmware fix automatically detects IP mismatch
- Clears old stored IP if it differs from compile-time IP
- Uses compile-time IP to ensure connection

**To manually clear stored IP:**
- Reflash ESP32-CAM (clears Preferences)
- Or wait for config message to update it

### Issue: Multiple Network Interfaces

**If Mac has multiple IPs:**
- Auto-config uses default interface (usually `en0`)
- Check which interface is used: `route get default | grep interface`
- If wrong interface, update `auto_update_esp32_config.sh`:
  ```bash
  # Change line 11 from:
  INTERFACE=$(route get default | grep interface | awk '{print $2}')
  # To:
  INTERFACE="en0"  # or your preferred interface
  ```

---

## 🎯 Best Practices

1. **Keep auto-config service running**
   - Started automatically by `start-all.sh`
   - Runs in background, monitors IP continuously

2. **Use phone hotspot consistently**
   - If using phone hotspot, keep it on same network
   - Auto-config handles IP changes automatically

3. **Check ESP32-CAM Serial Monitor**
   - Monitor for config updates
   - Verify reconnection after IP change

4. **Test after IP change**
   - Trigger capture from app
   - Verify images are received
   - Check backend logs

---

## 📝 Summary

**What happens automatically:**
- ✅ Auto-config detects IP changes
- ✅ Publishes config updates via MQTT
- ✅ ESP32-CAMs receive and apply updates
- ✅ Devices reconnect automatically
- ✅ System continues working

**What you need to do:**
- ✅ **Nothing!** Just ensure `start-all.sh` runs on Mac startup
- ✅ Verify auto-config service is running (`./status.sh`)

**If something goes wrong:**
- Restart auto-config: `./start-all.sh`
- Check ESP32-CAM Serial Monitor
- Verify config messages are published
- Test capture functionality

---

**Last Updated**: 2026-01-08  
**Auto-Config Check Interval**: 10 seconds  
**Config Messages**: Retained (devices get updates even if offline)

