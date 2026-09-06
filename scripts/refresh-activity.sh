#!/bin/bash
# refresh-activity.sh — regenerate the local activity snapshot and push it.
#
# Why this exists: data/activity-local.json can only be produced on this machine.
# It is counted from local clones with `git log`, which needs no credential and,
# unlike the GitHub API, can see private repositories. CI runners have no clones,
# so CI cannot refresh it. Left alone it ages out, build-stats falls back to the
# public-only API, and the page's weekly numbers drop by roughly 40x.
#
# Runs Mondays before the GitHub Actions refresh (05:00 UTC / 09:00 Dubai) so the
# workflow rebuilds from a snapshot committed minutes earlier.
#
# Commits straight to main deliberately: this is one generated data file, matching
# what the existing weekly Actions job already does. Nothing here touches prose.
set -euo pipefail

REPO="/Users/parameshwaraniyer/Code/github/paramiyer.github.io"
[ -d "$REPO" ] || REPO="/Users/parameshwaraniyer/Code/github/resume-site"
cd "$REPO"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') refresh-activity ==="

git switch -q main
git pull -q --rebase origin main

node scripts/local-activity.mjs
node scripts/build-pages.mjs >/dev/null
node scripts/build-stats.mjs
node scripts/validate.mjs >/dev/null   # never push a tree that fails its own checks

if git diff --quiet -- data/activity-local.json; then
  echo "BOT_RESULT: SUCCESS (no change)"
  exit 0
fi

git add data/activity-local.json data/github-stats.json index.html sitemap.xml
git commit -q -m "chore: weekly refresh of local activity snapshot [skip ci]"
git push -q origin main
echo "BOT_RESULT: SUCCESS (pushed)"
