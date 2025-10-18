// Simple Buzzer Test for PillNow IoT
// Upload this to test if your buzzer hardware is working

int buzzerPin = 7; // Same pin as your main code

void setup() {
  Serial.begin(9600);
  pinMode(buzzerPin, OUTPUT);
  
  Serial.println("=== BUZZER TEST ===");
  Serial.println("Testing buzzer on pin 7...");
  Serial.println("You should hear beeps!");
  
  // Test 1: Continuous tone for 2 seconds
  Serial.println("Test 1: Continuous tone (2 seconds)");
  digitalWrite(buzzerPin, HIGH);
  delay(2000);
  digitalWrite(buzzerPin, LOW);
  delay(1000);
  
  // Test 2: Beeping pattern
  Serial.println("Test 2: Beeping pattern (5 beeps)");
  for (int i = 0; i < 5; i++) {
    digitalWrite(buzzerPin, HIGH);
    delay(200);
    digitalWrite(buzzerPin, LOW);
    delay(200);
  }
  delay(1000);
  
  // Test 3: Fast beeping
  Serial.println("Test 3: Fast beeping (10 beeps)");
  for (int i = 0; i < 10; i++) {
    digitalWrite(buzzerPin, HIGH);
    delay(100);
    digitalWrite(buzzerPin, LOW);
    delay(100);
  }
  
  Serial.println("=== TEST COMPLETE ===");
  Serial.println("If you heard beeps, your buzzer is working!");
  Serial.println("If no sound, check wiring:");
  Serial.println("- Buzzer positive (+) to pin 7");
  Serial.println("- Buzzer negative (-) to GND");
  Serial.println("- Make sure buzzer is 5V compatible");
}

void loop() {
  // Continuous test - press reset to repeat
  delay(5000);
  Serial.println("Repeating test...");
  
  // Quick beep every 5 seconds
  digitalWrite(buzzerPin, HIGH);
  delay(100);
  digitalWrite(buzzerPin, LOW);
}
