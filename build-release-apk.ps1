# Build Release APK Script for PillNow
# This script builds a standalone APK that works without Metro bundler

Write-Host "Building Release APK..." -ForegroundColor Green
Write-Host ""

# Navigate to android directory
Set-Location android

# Clean previous builds
Write-Host "Cleaning previous builds..." -ForegroundColor Yellow
.\gradlew clean

# Build release APK
Write-Host ""
Write-Host "Building release APK (this may take several minutes)..." -ForegroundColor Yellow
.\gradlew assembleRelease

# Check if build was successful
if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "✅ Build successful!" -ForegroundColor Green
    Write-Host ""
    Write-Host "APK location:" -ForegroundColor Cyan
    Write-Host "android\app\build\outputs\apk\release\app-release.apk" -ForegroundColor White
    Write-Host ""
    Write-Host "You can install this APK on any Android device." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "❌ Build failed. Check the error messages above." -ForegroundColor Red
}

# Return to project root
Set-Location ..



