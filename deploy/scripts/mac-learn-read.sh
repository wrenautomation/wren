#!/usr/bin/env bash
# Learn's Mac reader under launchd: reels and videos saved to Learn wait for this Mac
# (home IP for Instagram), so a pass runs every 30 min against prod. Before this, the
# queue drained only when a session ran `learn read` by hand (WA-1210).
# Run: deploy/scripts/mac-learn-read.sh [uninstall]. Log: ~/Library/Logs/wren/learn-read.log
set -euo pipefail
LABEL=com.wrenautomation.learn-read
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/wren/learn-read.log"
DOMAIN="gui/$(id -u)"

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "${1:-}" = uninstall ]; then rm -f "$PLIST"; echo "removed $LABEL"; exit 0; fi

mkdir -p "$(dirname "$LOG")"
cat >"$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string>
    <string>$ROOT/scripts/prod-wren.mjs</string>
    <string>learn</string><string>read</string>
    <string>--every</string><string>30</string>
    <string>--limit</string><string>20</string>
  </array>
  <key>WorkingDirectory</key><string>$ROOT</string>
  <key>EnvironmentVariables</key><dict>
    <key>HOME</key><string>$HOME</string>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
  <key>ThrottleInterval</key><integer>300</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "loaded $LABEL; log $LOG"
