# Android Setup Guide for PillNow

## Quick Start Options

### Option 1: Expo Go (Fastest - No Setup Required)
1. Install **Expo Go** app on your Android phone from Google Play Store
2. Run `npm start` in your project
3. Scan the QR code with Expo Go app
4. Your app will load on your phone!

### Option 2: Android Studio Emulator (For Native Features)

#### Step 1: Install Android Studio
1. Download from: https://developer.android.com/studio
2. Install with default settings (includes Android SDK)

#### Step 2: Create Virtual Device
1. Open Android Studio
2. Click **More Actions** → **Virtual Device Manager**
   - OR go to **Tools** → **Device Manager**
3. Click **Create Device**
4. Select a device (e.g., **Pixel 5**)
5. Click **Next**
6. Select a system image (e.g., **API 33** or **API 34**)
   - If not downloaded, click **Download** next to the system image
7. Click **Next** → **Finish**

#### Step 3: Start Emulator
1. In Device Manager, click the **Play** button (▶) next to your device
2. Wait for emulator to boot (first time may take a few minutes)

#### Step 4: Run Your App
```powershell
npm run android
```

### Option 3: Physical Android Device

#### Enable Developer Mode
1. Go to **Settings** → **About Phone**
2. Tap **Build Number** 7 times
3. Go back to **Settings** → **Developer Options**
4. Enable **USB Debugging**

#### Connect Device
1. Connect phone via USB cable
2. On phone, allow USB debugging when prompted
3. Run: `npm run android`

### Option 4: Web Browser (Quick Testing)
```powershell
npm run web
```
Opens at: http://localhost:8081

## Troubleshooting

### "adb not recognized"
- Android SDK not in PATH
- Solution: Use Android Studio's built-in terminal or add SDK to PATH

### "No devices found"
- Make sure emulator is running OR
- Physical device is connected with USB debugging enabled
- Check with: `adb devices` (if SDK is in PATH)

### Emulator is slow
- Enable hardware acceleration in BIOS (Intel VT-x or AMD-V)
- Allocate more RAM to emulator in AVD settings
- Use a physical device for better performance

## Recommended: Start with Expo Go
For fastest development, use **Expo Go** on your phone - no setup needed!


