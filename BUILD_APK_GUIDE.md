# Building Standalone APK Guide

## Problem
When you run `npm run android`, it creates a **development build** that requires Metro bundler to be running. The APK you install will show the Expo splash screen but won't load because it's trying to connect to the development server.

## Solution: Build Release APK

To create a standalone APK that works without Metro bundler, you need to build a **release APK**.

### Option 1: Using PowerShell Script (Easiest)

```powershell
.\build-release-apk.ps1
```

This will:
1. Clean previous builds
2. Build a release APK
3. Show you where the APK is located

### Option 2: Using npm script

```powershell
npm run android:release
```

### Option 3: Manual Gradle Build

```powershell
cd android
.\gradlew clean
.\gradlew assembleRelease
cd ..
```

## APK Location

After building, your APK will be at:
```
android\app\build\outputs\apk\release\app-release.apk
```

## Installing the APK

1. Transfer the APK to your Android device (via USB, email, or cloud storage)
2. On your device, enable "Install from Unknown Sources" in Settings
3. Open the APK file and install it
4. The app should now work standalone without needing Metro bundler!

## Differences

- **Debug APK** (`npm run android`): Requires Metro bundler, connects to development server
- **Release APK** (`npm run android:release`): Standalone, works without any server

## Troubleshooting

### Build fails with path length error
- Already fixed! We set `reactNativeArchitectures=arm64-v8a` in `gradle.properties` to avoid Windows path length issues

### Build takes a long time
- First build can take 5-10 minutes. Subsequent builds are faster.

### APK is large
- Release APKs include all JavaScript bundled inside. This is normal.
- To reduce size, you can enable ProGuard minification (advanced)

## Next Steps

For production, you should:
1. Generate a proper release keystore (currently using debug keystore)
2. Sign the APK with your release keystore
3. Test thoroughly before distributing



