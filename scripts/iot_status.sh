#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "--- IoT stack status (ports) ---"
echo "MQTT (mosquitto) :1883"
lsof -nP -iTCP:1883 -sTCP:LISTEN || true
echo
echo "Backend (node)    :5001"
lsof -nP -iTCP:5001 -sTCP:LISTEN || true
echo
echo "Verifier (uvicorn):8000"
lsof -nP -iTCP:8000 -sTCP:LISTEN || true

echo
echo "--- Quick HTTP checks ---"
curl -sS http://127.0.0.1:5001/test || true
echo
curl -sS http://127.0.0.1:8000/health || true
echo


