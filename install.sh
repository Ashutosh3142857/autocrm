#!/usr/bin/env bash
set -euo pipefail
if ! command -v docker >/dev/null 2>&1; then
  echo "[AutoCRM] Installing Docker..."
  curl -fsSL https://get.docker.com | sh
fi
if ! command -v docker-compose >/dev/null 2>&1; then
  echo "[AutoCRM] Installing docker-compose..."
  curl -L "https://github.com/docker/compose/releases/download/2.27.0/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
  chmod +x /usr/local/bin/docker-compose
fi
[ -f ".env" ] || cp .env.example .env
echo "[AutoCRM] Building & starting containers..."
docker-compose up -d --build
echo "[AutoCRM] Live at http://YOUR_SERVER_IP/  (switch to your domains in Caddyfile for HTTPS)"
