# PillNow IoT Hardware Setup Guide

## Components Required:
- Arduino Uno
- HC-05 Bluetooth Module
- LED (any color)
- Buzzer/Piezo Speaker
- SIM800L GSM Module
- Breadboard
- Jumper wires
- 220Ω resistor (for LED)
- Power supply (9V battery or USB)

## Wiring Diagram:

### HC-05 Bluetooth Module:
```
HC-05    Arduino Uno
VCC  ->  5V
GND  ->  GND
TX   ->  Pin 2 (RX)
RX   ->  Pin 3 (TX)
EN   ->  Not connected (or to 3.3V for configuration)
```

### LED:
```
LED Anode (+) -> 220Ω Resistor -> Pin 13
LED Cathode (-) -> GND
```

### Buzzer:
```
Buzzer (+) -> Pin 12
Buzzer (-) -> GND
```

### SIM800L GSM Module:
```
SIM800L    Arduino Uno
VCC     ->  5V (or external 4.2V power supply)
GND     ->  GND
TX      ->  Pin 4 (RX)
RX      ->  Pin 5 (TX)
RST     ->  Pin 6 (optional, for reset)
```

## Complete Pin Mapping:
- **Pin 2**: HC-05 RX (Arduino TX)
- **Pin 3**: HC-05 TX (Arduino RX)
- **Pin 4**: SIM800L RX (Arduino TX)
- **Pin 5**: SIM800L TX (Arduino RX)
- **Pin 12**: Buzzer
- **Pin 13**: LED

## Setup Instructions:

### 1. Hardware Assembly:
1. Connect all components according to the wiring diagram
2. Double-check all connections
3. Power up the Arduino via USB or external power supply

### 2. HC-05 Configuration (if needed):
- Default settings: 9600 baud, name: "HC-05"
- To change settings, connect EN pin to 3.3V and use AT commands

### 3. SIM800L Setup:
- Insert a valid SIM card
- Ensure the SIM card has credit for SMS
- The module will automatically connect to the network

### 4. Testing:
1. Upload the Arduino code
2. Open Serial Monitor (9600 baud)
3. Test commands:
   - `LED_ON` / `LED_OFF`
   - `BUZZER_ON` / `BUZZER_OFF`
   - `ALERT`
   - `STATUS`

## Troubleshooting:

### HC-05 Issues:
- Check if the module is powered (red LED should be on)
- Verify TX/RX connections (they should be crossed)
- Try different baud rates if needed

### SIM800L Issues:
- Check SIM card insertion
- Verify power supply (4.2V recommended)
- Check antenna connection
- Monitor serial output for error messages

### General Issues:
- Ensure all GND connections are common
- Check for loose connections
- Verify pin assignments in the code

## Power Requirements:
- Arduino Uno: 5V via USB or 7-12V via barrel jack
- HC-05: 3.3V-5V (regulated by Arduino)
- SIM800L: 4.2V recommended (can use Arduino 5V)
- Total current: ~500mA peak

## Safety Notes:
- Always disconnect power before making connections
- Use appropriate resistors for LEDs
- Handle SIM card carefully
- Keep components away from water and static electricity










