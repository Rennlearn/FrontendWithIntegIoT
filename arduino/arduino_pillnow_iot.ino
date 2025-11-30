#include <SoftwareSerial.h>

// Pin definitions
#define LED_PIN 13
#define BUZZER_PIN 12
#define HC05_RX 2
#define HC05_TX 3
#define SIM_RX 4
#define SIM_TX 5

// Software serial for HC-05 Bluetooth
SoftwareSerial bluetooth(HC05_RX, HC05_TX);

// Software serial for SIM800L
SoftwareSerial sim800l(SIM_RX, SIM_TX);

// Variables
String receivedData = "";
bool ledState = false;
bool buzzerState = false;
String phoneNumber = "+1234567890"; // Replace with actual phone number

void setup() {
  // Initialize serial communication
  Serial.begin(9600);
  bluetooth.begin(9600);
  sim800l.begin(9600);
  
  // Initialize pins
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  
  // Initialize SIM module
  initializeSIM();
  
  Serial.println("PillNow IoT System Ready!");
  bluetooth.println("PillNow IoT System Ready!");
}

void loop() {
  // Check for Bluetooth commands
  if (bluetooth.available()) {
    char c = bluetooth.read();
    receivedData += c;
    
    if (c == '\n') {
      processCommand(receivedData);
      receivedData = "";
    }
  }
  
  // Check for serial commands (for debugging)
  if (Serial.available()) {
    char c = Serial.read();
    receivedData += c;
    
    if (c == '\n') {
      processCommand(receivedData);
      receivedData = "";
    }
  }
  
  delay(100);
}

void processCommand(String command) {
  command.trim();
  command.toUpperCase();
  
  Serial.println("Received: " + command);
  bluetooth.println("Received: " + command);
  
  if (command == "LED_ON") {
    digitalWrite(LED_PIN, HIGH);
    ledState = true;
    sendResponse("LED turned ON");
  }
  else if (command == "LED_OFF") {
    digitalWrite(LED_PIN, LOW);
    ledState = false;
    sendResponse("LED turned OFF");
  }
  else if (command == "BUZZER_ON") {
    digitalWrite(BUZZER_PIN, HIGH);
    buzzerState = true;
    sendResponse("Buzzer turned ON");
  }
  else if (command == "BUZZER_OFF") {
    digitalWrite(BUZZER_PIN, LOW);
    buzzerState = false;
    sendResponse("Buzzer turned OFF");
  }
  else if (command == "ALERT") {
    // Turn on both LED and buzzer for medication alert
    digitalWrite(LED_PIN, HIGH);
    digitalWrite(BUZZER_PIN, HIGH);
    ledState = true;
    buzzerState = true;
    sendResponse("Medication alert activated");
    
    // Send SMS notification
    sendSMS("Time to take your medication!");
  }
  else if (command == "STOP_ALERT") {
    // Turn off both LED and buzzer
    digitalWrite(LED_PIN, LOW);
    digitalWrite(BUZZER_PIN, LOW);
    ledState = false;
    buzzerState = false;
    sendResponse("Alert stopped");
  }
  else if (command == "STATUS") {
    String status = "LED: " + String(ledState ? "ON" : "OFF") + 
                   ", Buzzer: " + String(buzzerState ? "ON" : "OFF");
    sendResponse(status);
  }
  else if (command.startsWith("SMS:")) {
    // Extract message from command (format: SMS:message)
    String message = command.substring(4);
    sendSMS(message);
    sendResponse("SMS sent: " + message);
  }
  else if (command.startsWith("PHONE:")) {
    // Set phone number (format: PHONE:+1234567890)
    phoneNumber = command.substring(6);
    sendResponse("Phone number set to: " + phoneNumber);
  }
  else {
    sendResponse("Unknown command: " + command);
  }
}

void sendResponse(String response) {
  Serial.println(response);
  bluetooth.println(response);
}

void initializeSIM() {
  Serial.println("Initializing SIM module...");
  
  // Test AT command
  sim800l.println("AT");
  delay(1000);
  
  // Check if SIM is ready
  sim800l.println("AT+CPIN?");
  delay(1000);
  
  // Set SMS text mode
  sim800l.println("AT+CMGF=1");
  delay(1000);
  
  // Set character set
  sim800l.println("AT+CSCS=\"GSM\"");
  delay(1000);
  
  Serial.println("SIM module initialized");
}

void sendSMS(String message) {
  Serial.println("Sending SMS: " + message);
  
  // Set phone number
  sim800l.print("AT+CMGS=\"");
  sim800l.print(phoneNumber);
  sim800l.println("\"");
  delay(1000);
  
  // Send message
  sim800l.print(message);
  sim800l.write(26); // Ctrl+Z to send
  delay(1000);
  
  Serial.println("SMS sent successfully");
}

// Function to blink LED for visual feedback
void blinkLED(int times) {
  for (int i = 0; i < times; i++) {
    digitalWrite(LED_PIN, HIGH);
    delay(200);
    digitalWrite(LED_PIN, LOW);
    delay(200);
  }
}

// Function to play buzzer pattern
void playBuzzerPattern() {
  for (int i = 0; i < 3; i++) {
    digitalWrite(BUZZER_PIN, HIGH);
    delay(500);
    digitalWrite(BUZZER_PIN, LOW);
    delay(500);
  }
}










