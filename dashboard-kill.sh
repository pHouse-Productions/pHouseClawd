#!/bin/bash

# Kill just the dashboard

echo "Killing dashboard..."

# Kill Next.js dashboard - multiple patterns to catch it
pkill -f "next-server.*dashboard" 2>/dev/null
pkill -f "node.*dashboard.*next" 2>/dev/null
pkill -f "npm.*start.*-p 3000" 2>/dev/null

# Kill any process on port 3000
fuser -k 3000/tcp 2>/dev/null

sleep 1

# Verify it's dead
if fuser 3000/tcp > /dev/null 2>&1; then
    echo "Dashboard still running, force killing..."
    fuser -k -9 3000/tcp 2>/dev/null
fi

echo "Dashboard stopped."
