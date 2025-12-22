#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PID_DIR="$ROOT_DIR/backend/.pids"

kill_if_running() {
  local pid_file="$1"
  local name="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file" || true)"
    if [[ -n "${pid:-}" ]] && kill -0 "$pid" >/dev/null 2>&1; then
      echo "Stopping $name (pid $pid)"
      kill "$pid" || true
    fi
    rm -f "$pid_file"
  fi
}

echo "--- Stopping stack processes started by scripts/iot_start.sh ---"
kill_if_running "$PID_DIR/arduino_bridge.pid" "arduino bridge"
kill_if_running "$PID_DIR/backend.pid" "backend"
kill_if_running "$PID_DIR/verifier.pid" "verifier"

echo "--- (Optional) stopping mosquitto service ---"
if command -v brew >/dev/null 2>&1; then
  brew services stop mosquitto >/dev/null 2>&1 || true
fi

echo "Done."


