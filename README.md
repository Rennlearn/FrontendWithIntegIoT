# PillNow - Medication Management System

[![Integration (fast)](https://github.com/REPLACE_WITH_OWNER/REPO/actions/workflows/integration-fast.yml/badge.svg)](https://github.com/REPLACE_WITH_OWNER/REPO/actions/workflows/integration-fast.yml)  
_Replace `REPLACE_WITH_OWNER/REPO` with your GitHub repository path to enable the badge._

A comprehensive medication management application built with React Native/Expo, featuring IoT integration, Bluetooth connectivity, and caregiver monitoring capabilities.

## Project Structure

```
FrontendWithIntegIoT/
├── app/                    # React Native/Expo app source code
│   ├── components/         # Reusable React components
│   ├── context/           # React context providers
│   ├── hooks/             # Custom React hooks
│   ├── services/          # Service layer (Bluetooth, IoT, notifications)
│   └── styles/            # Theme and styling
├── android/               # Android native code and configuration
├── ios/                   # iOS native code and configuration
├── assets/                # Images, fonts, and static assets
├── backend/               # Backend server and services
│   ├── server.js          # Main backend server
│   └── verifier/          # Verification service (Python)
├── arduino/               # Arduino IoT firmware
│   ├── arduino_pillnow_iot*.ino  # Main IoT firmware variants
│   ├── buzzer_test.ino   # Buzzer testing firmware
│   └── esp32_cam_client/  # ESP32 camera client
├── docs/                  # Documentation and guides
│   ├── Arduino_IoT_Setup_Guide.md
│   ├── Bluetooth_Connection_Debug.md
│   ├── IoT_Integration_Guide.md
│   └── ... (other guides)
├── tests/                 # Test files
│   └── test_iot_integration.js
├── package.json           # Node.js dependencies
└── tsconfig.json          # TypeScript configuration
```

## Features

- **Medication Management**: Schedule, track, and manage medications
- **IoT Integration**: Connect with Arduino-based pill dispensers
- **Bluetooth Connectivity**: Direct communication with hardware devices
- **Caregiver Dashboard**: Monitor medication adherence for elderly patients
- **Push Notifications**: Real-time alerts and reminders
- **Location Services**: Track device location

## Getting Started

### Prerequisites

- Node.js (v18 or higher)
- npm or yarn
- Expo CLI
- Android Studio (for Android development)
- Xcode (for iOS development, macOS only)

### Installation

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the development server:
   ```bash
   npx expo start
   ```

3. Run on your preferred platform:
   ```bash
   npm run android    # For Android
   npm run ios        # For iOS
   npm run web        # For web
   ```

## Documentation

All documentation and guides are located in the `docs/` folder:

- **Arduino Setup**: See `docs/Arduino_IoT_Setup_Guide.md`
- **Bluetooth Configuration**: See `docs/Bluetooth_Connection_Debug.md`
- **IoT Integration**: See `docs/IoT_Integration_Guide.md`
- **Hardware Testing**: See `docs/Hardware_Test_Guide.md`

## Backend

The backend server is located in `backend/server.js`. Start it with:
```bash
cd backend
node server.js
```

## Arduino Firmware

Arduino firmware files are located in the `arduino/` folder. Upload the appropriate `.ino` file to your Arduino/ESP32 device based on your hardware configuration.

## Testing

Test files are located in the `tests/` folder. Run IoT integration tests:
```bash
node tests/test_iot_integration.js
```

## Learn More

- [Expo Documentation](https://docs.expo.dev/)
- [React Native Documentation](https://reactnative.dev/)
- [Expo Router](https://docs.expo.dev/router/introduction/)

## License

Private project - All rights reserved
