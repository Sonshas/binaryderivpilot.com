#!/usr/bin/env bash
# Zip anything under the site root that is NOT the release layout, then remove it.
# Keeps: releases/  current (symlink)  archives/ (created here)
# Usage (on the VPS as deploy or root):
#   bash archive-legacy-site.sh
#   bash archive-legacy-site.sh /var/www/optionmarkettraders
#   bash archive-legacy-site.sh /var/www/optionmarkettraders /var/www/html
set -euo pipefail

SITE_ROOT="${1:-/var/www/optionmarkettraders}"
EXTRA_ROOT="${2:-}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
ARCHIVE_DIR="${SITE_ROOT}/archives"
ARCHIVE_PATH="${ARCHIVE_DIR}/legacy-${STAMP}.tar.gz"

mkdir -p "$ARCHIVE_DIR"

echo "==> Site root: ${SITE_ROOT}"
cd "$SITE_ROOT"

mapfile -t leftovers < <(
  find . -mindepth 1 -maxdepth 1 \
    ! -name 'releases' \
    ! -name 'current' \
    ! -name 'archives' \
    -printf '%P\n'
)

if ((${#leftovers[@]} > 0)); then
  echo "==> Archiving leftover paths at site root: ${leftovers[*]}"
  tar -czf "$ARCHIVE_PATH" "${leftovers[@]}"
  echo "==> Wrote ${ARCHIVE_PATH}"
  rm -rf -- "${leftovers[@]}"
  echo "==> Removed archived leftovers from ${SITE_ROOT}"
else
  echo "==> No leftover files at site root (only releases/current/archives)."
fi

if [[ -n "$EXTRA_ROOT" && -d "$EXTRA_ROOT" ]]; then
  EXTRA_ARCHIVE="${ARCHIVE_DIR}/extra-$(basename "$EXTRA_ROOT")-${STAMP}.tar.gz"
  echo "==> Archiving extra tree ${EXTRA_ROOT} -> ${EXTRA_ARCHIVE}"
  tar -czf "$EXTRA_ARCHIVE" -C "$(dirname "$EXTRA_ROOT")" "$(basename "$EXTRA_ROOT")"
  echo "==> Removing ${EXTRA_ROOT}"
  rm -rf -- "$EXTRA_ROOT"
fi

echo "==> Done. Archives under ${ARCHIVE_DIR}"
ls -lah "$ARCHIVE_DIR" || true
