#include <SoftwareSerial.h>
#include <Wire.h>
#include "RTClib.h"

// ===== Function Declarations =====
void handleInput(char cmd);
void handleStringCommand(String cmd);
void SendMessage();
void RecieveMessage();
void callNumber();
void handleReceivedMessage(String msg);
String readSimResponse();
void startLocateBox();
void stopLocateBox();
String getTimestamp();
void sendTimeSMS();

// ===== Modules =====
SoftwareSerial sim(4, 5);     // SIM800L
SoftwareSerial btSerial(2, 3);  // HC-05 Bluetooth (RX, TX)
RTC_DS3231 rtc;                 // RTC module

// ===== Variables =====
String _buffer;
String number = "+639633800442"; // -> Change to your number
int ledPin = 8;    // LED pin
int buzzerPin = 7; // Buzzer pin

unsigned long ledOnTime = 0;
bool ledState = false;
bool ledBlinking = false;
int blinkCount = 0;
unsigned long lastBlinkTime = 0;

// Locate Box variables
bool locateBoxActive = false;
unsigned long lastLocateBuzz = 0;
const unsigned long locateBuzzInterval = 500; // Buzz every 500ms

void setup() {
  Serial.begin(9600);
  sim.begin(9600);
  btSerial.begin(9600);

  pinMode(ledPin, OUTPUT);
  pinMode(buzzerPin, OUTPUT);
  _buffer.reserve(100);

  // RTC Init
  if (!rtc.begin()) {
    Serial.println("RTC not found!");
    while (1);
  }

  if (rtc.lostPower()) {
    Serial.println("RTC lost power, setting time!");
    rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));
  }

  // SIM800L Init
  delay(1000);
  sim.println("AT");
  delay(1000);
  sim.println("AT+CMGF=1");
  delay(1000);
  sim.println("AT+CNMI=1,2,0,0,0");
  delay(1000);

  Serial.println("System Started...");
  Serial.println(String("Current RTC time: ") + getTimestamp());
  btSerial.println(String("Current RTC time: ") + getTimestamp());
  delay(1000);

  Serial.println("Type 's' to send SMS, 'r' to receive SMS, 'c' to call");
  Serial.println("Type 'LOCATE' to start locate box, 'STOP_LOCATE' to stop");
  Serial.println("Type 'TIME' to print and SMS the current time");
  btSerial.println("Bluetooth Connected. Type 's' to send SMS.");
}

void loop() {
  if (Serial.available()) {
    String input = Serial.readString();
    input.trim();
    handleStringCommand(input);
  }

  if (btSerial.available()) {
    String input = btSerial.readString();
    input.trim();
    handleStringCommand(input);
  }

  // Handle LED blinking
  if (ledBlinking && millis() - lastBlinkTime >= 200) {
    ledState = !ledState;
    digitalWrite(ledPin, ledState);
    lastBlinkTime = millis();
    blinkCount++;
    
    if (blinkCount >= 10) {
      ledBlinking = false;
      digitalWrite(ledPin, LOW);
      blinkCount = 0;
    }
  }

  // Turn off LED and buzzer after 5 sec (only if not in locate mode)
  if (millis() - ledOnTime > 5000 && !locateBoxActive) {
    digitalWrite(ledPin, LOW);
    digitalWrite(buzzerPin, LOW);
  }

  // Locate Box buzzing
  if (locateBoxActive && millis() - lastLocateBuzz >= locateBuzzInterval) {
    digitalWrite(buzzerPin, !digitalRead(buzzerPin)); // Toggle buzzer
    lastLocateBuzz = millis();
  }

  // Check for incoming SMS
  RecieveMessage();
}

// ===== SMS Functions =====
void SendMessage() {
  Serial.println(String("[") + getTimestamp() + "] Sending SMS...");
  sim.println("AT+CMGS=\"" + number + "\"");
  delay(1000);
  sim.println(String("PillNow Alert [") + getTimestamp() + "]: Medication reminder!");
  delay(1000);
  sim.println((char)26);
  delay(1000);
  Serial.println(String("[") + getTimestamp() + "] SMS sent!");
  
  // Blink LED and buzz buzzer
  ledBlinking = true;
  blinkCount = 0;
  digitalWrite(buzzerPin, HIGH);
  ledOnTime = millis();
}

void RecieveMessage() {
  if (sim.available()) {
    _buffer = sim.readString();
    if (_buffer.indexOf("+CMT:") >= 0) {
      delay(100);
      _buffer += sim.readString();
      handleReceivedMessage(_buffer);
      _buffer = "";
    } else if (_buffer.length() > 200) {
      _buffer = "";
    }
  }
}

void handleReceivedMessage(String msg) {
  Serial.println(String("[") + getTimestamp() + "] SMS received: " + msg);
  
  if (msg.indexOf("LOCATE") >= 0) {
    startLocateBox();
  } else if (msg.indexOf("STOP") >= 0) {
    stopLocateBox();
  }
}

String readSimResponse() {
  String response = "";
  unsigned long timeout = millis() + 5000;
  
  while (millis() < timeout) {
    if (sim.available()) {
      response += sim.readString();
      if (response.indexOf("OK") >= 0 || response.indexOf("ERROR") >= 0) {
        break;
      }
    }
  }
  
  return response;
}

// ===== Call Functions =====
void callNumber() {
  Serial.println(String("[") + getTimestamp() + "] Calling...");
  sim.println("ATD" + number + ";");
  delay(1000);
  Serial.println(String("[") + getTimestamp() + "] Call initiated!");
  
  // Blink LED and buzz buzzer
  ledBlinking = true;
  blinkCount = 0;
  digitalWrite(buzzerPin, HIGH);
  ledOnTime = millis();
}

// ===== Helper Functions =====
void handleInput(char cmd) {
  switch (cmd) {
    case 's':
      SendMessage();
      break;
    case 'r':
      RecieveMessage();
      break;
    case 'c':
      callNumber();
      break;
    default:
      Serial.println("Unknown command: " + String(cmd));
  }
}

void handleStringCommand(String cmd) {
  cmd.toUpperCase();
  Serial.println(String("[") + getTimestamp() + "] Command received: " + cmd);
  
  if (cmd == "S") {
    SendMessage();
  } else if (cmd == "R") {
    RecieveMessage();
  } else if (cmd == "C") {
    callNumber();
  } else if (cmd == "TIME") {
    String nowStr = getTimestamp();
    Serial.println(String("Current RTC time: ") + nowStr);
    btSerial.println(String("Current RTC time: ") + nowStr);
    sendTimeSMS();
  } else if (cmd == "LOCATE") {
    startLocateBox();
  } else if (cmd == "STOP_LOCATE") {
    stopLocateBox();
  } else {
    Serial.println("Unknown command: " + cmd);
  }
}

// ===== Locate Box Functions =====
void startLocateBox() {
  locateBoxActive = true;
  digitalWrite(buzzerPin, HIGH); // Start buzzing immediately
  Serial.println(String("[") + getTimestamp() + "] Locate box started - buzzer will buzz every 500ms");
  btSerial.println("LOCATE_STARTED");
}

void stopLocateBox() {
  locateBoxActive = false;
  digitalWrite(buzzerPin, LOW); // Stop buzzing
  Serial.println(String("[") + getTimestamp() + "] Locate box stopped");
  btSerial.println("LOCATE_STOPPED");
}

// ===== RTC Helpers =====
String getTimestamp() {
  DateTime now = rtc.now();
  char buf[25];
  snprintf(buf, sizeof(buf), "%04d-%02d-%02d %02d:%02d:%02d",
           now.year(), now.month(), now.day(), now.hour(), now.minute(), now.second());
  return String(buf);
}

void sendTimeSMS() {
  sim.println("AT+CMGS=\"" + number + "\"");
  delay(1000);
  sim.println(String("Current RTC time: ") + getTimestamp());
  delay(1000);
  sim.println((char)26);
  delay(1000);
}