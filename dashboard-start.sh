#!/bin/bash

# Start just the dashboard

cd "$(dirname "$0")"

# Check if already running on port 3000
if fuser 3000/tcp > /dev/null 2>&1; then
    echo "Dashboard is already running on port 3000."
    exit 1
fi

echo "Starting dashboard..."

# Check if build exists and is recent
if [ ! -d "dashboard/.next" ]; then
    echo "No build found, building dashboard first..."
    cd dashboard && npm run build && cd ..
fi

cd dashboard
nohup npm run start -- -p 3000 > ../logs/dashboard.log 2>&1 &
DASHBOARD_PID=$!
cd ..

# Wait for it to actually start (Next.js takes a moment)
echo "Waiting for dashboard to start..."
for i in {1..30}; do
    if fuser 3000/tcp > /dev/null 2>&1; then
        echo "Dashboard started (PID: $DASHBOARD_PID)"
        echo "Dashboard: http://localhost:3000"
        exit 0
    fi
    sleep 1
done

echo "Dashboard failed to start within 30 seconds. Check logs/dashboard.log"
exit 1
