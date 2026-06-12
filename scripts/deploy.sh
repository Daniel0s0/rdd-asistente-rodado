#!/usr/bin/env bash
# Deploy de RDD al VPS (ejecutar EN el VPS, desde la raíz del repo).
# Uso: ./scripts/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 1/6 Pull de main"
git pull origin main

echo "==> 2/6 Instalar dependencias"
npm ci

echo "==> 3/6 Tests (obligatorio)"
npm run test

echo "==> 4/6 Build"
npm run build

echo "==> 5/6 PM2 startOrReload"
mkdir -p ../logs
pm2 startOrReload deployment/pm2.config.js

echo "==> 6/6 Health check"
sleep 2
if curl -fsS http://localhost:3001/health/ready > /dev/null; then
  echo "✅ Deploy OK — /health/ready responde 200"
  curl -fsS http://localhost:3001/health/ready
  echo ""
else
  echo "❌ /health/ready NO responde 200 — revisar: pm2 logs rdd --lines 50"
  exit 1
fi
