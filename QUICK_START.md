# 🚀 Quick Start Guide

## After Laptop Restart - ONE COMMAND

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
./start-all.sh
```

**That's it!** All services will start automatically.

---

## What Gets Started

✅ MQTT Broker (Mosquitto) - Port 1883  
✅ Backend Server - Port 5001  
✅ Verifier Service - Port 8000  
✅ Arduino Bridge  
✅ ESP32-CAM Auto-Config Service  

---

## Check Status

```bash
./status.sh
```

## Stop Everything

```bash
./stop-all.sh
```

---

## Full Documentation

See **[STARTUP_GUIDE.md](./STARTUP_GUIDE.md)** for:
- Detailed step-by-step instructions
- Troubleshooting guide
- Manual startup procedures
- Auto-start on boot setup

---

## Common Issues

### IP Changed Error
✅ **Auto-handled!** The auto-config service updates ESP32-CAM devices automatically, and the app auto-updates its backend URL.

### Backend Unreachable in App
1. Check status: `./status.sh`
2. Get Mac IP: Shown in status output
3. In app: Monitor & Manage → Backend IP → Edit → Enter your Mac IP

### Alarms Not Working
1. Check bridge: `pgrep -f arduino_alert_bridge.py`
2. Check schedules: App auto-syncs when you load schedules
3. Check logs: `pm2 logs pillnow-backend`

---

**Need Help?** See [STARTUP_GUIDE.md](./STARTUP_GUIDE.md) for complete documentation.

