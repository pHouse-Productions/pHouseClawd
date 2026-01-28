#!/bin/bash

# Start the pHouseClawd system
# The unified watcher handles all channels (Telegram, Email) and cron jobs

cd "$(dirname "$0")"

echo "Starting pHouseClawd..."

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down pHouseClawd..."
  kill $WATCHER_PID $DASHBOARD_PID 2>/dev/null
  wait
  echo "Goodbye!"
  exit 0
}

# Set trap BEFORE starting background processes
trap cleanup SIGINT SIGTERM EXIT

# Start the unified event watcher (handles Telegram, Email, Cron)
echo "Starting unified watcher..."
npx tsx core/src/watcher.ts &
WATCHER_PID=$!

# Give it a moment to connect
sleep 2

# Build and start dashboard in production mode
echo "Building dashboard..."
cd dashboard && npm run build && npm run start -- -p 3000 &
DASHBOARD_PID=$!
cd ..

echo ""
echo "pHouseClawd is running. Press Ctrl+C to stop."
echo "  Watcher PID:   $WATCHER_PID"
echo "  Dashboard PID: $DASHBOARD_PID"
echo ""
echo "Dashboard: http://localhost:3000"
echo ""

# Wait for any child to exit
wait
