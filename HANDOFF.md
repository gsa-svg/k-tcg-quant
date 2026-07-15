# 인수인계 — OP Box Index (opboxindex.com)

> 새 세션/에이전트(Codex 등)가 이어받을 때 이 문서를 먼저 읽고, 상세는 **CLAUDE.md / AGENTS.md** 참고.
> 갱신: 2026-07-15.

## 0. 2026-07-15 세션 (그래프4 + PSA 패널 + 8/31 예약) — 캐시 `20260715b`
- **인터랙티브 JP vs EN 박스 그래프(그래프4)**: `renderBoxInteractive`(위=일본/아래=영문 실제 원화 2단 small-multiples, 압축 없음) + `initBoxCharts`(hover/탭 → 날짜+양쪽 가격 툴팁 + 세로 크로스헤어, 바닐라). `hasInteractiveBox(set)`(=JP·EN 시세 둘 다 준비)인 세트만 적용 → **현재 OP-13만**. 나머지 세트는 기존 UI 유지.
- **PSA 등급·개봉 패널**: `renderPsaDestruction`(우리 `set.psa`/`psaGem`/`psaTotal` 기반, 캡처처럼 총 등급·Gem·체이스표). 인터랙티브 세트(OP-13)에만 표시. **TCG Quant 숫자 복사 안 함**(경쟁사 가공+TCGPlayer혼입).
- **밸류패널(`renderSetAnalytics`)**: 인터랙티브 세트에선 숨김(그래프4+PSA로 대체), 나머지 세트는 그대로.
- **8/31 예약작업**(`~/.claude/scheduled-tasks/opbox-aug31-market-data-deploy`): 그때까지 누적된 **공급(eBay active·중국제외)+판매량(eBay sold 90일 스크래핑)+PSA** 를 OP01~16에 TCG Quant식 Market Data 콤보로 반영·배포·보고. ⚠️ **선행조건: GitHub 시크릿 `EBAY_CLIENT_ID/SECRET` 재등록**(7/5부터 비어 공급 자동수집 중단). 안 하면 공급은 현재 스냅샷만.
- 참고 벤치마크: **tcgquant.com**(공급=eBay+TCGPlayer 시장가±20% 매물수, 판매량=기간별 sold박스수). Collectr API엔 판매량/공급 히스토리 없음(가격만, `marketplace_listings`·`grades_population_history` 빈배열 확인). 방법론만 참고, 숫자는 우리 자체 수집.

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
1. **[정확도 부채] 카드 PSA10 sold** — 상위 9장은 7/10 갱신 완료(6B 참고). 나머지 ~100장은 아직 6/29(대부분 저가·멀티변형). `node tools/psa10-sold-refresh.js`로 URL+추출기 얻어 브라우저(browser_batch navigate+javascript_tool 1장씩)로 갱신. **번호가 유일한 카드만**(멀티변형 보류). n>=3·제목 변형확인만 채택. KRW 저장(median_usd*fx.usdKrw). ※ sold 날짜는 UI에 안 보이므로 신선도는 정확도용(사용자 비가시).
2. **주 1회 sold 재수집**(박스+카드). 무인 불가 → 세션에서 브라우저로. `box-sold-urls.js`/`psa10-sold-refresh.js` 헬퍼로 빠르게.
3. **8월초**: 영문판 박스 그래프 자동 활성(코드상 날짜게이트 이미 됨) — 그 전 7월 sold 몇 번 더 수집 권장.
4. **성장(트래픽)**: 색인은 IndexNow+사이트맵+내부링크 완료. 다음 = 커뮤니티 공유 카드(레딧 r/OnePieceTCG 등), 아티클 추가.
5. **최대 활용 아이디어**: sold 판매량(수요 신호)·가격 모멘텀(sold 스냅샷 2개+ 후) 지표화.

## 6B. 2026-07-10 B/A/C 패스 (리텐션·데이터·속도) — 캐시값 `20260710b`
방문자 실측(GA4 authuser=1=kimtt1107): 지난 7일 활성 75명(미국34·한국20), 검색유입 27세션, eBay outbound_click 60회. 서치콘솔: 노출 150·클릭 20·평균순위 7.4. → 리텐션 나쁘지 않음. 아래로 계속 고도화.
- **B(랜딩 다듬기)**: 카드 0장인 세트(OP-16)가 "준비중" disabled 타일 + 박스 시세도 안 뜨는 죽은 페이지였음. → `renderDetail` 카드없음 분기에서 박스 시세(sold/active) 렌더 + "TOP10 집계중" 안내(`.pendingCards`). `renderPackGrid`는 `hasBoxData()` 있으면 칩 클릭 가능("박스 시세" 태그). `applyRouteState`도 박스만 있는 세트 `?set=` 라우팅 허용. (기존엔 카드 있는 세트만) — `hasBoxData()` 헬퍼 추가.
- **A(PSA10 sold 완성·정확도)**: 상위 9장 브라우저 eBay 재수집(7/10). 변형필터(vOK) 그대로, 제목 확인, n>=3만 채택. OP13-118·OP09-119·OP07-051·EB03-055·EB03-026·OP01-120·OP11-118·EB03-053·OP01-003. 표본 대폭↑(4→18 등). 실제 냉각 반영(OP09-119 -32%, OP01-003 -43%). **같은번호 멀티변형 15장(OP05-119·EB02-061·OP06-118·EB01-006·OP05-069·OP09-051 등)은 오염 위험으로 보류(6/29 유지)** — 정확도 원칙. 나머지 저가·6/29 카드는 미착수(가치 낮음).
- **C(속도/모바일)**: 측정 CLS **0**, DOM 130ms, 광고 async·폰트 display=swap·preconnect 이미 양호. FCP~2s는 AdSense 메인스레드(수익원, 손 안 댐). 개선: **데이터 JSON(459KB)을 index/packs/compare.html에서 `<link rel=preload as=fetch>`** → SPA 첫 렌더 앞당김. ⚠️ **preload href의 `?v=`는 DATA_VERSION과 반드시 동기**(안 그러면 이중 다운로드). 버전 bump 스크립트가 `20260710b` 문자열을 전부 치환하므로 같이 갱신됨 — 수동으로 DATA_VERSION만 바꾸지 말 것.

## 6A. 2026-07-10 SEO · 안정성 패스 (Codex)
- **홈 URL 정상화**: 기존 `index.html`은 곧바로 `packs.html`로 보내는 리다이렉트 전용 페이지였음. 이제 루트 `/` 자체가 실제 트래커 HTML을 제공한다. 홈 canonical, sitemap의 대표 URL, 브랜드 링크를 모두 `https://opboxindex.com/`으로 통일했다.
- **구조화 데이터 정리**: 홈의 `WebSite` 스키마에 `alternateName: OPBoxIndex`와 `Organization`을 넣었다. 실제 사이트 내 검색 기능이 없는데 선언돼 있던 `SearchAction`은 제거했다. Google이 홈을 OP-01 상세처럼 이해할 여지를 줄이는 목적이다.
- **새 영문 아티클**: `articles/one-piece-card-price-guide.html` 추가. `One Piece card prices`, `PSA 10 card prices`, `Japanese NM`, `eBay sold prices` 의도를 설명하며, 변형 오매칭·표본 부족을 숨기는 운영 원칙을 명시했다. 아티클 허브·홈·전 세트 가이드에서 내부링크를 연결했고 sitemap에도 넣었다.
- **SEO 자동 검사**: `tools/audit-seo.js` 추가. 홈/아티클/세트 페이지의 제목, 설명, canonical, H1, OG 이미지, schema, sitemap 대표 URL을 검사한다. 일일·주간 워크플로의 시작 단계에서 자동 실행된다.
- **API 재시도**: `tools/run-with-retry.js` 추가. eBay active 수집(박스/영문박스/PSA10 링크 및 주간 영문 NM)은 최대 3회, 10초/20초 backoff로 재시도한다. 재시도 뒤에도 실패하면 워크플로가 빨간불·로그 아티팩트를 남긴다.
- **검증 완료**: `node tools/audit-seo.js` 통과(홈 2, 아티클 10, 세트 20). 390px 모바일 DOM 측정에서 가로 넘침 0, 홈 title/canonical/H1 정상, 브라우저 console error 0. 새 캐시값 `20260710seo`.
- **자동화 주의**: 2026-07-10 03:00 KST active-listing 실행은 `Update eBay active box links` 단계에서 실패했다. 로컬 OAuth 키는 정상(`valid`)이며 공개 API는 상세 로그 다운로드를 막는다. 이번 재시도 배포 후 다음 03:00 KST 실행을 확인할 것. 또 실패하면 GitHub Actions 실행 로그에서 eBay HTTP 상태를 확인하고, GitHub 시크릿이 로컬 rotated Production 값과 같은지 점검한다. `update-ebay-psa10-prices.js`는 절대 실행 금지 규칙은 그대로다.

## 7. Codex 최적화 패스 시 볼 만한 것
- `packs.js`(~1200줄) 단일 파일 — 렌더 함수 많음. 성능: 대량 DOM innerHTML 재생성(renderDetail). 모듈 분리 검토(단 배포는 정적 파일이라 번들러 없음, 바닐라 유지).
- SEO 페이지 생성기(`generate-set-pages.js`)가 매일 워크플로에서 재생성됨 — 스키마/메타 보강 여지.
- 접근성(aria)·라이트하우스 점수·이미지 lazy·CLS 점검.
- ⚠️ 값/데이터 로직은 정확도 규칙(4장) 위반 없이. UI/성능/코드정리 위주 권장.

## 8. 검증 습관
- 코드 바꾸면 `node --check packs.js`, 프리뷰(preview_* 도구)로 DOM 측정(스크린샷은 광고스크립트로 자주 먹통 — DOM eval로 검증).
- 배포 후 `curl https://opboxindex.com/...` 로 라이브 확인.

## Suggested skills for next agent
- `diagnosing-bugs`: eBay 워크플로가 재시도 후에도 실패할 때만, 로그 기반으로 원인을 분리할 때 사용.
- `browser:control-in-app-browser`: 모바일 390px와 배포 후 실제 DOM/canonical을 확인할 때 사용.
- `handoff`: 다음 세션으로 넘길 때 현재 상태를 짧은 임시 인수인계로 남길 때 사용.
