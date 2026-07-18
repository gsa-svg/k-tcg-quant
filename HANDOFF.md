# 인수인계 — OP Box Index (opboxindex.com)

> 새 세션/에이전트(Codex 등)가 이어받을 때 **이 문서의 START 섹션부터** 읽고, 상세는 **CLAUDE.md / AGENTS.md** 참고.
> 갱신: 2026-07-18 밤.

## 2026-07-18 업데이트 — 오늘 한 것 + 다음 작업 (여기부터 읽기)

**오늘 완료(전부 push·guard 통과, 캐시버전 `20260718e`):**
1. **네비 통일 + 재발방지** — Market Index 링크가 articles 전체·op-17·eb-05 등 19개 페이지 네비에서 누락(눌러 이동하면 사라지던 버그) → 전 80페이지 통일. 생성기 3곳(card/weekly-report/set) 템플릿도 수정. **guard-invariants.js에 N1 검사 추가**: 네비 보유 페이지는 6개 라벨(부스터박스/비교/PSA10/마켓지수/세트가이드/아마존) 전부 필수, 누락 시 FAIL→배포차단(data-ko 라벨 기준).
2. **SEO/애드센스** — privacy.html 124→766단어(제3자쿠키/DART/광고옵트아웃3종/GA옵트아웃/제휴고지/GDPR·CCPA/아동/연락처 = 애드센스 재심사 대비). set/market/eb-05 생성기 타이틀 90~110→63~74자, 설명 250~290→~150자로 정상화(키워드는 앞 유지).
3. **한국어 정적 허브 `/ko/` 신설(유입 핵심)** — 기존 data-ko JS스왑은 네이버 Yeti(JS 미실행)에 안 보이고 `/?hl=ko`는 canonical이 /로 가 구글 미색인이었음. `tools/generate-ko-pages.js`가 검증된 onepiece-packs.json에서 **정적 한국어 HTML** 생성(21세트 원화 시세표+정가배수+재판+OPBOX지수+개봉미터+FAQ, 스키마 포함). 사이트맵 등재·hreflang(`/ko/`↔`market.html`)·IndexNow 제출·야간워크플로 편입·guard PUBLIC_HTML에 `ko` 포함. 홈 canonical/hreflang은 사고예방 위해 미변경. **사용자가 네이버 카페에 붙일 URL = opboxindex.com/ko/.** 상세: 메모리 project-opbox-korean-seo.
4. **카드 시세이력 오염 정리(정확도)** — 초기수집(7/7~7/10)이 변형매칭 미성숙으로 엉뚱한 저가를 긁어 카드페이지 "최근 시세" 표에 $3→$1,500식 불가능한 점프가 라이브 노출됨. 7/14 이전 체크포인트 237개(185장) 폐기, 표는 2점 이상일 때만 표시(generate-card-pages). 현 수집기는 검증된 nmJpy 파생이라 앞으로 오염 불가.

**다음 작업 — 카드 top10 시세 "변동" 그래프 (사용자 요청, 지금은 데이터 대기):**
- **막힌 이유**: 카드 변동데이터는 `card.series.points`에 매일 밤 축적(`tools/update-card-series-history.js`)되나 **깨끗한 건 7/14부터라 카드당 아직 1점**. NM은 nmJpy 파생이라 매일 동일(2~3개월 갱신때만 변동), **PSA10(eBay sold)만 주간 변동** → 의미있는 선은 **3~4주 뒤**.
- **배선 버그(그때 같이 고칠 것)**: SPA 카드차트 `historyChart`(packs.js ~1459)는 `card.japaneseNmEbay.history`를 읽는데 **그 필드는 0건** → 항상 빈상태. 축적되는 실데이터는 `card.series`이므로 **historyChart를 card.series로 연결**해야 개별카드 변동선이 뜸. 그 후 **top10 통합 변동 뷰**(psa10-ranking 확장 or 신규) 추가.
- **지금 당장 가능한 대안**: "현재 top10 시세" 스냅샷은 정확함(psa10-ranking.html이 PSA10 실거래로 랭킹 중) → 막대/카드 시각화 보강은 오늘도 가능.
- **한국어 확장 백로그**: `/ko/op-16` 등 세트별 한국어 페이지("op-16 시세" 롱테일 — 생성기 구조 이미 있음).

> ⚠️ 불변: 수정 후 반드시 `node tools/guard-invariants.js` OK 확인 후 push(FAIL이면 push 금지). 로컬 push 거부되면 아래 START의 야간충돌 대응 참고(reset --hard origin/main → 소스변경만 재적용 → 정리스크립트 재실행 → 재생성 → push). 정확도 최우선(틀린값보단 빈칸).

## START — 현재 상태·다음 작업 (2026-07-17 밤 기준)

### 현재 상태 스냅샷
- **배포**: GitHub Pages, repo `gsa-svg/k-tcg-quant` branch `main`, 커스텀 도메인 opboxindex.com. push하면 1~2분 내 라이브.
- **캐시 버전**: `20260718e`. ⚠️ packs.js/styles.css/데이터를 바꾸면 **packs.js의 `DATA_VERSION` 상수(~177행)와 전체 `?v=` 문자열을 반드시 동시에** 새 값으로 범프. 방법: 파이썬 os.walk 단일패스 치환(레포에서 bash while+sed 루프는 2분 타임아웃 남 — 쓰지 말 것). 범프 후 `node tools/generate-card-pages.js && node tools/generate-set-pages.js` 재실행(구운 페이지에도 ?v 들어감).
- **야간 자동화**: `.github/workflows/update-active-listings.yml`(매일) — eBay 가격 갱신 → 카드 페이지 → 세트 페이지 순 재생성 → 커밋. 로컬 push가 거부되면: `git pull --rebase`; 꼬이면 `rebase --abort` → `reset --hard origin/main` → 자기 커밋에서 자기 파일만 checkout → 재생성 → push.
- **트래픽**: GA 활성 54(-28%), 신규 50(-31%), 조회수 477(+7%). 원인 진단 완료(아래 0G): **구글에 미색인**(브랜드 검색조차 0노출). 콘텐츠·리텐션은 정상. SEO 효과는 색인 후 2~6주 걸림 — 그 전 숫자 하락은 정상이라고 사용자에게 이미 설명함.
- **AdSense**: "가치가 별로 없는 콘텐츠" 거절 → 콘텐츠 보강 완료. **재심사 요청 버튼은 2026-07-30 이후에** (사용자가 누름).
- **페이지 구성**: 홈/packs(SPA) · compare · psa10-ranking · sets/*.html 23개(+op-17, eb-05 프리릴리즈) · cards/*.html 24개+허브 · articles 16편 · 주간리포트 파이프라인 · RSS(feed.xml) · og/*.png.

### 다음 작업 백로그 (우선순위순, 근거 포함 — 위에서부터 하면 됨)
1. **OP-16 "30일 후" 아티클** — 6/12 발매 30일 경과. 우리 실측 시리즈(4/27~) + admiral 망가 3장 카드페이지(cards/op16-063/065/073) 재료 완비. "op-16 box worth it/restock" 검색 수요 있음.
2. **세트별 "Top 10 chase cards" 라운드업 아티클 템플릿** — "op16 chase cards" 같은 세트단위 쿼리에 우리는 개별 카드페이지만 있고 라운드업이 없음. 생성기 하나 만들어 최근 세트(OP-16→OP-15→OP-13)부터. 기존 카드페이지로 내부링크.
3. **evergreen "Why One Piece box prices are falling — live tracker" 고정 URL** — 하락장 공포 쿼리를 TCGPlayer 월간포스트가 먹는 중. 주간리포트 파이프라인(tools/generate-weekly-report.js)에서 고정 URL 하나를 매주 갱신하는 방식으로. 세트별 고점대비 낙폭 표.
4. **카드 이미지 셀프호스팅 + 이미지 사이트맵** — 현재 cards/*.html 이미지가 전부 TCGplayer CDN 핫링크(끊기면 25페이지 전멸 + 이미지검색 트래픽이 tcgplayer로 감). /img/cards/{slug}.webp로 받아서 생성기 경로 교체 + sitemap에 image:image.
5. **차트 내보내기 버튼 + /embed/** — packs.js 캔버스 차트에 "이미지 저장"(canvas.toBlob, opboxindex.com 워터마크) 버튼. 커뮤니티가 스크린샷으로 소통하므로 유저가 배포자가 됨.
6. **주간 CSV 자료실(/free-data.html)** — 세트별 JP/EN 박스가·30일 변동·PSA10 톱카드 집계 CSV 주간 공개(출처링크 요구). 백링크 자석. ⚠️ eBay 원시 리스팅 덤프 금지, 파생 집계만.
7. **카드 페이지 타이틀 쿼리 매칭** — tools/generate-card-pages.js title을 "[이름] ([번호]) PSA 10 Price & Population — {월 자동}"로 (figoca가 이 패턴으로 소형사이트인데 1위 먹음).
8. **ST-31~36 스타터덱 짧은 아티클** — 7/31 발매, 그 주 검색 스파이크. 단명이라 낮은 공수로.
9. **캐터리스트 캘린더 페이지** — 확정 일정(ST 7/31 → OP-17 8/22·28 → EB-05 10월)과 영향받는 박스 링크. 주간리포트와 같이 갱신.
10. **/ja/ 섹션** (공수 큼) — 일본 셀러의 "해외(eBay) 상장가" 수요는 무경쟁. 상위 5세트+아티클 1편, 정적 페이지+hreflang(클라이언트 토글 방식 금지).

### 매주 루틴 (월요일)
1. `node tools/generate-weekly-report.js && node tools/generate-feed.js` → articles/index.html 허브 카드 최신호 교체 → 커밋/푸시 → `node tools/indexnow-submit.js`
2. **판매자 국가 재검증**: `node tools/verify-best-sellers.js`로 대상 추출 → 브라우저에서 `ebay.com/fdbk/feedback_profile/{id}` 열어 "Member since ... in <국가>" 확인(Node fetch로는 안 됨, JS 셸만 옴) → 중국/홍콩이면 tools/ebay-listing-filters.js의 excludedSellerUsernames에 추가(현재 21계정).
3. **PSA 주간 막대 append**: 7/22부터는 psaFull 스냅샷 대비 자체 계산으로 psaWeekly에 추가. (7/15 막대는 사용자의 TCGQ 호버값 대기 중.)
4. 소셜 자산은 이미 자동생성됨(social/weekly/) — 포스팅은 사용자가 함.

### 사용자 대기/예정 (내가 못 하는 것 — 재촉만)
- **GSC**: sitemap 재제출 + 주요 10페이지 색인요청 (제일 급함, 요청해둠)
- ~~Bing Webmaster Tools~~ ✅ 2026-07-18 등록 완료(GSC 가져오기, gsa 구글계정 SSO). 사이트맵 Success·74 URL 크롤됨, 데이터 리포트는 48시간 내 반영. IndexNow는 기존 tools/indexnow-submit.js가 커버. + **Naver Search Advisor** 확인은 남음
- **차주 Reddit/Threads 첫 포스팅** — 글감: `social/community-drafts-2026-07-17.md` (이 세션에서 저장). 사용자가 요청하면 지원.
- 8/31 예약작업(opbox-aug31): 공급/판매/PSA 누적 → Market Data 콤보 롤아웃 + eBay 시리즈 전환(boxSeriesEbay 승격).

### 금지·주의 (실수 잦은 순)
- **🛡️ 모든 수정 후 `node tools/guard-invariants.js` 필수 — FAIL이면 푸시 금지.** 과거 사고 5유형(canonical 스왑·버전 엇갈림·시리즈 덮어쓰기·소스명 노출·검증파일 삭제)을 기계 검사. 야간 워크플로도 커밋 직전 같은 가드로 불량 배포 차단, 실패 시 GitHub이 gsa@whatsong.kr로 실패 메일 발송. 시리즈 소스 기준선은 tools/series-source-manifest.json — 정당한 전환(8/31 eBay 승격 등) 때만 의도적으로 갱신.
- **정확도 최우선**: 틀린 숫자보다 빈칸. 카드 가격은 **변형(variant) 매칭 엄수**(망가/패러렐/SP 다 다른 카드). 봉입률 등 근거 없는 수치 게시 금지.
- **외부 소스명 공개 금지**(영구 규칙): Collectr 등 업체명을 사이트/공개 JSON/클라이언트 코드에 쓰면 안 됨. 라벨은 "Weekly ungraded market (JP/EN-NA)", 필드 `marketProductId`. tools/update-box-series-history.js의 wm-시리즈 보호 로직(boxSeriesEbay 우회 축적) 건드리지 말 것.
- **스크래핑 금지**: TCGplayer/PriceCharting/CardLadder 가격 수집 금지(공식 상품 이미지는 OK). `tools/update-ebay-psa10-prices.js` 절대 실행 금지. variantOK/hasVariantSignal 완화 금지.
- **삭제 금지 파일**: googlee0d71bc0695b5651.html, naver933a...html, IndexNow 키 .txt(3d439f302e46fc08f76ddba4eee3726f.txt), impact-site-verification 메타, .env(로컬 eBay 키).
- **콘솔 cp949**: 한글/이모지 print 깨짐 → 결과는 UTF-8 파일로 쓰고 Read로 확인.
- 사용자와는 **짧은 반말 한국어**. 개발자 아님 — 개발 판단은 알아서 하되 결과·이유를 쉽게 보고. 시키지 않은 개선도 능동적으로(단, 위 금지사항 안에서).

## 0I. 2026-07-18: OPBX 마켓 인덱스 + 개봉 미터 + 성적표 (market.html) — 캐시 `20260718a`
- **정확도 감사 먼저**: 21세트 중 발매 시점부터 추적한 건 OP-14/15/16/PRB-02뿐(나머지 1월 시작). 그래서 "발매 대비"는 대부분 거짓 → 지수·성적표는 전부 "1월 7일 이후"로만 표기. 성적표 각 행에 실제 base 날짜("from Apr 27" 등) 명시, launch 태그는 진짜 발매추적 세트(OP-16)만.
- **OPBX 지수**: `tools/build-market-index.js` → data.marketIndex(메인 JSON 통합, 단일 소스·단일 버전). 등가중, 2026-01-07 가격 있는 18세트=100 기준, 현재 157.4(+57.4%, 주 -0.8%). 후발 OP-02/15/16은 지수 제외·개별표시. `tools/generate-market-page.js` → market.html(숫자 구움, Dataset+FAQ 스키마, Key Facts). packs.js `renderMarketIndex`(홈 hero 카드).
- **개봉 미터**: 전세트 psaWeekly 합산 최근주(17,526, WoW+30.4%), 누적 608,756.
- **가드 D2**: 지수 범위(50~1000)·구성종목·시계열·성적표·미터·market.html 구운값 일치 검사. 이상 시 배포 차단.
- **파이프라인**: 야간 워크플로에 build-market-index→generate-market-page 추가(매일 자동 갱신). market.html 커밋 대상 추가, 사이트맵 등록.
- **재판(再販)+정가 완료**: 조사 워크플로 wf_3c7f8892-4b7로 21세트 공식 정가+재판 전수 검증. **핵심 발견: 반다이는 세트별 재판을 공식 발표 안 함** → "공식 재판 N회"는 오해유발(재판 있었는데 0회로 보임). 정직한 표기: `data/set-facts.json`(정가 ¥4752/5280/5500·유통사 재판 기록 소스링크, 나이틀리 불변 소스파일). ①마켓 성적표에 "vs MSRP" 컬럼(OP-01 10.7배)=정직한 발매대비 + "Reprints" 카운트. ②세트페이지 "Reprints & original price" 섹션(정가·배수·재판기록 또는 "없음=미발견이지 재판無 아님"). 재판기록 있는 세트: OP-06/09/11/13/EB-01/PRB-01. 가드 D2가 vsMsrp 커버리지·재판데이터 검사.

## 0H. 2026-07-17 심야: 홈 노출 0 사고 — canonical 스왑 진단·수정 — 캐시 `20260717d`
- **증상**: GSC 실적에서 홈(/)이 7/1~7/7 노출79·클릭9·순위6.3 → **7/8부터 노출 0**. GA 활성유저 -28%의 직접 원인.
- **진단**(GSC 직접 확인): 수동조치 없음. 사이트 전체 노출은 유지되는데 packs.html?hl=en이 노출 94회로 최다 — **구글이 중복 클러스터(/, packs.html, ?hl=, ?set=)의 canonical을 /에서 packs.html 변형으로 스왑**. 원인: 사이트맵에 packs.html?set= 42개 등재(7/7 제출) + 전 페이지 브랜드로고가 packs.html?hl=en으로 링크 → 내부 신호가 packs.html에 몰림.
- **수정**: ①사이트맵 42개 제거(0G) ②**전 사이트 내부링크 홈 통일**(brand/nav/브레드크럼 스키마/절대URL, 79개 파일+생성기 2개: packs.html?hl=en→/ , ?hl=ko→/?hl=ko; **?set= 딥링크는 기능이라 유지**) ③audit-seo에 재발방지 검사(사이트맵에 /index.html·/packs.html 등재 시 에러) ④GSC 홈 재크롤 요청.
- **회복 관찰법**: GSC 실적→페이지에서 / 노출이 돌아오는지 (수일~2주). packs.html?hl=en 노출이 /로 넘어오면 성공.
- GSC 소유권: gsa@whatsong.kr로 인증됨(google1d76c313bd3d0b59.html — 삭제금지). 색인요청 실행: /, sets/op-17, cards/, articles/japan-vs-english, sets/eb-05. 색인요청 쿼터 하루 ~10개.
- Bing Webmaster: ✅ 2026-07-18 등록 완료(GSC 가져오기). llms.txt 추가, robots에서 ClaudeBot/Claude-SearchBot 허용(AI 인용 목적).

## 0G. 2026-07-17 밤: 트래픽 회복 패스 — 캐시 `20260717c`
- **진단(워크플로 6에이전트)**: GA 활성유저 -28%의 원인은 콘텐츠가 아니라 **구글 SERP 부재** — 16개 쿼리+브랜드검색 'opboxindex'까지 0노출. 조회수는 +7%(리텐션 정상). 인덱싱/권위가 병목.
- **인덱싱 버그 수정**: 사이트맵의 packs.html?set=* 42개 URL이 전부 canonical=홈 선언 상태였음 → 제거(113→71). sets/*.html이 인덱싱 대상.
- **프리릴리즈 페이지**: sets/op-17.html(JP 8/22·EN 8/28 공식검증 + OP-14/15/16 발매전후 실측: OP-16 예약$220→발매$139→저점$123→현재$150, "발매 2~6주 후가 저점" 데이터 결론) · sets/eb-05.html(10월 공식, EB-03 +50% 전례). SERP가 소형 샵블로그뿐인 급상승 쿼리 선점.
- **구매의도 섹션**: 세트 생성기에 "Is an X booster box worth buying? (월 자동갱신)" verdict — 낙폭/모멘텀/체이스배수/젬레이트 실데이터 분기. "is op-13 good investment" 정확일치 SERP 결과 1개뿐.
- **JP vs EN 아티클**: 정확일치 타이틀 + 실측 갭 표 10세트(+25% OP-16 ~ +641% EB-01, 신세트일수록 갭 축소 = OP-17 동시발매 논지).
- **리텐션(packs.js)**: `opbx_watch`(관심 박스 핀, detail 패널 토글, 그리드 최상단+📌) + `opbx_lastseen`(방문 스냅샷) → 재방문 시 "Since your last visit" 변동 배너(관심세트 우선, 시장평균). GA 이벤트 watch_toggle/since_last_visit.
- **사용자 액션 필요(계정)**: GSC 색인 확인+주요 URL 색인요청, Bing Webmaster 등록(GSC 가져오기), Naver Search Advisor 확인, 커뮤니티 첫 포스팅(차주 예정 — 신규유입 최대 레버).
- 백로그: 카드 이미지 셀프호스팅+이미지 사이트맵, 차트 이미지 내보내기 버튼/임베드, 주간 CSV 자료실(백링크 자석), 주간 숏폼 클립, /ja/ 섹션.

## 0F. 2026-07-17 저녁: 인기 카드 개별 페이지 (롱테일 SEO)
- **cards/*.html 24장 + cards/index.html 허브** — NM가 상위 24 유니크 카드(번호+변형명 dedupe, 홈세트 우선). 생성기 `tools/generate-card-pages.js`: NM(¥/$)·PSA10(sold/ask 라벨)·PSA 인구표(10/9/8이하 점유율)·그레이딩 경제성(프리미엄 배수별 분기 산문)·가격 체크포인트 표·변형검증 가이드·FAQ/Article/Breadcrumb 스키마. 전부 실데이터 파생, 추정치 0.
- **크로스링크**: 세트페이지 체이스 표 카드명 → 카드페이지 링크(cards/card-map.json 경유), sets/index·psa10-ranking 관련링크에 허브 추가. 사이트맵 25 URL 추가(총 113), IndexNow 전송됨.
- **야간 워크플로 통합**: update-active-listings.yml이 card-pages → set-pages 순으로 재생성+커밋 → PSA10 가격 매일 갱신됨. NM은 수동 주입 시에만 변동(슬러그 안정).

## 0E. 2026-07-17 오후: 자율 최적화 패스 — 캐시 `20260717a`
- **🚨 야간 워크플로가 Collectr 시리즈 오염** → 수리 완료. update-box-series-history.js가 boxSeries/boxSeriesEn의 source를 eBay로 덮고 active 포인트를 덧붙임(그래프 스파이크+라벨 오류). **툴 패치**: source에 Collectr 포함 시 eBay 스냅샷을 `boxSeriesEbay`/`boxSeriesEnEbay`에 병행 축적(8월 전환 때 승격), Collectr 시리즈는 불가침. 오염분은 serdump.txt로 원복(37시리즈), eBay 포인트 74개는 병행필드로 이관.
- **주간 리포트 루틴(월요일)**: `node tools/generate-weekly-report.js && node tools/generate-feed.js && node tools/indexnow-submit.js` → 허브 카드(articles/index.html) 최신호로 교체 → 커밋.
- **RSS 피드**: feed.xml + tools/generate-feed.js(아티클 추가 시 재실행). 홈/트래커/아티클 허브에 link rel=alternate.
- **아티클별 OG 이미지**: og/*.png 6종(tools/make_og_images.py) — 5개 신규 아티클+compare에 연결.
- **UI 폴리시**: 딜칩 9px→10.5px, bxEdLabel·pdRar 10.5→11px, pwHead 모바일 줄바꿈 허용. 375px 감사: 오버플로0·bleed0·탭타겟OK.
- 중국셀러 대응은 0D 참조 — verify-best-sellers.js 주간 실행(브라우저 필요).

## 0D. 2026-07-17: 중국·홍콩 위장창고 다계정망 전수 소탕 — 캐시 `20260716e`
- **발견**: US창고 발송으로 위치필터를 우회하는 중국/홍콩 셀러망이 박스 최저가를 잠식. 차단하면 같은 물건이 다른 계정으로 재등장(OP-05 $151.89 5계정, OP-14 $79.9 홍콩 8계정 등). eBay Browse API의 itemLocation은 창고(US)라 못 잡음.
- **검증법 확립**: eBay 피드백 프로필(`ebay.com/fdbk/feedback_profile/{id}`)의 "Member since ... in <국가>" — **반드시 브라우저에서**(Node fetch엔 JS껍데기만 옴). 세션 브라우저 탭에서 `window.__vf([...])` 패턴으로 일괄 확인.
- **결과**: bestListing 셀러 42개 전원 검증, 중국/홍콩 **19계정 차단**(greatestplc·wzxc2024·chuangxinhe·ajwu2024·dcfonew·dndy2024·obtr2024·onpiececard·newcardscoming·ygmvtion·wonder5136·goldencardstore·pokem_57·sunnystore24·paparazzir·fuyistore + OP-14망 vasettler·vcbbox·vbzeckon·vedesh·gromance·vdcontion·bloonymary·dihssease). 차단 후 실최저가 정상화(OP-07 $79→$110, OP-05 $152→$238, OP-14 $80→$125 — 그 대역 전체가 위장망이었음).
- **주간 루틴**: `tools/verify-best-sellers.js`가 대상 목록 추출(단 fdbk fetch는 Node에서 차단 → 세션 브라우저로 확인 필요). 주 1회 실행 권장. 신규 차단은 `tools/ebay-listing-filters.js` excludedSellerUsernames에 사유와 함께 추가 후 수집기 재실행.
- OP-13 JP는 현재 미개봉 매물 0건(정직하게 버튼 미표시), OP-11 JP kept=2로 얇음.
- 기타 결정: 팩 시뮬레이터 아이디어 폐기(봉입률 공식 근거 없음 — 정확도 원칙), 코멘트/별점은 트래픽 주500+ 이후 재검토.

## 0C. 2026-07-16: 애드센스 "가치가 별로 없는 콘텐츠" 거절 대응 — 캐시 `20260716b`
- **거절 원인 진단**: compare.html 정적 텍스트 92단어(봇에겐 빈 페이지), 세트페이지 22개 템플릿 중복, 아티클 얇음(~560단어), 도메인 3주 신생.
- **조치**: ①compare.html 정적 산문+7월 스냅샷 표(~650단어) ②세트페이지에 세트별 고유 데이터 섹션 2개 추가(6개월 시세 궤적·주간 등급 모멘텀, 생성기 tools/generate-set-pages.js — ~940단어/페이지) ③데이터 리포트 아티클 2편(각 1,300단어: japanese-vs-english-box-price-data-2026.html, psa-grading-vs-sealed-supply-2026.html — 수치 전부 우리 실데이터, scratchpad article_stats.json에서 추출) ④about.html E-E-A-T(출처·정확도정책·운영자·갱신주기·정정 연락처 gsa@whatsong.kr) ⑤홈 7월 데이터 다이제스트+OP-16 가이드 링크 누락 수정. SEO 감사 통과.
- **⚠️ 재심사 타이밍**: 콘텐츠 색인 잡히게 **최소 2주 숙성 후** "검토 요청" 클릭 권장(2026-07-30 이후). 연속 거절 방지. IndexNow 일괄 통지 완료 시점 기록 참조.
- 아티클 수치 갱신 시: 이 리포트들의 표는 정적이므로 큰 데이터 개편 때 수동 갱신 필요(as-of 날짜 명시돼 있음).

## 0B. 2026-07-15 저녁: 전 세트 롤아웃 (OP-13식 업데이트 전면 적용) — 캐시 `20260715q`
- **Top10 전 세트(21) TCG Quant와 동일**(카드·순서·공식 TCGplayer 1000px 이미지). 기존 카드는 TCGplayer id(또는 정규화 이름) 매칭으로 우리 가격 보존. **신규 17장은 가격 비움**(틀린 값 노출 금지) — 유유테이 NM 수집 대기 목록: scratchpad `merge_applied.txt` 하단.
- **Collectr 박스시세 주입: JP 21세트 + EN 17세트**(주간 ~6개월, KRW). **16세트 인터랙티브 JP vs EN 그래프 활성.** EN 없는 세트(OP-01 변형모호/OP-07 프리릴만/EB-02/EB-03 박스없음, OP-16은 JP없어 eBay JP 유지) → 단일 그래프 정직 유지.
- **PSA 패널 전 세트**: psaFull(세트전체 총·gem10·gemRate·OP평균) + 인구 top10 체이스표(합계=gem10 검증됨). **밸류패널(renderSetAnalytics) 전 세트 제거**(함수는 잔존, 미호출). psaWeekly 막대는 OP-13만(시드 데이터 있는 유일 세트) — 다른 세트는 주간 스냅 쌓이면 추가.
- 수집 방법 기록: TCG Quant SPA는 canvas차트라 top10/PSA는 DOM 추출(tcgq_all.json), Collectr api-v2는 **getcollectr 오리진에서만 fetch 가능**(CORS) → app.getcollectr.com/robots.txt 탭에서 수집(무거운 SPA 페이지는 렌더러 얼음 — 정적 페이지 사용이 핵심). 데이터: scratchpad serdump.txt / tcgq_all.json / merge_all_sets.js(재실행 가능).
- ⚠️ eBay 워크플로(시크릿 재등록 후)가 boxSeries(JP)를 eBay로 덮으면 소스 불일치로 비교그래프 자동 숨김(가드 정상동작). 8월 EN eBay 준비되면 양쪽 eBay로 전환.

## 0. 2026-07-15 세션 (그래프4 + PSA 패널 + 8/31 예약) — 캐시 `20260715b`
- **인터랙티브 JP vs EN 박스 그래프(그래프4)**: `renderBoxInteractive`(위=일본/아래=영문 실제 원화 2단 small-multiples, 압축 없음) + `initBoxCharts`(hover/탭 → 날짜+양쪽 가격 툴팁 + 세로 크로스헤어, 바닐라). `hasInteractiveBox(set)`(=JP·EN 시세 둘 다 준비 **+ 두 판 소스 일치**)인 세트만 적용 → **현재 OP-13만**. 나머지 세트는 기존 UI 유지.
- **박스 시세 소스 = eBay로 전환 결정(2026-07-15 사용자)**: OP-13은 지금 임시로 **Collectr**(6개월 히스토리, POC). eBay JP는 이미 3.5개월치 있으나 **eBay EN이 아직 얇음(7포인트)** → 8월에 eBay EN 준비되면 자동 eBay 전환. `hasInteractiveBox`에 **소스일치 가드(`seriesFam`)** 추가 = eBay JP vs Collectr EN 같은 혼합 비교 방지(자동수집이 JP만 eBay로 덮어써도 비교 그래프는 두 판 소스 같아질 때까지 숨김). 그래프 하단 출처문구는 `boxSeries.source` 기반 자동 전환(Collectr↔eBay). ⚠️ eBay EN 축적엔 eBay 시크릿 재등록 필수.
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
