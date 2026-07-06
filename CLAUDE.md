# OP Box Index — 운영 지침 (모든 에이전트 필독)

이 프로젝트를 열면 **매번, 요청 없이도** 아래를 먼저 확인하고 챙긴다. 사용자는 "내가 모르는 것도 알아서 챙기라"고 명시적으로 요청했다 — 매번 다시 물어보지 말 것.

## 사용자 컨텍스트
- 비개발자, 짧고 직접적인 한국어 선호. 실제 사장님(1인 운영), 이 사이트로 **수익화**가 목표.
- **가격 정확도 최우선**: 불확실한 가격은 절대 노출 금지, 숨기는 게 항상 맞다. 추정치를 사실처럼 보여주지 않는다.
- 계정 생성·결제·GitHub 앱 권한 승인처럼 **영구적 권한을 넘기는 행위는 사용자가 직접** 클릭해야 한다 (분류기가 막는 게 정상 — 우회 시도 금지).

## 사이트 정보
- 라이브: https://opboxindex.com (GitHub Pages, repo: `gsa-svg/k-tcg-quant`, branch `main`)
- 메인 페이지: `packs.html` (영문 기본 `?hl=en`, 한글 `?hl=ko`)
- SEO 세트 가이드: `sets/*.html` (21개, `tools/generate-set-pages.js`로 재생성)
- 데이터: `data/onepiece-packs.json` (가격/매물, 자동 갱신됨)

## 수익화 상태 (2026-07-02 기준)
1. **Google AdSense**: 코드 배포됨(`ca-pub-1520891018658006`), `ads.txt` 있음. **승인 대기 중** — 매번 확인해서 승인됐으면 알려주고, 거절되면 사유 확인 후 콘텐츠 보강.
2. **eBay Partner Network**: campid `5339163744`, `packs.js`의 `epnUrl()`이 모든 eBay 링크에 자동 부착. 대시보드는 partner.ebay.com. **클릭/전환 늘리는 게 최우선 과제.**
3. **Google Search Console**: URL 접두어 속성 `https://opboxindex.com/`으로 인증 완료(HTML 파일 `googlee0d71bc0695b5651.html` — **절대 삭제 금지**, 지우면 인증 풀림). 사이트맵 제출됨, 색인 요청됨.
4. **GA4**: `G-P73SE1WVD0`, 전 페이지 배포됨.

## 매번 자동으로 점검할 것 (요청 없어도)
- [ ] `git log --oneline -10` — 최근 뭐가 바뀌었는지, 워크플로가 정상 커밋했는지
- [ ] `.github/workflows/` 두 개가 최근에 성공했는지 (`update-active-listings` 매일 03:00 KST, `update-market-data` 매주 월 03:00 KST) — GitHub Actions 탭에서 초록불 확인
- [ ] `data/onepiece-packs.json`의 `updated` 필드가 오늘/어제 날짜인지 (오래됐으면 워크플로 문제)
- [ ] eBay 최저가 링크 커버리지: 박스 20/20, PSA10 카드 183/199가 기준선. 크게 떨어지면 `tools/audit-active-listings.js` 결과 확인
- [ ] AdSense 승인 여부 (사용자가 알려주거나 사이트에 실제 광고가 뜨는지 확인)
- [ ] Search Console "색인생성 → 페이지" 색인 수 증가 추이, 실적(노출수) 추이
- [ ] 새 세트(예: OP-16, EB-04) 데이터가 채워졌으면 `node tools/generate-set-pages.js` 재실행 + sitemap 갱신 + 색인 요청

## 다음에 진행할 성장 작업 (우선순위)
1. **영문 아티클 추가** — `articles/`에 5개(2026-07-03 기준, OP-05 vs OP-06·PSA population 2편 추가함). 세트별/주제별 롱테일 키워드 아티클을 계속 늘리면 색인·유입·AdSense 심사에 유리. `tools/generate-set-pages.js`가 세트 페이지에 자동으로 관련 아티클 링크를 심으니, 새 아티클 추가 시 이 스크립트의 링크 목록도 같이 갱신할 것.
2. **eBay CTA 전환율 계속 개선** — GA4 `outbound_click` 이벤트로 어떤 버튼/문구가 클릭률 높은지 확인 후 반영.
3. **레딧/커뮤니티 백링크** — 사용자가 직접 공유해야 하는 부분이지만, 공유하기 좋은 형태(요약 카드, 짧은 링크)를 에이전트가 준비해줄 수 있다.
4. **PSA10 미매칭 16장** — 신뢰할 매칭이 생기기 전까지는 채우지 말 것 (추정 금지 원칙).
5. **가격 품질 리뷰 항목** — `tools/audit-price-quality.js` review 건수 주기적으로 정리.
6. **네이버 서치어드바이저** 등록 (국내 유입, 아직 미등록이면 진행).

## 절대 하지 말 것
- `.env`, eBay API 시크릿, GitHub 토큰을 출력하거나 커밋하지 않는다.
- `googlee0d71bc0695b5651.html` (GSC 인증 파일) 삭제 금지.
- 불확실한 가격을 "정상"처럼 보여주지 않는다 — 숨기는 게 항상 우선.
- GitHub 앱 설치/권한 승인, 결제, 계정 생성 등 영구 권한 행위를 대신 클릭하지 않는다 — 사용자에게 안내만 한다.

## 참고 문서 (자세한 이력)
- `docs/handoff-2026-07-01-accounts.md` — 도메인 DNS, GA4, GSC, AdSense 계정 세팅 상세
- `docs/automation.md` — 워크플로 상세
- `docs/handoff-2026-06-29.md` — 가격 데이터 정합성 작업 이력
- `docs/ebay-api.md`, `docs/price-data.md` — eBay/가격 로직 상세

새 세션을 시작하는 에이전트는 이 문서를 읽은 뒤, 위 체크리스트를 실제로 실행(git log, workflow 상태 확인 등)하고 이상 있으면 사용자에게 먼저 보고한다. 정상이면 굳이 보고하지 않고 다음 성장 작업으로 넘어간다.

## 2026-07-06 추가 사항 (Claude)
- **배포 실패 대응**: GitHub Pages의 "Deploy to GitHub Pages" 단계가 간헐 실패함(인프라 결함, 콘텐츠 무관).
  배포 후 반드시 라이브 반영을 curl로 확인하고, 실패 시 `git commit --allow-empty -m "chore: retrigger"` 후 push로 재트리거.
- **IndexNow 구축됨**: `tools/indexnow-submit.js` — sitemap 전체 URL을 Bing/Naver/Yandex에 즉시 통지.
  키 파일(루트의 32자리 hex .txt)은 **삭제 금지**. 사이트맵에 URL 추가/대량 갱신 시 이 스크립트 재실행.
- **og-image.png**: 1200x630 소셜 공유 카드(루트). 전 페이지 og:image + twitter summary_large_image 적용.
  브랜딩 바뀌면 세션에서 PIL로 재생성(생성 코드는 git log 2026-07-06 커밋 참고).
- **PSA10 최저가 오매칭 방어**: 두 수집기의 hasVariantSignal 강화(SP↔패러렐↔망가 교차 차단) +
  활성 수집기에 "Sold 중간값 35% 미만이면 버튼 숨김" 안전장치. 이 로직 완화 금지.
- **GSC 소유 계정 주의**: Search Console 속성 소유자는 kimtt1107@gmail.com(감자). gsa@whatsong.kr 아님.

## 일본 시장 판단 (2026-07-06, 사용자와 합의된 방향)
- **일본어 버전은 당분간 만들지 않는다.** 야후재팬=구글 엔진이라 별도 등록 불필요하지만,
  일본 소비자는 eBay에서 구매하지 않음(메루카리/야후옥션/카드샵 사용) → 주 수익원인 EPN이 전환 안 됨.
- 재검토 조건: ①AdSense 승인 후(일본 트래픽도 광고 수익화 가능) ②일본측 제휴 확보 시
  (Amazon JP Associates — amazon-lottery.html의 Amazon.co.jp 링크 수익화 가능, 라쿠텐 등).
- 틈새 메모: 일본 '판매자'가 해외(eBay) 시세를 궁금해하는 수요는 존재 — JP 버전 만들 때 셀링포인트.
