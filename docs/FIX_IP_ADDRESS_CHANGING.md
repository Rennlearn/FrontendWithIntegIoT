# Fix: ESP32-CAM IP Address Changing Issue

## Problem
Your Mac's IP address changes when you reconnect to WiFi or restart, which breaks ESP32-CAM connections because they're hardcoded to a specific IP address.

## Solutions

### Solution 1: Auto-Config Service (Recommended) ✅
**Automatically updates ESP32-CAM devices when your Mac's IP changes**

The auto-config service monitors your Mac's IP address and automatically publishes configuration updates to all ESP32-CAM devices via MQTT.

**How to use:**
```bash
# Start the service manually
./scripts/start_auto_config.sh

# Or it will start automatically when you run:
./start-all.sh
```

**How it works:**
- Monitors your Mac's network interface every 30 seconds
- When IP changes, publishes config updates to `pillnow/container1/config`, `pillnow/container2/config`, `pillnow/container3/config`
- ESP32-CAM devices receive the updates and reconnect with the new IP
- Config messages are retained, so devices get the update even if they reconnect later

**To stop:**
```bash
pkill -f auto_update_esp32_config.sh
```

**To check status:**
```bash
# Check if running
pgrep -f auto_update_esp32_config.sh

# View logs
tail -f backend/auto_config_runtime.log
```

---

### Solution 2: Set Static IP on Mac (Most Reliable) 🔒

**Set a static IP address on your Mac so it never changes:**

1. **System Settings → Network**
2. Select your WiFi connection
3. Click "Details..." → "TCP/IP"
4. Change "Configure IPv4" from "Using DHCP" to "Manually"
5. Enter:
   - **IP Address**: `10.165.11.91` (or your preferred static IP)
   - **Subnet Mask**: `255.255.255.0`
   - **Router**: Your router's IP (usually `10.165.11.1` or `192.168.1.1`)
6. Click "Apply"

**Then update ESP32-CAM code:**
- Change `MQTT_HOST` and `BACKEND_HOST` in `arduino/esp32_cam_client/esp32_cam_client.ino` to your static IP
- Re-upload to ESP32-CAM devices

**Pros:** Most reliable, no service needed
**Cons:** Requires manual network configuration

---

### Solution 3: DHCP Reservation on Router (Best for Production) 🏠

**Reserve a specific IP for your Mac on your router:**

1. Log into your router's admin panel (usually `192.168.1.1` or `10.165.11.1`)
2. Find "DHCP Reservation" or "Static DHCP" settings
3. Add your Mac's MAC address and assign it a fixed IP (e.g., `10.165.11.91`)
4. Save and restart router

**Pros:** Works automatically, no Mac configuration needed
**Cons:** Requires router access

---

### Solution 4: Use Hostname Instead of IP (Advanced) 🌐

**Use mDNS/Bonjour hostname (`lawrences-MacBook-Pro.local`) instead of IP:**

This requires modifying ESP32-CAM code to support mDNS resolution. ESP32 has limited mDNS support, so this is more complex.

---

## Recommended Approach

**For Development:** Use Solution 1 (Auto-Config Service) - it's automatic and requires no manual updates

**For Production:** Use Solution 2 (Static IP) or Solution 3 (DHCP Reservation) for maximum reliability

---

## Testing

After implementing any solution:

1. **Check current IP:**
   ```bash
   ifconfig | grep "inet " | grep -v 127.0.0.1
   ```

2. **Trigger a capture:**
   ```bash
   curl -X POST http://127.0.0.1:5001/trigger-capture/container1 \
     -H "Content-Type: application/json" \
     -d '{"expected": {"count": 0}}'
   ```

3. **Check if images are saved:**
   ```bash
   ls -lt backend/captures/*.jpg | head -5
   ```

4. **Check ESP32-CAM status (if devices are online):**
   ```bash
   mosquitto_sub -h 127.0.0.1 -p 1883 -t "pillnow/+/status" -C 3 -W 5
   ```

