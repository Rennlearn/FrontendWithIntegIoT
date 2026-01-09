#!/bin/bash
set -e

# Starts the FastAPI verifier (YOLO/KNN) on port 8000
# This wrapper exists because PM2 struggles with quoted command strings on some setups.

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." && pwd )"
cd "$SCRIPT_DIR"

exec python3 -m uvicorn backend.verifier.main:app --host 0.0.0.0 --port 8000


