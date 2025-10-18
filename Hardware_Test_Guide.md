# 🔧 PillNow IoT Hardware Test Guide

## 🚨 **Buzzer Not Working? Let's Fix It!**

### **Step 1: Upload Buzzer Test**
1. Open `buzzer_test.ino` in Arduino IDE
2. Upload to your Arduino
3. Open Serial Monitor (9600 baud)
4. You should hear beeps and see test messages

### **Step 2: Check Buzzer Wiring**

#### **Correct Wiring:**
```
Arduino Uno    →    Buzzer
Pin 7          →    Positive (+)
GND            →    Negative (-)
```

#### **Common Issues:**
- ❌ **Wrong polarity**: Buzzer won't work if + and - are swapped
- ❌ **Wrong pin**: Make sure it's connected to pin 7
- ❌ **Loose connections**: Check all wires are secure
- ❌ **Dead buzzer**: Try a different buzzer

### **Step 3: Test Different Buzzer Types**

#### **Active Buzzer (Recommended):**
- Works with simple HIGH/LOW signals
- Makes sound immediately when powered
- Usually has a label or marking

#### **Passive Buzzer:**
- Needs PWM signal to make sound
- More complex to control
- May need different code

### **Step 4: Test Other Hardware**

#### **RTC (Real Time Clock) Test:**
```cpp
// Add this to your main code setup() function
DateTime now = rtc.now();
Serial.print("RTC Time: ");
Serial.print(now.hour());
Serial.print(":");
Serial.print(now.minute());
Serial.print(":");
Serial.println(now.second());
```

#### **Bluetooth Test:**
- Send "s" command from app
- Check Serial Monitor for "SMS command received"
- Should see "SySySySySySy" response

#### **LED Test:**
- LED should blink when sending SMS
- Check LED on pin 8

### **Step 5: Troubleshooting Commands**

#### **Test Commands via Serial Monitor:**
```
s          - Send SMS (should see LED blink)
LOCATE     - Start locate box (buzzer should buzz)
STOP_LOCATE - Stop locate box
ALARM:14:25:1:Test - Set test alarm
LIST_ALARMS - View all alarms
STOP_ALARM - Stop current alarm
```

### **Step 6: Hardware Checklist**

#### **Power Supply:**
- ✅ Arduino powered (USB or external)
- ✅ All modules getting 5V/3.3V as needed
- ✅ Ground connections secure

#### **Connections:**
- ✅ Buzzer: Pin 7 to +, GND to -
- ✅ LED: Pin 8 to +, GND to -
- ✅ RTC: SDA to A4, SCL to A5, VCC to 5V, GND to GND
- ✅ HC-05: RX to Pin 2, TX to Pin 3, VCC to 5V, GND to GND
- ✅ SIM800L: RX to Pin 10, TX to Pin 11, VCC to 5V, GND to GND

### **Step 7: Quick Fixes**

#### **If Buzzer Still Not Working:**
1. **Try different pin**: Change `buzzerPin = 7` to `buzzerPin = 9`
2. **Check voltage**: Use multimeter to verify 5V on pin 7
3. **Test with LED**: Replace buzzer with LED to test pin output
4. **Try different buzzer**: Get a new active buzzer

#### **If RTC Not Working:**
1. Check I2C connections (SDA/SCL)
2. Verify RTC module is DS3231
3. Check if RTC needs battery

#### **If Bluetooth Not Working:**
1. Check HC-05 connections
2. Verify HC-05 is in correct mode
3. Check if HC-05 is paired with phone

### **Step 8: Test Results**

#### **Expected Results:**
- ✅ Buzzer test: Should hear clear beeps
- ✅ RTC test: Should show current time
- ✅ Bluetooth test: Commands should work from app
- ✅ LED test: Should blink when sending SMS

#### **If Everything Works:**
- Upload the main `arduino_pillnow_iot_with_locate.ino` code
- Test medication alarms
- Test locate box functionality

### **Step 9: Common Solutions**

#### **Buzzer Solutions:**
```cpp
// If buzzer still not working, try this in your main code:
void testBuzzer() {
  Serial.println("Testing buzzer...");
  for (int i = 0; i < 5; i++) {
    digitalWrite(buzzerPin, HIGH);
    delay(500);
    digitalWrite(buzzerPin, LOW);
    delay(500);
  }
}
```

#### **Alternative Buzzer Code:**
```cpp
// For passive buzzers, use this instead:
void buzzPassive() {
  for (int i = 0; i < 100; i++) {
    digitalWrite(buzzerPin, HIGH);
    delayMicroseconds(1000);
    digitalWrite(buzzerPin, LOW);
    delayMicroseconds(1000);
  }
}
```

## 🎯 **Next Steps**

1. **Run buzzer test first**
2. **Fix any wiring issues**
3. **Test all hardware components**
4. **Upload main code**
5. **Test medication alarms**

## 📞 **Need Help?**

If buzzer still doesn't work after trying these steps:
1. Check if you have the right type of buzzer
2. Verify all connections with multimeter
3. Try a different Arduino pin
4. Test with a simple LED first

The hardware test should help identify exactly what's not working! 🔧
