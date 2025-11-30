# Medication Alarm System Guide

## Overview
Your Arduino IoT device now includes a Real-Time Clock (RTC) based medication alarm system that will automatically trigger buzzer alarms at scheduled times.

## Features Added

### 🕐 **RTC-Based Alarms**
- Uses DS3231 RTC module for accurate timekeeping
- Automatically triggers alarms at scheduled times
- Stores up to 3 medication alarms (ultra memory optimized)
- 15-second alarm duration with buzzer

### 🔔 **Buzzer Alarm System**
- Different buzzer patterns for different alarm types:
  - **Medication Alarms**: Fast buzzing (200ms intervals)
  - **Locate Box**: Medium buzzing (500ms intervals)
- Auto-stop after 30 seconds
- Manual stop with commands

## How to Use

### 1. **Set Medication Alarms**
Send this command via Serial Monitor or Bluetooth:
```
ALARM:HH:MM:CONTAINER:MEDICATION
```

**Examples:**
```
ALARM:08:30:1:Losartan
ALARM:14:00:2:Metformin
ALARM:20:00:3:Vitamin D
```

**Format:**
- `HH:MM` - 24-hour time format (00:00 to 23:59)
- `CONTAINER` - Container number (1, 2, or 3)
- `MEDICATION` - Medication name (max 7 characters)

### 2. **Available Commands**

| Command | Description |
|---------|-------------|
| `ALARM:08:30:1:Losartan` | Set alarm for 8:30 AM, Container 1, Losartan |
| `LIST_ALARMS` | View all set alarms |
| `STOP_ALARM` | Stop current medication alarm |
| `SET_ALARM` | Show alarm format help |
| `LOCATE` | Start locate box (different buzzer pattern) |
| `STOP_LOCATE` | Stop locate box |

### 3. **Alarm Behavior**

**When Alarm Triggers:**
1. Buzzer starts buzzing rapidly (200ms intervals)
2. Serial Monitor shows alarm details
3. Bluetooth sends notification to connected device
4. Alarm automatically stops after 30 seconds
5. Can be manually stopped with `STOP_ALARM`

**Alarm Output Example:**
```
=== MEDICATION ALARM TRIGGERED ===
Container: 1
Medication: Losartan
Time: 08:30
=================================
```

### 4. **Integration with App**

The Arduino will send notifications to your React Native app via Bluetooth:
- `ALARM: MedicationName - Container X` (when alarm triggers)
- `ALARM_SET: HH:MM:CONTAINER:MEDICATION` (when alarm is set)
- `ALARM_STOPPED` (when alarm stops)

## Hardware Setup

### Required Components:
- Arduino Uno/Nano
- DS3231 RTC Module
- HC-05 Bluetooth Module
- Buzzer (connected to pin 7)
- LED (connected to pin 8)
- SIM800L (optional, for SMS)

### Wiring:
```
DS3231 RTC:
- VCC → 5V
- GND → GND
- SDA → A4
- SCL → A5

Buzzer:
- Positive → Pin 7
- Negative → GND

HC-05 Bluetooth:
- VCC → 5V
- GND → GND
- TX → Pin 2
- RX → Pin 3
```

## Testing the System

### 1. **Set a Test Alarm**
```
ALARM:14:25:1:TestMedication
```
(Set for 2:25 PM today)

### 2. **Check Current Time**
The Serial Monitor shows current time every second:
```
Time: 2024-01-15 14:24:30
```

### 3. **Wait for Alarm**
At 14:25, the buzzer will start and you'll see:
```
=== MEDICATION ALARM TRIGGERED ===
Container: 1
Medication: TestMedication
Time: 14:25
=================================
```

### 4. **List All Alarms**
```
LIST_ALARMS
```

## Memory Optimization

The code has been optimized for Arduino Uno's limited memory:

### **Memory Savings:**
- **Alarm count**: Reduced from 10 to 3 alarms
- **Data types**: Using `uint8_t` instead of `int` (saves 3 bytes per variable)
- **Medication names**: Fixed 8-character arrays instead of String objects
- **Buffer size**: Reduced from 100 to 30 characters
- **String operations**: Replaced String concatenation with direct Serial.print()
- **Serial output**: Shortened all debug messages
- **Alarm duration**: Reduced from 30s to 15s

### **Memory Usage:**
- **Before optimization**: 2416 bytes (117% - exceeded limit)
- **After optimization**: ~1600 bytes (78% - within limit)

## Troubleshooting

### Alarm Not Triggering:
1. Check RTC time is correct
2. Verify alarm format is correct
3. Check if alarm was already triggered today
4. Ensure buzzer is connected to pin 7

### Buzzer Not Working:
1. Check wiring to pin 7
2. Test with `TURN ON` command
3. Verify buzzer polarity

### RTC Issues:
1. Check I2C connections (SDA/SCL)
2. Verify DS3231 module is working
3. Check if RTC lost power (will auto-set to compile time)

## Integration with React Native App

Your app can now:
1. Send alarm commands to Arduino via Bluetooth
2. Receive alarm notifications
3. Display real-time alarm status
4. Sync medication schedules with Arduino alarms

The Arduino acts as a reliable, offline alarm system that works even when the phone app is not connected.
