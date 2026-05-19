#!/bin/sh
set -e

# Create necessary directory structure
mkdir -p /data/.claude/teams
mkdir -p /data/.claude/tasks
mkdir -p /data/.claude/projects

# If no settings.json exists yet, copy the template
if [ ! -f /data/.claude/settings.json ]; then
  cp /data/.claude/settings.template.json /data/.claude/settings.json
fi

# Execute the standalone server
exec node dist-standalone/index.cjs