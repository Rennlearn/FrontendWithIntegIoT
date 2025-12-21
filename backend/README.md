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


