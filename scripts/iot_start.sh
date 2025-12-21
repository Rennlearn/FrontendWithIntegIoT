#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_DIR="$ROOT_DIR/backend/.pids"
LOG_DIR="$ROOT_DIR/backend"
mkdir -p "$PID_DIR"

echo "--- Starting Mosquitto (MQTT broker) ---"
if command -v brew >/dev/null 2>&1; then
  # Start as a login service if available
  brew services start mosquitto >/dev/null 2>&1 || true
else
  echo "brew not found; please start mosquitto manually."
fi

echo "--- Starting Verifier (FastAPI) ---"
VERIFIER_PID_FILE="$PID_DIR/verifier.pid"
if lsof -nP -iTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Verifier already listening on :8000"
else
  if [[ ! -x backend/verifier/.venv/bin/python ]]; then
    echo "Verifier venv not found at backend/verifier/.venv"
    echo "Run: python3 -m venv backend/verifier/.venv && source backend/verifier/.venv/bin/activate && pip install -r backend/verifier/requirements.txt"
    exit 1
  fi
  nohup backend/verifier/.venv/bin/python -m uvicorn backend.verifier.main:app \
    --host 0.0.0.0 --port 8000 --log-level info \
    > "$LOG_DIR/verifier_runtime.log" 2>&1 &
  echo $! > "$VERIFIER_PID_FILE"
  echo "Verifier started (pid $(cat "$VERIFIER_PID_FILE"))"
fi

echo "--- Starting Backend (Node) ---"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
if lsof -nP -iTCP:5001 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Backend already listening on :5001"
else
  nohup node backend/server.js > "$LOG_DIR/backend_runtime.log" 2>&1 &
  echo $! > "$BACKEND_PID_FILE"
  echo "Backend started (pid $(cat "$BACKEND_PID_FILE"))"
fi

echo "--- Starting Arduino bridge (MQTT -> Serial) ---"
BRIDGE_PID_FILE="$PID_DIR/arduino_bridge.pid"
if pgrep -f "python3 .*backend/arduino_alert_bridge.py" >/dev/null 2>&1; then
  echo "Arduino bridge already running"
else
  nohup python3 backend/arduino_alert_bridge.py > "$LOG_DIR/arduino_bridge_runtime.log" 2>&1 &
  echo $! > "$BRIDGE_PID_FILE"
  echo "Arduino bridge started (pid $(cat "$BRIDGE_PID_FILE"))"
fi

echo
echo "Done. Run: scripts/iot_status.sh"


