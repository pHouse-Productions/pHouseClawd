#!/bin/bash

# Kill just the watcher

echo "Killing watcher..."

pkill -f "tsx core/src/watcher.ts" 2>/dev/null

sleep 1

# Verify it's dead
if pgrep -f "tsx core/src/watcher.ts" > /dev/null; then
    echo "Watcher still running, force killing..."
    pkill -9 -f "tsx core/src/watcher.ts" 2>/dev/null
fi

echo "Watcher stopped."
