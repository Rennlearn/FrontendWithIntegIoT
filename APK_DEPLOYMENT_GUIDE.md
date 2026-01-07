# APK Deployment Guide - What Works and What Doesn't

## ✅ YES - The APK Will Work!

The app will work when built into an APK, **BUT** you need to understand what requires the Mac services to be running.

---

## 📱 What Works in the APK (Standalone)

These features work **completely standalone** in the APK:

✅ **All UI and Navigation**
- All screens (Monitor, Set Schedule, Bluetooth, etc.)
- User authentication
- Schedule viewing and management
- Medication management
- Caregiver features

✅ **Database Operations**
- Saving schedules to cloud database
- Loading schedules from cloud database
- User management
- All database-backed features

✅ **Backend URL Auto-Update**
- The app automatically detects Mac IP changes
- Auto-updates backend URL every 10 seconds
- Works in APK just like in dev build
- No manual configuration needed!

✅ **HTTP Polling for Alarms** (Fallback)
- App polls backend for alarm events
- Works when Bluetooth is unavailable
- Alarm modals will still appear

---

## ⚠️ What Requires Mac Services Running

These features **require** the Mac backend services to be running:

### ❌ Won't Work Without Mac Services:

1. **ESP32-CAM Captures**
   - Needs: Backend server (port 5001)
   - Needs: MQTT broker (port 1883)
   - Needs: ESP32-CAM devices connected to WiFi

2. **Pill Verification**
   - Needs: Verifier service (port 8000)
   - Needs: YOLO model files on Mac
   - Needs: Backend server to process images

3. **Alarm Firing from Schedules**
   - Needs: Backend server scheduler
   - Needs: MQTT broker
   - Needs: Arduino bridge (for Bluetooth alarms)

4. **Real-time IoT Communication**
   - Needs: MQTT broker
   - Needs: Arduino bridge
   - Needs: Backend server

---

## 🔧 How It Works

### Architecture:

```
┌─────────────────┐
│   Android APK   │  ← Your mobile app
│  (React Native) │
└────────┬────────┘
         │ HTTP/HTTPS
         │ (connects to Mac IP)
         ▼
┌─────────────────┐
│   Mac Services   │  ← Must be running!
│                 │
│  • Backend      │  Port 5001
│  • Verifier     │  Port 8000
│  • MQTT Broker  │  Port 1883
│  • Arduino Bridge│
│  • Auto-Config  │
└─────────────────┘
         │
         ▼
┌─────────────────┐
│  ESP32-CAM      │  ← IoT devices
│  Arduino        │
└─────────────────┘
```

### Connection Flow:

1. **APK installed on phone**
2. **Mac services running** (via `./start-all.sh`)
3. **App connects to Mac IP** (auto-detected or manually set)
4. **All features work!**

---

## 🚀 Deployment Checklist

Before deploying the APK, ensure:

### ✅ On Your Mac:

1. **All services are running:**
   ```bash
   cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
   ./start-all.sh
   ```

2. **Check status:**
   ```bash
   ./status.sh
   ```

3. **Note your Mac's IP address:**
   - Shown in `./status.sh` output
   - Or: `ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'`

### ✅ In the APK:

1. **First Launch:**
   - App will try default backend URL
   - If unreachable, go to: **Monitor & Manage → Backend IP → Edit**
   - Enter: `http://YOUR_MAC_IP:5001`
   - App will auto-update when IP changes!

2. **Verify Connection:**
   - Check "Backend" status in Monitor & Manage screen
   - Should show "Reachable" (green)

---

## 📋 Step-by-Step: Deploy APK

### Step 1: Build the APK

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"

# Build release APK
npm run android:release

# Or using EAS Build (recommended for production)
eas build --platform android --profile production
```

### Step 2: Start Mac Services

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./start-all.sh
```

### Step 3: Get Mac IP Address

```bash
./status.sh
# Note the "Current Mac IP" shown
```

### Step 4: Install APK on Phone

1. Transfer APK to phone (USB, email, cloud)
2. Enable "Install from Unknown Sources"
3. Install APK

### Step 5: Configure Backend URL in App

1. Open app
2. Go to **Monitor & Manage** screen
3. Find **Backend** section
4. If status shows "Unreachable":
   - Tap **Edit**
   - Enter: `http://YOUR_MAC_IP:5001`
   - Tap **Save**
5. Status should now show "Reachable" ✅

### Step 6: Verify Everything Works

- ✅ Backend status: "Reachable"
- ✅ Load schedules (should work)
- ✅ Save schedules (should work)
- ✅ ESP32-CAM captures (if devices online)
- ✅ Alarms (if schedules synced)

---

## 🔄 Auto-IP Update in APK

**Good News!** The auto-IP update feature works in the APK:

- App polls backend every 10 seconds
- Detects when Mac IP changes
- Auto-updates backend URL
- No manual intervention needed!

**How it works:**
1. App calls `GET /current-ip` on backend
2. Backend returns current Mac IP
3. App compares with last known IP
4. If changed, auto-updates `backend_url_override` in AsyncStorage
5. All API calls use new URL automatically

---

## ⚠️ Important Notes

### 1. Mac Must Be Running

The APK **cannot** run backend services. The Mac must:
- Be powered on
- Have all services running (`./start-all.sh`)
- Be on the same network as the phone (or phone hotspot)

### 2. Network Requirements

- **Same WiFi network**: Mac and phone on same WiFi
- **OR phone hotspot**: Phone creates hotspot, Mac connects to it
- **OR reverse hotspot**: Mac creates hotspot, phone connects

### 3. IP Address Changes

✅ **Handled Automatically!**
- ESP32-CAM Auto-Config service updates devices
- App auto-updates backend URL
- No manual configuration needed

### 4. Port Forwarding (If Needed)

If Mac and phone are on different networks:
- You may need to set up port forwarding on router
- Or use a VPN/tunneling solution
- Or use phone hotspot (easiest)

---

## 🐛 Troubleshooting APK Issues

### Issue: "Backend Unreachable" in APK

**Solution:**
1. Check Mac services are running: `./status.sh`
2. Get Mac IP: Shown in status output
3. In app: Monitor & Manage → Backend IP → Edit → Enter Mac IP
4. Check phone and Mac are on same network

### Issue: "ESP32-CAM not capturing"

**Solution:**
1. Check backend is running: `curl http://localhost:5001/test`
2. Check MQTT broker: `lsof -i :1883`
3. Check ESP32-CAM devices are online
4. Check auto-config service: `pgrep -f auto_update_esp32_config.sh`

### Issue: "Alarms not firing"

**Solution:**
1. Check backend scheduler: `pm2 logs pillnow-backend` (look for schedule logs)
2. Check schedules are synced: `curl http://localhost:5001/get-pill-config/container1`
3. Manually sync: `curl -X POST http://localhost:5001/sync-schedules-from-database`
4. Check bridge is running: `pgrep -f arduino_alert_bridge.py`

### Issue: "App can't connect after Mac restart"

**Solution:**
1. Mac IP may have changed
2. App will auto-detect and update (within 10 seconds)
3. Or manually update: Monitor & Manage → Backend IP → Edit

---

## 📊 Feature Matrix

| Feature | Works in APK? | Requires Mac? | Notes |
|---------|---------------|---------------|-------|
| UI/Navigation | ✅ Yes | ❌ No | Fully standalone |
| Database Operations | ✅ Yes | ❌ No | Connects to cloud DB |
| Schedule Management | ✅ Yes | ❌ No | Saves to cloud DB |
| Backend URL Auto-Update | ✅ Yes | ❌ No | Works in APK! |
| ESP32-CAM Captures | ⚠️ Partial | ✅ Yes | Needs Mac services |
| Pill Verification | ⚠️ Partial | ✅ Yes | Needs verifier service |
| Alarm Firing | ⚠️ Partial | ✅ Yes | Needs backend scheduler |
| Bluetooth Alarms | ⚠️ Partial | ✅ Yes | Needs Arduino bridge |
| HTTP Polling Alarms | ✅ Yes | ✅ Yes | Fallback when BT unavailable |

---

## 🎯 Summary

### ✅ What Works:
- **App UI and features**: 100% standalone
- **Database operations**: Works with cloud DB
- **Backend URL auto-update**: Works in APK!
- **HTTP polling alarms**: Works as fallback

### ⚠️ What Needs Mac:
- **ESP32-CAM captures**: Need backend + MQTT
- **Pill verification**: Need verifier service
- **Alarm firing**: Need backend scheduler
- **IoT communication**: Need MQTT + bridge

### 🚀 Bottom Line:

**The APK will work**, but you need:
1. Mac services running (`./start-all.sh`)
2. Mac and phone on same network
3. Backend URL configured (auto-updates work!)

**The auto-IP update feature works in the APK**, so IP changes are handled automatically!

---

## 📞 Quick Reference

**Start Mac Services:**
```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./start-all.sh
```

**Check Status:**
```bash
./status.sh
```

**Get Mac IP:**
```bash
ifconfig en0 | grep "inet " | grep -v 127.0.0.1 | awk '{print $2}'
```

**In APK:**
- Monitor & Manage → Backend IP → Edit → Enter Mac IP
- App will auto-update when IP changes!

---

**Last Updated**: 2026-01-07  
**Version**: 1.0

