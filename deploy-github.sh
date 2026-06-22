#!/usr/bin/env bash
# GitHub Pages 자동 배포 스크립트.
# 사용법: GH_USER=깃허브아이디 GH_TOKEN=토큰 REPO=k-tcg-quant bash deploy-github.sh
set -euo pipefail

: "${GH_USER:?GH_USER(깃허브 아이디) 필요}"
: "${GH_TOKEN:?GH_TOKEN(personal access token) 필요}"
REPO="${REPO:-k-tcg-quant}"
API="https://api.github.com"
DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

echo "1) 저장소 생성: $GH_USER/$REPO"
code=$(curl -s -o /tmp/repo.json -w "%{http_code}" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/user/repos" \
  -d "{\"name\":\"$REPO\",\"private\":false,\"description\":\"K-TCG Quant MVP\"}" )
if [ "$code" = "201" ]; then echo "   생성됨"; elif [ "$code" = "422" ]; then echo "   이미 존재 → 그대로 사용"; else echo "   실패($code):"; cat /tmp/repo.json; exit 1; fi

echo "2) 원격 연결 및 푸시"
git remote remove origin 2>/dev/null || true
git remote add origin "https://${GH_USER}:${GH_TOKEN}@github.com/${GH_USER}/${REPO}.git"
git -c user.name="$GH_USER" -c user.email="${GH_USER}@users.noreply.github.com" push -u origin main --force

echo "3) GitHub Pages 활성화 (main / root)"
code=$(curl -s -o /tmp/pages.json -w "%{http_code}" \
  -H "Authorization: token $GH_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  "$API/repos/$GH_USER/$REPO/pages" \
  -d '{"source":{"branch":"main","path":"/"}}' )
if [ "$code" = "201" ] || [ "$code" = "409" ]; then echo "   Pages 설정 완료(반영까지 1~2분)"; else echo "   Pages 응답($code):"; cat /tmp/pages.json; fi

# 토큰이 박힌 원격 URL은 즉시 정리
git remote set-url origin "https://github.com/${GH_USER}/${REPO}.git"

echo ""
echo "✅ 공개 URL:  https://${GH_USER}.github.io/${REPO}/"
