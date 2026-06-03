# PillNow App Usage Guide

## What this app does
PillNow is a React Native / Expo medication management app with support for:
- medication schedules and reminders
- caregiver monitoring and dashboards
- Bluetooth-connected devices
- Arduino / IoT pill dispenser integration
- pill verification and capture workflows
- password reset and OTP email support via a cloud service

## Who should use this guide
This is for end users or testers who need to run the mobile app and understand the core app features.

## Project structure
- `app/` — Expo React Native application code and routes
- `android/`, `ios/` — platform-specific native project files
- `backend/` — local Node.js backend, MQTT integration, and state storage
- `backend/verifier/` — Python FastAPI pill verification service
- `arduino/` — Arduino/ESP32 firmware sketches
- `cloud/` — email OTP/password reset service
- `docs/` — hardware setup, Bluetooth, and IoT guides
- `assets/` — app images, fonts, and static assets
- `scripts/` — helper scripts for starting services and IoT setup
- `src/` — additional support code and utilities
- `types/` — TypeScript definitions

## Quick start
1. Open a terminal in the project root.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start the Expo development server:
   ```bash
   npm start
   ```
4. Open the app on a device or emulator:
   - Android: `npm run android`
   - iOS: `npm run ios`
   - Web: `npm run web`

## Running the app
The app uses Expo Router and starts from `app/index.tsx`, which forwards users to `FlashScreen`.

### Primary screens
- `LoginScreen`: enter credentials to sign in.
- `ForgotPassword`: use password reset if you cannot log in.
- `CaregiverDashboard`: monitor multiple elders, view notifications, and manage schedules.
- `ElderDashboard`: view personal medication schedule and adherence status.
- `ModifyScheduleScreen`: change medication times and container schedules.
- `MonitorManageScreen`: manage monitoring devices and IoT connectivity.
- `BluetoothScreen` / `BluetoothConnectionScreen`: connect to hardware via Bluetooth.
- `PillDetectionCamera`: capture pill images for verification.
- `LocationScreen`: view device location if location tracking is enabled.

## Typical user flow
1. Open the app and sign in.
2. If you are a caregiver, use the dashboard to review patient schedules and notifications.
3. If you are an elder, use the schedule screen to see upcoming medications.
4. Tap the pill detection camera to verify medication with the connected IoT system.
5. Use Bluetooth screens to pair the device with hardware if available.
6. Use the notification screen for alerts and reminders.

## App features
- Medication schedules: create and modify schedules for pills.
- Alerts: receive reminders when doses are due.
- Caregiver monitoring: track adherence for linked elders.
- Bluetooth hardware control: connect to local devices.
- Pill verification: capture images and verify pills using backend services.

## Notes for testing
- The app can launch independently, but full IoT workflows require backend services and MQTT.
- If the backend is not running, the app may still start, but hardware integration and verification may not work.
- For full system testing, also start the backend and IoT services described in `README_DEV.md`.

## When the app is not working
- Make sure the Expo server is running: `npm start`.
- Confirm the device is connected to the same network as the backend and IoT devices.
- If using Android, allow required permissions for Bluetooth, camera, and storage.
- If using iOS, ensure simulator/device permissions are granted.

## Useful commands
- `npm start` — launch Expo development server.
- `npm run android` — build and open on Android.
- `npm run ios` — build and open on iOS.
- `npm run web` — run the app in a browser.
- `npm test` — run Jest tests.
- `npm run lint` — run Expo lint checks.

## Where to look next
- `app/` — mobile app source code
- `backend/` — local backend that supports the IoT system
- `arduino/` — firmware for Arduino/ESP32 pill hardware
- `docs/` — hardware, Bluetooth, and IoT guides
