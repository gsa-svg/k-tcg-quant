# OP Box Index Security Policy

## 핵심 원칙

- eBay `Client Secret`, GitHub token, 광고/분석 키의 비밀값은 절대 커밋하지 않는다.
- 공개 페이지에는 가격 데이터와 공개 이미지 URL만 둔다. API 호출은 브라우저에서 직접 하지 않는다.
- eBay 수집은 로컬 또는 GitHub Actions 서버 작업에서만 실행하고, 결과 JSON만 배포한다.
- 화면 캡처, 문서, 인수인계 파일에 비밀값이 보이면 즉시 키를 Rotate 한다.

## eBay API

- `.env`는 로컬 전용이며 `.gitignore` 대상이다.
- GitHub Actions에서는 Repository Secrets에만 저장한다.
- 필요한 권한은 Browse API 가격 조회에 한정한다.
- 사용자 eBay 로그인 토큰은 저장하지 않는다.
- 현재 사이트는 공개 상품 검색/가격 리서치만 사용한다.

## Static Site Hardening

- 모든 HTML 페이지에 Content Security Policy를 둔다.
- 허용 이미지 도메인은 현재 `tcgplayer-cdn.tcgplayer.com`, `card.yuyu-tei.jp`로 제한한다.
- 외부 스크립트는 향후 GA/AdSense에 필요한 Google 도메인만 허용한다.
- `frame-ancestors 'none'`, `object-src 'none'`, `form-action 'none'`으로 불필요한 삽입/폼 전송을 막는다.
- `frame-ancestors`는 meta CSP에서 적용되지 않으므로, Cloudflare Pages/Netlify/Vercel 같은 호스팅으로 옮기면 HTTP header로 추가한다.
- 외부 링크는 새 창일 때 `rel="noopener noreferrer"`를 사용한다.

## Before Deploy

1. `git status --short`로 의도한 파일만 변경됐는지 확인한다.
2. 비밀값 검색:
   `rg -n "(SECRET|TOKEN|PASSWORD|CLIENT_SECRET|EBAY_CLIENT_SECRET|sk-|BEGIN PRIVATE)" -S .`
3. `.env`와 `docs/handoff-*.md`가 커밋 대상이 아닌지 확인한다.
4. 브라우저에서 `packs.html` 로딩, 이미지, 콘솔 오류를 확인한다.

## Incident Response

1. 노출된 키를 즉시 Rotate 또는 폐기한다.
2. GitHub Secrets와 로컬 `.env`를 새 값으로 교체한다.
3. 노출된 파일이 커밋됐다면 히스토리 제거보다 먼저 키 폐기를 완료한다.
4. 커밋/배포 로그에 비밀값이 남았는지 확인한다.
