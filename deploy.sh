#!/bin/bash
# Deploy services to Mac Mini via SSH
#
# Usage:
#   ./deploy.sh <service|all>
#
# Examples:
#   ./deploy.sh listener      # deploy only listener
#   ./deploy.sh api            # deploy only api
#   ./deploy.sh all            # deploy everything

set -e

SERVICE=$1
MAC_MINI="${MAC_MINI_HOST:-ilyalibin@brain.local}"
REMOTE_DIR="${MAC_MINI_DIR:-~/parent-ai}"

if [ -z "$SERVICE" ]; then
  echo "Usage: ./deploy.sh <service|all>"
  echo "Services: listener, api, telegram, cron, dashboard, all"
  exit 1
fi

if [ "$SERVICE" = "all" ]; then
  SERVICES="listener api telegram cron dashboard"
else
  SERVICES="$SERVICE"
fi

for SVC in $SERVICES; do
  echo ""
  echo "=== Deploying $SVC ==="

  echo "  Building parent-ai-$SVC..."
  docker build -t "parent-ai-$SVC" -f "packages/$SVC/Dockerfile" .

  echo "  Pushing to Mac Mini..."
  docker save "parent-ai-$SVC" | ssh "$MAC_MINI" "/usr/local/bin/docker load"

  echo "  Restarting $SVC on Mac Mini..."
  ssh "$MAC_MINI" "cd $REMOTE_DIR && /usr/local/bin/docker compose up -d $SVC"

  echo "  $SVC deployed!"
done

echo ""
echo "=== Done! ==="
