# PillNow Arduino IoT Integration Setup Guide

## Hardware Components Required

### Main Components:
- **Arduino Uno** (or compatible)
- **HC-05 Bluetooth Module**
- **SIM800L GSM Module**
- **LED** (any color, 3mm or 5mm)
- **Buzzer/Piezo Speaker**
- **220Ω Resistor** (for LED)
- **Breadboard** (optional, for prototyping)
- **Jumper wires**
- **Power supply** (9V battery or USB power)

### Optional Components:
- **Push buttons** (for manual testing)
- **LCD Display** (for status display)
- **Relay module** (for controlling external devices)

## Wiring Diagram

### HC-05 Bluetooth Module:
```
HC-05    Arduino Uno
VCC  ->  5V
GND  ->  GND
TX   ->  Pin 2 (RX)
RX   ->  Pin 3 (TX)
```

### LED:
```
LED Anode (+) -> 220Ω Resistor -> Pin 8
LED Cathode (-) -> GND
```

### Buzzer:
```
Buzzer (+) -> Pin 7
Buzzer (-) -> GND
```

### SIM800L GSM Module:
```
SIM800L    Arduino Uno
VCC     ->  5V (or external 4.2V power supply)
GND     ->  GND
TX      ->  Pin 10 (RX)
RX      ->  Pin 11 (TX)
RST     ->  Pin 6 (optional, for reset)
```

## Arduino Code Setup

### 1. Install Required Libraries:
- No external libraries required (uses built-in SoftwareSerial)

### 2. Upload the Code:
1. Connect Arduino to your computer via USB
2. Open Arduino IDE
3. Copy and paste the provided Arduino sketch
4. **IMPORTANT**: Update the phone number in the code:
   ```cpp
   String number = "+639633800442"; // Change to your phone number
   ```
5. Select the correct board (Arduino Uno) and port
6. Upload the code

### 3. Test the Setup:
1. Open Serial Monitor (9600 baud)
2. You should see: "System Started..."
3. Type 's' to test SMS sending
4. Type 'r' to start SMS listening
5. Type 'c' to test calling

## React Native App Integration

### 1. Install Required Dependencies:
```bash
npm install react-native-bluetooth-classic
```

### 2. Android Permissions:
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH" />
<uses-permission android:name="android.permission.BLUETOOTH_ADMIN" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

### 3. iOS Permissions:
Add to `ios/Pillnow/Info.plist`:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>This app needs Bluetooth to connect to IoT devices</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>This app needs Bluetooth to connect to IoT devices</string>
```

## Usage Instructions

### 1. Hardware Setup:
1. Wire all components according to the diagram
2. Insert SIM card into SIM800L module
3. Power on the Arduino
4. Wait for SIM800L to register to network (LED on SIM800L should blink)

### 2. App Connection:
1. Open PillNow app on your phone
2. Go to IoT Control screen
3. Tap "SCAN & CONNECT"
4. Select your HC-05 device from the list
5. Wait for connection confirmation

### 3. Testing Commands:

#### Send SMS:
- Tap "SMS" button in the app
- This will:
  - Send SMS to the registered number
  - Turn ON LED and buzzer for 5 seconds
  - Start LED blinking pattern (10 blinks)

#### Listen for SMS:
- Tap "LISTEN" button
- Device will listen for incoming SMS commands
- Send SMS with "TURN ON" or "TURN OFF" to control LED/buzzer

#### Make Call:
- Tap "CALL" button
- Device will call the registered number

#### Manual Control:
- Use "LED" and "BUZZER" buttons for direct control
- Use "ALERT" button to trigger medication reminder
- Use "STOP" button to turn off all alerts

## Troubleshooting

### Common Issues:

#### 1. Bluetooth Connection Failed:
- Ensure HC-05 is powered on
- Check if device is already paired in phone settings
- Try restarting Bluetooth on both devices

#### 2. SMS Not Sending:
- Check SIM card is inserted correctly
- Verify phone number format (+country code)
- Ensure SIM has credit/active plan
- Check network signal strength

#### 3. LED/Buzzer Not Working:
- Check wiring connections
- Verify pin numbers in code match hardware
- Test with multimeter for power

#### 4. App Crashes:
- Check Bluetooth permissions
- Restart the app
- Clear app cache

### Debug Steps:
1. Open Arduino Serial Monitor (9600 baud)
2. Check for error messages
3. Test individual components
4. Verify all connections

## Advanced Features

### 1. Custom SMS Commands:
You can add more SMS commands in the Arduino code:
```cpp
if (msg.indexOf("CUSTOM_COMMAND") >= 0) {
    // Your custom action here
    Serial.println("Custom command executed");
}
```

### 2. Multiple Phone Numbers:
Modify the code to support multiple numbers:
```cpp
String numbers[] = {"+1234567890", "+0987654321"};
```

### 3. Scheduled Alerts:
Add RTC module for time-based alerts:
```cpp
#include <RTClib.h>
RTC_DS3231 rtc;
```

## Safety Notes

1. **Power Supply**: Use appropriate power supply (5V for Arduino, 4.2V for SIM800L)
2. **SIM Card**: Ensure SIM card is active and has sufficient credit
3. **Antenna**: Keep SIM800L antenna away from metal objects
4. **Heat**: SIM800L can get hot during operation
5. **Battery**: Use rechargeable batteries for portable operation

## Support

For issues or questions:
1. Check the troubleshooting section
2. Verify all connections
3. Test with Serial Monitor
4. Check app permissions
5. Restart all devices

## Next Steps

1. **Test all functions** with the app
2. **Customize SMS messages** in Arduino code
3. **Add more sensors** (temperature, motion, etc.)
4. **Implement medication scheduling** integration
5. **Add data logging** capabilities
