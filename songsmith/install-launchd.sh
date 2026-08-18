#!/bin/bash
# Keep songsmith running: install (or refresh) the launchd agent so the
# service starts at login and restarts if it dies. Idempotent — re-run any
# time. Machine-agnostic: paths are substituted from wherever this checkout
# lives, so the same script works on this Mac and the mini.
set -euo pipefail
cd "$(dirname "$0")"

LABEL="com.calliope.songsmith"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
NPM="$(command -v npm)"
if [ -z "$NPM" ]; then echo "npm not found on PATH" >&2; exit 1; fi

mkdir -p logs "$HOME/Library/LaunchAgents"
sed -e "s|__NPM__|$NPM|g" -e "s|__SONGSMITH_DIR__|$PWD|g" \
  launchd/com.calliope.songsmith.plist.template > "$PLIST"

# Refresh: boot out any old copy first (ignore "not loaded").
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "installed: $PLIST"
echo "  restart now:  launchctl kickstart -k gui/$(id -u)/$LABEL"
echo "  logs:         tail -f $PWD/logs/songsmith.log"
echo "  health:       curl http://127.0.0.1:8765/health"
