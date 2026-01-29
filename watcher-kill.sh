#!/bin/bash

# Kill just the watcher

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PID_FILE="$SCRIPT_DIR/watcher.pid"

echo "Killing watcher..."

# Try to kill by PID file first (more precise)
if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
        echo "Killing watcher process $PID..."
        kill "$PID" 2>/dev/null
        sleep 1
        # Force kill if still running
        if kill -0 "$PID" 2>/dev/null; then
            echo "Watcher still running, force killing..."
            kill -9 "$PID" 2>/dev/null
        fi
    fi
    rm -f "$PID_FILE"
fi

# Also clean up any orphaned processes matching the pattern (fallback)
pkill -f "tsx core/src/watcher.ts" 2>/dev/null

echo "Watcher stopped."
