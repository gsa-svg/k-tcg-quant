# 인수인계 — OP Box Index (opboxindex.com)

> 새 세션/에이전트(Codex 등)가 이어받을 때 이 문서를 먼저 읽고, 상세는 **CLAUDE.md / AGENTS.md** 참고.
> 갱신: 2026-07-09.

## 1. 한 줄 정체성
원피스 TCG **부스터박스/카드 시세 리서치 사이트**. eBay 실데이터를 최대한 활용하되 **정확도가 최우선**(불확실하면 숨긴다: 틀린값 노출 < 빈값). 수익화: eBay 제휴(EPN, 켜짐) + AdSense(심사중). 사장님은 비개발자, **짧고 반말**로 소통.

## 2. 위치·배포
- 라이브: https://opboxindex.com — GitHub Pages, repo `gsa-svg/k-tcg-quant` branch `main`.
- 프로젝트 폴더: `C:\Users\kimtt\Documents\Codex\2026-06-21\https-youtu-be-rhuyy9lp72m-si-a4jhiygdebzzpvjf`
- 메인 앱: `packs.html` + `packs.js`(SPA 렌더러) + `styles.css`. 데이터: `data/onepiece-packs.json`(단일 소스, 여기서만 값 읽기).
- 정적 SEO 페이지: `sets/*.html`·`sets/index.html`·`psa10-ranking.html`(생성기 `tools/generate-set-pages.js`), `compare.html`, `articles/*`.
- ⚠️ **Pages 배포가 자주 느리고 간헐 실패**. push 후 curl로 라이브 확인. **연속 재트리거 금지**(진행중 배포를 취소시켜 더 늦어짐) — 실패 확정 후 1회만.
- 캐시버스트: `packs.js`의 `DATA_VERSION` + html의 `?v=` 쿼리. 데이터/코드 바꾸면 반드시 bump.
- Windows/PowerShell. 콘솔 cp949라 한글 print 깨짐(결과는 파일로). git 경고 LF→CRLF는 무해. Codex의 미커밋 파일(.gitignore 등)이 rebase 막으면 stash 후 pull/push.

## 3. eBay 데이터 — 자동 vs 수동 (핵심)
| 데이터 | 소스 | 갱신 |
|---|---|---|
| 박스 호가(active) | eBay **Browse API** | ✅ 매일 워크플로 자동 |
| 카드 PSA10 최저매물 링크 | Browse API | ✅ 매일 자동 |
| NM(생) 카드가 | yuyu-tei | 주간 |
| **박스 sold(실거래)** | **브라우저 수동** | ⚠️ 주1회 수동 (`tools/box-sold-urls.js`) |
| **카드 PSA10 sold** | **브라우저 수동** | ⚠️ 수동 (`tools/psa10-sold-refresh.js`) |
- ⚠️ **eBay 옛 Finding API(sold) 완전 사망(503)** — 로컬·GitHub 다 안 됨. Marketplace Insights API는 승인 필요(미보유). **그래서 sold는 "사용자 로컬 브라우저(claude-in-chrome)"로만 수집 가능**(eBay가 서버/데이터센터IP 차단). CI·클라우드 자동화 불가.
- 자동 파이프라인은 GitHub secret `EBAY_CLIENT_ID`/`EBAY_CLIENT_SECRET` 필요(과거 소실로 3일 정지 사고 있었음 — 없으면 재등록 요청).

## 4. 정확도 규칙 (절대 준수)
- **표본 n<3 sold는 시세로 노출 금지** — 코드 전반에 n>=3 가드(딜칩·PSA밴드·카드표·랭킹·프리미엄).
- **변형 매칭이 사고지점**(레드망가↔망가↔SP↔parallel). `update-ebay-psa10-active-links.js`의 `hasVariantSignal` 로직 = sold 추출기의 `variantOK`. **절대 완화 금지.** 과거 레드망가 오매칭 사고 기록됨.
- **같은 번호 멀티변형**(예 OP06-118 alt art manga vs manga)은 브라우저 추출기가 못 구분 → 갱신 시 값 붕괴. 이런 카드는 갱신 보류(6/29값 유지)하거나 수동 확인.
- `tools/update-ebay-psa10-prices.js` **절대 실행 금지**(sold 데이터 파괴, 실사고 롤백함).
- **TCGplayer/PriceCharting 스크래핑 금지**(ToS + TCGplayer 제휴 리스크). 참고(대조)용 비공개만.
- 삭제 금지: `googlee0d71bc0695b5651.html`(GSC), IndexNow 키파일 32자hex.txt, impact-site-verification 메타.

## 5. 최근 세션에 한 것 (2026-07-09)
- 차트 부드러운 곡선 개편, 배송비 **US 기준** 표시, 네비 활성표시 버그 수정(현재페이지만).
- 세트 SEO 페이지 실데이터 심화 + **PSA10 가치 랭킹 페이지**(psa10-ranking.html) 신설, 네비/사이트맵 등록, IndexNow 통지.
- **박스 "시세(sold) vs 매물(호가)" 두 숫자 모델** — 일판·영문 20세트씩. 영문판 **그래프는 2026-08-01부터**(7월 실거래 축적 후, `renderBoxSeries`의 `EN_GRAPH_FROM`).
- PSA10 sold n>=3 전면 강제(표본<3 26장 숨김). PSA10 카드 sold 상위 8엔트리 7/9 갱신(변형필터 검증됨).

## 6. 남은 작업 / 다음 우선순위
1. **[정확도 부채] 카드 PSA10 sold 나머지 ~113장 6/29 고정** — `node tools/psa10-sold-refresh.js` 로 카드별 URL+추출기 얻어 브라우저(browser_batch 3~4장씩)로 갱신. 가치 높은 순. **멀티변형 번호는 보류.** n>=3·기존 대역과 sane만 채택. KRW로 저장(median_usd*fx.usdKrw).
2. **주 1회 sold 재수집**(박스+카드). 무인 불가 → 세션에서 브라우저로. `box-sold-urls.js`/`psa10-sold-refresh.js` 헬퍼로 빠르게.
3. **8월초**: 영문판 박스 그래프 자동 활성(코드상 날짜게이트 이미 됨) — 그 전 7월 sold 몇 번 더 수집 권장.
4. **성장(트래픽)**: 색인은 IndexNow+사이트맵+내부링크 완료. 다음 = 커뮤니티 공유 카드(레딧 r/OnePieceTCG 등), 아티클 추가.
5. **최대 활용 아이디어**: sold 판매량(수요 신호)·가격 모멘텀(sold 스냅샷 2개+ 후) 지표화.

## 7. Codex 최적화 패스 시 볼 만한 것
- `packs.js`(~1200줄) 단일 파일 — 렌더 함수 많음. 성능: 대량 DOM innerHTML 재생성(renderDetail). 모듈 분리 검토(단 배포는 정적 파일이라 번들러 없음, 바닐라 유지).
- SEO 페이지 생성기(`generate-set-pages.js`)가 매일 워크플로에서 재생성됨 — 스키마/메타 보강 여지.
- 접근성(aria)·라이트하우스 점수·이미지 lazy·CLS 점검.
- ⚠️ 값/데이터 로직은 정확도 규칙(4장) 위반 없이. UI/성능/코드정리 위주 권장.

## 8. 검증 습관
- 코드 바꾸면 `node --check packs.js`, 프리뷰(preview_* 도구)로 DOM 측정(스크린샷은 광고스크립트로 자주 먹통 — DOM eval로 검증).
- 배포 후 `curl https://opboxindex.com/...` 로 라이브 확인.
