#!/bin/zsh
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/opt/node@22/bin:/usr/local/opt/node@22/bin:$PATH"
npm run server
read -r '?Press Return to close this window.'
