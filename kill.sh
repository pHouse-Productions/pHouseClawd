#!/bin/bash

# Kill all pHouseClawd processes
# Can be run from anywhere to stop all components

echo "Killing pHouseClawd processes..."

# Kill the unified watcher (handles Telegram, Email, Cron)
pkill -f "tsx core/src/watcher.ts" 2>/dev/null

# Kill Next.js dashboard - multiple patterns to catch it
pkill -f "next-server.*dashboard" 2>/dev/null
pkill -f "node.*dashboard.*next" 2>/dev/null
pkill -f "npm.*start.*-p 3000" 2>/dev/null
# Kill any node process running on port 3000
fuser -k 3000/tcp 2>/dev/null

# Small delay then verify
sleep 1

# Check if anything's still running
REMAINING=$(pgrep -f "tsx core/src/watcher.ts" 2>/dev/null)

if [ -z "$REMAINING" ]; then
    echo "All pHouseClawd processes killed."
else
    echo "Some processes still running, force killing..."
    pkill -9 -f "tsx core/src/watcher.ts" 2>/dev/null
    pkill -9 -f "next-server.*dashboard" 2>/dev/null
    pkill -9 -f "node.*dashboard.*next" 2>/dev/null
    fuser -k 3000/tcp 2>/dev/null
    echo "Force killed remaining processes."
fi

echo "Done."
