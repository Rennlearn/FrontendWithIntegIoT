# HC-05 Connection Troubleshooting Guide

## 🎯 **Current Status:**
✅ **App is now making REAL Bluetooth connections** (no more simulation!)
❌ **Getting socket timeout error:** `read failed, socket might closed or timeout, read ret: -1`

This error means the app is trying to connect to HC-05 but the connection is timing out.

## 🔍 **Root Cause Analysis:**

The socket timeout error typically occurs when:
1. **HC-05 is not in pairing mode**
2. **HC-05 is already connected to another device**
3. **HC-05 is not properly paired with the phone**
4. **Wrong device address being used**
5. **HC-05 hardware issues**

## 🛠️ **Step-by-Step Troubleshooting:**

### **Step 1: Check HC-05 Status**
1. **Power on Arduino** (with HC-05 connected)
2. **Observe HC-05 LED behavior:**
   - **Fast blinking:** HC-05 is in pairing mode ✅
   - **Slow blinking:** HC-05 is connected to another device ❌
   - **Solid LED:** HC-05 is connected and ready ❌
   - **No LED:** HC-05 is not powered or broken ❌

### **Step 2: Reset HC-05 to Pairing Mode**
If HC-05 LED is not fast blinking:
1. **Disconnect HC-05 power**
2. **Wait 5 seconds**
3. **Reconnect HC-05 power**
4. **HC-05 LED should blink rapidly** (pairing mode)

### **Step 3: Check Phone Bluetooth Settings**
1. **Open phone Bluetooth settings**
2. **Look for HC-05 in paired devices**
3. **If HC-05 is listed:**
   - **Tap on HC-05**
   - **Tap "Forget" or "Unpair"**
   - **This will reset the connection**

### **Step 4: Test with Serial Bluetooth Terminal**
1. **Download "Serial Bluetooth Terminal" from Play Store**
2. **Open the app**
3. **Try to connect to HC-05**
4. **If it connects successfully:**
   - **HC-05 LED should slow down**
   - **Note the exact device name and address**
5. **If it fails:**
   - **HC-05 hardware issue**
   - **Need to reset HC-05**

### **Step 5: Check App Connection Process**
1. **Open PillNow app**
2. **Go to IoT Control screen**
3. **Tap "SCAN & CONNECT"**
4. **Check console logs for:**
   ```
   "Attempting to connect to HC-05: [address]"
   "✅ Successfully connected to HC-05"
   "✅ HC-05 LED should now be slower"
   ```

### **Step 6: Verify Device Address**
1. **In app, check the device address being used**
2. **Compare with Serial Bluetooth Terminal**
3. **Make sure addresses match exactly**

## 🔧 **Common Solutions:**

### **Solution 1: HC-05 Not in Pairing Mode**
**Problem:** HC-05 LED is slow blinking or solid
**Solution:**
1. **Reset HC-05 power**
2. **Wait for fast blinking**
3. **Try connecting again**

### **Solution 2: HC-05 Already Paired**
**Problem:** HC-05 is paired but connection fails
**Solution:**
1. **Unpair HC-05 from phone**
2. **Reset HC-05 to pairing mode**
3. **Try connecting again**

### **Solution 3: Wrong Device Address**
**Problem:** App connects to wrong device
**Solution:**
1. **Use Serial Bluetooth Terminal to find correct address**
2. **Update app to use correct address**
3. **Try connecting again**

### **Solution 4: HC-05 Hardware Issues**
**Problem:** HC-05 doesn't respond to any connection attempts
**Solution:**
1. **Check HC-05 wiring**
2. **Verify HC-05 is powered**
3. **Try different HC-05 module**

## 📱 **Testing Sequence:**

### **Test 1: Basic HC-05 Functionality**
1. **Power on Arduino**
2. **HC-05 LED should blink rapidly**
3. **If not, reset HC-05 power**

### **Test 2: Phone Bluetooth**
1. **Open phone Bluetooth settings**
2. **Scan for devices**
3. **HC-05 should appear in available devices**
4. **If not, HC-05 is not in pairing mode**

### **Test 3: Serial Bluetooth Terminal**
1. **Connect to HC-05 using Serial Bluetooth Terminal**
2. **HC-05 LED should slow down when connected**
3. **Note the device name and address**

### **Test 4: PillNow App**
1. **Open PillNow app**
2. **Try to connect to HC-05**
3. **Check console logs for connection status**
4. **HC-05 LED should slow down when connected**

## 🎯 **Expected Results:**

### **Working Connection:**
- ✅ HC-05 LED blinks rapidly (pairing mode)
- ✅ App can find HC-05 in device list
- ✅ App connects successfully
- ✅ HC-05 LED slows down (connected state)
- ✅ Console shows "Successfully connected"
- ✅ Commands can be sent to Arduino

### **Failed Connection:**
- ❌ HC-05 LED is not fast blinking
- ❌ App cannot find HC-05
- ❌ Connection times out
- ❌ Console shows socket timeout error
- ❌ HC-05 LED remains fast blinking

## 🚨 **Quick Fixes:**

### **Fix 1: Reset Everything**
1. **Unpair HC-05 from phone**
2. **Reset HC-05 power**
3. **Wait for fast blinking**
4. **Try connecting again**

### **Fix 2: Use Serial Bluetooth Terminal First**
1. **Connect to HC-05 using Serial Bluetooth Terminal**
2. **Verify connection works**
3. **Note device details**
4. **Try PillNow app with same device**

### **Fix 3: Check Arduino Code**
1. **Verify Arduino code is running**
2. **Check Serial Monitor for "System Started..."**
3. **Test direct command (type 's' in Serial Monitor)**

## 📋 **Debug Checklist:**

- [ ] HC-05 LED is fast blinking (pairing mode)
- [ ] HC-05 is not connected to another device
- [ ] Phone can see HC-05 in Bluetooth settings
- [ ] Serial Bluetooth Terminal can connect to HC-05
- [ ] Arduino code is running and responding
- [ ] App is using correct device address
- [ ] Console logs show connection attempts
- [ ] HC-05 LED slows down when connected

The key is to get HC-05 into proper pairing mode and ensure it's not already connected to another device! 🚀
