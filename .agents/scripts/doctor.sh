#!/usr/bin/env bash
set -e

echo "=================================================="
echo "🩺 Running Antigravity (AGY) Harness Health Doctor"
echo "=================================================="

# Check Node.js
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js: $(node -v)"
else
    echo "❌ Node.js is missing!"
    exit 1
fi

# Check Git
if command -v git >/dev/null 2>&1; then
    echo "✅ Git: $(git --version)"
else
    echo "❌ Git is missing!"
    exit 1
fi

# Check AGENTS.md & GEMINI.md
if [ -f "AGENTS.md" ] && [ -f "GEMINI.md" ]; then
    echo "✅ AGENTS.md and GEMINI.md present."
else
    echo "❌ AGENTS.md or GEMINI.md missing!"
    exit 1
fi

# Check Hooks & Harness
if [ -f ".agents/hooks.json" ]; then
    echo "✅ Lifecycle Hooks configured (.agents/hooks.json)."
else
    echo "❌ .agents/hooks.json missing!"
    exit 1
fi

# Run Arch & DFX Checks
echo "🔍 Running Architecture Check..."
node .agents/harness/arch-checker.js scan

echo "🛡️ Running 5-D DFX Validation..."
node .agents/harness/dfx-validator.js validate

echo "🎉 All Antigravity Harness Checks Passed Cleanly!"
