# Sound Feature Testing Guide

## ⚠️ Important: Native Modules Required

The sound features (`expo-av` and `expo-haptics`) require **native code** and will **NOT work in Expo Go**. You need to build a development build or APK.

## Your Current Setup

✅ You already have `expo-dev-client` installed  
✅ You have native Android/iOS folders configured  
✅ You're already using other native modules (Bluetooth, etc.)

## Testing Options

### Option 1: Development Build (Recommended for Testing)

This allows you to test with hot reload while having native modules:

```bash
# For Android
npm run android

# For iOS (Mac only)
npm run ios
```

**Requirements:**
- Android: Android Studio with emulator OR physical device with USB debugging
- iOS: Xcode (Mac only) with simulator OR physical device

**Advantages:**
- Hot reload works
- Can test sound features immediately
- Faster iteration during development

### Option 2: Build APK (For Distribution/Testing)

Build a release APK to test on any Android device:

```bash
# Build release APK
npm run android:release

# Or use EAS Build (cloud build)
npx eas build --platform android --profile preview
```

**APK Location:** `android/app/build/outputs/apk/release/app-release.apk`

**Advantages:**
- Can install on any Android device
- No need for development environment
- Good for testing on multiple devices

### Option 3: EAS Development Build (Cloud Build)

Build a development build in the cloud:

```bash
# Install EAS CLI if not already installed
npm install -g eas-cli

# Login to Expo
eas login

# Build development build
eas build --profile development --platform android
```

**Advantages:**
- No local build environment needed
- Works on any device
- Can share with team members

## What Works Where

| Feature | Expo Go | Dev Build | APK |
|---------|---------|-----------|-----|
| `expo-av` (Sound) | ❌ No | ✅ Yes | ✅ Yes |
| `expo-haptics` (Vibration) | ❌ No | ✅ Yes | ✅ Yes |
| `expo-notifications` | ❌ No | ✅ Yes | ✅ Yes |
| Bluetooth | ❌ No | ✅ Yes | ✅ Yes |
| Other native modules | ❌ No | ✅ Yes | ✅ Yes |

## Quick Start: Testing Sound Now

### If you have Android Studio:

1. **Start Android Emulator:**
   - Open Android Studio
   - Tools → Device Manager
   - Click ▶ Play button on your emulator

2. **Run Development Build:**
   ```bash
   npm run android
   ```

3. **Test Sound:**
   - Set a medication schedule
   - Wait for alarm time OR trigger manually
   - You should feel vibration (haptic feedback)
   - Push notifications will play system sound

### If you want to build APK:

1. **Build Release APK:**
   ```bash
   npm run android:release
   ```

2. **Install APK:**
   - Transfer `android/app/build/outputs/apk/release/app-release.apk` to your phone
   - Enable "Install from Unknown Sources" in Android settings
   - Install the APK

3. **Test Sound:**
   - Same as above - vibration and notification sounds will work

## Current Sound Behavior

### Without Custom Sound Files:
- ✅ **Haptic Feedback (Vibration)**: Works immediately
- ✅ **Push Notification Sounds**: Uses system default
- ❌ **Custom Alarm Sounds**: Need to add sound files first

### With Custom Sound Files:
- ✅ **Custom Alarm Sounds**: Will play your sound files
- ✅ **Haptic Feedback**: Still works as backup
- ✅ **Push Notification Sounds**: Can use custom sounds

## Adding Custom Sound Files

1. Create `assets/sounds/` directory
2. Add sound files (`.mp3`, `.m4a`, etc.)
3. Update `app/services/soundService.ts`:
   ```typescript
   case 'alarm':
     return require('../../assets/sounds/alarm.mp3');
   ```
4. Rebuild the app (sound files are bundled at build time)

## Troubleshooting

### "Module not found" or "Native module not available"
- **Cause**: Running in Expo Go
- **Solution**: Build development build or APK

### Sound not playing
- **Check**: Device volume is not muted
- **Check**: Sound files are in correct format (MP3, M4A)
- **Check**: Sound files are properly required in code

### Vibration not working
- **Check**: Device has vibration enabled
- **Check**: App has vibration permissions (usually automatic)

### Build fails
- **Check**: Android Studio is properly installed
- **Check**: Android SDK is configured
- **Check**: Gradle is properly set up

## Summary

**For immediate testing:** Use `npm run android` (development build)  
**For distribution:** Build APK with `npm run android:release`  
**Expo Go:** ❌ Won't work - native modules required

Your setup is already configured for native builds, so you're good to go! 🎉

