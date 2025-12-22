#include <SoftwareSerial.h>
#include <Wire.h>
#include "RTClib.h"

#define BUZZER_PIN 7

// Individual container indicator LEDs (via transistor/MOSFET drivers)
#define LED_CONTAINER1_PIN 8
#define LED_CONTAINER2_PIN 9
#define LED_CONTAINER3_PIN 6

// SIM800L GSM Module
SoftwareSerial sim(4, 5);
SoftwareSerial btSerial(2, 3);
RTC_DS3231 rtc;

char phoneNumber[] = "+639633800442";
bool locateBoxActive = false;
unsigned long lastLocateBuzz = 0;
bool locateBuzzerState = false; // Track buzzer state for locate
bool atPassthrough = false;      // When true, bridge Serial <-> SIM800L for raw AT testing

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
// SIM800L functions
void sendSMS(const __FlashStringHelper *msg);
bool sendSMSToNumber(const char *phone, const char *message);
String readSIMResponse(unsigned long timeout = 2000);
void testSMS();
void checkSMSStatus();
void diagnoseSIM800L();
void callNumber();
void RecieveMessage();
String generateOTP(int length = 6);
bool sendOTP(const char *phone);
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
  delay(2000); // Wait for Serial Monitor to connect
  Serial.println(F("========================================"));
  Serial.println(F("PillNow IoT System Starting..."));
  Serial.println(F("========================================"));
  
  // SIM800L initialization
  Serial.println(F("Initializing SIM800L serial (9600 baud)..."));
  sim.begin(9600);
  delay(500);
  sim.flush(); // Clear any pending data
  Serial.println(F("SIM800L serial initialized"));
  
  btSerial.begin(9600);
  delay(500);
  Serial.println(F("Bluetooth serial initialized"));

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


  // SIM800L initialization - simple
  Serial.println(F("Initializing SIM800L..."));
  delay(2000);
  while (sim.available()) sim.read();
  
  sim.println("AT");
  delay(1000);
  if (sim.available()) {
    String r = sim.readString();
    if (r.indexOf("OK") >= 0) {
      sim.println("AT+CMGF=1");
      delay(500);
      if (sim.available()) sim.readString();
      Serial.println(F("SIM800L ready"));
    }
  }
  
  // Seed random number generator for OTP generation
  randomSeed(analogRead(A0) + millis());
  
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
  // Raw AT passthrough mode: bridges Serial <-> SIM800L for direct AT testing
  if (atPassthrough) {
  if (Serial.available()) {
      sim.write(Serial.read());
    }
    if (sim.available()) {
      Serial.write(sim.read());
    }
    delay(2);
    return; // Skip normal logic while in passthrough
  }

  if (Serial.available()) {
    // Use readStringUntil for more reliable reading of long commands
    // This method waits for newline and handles buffering better
    String cmd = Serial.readStringUntil('\n');
    
    // If no newline found, readStringUntil returns empty, so try alternative method
    if (cmd.length() == 0) {
      // Fallback: read character by character with timeout
      unsigned long startTime = millis();
      while (millis() - startTime < 3000) {
        if (Serial.available()) {
          char c = Serial.read();
          if (c == '\n' || c == '\r') {
            break;
          }
          cmd += c;
        } else if (cmd.length() > 0) {
          // Got some data, wait a bit more for rest
          delay(100);
        }
      }
    }
    
    // Clean up the command
    cmd = sanitizeCommand(cmd);
    cmd.trim();
    cmd.replace("\r", "");
    cmd.replace("\n", "");
    
    if (cmd.length() > 0) {
      Serial.print(F("[DEBUG] Received command length: ")); 
      Serial.println(cmd.length());
      Serial.print(F("[DEBUG] Command preview: "));
      if (cmd.length() > 50) {
        Serial.print(cmd.substring(0, 50));
        Serial.println(F("..."));
      } else {
        Serial.println(cmd);
      }
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
    if (nowMs - lastAlarmToggle >= 400) {
      digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
      lastAlarmToggle = nowMs;
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
    // auto-stop after max duration
    if (nowMs - alarmStartTime >= alarmMaxDurationMs) {
      stopAlarm();
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

  // SIM800L message receiving
  RecieveMessage();
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
  
  // Check SENDSMS FIRST - simplified
  String rawUpper = raw;
  rawUpper.toUpperCase();
  if (rawUpper.startsWith("SENDSMS")) {
    Serial.println(F("SENDSMS command received"));
    
    // Extract phone and message manually (more reliable than substring)
    String rest = "";
    for (int i = 7; i < raw.length(); i++) {
      rest += raw.charAt(i);
    }
    rest.trim();
    
    // Find first space to separate phone from message
    int spaceIdx = rest.indexOf(' ');
    if (spaceIdx > 0) {
      String phone = rest.substring(0, spaceIdx);
      String message = rest.substring(spaceIdx + 1);
      phone.trim();
      message.trim();
      
      Serial.print(F("Sending to: ")); Serial.println(phone);
      bool success = sendSMSToNumber(phone.c_str(), message.c_str());
      if (success) {
        Serial.println(F("SMS sent successfully"));
      } else {
        Serial.println(F("SMS failed"));
      }
    } else {
      Serial.println(F("Error: Invalid format. Use: SENDSMS <phone> <message>"));
    }
    return;
  }
  
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

  // AT passthrough mode controls
  if (upper == "ATMODE" || upper == "ATON" || upper == "ATMODEON") {
    atPassthrough = true;
    Serial.println(F("AT passthrough ENABLED. Bridge Serial <-> SIM800L. Type ATOFF to exit."));
    return;
  }
  if (upper == "ATOFF" || upper == "ATMODEOFF") {
    atPassthrough = false;
    Serial.println(F("AT passthrough DISABLED. Returning to normal mode."));
    return;
  }
  
  // Ignore local schedule commands; schedules are managed in the cloud (no logging to avoid spam)
  if (upper.startsWith("SCHED") || upper.startsWith("SCE") || upper.startsWith("SC ")) {
    return;
  }
  
  // Check SCHED commands - handle corrupted versions (e.g., "SCE@CLEAR", "RQADD", etc.)
  // First check for CLEAR command (even if corrupted)
  if (upper.indexOf("CLEAR") >= 0 && (upper.indexOf("SCHED") >= 0 || upper.indexOf("SCE") >= 0 || upper.indexOf("SC") >= 0)) {
    clearSchedules();
    // Serial.println(F("SCHEDULES_CLEARED")); // silenced noisy log
    // btSerial.println(F("SCHEDULES_CLEARED"));
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
      int colon = afterAdd.indexOf(':');
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
      // Serial.println(F("SCHEDULES_CLEARED")); // silenced noisy log
      // btSerial.println(F("SCHEDULES_CLEARED"));
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

  // SIM800L commands
  if (normalized == "S") {
    sendSMS(F("Medication reminder!"));
    return;
  }
  if (normalized == "SMSTEST") {
    // Simple SMS test - send to default phone number
    Serial.println(F("SMS Test - sending to default number"));
    sendSMSToNumber(phoneNumber, "Test SMS from PillNow");
    return;
  }
  if (normalized.startsWith("TESTSMS")) {
    // Test SMS with custom number - format: TESTSMS +639633800442
    String testPhone = raw.substring(7); // After "TESTSMS"
    testPhone.trim();
    if (testPhone.length() > 0) {
      Serial.print(F("Test SMS to: ")); Serial.println(testPhone);
      sendSMSToNumber(testPhone.c_str(), "Test SMS from PillNow Arduino");
    } else {
      Serial.println(F("Usage: TESTSMS <phone_number>"));
      Serial.println(F("Example: TESTSMS +639633800442"));
    }
    return;
  }
  if (normalized.startsWith("TESTSMS")) {
    // Test SMS with custom number - format: TESTSMS +639633800442
    String testPhone = raw.substring(8); // After "TESTSMS "
    testPhone.trim();
    if (testPhone.length() > 0) {
      Serial.print(F("Test SMS to: ")); Serial.println(testPhone);
      sendSMSToNumber(testPhone.c_str(), "Test SMS from PillNow Arduino");
    } else {
      Serial.println(F("Usage: TESTSMS <phone_number>"));
      Serial.println(F("Example: TESTSMS +639633800442"));
    }
    return;
  }
  if (normalized == "SMSSTATUS") {
    checkSMSStatus();
    return;
  }
  if (normalized == "SIMDIAG") {
    diagnoseSIM800L();
    return;
  }
  if (normalized == "C") { callNumber(); return; }
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
  // ALARM_TRIGGERED (from backend via bridge)
  // Formats supported:
  // - ALARM_TRIGGERED C2 14:30
  // - ALARM_TRIGGERED C2 2025-12-14 14:30
  //
  // IMPORTANT BUGFIX:
  // We MUST check `upper` (keeps underscore) not `normalized` (removes '_' and spaces),
  // otherwise the Arduino will NEVER recognize ALARM_TRIGGERED and the app will never
  // show the "take your pill" alarm modal (you'll only see mismatch PILLALERT).
  if (upper.startsWith("ALARM_TRIGGERED")) {
    Serial.println(F("ALARM_TRIGGERED_COMMAND_RECEIVED"));
    String rest = raw.substring(16); // Get everything after "ALARM_TRIGGERED" (16 chars)
    rest.trim();
    
    // Parse container number (C1, C2, C3)
    int containerNum = 1; // Default
    int cIdx = rest.indexOf('C');
    if (cIdx >= 0 && cIdx + 1 < rest.length()) {
      char cChar = rest.charAt(cIdx + 1);
      if (cChar >= '1' && cChar <= '3') {
        containerNum = cChar - '0';
      }
    }
    
    // Parse time from rest string.
    // Accept either:
    //  - "C1 HH:MM"
    //  - "C1 YYYY-MM-DD HH:MM"
    // Strategy: find the last token containing ':' and use that as HH:MM.
    String timeStr = "00:00";
    int lastColon = rest.lastIndexOf(':');
    if (lastColon > 0) {
      // take 2 chars before ':' for HH and 2 after for MM
      int start = lastColon - 2;
      int end = lastColon + 3;
      if (start >= 0 && end <= (int)rest.length()) {
        timeStr = rest.substring(start, end);
        timeStr.trim();
      }
    }
    if (timeStr.length() < 5 || timeStr.indexOf(':') < 0) {
      timeStr = "00:00";
    }
    
    Serial.print(F("Triggering alarm for Container "));
    Serial.print(containerNum);
    Serial.print(F(" at "));
    Serial.println(timeStr);
    
    // Send ALARM_TRIGGERED message back to app via Bluetooth with container and time
    btSerial.print(F("ALARM_TRIGGERED C"));
    btSerial.print(containerNum);
    btSerial.print(F(" "));
    btSerial.println(timeStr);
    btSerial.flush(); // Ensure message is sent immediately
    
    startAlarmForContainer((uint8_t)containerNum);
    return;
  }
  
  // PILL MISMATCH ALERT - trigger buzzer alarm when wrong pill detected
  // Format: "PILLALERT C<number>" (e.g., "PILLALERT C2")
  // Add cooldown to prevent multiple rapid alerts
  static unsigned long lastPillAlertTime = 0;
  const unsigned long PILL_ALERT_COOLDOWN = 15000; // 15 seconds cooldown
  
  if (normalized.startsWith("PILLALERT") || normalized == "ALERT" || normalized == "PILLMISMATCH") {
    unsigned long now = millis();
    
    // Check cooldown - only process if enough time has passed
    if (now - lastPillAlertTime < PILL_ALERT_COOLDOWN) {
      Serial.println(F("PILL_ALERT_COOLDOWN_ACTIVE"));
      return; // Ignore duplicate alerts within cooldown period
    }
    
    lastPillAlertTime = now;
    
    // Parse container number from command (e.g., "PILLALERT C2" -> 2)
    uint8_t containerNum = 1; // Default to container 1
    if (raw.startsWith("PILLALERT C") && raw.length() >= 12) {
      // Extract container number after "PILLALERT C"
      char containerChar = raw.charAt(11); // Position after "PILLALERT C"
      if (containerChar >= '1' && containerChar <= '3') {
        containerNum = containerChar - '0';
      }
    }
    
    Serial.print(F("PILL_MISMATCH_ALERT C"));
    Serial.println(containerNum);
    
    // Send PILLALERT with container number to app
    btSerial.print(F("PILLALERT C"));
    btSerial.println(containerNum);
    btSerial.flush(); // Ensure message is sent immediately
    // IMPORTANT: start alarm WITH container context so:
    // - the correct container LED stays ON during the alert
    // - when user stops buzzer, stopAlarm() can emit "ALARM_STOPPED C#" (used by app auto-capture)
    startAlarmForContainer(containerNum);
    return;
  }
  // SEND OTP - format: SENDOTP <phone>
  // Example: SENDOTP +639633800442
  // Generates a random 6-digit OTP and sends it via SMS
  if (raw.startsWith("SENDOTP") || raw.startsWith("sendotp") || raw.startsWith("Sendotp")) {
    Serial.println(F("SENDOTP_COMMAND_RECEIVED"));
    String rest = raw.substring(7); // Get everything after "SENDOTP" (7 chars)
    rest.trim();
    
    if (rest.length() > 0) {
      String phone = rest;
      phone.trim();
      
      Serial.print(F("SENDOTP_PHONE: [")); Serial.print(phone); Serial.println(F("]"));
      
      if (phone.length() > 0) {
        bool otpSuccess = sendOTP(phone.c_str());
        if (otpSuccess) {
          Serial.println(F("OTP_SENT_SUCCESS"));
          btSerial.println(F("OTP_SENT_SUCCESS"));
        } else {
          Serial.println(F("OTP_SEND_FAILED"));
          btSerial.println(F("OTP_SEND_FAILED"));
        }
        return;
      } else {
        Serial.println(F("ERROR: Phone number is empty"));
        btSerial.println(F("SENDOTP_INVALID_FORMAT"));
        return;
      }
    } else {
      Serial.println(F("ERROR: No phone number provided"));
      Serial.println(F("Usage: SENDOTP <phone_number>"));
      Serial.println(F("Example: SENDOTP +639633800442"));
      btSerial.println(F("SENDOTP_INVALID_FORMAT"));
      return;
    }
  }
  
  // SENDSMS is already handled at the beginning of this function
  // This section only handles other commands

  Serial.print(F("Unknown command: [")); Serial.print(raw); Serial.print(F("] (normalized: [")); Serial.print(normalized); Serial.println(F("]"));
}

// SIM800L SMS Functions
void sendSMS(const __FlashStringHelper *msg) {
  sim.print(F("AT+CMGS=\""));
  sim.print(phoneNumber);
  sim.println(F("\""));
  delay(500);
  sim.print(F("PillNow: "));
  sim.println(msg);
  sim.println((char)26);
  delay(1000);
  blinkLEDandBuzz();
}

// Normalize phone number - add + if missing (assumes Philippines +63)
String normalizePhoneNumber(String phone) {
  phone.trim();
  if (phone.length() == 0) return phone;
  
  // If starts with +, use as is
  if (phone.charAt(0) == '+') {
    return phone;
  }
  
  // If starts with 0, remove it and add +63 (Philippines)
  if (phone.charAt(0) == '0' && phone.length() >= 10) {
    return "+63" + phone.substring(1);
  }
  
  // If it's 10-11 digits without 0, add +63 (Philippines)
  if (phone.length() >= 10 && phone.length() <= 11) {
    // Check if it's all digits
    bool allDigits = true;
    for (int i = 0; i < phone.length(); i++) {
      if (!isdigit(phone.charAt(i))) {
        allDigits = false;
        break;
      }
    }
    if (allDigits) {
      return "+63" + phone;
    }
  }
  
  // Otherwise return as is (might be international format already)
  return phone;
}

// Send SMS to a specific phone number (for OTP) - SIMPLIFIED
bool sendSMSToNumber(const char *phone, const char *message) {
  // Normalize phone number (add +63 if missing)
  String normalizedPhone = normalizePhoneNumber(String(phone));
  Serial.print(F("Sending SMS to ")); Serial.print(phone);
  if (normalizedPhone != String(phone)) {
    Serial.print(F(" (normalized to ")); Serial.print(normalizedPhone); Serial.print(F(")"));
  }
  Serial.println();
  
  // Clear buffer
  while (sim.available()) sim.read();
  
  // Quick AT check to ensure SIM800L is responsive
  sim.println("AT");
  delay(300);
  String atResponse = "";
  while (sim.available()) {
    atResponse += sim.readString();
  }
  if (atResponse.indexOf("OK") < 0) {
    Serial.println(F("ERROR: SIM800L not responding to AT command"));
    Serial.print(F("Response: [")); Serial.print(atResponse); Serial.println(F("]"));
    return false;
  }
  
  // Set text mode
  sim.println("AT+CMGF=1");
  delay(500);
  String cmgfResponse = "";
  while (sim.available()) {
    cmgfResponse += sim.readString();
  }
  if (cmgfResponse.indexOf("OK") < 0) {
    Serial.println(F("ERROR: Failed to set SMS text mode"));
    Serial.print(F("Response: [")); Serial.print(cmgfResponse); Serial.println(F("]"));
    return false;
  }
  
  // Send phone number (use normalized version)
  sim.print("AT+CMGS=\"");
  sim.print(normalizedPhone);
  sim.println("\"");
  delay(1000);
  
  // Wait for '>' prompt (optional - some modules don't send it)
  unsigned long start = millis();
  bool gotPrompt = false;
  while (millis() - start < 3000) {
    if (sim.available()) {
      if (sim.read() == '>') {
        gotPrompt = true;
        break;
      }
    }
  }
  
  // Send message
  sim.print(message);
  delay(500);
  
  // Send Ctrl+Z
  sim.write(26);
  delay(3000);
  
  // Check response - read all available data
  String response = "";
  unsigned long responseStart = millis();
  while (millis() - responseStart < 5000) {
    if (sim.available()) {
      while (sim.available()) {
        response += sim.readString();
      }
      delay(200);
    } else if (response.length() > 0) {
      delay(500);
      break;
    }
  }
  
  // Read any remaining data
  delay(1000);
  while (sim.available()) {
    response += sim.readString();
  }
  
  response.trim();
  Serial.print(F("SIM800L Response: ["));
  Serial.print(response);
  Serial.println(F("]"));
  
  response.toUpperCase();
  if (response.indexOf("OK") >= 0 || response.indexOf("+CMGS") >= 0) {
    Serial.println(F("SMS sent successfully"));
    return true;
  } else if (response.indexOf("ERROR") >= 0) {
    Serial.println(F("SMS send failed - SIM800L returned ERROR"));
    Serial.println(F("Check: SIM card, network signal, phone number"));
    return false;
  } else if (response.length() == 0) {
    Serial.println(F("SMS send failed - No response from SIM800L"));
    Serial.println(F("Check: Power, wiring, SIM card inserted"));
    return false;
  } else {
    Serial.print(F("SMS send failed - Unknown response: "));
    Serial.println(response);
    return false;
  }
}

// Generate a random OTP (default 6 digits)
String generateOTP(int length = 6) {
  String otp = "";
  for (int i = 0; i < length; i++) {
    otp += String(random(0, 10)); // Random digit 0-9
  }
  return otp;
}

// Send OTP to a phone number - generates OTP and sends via SMS
bool sendOTP(const char *phone) {
  Serial.print(F("Generating and sending OTP to ")); Serial.println(phone);
  
  // Seed random with analog noise (if not already seeded)
  randomSeed(analogRead(A0) + millis());
  
  // Generate 6-digit OTP
  String otpCode = generateOTP(6);
  Serial.print(F("Generated OTP: ")); Serial.println(otpCode);
  
  // Create SMS message
  String message = "Your PILLNOW OTP code is: " + otpCode + ". This code will expire in 10 minutes. Do not share this code with anyone.";
  
  // Send SMS using existing function
  bool success = sendSMSToNumber(phone, message.c_str());
  
  if (success) {
    Serial.print(F("OTP ")); Serial.print(otpCode); Serial.println(F(" sent successfully"));
  } else {
    Serial.println(F("Failed to send OTP"));
  }
  
  return success;
}

String readSIMResponse(unsigned long timeout = 2000) {
  String response = "";
  unsigned long startTime = millis();
  
  while (millis() - startTime < timeout) {
    if (sim.available()) {
      char c = sim.read();
      response += c;
      if (c == '\n') delay(50);
    } else if (response.length() > 0 && (millis() - startTime) > 300) {
      break;
    }
  }
  
  response.trim();
  return response;
}

void testSMS() {
  Serial.println(F("SMS TEST"));
  while (sim.available()) sim.read();
  sim.println(F("AT"));
  delay(1000);
  String r = readSIMResponse(2000);
  if (r.indexOf("OK") >= 0) {
    sim.println(F("AT+CSQ"));
    delay(500);
    Serial.println(readSIMResponse(1000));
    sendSMS(F("Test"));
    delay(2000);
    Serial.println(readSIMResponse(2000));
  } else {
    Serial.println(F("NO RESPONSE"));
  }
}

void checkSMSStatus() {
  Serial.println(F("SMS STATUS"));
  while (sim.available()) sim.read();
  sim.println(F("AT"));
  delay(1000);
  String r = readSIMResponse(2000);
  if (r.length() > 0) {
    Serial.println(r);
    sim.println(F("AT+CSQ"));
    delay(500);
    Serial.println(readSIMResponse(1000));
    sim.println(F("AT+CREG?"));
    delay(500);
    Serial.println(readSIMResponse(1000));
  } else {
    Serial.println(F("NO RESPONSE"));
  }
}

void diagnoseSIM800L() {
  Serial.println(F("========== SIM800L DIAGNOSTICS =========="));
  
  // Test 1: Basic AT command
  Serial.println(F("Test 1: AT command..."));
  while (sim.available()) sim.read();
  sim.println("AT");
  sim.flush();
  delay(2000);
  String r = readSIMResponse(3000);
  if (r.indexOf("OK") >= 0) {
    Serial.println(F("✅ AT: OK"));
  } else if (r.length() > 0) {
    Serial.print(F("⚠️ AT: Got response but no OK: ")); Serial.println(r);
  } else {
    Serial.println(F("❌ AT: NO RESPONSE"));
  }
  
  // Test 2: Check if SIM800L is powered (try multiple times)
  Serial.println(F("Test 2: Multiple AT attempts..."));
  bool anyResponse = false;
  for (int i = 0; i < 3; i++) {
    while (sim.available()) sim.read();
    sim.println("AT");
    sim.flush();
    delay(1500);
    String resp = readSIMResponse(2000);
    if (resp.length() > 0) {
      anyResponse = true;
      Serial.print(F("  Attempt ")); Serial.print(i+1); Serial.print(F(": ")); Serial.println(resp);
    } else {
      Serial.print(F("  Attempt ")); Serial.print(i+1); Serial.println(F(": No response"));
    }
  }
  
  if (!anyResponse) {
    Serial.println(F("❌ SIM800L is not responding at all"));
    Serial.println(F("Hardware Checklist:"));
    Serial.println(F("1. Power: 3.7V-4.2V, 2A minimum"));
    Serial.println(F("2. Wiring: TX->Pin4, RX->Pin5"));
    Serial.println(F("3. GND: Connected to Arduino GND"));
    Serial.println(F("4. SIM800L LED: Should blink when powered"));
    Serial.println(F("5. Try resetting SIM800L (power cycle)"));
  } else {
    Serial.println(F("✅ SIM800L is responding (but may need configuration)"));
  }
  
  Serial.println(F("========================================="));
}

void callNumber() {
  sim.print(F("ATD"));
  sim.print(phoneNumber);
  sim.println(F(";"));
  delay(1000);
  blinkLEDandBuzz();
}


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

// SIM800L message receiving
void RecieveMessage() {
  if (sim.available()) {
    String msg = sim.readString();
    msg.trim();
    if (msg.indexOf("LOCATE") >= 0) startLocateBox();
    else if (msg.indexOf("STOP") >= 0) stopLocateBox();
  }
}


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
  // Cloud-managed schedules: skip local schedule checks/logs
  return;
  
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
        
        Serial.print(F("Schedule matched! Container "));
        Serial.print(schedules[i].container);
        Serial.print(F(" at "));
        Serial.print(currentHour);
        Serial.print(F(":"));
        if (currentMinute < 10) Serial.print(F("0"));
        Serial.println(currentMinute);
        
        // Start alarm for container
        startAlarmForContainer(schedules[i].container);
        
        // SIM800L SMS sending
        sim.print(F("AT+CMGS=\""));
        sim.print(phoneNumber);
        sim.println(F("\""));
        delay(500);
        sim.print(F("PillNow: Time to take medication from Container "));
        sim.print(schedules[i].container);
        sim.print(F("! ("));
        if (schedules[i].hour < 10) sim.print(F("0"));
        sim.print(schedules[i].hour);
        sim.print(F(":"));
        if (schedules[i].minute < 10) sim.print(F("0"));
        sim.print(schedules[i].minute);
        sim.println(F(")"));
        sim.println((char)26);
        delay(1000);
        
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
  
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].inUse) {
      schedules[i].inUse = true;
      schedules[i].hour = hour;
      schedules[i].minute = minute;
      schedules[i].container = container;
      schedules[i].lastTriggeredYmd = 0;
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
      return;
    }
  }
  // If all slots full, overwrite last one
  schedules[MAX_SCHEDULES - 1].inUse = true;
  schedules[MAX_SCHEDULES - 1].hour = hour;
  schedules[MAX_SCHEDULES - 1].minute = minute;
  schedules[MAX_SCHEDULES - 1].container = container;
  schedules[MAX_SCHEDULES - 1].lastTriggeredYmd = 0;
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

