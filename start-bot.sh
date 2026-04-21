#!/bin/bash
# Kill any existing bot processes to avoid conflicts
pkill -f "node bot.js" || true

# Start the bot in the background
# Output is saved to bot.log
nohup node bot.js > bot.log 2>&1 &

echo "🚀 Ron Assistant AI is starting in the background..."
echo "📄 You can check the logs by typing: tail -f bot.log"
