#!/bin/bash

# Restart script for pHouseClawd
# This script is designed to be called by the assistant to restart itself
# It waits a moment before killing processes to allow the current response to complete

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Restart requested. Waiting 3 seconds..."
sleep 3

# Kill everything
"$SCRIPT_DIR/kill.sh"

sleep 1

# Start fresh in tmux if available, otherwise just run directly
if tmux has-session -t phouse 2>/dev/null; then
    echo "Restarting in tmux session 'phouse'..."
    tmux send-keys -t phouse "./start.sh" Enter
else
    echo "Starting pHouseClawd..."
    "$SCRIPT_DIR/start.sh"
fi

echo "Restart complete."
