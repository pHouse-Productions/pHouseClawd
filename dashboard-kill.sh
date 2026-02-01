#!/bin/bash

# Kill the dashboard API server

echo "Killing API server..."

# Kill API server - multiple patterns to catch it
pkill -f "node.*api/dist/index.js" 2>/dev/null
pkill -f "node dist/index.js" 2>/dev/null

# Kill any process on port 3100
lsof -ti:3100 | xargs -r kill -9 2>/dev/null

sleep 1

# Verify it's dead
if lsof -ti:3100 > /dev/null 2>&1; then
    echo "API server still running, force killing..."
    lsof -ti:3100 | xargs -r kill -9 2>/dev/null
fi

echo "API server stopped."
