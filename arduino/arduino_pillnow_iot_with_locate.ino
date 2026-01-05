#include <SoftwareSerial.h>
#include <Wire.h>
#include "RTClib.h"

#define BUZZER_PIN 7

// Individual container indicator LEDs (via transistor/MOSFET drivers)
#define LED_CONTAINER1_PIN 8
#define LED_CONTAINER2_PIN 9
#define LED_CONTAINER3_PIN 6

// SIM800L GSM Module (commented out - uncomment to enable)
// SoftwareSerial sim(4, 5);
SoftwareSerial btSerial(2, 3);
RTC_DS3231 rtc;

// char phoneNumber[] = "+639633800442";
bool locateBoxActive = false;
unsigned long lastLocateBuzz = 0;
bool locateBuzzerState = false; // Track buzzer state for locate

// ===== Scheduling (Medication Alarm) =====
#define MAX_SCHEDULES 8
struct DailySchedule {
  uint8_t hour;
  uint8_t minute;
  uint8_t container; // 1, 2, or 3 - which container this alarm is for
  bool inUse;
  int lastTriggeredYmd; // yyyymmdd to ensure one trigger per day
};
DailySchedule schedules[MAX_SCHEDULES];

bool alarmActive = false;
unsigned long lastAlarmToggle = 0;
unsigned long alarmStartTime = 0;
const unsigned long alarmMaxDurationMs = 60000; // 60 seconds
uint8_t activeContainerLED = 0; // Track which container LED should be on (0 = none, 1-3 = container)

void startLocateBox();
void stopLocateBox();
// SIM800L functions (commented out - uncomment to enable)
// void sendSMS(const __FlashStringHelper *msg);
// String readSIMResponse(unsigned long timeout = 2000);
// void testSMS();
// void checkSMSStatus();
// void diagnoseSIM800L();
// void callNumber();
// void RecieveMessage();
void handleCommand(const char *cmd);
void blinkLEDandBuzz();
String sanitizeCommand(String input);
void startAlarm();
void stopAlarm();
void setContainerLight(uint8_t container, bool on);
void startAlarmForContainer(uint8_t container);
void stopAlarmForContainer(uint8_t container);

void setup() {
  Serial.begin(9600);
  delay(1000);
  // SIM800L initialization (commented out - uncomment to enable)
  // sim.begin(9600);
  btSerial.begin(9600);

  pinMode(BUZZER_PIN, OUTPUT);
  pinMode(LED_CONTAINER1_PIN, OUTPUT);
  pinMode(LED_CONTAINER2_PIN, OUTPUT);
  pinMode(LED_CONTAINER3_PIN, OUTPUT);
  digitalWrite(LED_CONTAINER1_PIN, LOW);
  digitalWrite(LED_CONTAINER2_PIN, LOW);
  digitalWrite(LED_CONTAINER3_PIN, LOW);
  digitalWrite(BUZZER_PIN, LOW);

  if (!rtc.begin()) {
    Serial.println(F("RTC not found!"));
  } else {
    if (rtc.lostPower()) {
      rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
    }
  }


  // SIM800L initialization (commented out - uncomment to enable)
  // delay(2000);
  // while (sim.available()) sim.read();
  // sim.println("AT");
  // delay(1000);
  // if (readSIMResponse(2000).indexOf("OK") >= 0) {
  //   sim.println("AT+CMGF=1");
  //   delay(500);
  //   sim.println("AT+CNMI=1,2,0,0,0");
  //   delay(500);
  // }
  Serial.println(F("Ready"));
}

// Helper function to sanitize input - remove non-printable and invalid characters
String sanitizeCommand(String input) {
  String result = "";
  for (int i = 0; i < input.length(); i++) {
    char c = input.charAt(i);
    // Only keep printable ASCII characters (32-126) and newline/carriage return
    if ((c >= 32 && c <= 126) || c == '\n' || c == '\r' || c == '\t') {
      // Fix common Bluetooth corruption patterns
      if (c == '@') {
        result += 'D';  // @ often replaces D
      } else if (c == '#') {
        result += 'H';  // # sometimes replaces H
      } else if (c == 'j' || c == 'J') {
        // 'j' or 'J' often replaces ':' in time format (e.g., "02:50" -> "02j50")
        result += ':';
      } else if (c == 'Q' && i > 0 && result.length() > 0 && result.charAt(result.length() - 1) == 'R') {
        // RQ often replaces SCH - try to fix it
        result.setCharAt(result.length() - 1, 'S');
        result += "CH";
      } else {
        result += c;
      }
    }
  }
  return result;
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd = sanitizeCommand(cmd);
    cmd.trim();
    cmd.replace("\r", "");
    cmd.replace("\n", "");
    if (cmd.length() > 0) {
      handleCommand(cmd.c_str());
    }
  }

  if (btSerial.available()) {
    String cmd = btSerial.readStringUntil('\n');
    cmd = sanitizeCommand(cmd);
    cmd.trim();
    cmd.replace("\r", "");
    cmd.replace("\n", "");
    
    // Additional check: if command contains too many invalid chars, ignore it
    int validChars = 0;
    int invalidChars = 0;
    for (int i = 0; i < cmd.length(); i++) {
      char c = cmd.charAt(i);
      if ((c >= 32 && c <= 126) || c == ' ' || c == ':') {
        validChars++;
      } else {
        invalidChars++;
      }
    }
    
    // Only process if:
    // 1. Command is not empty
    // 2. At least 70% of characters are valid (stricter than before)
    // 3. Command length is reasonable (not too short, not too long)
    if (cmd.length() > 0 && cmd.length() < 100 && validChars * 10 >= cmd.length() * 7) {
      handleCommand(cmd.c_str());
    } else if (cmd.length() > 0) {
      // Log corrupted command but don't process it
      Serial.print(F("Ignoring corrupted command: ["));
      Serial.print(cmd);
      Serial.println(F("]"));
      // Don't send to Bluetooth to avoid feedback loop
    }
  }

  // Alarm buzzing (medication schedule) - has priority over locate
  if (alarmActive) {
    unsigned long nowMs = millis();
    // Check if alarm has been running too long (60 seconds max)
    if (nowMs - alarmStartTime >= alarmMaxDurationMs) {
      Serial.println(F("⏰ Alarm timeout - auto-stopping after 60 seconds"));
      stopAlarm();
    } else if (nowMs - lastAlarmToggle >= 400) {
      // Toggle buzzer every 400ms for audible alarm
      digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
      lastAlarmToggle = nowMs;
      // Debug: Print every 5 seconds to confirm buzzer is toggling
      static unsigned long lastDebugPrint = 0;
      if (nowMs - lastDebugPrint >= 5000) {
        Serial.print(F("🔔 Alarm active, buzzer toggling. Container: "));
        Serial.print(activeContainerLED);
        Serial.print(F(", Running for: "));
        Serial.print((nowMs - alarmStartTime) / 1000);
        Serial.println(F(" seconds"));
        lastDebugPrint = nowMs;
      }
    }
    // CRITICAL: Ensure container LED stays on while alarm is active - check every loop
    if (activeContainerLED > 0) {
      // Force LED on - don't just call setContainerLight, directly write to pin
      switch (activeContainerLED) {
        case 1: digitalWrite(LED_CONTAINER1_PIN, HIGH); break;
        case 2: digitalWrite(LED_CONTAINER2_PIN, HIGH); break;
        case 3: digitalWrite(LED_CONTAINER3_PIN, HIGH); break;
      }
    }
  } else if (locateBoxActive) {
    // Handle locate buzzer - only if alarm is not active
    unsigned long nowMs = millis();
    if (nowMs - lastLocateBuzz >= 500) {
      locateBuzzerState = !locateBuzzerState; // Toggle state
      digitalWrite(BUZZER_PIN, locateBuzzerState ? HIGH : LOW);
      lastLocateBuzz = nowMs;
    }
    // Ensure container LEDs are off during locate (not an alarm)
    if (activeContainerLED > 0) {
      setContainerLight(activeContainerLED, false);
      activeContainerLED = 0;
    }
  } else {
    // If not locating and no alarm, ensure buzzer is off
    digitalWrite(BUZZER_PIN, LOW);
    // Also turn off all container LEDs when alarm is not active
    if (activeContainerLED > 0) {
      setContainerLight(activeContainerLED, false);
      activeContainerLED = 0;
    }
  }

  // SIM800L message receiving (commented out - uncomment to enable)
  // RecieveMessage();
  checkSchedules();
}

// ===== Helper Functions =====
void handleCommand(const char *cmd) {
  // Preserve raw for argument parsing
  String raw = String(cmd);
  raw.trim();
  // Remove any remaining newline/carriage return
  raw.replace("\r", "");
  raw.replace("\n", "");
  
  if (raw.length() == 0) return; // Empty command, ignore
  
  // Check commands that need full string with spaces FIRST (before normalization)
  // Create uppercase version for comparison, but keep raw for parsing
  String upper = raw; 
  upper.toUpperCase();
  upper.trim();
  
  // Check SETTIME
  if (upper.startsWith("SETTIME")) {
    setRtcFromString(raw);
    return;
  }
  
  // Check SCHED commands - handle corrupted versions (e.g., "SCE@CLEAR", "RQADD", etc.)
  // First check for CLEAR command (even if corrupted)
  if (upper.indexOf("CLEAR") >= 0 && (upper.indexOf("SCHED") >= 0 || upper.indexOf("SCE") >= 0 || upper.indexOf("SC") >= 0)) {
    clearSchedules();
    Serial.println(F("SCHEDULES_CLEARED"));
    btSerial.println(F("SCHEDULES_CLEARED"));
    return;
  }
  
  // Check for ADD command - handle various corruption patterns
  // Patterns: "SCHED ADD", "SCE ADD", "RQADD", "SCH ADD", etc.
  // If we see "ADD" followed by a time pattern (HH:MM), treat it as schedule add
  // Also handle cases where "ADD" appears without proper prefix (corruption)
  if (upper.indexOf("ADD") >= 0) {
    int addIdx = upper.indexOf("ADD");
    if (addIdx >= 0) {
      // Extract everything after "ADD"
      String afterAdd = raw.substring(addIdx + 3);
      afterAdd.trim();
      
      
      // Look for time pattern (HH:MM) - this is the key indicator
      // Also check for corrupted colon (j, J, or other characters)
      int colon = afterAdd.indexOf(':');
      if (colon < 0) {
        // Try to find corrupted colon patterns
        colon = afterAdd.indexOf('j');
        if (colon < 0) colon = afterAdd.indexOf('J');
        if (colon < 0) colon = afterAdd.indexOf(';');
      }
      if (colon > 0 && colon < (int)afterAdd.length() - 1) {
        // Found time pattern - this is definitely a schedule add command
        // Extract time (HH:MM format)
        String timeToken = afterAdd.substring(0, colon + 3); // Get up to MM
        if (timeToken.length() > colon + 3) {
          timeToken = timeToken.substring(0, colon + 3);
        }
        timeToken.trim();
        
        // Extract container number (after time, could be space-separated or directly after)
        String containerToken = "";
        int spaceAfterTime = afterAdd.indexOf(' ', colon);
        if (spaceAfterTime > 0 && spaceAfterTime + 1 < (int)afterAdd.length()) {
          containerToken = afterAdd.substring(spaceAfterTime + 1);
          containerToken.trim();
        } else {
          // No space - look for number directly after time
          String rest = afterAdd.substring(colon + 3);
          rest.trim();
          // Find first digit 1-3
          for (int i = 0; i < rest.length(); i++) {
            char ch = rest.charAt(i);
            if (ch >= '1' && ch <= '3') {
              containerToken = String(ch);
              break;
            }
          }
        }
        
        // Parse time
        int h = timeToken.substring(0, colon).toInt();
        int m = timeToken.substring(colon + 1).toInt();
        uint8_t container = 1;
        
        // Parse container
        if (containerToken.length() > 0) {
          containerToken.toUpperCase();
          if (containerToken.startsWith("CONTAINER")) {
            int c = containerToken.substring(9).toInt();
            if (c >= 1 && c <= 3) container = (uint8_t)c;
          } else {
            int c = containerToken.toInt();
            if (c >= 1 && c <= 3) container = (uint8_t)c;
          }
        }
        
        // Validate and add schedule
        if (h >= 0 && h < 24 && m >= 0 && m < 60) {
          addSchedule((uint8_t)h, (uint8_t)m, container);
          char msgBuf[40];
          snprintf(msgBuf, sizeof(msgBuf), "SCHEDULE_ADDED %02d:%02d C%d", h, m, container);
          Serial.println(msgBuf);
          btSerial.println(msgBuf);
          return;
        } else {
          Serial.println(F("SCHEDULE_ADD_INVALID_TIME"));
          btSerial.println(F("SCHEDULE_ADD_INVALID_TIME"));
          return;
        }
      } else {
        // ADD command found but no time pattern - likely corrupted
        Serial.print(F("SCHEDULE_ADD_MISSING_TIME: ["));
        Serial.print(afterAdd);
        Serial.println(F("]"));
        btSerial.println(F("SCHEDULE_ADD_MISSING_TIME"));
        return;
      }
    }
  }
  
  // Check for SCHED commands (normal or corrupted) - legacy check
  if (upper.startsWith("SCHED") || (upper.startsWith("SCE") && upper.length() >= 3)) {
    if (upper.indexOf("ADD") >= 0) {
      // Already handled above, but keep for compatibility
      return;
    }
    if (upper.indexOf("CLEAR") >= 0) {
      clearSchedules();
      Serial.println(F("SCHEDULES_CLEARED"));
      btSerial.println(F("SCHEDULES_CLEARED"));
      return;
    }
    if (upper.indexOf("LIST") >= 0) {
      listSchedules();
      return;
    }
    Serial.println(F("SCHEDULE_INVALID"));
    btSerial.println(F("SCHEDULE_INVALID"));
    return;
  }
  
  // Also build a normalized version for simple commands
  String normalized = "";
  for (size_t i = 0; i < upper.length(); i++) {
    char ch = upper.charAt(i);
    if (ch != ' ' && ch != '_') { normalized += ch; }
  }

  // SIM800L commands (commented out - uncomment to enable)
  // if (normalized == "S") {
  //   sendSMS(F("Medication reminder!"));
  //   return;
  // }
  // if (normalized == "SMSTEST") {
  //   testSMS();
  //   return;
  // }
  // if (normalized == "SMSSTATUS") {
  //   checkSMSStatus();
  //   return;
  // }
  // if (normalized == "SIMDIAG") {
  //   diagnoseSIM800L();
  //   return;
  // }
  // if (normalized == "C") { callNumber(); return; }
  if (normalized == "LOCATE") { startLocateBox(); return; }
  if (normalized == "STOP" || normalized == "STOPLOCATE") { stopLocateBox(); stopAlarm(); return; }
  // ALARM TEST, STOP
  if (normalized == "ALARMTEST") { startAlarm(); return; }
  if (normalized == "ALARMSTOP") { stopAlarm(); return; }
  // Test alarm for specific container: ALARMTEST1, ALARMTEST2, ALARMTEST3
  if (normalized.startsWith("ALARMTEST")) {
    String containerStr = normalized.substring(9);
    if (containerStr.length() > 0) {
      int container = containerStr.toInt();
      if (container >= 1 && container <= 3) {
        startAlarmForContainer((uint8_t)container);
        return;
      }
    }
    startAlarm();
    return;
  }


  Serial.print(F("Unknown command: [")); Serial.print(raw); Serial.print(F("] (normalized: [")); Serial.print(normalized); Serial.println(F("]"));
}

// SIM800L SMS Functions (commented out - uncomment to enable)
// void sendSMS(const __FlashStringHelper *msg) {
//   sim.print(F("AT+CMGS=\""));
//   sim.print(phoneNumber);
//   sim.println(F("\""));
//   delay(500);
//   sim.print(F("PillNow: "));
//   sim.println(msg);
//   sim.println((char)26);
//   delay(1000);
//   blinkLEDandBuzz();
// }
//
// String readSIMResponse(unsigned long timeout = 2000) {
//   String response = "";
//   unsigned long startTime = millis();
//   while (millis() - startTime < timeout) {
//     if (sim.available()) {
//       char c = sim.read();
//       response += c;
//       if (c == '\n') {
//         delay(50);
//       }
//     }
//   }
//   return response;
// }
//
// void testSMS() {
//   Serial.println(F("SMS TEST"));
//   while (sim.available()) sim.read();
//   sim.println(F("AT"));
//   delay(1000);
//   String r = readSIMResponse(2000);
//   if (r.indexOf("OK") >= 0) {
//     sim.println(F("AT+CSQ"));
//     delay(500);
//     Serial.println(readSIMResponse(1000));
//     sendSMS(F("Test"));
//     delay(2000);
//     Serial.println(readSIMResponse(2000));
//   } else {
//     Serial.println(F("NO RESPONSE"));
//   }
// }
//
// void checkSMSStatus() {
//   Serial.println(F("SMS STATUS"));
//   while (sim.available()) sim.read();
//   sim.println(F("AT"));
//   delay(1000);
//   String r = readSIMResponse(2000);
//   if (r.length() > 0) {
//     Serial.println(r);
//     sim.println(F("AT+CSQ"));
//     delay(500);
//     Serial.println(readSIMResponse(1000));
//     sim.println(F("AT+CREG?"));
//     delay(500);
//     Serial.println(readSIMResponse(1000));
//   } else {
//     Serial.println(F("NO RESPONSE"));
//   }
// }
//
// void diagnoseSIM800L() {
//   Serial.println(F("SIM800L DIAG"));
//   while (sim.available()) sim.read();
//   sim.println("AT");
//   delay(2000);
//   String r = readSIMResponse(2000);
//   if (r.length() > 0) {
//     Serial.print(F("OK: "));
//     Serial.println(r);
//   } else {
//     Serial.println(F("NO RESPONSE"));
//     Serial.println(F("Check: TX->Pin4, RX->Pin5, Power 3.7-4.2V, GND"));
//   }
// }
//
// void callNumber() {
//   sim.print(F("ATD"));
//   sim.print(phoneNumber);
//   sim.println(F(";"));
//   delay(1000);
//   blinkLEDandBuzz();
// }


void startLocateBox() {
  if (alarmActive) stopAlarm();
  locateBoxActive = true;
  lastLocateBuzz = millis();
  locateBuzzerState = true;
  digitalWrite(BUZZER_PIN, HIGH);
  btSerial.println(F("LOCATE_STARTED"));
}

void stopLocateBox() {
  locateBoxActive = false;
  locateBuzzerState = false;
  digitalWrite(BUZZER_PIN, LOW);
  lastLocateBuzz = millis();
  delay(10);
  btSerial.println(F("LOCATE_STOPPED"));
}

// SIM800L message receiving (commented out - uncomment to enable)
// void RecieveMessage() {
//   if (sim.available()) {
//     String msg = sim.readString();
//     msg.trim();
//     if (msg.indexOf("LOCATE") >= 0) startLocateBox();
//     else if (msg.indexOf("STOP") >= 0) stopLocateBox();
//   }
// }


void blinkLEDandBuzz() {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(200);
  digitalWrite(BUZZER_PIN, LOW);
}


// ===== Scheduling helpers =====
void startAlarm() {
  if (alarmActive) return;
  alarmActive = true;
  alarmStartTime = millis();
  lastAlarmToggle = 0;
  digitalWrite(BUZZER_PIN, HIGH);
  btSerial.println(F("ALARM_STARTED"));
  delay(10);
}

void stopAlarm() {
  if (!alarmActive) return;
  uint8_t stoppedContainer = activeContainerLED; // Save container before clearing
  alarmActive = false;
  digitalWrite(BUZZER_PIN, LOW);
  if (activeContainerLED > 0) {
    setContainerLight(activeContainerLED, false);
    activeContainerLED = 0;
  }
  // Send ALARM_STOPPED with container info for ESP32-CAM capture
  if (stoppedContainer > 0) {
    char msgBuf[32];
    snprintf(msgBuf, sizeof(msgBuf), "ALARM_STOPPED C%d", stoppedContainer);
    Serial.println(msgBuf);
    btSerial.println(msgBuf);
  } else {
    btSerial.println(F("ALARM_STOPPED"));
  }
}

void setContainerLight(uint8_t container, bool on) {
  uint8_t pin = 0;
  switch (container) {
    case 1: pin = LED_CONTAINER1_PIN; break;
    case 2: pin = LED_CONTAINER2_PIN; break;
    case 3: pin = LED_CONTAINER3_PIN; break;
    default: return;
  }
  if (pin > 0) {
    digitalWrite(pin, on ? HIGH : LOW);
    delay(5);
  }
}

void startAlarmForContainer(uint8_t container) {
  if (activeContainerLED > 0 && activeContainerLED != container) {
    setContainerLight(activeContainerLED, false);
  }
  startAlarm();
  activeContainerLED = container;
  setContainerLight(container, true);
  delay(10);
}

void stopAlarmForContainer(uint8_t container) {
  stopAlarm(); // This will turn off the LED if it matches activeContainerLED
  // If a different container, just turn off that specific one
  if (activeContainerLED == container) {
    activeContainerLED = 0;
  }
}

void checkSchedules() {
  if (!rtc.begin()) {
    Serial.println(F("RTC not initialized!"));
    return;
  }
  DateTime now = rtc.now();
  if (now.year() < 2000) {
    Serial.println(F("RTC time invalid!"));
    return;
  }
  
  int ymd = now.year() * 10000 + now.month() * 100 + now.day();
  uint8_t currentHour = now.hour();
  uint8_t currentMinute = now.minute();
  
  // Debug: Print current time every minute (to verify RTC is working)
  static uint8_t lastPrintedMinute = 255;
  if (currentMinute != lastPrintedMinute) {
    Serial.print(F("Current time: "));
    Serial.print(currentHour);
    Serial.print(F(":"));
    if (currentMinute < 10) Serial.print(F("0"));
    Serial.println(currentMinute);
    lastPrintedMinute = currentMinute;
    
    // Also print active schedules for debugging
    Serial.print(F("Active schedules: "));
    int activeCount = 0;
    for (int i = 0; i < MAX_SCHEDULES; i++) {
      if (schedules[i].inUse) {
        activeCount++;
        Serial.print(F("C"));
        Serial.print(schedules[i].container);
        Serial.print(F(" @ "));
        Serial.print(schedules[i].hour);
        Serial.print(F(":"));
        if (schedules[i].minute < 10) Serial.print(F("0"));
        Serial.print(schedules[i].minute);
        Serial.print(F(" "));
      }
    }
    Serial.println();
    Serial.print(F("Total active: "));
    Serial.println(activeCount);
  }
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].inUse) continue;
    if (schedules[i].hour == currentHour && schedules[i].minute == currentMinute) {
      if (schedules[i].lastTriggeredYmd != ymd) {
        schedules[i].lastTriggeredYmd = ymd;
        
        Serial.print(F("✅ Schedule matched! Container "));
        Serial.print(schedules[i].container);
        Serial.print(F(" at "));
        Serial.print(currentHour);
        Serial.print(F(":"));
        if (currentMinute < 10) Serial.print(F("0"));
        Serial.println(currentMinute);
        
        // Start alarm for container
        Serial.println(F("🔔 Starting alarm for container..."));
        startAlarmForContainer(schedules[i].container);
        Serial.println(F("✅ Alarm started successfully"));
        
        // SIM800L SMS sending (commented out - uncomment to enable)
        // sim.print(F("AT+CMGS=\""));
        // sim.print(phoneNumber);
        // sim.println(F("\""));
        // delay(500);
        // sim.print(F("PillNow: Time to take medication from Container "));
        // sim.print(schedules[i].container);
        // sim.print(F("! ("));
        // if (schedules[i].hour < 10) sim.print(F("0"));
        // sim.print(schedules[i].hour);
        // sim.print(F(":"));
        // if (schedules[i].minute < 10) sim.print(F("0"));
        // sim.print(schedules[i].minute);
        // sim.println(F(")"));
        // sim.println((char)26);
        // delay(1000);
        
        // Send notification via Bluetooth
        char msgBuf[64];
        snprintf(msgBuf, sizeof(msgBuf), "ALARM_TRIGGERED C%d %02d:%02d", 
                 schedules[i].container, schedules[i].hour, schedules[i].minute);
        Serial.print(F("Sending: "));
        Serial.println(msgBuf);
        btSerial.println(msgBuf);
        btSerial.flush(); // Ensure message is sent immediately
        
        Serial.println(F("Alarm triggered and message sent!"));
        delay(50);
      }
    }
  }
}

void addSchedule(uint8_t hour, uint8_t minute, uint8_t container) {
  if (container < 1 || container > 3) container = 1;
  if (hour >= 24 || minute >= 60) {
    Serial.print(F("Invalid schedule time: "));
    Serial.print(hour);
    Serial.print(F(":"));
    Serial.println(minute);
    return;
  }
  
  // Check if this schedule time has already passed today
  // If so, set lastTriggeredYmd to today so it won't trigger until tomorrow
  int ymd = 0;
  bool timeHasPassed = false;
  if (rtc.begin()) {
    DateTime now = rtc.now();
    if (now.year() >= 2000) {
      ymd = now.year() * 10000 + now.month() * 100 + now.day();
      uint8_t currentHour = now.hour();
      uint8_t currentMinute = now.minute();
      
      // If schedule time has passed today (not equal), mark it as already triggered
      // If equal, we want it to trigger immediately
      if (hour < currentHour || (hour == currentHour && minute < currentMinute)) {
        timeHasPassed = true;
        Serial.print(F("Schedule time has passed today ("));
        Serial.print(hour);
        Serial.print(F(":"));
        if (minute < 10) Serial.print(F("0"));
        Serial.print(minute);
        Serial.print(F(" < "));
        Serial.print(currentHour);
        Serial.print(F(":"));
        if (currentMinute < 10) Serial.print(F("0"));
        Serial.print(currentMinute);
        Serial.println(F(") - will trigger tomorrow"));
      } else if (hour == currentHour && minute == currentMinute) {
        Serial.println(F("Schedule time matches current time - will trigger immediately!"));
      }
    }
  }
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].inUse) {
      schedules[i].inUse = true;
      schedules[i].hour = hour;
      schedules[i].minute = minute;
      schedules[i].container = container;
      // If time has passed today, set lastTriggeredYmd to today so it won't trigger until tomorrow
      // Otherwise, set to 0 so it can trigger today
      schedules[i].lastTriggeredYmd = timeHasPassed ? ymd : 0;
      Serial.print(F("Schedule added: Container "));
      Serial.print(container);
      Serial.print(F(" at "));
      Serial.print(hour);
      Serial.print(F(":"));
      if (minute < 10) Serial.print(F("0"));
      Serial.println(minute);
      btSerial.print(F("SCHEDULE_ADDED "));
      if (hour < 10) btSerial.print(F("0"));
      btSerial.print(hour);
      btSerial.print(F(":"));
      if (minute < 10) btSerial.print(F("0"));
      btSerial.print(minute);
      btSerial.print(F(" C"));
      btSerial.println(container);
      
      // Immediately check if this schedule should trigger NOW
      // This handles the case where schedule is added at the exact current time
      if (!timeHasPassed && rtc.begin()) {
        DateTime now = rtc.now();
        if (now.year() >= 2000) {
          int currentYmd = now.year() * 10000 + now.month() * 100 + now.day();
          uint8_t currentH = now.hour();
          uint8_t currentM = now.minute();
          
          // If schedule time matches current time, trigger it immediately
          if (hour == currentH && minute == currentM) {
            Serial.println(F("⚠️ Schedule matches current time - triggering immediately!"));
            schedules[i].lastTriggeredYmd = currentYmd; // Mark as triggered for today
            startAlarmForContainer(container);
            char msgBuf[64];
            snprintf(msgBuf, sizeof(msgBuf), "ALARM_TRIGGERED C%d %02d:%02d", container, hour, minute);
            Serial.print(F("📤 Sending: "));
            Serial.println(msgBuf);
            btSerial.println(msgBuf);
            btSerial.flush();
            Serial.println(F("✅ Alarm triggered immediately!"));
            delay(100); // Give time for message to be sent
          }
        }
      }
      
      return;
    }
  }
  // If all slots full, overwrite last one
  schedules[MAX_SCHEDULES - 1].inUse = true;
  schedules[MAX_SCHEDULES - 1].hour = hour;
  schedules[MAX_SCHEDULES - 1].minute = minute;
  schedules[MAX_SCHEDULES - 1].container = container;
  schedules[MAX_SCHEDULES - 1].lastTriggeredYmd = timeHasPassed ? ymd : 0;
  Serial.print(F("Schedule added (overwrite): Container "));
  Serial.print(container);
  Serial.print(F(" at "));
  Serial.print(hour);
  Serial.print(F(":"));
  if (minute < 10) Serial.print(F("0"));
  Serial.println(minute);
  btSerial.print(F("SCHEDULE_ADDED "));
  if (hour < 10) btSerial.print(F("0"));
  btSerial.print(hour);
  btSerial.print(F(":"));
  if (minute < 10) btSerial.print(F("0"));
  btSerial.print(minute);
  btSerial.print(F(" C"));
  btSerial.println(container);
  
  // Immediately check if this schedule should trigger NOW
  // This handles the case where schedule is added at the exact current time
  if (!timeHasPassed && rtc.begin()) {
    DateTime now = rtc.now();
    if (now.year() >= 2000) {
      int currentYmd = now.year() * 10000 + now.month() * 100 + now.day();
      uint8_t currentH = now.hour();
      uint8_t currentM = now.minute();
      
      // If schedule time matches current time, trigger it immediately
      if (hour == currentH && minute == currentM) {
        Serial.println(F("⚠️ Schedule matches current time - triggering immediately!"));
        schedules[MAX_SCHEDULES - 1].lastTriggeredYmd = currentYmd; // Mark as triggered for today
        startAlarmForContainer(container);
        char msgBuf[64];
        snprintf(msgBuf, sizeof(msgBuf), "ALARM_TRIGGERED C%d %02d:%02d", container, hour, minute);
        Serial.print(F("📤 Sending: "));
        Serial.println(msgBuf);
        btSerial.println(msgBuf);
        btSerial.flush();
        Serial.println(F("✅ Alarm triggered immediately!"));
        delay(100); // Give time for message to be sent
      }
    }
  }
}

void clearSchedules() {
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    schedules[i].inUse = false;
    schedules[i].container = 1;
    schedules[i].lastTriggeredYmd = 0;
  }
}

void listSchedules() {
  Serial.println(F("SCHEDULES_BEGIN"));
  btSerial.println(F("SCHEDULES_BEGIN"));
  int count = 0;
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].inUse) {
      count++;
      char buf[32];
      snprintf(buf, sizeof(buf), "%02d:%02d C%d", 
               schedules[i].hour, schedules[i].minute, schedules[i].container);
      Serial.println(buf);
      btSerial.println(buf);
    }
  }
  if (count == 0) {
    Serial.println(F("No schedules"));
    btSerial.println(F("No schedules"));
  }
  Serial.println(F("SCHEDULES_END"));
  btSerial.println(F("SCHEDULES_END"));
}

void setRtcFromString(const String &cmd) {
  int y, M, d, h, m, s;
  int sp = cmd.indexOf(' ');
  if (sp < 0 || sp + 1 >= cmd.length()) {
    Serial.println(F("RTC_SET_FAIL"));
    btSerial.println(F("RTC_SET_FAIL"));
    return;
  }
  String tpart = cmd.substring(sp + 1);
  tpart.trim();
  int dash1 = tpart.indexOf('-');
  int dash2 = tpart.indexOf('-', dash1 + 1);
  int space2 = tpart.indexOf(' ');
  int colon1 = tpart.indexOf(':', space2);
  int colon2 = tpart.indexOf(':', colon1 + 1);
  if (dash1 < 0 || dash2 < 0 || space2 < 0 || colon1 < 0 || colon2 < 0) {
    Serial.println(F("RTC_SET_FAIL"));
    btSerial.println(F("RTC_SET_FAIL"));
    return;
  }
  y = tpart.substring(0, dash1).toInt();
  M = tpart.substring(dash1 + 1, dash2).toInt();
  d = tpart.substring(dash2 + 1, space2).toInt();
  h = tpart.substring(space2 + 1, colon1).toInt();
  m = tpart.substring(colon1 + 1, colon2).toInt();
  s = tpart.substring(colon2 + 1).toInt();
  if (y < 2000 || y > 2099 || M < 1 || M > 12 || d < 1 || d > 31 || h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) {
    Serial.println(F("RTC_SET_FAIL"));
    btSerial.println(F("RTC_SET_FAIL"));
    return;
  }
  if (!rtc.begin()) {
    Serial.println(F("RTC_SET_FAIL"));
    btSerial.println(F("RTC_SET_FAIL"));
    return;
  }
  rtc.adjust(DateTime(y, M, d, h, m, s));
  char msgBuf[32];
  snprintf(msgBuf, sizeof(msgBuf), "RTC_SET %04d-%02d-%02d %02d:%02d:%02d", y, M, d, h, m, s);
  Serial.println(msgBuf);
  btSerial.println(msgBuf);
}

