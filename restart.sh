#!/bin/bash

# Restart script for pHouseClawd
# This script is designed to be called by the assistant to restart itself
# It waits a moment before killing processes to allow the current response to complete

echo "Restart requested. Waiting 3 seconds..."
sleep 3

# Use kill.sh to stop everything
echo "Stopping pHouseClawd..."
/home/ubuntu/pHouseClawd/kill.sh

sleep 1

# Start fresh in tmux if available, otherwise just run directly
if tmux has-session -t phouse 2>/dev/null; then
  echo "Restarting in tmux session 'phouse'..."
  tmux send-keys -t phouse "./start.sh" Enter
else
  echo "Starting pHouseClawd..."
  cd /home/ubuntu/pHouseClawd
  nohup ./start.sh > /dev/null 2>&1 &
fi

echo "Restart complete."
