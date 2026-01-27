#!/bin/bash

# Start the pHouseClawd system
# Runs Telegram listener, Gmail watcher, and event watcher

cd "$(dirname "$0")"

echo "Starting pHouseClawd..."

# Cleanup function
cleanup() {
  echo ""
  echo "Shutting down pHouseClawd..."
  kill $TELEGRAM_PID $GMAIL_PID $WATCHER_PID $DASHBOARD_PID 2>/dev/null
  wait
  echo "Goodbye!"
  exit 0
}

# Set trap BEFORE starting background processes
trap cleanup SIGINT SIGTERM EXIT

# Start Telegram listener
echo "Starting Telegram listener..."
npx tsx listeners/telegram/receive.ts daemon &
TELEGRAM_PID=$!

# Start Gmail watcher
echo "Starting Gmail watcher..."
npx tsx listeners/gmail/receive.ts &
GMAIL_PID=$!

# Give them a moment to connect
sleep 2

# Start the event watcher
echo "Starting event watcher..."
npx tsx core/src/watcher.ts &
WATCHER_PID=$!

# Build and start the dashboard
echo "Building dashboard..."
cd dashboard && npm run build
echo "Starting dashboard..."
npm run start -- -p 3000 &
DASHBOARD_PID=$!
cd ..

echo ""
echo "pHouseClawd is running. Press Ctrl+C to stop."
echo "  Telegram PID:  $TELEGRAM_PID"
echo "  Gmail PID:     $GMAIL_PID"
echo "  Watcher PID:   $WATCHER_PID"
echo "  Dashboard PID: $DASHBOARD_PID"
echo ""
echo "Dashboard: http://localhost:3000"
echo ""

# Wait for any child to exit
wait
