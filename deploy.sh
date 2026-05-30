#!/usr/bin/env bash
# Deploy sovereign-eye to Cloudflare Pages production.
# Auto-bumps every ?v= cache tag in index.html/mobile.html so browsers/edge load
# the new code (the manual-bump footgun), then deploys to the production branch.
#
# Usage: ./deploy.sh            (deploys to production)
#        BRANCH=main ./deploy.sh
set -euo pipefail

PROJECT="sovereign-eye"
BRANCH="${BRANCH:-main}"   # Cloudflare Pages production branch for this project
STAMP="$(date +%Y%m%d%H%M)"

# Warn (don't block) on uncommitted changes so deploys are traceable.
if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
  echo "WARNING: uncommitted changes in working tree (deploying them anyway)."
fi

# Bump all ?v=<tag> query strings to the current timestamp in both entry points.
for f in index.html mobile.html; do
  [ -f "$f" ] && sed -i.bak -E "s/\?v=[0-9a-zA-Z._-]+/?v=${STAMP}/g" "$f" && rm -f "$f.bak"
done
echo "Bumped ?v= cache tags to ${STAMP}."

echo "Deploying to Cloudflare Pages (project=${PROJECT}, branch=${BRANCH})..."
npx --yes wrangler pages deploy . --project-name="${PROJECT}" --branch="${BRANCH}"
echo "Done. Production: https://${PROJECT}.pages.dev"
