MQTT topics and ingest API

- Command to device: `pillnow/{deviceId}/cmd`
  - Payload example:
  ```json
  {"action":"capture","container":"morning","expected":{"count":7}}
  ```

- Device status: `pillnow/{deviceId}/status`
  - Example: `{ "state":"verified", "container":"morning", "pass":true }`

- HTTP ingest from ESP32‑CAM:
  - POST `/ingest/{deviceId}/{container}`
  - multipart/form-data:
    - `image`: binary image file
    - `meta`: JSON string, optional, can include `expected`

- Latest verification:
  - GET `/containers/{containerId}/verification`

Environment variables

- `MQTT_BROKER_URL` (default `mqtt://localhost`)
- `VERIFIER_URL` (default `http://127.0.0.1:8000/verify`)



