#!/bin/bash
# macOS .app launcher: start background server once, open browser, exit immediately.
# Clicking the Dock icon again re-runs this script and reopens the local URL.
set -euo pipefail

BINDIR="$(cd "$(dirname "$0")" && pwd)"
SERVER="$BINDIR/librewallet-server"
PORT="${LIBREWALLET_PORT:-8787}"
HOST="127.0.0.1"
URL="http://${HOST}:${PORT}/"
LOG_DIR="$HOME/Library/Logs/LibreWallet"
PID_FILE="$HOME/Library/Application Support/LibreWallet/server.pid"

mkdir -p "$LOG_DIR" "$(dirname "$PID_FILE")"

server_ready() {
  local code
  code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 1 "$URL" || true)"
  [ "$code" = "200" ]
}

open_ui() {
  open "$URL"
}

if server_ready; then
  open_ui
  exit 0
fi

export LIBREWALLET_NO_BROWSER=1
export LIBREWALLET_HOST="$HOST"
export LIBREWALLET_PORT="$PORT"

nohup "$SERVER" >>"$LOG_DIR/server.log" 2>&1 &
SERVER_PID=$!
echo "$SERVER_PID" > "$PID_FILE"

for _ in $(seq 1 50); do
  if server_ready; then
    open_ui
    exit 0
  fi
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    exit 1
  fi
  sleep 0.2
done

exit 1
