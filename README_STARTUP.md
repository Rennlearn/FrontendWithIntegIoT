# PillNow System Startup Guide

## Quick Start

Start all backend services with a single command:

```bash
npm run start:all
```

Or directly:

```bash
./start-all.sh
```

## What Gets Started

The startup script automatically starts:

1. **Backend Server** (Node.js) - Port 5001
   - Handles schedules, MQTT commands, and pill verification ingestion
   - Logs: `backend/backend_runtime.log`

2. **Verifier Service** (FastAPI/Python) - Port 8000
   - Pill detection and verification using YOLO and KNN
   - Logs: `backend/verifier_runtime.log`

3. **Arduino Alert Bridge** (Python)
   - Bridges MQTT messages to Arduino via serial port
   - Logs: `backend/arduino_bridge_runtime.log`

## Commands

### Start All Services
```bash
npm run start:all
# or
./start-all.sh
```

### Stop All Services
```bash
npm run stop:all
# or
./stop-all.sh
```

### Check Service Status
```bash
npm run status
# or
./status.sh
```

## Prerequisites

Before running the startup script, ensure you have:

1. **Node.js** installed
   ```bash
   node --version
   ```

2. **Python 3** installed
   ```bash
   python3 --version
   ```

3. **Mosquitto MQTT Broker** running
   - macOS: `brew services start mosquitto`
   - Linux: `sudo systemctl start mosquitto`
   - Or start manually: `mosquitto -c /usr/local/etc/mosquitto/mosquitto.conf`

4. **Python Dependencies** installed
   ```bash
   cd backend/verifier
   pip3 install -r requirements.txt
   ```

5. **Node Dependencies** installed
   ```bash
   npm install
   ```

## Troubleshooting

### Port Already in Use

If you see "Port X is already in use", either:
- Stop the existing service using that port
- Or run `./stop-all.sh` first to clean up

### Services Not Starting

Check the log files:
- `backend/backend_runtime.log`
- `backend/verifier_runtime.log`
- `backend/arduino_bridge_runtime.log`

### MQTT Broker Not Running

The script will warn you if MQTT broker is not running, but services will still start. However, IoT features won't work without it.

To start MQTT broker:
- macOS: `brew services start mosquitto`
- Linux: `sudo systemctl start mosquitto`

## Manual Service Management

If you prefer to start services individually:

```bash
# Backend Server
npm run backend

# Verifier Service
npm run verifier

# Arduino Bridge
npm run arduino-bridge
```

## Development Workflow

1. Start all backend services:
   ```bash
   npm run start:all
   ```

2. In a separate terminal, start the React Native app:
   ```bash
   npm start
   ```

3. When done, stop all services:
   ```bash
   npm run stop:all
   ```

## Notes

- The startup script automatically stops any existing services before starting new ones
- All services run in the background
- Logs are written to `backend/*_runtime.log` files
- Process IDs are stored in `.pillnow_pids` file for easy cleanup

