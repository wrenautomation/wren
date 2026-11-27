#!/bin/zsh
# The Mac command runner under launchd (designs/2026-11-27-central-queue.md, phase 2): KeepAlive,
# apart from the desk, so a desk restart never kills a job. Safe to run again.
set -euo pipefail
root=${0:A:h:h:h}
label=com.wrenautomation.command-run
plist=~/Library/LaunchAgents/$label.plist
node=/opt/homebrew/bin/node
mkdir -p ~/Library/Logs/wren
cat > $plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array><string>$node</string><string>$root/scripts/command-run.mjs</string></array>
  <key>WorkingDirectory</key><string>$root</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
    <key>WREN_ROOT</key><string>$root</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/wren/command-run.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/wren/command-run.log</string>
</dict>
</plist>
EOF
uid=$(id -u)
launchctl bootout gui/$uid/$label 2>/dev/null || true
launchctl enable gui/$uid/$label
launchctl bootstrap gui/$uid $plist
echo "$label loaded; log ~/Library/Logs/wren/command-run.log"
