#!/bin/bash

echo "🚀 SF Flow Apex Converter - Publishing Checklist"
echo "================================================"
echo ""

# Check if logged into npm
echo "1. Checking npm login..."
NPM_USER=$(npm whoami 2>/dev/null)
if [ $? -eq 0 ]; then
    echo "   ✅ Logged in as: $NPM_USER"
else
    echo "   ❌ Not logged in. Run: npm login"
    exit 1
fi

# Check if on main branch
echo ""
echo "2. Checking git branch..."
BRANCH=$(git branch --show-current)
if [ "$BRANCH" != "main" ]; then
    echo "   ⚠️  Currently on branch: $BRANCH"
    echo "   Run these commands to merge to main:"
    echo "   git checkout main"
    echo "   git merge $BRANCH"
else
    echo "   ✅ On main branch"
fi

# Check for uncommitted changes
echo ""
echo "3. Checking for uncommitted changes..."
if [ -n "$(git status --porcelain)" ]; then
    echo "   ❌ Uncommitted changes found. Commit or stash them first."
    exit 1
else
    echo "   ✅ No uncommitted changes"
fi

# Check build
echo ""
echo "4. Testing build..."
npm run build > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Build successful"
else
    echo "   ❌ Build failed"
    exit 1
fi

# Test commands
echo ""
echo "5. Testing commands..."
node dist/index.js analyze exampleflow.xml > /dev/null 2>&1
if [ $? -eq 0 ]; then
    echo "   ✅ Analyze command works"
else
    echo "   ❌ Analyze command failed"
    exit 1
fi

echo ""
echo "✨ All checks passed!"
echo ""
echo "Ready to publish. Run these commands:"
echo ""
echo "# If not on main branch yet:"
echo "git checkout main"
echo "git merge feature/simplified-bulkification"
echo ""
echo "# Push to GitHub:"
echo "git push origin main"
echo ""
echo "# Create release tag:"
echo "git tag -a v2.0.0 -m 'Release v2.0.0 - Complete rewrite'"
echo "git push origin v2.0.0"
echo ""
echo "# Publish to npm:"
echo "npm publish"
echo ""
echo "# Verify publication:"
echo "npm view @cclabsnz/sf-flow-apex-converter@2.0.0"