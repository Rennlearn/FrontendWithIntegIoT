#include <SoftwareSerial.h>
#include <Wire.h>
#include "RTClib.h"
#include <SPI.h>
#include <SD.h>

#define LED_PIN 8
#define BUZZER_PIN 7
#define CHIP_SELECT 10

SoftwareSerial sim(4, 5);
SoftwareSerial btSerial(2, 3);
RTC_DS3231 rtc;
File myFile;

char phoneNumber[] = "+639633800442";
bool locateBoxActive = false;
unsigned long lastLocateBuzz = 0;
unsigned long ledOnTime = 0;
bool ledBlinking = false;
unsigned long lastBlinkTime = 0;
int blinkCount = 0;
bool ledState = false;

// ===== Scheduling (Medication Alarm) =====
#define MAX_SCHEDULES 8
struct DailySchedule {
  uint8_t hour;
  uint8_t minute;
  bool inUse;
  int lastTriggeredYmd; // yyyymmdd to ensure one trigger per day
};
DailySchedule schedules[MAX_SCHEDULES];

bool alarmActive = false;
unsigned long lastAlarmToggle = 0;
unsigned long alarmStartTime = 0;
const unsigned long alarmMaxDurationMs = 60000; // 60 seconds

void logToSD(const __FlashStringHelper *event, const __FlashStringHelper *data);
void startLocateBox();
void stopLocateBox();
void sendSMS(const __FlashStringHelper *msg);
void callNumber();
void sendTimeSMS();
void RecieveMessage();
void handleCommand(const char *cmd);
void blinkLEDandBuzz();
String getTimestamp();
void checkSchedules();
void startAlarm();
void stopAlarm();
void addSchedule(uint8_t hour, uint8_t minute);
void clearSchedules();
void listSchedules();
int todayYmd();
// RTC diagnostics
void printRtcOnce();
bool rtcDebug = false;
unsigned long lastRtcDebug = 0;
void setRtcFromString(const String &cmd);

void setup() {
  Serial.begin(9600);
  sim.begin(9600);
  btSerial.begin(9600);

  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  if (!rtc.begin()) {
    Serial.println(F("RTC not found!"));
    while (1);
  }

  if (rtc.lostPower()) {
    Serial.println(F("RTC lost power, setting time!"));
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  if (!SD.begin(CHIP_SELECT)) {
    Serial.println(F("SD card failed! Running without SD."));
  } else {
    logToSD(F("SYSTEM_START"), F("PillNow IoT system started"));
  }

  sim.println("AT");
  delay(500);
  sim.println("AT+CMGF=1");
  delay(500);
  sim.println("AT+CNMI=1,2,0,0,0");
  delay(500);

  Serial.println(F("System ready!"));
}

void loop() {
  if (Serial.available()) {
    String cmd = Serial.readStringUntil('\n');
    cmd.trim();
    handleCommand(cmd.c_str());
  }

  if (btSerial.available()) {
    String cmd = btSerial.readStringUntil('\n');
    cmd.trim();
    handleCommand(cmd.c_str());
  }

  // LED blinking handler
  if (ledBlinking && millis() - lastBlinkTime >= 200) {
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
    lastBlinkTime = millis();
    blinkCount++;
    if (blinkCount >= 10) {
      ledBlinking = false;
      digitalWrite(LED_PIN, LOW);
    }
  }

  // Stop after 5 sec if not locating and no alarm is active
  if (!locateBoxActive && !alarmActive && millis() - ledOnTime > 5000) {
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
  }

  // Locate buzzing
  if (locateBoxActive && millis() - lastLocateBuzz >= 500) {
    digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
    lastLocateBuzz = millis();
  }

  // Alarm buzzing (medication schedule)
  if (alarmActive) {
    unsigned long nowMs = millis();
    if (nowMs - lastAlarmToggle >= 400) {
      digitalWrite(BUZZER_PIN, !digitalRead(BUZZER_PIN));
      lastAlarmToggle = nowMs;
    }
    // auto-stop after max duration
    if (nowMs - alarmStartTime >= alarmMaxDurationMs) {
      stopAlarm();
    }
  }

  RecieveMessage();

  // Check schedules once per loop (RTC granularity handles matching)
  checkSchedules();

  // RTC debug streaming (once per second)
  if (rtcDebug && millis() - lastRtcDebug >= 1000) {
    String ts = getTimestamp();
    Serial.print(F("RTC_NOW "));
    Serial.println(ts);
    btSerial.print(F("RTC_NOW "));
    btSerial.println(ts);
    lastRtcDebug = millis();
  }
}

// ===== Helper Functions =====
void handleCommand(const char *cmd) {
  // Preserve raw for argument parsing
  String raw = String(cmd);
  raw.trim();
  // Also build a normalized version for simple commands
  String upper = raw; upper.toUpperCase();
  String normalized = "";
  for (size_t i = 0; i < upper.length(); i++) {
    char ch = upper.charAt(i);
    if (ch != ' ' && ch != '_') { normalized += ch; }
  }

  if (normalized == "S") {
    sendSMS(F("Medication reminder!"));
    return;
  }
  if (normalized == "C") { callNumber(); return; }
  if (normalized == "LOCATE") { startLocateBox(); return; }
  if (normalized == "STOP" || normalized == "STOPLOCATE") { stopLocateBox(); stopAlarm(); return; }
  if (normalized == "TIME") { sendTimeSMS(); return; }
  // ALARM TEST, STOP
  if (normalized == "ALARMTEST") { startAlarm(); return; }
  if (normalized == "ALARMSTOP") { stopAlarm(); return; }

  // SETTIME YYYY-MM-DD HH:MM:SS
  if (upper.startsWith("SETTIME")) { setRtcFromString(raw); return; }

  // RTC diagnostics commands
  if (normalized == "RTC?" || normalized == "RTC") { printRtcOnce(); return; }
  {
    String up2 = upper;
    if (up2.startsWith("RTC") && up2.indexOf("DEBUG") >= 0) {
      if (up2.indexOf("ON") >= 0) {
        rtcDebug = true;
        Serial.println(F("RTC_DEBUG_ON"));
        btSerial.println(F("RTC_DEBUG_ON"));
        return;
      }
      if (up2.indexOf("OFF") >= 0) {
        rtcDebug = false;
        Serial.println(F("RTC_DEBUG_OFF"));
        btSerial.println(F("RTC_DEBUG_OFF"));
        return;
      }
    }
  }

  // Scheduling commands (raw parsing with spaces):
  // Formats:
  //   SCHED ADD HH:MM
  //   SCHED CLEAR
  //   SCHED LIST
  {
    String up = raw; up.toUpperCase();
    if (up.startsWith("SCHED")) {
      if (up.indexOf("ADD") >= 0) {
        // Extract last token as HH:MM
        int spaceIdx = raw.lastIndexOf(' ');
        if (spaceIdx > 0 && spaceIdx + 1 < (int)raw.length()) {
          String timeToken = raw.substring(spaceIdx + 1);
          int colon = timeToken.indexOf(':');
          if (colon > 0) {
            int h = timeToken.substring(0, colon).toInt();
            int m = timeToken.substring(colon + 1).toInt();
            if (h >= 0 && h < 24 && m >= 0 && m < 60) {
              addSchedule((uint8_t)h, (uint8_t)m);
              String msg = "SCHEDULE_ADDED "; msg += timeToken;
              Serial.println(msg); btSerial.println(msg);
              logToSD(F("SCHED_ADD"), F("Added HH:MM"));
              return;
            }
          }
        }
        Serial.println(F("SCHEDULE_ADD_INVALID"));
        btSerial.println(F("SCHEDULE_ADD_INVALID"));
        return;
      }
      if (up.indexOf("CLEAR") >= 0) {
        clearSchedules();
        Serial.println(F("SCHEDULES_CLEARED"));
        btSerial.println(F("SCHEDULES_CLEARED"));
        logToSD(F("SCHED_CLEAR"), F("Cleared"));
        return;
      }
      if (up.indexOf("LIST") >= 0) {
        listSchedules();
        return;
      }
    }
  }

  Serial.println(F("Unknown command"));
}

void sendSMS(const __FlashStringHelper *msg) {
  Serial.println(F("Sending SMS..."));
  sim.print(F("AT+CMGS=\""));
  sim.print(phoneNumber);
  sim.println(F("\""));
  delay(500);
  sim.print(F("PillNow: "));
  sim.println(msg);
  sim.println((char)26);
  delay(1000);
  blinkLEDandBuzz();
  logToSD(F("SMS_SENT"), F("Reminder sent"));
}

void callNumber() {
  Serial.println(F("Calling..."));
  sim.print(F("ATD"));
  sim.print(phoneNumber);
  sim.println(F(";"));
  delay(1000);
  blinkLEDandBuzz();
  logToSD(F("CALL_SENT"), F("Call made"));
}

void sendTimeSMS() {
  String timeNow = getTimestamp();
  sim.print(F("AT+CMGS=\""));
  sim.print(phoneNumber);
  sim.println(F("\""));
  delay(500);
  sim.print(F("Current time: "));
  sim.println(timeNow);
  sim.println((char)26);
  delay(1000);
}

void startLocateBox() {
  locateBoxActive = true;
  digitalWrite(BUZZER_PIN, HIGH);
  Serial.println(F("Locate started"));
  btSerial.println(F("LOCATE_STARTED"));
  logToSD(F("LOCATE_START"), F("Locate mode active"));
}

void stopLocateBox() {
  locateBoxActive = false;
  digitalWrite(BUZZER_PIN, LOW);
  // Ensure LED/buzzer related transient states are cleared immediately
  ledBlinking = false;
  blinkCount = 0;
  digitalWrite(LED_PIN, LOW);
  lastLocateBuzz = millis();
  Serial.println(F("Locate stopped"));
  btSerial.println(F("LOCATE_STOPPED"));
  logToSD(F("LOCATE_STOP"), F("Locate mode stopped"));
}

void RecieveMessage() {
  if (sim.available()) {
    String msg = sim.readString();
    msg.trim();
    if (msg.indexOf("LOCATE") >= 0) startLocateBox();
    else if (msg.indexOf("STOP") >= 0) stopLocateBox();
  }
}

String getTimestamp() {
  DateTime now = rtc.now();
  char buf[25];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d",
           now.year(), now.month(), now.day(),
           now.hour(), now.minute(), now.second());
  return String(buf);
}

void printRtcOnce() {
  String ts = getTimestamp();
  Serial.print(F("RTC_NOW "));
  Serial.println(ts);
  btSerial.print(F("RTC_NOW "));
  btSerial.println(ts);
}

void blinkLEDandBuzz() {
  ledBlinking = true;
  blinkCount = 0;
  digitalWrite(BUZZER_PIN, HIGH);
  ledOnTime = millis();
}

void logToSD(const __FlashStringHelper *event, const __FlashStringHelper *data) {
  if (!SD.begin(CHIP_SELECT)) return;
  myFile = SD.open("log.txt", FILE_WRITE);
  if (myFile) {
    String entry = String("[") + getTimestamp() + "] " + String(event) + ": " + String(data);
    myFile.println(entry);
    myFile.close();
  }
}

// ===== Scheduling helpers =====
void startAlarm() {
  alarmActive = true;
  alarmStartTime = millis();
  lastAlarmToggle = 0;
  digitalWrite(BUZZER_PIN, HIGH);
  digitalWrite(LED_PIN, HIGH);
  btSerial.println(F("ALARM_STARTED"));
  Serial.println(F("ALARM_STARTED"));
  logToSD(F("ALARM_START"), F("Triggered by schedule"));
}

void stopAlarm() {
  if (!alarmActive) return;
  alarmActive = false;
  digitalWrite(BUZZER_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  btSerial.println(F("ALARM_STOPPED"));
  Serial.println(F("ALARM_STOPPED"));
  logToSD(F("ALARM_STOP"), F("Stopped"));
}

int todayYmd() {
  DateTime now = rtc.now();
  return now.year() * 10000 + now.month() * 100 + now.day();
}

void checkSchedules() {
  DateTime now = rtc.now();
  int ymd = now.year() * 10000 + now.month() * 100 + now.day();
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].inUse) continue;
    if (schedules[i].hour == now.hour() && schedules[i].minute == now.minute()) {
      if (schedules[i].lastTriggeredYmd != ymd) {
        schedules[i].lastTriggeredYmd = ymd;
        startAlarm();
      }
    }
    // Reset lastTriggered for missed days automatically when day changes handled by ymd compare
  }
}

void addSchedule(uint8_t hour, uint8_t minute) {
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (!schedules[i].inUse) {
      schedules[i].inUse = true;
      schedules[i].hour = hour;
      schedules[i].minute = minute;
      schedules[i].lastTriggeredYmd = 0;
      return;
    }
  }
  // If full, replace the last one
  schedules[MAX_SCHEDULES - 1].inUse = true;
  schedules[MAX_SCHEDULES - 1].hour = hour;
  schedules[MAX_SCHEDULES - 1].minute = minute;
  schedules[MAX_SCHEDULES - 1].lastTriggeredYmd = 0;
}

void clearSchedules() {
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    schedules[i].inUse = false;
    schedules[i].lastTriggeredYmd = 0;
  }
}

void listSchedules() {
  Serial.println(F("SCHEDULES_BEGIN"));
  btSerial.println(F("SCHEDULES_BEGIN"));
  for (int i = 0; i < MAX_SCHEDULES; i++) {
    if (schedules[i].inUse) {
      char buf[16];
      snprintf(buf, sizeof(buf), "%02d:%02d", schedules[i].hour, schedules[i].minute);
      Serial.println(buf);
      btSerial.println(buf);
    }
  }
  Serial.println(F("SCHEDULES_END"));
  btSerial.println(F("SCHEDULES_END"));
}

void setRtcFromString(const String &cmd) {
  // Expects format: SETTIME YYYY-MM-DD HH:MM:SS
  int y, M, d, h, m, s;
  int sp = cmd.indexOf(' '); // Space after SETTIME
  if (sp < 0) goto fail;
  String tpart = cmd.substring(sp + 1);
  int dash1 = tpart.indexOf('-');
  int dash2 = tpart.indexOf('-', dash1 + 1);
  int space2 = tpart.indexOf(' ');
  int colon1 = tpart.indexOf(':', space2);
  int colon2 = tpart.indexOf(':', colon1 + 1);
  if (dash1 < 0 || dash2 < 0 || space2 < 0 || colon1 < 0 || colon2 < 0) goto fail;
  y = tpart.substring(0, dash1).toInt();
  M = tpart.substring(dash1 + 1, dash2).toInt();
  d = tpart.substring(dash2 + 1, space2).toInt();
  h = tpart.substring(space2 + 1, colon1).toInt();
  m = tpart.substring(colon1 + 1, colon2).toInt();
  s = tpart.substring(colon2 + 1).toInt();
  if (y < 2000 || M < 1 || M > 12 || d < 1 || h < 0 || h > 23 || m < 0 || m > 59 || s < 0 || s > 59) goto fail;
  rtc.adjust(DateTime(y, M, d, h, m, s));
  String msg = "RTC_SET "; msg += tpart;
  Serial.println(msg); btSerial.println(msg);
  logToSD(F("RTC_SET"), F("RTC set by user"));
  return;
fail:
  Serial.println(F("RTC_SET_FAIL")); btSerial.println(F("RTC_SET_FAIL"));
}
