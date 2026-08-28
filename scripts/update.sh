#!/usr/bin/env bash
set -euo pipefail

# Paws & Parcels — deploy updater
# Pulls latest from GitHub, installs deps, builds the client, restarts the service.
# Usage: bash scripts/update.sh
# Run from the project root on the alpha server.

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SERVICE="paws-and-parcels.service"
DEPLOY_KEY="${DEPLOY_KEY:-$REPO_DIR/.deploy_key}"

cd "$REPO_DIR"

echo "==> Paws & Parcels updater"
echo "    Repo: $REPO_DIR"

# --- Pull ---
echo ""
echo "==> Pulling latest from GitHub..."
PREVIOUS_HEAD="$(git rev-parse HEAD)"
if [ -f "$DEPLOY_KEY" ]; then
  echo "    Using deploy key: $DEPLOY_KEY"
  GIT_SSH_COMMAND="ssh -i $DEPLOY_KEY -o IdentitiesOnly=yes -o StrictHostKeyChecking=no" git pull --ff-only
else
  echo "    No deploy key found at $DEPLOY_KEY — using default SSH."
  git pull --ff-only
fi

# --- Install deps (only if package-lock.json changed) ---
if ! git diff --quiet "$PREVIOUS_HEAD" HEAD -- package-lock.json || [ ! -x node_modules/.bin/vite ]; then
  echo ""
  echo "==> Installing dependencies..."
  npm ci
else
  echo ""
  echo "==> No dependency changes — skipping npm ci."
fi

# --- Build client ---
echo ""
echo "==> Building client..."
npm run build

# --- Restart service ---
echo ""
echo "==> Restarting $SERVICE..."
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  sudo systemctl restart "$SERVICE"
  echo "    Service restarted."
else
  echo "    Service is not running. Starting..."
  sudo systemctl start "$SERVICE"
  echo "    Service started."
fi

# --- Verify ---
sleep 2
if systemctl is-active --quiet "$SERVICE" 2>/dev/null; then
  echo ""
  echo "==> Done. Service is running."
else
  echo ""
  echo "==> WARNING: Service failed to start. Check: sudo journalctl -u $SERVICE -n 30"
  exit 1
fi
