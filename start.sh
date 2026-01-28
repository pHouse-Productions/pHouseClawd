#!/bin/bash

# Start the full pHouseClawd system (watcher + dashboard)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo "Starting pHouseClawd..."

# Ensure logs directory exists
mkdir -p logs

# Start watcher first (fast)
"$SCRIPT_DIR/watcher-start.sh"

# Start dashboard (slow, runs in background)
"$SCRIPT_DIR/dashboard-start.sh"

echo ""
echo "pHouseClawd is running."
echo ""
echo "Commands:"
echo "  ./watcher-restart.sh   - Restart just the watcher"
echo "  ./dashboard-restart.sh - Restart just the dashboard"
echo "  ./kill.sh              - Stop everything"
echo ""
