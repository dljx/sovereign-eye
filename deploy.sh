#!/usr/bin/env bash
# Deploy sovereign-eye to Cloudflare Pages production.
# Builds with esbuild (build.mjs) -> dist/ with content-hashed filenames, then
# deploys dist/. No manual ?v= cache-busting (the hashes handle it) and no
# in-browser Babel. Deploying the source dir directly would ship the un-built
# app, so always go through this script.
#
# Usage: ./deploy.sh            (build + deploy to production)
#        BRANCH=main ./deploy.sh
set -euo pipefail

PROJECT="sovereign-eye"
BRANCH="${BRANCH:-main}"   # Cloudflare Pages production branch for this project

# Warn (don't block) on uncommitted changes so deploys are traceable.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "WARNING: uncommitted changes in working tree (deploying them anyway)."
fi

# esbuild is a no-save dev dependency — install it if missing.
if [ ! -d node_modules/esbuild ]; then
  echo "Installing esbuild..."
  npm install esbuild@0.24.0 --no-save --silent
fi

echo "Building (esbuild -> dist/)..."
node build.mjs

echo "Deploying dist/ to Cloudflare Pages (project=${PROJECT}, branch=${BRANCH})..."
npx --yes wrangler pages deploy dist --project-name="${PROJECT}" --branch="${BRANCH}"
echo "Done. Production: https://${PROJECT}.pages.dev"
