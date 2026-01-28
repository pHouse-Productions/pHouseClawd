#!/bin/bash

# Restart just the dashboard

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Restarting dashboard..."

"$SCRIPT_DIR/dashboard-kill.sh"
sleep 1
"$SCRIPT_DIR/dashboard-start.sh"
