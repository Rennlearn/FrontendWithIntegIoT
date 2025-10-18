# Arduino Hardware Troubleshooting Guide

## 🔍 **Problem: App shows "Command sent" but Arduino LED doesn't turn on**

This means the app is sending commands, but they're not reaching the Arduino hardware properly. Let's troubleshoot this step by step.

## 🧪 **Step-by-Step Troubleshooting:**

### **Step 1: Check Arduino Code is Running**
1. **Open Arduino IDE**
2. **Connect Arduino to computer via USB**
3. **Upload your Arduino code** (the one you provided)
4. **Open Serial Monitor** (Tools → Serial Monitor)
5. **Set baud rate to 9600**
6. **You should see:** `"System Started..."` and `"Bluetooth Connected. Type 's' to send SMS."`

**If you don't see this output:**
- Arduino code is not running
- Re-upload the code
- Check wiring connections

### **Step 2: Test Arduino Directly**
1. **In Serial Monitor, type:** `s` and press Enter
2. **Expected result:** LED should turn on, buzzer should sound
3. **If this works:** Arduino code is correct
4. **If this doesn't work:** Check Arduino code and wiring

### **Step 3: Check HC-05 Bluetooth Module**
1. **Power on Arduino** (with HC-05 connected)
2. **HC-05 LED should be blinking** (indicating it's in pairing mode)
3. **If LED is solid:** HC-05 is connected to another device
4. **If LED is off:** HC-05 is not powered or not working

### **Step 4: Test Bluetooth Connection**
1. **On your phone, go to Bluetooth settings**
2. **Look for HC-05 device** in available devices
3. **Try to pair with HC-05**
4. **If pairing fails:** HC-05 might be connected to another device

### **Step 5: Check App Connection**
1. **Open PillNow app**
2. **Go to IoT Control screen**
3. **Tap "SCAN & CONNECT"**
4. **Look for HC-05 in device list**
5. **Tap on HC-05 to connect**
6. **Check console logs** for connection status

### **Step 6: Test Command Sending**
1. **Once connected to HC-05**
2. **Tap "LED" button in app**
3. **Check console logs** for:
   - `"Sending command 'TURN ON' to HC-05..."`
   - `"Command 'TURN ON' sent successfully via real Bluetooth to HC-05"`
4. **If you see these logs:** Command is being sent
5. **If you don't see these logs:** Connection issue

## 🔧 **Common Issues and Solutions:**

### **Issue 1: HC-05 Not in Pairing Mode**
**Symptoms:** HC-05 LED is solid or off
**Solution:**
1. **Disconnect HC-05 from Arduino**
2. **Press and hold HC-05 button while connecting power**
3. **LED should blink rapidly** (pairing mode)
4. **Reconnect to Arduino**

### **Issue 2: HC-05 Already Connected to Another Device**
**Symptoms:** Can't pair with HC-05 from phone
**Solution:**
1. **Disconnect HC-05 from other devices**
2. **Reset HC-05 to factory settings**
3. **Put HC-05 in pairing mode**

### **Issue 3: Wrong Bluetooth Connection**
**Symptoms:** App connects but commands don't work
**Solution:**
1. **Check if app is connected to correct device**
2. **Disconnect and reconnect**
3. **Try connecting to HC-05 specifically**

### **Issue 4: Arduino Code Not Running**
**Symptoms:** No response from Arduino
**Solution:**
1. **Re-upload Arduino code**
2. **Check Serial Monitor for errors**
3. **Verify wiring connections**

### **Issue 5: Command Format Mismatch**
**Symptoms:** Commands sent but Arduino doesn't respond
**Solution:**
1. **Check Arduino code expects:** `'s'`, `'r'`, `'c'`, `"TURN ON"`, `"TURN OFF"`
2. **Check app sends:** `"TURN ON"`, `"TURN OFF"`, `"s"`, `"r"`, `"c"`
3. **Ensure exact match**

## 📱 **App Debugging Steps:**

### **Check Console Logs:**
1. **Open app developer tools** (if available)
2. **Look for these logs:**
   ```
   "Attempting to connect to HC-05..."
   "Successfully connected to HC-05 via real Bluetooth"
   "Sending command 'TURN ON' to HC-05..."
   "Command 'TURN ON' sent successfully via real Bluetooth to HC-05"
   ```

### **If Logs Show Commands Being Sent:**
- **Problem:** Commands not reaching Arduino
- **Check:** HC-05 connection, Arduino code, wiring

### **If Logs Show Connection Issues:**
- **Problem:** Bluetooth connection not working
- **Check:** HC-05 pairing, app permissions, device compatibility

## 🔌 **Hardware Checklist:**

### **Arduino Setup:**
- [ ] Arduino powered on
- [ ] Code uploaded successfully
- [ ] Serial Monitor shows "System Started..."
- [ ] Direct command test works (type 's' in Serial Monitor)

### **HC-05 Setup:**
- [ ] HC-05 powered on
- [ ] LED blinking (pairing mode)
- [ ] Connected to Arduino pins 2,3
- [ ] Not connected to other devices

### **Phone Setup:**
- [ ] Bluetooth enabled
- [ ] App has Bluetooth permissions
- [ ] Can see HC-05 in device list
- [ ] Successfully connects to HC-05

## 🎯 **Quick Test Sequence:**

1. **Test Arduino directly:** Type 's' in Serial Monitor → LED should turn on
2. **Test HC-05:** Pair with phone → Should connect successfully
3. **Test app connection:** Connect to HC-05 in app → Should show "Connected"
4. **Test app command:** Tap LED button → Should send "TURN ON" command
5. **Check Arduino response:** LED should turn on

## 🚨 **If Nothing Works:**

### **Reset Everything:**
1. **Disconnect all power**
2. **Re-upload Arduino code**
3. **Reset HC-05 to factory settings**
4. **Re-pair HC-05 with phone**
5. **Reconnect app to HC-05**
6. **Test again**

### **Alternative Test:**
1. **Use a simple Bluetooth terminal app** (like "Bluetooth Terminal")
2. **Connect to HC-05**
3. **Send 's' command manually**
4. **Check if Arduino responds**

## 📋 **Expected Results:**

### **Working System:**
- ✅ Arduino Serial Monitor shows "System Started..."
- ✅ HC-05 LED blinks (pairing mode)
- ✅ Phone can pair with HC-05
- ✅ App connects to HC-05 successfully
- ✅ App shows "Connected Successfully!"
- ✅ Tapping LED button sends "TURN ON" command
- ✅ Arduino LED physically turns on
- ✅ Console shows "Command sent successfully"

### **If Any Step Fails:**
- 🔍 **Debug that specific step**
- 🔧 **Check hardware connections**
- 📱 **Verify app permissions and connection**
- 🔄 **Try resetting and reconnecting**

The key is to test each component individually to isolate where the problem is occurring! 🚀
