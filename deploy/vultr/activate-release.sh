#!/usr/bin/env bash
# Activate a release directory uploaded under $SITE_ROOT/releases/$RELEASE.
# Usage: activate-release.sh [SITE_ROOT] [RELEASE] [KEEP_RELEASES]
set -euo pipefail

SITE_ROOT="${1:-/var/www/binaryderivpilot}"
RELEASE="${2:?release id required (e.g. 20261008-181500)}"
KEEP_RELEASES="${3:-5}"

cd "$SITE_ROOT"
test -f "releases/${RELEASE}/index.html"
chmod -R u+rwX,go+rX,go-w "releases/${RELEASE}"
ln -sfn "${SITE_ROOT}/releases/${RELEASE}" current.tmp
mv -Tf current.tmp current

prune_from=$((KEEP_RELEASES + 1))
ls -1 releases | grep -E '^[0-9]{8}-[0-9]{6}$' | sort -r | tail -n "+${prune_from}" | while read -r old; do
  rm -rf -- "releases/${old}"
done

echo "Active release: $(readlink current)"
