#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOT_SCRIPT="$SCRIPT_DIR/bot.js"
PID_FILE="$SCRIPT_DIR/bot.pid"
LOG_FILE="$SCRIPT_DIR/bot.log"

cd "$SCRIPT_DIR"

# Kill any existing stray node bot.js processes reliably.
pkill -9 -f "bot.js" || true

# Start/Restart using pm2
./node_modules/.bin/pm2 restart ron-ai || ./node_modules/.bin/pm2 start ecosystem.config.js

echo "Ron Assistant AI is managed by pm2."
./node_modules/.bin/pm2 list

