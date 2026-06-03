# PillNow Developer Setup Guide

## Overview
This guide explains how to get the PillNow app working as a developer, including local app run, backend services, IoT setup, and optional email OTP support.

## Project structure
- `app/` — Expo React Native application code and routes
- `android/`, `ios/` — platform-specific native project files
- `backend/` — local Node.js backend server, REST endpoints, and MQTT integration
- `backend/verifier/` — Python FastAPI pill verification service
- `arduino/` — firmware sketches for Arduino/ESP32 devices
- `cloud/` — email OTP/password reset service
- `docs/` — hardware, Bluetooth, and IoT documentation
- `assets/` — app images, fonts, and static assets
- `scripts/` — service startup and IoT helper scripts
- `src/` — auxiliary support code and JavaScript utilities
- `types/` — TypeScript type declarations

## Prerequisites
- Node.js 18+ and npm
- Expo CLI
- Python 3
- `mosquitto` MQTT broker
- Android Studio for Android or Xcode for iOS
- Optional: `pm2` for service management

## Install dependencies
From the repository root:
```bash
npm install
```

Install Python dependencies for the verifier service:
```bash
cd backend/verifier
pip3 install -r requirements.txt
```

If using the Arduino bridge:
```bash
pip3 install paho-mqtt pyserial
```

## Configure environment
Copy the backend example env file:
```bash
cp backend/backend.env.example backend/backend.env
```
Update values as needed. Important values:
- `PORT=5001`
- `MQTT_BROKER_URL=mqtt://127.0.0.1:1883`
- `VERIFIER_URL=http://127.0.0.1:8000/verify`

Optional email settings:
- `EMAIL_ENABLED=true`
- `EMAIL_FROM`, `EMAIL_HOST`, `EMAIL_USER`, `EMAIL_PASS`

## Start the system
### Recommended: start all services
```bash
npm run start:all
```
Or:
```bash
./start-all.sh
```

### Stop services
```bash
npm run stop:all
```
Or:
```bash
./stop-all.sh
```

### Check status
```bash
npm run status
```
Or:
```bash
./status.sh
```

## What starts
- Backend server: `backend/server.js` on port `5001`
- Verifier service: FastAPI at `localhost:8000`
- Arduino bridge: `backend/arduino_alert_bridge.py`
- MQTT broker: `mosquitto` on port `1883`

## Start services manually
If you prefer manual startup:
```bash
npm run backend
npm run verifier
npm run arduino-bridge
```

## App development
From the repo root, start the Expo app:
```bash
npm start
```
Then run on a platform:
- `npm run android`
- `npm run ios`
- `npm run web`

## Important backend details
The backend reads `backend/backend.env`, then falls back to root `.env` if needed.
Key service URLs:
- `MQTT_BROKER_URL`: MQTT connection string
- `VERIFIER_URL`: image verification endpoint
- `AUTO_CAPTURE_ON_ALARM`: if true, backend triggers camera capture on alarm
- `SINGLE_CAMERA_DEVICE_ID`: route all camera capture commands to one device

## Arduino / IoT
Firmware lives in `arduino/`.
Common firmware files:
- `arduino_pillnow_iot.ino`
- `arduino_pillnow_iot_clean.ino`
- `arduino_pillnow_iot_with_locate.ino`

Use Arduino IDE or VS Code PlatformIO to upload the correct sketch to your device.

## Cloud email OTP service
The `cloud/` folder contains a separate service for password reset OTP.
Start it with:
```bash
npm run email-otp
```
The app can use this service by setting `EXPO_PUBLIC_EMAIL_OTP_API_BASE` to the deployed URL.

## Testing
Run the test suite:
```bash
npm test
```

## Troubleshooting
- `npm install` fails: delete `node_modules` and reinstall.
- Backend cannot connect to MQTT: ensure Mosquitto is running on port `1883`.
- Verifier service fails: check `backend/verifier` Python dependencies and `backend/verifier_runtime.log`.
- App cannot reach backend: confirm network connectivity and backend host/IP.
- If using one camera only: set `SINGLE_CAMERA_DEVICE_ID` in `backend/backend.env`.

## Useful paths
- `app/` — front-end screens and Expo app logic
- `backend/server.js` — Node backend and REST/MQTT logic
- `backend/backend.env.example` — env template
- `backend/state.json` — persisted schedule and verification data
- `scripts/` — startup, IoT, and config helpers
- `docs/` — hardware and workflow guides

## Notes for the next developer
- The mobile app starts via Expo Router at `app/index.tsx`.
- The backend is a local LAN service with state persisted in `backend/state.json`.
- `backend/server.js` publishes MQTT messages to `pillnow/<deviceId>/cmd` topics.
- The `backend/verifier` service is separate and runs on `localhost:8000` for image verification.
- `cloud/email_otp_service.js` is optional and used only for email-based password reset.
