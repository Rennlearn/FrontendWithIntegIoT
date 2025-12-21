#include <WiFi.h>
#include <PubSubClient.h>
#include "esp_camera.h"

// ================== USER CONFIG ==================
// Fill these with your network and server settings
static const char* WIFI_SSID = "YOUR_WIFI_SSID";      // <-- set this to your WiFi name
static const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";  // <-- set this to your WiFi password

// IMPORTANT: Use your Mac's current LAN IP so ESP32-CAM can reach it.
// Mac LAN IP (en0): 10.100.56.91 (UPDATE THIS if your Mac's IP changes!)
static const char* MQTT_HOST = "10.100.56.91";    // Mosquitto/Broker host
static const uint16_t MQTT_PORT = 1883;

// Node backend (uploads to /ingest/:deviceId/:container)
static const char* BACKEND_HOST = "10.100.56.91"; // Node backend host
static const uint16_t BACKEND_PORT = 5001;         // Node backend port (avoid AirTunes conflict)

static const char* DEVICE_ID = "container2";         // Unique per ESP32-CAM: container1|container2|container3

// =================================================

WiFiClient wifiClient;
PubSubClient mqttClient(wifiClient);

// ===== Camera pin configuration (AI Thinker) =====
// Change if you use a different ESP32-CAM module
#define PWDN_GPIO_NUM     32
#define RESET_GPIO_NUM    -1
#define XCLK_GPIO_NUM      0
#define SIOD_GPIO_NUM     26
#define SIOC_GPIO_NUM     27

#define Y9_GPIO_NUM       35
#define Y8_GPIO_NUM       34
#define Y7_GPIO_NUM       39
#define Y6_GPIO_NUM       36
#define Y5_GPIO_NUM       21
#define Y4_GPIO_NUM       19
#define Y3_GPIO_NUM       18
#define Y2_GPIO_NUM        5
#define VSYNC_GPIO_NUM    25
#define HREF_GPIO_NUM     23
#define PCLK_GPIO_NUM     22

// Flash LED pin (built-in LED on most ESP32-CAM boards)
static const gpio_num_t FLASH_GPIO_NUM = GPIO_NUM_4;
// Flash tuning (helps pill detection accuracy)
static const bool FLASH_ENABLED = true;
static const uint16_t FLASH_PRECAPTURE_MS = 300;   // let flash + sensor stabilize before capture (increased for better pill detection)
static const uint16_t FLASH_POSTCAPTURE_MS = 20;   // tiny hold to avoid abrupt cutoff artifacts
static const uint8_t FLASH_DISCARD_FRAMES = 2;     // discard first 2 frames after enabling flash (exposure settles better for pill detection)
// Flash brightness (to reduce glare and improve pill imprint/brand visibility)
// Many ESP32-CAM boards (AI Thinker) can PWM-dim GPIO4 via LEDC.
// IMPORTANT: Camera uses LEDC_CHANNEL_0 for XCLK, so we use a different channel for flash.
static const bool FLASH_USE_PWM = true;            // set false to force simple ON/OFF
static const uint8_t FLASH_PWM_DUTY = 60;          // 0..255 (lower = dimmer). 60 = optimal for pill detection (good contrast without glare)
static const uint32_t FLASH_PWM_FREQ_HZ = 5000;    // 1k-10k is typical
static const uint8_t FLASH_PWM_RES_BITS = 8;       // 8-bit duty (0..255)
static const uint8_t FLASH_PWM_CHANNEL = 1;        // used only on older ESP32 core (pre-3.x)

static bool flashPwmReady = false;

static void flashInit();
static void flashOn();
static void flashOff();

// Topics
String topicCmd = String("pillnow/") + DEVICE_ID + "/cmd";
String topicStatus = String("pillnow/") + DEVICE_ID + "/status";

// Forward decls
static void ensureWifi();
static void ensureMqtt();
static void handleMqttMessage(char* topic, byte* payload, unsigned int length);
static bool captureAndUpload(const char* container, const char* expectedJson);
static bool testBrokerReachability();

void setup() {
  Serial.begin(115200);

  // Camera config
  camera_config_t config;
  config.ledc_channel = LEDC_CHANNEL_0;
  config.ledc_timer = LEDC_TIMER_0;
  config.pin_d0 = Y2_GPIO_NUM;
  config.pin_d1 = Y3_GPIO_NUM;
  config.pin_d2 = Y4_GPIO_NUM;
  config.pin_d3 = Y5_GPIO_NUM;
  config.pin_d4 = Y6_GPIO_NUM;
  config.pin_d5 = Y7_GPIO_NUM;
  config.pin_d6 = Y8_GPIO_NUM;
  config.pin_d7 = Y9_GPIO_NUM;
  config.pin_xclk = XCLK_GPIO_NUM;
  config.pin_pclk = PCLK_GPIO_NUM;
  config.pin_vsync = VSYNC_GPIO_NUM;
  config.pin_href = HREF_GPIO_NUM;
  config.pin_sscb_sda = SIOD_GPIO_NUM;
  config.pin_sscb_scl = SIOC_GPIO_NUM;
  config.pin_pwdn = PWDN_GPIO_NUM;
  config.pin_reset = RESET_GPIO_NUM;
  config.xclk_freq_hz = 20000000;
  config.pixel_format = PIXFORMAT_JPEG;
  config.frame_size = FRAMESIZE_VGA;  // start with VGA to avoid FB overflow
  config.jpeg_quality = 12;           // 10-12 good balance
  config.fb_count = 1;
  config.fb_location = CAMERA_FB_IN_PSRAM;

  if (psramFound()) {
    config.fb_location = CAMERA_FB_IN_PSRAM;
    config.grab_mode = CAMERA_GRAB_WHEN_EMPTY;
  } else {
    config.fb_location = CAMERA_FB_IN_DRAM;
    config.grab_mode = CAMERA_GRAB_LATEST;
  }

  esp_err_t err = esp_camera_init(&config);
  if (err != ESP_OK) {
    Serial.printf("Camera init failed with error 0x%x\n", err);
  } else {
    // Configure camera sensor for better pill detection with flash
    sensor_t *s = esp_camera_sensor_get();
    if (s) {
      // Adjust exposure and brightness for flash photography
      s->set_brightness(s, 0);        // 0 = normal brightness (range: -2 to 2)
      s->set_contrast(s, 0);         // 0 = normal contrast (range: -2 to 2)
      s->set_saturation(s, 0);       // 0 = normal saturation (range: -2 to 2)
      s->set_special_effect(s, 0);    // 0 = no effect
      s->set_whitebal(s, 1);          // 1 = auto white balance
      s->set_awb_gain(s, 1);         // 1 = auto white balance gain
      s->set_wb_mode(s, 0);          // 0 = auto white balance mode
      s->set_exposure_ctrl(s, 1);    // 1 = auto exposure
      s->set_aec2(s, 0);             // 0 = disable AEC2 (auto exposure control 2)
      s->set_ae_level(s, 0);         // 0 = normal exposure level (range: -2 to 2)
      s->set_aec_value(s, 300);      // AEC value (0-1200), lower = brighter, higher = darker
      s->set_gain_ctrl(s, 1);        // 1 = auto gain control
      s->set_agc_gain(s, 0);         // 0 = auto gain (range: 0-30)
      s->set_gainceiling(s, (gainceiling_t)6); // Gain ceiling (0-6), lower = less gain
      s->set_bpc(s, 0);              // 0 = disable black pixel correction
      s->set_wpc(s, 1);              // 1 = enable white pixel correction
      s->set_raw_gma(s, 1);          // 1 = enable raw gamma
      s->set_lenc(s, 1);             // 1 = enable lens correction
      s->set_hmirror(s, 0);          // 0 = no horizontal mirror
      s->set_vflip(s, 0);            // 0 = no vertical flip
      s->set_dcw(s, 1);              // 1 = enable downsize EN
      s->set_colorbar(s, 0);         // 0 = disable color bar
      Serial.println("Camera sensor configured for flash photography");
    }
  }

  // Flash LED setup
  pinMode(FLASH_GPIO_NUM, OUTPUT);
  digitalWrite(FLASH_GPIO_NUM, LOW);
  flashInit();

  ensureWifi();

  mqttClient.setServer(MQTT_HOST, MQTT_PORT);
  mqttClient.setCallback(handleMqttMessage);
}

void loop() {
  ensureWifi();
  ensureMqtt();
  mqttClient.loop();
  delay(10);
}

static void ensureWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("Connecting WiFi");
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 60) {
    delay(500);
    Serial.print('.');
    retries++;
  }
  Serial.println();
  Serial.print("WiFi "); Serial.println(WiFi.status() == WL_CONNECTED ? "OK" : "FAIL");
}

static void ensureMqtt() {
  if (mqttClient.connected()) return;
  Serial.print("Connecting MQTT to "); Serial.print(MQTT_HOST); Serial.print(":"); Serial.println(MQTT_PORT);
  // Quick TCP reachability test to help diagnose network issues
  if (!testBrokerReachability()) {
    Serial.println("MQTT broker not reachable via TCP. Check broker IP, port 1883, and LAN/firewall.");
  }
  String clientId = String("esp32cam-") + DEVICE_ID + String("-") + String((uint32_t)ESP.getEfuseMac(), HEX);
  Serial.print("MQTT Client ID: "); Serial.println(clientId);
  Serial.print("Subscribing to topic: "); Serial.println(topicCmd);
  
  int retries = 0;
  while (!mqttClient.connected() && retries < 10) {
    if (mqttClient.connect(clientId.c_str())) {
      Serial.println("✅ MQTT connected!");
      Serial.print("📡 Subscribing to: "); Serial.println(topicCmd);
      bool subOk = mqttClient.subscribe(topicCmd.c_str());
      if (subOk) {
        Serial.println("✅ Subscription successful");
      } else {
        Serial.println("❌ Subscription FAILED!");
      }
      mqttClient.publish(topicStatus.c_str(), "{\"state\":\"online\"}");
      Serial.println("📤 Published online status");
      return;
    } else {
      Serial.print('.');
      delay(1000);
      retries++;
    }
  }
  Serial.println();
  Serial.println("❌ MQTT connection FAILED after 10 retries");
}

static bool testBrokerReachability() {
  WiFiClient probe;
  bool ok = probe.connect(MQTT_HOST, MQTT_PORT);
  if (ok) {
    Serial.println("TCP test: connected to broker port 1883");
    probe.stop();
    return true;
  } else {
    Serial.println("TCP test: FAILED to connect to broker port 1883");
    return false;
  }
}

static void handleMqttMessage(char* topic, byte* payload, unsigned int length) {
  // Very light parsing: look for action and container
  String msg;
  msg.reserve(length + 1);
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  
  Serial.println("========================================");
  Serial.println("📨 MQTT MESSAGE RECEIVED");
  Serial.print("   Topic: "); Serial.println(topic);
  Serial.print("   Length: "); Serial.println(length);
  Serial.print("   Payload: "); Serial.println(msg);
  Serial.println("========================================");

  // Check for capture action (handle both with and without spaces)
  bool hasCaptureAction = msg.indexOf("\"action\":\"capture\"") >= 0 || msg.indexOf("\"action\" : \"capture\"") >= 0;
  
  Serial.print("🔍 Checking for capture action... ");
  if (hasCaptureAction) {
    Serial.println("✅ FOUND!");
    Serial.println("✅ CAPTURE COMMAND RECEIVED - Starting capture...");
    
    // Extract container (fallback to DEVICE_ID if missing)
    String container = DEVICE_ID;
    int cidx = msg.indexOf("\"container\"");
    if (cidx >= 0) {
      // Find the colon after "container"
      int colon = msg.indexOf(':', cidx);
      if (colon > 0) {
        // Find the opening quote of the value
        int q1 = msg.indexOf('"', colon);
        if (q1 > 0) {
          // Find the closing quote
          int q2 = msg.indexOf('"', q1 + 1);
          if (q2 > q1) {
            container = msg.substring(q1 + 1, q2);
          }
        }
      }
    }

    // Extract expected JSON if present; else build count-only empty JSON
    String expected = "{}";
    int eidx = msg.indexOf("\"expected\"");
    if (eidx >= 0) {
      // naive extraction: substring from first '{' after expected to matching '}'
      int braceStart = msg.indexOf('{', eidx);
      if (braceStart >= 0) {
        // find closing '}' (not robust for nested objects but okay for our simple payloads)
        int depth = 0;
        for (int i = braceStart; i < (int)msg.length(); i++) {
          if (msg[i] == '{') depth++;
          if (msg[i] == '}') { depth--; if (depth == 0) { expected = msg.substring(braceStart, i + 1); break; } }
        }
      }
    }

    Serial.print("Extracted container: "); Serial.println(container);
    Serial.print("Extracted expected: "); Serial.println(expected);
    mqttClient.publish(topicStatus.c_str(), "{\"state\":\"capturing\"}");
    bool ok = captureAndUpload(container.c_str(), expected.c_str());
    mqttClient.publish(topicStatus.c_str(), ok ? "{\"state\":\"uploaded\"}" : "{\"state\":\"error\"}");
  } else {
    Serial.println("❌ NOT FOUND");
    Serial.println("   Message does not contain capture action, ignoring...");
    return;
  }
}

static void flashInit() {
  if (!FLASH_ENABLED) return;
  if (!FLASH_USE_PWM) {
    flashPwmReady = false;
    return;
  }

  // ESP32 Arduino core changed LEDC API in v3.x:
  // - Removed: ledcSetup(), ledcAttachPin()
  // - Use: ledcAttach(pin, freq, resolution) and ledcWrite(pin, duty)
  //
  // Support both APIs via version check.
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
  // New API (core v3+)
  bool ok = ledcAttach((uint8_t)FLASH_GPIO_NUM, FLASH_PWM_FREQ_HZ, FLASH_PWM_RES_BITS);
  if (ok) {
    ledcWrite((uint8_t)FLASH_GPIO_NUM, 0);
    flashPwmReady = true;
    Serial.println("Flash PWM enabled (dimmable, core v3+)");
  } else {
    flashPwmReady = false;
    Serial.println("Flash PWM attach failed; using ON/OFF flash");
  }
#else
  // Old API (core v2.x)
  bool ok = true;
  ok = ok && ledcSetup(FLASH_PWM_CHANNEL, FLASH_PWM_FREQ_HZ, FLASH_PWM_RES_BITS);
  if (ok) {
    ledcAttachPin((uint8_t)FLASH_GPIO_NUM, FLASH_PWM_CHANNEL);
    ledcWrite(FLASH_PWM_CHANNEL, 0);
    flashPwmReady = true;
    Serial.println("Flash PWM enabled (dimmable, core v2.x)");
  } else {
    flashPwmReady = false;
    Serial.println("Flash PWM setup failed; using ON/OFF flash");
  }
#endif
}

static void flashOn() {
  if (!FLASH_ENABLED) return;
  if (flashPwmReady) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
    ledcWrite((uint8_t)FLASH_GPIO_NUM, FLASH_PWM_DUTY);
#else
    ledcWrite(FLASH_PWM_CHANNEL, FLASH_PWM_DUTY);
#endif
  } else {
    digitalWrite(FLASH_GPIO_NUM, HIGH);
  }
}

static void flashOff() {
  if (!FLASH_ENABLED) return;
  if (flashPwmReady) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && (ESP_ARDUINO_VERSION_MAJOR >= 3)
    ledcWrite((uint8_t)FLASH_GPIO_NUM, 0);
#else
    ledcWrite(FLASH_PWM_CHANNEL, 0);
#endif
  } else {
    digitalWrite(FLASH_GPIO_NUM, LOW);
  }
}

static bool captureAndUpload(const char* container, const char* expectedJson) {
  Serial.println("📸 Starting capture sequence...");
  
  // Configure camera for flash photography before turning on flash
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    Serial.println("⚙️ Configuring camera for pill detection...");
    // Optimize exposure and gain for pill detection with flash
    s->set_aec_value(s, 180);        // Lower AEC value = less exposure (prevents overexposure, better pill detail)
    s->set_agc_gain(s, 8);           // Moderate gain for good contrast (range: 0-30)
    s->set_gainceiling(s, (gainceiling_t)5); // Moderate gain ceiling
    s->set_ae_level(s, -1);         // Slightly darker exposure level for better pill edge detection
    s->set_contrast(s, 1);          // Slightly higher contrast for pill imprint visibility
    delay(100); // Allow sensor to adjust
    Serial.println("✅ Camera configured");
  }
  
  if (FLASH_ENABLED) {
    Serial.print("💡 Turning on flash (PWM duty: ");
    Serial.print(FLASH_PWM_DUTY);
    Serial.println(")...");
    // Turn on flash (dimmable if PWM is supported)
    flashOn();
    Serial.print("⏳ Stabilizing flash and sensor (");
    Serial.print(FLASH_PRECAPTURE_MS);
    Serial.println("ms)...");
    delay(FLASH_PRECAPTURE_MS);
  }

  // Many ESP32-CAMs return an under/over-exposed first frame when lighting changes.
  // Discard frames after enabling flash to stabilize exposure for better ML accuracy.
  Serial.print("🔄 Discarding ");
  Serial.print(FLASH_DISCARD_FRAMES);
  Serial.println(" frames for exposure stabilization...");
  for (uint8_t i = 0; i < FLASH_DISCARD_FRAMES; i++) {
    camera_fb_t* tmp = esp_camera_fb_get();
    if (tmp) {
      esp_camera_fb_return(tmp);
      Serial.print("  Discarded frame ");
      Serial.println(i + 1);
    }
    delay(50); // Longer delay between discards for better stabilization
  }

  // Capture the "stable" frame
  Serial.println("📷 Capturing final frame...");
  camera_fb_t* fb = esp_camera_fb_get();

  if (FLASH_ENABLED) {
    delay(FLASH_POSTCAPTURE_MS);
    flashOff();
  }
  
  // Restore camera settings for normal operation
  if (s) {
    delay(50); // Small delay before restoring settings
    s->set_aec_value(s, 300);        // Restore normal AEC
    s->set_agc_gain(s, 0);           // Restore auto gain
    s->set_gainceiling(s, (gainceiling_t)6); // Restore normal gain ceiling
    s->set_ae_level(s, 0);           // Restore normal exposure level
  }

  if (!fb) {
    Serial.println("Camera capture failed");
    return false;
  }

  // Build HTTP multipart POST to /ingest/{deviceId}/{container}
  String boundary = "----pillnowBoundary7MA4YWxkTrZu0gW";
  String path = String("/ingest/") + DEVICE_ID + "/" + container;

  if (!wifiClient.connect(BACKEND_HOST, BACKEND_PORT)) {
    Serial.println("HTTP connect failed");
    esp_camera_fb_return(fb);
    return false;
  }

  // Precompute sizes
  // Fields expected by backend/server.js: image (file), meta (optional JSON string)
  String part1 = String("--") + boundary + "\r\n" +
                 "Content-Disposition: form-data; name=\"image\"; filename=\"capture.jpg\"\r\n" +
                 "Content-Type: image/jpeg\r\n\r\n";
  String part2 = String("\r\n--") + boundary + "\r\n" +
                 "Content-Disposition: form-data; name=\"meta\"\r\n\r\n" +
                 String(expectedJson) + "\r\n" +
                 String("--") + boundary + "--\r\n";

  size_t contentLength = part1.length() + fb->len + part2.length();

  // Send request headers
  wifiClient.printf("POST %s HTTP/1.1\r\n", path.c_str());
  wifiClient.printf("Host: %s:%u\r\n", BACKEND_HOST, BACKEND_PORT);
  wifiClient.println("Connection: close");
  wifiClient.printf("Content-Type: multipart/form-data; boundary=%s\r\n", boundary.c_str());
  wifiClient.printf("Content-Length: %u\r\n\r\n", (unsigned)contentLength);

  // Send body
  wifiClient.print(part1);
  wifiClient.write(fb->buf, fb->len);
  wifiClient.print(part2);

  // Read response (basic)
  uint32_t start = millis();
  bool localSuccess = false;
  while (wifiClient.connected() && millis() - start < 5000) {
    while (wifiClient.available()) {
      String line = wifiClient.readStringUntil('\n');
      // Optional: parse for HTTP/1.1 200 OK
      if (line.startsWith("HTTP/1.1")) {
        Serial.print("HTTP: "); Serial.println(line);
        if (line.indexOf("200") >= 0) {
          localSuccess = true;
        }
      }
    }
  }
  wifiClient.stop();

  // Done with frame buffer
  esp_camera_fb_return(fb);

  return localSuccess;
}

