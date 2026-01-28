#!/bin/bash
set -e

echo "=== SSL Setup for pHouseClawd Dashboard ==="
echo ""

# Ask for domain
read -p "Enter your domain (e.g., vito.yourdomain.com): " DOMAIN

if [ -z "$DOMAIN" ]; then
    echo "Error: Domain cannot be empty"
    exit 1
fi

echo ""
echo "Setting up SSL for: $DOMAIN"
echo ""

# Check if Caddy is installed
if ! command -v caddy &> /dev/null; then
    echo "Installing Caddy via apt..."
    sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
    sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
    sudo apt update
    sudo apt install -y caddy
    echo "Caddy installed."
else
    echo "Caddy already installed: $(caddy version)"
fi

# Create Caddyfile
CADDYFILE="$HOME/Caddyfile"
echo "Configuring Caddy..."
cat > "$CADDYFILE" << EOF
$DOMAIN {
    reverse_proxy localhost:3000
}
EOF

echo "Caddyfile created at $CADDYFILE"

# Create systemd service
echo "Setting up systemd service..."
sudo tee /etc/systemd/system/caddy.service > /dev/null << 'SERVICEEOF'
[Unit]
Description=Caddy web server
After=network.target

[Service]
Type=exec
ExecStart=/usr/bin/caddy run --config /home/ubuntu/Caddyfile
ExecReload=/usr/bin/caddy reload --config /home/ubuntu/Caddyfile
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICEEOF

# Reload systemd and start caddy
sudo systemctl daemon-reload
sudo systemctl enable caddy
sudo systemctl restart caddy

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Your dashboard should now be available at: https://$DOMAIN"
echo ""
echo "Note: Make sure you have:"
echo "  1. Created an A record in Route53 pointing $DOMAIN to your EC2 public IP"
echo "  2. Opened ports 80 and 443 in your EC2 security group"
echo ""
echo "Caddy will automatically obtain and renew SSL certificates from Let's Encrypt."
echo "Caddy is set to auto-start on boot via systemd."
echo ""
echo "Useful commands:"
echo "  Check status:  sudo systemctl status caddy"
echo "  Stop:          sudo systemctl stop caddy"
echo "  Restart:       sudo systemctl restart caddy"
echo "  View logs:     sudo journalctl -u caddy -f"
