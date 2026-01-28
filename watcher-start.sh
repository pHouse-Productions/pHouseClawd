#!/bin/bash

# Start just the watcher (handles Telegram, Email, Cron)

cd "$(dirname "$0")"

# Check if already running
if pgrep -f "tsx core/src/watcher.ts" > /dev/null; then
    echo "Watcher is already running."
    exit 1
fi

echo "Starting watcher..."
nohup npx tsx core/src/watcher.ts > logs/watcher.log 2>&1 &
WATCHER_PID=$!

sleep 1

if ps -p $WATCHER_PID > /dev/null 2>&1; then
    echo "Watcher started (PID: $WATCHER_PID)"
else
    echo "Watcher failed to start. Check logs/watcher.log"
    exit 1
fi
