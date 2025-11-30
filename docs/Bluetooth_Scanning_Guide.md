# Bluetooth Scanning Guide - How It Works

## 🔍 **How Bluetooth Scanning Works in Your App**

### **When You Tap "SCAN & CONNECT":**

1. **Permission Check** ✅
   - App requests Bluetooth permissions
   - Requests location permissions (required for Bluetooth scanning)
   - Requests connectivity permissions

2. **Bluetooth State Check** ✅
   - Checks if Bluetooth is enabled on your phone
   - If disabled, shows dialog to enable Bluetooth

3. **Device Discovery Process** 🔍
   - **Step 1:** Gets already paired devices (like your HC-05)
   - **Step 2:** Starts scanning for nearby Bluetooth devices
   - **Step 3:** Shows all found devices in a list

4. **Connection Process** 🔗
   - Tap on any device to connect
   - App attempts to establish Bluetooth connection
   - Success/failure feedback provided

## 📱 **What Happens on Your Phone:**

### **Bluetooth Activation:**
- **If Bluetooth is OFF:** App will prompt you to enable it
- **If Bluetooth is ON:** App proceeds with scanning
- **Permission Dialog:** You'll see permission requests for:
  - Bluetooth access
  - Location access (required for device discovery)
  - Connectivity access

### **Device Scanning:**
- **Paired Devices:** Shows devices already paired with your phone
- **New Devices:** Scans for nearby discoverable devices
- **HC-05 Module:** Should appear in the list when powered on
- **Scan Duration:** Takes about 2-3 seconds to complete

### **Device List Display:**
```
Available Devices:
┌─────────────────────────┐
│ 🔵 HC-05                │
│    00:18:E4:34:XX:XX    │
├─────────────────────────┤
│ 🔵 Arduino-BT           │
│    98:D3:31:XX:XX:XX    │
├─────────────────────────┤
│ 🔵 Unknown Device       │
│    12:34:56:78:90:AB    │
└─────────────────────────┘
```

## 🔧 **Expected Behavior:**

### **Successful Scan:**
1. **Tap "SCAN & CONNECT"**
2. **Permission dialogs appear** (if not already granted)
3. **"SCANNING..." text shows** for 2-3 seconds
4. **Device list appears** with available devices
5. **Tap on HC-05** to connect
6. **"Connected to HC-05"** message appears
7. **IoT controls become available**

### **If Bluetooth is Disabled:**
1. **Alert appears:** "Bluetooth Required"
2. **Two options:** Cancel or Enable
3. **Tap "Enable"** → Opens Bluetooth settings
4. **Enable Bluetooth** in phone settings
5. **Return to app** and try again

### **If No Devices Found:**
1. **Empty device list** appears
2. **Check HC-05 is powered on**
3. **Check HC-05 is in pairing mode**
4. **Try scanning again**

## 🎯 **HC-05 Setup for Scanning:**

### **HC-05 Configuration:**
1. **Power on HC-05** (connected to Arduino)
2. **Ensure HC-05 is in pairing mode** (LED should blink rapidly)
3. **HC-05 should be discoverable** (not connected to another device)
4. **Default name:** Usually "HC-05" or "HC-06"
5. **Default PIN:** Usually "1234" or "0000"

### **Arduino Code Requirements:**
Your Arduino code should:
- Initialize HC-05 on pins 2, 3
- Set HC-05 to pairing mode
- Be ready to accept connections
- Respond to commands (s, r, c, TURN ON, TURN OFF)

## 🚀 **Testing the Complete Flow:**

### **Step 1: Prepare Hardware**
1. Wire HC-05 to Arduino (pins 2, 3)
2. Power on Arduino
3. Ensure HC-05 LED is blinking (pairing mode)

### **Step 2: Test App Scanning**
1. Open PillNow app
2. Go to IoT Control screen
3. Tap "SCAN & CONNECT"
4. Grant permissions when prompted
5. Wait for device list to appear
6. Look for "HC-05" in the list

### **Step 3: Test Connection**
1. Tap on "HC-05" device
2. Wait for connection confirmation
3. Test IoT controls (SMS, LED, Buzzer)

## 🔍 **Troubleshooting Scanning Issues:**

### **No Devices Found:**
- Check HC-05 is powered on
- Check HC-05 is in pairing mode
- Try moving closer to the device
- Restart Bluetooth on phone
- Try scanning again

### **Permission Denied:**
- Go to phone Settings → Apps → PillNow
- Grant Bluetooth and Location permissions
- Restart the app

### **Bluetooth Won't Enable:**
- Check phone's Bluetooth settings
- Restart phone if needed
- Check if Bluetooth hardware is working

### **Connection Fails:**
- Ensure HC-05 is not connected to another device
- Check Arduino code is running
- Try disconnecting and reconnecting
- Check HC-05 wiring

## 📋 **Complete Testing Checklist:**

- [ ] App launches without errors
- [ ] IoT Control screen loads
- [ ] "SCAN & CONNECT" button works
- [ ] Bluetooth permissions requested
- [ ] Device scanning starts
- [ ] HC-05 appears in device list
- [ ] Connection to HC-05 succeeds
- [ ] IoT controls become available
- [ ] SMS command works
- [ ] LED/Buzzer controls work
- [ ] No crashes or errors

## 🎉 **Expected Final Result:**

When everything works correctly:
1. **App scans for devices** ✅
2. **HC-05 appears in list** ✅
3. **Connection established** ✅
4. **IoT controls available** ✅
5. **Commands send successfully** ✅
6. **Arduino responds to commands** ✅

Your Bluetooth scanning and IoT control system is now fully functional! 🚀
