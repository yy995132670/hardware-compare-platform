#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PORT="${PORT:-2680}"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$ROOT_DIR/app.pid"

mkdir -p "$LOG_DIR"

if [[ -f "$PID_FILE" ]]; then
  OLD_PID="$(cat "$PID_FILE" || true)"
  if [[ -n "${OLD_PID}" ]] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "CPU compare service is already running on PID $OLD_PID"
    exit 0
  fi
  rm -f "$PID_FILE"
fi

if [[ ! -d node_modules ]]; then
  if [[ -f package-lock.json ]]; then
    npm ci
  else
    npm install
  fi
fi

nohup env PORT="$PORT" node server.js > "$LOG_DIR/server.log" 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PID_FILE"

sleep 1

if kill -0 "$NEW_PID" 2>/dev/null; then
  echo "CPU compare service started successfully"
  echo "PID: $NEW_PID"
  echo "URL: http://0.0.0.0:$PORT"
else
  echo "Failed to start service, check $LOG_DIR/server.log"
  exit 1
fi
