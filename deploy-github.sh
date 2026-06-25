#!/usr/bin/env bash
# Secure GitHub Pages bootstrap script.
# Usage: GH_USER=your-id GH_TOKEN=github_pat_xxx REPO=k-tcg-quant bash deploy-github.sh
#
# Security notes:
# - The token is sent only through HTTPS headers.
# - The token is never written into git remote URLs.
# - Temporary API response files are removed on exit.

set -euo pipefail

: "${GH_USER:?GH_USER is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"
REPO="${REPO:-k-tcg-quant}"
API="https://api.github.com"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

repoResp="$(mktemp)"
pagesResp="$(mktemp)"
cleanup() {
  rm -f "$repoResp" "$pagesResp"
}
trap cleanup EXIT

echo "1) Create or reuse repository: $GH_USER/$REPO"
code=$(curl -s -o "$repoResp" -w "%{http_code}" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/user/repos" \
  -d "{\"name\":\"$REPO\",\"private\":false,\"description\":\"K-TCG Quant MVP\"}")

if [ "$code" = "201" ]; then
  echo "   created"
elif [ "$code" = "422" ]; then
  echo "   already exists"
else
  echo "   failed ($code):"
  cat "$repoResp"
  exit 1
fi

echo "2) Push main without storing token in remote"
git remote remove origin 2>/dev/null || true
git remote add origin "https://github.com/${GH_USER}/${REPO}.git"
git \
  -c user.name="$GH_USER" \
  -c user.email="${GH_USER}@users.noreply.github.com" \
  -c "http.https://github.com/.extraheader=AUTHORIZATION: Bearer $GH_TOKEN" \
  push -u origin main --force

echo "3) Enable GitHub Pages: main / root"
code=$(curl -s -o "$pagesResp" -w "%{http_code}" \
  -H "Authorization: Bearer $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/repos/$GH_USER/$REPO/pages" \
  -d '{"source":{"branch":"main","path":"/"}}')

if [ "$code" = "201" ] || [ "$code" = "409" ]; then
  echo "   Pages configured"
else
  echo "   Pages response ($code):"
  cat "$pagesResp"
fi

echo ""
echo "Public URL: https://${GH_USER}.github.io/${REPO}/"
