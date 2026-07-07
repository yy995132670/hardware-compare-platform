#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PID_FILE="$ROOT_DIR/app.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "No running service found"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if [[ -n "${PID}" ]] && kill -0 "$PID" 2>/dev/null; then
  kill "$PID"
  echo "Stopped service PID $PID"
else
  echo "PID file exists but process is not running"
fi

rm -f "$PID_FILE"
