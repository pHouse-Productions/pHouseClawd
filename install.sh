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
# Step 1: Assistant Name
# ============================================
echo "What would you like to name your assistant?"
read -p "Assistant name: " ASSISTANT_NAME

if [ -z "$ASSISTANT_NAME" ]; then
    ASSISTANT_NAME="pHouseClawd"
fi

# Configure git identity for this assistant
git config --global user.name "$ASSISTANT_NAME"
git config --global user.email "${ASSISTANT_NAME,,}@phouse.bot"
echo "Git configured as: $ASSISTANT_NAME <${ASSISTANT_NAME,,}@phouse.bot>"

# Seed CLAUDE.md from template if it doesn't exist
if [ ! -f "$SCRIPT_DIR/CLAUDE.md" ]; then
    print_step "Creating CLAUDE.md for $ASSISTANT_NAME..."
    sed "s/{ASSISTANT_NAME}/$ASSISTANT_NAME/g" "$SCRIPT_DIR/CLAUDE.md.template" > "$SCRIPT_DIR/CLAUDE.md"
    echo "Created CLAUDE.md - your assistant will run onboarding on first conversation."
fi

# ============================================
# Step 2: System Dependencies
# ============================================
print_step "Installing system dependencies..."

sudo apt update
sudo apt install -y curl git build-essential

# ============================================
# Step 3: Node.js 22+
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
# Step 4: GitHub CLI
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
# Step 5: Claude Code CLI
# ============================================
print_step "Checking Claude Code CLI..."

if command -v claude &> /dev/null; then
    echo "Claude Code CLI already installed."
else
    print_step "Installing Claude Code CLI..."
    sudo npm install -g @anthropic-ai/claude-code
fi

# ============================================
# Step 6: Clone pHouseMcp (if not exists)
# ============================================
print_step "Checking pHouseMcp repository..."

if [ -d "$PARENT_DIR/pHouseMcp" ]; then
    echo "pHouseMcp already exists at $PARENT_DIR/pHouseMcp"
else
    print_step "Cloning pHouseMcp..."
    git clone https://github.com/pHouse-Productions/pHouseMcp.git "$PARENT_DIR/pHouseMcp"
fi

# ============================================
# Step 7: Install npm dependencies
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
    else
        # Read existing domain from .env.local
        DASHBOARD_DOMAIN=$(grep "DASHBOARD_URL" .env.local | cut -d'=' -f2)
    fi

    # Set auth service URL (centralized OAuth)
    if ! grep -q "AUTH_SERVICE_URL" .env.local 2>/dev/null; then
        echo "AUTH_SERVICE_URL=https://auth.rl-quests.com" >> .env.local
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
# Step 8: Create pHouseMcp credentials directory and configure paths
# ============================================
print_step "Setting up pHouseMcp credentials directory..."
mkdir -p "$PARENT_DIR/pHouseMcp/credentials"

MCP_CREDENTIALS_DIR="$PARENT_DIR/pHouseMcp/credentials"
GOOGLE_CREDS_PATH="$MCP_CREDENTIALS_DIR/client_secret.json"
GOOGLE_TOKEN_PATH="$MCP_CREDENTIALS_DIR/tokens.json"

if [ ! -f "$PARENT_DIR/pHouseMcp/.env" ]; then
    if [ -f "$PARENT_DIR/pHouseMcp/.env.example" ]; then
        cp "$PARENT_DIR/pHouseMcp/.env.example" "$PARENT_DIR/pHouseMcp/.env"
        echo "Created .env from .env.example"
    else
        touch "$PARENT_DIR/pHouseMcp/.env"
        echo "Created empty .env file."
    fi
fi

# Update Google credential paths in .env to use correct absolute paths
print_step "Configuring Google credential paths..."
MCP_ENV="$PARENT_DIR/pHouseMcp/.env"

# Remove any existing Google credential lines (including comments)
sed -i '/^GOOGLE_CREDENTIALS_PATH=/d' "$MCP_ENV"
sed -i '/^GOOGLE_TOKEN_PATH=/d' "$MCP_ENV"
sed -i '/^# Google OAuth Credentials (auto-configured/d' "$MCP_ENV"

# Clean up multiple blank lines
sed -i '/^$/N;/^\n$/d' "$MCP_ENV"

# Add the correct paths
echo "" >> "$MCP_ENV"
echo "# Google OAuth Credentials (auto-configured by install script)" >> "$MCP_ENV"
echo "GOOGLE_CREDENTIALS_PATH=$GOOGLE_CREDS_PATH" >> "$MCP_ENV"
echo "GOOGLE_TOKEN_PATH=$GOOGLE_TOKEN_PATH" >> "$MCP_ENV"

echo "Google credential paths configured:"
echo "  Credentials: $GOOGLE_CREDS_PATH"
echo "  Token: $GOOGLE_TOKEN_PATH"

# ============================================
# Step 9: Configure MCP servers in ~/.claude.json
# ============================================
print_step "Configuring MCP servers..."

CLAUDE_CONFIG="$HOME/.claude.json"
MCP_SERVERS_DIR="$PARENT_DIR/pHouseMcp/servers"

# Create ~/.claude.json if it doesn't exist
if [ ! -f "$CLAUDE_CONFIG" ]; then
    echo '{}' > "$CLAUDE_CONFIG"
fi

# Build MCP config for each server in pHouseMcp/servers/
MCP_CONFIG="{}"
for server_dir in "$MCP_SERVERS_DIR"/*/; do
    if [ -d "$server_dir" ]; then
        server_name=$(basename "$server_dir")
        server_path="$MCP_SERVERS_DIR/$server_name"
        mcp_entry=$(cat <<MCPEOF
{
  "type": "stdio",
  "command": "npx",
  "args": ["--prefix", "$server_path", "tsx", "$server_path/src/mcp.ts"],
  "env": {}
}
MCPEOF
)
        MCP_CONFIG=$(echo "$MCP_CONFIG" | jq --arg name "$server_name" --argjson entry "$mcp_entry" '.[$name] = $entry')
        echo "  Added: $server_name"
    fi
done

# Add Playwright MCP (third-party, commonly used)
PLAYWRIGHT_ENTRY='{"type": "stdio", "command": "npx", "args": ["@playwright/mcp", "--headless"], "env": {}}'
MCP_CONFIG=$(echo "$MCP_CONFIG" | jq --argjson entry "$PLAYWRIGHT_ENTRY" '.playwright = $entry')
echo "  Added: playwright (third-party)"

# Merge into ~/.claude.json, preserving existing config
# Only add servers that don't already exist
EXISTING_SERVERS=$(jq -r '.mcpServers // {} | keys[]' "$CLAUDE_CONFIG" 2>/dev/null || echo "")
for server in $(echo "$MCP_CONFIG" | jq -r 'keys[]'); do
    if echo "$EXISTING_SERVERS" | grep -q "^${server}$"; then
        echo "  Skipped: $server (already configured)"
        MCP_CONFIG=$(echo "$MCP_CONFIG" | jq "del(.[\"$server\"])")
    fi
done

# Merge the new servers into the config
jq --argjson newServers "$MCP_CONFIG" '.mcpServers = (.mcpServers // {}) + $newServers' "$CLAUDE_CONFIG" > "$CLAUDE_CONFIG.tmp"
mv "$CLAUDE_CONFIG.tmp" "$CLAUDE_CONFIG"

echo "MCP servers configured in ~/.claude.json"

# ============================================
# Step 10: Create pHouseClawd systemd service
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
# Step 11: Authenticate GitHub CLI (Optional)
# ============================================
echo ""
print_step "GitHub CLI Authentication (Optional)"
echo ""

if gh auth status &> /dev/null; then
    echo "GitHub CLI already authenticated."
else
    echo "GitHub authentication allows the assistant to create repos, push code, etc."
    read -p "Would you like to set up GitHub authentication? (y/n): " SETUP_GITHUB
    if [[ "$SETUP_GITHUB" =~ ^[Yy]$ ]]; then
        gh auth login
    else
        echo "Skipping GitHub setup. You can run 'gh auth login' later."
    fi
fi

# ============================================
# Step 12: Authenticate Claude Code
# ============================================
echo ""
print_step "Claude Code Authentication"
echo ""
echo "You'll need to accept the terms and log in to Claude Code."
echo ""

claude --dangerously-skip-permissions || {
    print_warning "Run 'claude --dangerously-skip-permissions' manually to complete setup."
}

# ============================================
# Step 13: SSL Setup
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
    # Run SSL setup, passing domain if we have it
    if [ -n "$DASHBOARD_DOMAIN" ]; then
        "$SCRIPT_DIR/setup_ssl.sh" --domain "$DASHBOARD_DOMAIN" --no-prompt
    else
        "$SCRIPT_DIR/setup_ssl.sh"
    fi
else
    echo ""
    echo "Skipping SSL setup. You can run it later with:"
    if [ -n "$DASHBOARD_DOMAIN" ]; then
        echo "  ./setup_ssl.sh --domain $DASHBOARD_DOMAIN"
    else
        echo "  ./setup_ssl.sh"
    fi
fi

# ============================================
# Done!
# ============================================
echo ""
echo "=============================================="
echo -e "${GREEN}   Installation Complete!${NC}"
echo "=============================================="
echo ""

# Show dashboard credentials
DASHBOARD_PASSWORD=$(grep "DASHBOARD_PASSWORD" "$SCRIPT_DIR/dashboard/.env.local" 2>/dev/null | cut -d'=' -f2)
if [ -n "$DASHBOARD_PASSWORD" ]; then
    echo -e "Dashboard password: ${YELLOW}${DASHBOARD_PASSWORD}${NC}"
    echo ""
fi

echo "Next steps:"
echo ""
echo "1. Configure your assistant via the dashboard:"
if [[ "$DNS_READY" =~ ^[Yy]$ ]] && [ -n "$DASHBOARD_DOMAIN" ]; then
    echo "   https://$DASHBOARD_DOMAIN"
elif [ -n "$DASHBOARD_DOMAIN" ]; then
    echo "   http://$DASHBOARD_DOMAIN:3000"
else
    echo "   http://localhost:3000 (or your EC2 IP:3000)"
fi
echo ""
echo "2. Start the assistant:"
echo "   ./restart.sh"
echo ""
echo "Useful commands:"
echo "  ./restart.sh              - Start/restart the assistant"
echo "  sudo systemctl status phouseclawd  - Check service status"
echo "  sudo systemctl status caddy        - Check SSL proxy status"
echo ""
