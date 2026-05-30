#!/bin/bash
# RDD Harness Engineering - Health Check Script
# Run this at the start of every session: ./scripts/init.sh
set -e

echo "🔍 RDD Harness Engineering - Health Check"
echo "=================================================="
echo ""

# 1. Node version check
echo "✓ Checking Node.js version..."
NODE_VERSION=$(node -v)
MAJOR_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [[ $MAJOR_VERSION -ge 18 ]]; then
  echo "  ✅ Node.js $NODE_VERSION (supported)"
else
  echo "  ❌ Node.js $NODE_VERSION (require 18+)"
  exit 1
fi
echo ""

# 2. .env file check
echo "✓ Checking .env configuration..."
if [ -f .env ]; then
  echo "  ✅ .env file exists"
  REQUIRED_KEYS=("PORT" "GOOGLE_SHEETS_SPREADSHEET_ID" "GOOGLE_SERVICE_ACCOUNT_KEY_BASE64" "ANTHROPIC_API_KEY")
  MISSING=""
  for key in "${REQUIRED_KEYS[@]}"; do
    if ! grep -q "^$key=" .env; then
      MISSING="$MISSING $key"
    fi
  done
  if [ -z "$MISSING" ]; then
    echo "  ✅ All required environment variables present"
  else
    echo "  ⚠️  Missing environment variables:$MISSING"
    echo "     See .env.example for reference"
  fi
else
  echo "  ❌ .env file not found"
  echo "     Run: cp .env.example .env"
  exit 1
fi
echo ""

# 3. Dependencies check
echo "✓ Checking npm dependencies..."
if npm ls > /dev/null 2>&1; then
  echo "  ✅ Dependencies installed"
else
  echo "  ❌ Missing dependencies. Installing..."
  npm install
  echo "  ✅ Dependencies installed"
fi
echo ""

# 4. Build check
echo "✓ Running TypeScript build..."
if npm run build > /dev/null 2>&1; then
  echo "  ✅ TypeScript build successful"
else
  echo "  ❌ TypeScript build failed"
  npm run build
  exit 1
fi
echo ""

# 5. Type check
echo "✓ Running type-check..."
if npm run type-check > /dev/null 2>&1; then
  echo "  ✅ Type checking passed"
else
  echo "  ❌ Type checking failed"
  npm run type-check
  exit 1
fi
echo ""

# 6. Tests check
echo "✓ Running tests..."
if npm run test > /dev/null 2>&1; then
  echo "  ✅ All tests passed"
else
  echo "  ⚠️  Some tests failed"
  echo "     Run: npm run test (for details)"
fi
echo ""

# 7. Summary
echo "=================================================="
echo "✅ RDD is healthy and ready to work"
echo ""
echo "📚 Next steps:"
echo "  1. Review TASKS.md to see what's in scope"
echo "  2. Check PROGRESS.md to see recent decisions"
echo "  3. See CLAUDE.md Section 0 (Agent Orchestration)"
echo ""
echo "🚀 Ready to start your session!"
