# PillNow IoT Integration Guide

## Overview
This guide explains how to integrate Arduino IoT hardware with your PillNow React Native app for automated medication reminders with visual and audio alerts, plus SMS notifications.

## System Architecture

```
PillNow App (React Native)
    ↓ Bluetooth Communication
HC-05 Bluetooth Module
    ↓ Serial Communication
Arduino Uno
    ↓ Digital Outputs
LED + Buzzer + SIM800L
```

## Features Implemented

### 1. Visual Alerts (LED)
- **Purpose**: Visual notification for medication reminders
- **Control**: ON/OFF via app or automatic triggers
- **Hardware**: LED with 220Ω resistor on Pin 13

### 2. Audio Alerts (Buzzer)
- **Purpose**: Audible notification for medication reminders
- **Control**: ON/OFF via app or automatic triggers
- **Hardware**: Piezo buzzer on Pin 12

### 3. SMS Notifications (SIM800L)
- **Purpose**: Send SMS alerts to caregivers or patients
- **Control**: Automatic SMS sending with custom messages
- **Hardware**: SIM800L GSM module with SIM card

### 4. Bluetooth Communication (HC-05)
- **Purpose**: Wireless communication between app and Arduino
- **Control**: Bidirectional communication for commands and status
- **Hardware**: HC-05 Bluetooth module

## App Integration

### 1. BluetoothScreen.tsx
- **Device scanning and connection**
- **Real-time IoT device control**
- **Status monitoring**
- **Manual command sending**

### 2. IoTService.ts
- **Centralized IoT communication service**
- **Command management**
- **Status tracking**
- **Error handling**

### 3. MedicationNotification.tsx
- **Automatic IoT alert triggering**
- **SMS notification integration**
- **Snooze functionality with IoT**
- **Alert status display**

## Available Commands

### Basic Controls
- `LED_ON` / `LED_OFF` - Control LED
- `BUZZER_ON` / `BUZZER_OFF` - Control buzzer
- `STATUS` - Get device status

### Medication Alerts
- `ALERT` - Trigger full medication alert (LED + Buzzer + SMS)
- `STOP_ALERT` - Stop all alerts

### SMS Functions
- `SMS:message` - Send custom SMS
- `PHONE:number` - Set phone number for SMS

## Usage Workflow

### 1. Initial Setup
1. **Hardware Assembly**: Follow wiring diagram
2. **Arduino Code**: Upload `arduino_pillnow_iot.ino`
3. **SIM Card**: Insert valid SIM with credit
4. **Power Up**: Connect Arduino to power

### 2. App Connection
1. **Open PillNow App**
2. **Navigate to IoT Control**
3. **Scan for HC-05 device**
4. **Connect to device**
5. **Test basic controls**

### 3. Medication Reminders
1. **Set medication schedule in app**
2. **When reminder triggers**:
   - App shows notification
   - IoT device activates LED and buzzer
   - SMS sent to caregiver
3. **User responds**:
   - Tap "Done" to stop alerts
   - Tap "Snooze" to delay reminder

## Testing Commands

### Manual Testing via Serial Monitor
```
LED_ON          // Turn on LED
LED_OFF         // Turn off LED
BUZZER_ON       // Turn on buzzer
BUZZER_OFF      // Turn off buzzer
ALERT           // Trigger medication alert
STOP_ALERT      // Stop all alerts
STATUS          // Check device status
SMS:Test message // Send SMS
PHONE:+1234567890 // Set phone number
```

### App Testing
1. **Connect to device**
2. **Test individual controls** (LED, Buzzer)
3. **Test medication alert**
4. **Test SMS functionality**
5. **Test status checking**

## Troubleshooting

### Connection Issues
- **Check Bluetooth permissions**
- **Verify HC-05 is discoverable**
- **Ensure correct pairing**
- **Check Arduino power**

### Command Issues
- **Verify Arduino code is uploaded**
- **Check serial monitor for errors**
- **Ensure proper wiring**
- **Test with Serial Monitor first**

### SMS Issues
- **Check SIM card insertion**
- **Verify SIM has credit**
- **Check network signal**
- **Monitor serial output for SMS errors**

### Hardware Issues
- **Check all connections**
- **Verify power supply**
- **Test individual components**
- **Check for loose wires**

## Advanced Features

### 1. Custom Alert Patterns
Modify Arduino code to create custom LED/buzzer patterns:
```cpp
void customAlertPattern() {
  for (int i = 0; i < 5; i++) {
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    delay(200);
  }
}
```

### 2. Multiple Phone Numbers
Extend SMS functionality to support multiple recipients:
```cpp
String phoneNumbers[] = {"+1234567890", "+0987654321"};
void sendSMSToAll(String message) {
  for (int i = 0; i < 2; i++) {
    sendSMS(phoneNumbers[i], message);
  }
}
```

### 3. Sensor Integration
Add sensors for enhanced functionality:
- **Motion sensor**: Detect when patient is near
- **Light sensor**: Adjust LED brightness
- **Temperature sensor**: Monitor medication storage

## Security Considerations

### 1. Bluetooth Security
- **Use pairing codes**
- **Limit device discovery**
- **Implement authentication**

### 2. SMS Security
- **Validate phone numbers**
- **Limit SMS frequency**
- **Secure message content**

### 3. Data Privacy
- **Encrypt sensitive data**
- **Secure local storage**
- **Comply with healthcare regulations**

## Performance Optimization

### 1. Battery Life
- **Use sleep modes**
- **Optimize LED brightness**
- **Reduce SMS frequency**

### 2. Response Time
- **Optimize command processing**
- **Reduce Bluetooth latency**
- **Efficient status updates**

### 3. Reliability
- **Implement retry mechanisms**
- **Add error recovery**
- **Monitor connection health**

## Future Enhancements

### 1. Cloud Integration
- **Store medication history**
- **Sync across devices**
- **Remote monitoring**

### 2. AI Features
- **Predictive reminders**
- **Smart scheduling**
- **Behavioral analysis**

### 3. Additional Sensors
- **Medication detection**
- **Environmental monitoring**
- **Health metrics tracking**

## Support and Maintenance

### 1. Regular Maintenance
- **Check hardware connections**
- **Update Arduino code**
- **Monitor SIM card balance**
- **Test all functions**

### 2. Troubleshooting Resources
- **Arduino documentation**
- **HC-05 datasheet**
- **SIM800L manual**
- **React Native Bluetooth guides**

### 3. Community Support
- **GitHub issues**
- **Stack Overflow**
- **Arduino forums**
- **React Native community**










