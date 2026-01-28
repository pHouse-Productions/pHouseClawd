#!/bin/bash
set -e

echo "=============================================="
echo "   pHouseClawd Installation Script"
echo "=============================================="
echo ""

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PARENT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_step() {
    echo -e "${GREEN}==>${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}Warning:${NC} $1"
}

print_error() {
    echo -e "${RED}Error:${NC} $1"
}

# ============================================
# Step 1: System Dependencies
# ============================================
print_step "Installing system dependencies..."

sudo apt update
sudo apt install -y curl git build-essential

# ============================================
# Step 2: Node.js 22+
# ============================================
print_step "Checking Node.js..."

if command -v node &> /dev/null; then
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -ge 22 ]; then
        echo "Node.js $(node -v) already installed."
    else
        print_warning "Node.js version is below 22. Installing Node.js 22..."
        curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
        sudo apt install -y nodejs
    fi
else
    print_step "Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt install -y nodejs
fi

echo "Node.js $(node -v) installed."

# ============================================
# Step 3: GitHub CLI
# ============================================
print_step "Checking GitHub CLI..."

if command -v gh &> /dev/null; then
    echo "GitHub CLI already installed: $(gh --version | head -1)"
else
    print_step "Installing GitHub CLI..."
    curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
    sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli-stable.list > /dev/null
    sudo apt update
    sudo apt install -y gh
fi

# ============================================
# Step 4: Claude Code CLI
# ============================================
print_step "Checking Claude Code CLI..."

if command -v claude &> /dev/null; then
    echo "Claude Code CLI already installed."
else
    print_step "Installing Claude Code CLI..."
    sudo npm install -g @anthropic-ai/claude-code
fi

# ============================================
# Step 5: Clone pHouseMcp (if not exists)
# ============================================
print_step "Checking pHouseMcp repository..."

if [ -d "$PARENT_DIR/pHouseMcp" ]; then
    echo "pHouseMcp already exists at $PARENT_DIR/pHouseMcp"
else
    print_step "Cloning pHouseMcp..."
    git clone https://github.com/pHouse-Productions/pHouseMcp.git "$PARENT_DIR/pHouseMcp"
fi

# ============================================
# Step 6: Install npm dependencies
# ============================================
print_step "Installing pHouseMcp dependencies..."
cd "$PARENT_DIR/pHouseMcp"
npm install

print_step "Installing pHouseClawd dependencies..."
cd "$SCRIPT_DIR"

# Core watcher
if [ -d "core" ]; then
    cd core && npm install && cd ..
fi

# Dashboard
if [ -d "dashboard" ]; then
    cd dashboard && npm install

    # Generate dashboard password if not already set
    if [ ! -f ".env.local" ] || ! grep -q "DASHBOARD_PASSWORD" .env.local 2>/dev/null; then
        print_step "Generating dashboard password..."
        DASHBOARD_PASSWORD=$(openssl rand -base64 24 | tr -dc 'a-zA-Z0-9' | head -c 16)
        echo "DASHBOARD_PASSWORD=$DASHBOARD_PASSWORD" >> .env.local
    fi

    # Ask for domain if not already set
    if ! grep -q "DASHBOARD_URL" .env.local 2>/dev/null; then
        echo ""
        read -p "Enter your domain name (e.g., vito.example.com): " DASHBOARD_DOMAIN
        if [ -n "$DASHBOARD_DOMAIN" ]; then
            echo "DASHBOARD_URL=$DASHBOARD_DOMAIN" >> .env.local
        fi
    fi

    # Ask for auth service URL if not already set
    if ! grep -q "AUTH_SERVICE_URL" .env.local 2>/dev/null; then
        echo ""
        echo "If you have a centralized pHouseClawdAuth service, enter its URL."
        echo "This lets you use one Google OAuth app for all your instances."
        read -p "Auth service URL (leave blank to skip): " AUTH_SERVICE
        if [ -n "$AUTH_SERVICE" ]; then
            echo "AUTH_SERVICE_URL=$AUTH_SERVICE" >> .env.local
        fi
    fi

    # Show the generated password
    DASHBOARD_PASSWORD=$(grep "DASHBOARD_PASSWORD" .env.local | cut -d'=' -f2)
    echo ""
    echo "=============================================="
    echo -e "${GREEN}   Dashboard Configuration${NC}"
    echo "=============================================="
    echo ""
    echo -e "Your dashboard password is: ${YELLOW}${DASHBOARD_PASSWORD}${NC}"
    echo ""
    echo "Save this password! You'll need it to log into the dashboard."
    echo "(Stored in dashboard/.env.local)"
    echo ""

    npm run build && cd ..
fi

# Listeners
for listener in listeners/*/; do
    if [ -f "${listener}package.json" ]; then
        print_step "Installing dependencies for ${listener}..."
        cd "$listener" && npm install && cd "$SCRIPT_DIR"
    fi
done

# ============================================
# Step 7: Create pHouseMcp credentials directory
# ============================================
print_step "Setting up pHouseMcp credentials directory..."
mkdir -p "$PARENT_DIR/pHouseMcp/credentials"

if [ ! -f "$PARENT_DIR/pHouseMcp/.env" ]; then
    if [ -f "$PARENT_DIR/pHouseMcp/.env.example" ]; then
        cp "$PARENT_DIR/pHouseMcp/.env.example" "$PARENT_DIR/pHouseMcp/.env"
        echo "Created .env from .env.example - you'll need to fill in your API keys."
    else
        touch "$PARENT_DIR/pHouseMcp/.env"
        echo "Created empty .env file."
    fi
fi

# ============================================
# Step 8: Create pHouseClawd systemd service
# ============================================
print_step "Setting up pHouseClawd systemd service..."

sudo tee /etc/systemd/system/phouseclawd.service > /dev/null << EOF
[Unit]
Description=pHouseClawd AI Assistant
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$SCRIPT_DIR
ExecStart=$SCRIPT_DIR/restart.sh
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable phouseclawd
echo "pHouseClawd service enabled (will start on boot)."

# ============================================
# Step 9: Authenticate GitHub CLI
# ============================================
echo ""
print_step "GitHub CLI Authentication"
echo ""

if gh auth status &> /dev/null; then
    echo "GitHub CLI already authenticated."
else
    echo "You need to authenticate with GitHub."
    echo "This allows the assistant to create repos, push code, etc."
    echo ""
    read -p "Press Enter to start GitHub authentication..."
    gh auth login
fi

# ============================================
# Step 10: Authenticate Claude Code
# ============================================
echo ""
print_step "Claude Code Authentication"
echo ""

claude setup-token || {
    print_warning "Run 'claude setup-token' manually to complete authentication."
}

# ============================================
# Step 11: SSL Setup
# ============================================
echo ""
echo "=============================================="
echo "   SSL Setup (HTTPS for Dashboard)"
echo "=============================================="
echo ""
echo "Before setting up SSL, you need to do two things in AWS Console:"
echo ""
echo -e "${YELLOW}1. Create a DNS record in Route53:${NC}"
echo "   - Go to Route53 → Hosted zones → Your domain"
echo "   - Create record:"
echo "     - Record name: your subdomain (e.g., 'vito')"
echo "     - Record type: A"
echo "     - Value: Your EC2 public IP"
echo ""
echo -e "${YELLOW}2. Open ports in EC2 Security Group:${NC}"
echo "   - Go to EC2 → Instances → Select your instance"
echo "   - Click 'Security' tab → Click security group link"
echo "   - Edit inbound rules, add:"
echo "     - Type: HTTP, Source: Anywhere-IPv4"
echo "     - Type: HTTPS, Source: Anywhere-IPv4"
echo ""
echo "Your EC2 public IP can be found in the EC2 console or by running:"
echo "  curl -s http://checkip.amazonaws.com"
echo ""

read -p "Have you completed both steps above? (y/n): " DNS_READY

if [[ "$DNS_READY" =~ ^[Yy]$ ]]; then
    # Run SSL setup
    "$SCRIPT_DIR/setup_ssl.sh"
else
    echo ""
    echo "Skipping SSL setup. You can run it later with:"
    echo "  ./setup_ssl.sh"
fi

# ============================================
# Done!
# ============================================
echo ""
echo "=============================================="
echo -e "${GREEN}   Installation Complete!${NC}"
echo "=============================================="
echo ""
echo "Next steps:"
echo ""
echo "1. Configure your assistant via the dashboard:"
if [[ "$DNS_READY" =~ ^[Yy]$ ]]; then
    echo "   https://your-domain.com"
else
    echo "   http://localhost:3000 (or your EC2 IP:3000)"
fi
echo ""
echo "2. Start the assistant:"
echo "   ./restart.sh"
echo ""
echo "3. Or run Claude Code directly:"
echo "   claude --dangerously-skip-permissions"
echo ""
echo "4. Customize your assistant's personality:"
echo "   Edit CLAUDE.md (or use the dashboard)"
echo ""
echo "Useful commands:"
echo "  ./restart.sh              - Start/restart the assistant"
echo "  sudo systemctl status phouseclawd  - Check service status"
echo "  sudo systemctl status caddy        - Check SSL proxy status"
echo ""
