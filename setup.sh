#!/usr/bin/env bash
set -e

echo "🚀 Initializing Antigravity (AGY) Enterprise Harness Scaffold..."

chmod +x .agents/scripts/doctor.sh .agents/scripts/fast-mode.sh setup.sh 2>/dev/null || true


if [ -f "package.json" ]; then
    echo "📦 Checking package dependencies..."
fi

echo "🩺 Running initial Doctor check..."
bash .agents/scripts/doctor.sh

echo "🎉 Environment Setup Complete! You are ready to pair program with SiteMaster (AGY)."

