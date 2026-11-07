#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:$PATH"
if [[ ! -d node_modules ]]; then
  npm ci || exit 1
fi
npm run bots
read -r '?Press Return to close this window.'
