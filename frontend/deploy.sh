#!/bin/bash
# deploy.sh - Deploy Endless Jam radio frontend to cedarwater.net/radio/

set -e

GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

SSH_USER="cedarwat"
SSH_HOST="104.225.208.23"
SSH_PORT="1157"
SSH_KEY="/Users/mattbennett/Desktop/gradbot/.ssh/cedarwater_key"
REMOTE_PATH="~/public_html/radio/"

echo -e "${GREEN}▶${NC} Deploying Endless Jam to cedarwater.net/radio/..."
echo ""

# Test SSH connection
echo "Testing SSH connection..."
if ! ssh -i "$SSH_KEY" -p "$SSH_PORT" -q -o BatchMode=yes -o ConnectTimeout=5 "$SSH_USER@$SSH_HOST" exit; then
    echo -e "${RED}✗ SSH connection failed${NC}"
    echo "  Key: $SSH_KEY"
    echo "  Connection: $SSH_USER@$SSH_HOST:$SSH_PORT"
    exit 1
fi
echo -e "${GREEN}✓${NC} SSH connection successful"
echo ""

# Create remote directory
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" "mkdir -p $REMOTE_PATH"

# Deploy
echo "Deploying files..."
rsync -avz --delete \
    -e "ssh -i '$SSH_KEY' -p $SSH_PORT" \
    --exclude='.DS_Store' \
    --exclude='deploy.sh' \
    "$SCRIPT_DIR/" \
    "$SSH_USER@$SSH_HOST:$REMOTE_PATH"

echo ""
echo "Setting permissions..."
ssh -i "$SSH_KEY" -p "$SSH_PORT" "$SSH_USER@$SSH_HOST" \
    "find $REMOTE_PATH -type f \( -name '*.html' -o -name '*.css' -o -name '*.js' -o -name '*.jpg' -o -name '*.png' \) -exec chmod 644 {} \;"

echo ""
echo -e "${GREEN}✓ Deployed!${NC} Live at: https://cedarwater.net/radio/"
