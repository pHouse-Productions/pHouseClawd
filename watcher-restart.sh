#!/bin/bash

# Restart just the watcher

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Restarting watcher..."

"$SCRIPT_DIR/watcher-kill.sh"
sleep 1
"$SCRIPT_DIR/watcher-start.sh"
