# Automatic Startup Guide

## 🚀 Quick Setup

Run this command to set up automatic startup for all services:

```bash
./scripts/setup_auto_start.sh
```

This will:
- ✅ Configure PM2 to start on boot (for backend & verifier)
- ✅ Create LaunchAgent for auto-config service
- ✅ Set up automatic startup on Mac login

## 📋 What Gets Started Automatically

When you log in to your Mac, these services will start automatically:

1. **MQTT Broker** (Mosquitto) - via Homebrew services
2. **Backend Server** (Node.js) - via PM2
3. **Verifier Service** (Python/FastAPI) - via PM2
4. **Arduino Bridge** (Python) - via start-all.sh
5. **ESP32-CAM Auto-Config Service** - via start-all.sh

## 🔧 Manual Setup Steps

### Step 1: Setup PM2 Startup (for Backend & Verifier)

```bash
# Generate PM2 startup command
pm2 startup

# Run the command it outputs (usually something like):
# sudo env PATH=$PATH:/usr/local/bin pm2 startup launchd -u lawrencecolis --hp /Users/lawrencecolis

# Save current PM2 processes
pm2 save
```

### Step 2: Setup LaunchAgent (for All Services)

```bash
# Run the setup script
./scripts/setup_auto_start.sh
```

This creates a LaunchAgent that runs `start-all.sh` on login.

### Step 3: Ensure MQTT Broker Starts on Boot

```bash
# Start Mosquitto as a service (starts on boot)
brew services start mosquitto
```

## ✅ Verify Automatic Startup

### Test 1: Restart Your Mac
After restart, check if services are running:

```bash
# Check PM2 services
pm2 list

# Check auto-config service
pgrep -f auto_update_esp32_config.sh

# Check all services
./status.sh
```

### Test 2: Check LaunchAgent Status

```bash
# Check if LaunchAgent is loaded
launchctl list | grep pillnow

# Check LaunchAgent logs
tail -f backend/launchd_autostart.log
```

## 🛠️ Manual Commands

### Start All Services Manually
```bash
./start-all.sh
# or
npm run start:all
```

### Stop All Services
```bash
./stop-all.sh
# or
npm run stop:all
```

### Check Service Status
```bash
./status.sh
# or
npm run status
```

## 🔄 Disable Automatic Startup

If you want to disable automatic startup:

```bash
# Unload LaunchAgent
launchctl unload ~/Library/LaunchAgents/com.pillnow.autostart.plist

# Remove PM2 startup
pm2 unstartup
pm2 save
```

## 📝 Service Details

### PM2 Services (Backend & Verifier)
- **Location**: Managed by PM2
- **Auto-start**: Via PM2 startup command
- **Status**: `pm2 list`
- **Logs**: `pm2 logs`

### Auto-Config Service
- **Location**: `scripts/auto_update_esp32_config.sh`
- **Auto-start**: Via LaunchAgent → start-all.sh
- **Status**: `pgrep -f auto_update_esp32_config.sh`
- **Logs**: `backend/auto_config_runtime.log`

### MQTT Broker
- **Location**: Homebrew service
- **Auto-start**: `brew services start mosquitto`
- **Status**: `brew services list | grep mosquitto`

## 🎯 Complete Setup Checklist

- [ ] Run `./scripts/setup_auto_start.sh`
- [ ] Run PM2 startup command (from `pm2 startup` output)
- [ ] Run `pm2 save` to save PM2 processes
- [ ] Run `brew services start mosquitto` (if not already)
- [ ] Restart Mac to test automatic startup
- [ ] Verify all services are running after restart

## 💡 Tips

1. **First Time Setup**: Run `./start-all.sh` manually first to ensure everything works
2. **PM2 Save**: After starting services with PM2, always run `pm2 save` to persist them
3. **Check Logs**: If services don't start, check logs in `backend/` directory
4. **Phone Hotspot**: Auto-config service will handle IP changes automatically

## 🚨 Troubleshooting

### Services Not Starting on Boot

1. **Check LaunchAgent**:
   ```bash
   launchctl list | grep pillnow
   tail -f backend/launchd_autostart.log
   ```

2. **Check PM2**:
   ```bash
   pm2 list
   pm2 logs
   ```

3. **Check MQTT Broker**:
   ```bash
   brew services list | grep mosquitto
   ```

4. **Manual Start**:
   ```bash
   ./start-all.sh
   ```

### Auto-Config Service Not Running

```bash
# Check if running
pgrep -f auto_update_esp32_config.sh

# Start manually
./scripts/start_auto_config.sh

# Check logs
tail -f backend/auto_config_runtime.log
```

