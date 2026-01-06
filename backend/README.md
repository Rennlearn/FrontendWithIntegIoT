## Local IoT backend (LAN)

This folder contains the local backend that coordinates:
- ESP32-CAM capture + upload (`/trigger-capture`, `/ingest`)
- Pill verification (FastAPI verifier in `backend/verifier/`)
- Per-container schedule alarms via MQTT (`alarm_triggered`)
- Pill mismatch alerts via MQTT (`alert`) → forwarded to Arduino by `arduino_alert_bridge.py`

### Services to run

In 3 terminals (all on the same machine that has IP `10.56.196.91` in the app configs):

1) **Verifier (FastAPI)**

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
python3 -m pip install -r backend/verifier/requirements.txt
npm run verifier
```

2) **Node backend (Express)**

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
npm run backend
```

3) **MQTT → Arduino serial bridge** (so MQTT alerts become Arduino buzzer + Bluetooth messages)

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
python3 -m pip install paho-mqtt pyserial
npm run arduino-bridge
```

### One-command start/stop (macOS)

Once you have the verifier venv installed (`backend/verifier/.venv`), you can start everything with:

```bash
cd "/Users/lawrencecolis/Cursor code/FrontendWithIntegIoT"
npm run iot:start
```

Check status:

```bash
npm run iot:status
```

Stop:

```bash
npm run iot:stop
```

### Notes

- **MQTT broker**: set `MQTT_BROKER_URL` if your broker IP/host changes.
- **Verifier URL**: set `VERIFIER_URL` if the FastAPI verifier runs elsewhere.
- **State**: `backend/state.json` stores per-container pill config + times and latest verification results.
- **Images**: annotated images are saved to `backend/captures/` by the verifier.

## Schedule / Auto-capture

- The backend runs an internal scheduler (server local time) that fires alarms for per-container `times` or `schedules` stored in `state.json`.
- If you want the backend to automatically request an ESP32-CAM capture when an alarm fires, set `AUTO_CAPTURE_ON_ALARM=true` (see `backend/backend.env`). The delay before requesting capture can be tuned with `AUTO_CAPTURE_DELAY_MS` (ms).
- For quick testing, use the debug endpoint to fire a schedule immediately:
  - `POST /debug/fire-schedule/:containerId` (body: `{ "auto_capture": true|false }` optional)
- There is also a stop notification endpoint that you can call when an alarm is stopped (e.g., from hardware bridge):
  - `POST /alarm/stopped/:containerId` (body: `{ "capture": true|false }` optional). By default `AUTO_CAPTURE_POST_ON_STOP` controls post-stop captures.

- Troubleshooting tips:
  - Confirm the device IDs and topics: backend publishes to `pillnow/<deviceId>/cmd` (default uses container logical id unless `SINGLE_CAMERA_DEVICE_ID` is set).
  - Monitor MQTT messages with:
    - `mosquitto_sub -h 127.0.0.1 -t 'pillnow/+/cmd' -v`
  - Check ESP32-CAM serial logs for subscription, online status, and received messages.


