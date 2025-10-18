# Real IoT Hardware Control Guide

## 🎯 **Now You Can Actually Control Your Arduino Hardware!**

The app now uses **real Bluetooth communication** to control your IoT hardware. Here's how to test it:

## 🔧 **Hardware Setup Required:**

### **1. Arduino Setup:**
- **Upload your Arduino sketch** (the one you provided)
- **Wire HC-05 to Arduino:**
  ```
  HC-05 VCC → Arduino 5V
  HC-05 GND → Arduino GND
  HC-05 TX  → Arduino Pin 2 (RX)
  HC-05 RX  → Arduino Pin 3 (TX)
  ```
- **Wire LED and Buzzer:**
  ```
  LED Anode (+) → 220Ω Resistor → Arduino Pin 8
  LED Cathode (-) → Arduino GND
  Buzzer (+) → Arduino Pin 7
  Buzzer (-) → Arduino GND
  ```
- **Wire SIM800L:**
  ```
  SIM800L VCC → Arduino 5V
  SIM800L GND → Arduino GND
  SIM800L TX  → Arduino Pin 10 (RX)
  SIM800L RX  → Arduino Pin 11 (TX)
  ```

### **2. HC-05 Pairing:**
1. **Power on Arduino** (HC-05 should blink rapidly)
2. **On your phone:** Go to Settings → Bluetooth
3. **Scan for devices** and find "HC-05"
4. **Pair with HC-05** (PIN is usually "1234" or "0000")
5. **Note the device address** (like 00:18:E4:34:XX:XX)

## 📱 **App Testing Steps:**

### **Step 1: Open App and Connect**
1. **Open PillNow app** on your phone
2. **Go to IoT Control screen**
3. **Tap "SCAN & CONNECT"**
4. **Grant all permissions** when prompted
5. **Look for "HC-05"** in the device list
6. **Tap on HC-05** to connect
7. **Wait for "Connected to HC-05"** message

### **Step 2: Test Real IoT Commands**

#### **Test SMS Command:**
1. **Tap "SMS" button** in the app
2. **Expected Results:**
   - ✅ SMS sent to your phone number
   - ✅ LED turns ON for 5 seconds
   - ✅ Buzzer sounds for 5 seconds
   - ✅ LED blinks 10 times after 5 seconds
   - ✅ Arduino Serial Monitor shows: "SMS Sent!"

#### **Test LED Control:**
1. **Tap "LED" button** in the app
2. **Expected Results:**
   - ✅ LED turns ON/OFF on Arduino
   - ✅ Button text changes to "ON"/"OFF"
   - ✅ Arduino Serial Monitor shows: "LED turned ON/OFF via SMS"

#### **Test Buzzer Control:**
1. **Tap "BUZZER" button** in the app
2. **Expected Results:**
   - ✅ Buzzer turns ON/OFF on Arduino
   - ✅ Button text changes to "ON"/"OFF"
   - ✅ Arduino Serial Monitor shows: "LED turned ON/OFF via SMS"

#### **Test Alert System:**
1. **Tap "ALERT" button** in the app
2. **Expected Results:**
   - ✅ SMS sent to your phone
   - ✅ LED and buzzer activate simultaneously
   - ✅ Arduino Serial Monitor shows: "SMS Sent!"

#### **Test Stop Command:**
1. **Tap "STOP" button** in the app
2. **Expected Results:**
   - ✅ LED turns OFF
   - ✅ Buzzer turns OFF
   - ✅ Arduino Serial Monitor shows: "LED turned OFF via SMS"

#### **Test Call Function:**
1. **Tap "CALL" button** in the app
2. **Expected Results:**
   - ✅ Arduino calls your registered number
   - ✅ Arduino Serial Monitor shows: "Call started."

#### **Test SMS Listening:**
1. **Tap "LISTEN" button** in the app
2. **Send SMS to your SIM card** with "TURN ON" or "TURN OFF"
3. **Expected Results:**
   - ✅ Arduino receives SMS
   - ✅ LED/Buzzer responds to SMS commands
   - ✅ Arduino Serial Monitor shows: "Received SMS: TURN ON/OFF"

## 🔍 **Troubleshooting Real Hardware Control:**

### **If Commands Don't Work:**

#### **Check Arduino Serial Monitor:**
1. **Open Arduino IDE**
2. **Open Serial Monitor** (9600 baud)
3. **Look for these messages:**
   - "System Started..."
   - "Bluetooth Connected. Type 's' to send SMS."
   - Command responses when you tap app buttons

#### **Check Bluetooth Connection:**
1. **In the app:** Verify "Connected to HC-05" message
2. **On phone:** Check Bluetooth settings - HC-05 should show "Connected"
3. **Try disconnecting and reconnecting**

#### **Check Arduino Code:**
1. **Verify phone number** in Arduino code is correct
2. **Check SIM card** is inserted and has credit
3. **Verify all wiring** is correct
4. **Check power supply** is adequate

#### **Check App Permissions:**
1. **Go to phone Settings → Apps → PillNow**
2. **Grant all permissions:**
   - Bluetooth
   - Location
   - Storage
   - Phone (for SMS)

### **Common Issues:**

#### **"No device connected" Error:**
- Reconnect to HC-05
- Check HC-05 is powered on
- Verify Bluetooth pairing

#### **Commands Send But No Response:**
- Check Arduino Serial Monitor for errors
- Verify Arduino code is running
- Check wiring connections
- Verify SIM card and network

#### **SMS Not Sending:**
- Check phone number format (+country code)
- Verify SIM card has credit
- Check network signal strength
- Test SIM card in another phone

## 🎯 **Expected Complete Flow:**

### **Successful IoT Control:**
```
1. App connects to HC-05 ✅
2. Tap "SMS" button ✅
3. Arduino receives 's' command ✅
4. SMS sent to your phone ✅
5. LED turns ON for 5 seconds ✅
6. Buzzer sounds for 5 seconds ✅
7. LED blinks 10 times ✅
8. Arduino Serial Monitor shows success ✅
```

## 🚀 **Advanced Testing:**

### **Test All Commands:**
- **s** - Send SMS (triggers LED + buzzer + blinking)
- **r** - Start SMS listening
- **c** - Make call
- **TURN ON** - Turn ON LED and buzzer
- **TURN OFF** - Turn OFF LED and buzzer

### **Test SMS Remote Control:**
1. **Enable SMS listening** in app
2. **Send SMS** to your SIM card: "TURN ON"
3. **Arduino should respond** with LED and buzzer ON
4. **Send SMS:** "TURN OFF"
5. **Arduino should respond** with LED and buzzer OFF

## 🎉 **Success Indicators:**

- ✅ **App connects** to HC-05 successfully
- ✅ **Commands send** without errors
- ✅ **Arduino responds** to all commands
- ✅ **LED and buzzer** work as expected
- ✅ **SMS functionality** works
- ✅ **Call functionality** works
- ✅ **Remote SMS control** works

Your IoT hardware is now **fully controllable** through the PillNow app! 🎯
