#!/bin/bash

# Kill all pHouseClawd processes (watcher + dashboard)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Killing pHouseClawd..."

"$SCRIPT_DIR/watcher-kill.sh"
"$SCRIPT_DIR/dashboard-kill.sh"

echo ""
echo "All pHouseClawd processes stopped."
