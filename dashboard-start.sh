#!/bin/bash

# Start the dashboard API server (Express on port 3100)
# The frontend is now static files served by Caddy

cd "$(dirname "$0")"

# Check if already running on port 3100
if lsof -ti:3100 > /dev/null 2>&1; then
    echo "API server is already running on port 3100."
    exit 1
fi

echo "Starting API server..."

cd api
nohup node dist/index.js > ../logs/api.log 2>&1 &
API_PID=$!
cd ..

# Wait for it to start
echo "Waiting for API server to start..."
for i in {1..10}; do
    if lsof -ti:3100 > /dev/null 2>&1; then
        echo "API server started (PID: $API_PID)"
        echo "Dashboard: https://mike-vito.rl-quests.com"
        exit 0
    fi
    sleep 1
done

echo "API server failed to start within 10 seconds. Check logs/api.log"
exit 1
