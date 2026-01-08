# Backend Unreachable in Build App - Fix Guide

## 🔴 Problem

The backend URL shows as "Unreachable" in the Monitor & Manage screen in the build app (APK), even when:
- Backend services are running
- Mac and phone are on the same network
- Backend URL is correct

## ✅ Root Cause

**Android blocks HTTP connections in release builds** by default for security. The app was only configured to allow HTTP in debug builds, not release builds.

## 🔧 Fixes Applied

### 1. Android Network Security Config

**Created**: `android/app/src/main/res/xml/network_security_config.xml`

This file allows HTTP (cleartext) connections to:
- Local network IPs (10.x.x.x, 192.168.x.x, 172.16.x.x)
- Localhost
- All local network addresses

### 2. Updated AndroidManifest.xml

**Added**:
- `android:usesCleartextTraffic="true"` - Allows HTTP connections
- `android:networkSecurityConfig="@xml/network_security_config"` - Uses the security config

### 3. Improved Connection Logic

**Updated**: `app/MonitorManageScreen.tsx`
- Better initial connection handling
- Tests reachability before attempting auto-update
- Falls back to auto-update if initial connection fails

**Updated**: `src/config.ts`
- Better error messages
- Detects HTTP blocking errors
- Provides troubleshooting hints
- Validates URL format

---

## 📋 Steps to Fix

### Step 1: Rebuild APK

After these changes, you **must rebuild the APK**:

```bash
# Using EAS Build (recommended)
eas build --platform android --profile production

# Or local build
cd android
./gradlew clean
./gradlew assembleRelease
```

### Step 2: Verify Mac Services

Ensure all services are running:

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./start-all.sh
./status.sh
```

### Step 3: Get Mac IP Address

```bash
./status.sh
# Note the "Current Mac IP" shown
```

### Step 4: Configure in App

1. Install the new APK
2. Open app → Monitor & Manage
3. Find "Backend" section
4. If status shows "Unreachable":
   - Tap **Edit**
   - Enter: `http://YOUR_MAC_IP:5001`
   - Tap **Save**
5. Status should now show "Reachable" ✅

---

## 🔍 Troubleshooting

### Still Shows "Unreachable" After Fix?

1. **Check Mac Services**:
   ```bash
   ./status.sh
   curl http://localhost:5001/test
   ```

2. **Check Network**:
   - Phone and Mac must be on **same WiFi network**
   - Or use **phone hotspot** (phone creates hotspot, Mac connects)
   - Or use **Mac hotspot** (Mac creates hotspot, phone connects)

3. **Check Firewall**:
   - Mac firewall might be blocking port 5001
   - Temporarily disable firewall to test

4. **Check Backend URL Format**:
   - Must be: `http://IP_ADDRESS:5001`
   - Example: `http://10.165.11.91:5001`
   - No trailing slash

5. **Check Android Logs**:
   ```bash
   adb logcat | grep -i "config\|backend\|network"
   ```
   Look for:
   - `[config] Testing backend reachability`
   - `[config] Backend reachability test`
   - Any HTTP blocking errors

6. **Verify Network Security Config**:
   - Check file exists: `android/app/src/main/res/xml/network_security_config.xml`
   - Check AndroidManifest has: `android:usesCleartextTraffic="true"`

---

## 🎯 Common Issues

### Issue: "Network request failed"

**Possible Causes**:
- Mac services not running
- Wrong IP address
- Different networks
- Firewall blocking

**Solution**:
1. Check services: `./status.sh`
2. Verify IP: `ifconfig en0 | grep "inet "`
3. Ensure same network
4. Check firewall settings

### Issue: "HTTP blocked" or "CLEARTEXT" error

**Cause**: Android still blocking HTTP

**Solution**:
1. Verify `network_security_config.xml` exists
2. Verify AndroidManifest has `usesCleartextTraffic="true"`
3. Rebuild APK (changes require rebuild)
4. Clear app data and reinstall

### Issue: "Timeout" error

**Possible Causes**:
- Backend not responding
- Network latency
- Wrong IP address

**Solution**:
1. Test backend directly: `curl http://YOUR_IP:5001/test`
2. Increase timeout in code (if needed)
3. Check network connection

---

## ✅ Verification Checklist

After applying fixes:

- [ ] Network security config file created
- [ ] AndroidManifest updated with `usesCleartextTraffic`
- [ ] APK rebuilt with changes
- [ ] Mac services running (`./status.sh`)
- [ ] Phone and Mac on same network
- [ ] Backend URL configured in app
- [ ] Status shows "Reachable" ✅

---

## 📝 Technical Details

### Network Security Config

The `network_security_config.xml` allows:
- **Cleartext traffic**: HTTP connections (not just HTTPS)
- **Local network IPs**: 10.x.x.x, 192.168.x.x, 172.16.x.x
- **Localhost**: 127.0.0.1

### Why HTTP is Blocked by Default

Android 9+ (API 28+) blocks HTTP by default for security. This prevents:
- Man-in-the-middle attacks
- Data interception
- Security vulnerabilities

For local development/testing, we allow HTTP to local network IPs.

### Production Considerations

⚠️ **For production**, consider:
- Using HTTPS instead of HTTP
- Setting up proper SSL certificates
- Using a reverse proxy (nginx, etc.)
- Or keeping HTTP only for local network (current setup)

---

## 🚀 Quick Fix Summary

1. ✅ **Fixed**: Android HTTP blocking (network security config)
2. ✅ **Fixed**: AndroidManifest cleartext traffic
3. ✅ **Improved**: Connection error handling
4. ✅ **Improved**: Error messages and troubleshooting

**Next**: Rebuild APK and test!

---

**Last Updated**: 2026-01-07  
**Version**: 1.0

