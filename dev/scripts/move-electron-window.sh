#!/usr/bin/env bash
osascript -e 'tell application "System Events"' -e 'set position of first window of application process "Electron" to {0, 0}' -e 'end tell'
osascript -e 'tell application "iTerm" to activate'
