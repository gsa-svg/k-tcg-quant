// 사이트 불변식 가드 — 과거 실제 사고 유형을 전부 기계 검사로 차단.
// 하나라도 어기면 exit 1 → 야간 워크플로 실패(커밋 안 됨) + GitHub 실패 메일.
// Run: node tools/guard-invariants.js   (로컬 배포 전에도 실행)
//
// 사고 이력과 대응 검사:
//  [2026-07-08 canonical 스왑: 홈 노출 0]  → C1, C2, C3
//  [2026-07-14 DATA_VERSION 미범프: 하루 종일 구데이터] → V1
//  [2026-07-17 야간봇이 시세 시리즈 덮어씀] → D1
//  [영구 규칙: 외부 소스명 공개 금지] → S1
//  [검증파일 삭제 사고 예방] → F1
//  [2026-09-30 known-gaps 가 관측 있는 주를 영구 공백으로 굳힘] → K1, K2
//  [2026-10-14 홈 utm 소실 + GA load+1.5초 지연: ChatGPT 방문이 (direct)·미집계] → GA1, GA2
//  [2026-10-14 세트 페이지 핵심 사실이 HTML 97% 지점·카드 수 낡은 값·월 단위 날짜] → KF1
//  [2026-10-14 AI 사실 공급(llms·AI JSON)에 발매일·정가·카드 종수가 없고 라벨이 낡음] → RF1
//  [2026-10-14 사이트맵 lastmod 205/222 가 매일 오늘(얕은 checkout·메뉴 커밋) · 피드 이중 이스케이프·noindex·정렬] → SM1, FD1
//  [2026-10-14 cheapest·MSRP 질의 라벨 부재 · 홈 제목 브랜드 없음 · JSON-LD 누락(WebPage.name·Dataset·Article image)] → SE1
//  [2026-10-15 외부 감사 확정 22건: FAQ 묵은 현재가 · 수정일 < 화면 날짜 · Product 숨은 가격 · 업체명 · NM 관측일 · 한국어 문답·재판·통화·레어도 ·
//   AI 경매 없는/미발매 세트 · AI 기준일 · llms PSA 인구 날짜 · 카드 Product 에 sold 중앙값 · 예정 세트 펼친 해설 · Dataset 수정일]
//   → SF1, U2, PL1, S4, NM1, KO1, KO2, KO3, KO4, AB1, AS1, LP1, PO1, CL2, UP2, DS1 (+ R2 일 단위 추첨 비교)
//  [2026-10-15 2차: 1차 수정이 한 생성기에만 들어가 레어도(한국어 SP · 영문 Super Rare)와 NM(피드 null · 페이지 $1,250)이 페이지마다 갈림 ·
//   예정 세트 수정일 < 화면 예약판매 날짜] → RY1, NM2 (+ UP1 수정일 = 사실 확인일·화면 시세 날짜 중 늦은 날)
//  [2026-10-15 3차: 카드 H1 레어도 ≠ 같은 페이지 Rarity label · 못 쓰는 NM 을 빼고 낸 세트 지표 · "가장 비싼 카드"가 페이지마다 다른 규칙 ·
//   free-data AI 확장 Dataset 날짜 ≠ 파일 · 피드 발행 시각 > 빌드 시각] → CM1, PC1 (+ RY1 H1 · DS1 free-data 전부 · FD1 발행 ≤ 빌드)
//  [2026-10-15 5차: KO PSA 10 원화가 옛 KRW 저장값(영문과 12~15% 차) · 일본판 박스 문답에 영문판 값 · NM 없는 카드의 spread 문장 · "a 80%" ·
//   같은 값끼리 비교 · 빈 링크 글자 · 최저가 동가 누락 · ko 허브 기준일 < 표 날짜 · how-many-packs FAQPage ≠ 화면 · weekly 4-wk 별도 계산]
//   → PK1, FQ1, SP1, AN1, EQ1, EL1, CH1, KD1, FQ2, WK1 (+ PC1 숨김 카드 최고 raw 값·NM 관측일)
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const errors = [];
// 경고 — 배포를 막지 않고 결과 JSON 에만 남긴다(2026-10-13, A5 의 at 누락). 형식은 "코드(경고) …" —
// 워크플로가 실패 로그에서 오류를 뽑는 패턴("A5: …")에 걸리지 않게 콜론을 코드 바로 뒤에 두지 않는다.
const warnings = [];
const read =(p) => fs.readFileSync(path.join(ROOT, p), "utf8");
const exists = (p) => fs.existsSync(path.join(ROOT, p));

function walkHtml(dirs) {
  const out = [];
  for (const d of dirs) {
    const abs = path.join(ROOT, d);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) if (f.endsWith(".html")) out.push(d ? `${d}/${f}` : f);
  }
  return out;
}
const PUBLIC_HTML = walkHtml(["", "sets", "cards", "articles", "ko", "ja"]);   // ja/ = 일본어 발매일 표(2026-10-14 W8)

// ── V1. 캐시 버전 일관성: packs.js DATA_VERSION == 모든 ?v= 문자열
const packsJs = read("packs.js");
const ver = (packsJs.match(/DATA_VERSION = "([^"]+)"/) || [])[1];
if (!ver) errors.push("V1: packs.js에서 DATA_VERSION을 찾지 못함");
else {
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    for (const m of html.matchAll(/\?v=([0-9a-z]+)/g)) {
      if (m[1] !== ver) { errors.push(`V1: ${f} 의 ?v=${m[1]} ≠ DATA_VERSION ${ver} (동시 범프 안 됨)`); break; }
    }
    // V1b: styles.css·packs.js 참조에 ?v= 가 아예 없으면 캐시버스팅 사각지대 — 배포 직후 최대 10분 stale.
    // (2026-07-21 감사: 48개 페이지가 무버전 참조였고 V1 이 무버전을 통과시키는 구조적 구멍이었다)
    for (const m of html.matchAll(/(?:href|src)="[^"]*(styles\.css|packs\.js)"/g)) {
      errors.push(`V1: ${f} 의 ${m[1]} 참조에 ?v= 누락 — 캐시버스팅 사각지대`);
    }
  }
}

// ── C1. 내부링크에 홈 변형(packs.html?hl=) 금지 — canonical 스왑 사고 원인
for (const f of [...PUBLIC_HTML, "packs.js"]) {
  if (read(f).includes("packs.html?hl=")) errors.push(`C1: ${f} 에 packs.html?hl= 홈 변형 링크 잔존 (홈은 / 로만 링크)`);
}

// ── C2. canonical 자기 일치: 각 페이지 canonical == 자기 URL (홈 별칭 2개만 / 허용)
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const m = html.match(/rel="canonical" href="([^"]+)"/);
  if (!m) continue;
  // 리다이렉트 스텁 예외 — GitHub Pages 라 서버 301 이 없어서, 틀린 URL 로 만들어졌던 페이지는
  // noindex + meta refresh + canonical→대상 조합으로 넘긴다(표준 관행). 조건을 전부 갖췄고
  // refresh 목적지와 canonical 이 **같은 페이지**일 때만 인정한다 — 아무 canonical 이나 봐주는 게 아니다.
  // 실사례: cards/eb02-061-monkey-d-luffy.html (잘못된 카드번호로 생성 → OP05-060 페이지로 정정, 2026-08-26).
  const refresh = html.match(/http-equiv="refresh" content="\d+;\s*url=([^"]+)"/i);
  const noindex = /name="robots" content="[^"]*noindex/i.test(html);
  if (refresh && noindex) {
    const target = new URL(refresh[1], "https://opboxindex.com/").href;
    if (m[1] === target) continue;
    errors.push(`C2: ${f} 리다이렉트 스텁의 canonical(${m[1]})과 refresh 목적지(${target})가 다르다`);
    continue;
  }
  const expected = f === "index.html" || f === "packs.html" ? "https://opboxindex.com/" : `https://opboxindex.com/${f}`;
  const alt = f.endsWith("/index.html") ? `https://opboxindex.com/${f.replace(/index\.html$/, "")}` : null;
  if (m[1] !== expected && m[1] !== alt) errors.push(`C2: ${f} canonical=${m[1]} (기대: ${expected}${alt ? ` 또는 ${alt}` : ""})`);
}

// ── C3. 사이트맵: 홈 변형 등재 금지 + 모든 URL 실파일 존재
const sitemap = read("sitemap.xml");
if (/<loc>https:\/\/opboxindex\.com\/(index\.html|packs\.html)/.test(sitemap)) errors.push("C3: sitemap에 홈 변형(/index.html·/packs.html) 등재됨");
for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const pathname = new URL(m[1].replace(/&amp;/g, "&")).pathname;
  const rel = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1)) + (pathname.endsWith("/") ? "index.html" : "");
  if (!exists(rel)) errors.push(`C3: sitemap URL의 실파일 없음: ${m[1]}`);
}

// ── N1. 메인 네비 일관성: 모든 nav 보유 페이지는 6개 링크를 전부 가져야 함.
//    (반복 사고: Compare 등 눌렀을 때 Market Index가 사라지는 페이지 존재 → 링크 누락 차단)
//    상대경로가 폴더마다 달라서 data-ko 라벨로 판정한다.
//    2026-07-29: "마켓 지수" 제거(지수 위젯·market.html 철회) → 6개에서 5개로.
// 2026-08-26: "카드"·"경매" 추가 — cards/index.html 과 auction.html 이 어떤 헤더 네비에도 없어
// 카드 인덱스는 홈에서 클릭으로 도달할 방법이 아예 없었다(UI/UX 감사 확정). 전 네비에 넣고 여기서 잠근다.
// 메뉴 라벨은 tools/site-nav.js 한 곳에서 정의한다 — 여기에 손으로 베껴 두면 어긋난다.
const NAV_REQUIRED = require("./site-nav").KO_LABELS;
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const navM = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navM) continue; // 네비 없는 페이지는 검사 대상 아님
  const nav = navM[1];
  // 영어 페이지는 data-ko 속성으로(클라이언트가 hl=ko 때 치환), 한국어 정적 페이지는
  // 한국어를 본문 텍스트로 직접 렌더한다(2026-08-26 — data-ko 는 치환 스크립트가 없는
  // ko/ 정적 페이지에서 죽은 속성이라 메뉴가 영어로 보였다). 어느 쪽이든 라벨이 있으면 된다.
  const navText = nav.replace(/<[^>]+>/g, " ");
  for (const label of NAV_REQUIRED) {
    if (!nav.includes(`data-ko="${label}"`) && !navText.includes(label)) errors.push(`N1: ${f} 메인 네비에 "${label}" 링크 누락 (전부 필요)`);
  }
}

// ── D1. 시세 시리즈 보호: 기준 매니페스트(2026-07-17 검증 상태)와 대조.
// wm였던 시리즈가 eBay로 바뀌거나 사라지면 = 야간봇 덮어쓰기 재발 → 실패.
// 정당하게 새 세트를 추가/전환할 땐 매니페스트를 의도적으로 갱신할 것(tools/series-source-manifest.json).
const data = JSON.parse(read("data/onepiece-packs.json"));
if (!exists("data/psa-population-snapshots.json")) errors.push("D2: PSA cumulative snapshot archive missing");
else {
  const psaArchive = JSON.parse(read("data/psa-population-snapshots.json"));
  const latestPsaSnapshot = Array.isArray(psaArchive.snapshots) ? psaArchive.snapshots.at(-1) : null;
  if (!latestPsaSnapshot) errors.push("D2: PSA cumulative snapshot archive is empty");
  else {
    for (const code of [...(data.jp?.list || []), ...(data.extra?.list || [])]) {
      const source = data.sets?.[code]?.psaFull;
      if (latestPsaSnapshot.date === source?.updated && latestPsaSnapshot.sets?.[code] !== source?.total) {
        errors.push(`D2: ${code} current PSA total differs from stored ${latestPsaSnapshot.date} snapshot`);
      }
    }
  }
}
const manifest = JSON.parse(read("tools/series-source-manifest.json"));
for (const [k, kind] of Object.entries(manifest)) {
  const [code, key] = k.split("|");
  const src = data.sets?.[code]?.[key]?.source;
  if (!src) { errors.push(`D1: ${code}.${key} 시리즈가 사라짐 (매니페스트엔 ${kind}로 존재)`); continue; }
  if (kind === "wm" && !/Weekly ungraded/i.test(src)) errors.push(`D1: ${code}.${key}.source="${src}" — wm 시리즈가 덮어써짐(eBay 스냅샷은 ${key}Ebay로 가야 함)`);
}

// D4. 2026-07-22 결정: 여러 소스(주간 시장시리즈 + eBay 매물 중간값)를 이어 붙이던 박스 "트렌드/이력" 차트는
//     소스 전환 지점에 가짜 급등이 생겨 신뢰할 수 없다 → 의도적으로 숨긴다. 신뢰 그래프는 우리가 직접 모은
//     eBay 실거래(sold, box-sold-series.json)만으로 데이터가 충분히 쌓인 뒤 렌더한다.
//     2026-08-13: 시계열이 21세트 × 10점까지 쌓여 실제 그래프로 교체했다. 플레이스홀더는 사라졌지만
//     지켜야 할 것은 그대로다 — **차트가 읽는 소스는 우리 sold 시계열 하나뿐**이어야 한다.
//     재발 방지: (1) renderBoxSeries 가 box-sold-series 만 소스로 쓰고 boxSeries/boxSeriesEn(혼합소스 주간시리즈)에 손대지 않는다,
//               (2) active(매물) 중간값을 sold/이력으로 오인시키는 혼합소스 트렌드 안내가 되살아나면 안 된다.
{
  // 차트를 만드는 두 함수만 떼어 본다.
  // 줄끝을 \n 으로 못 박지 말 것 — 이 저장소는 CRLF 로 체크아웃되어 `\n}\n` 이 매치되지 않는다.
  // 그래서 이 검사가 통째로 빈 문자열을 보고 늘 통과했다(2026-08-13 역테스트로 발견).
  const fnBody = (name) => (packsJs.match(new RegExp("function " + name + "[\\s\\S]*?\\r?\\n\\}\\r?\\n")) || [""])[0];
  const chartZone = fnBody("renderBoxSeries") + fnBody("boxChartFor");
  if (!chartZone.includes("soldSeries")) {
    errors.push("D4: 박스 차트 함수(renderBoxSeries/boxChartFor)를 못 찾았다 — 이 가드가 아무것도 검사하지 못하고 있다");
  }
  if (!/box-sold-series\.json/.test(packsJs)) {
    errors.push("D4: 박스 차트가 우리 sold 시계열(box-sold-series.json)을 더 이상 읽지 않는다 — 소스가 바뀌었는지 확인할 것");
  }
  if (/\bboxSeriesEn\b|\.boxSeries\b/.test(chartZone)) {
    errors.push("D4: 박스 차트가 혼합소스 주간시리즈(boxSeries/boxSeriesEn)를 다시 읽는다 — 소스 전환 지점에 가짜 급등이 생긴다");
  }
}
if (/source transition can appear as a larger move/i.test(packsJs)) {
  errors.push("D4: 혼합소스(시장→eBay매물) 트렌드 차트 안내가 되살아남 — active 중간값을 sold 이력으로 오인시킬 수 있음");
}

// D3. Full-set PSA imports must remain complete and internally consistent.
// This prevents the legacy chase-card subset from silently replacing set totals.
if (!exists("data/gemrate-psa-history.json")) errors.push("D3: verified full-set PSA history source missing");
else {
  const verifiedPsa = JSON.parse(read("data/gemrate-psa-history.json"));
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  const weeklyThrough = verifiedPsa.weeklyThrough;
  const retainedDates = verifiedPsa.retainedWeeklyDates || [];
  for (const code of codes) {
    const sourceSet = verifiedPsa.sets?.[code];
    const liveSet = data.sets?.[code];
    const full = liveSet?.psaFull;
    const points = liveSet?.psaWeekly?.points;
    // 갓 나온 세트는 PSA 주간 이력이 **구조적으로** 없다. OP-17 은 2026-08-22 발매고
    // 8/26 시점 GemRate 누적이 1장이다(gem rate 100%) — 4주 이력을 요구하면 신규 세트를
    // 영영 못 올리고, 억지로 채우면 표본 1장짜리 비율을 내보내게 된다.
    // 그래서 psaPending 세트만 건너뛰되, 조건을 좁게 건다:
    //   · psaFull/psaWeekly 가 **아예 없어야** 한다 (부분·불일치 데이터를 숨기는 데 못 쓴다)
    //   · 발매 90일 이내여야 한다 (플래그를 켜둔 채 방치하지 못한다)
    // 이력이 쌓이면 플래그를 지우고 정상 경로로 돌아온다.
    if (liveSet?.psaPending) {
      const rel = Date.parse(liveSet.release || "");
      const ageDays = Number.isFinite(rel) ? Math.floor((Date.now() - rel) / 86400000) : Infinity;
      if (full || points) errors.push(`D3: ${code} psaPending 인데 psaFull/psaWeekly 가 남아 있다 — 둘 중 하나만 맞다`);
      else if (!(ageDays <= 90)) errors.push(`D3: ${code} psaPending 이 발매 ${ageDays}일째까지 켜져 있다 — 이력이 쌓였으면 플래그를 지울 것`);
      continue;
    }
    if (!sourceSet || !full) { errors.push(`D3: ${code} full-set PSA source or live data missing`); continue; }
    if (full.total !== sourceSet.latest?.totalGrades || full.gems !== sourceSet.latest?.totalGems) {
      errors.push(`D3: ${code} full-set PSA totals differ from verified source`);
    }
    if (!Array.isArray(points) || points.length < 4 || points.at(-1)?.d !== weeklyThrough) {
      errors.push(`D3: ${code} weekly PSA graph does not reach ${weeklyThrough}`);
    }
    const sourcePoints = (sourceSet.weekly || []).map((point) => ({ d: point.d, v: point.grades }));
    if (JSON.stringify(points || []) !== JSON.stringify(sourcePoints)) {
      errors.push(`D3: ${code} weekly PSA graph differs from the verified source`);
    }
    const pointDates = new Set((points || []).map((point) => point.d));
    const correctionDates = new Set((verifiedPsa.corrections?.[code] || []).map((entry) => entry.date));
    const firstDate = points?.[0]?.d;
    for (const date of retainedDates) {
      if (firstDate && date >= firstDate && !pointDates.has(date) && !correctionDates.has(date)) {
        errors.push(`D3: ${code} retained PSA week ${date} was deleted`);
      }
    }
    if (points?.some((point) => !Number.isFinite(point.v) || point.v < 0)) {
      errors.push(`D3: ${code} weekly PSA graph contains an invalid value`);
    }
  }
}

// ── D5b. boxMarket.ebaySold 는 median 이 있으면 currency 가 반드시 있어야 한다.
//    2026-07-23 사고: box-sold-ingest 가 currency 를 빼먹어 화면이 "Sold $0.00"으로 표시됨(triMain이 통화 없이 0 렌더).
for (const [code, sset] of Object.entries(data.sets || {})) {
  const bm = sset.boxMarket || {};
  for (const ed of ["jp", "en"]) {
    const s = bm[ed] && bm[ed].ebaySold;
    if (!s || s.median == null) continue;
    if (!s.currency) errors.push(`D5b: ${code}.${ed}.ebaySold median 있는데 currency 없음 — 화면 $0.00 표시 위험`);
    if (!(typeof s.median === "number" && s.median > 0)) errors.push(`D5b: ${code}.${ed}.ebaySold median 이상 (${s.median})`);
  }
}

// ── D13. 박스 진행매물 스냅샷은 그 수집일의 시계열 점이 돼 있어야 한다 — 2026-09-30 발견.
//    9/22·9/23·9/26 에 로컬에서 매물 수집기(update-ebay-*-pack-prices)만 돌리고 update-box-series-history 를
//    빼먹은 채 커밋해, 스냅샷(boxMarket.*.ebayActive)은 git 에 있는데 boxSeriesEbay/EnEbay 에 그날 점이 없었다.
//    클라우드도 그 사이 실패해 박스 시계열이 9/21 다음 9/27 로 건너뛰었다. 그 스냅샷들은 조회 한도 50(로컬 .env)으로
//    받은 것이라 시계열(한도 100)과 같은 측정이 아니어서 끼우지 않았다 — D14 참고. 빈 날은 빈 채로 둔다.
//    점을 만드는 규칙은 update-box-series-history 의 editionPoint 를 그대로 쓴다 — 여기서 따로 베끼면 어긋난다.
//    거꾸로 스냅샷 수집일보다 늦은 active 점도 막는다 — 옛 스크립트는 지난 스냅샷을 실행일 점으로 한 번 더 찍었다(8/3·8/28).
{
  const { editionPoint } = require("./update-box-series-history");
  for (const code of [...(data.jp?.list || []), ...(data.extra?.list || [])]) {
    for (const ed of ["jp", "en"]) {
      const want = editionPoint(data.sets?.[code], ed, data.fx);
      if (!want) continue;
      const points = data.sets[code][want.key]?.points || [];
      if (!points.some((p) => p.d === want.point.d)) {
        errors.push(`D13: ${code}.${want.key} 에 ${ed} 진행매물 스냅샷(${want.point.d}) 점이 없다 — 매물 수집 뒤 node tools/update-box-series-history.js 를 빼먹었다`);
      }
      const later = points.filter((p) => p.basis === "active" && p.d > want.point.d).map((p) => p.d);
      if (later.length) {
        errors.push(`D13: ${code}.${want.key} 에 ${ed} 진행매물 스냅샷(${want.point.d})보다 늦은 active 점 ${later.join(",")} — 지난 스냅샷을 실행일 관측으로 다시 찍었다`);
      }
    }
  }
}

// ── D14. 박스 진행매물 수집기의 조회 한도는 어디서 돌든 같아야 한다 — 2026-09-30 발견.
//    클라우드 워크플로는 EBAY_SEARCH_LIMIT=100 을 줬고 로컬은 .env 의 EBAY_SEARCH_LIMIT=50 으로 돌았다. 로컬 보충분(8/27·9/18·9/22·9/23·9/26)은
//    매물을 절반만 봐서 일판 조회 매물(채택+제외)이 ~740 → ~490, 채택 표본이 ~220 → ~150 으로 줄고 세트 중간값이
//    20~50% 낮게 찍혔다(OP-05 일판 $300 → $195, 검색 전체 매물수 totalResults 는 그대로). 같은 시계열에 섞이면
//    수집 방식 차이가 시세 급락으로 둔갑한다(D5 의 8/13 사고와 같은 종류). 한도는 코드에 고정하고 환경변수로 받지 않는다.
for (const f of ["tools/update-ebay-pack-prices.js", "tools/update-ebay-english-pack-prices.js"]) {
  const src = read(f).replace(/^\s*\/\/.*$/gm, "");
  if (!/const searchLimit = "100";/.test(src) || /EBAY_SEARCH_LIMIT/.test(src)) {
    errors.push(`D14: ${f} 의 조회 한도가 100 고정이 아니다 — 로컬과 클라우드가 다른 표본을 받아 박스 시계열에 가짜 급락이 생긴다`);
  }
}

// ── D5. 박스 SOLD 시계열 무결성 — 2026-07-22 차트 데이터 레이어.
//    이 파일은 실거래(sold) 기반이라 조작·역행이 곧 허위 데이터다. 내부 정합성만 검사(파일 없으면 스킵).
//    2026-08-13: 시계열은 이제 append-only 축적본이 아니라 **원장에서 매번 다시 만드는 파생물**이다.
//    append-only 를 지켜야 하는 쪽은 원장(box-sold-ledger.json)으로 옮겨졌고, 아래에서 그쪽을 본다.
//    시계열이 판매일 기준이라는 사실은 반드시 고지에 남아야 한다 — 수집일 스냅샷으로 되돌아가면
//    수집 방식 변화가 다시 가격 급등으로 둔갑한다(8/13 실사고).
if (exists("data/box-sold-series.json")) {
  const bs = JSON.parse(read("data/box-sold-series.json"));
  const basis = bs.basis || (bs.window && bs.window.basis);
  if (basis !== "sold") errors.push("D5: box-sold-series 의 basis 가 'sold' 가 아님 — active/추정 혼입 금지");
  if (!/sold/i.test(bs.note || "")) errors.push("D5: box-sold-series.note 에 sold 고지 누락");
  if (!/date of sale|sale date/i.test(bs.note || "") || (bs.window && bs.window.datedBy !== "saleDate")) {
    errors.push("D5: box-sold-series 가 판매일 기준이라는 고지를 잃음 — 수집일 스냅샷으로 되돌아가면 수집 방식 변화가 가격 급등으로 보인다");
  }
  // 원장 쪽의 append-only 고지. 시계열이 파생물이 된 뒤로 이 문구가 갈 곳은 여기뿐이다.
  if (exists("data/box-sold-ledger.json")) {
    const lg = JSON.parse(read("data/box-sold-ledger.json"));
    if (!/never modified or deleted|append-only/i.test(lg.note || "")) {
      errors.push("D5: box-sold-ledger.note 에 append-only(과거 기록 불변) 고지 누락 — 원장이 유일한 원본이다");
    }
    // D12. 다른 카드게임 상품 혼입 금지 — 2026-09-24 실사고: 건담 "Eternal Nexus EB01" 박스 9건이 EB-01 에 들어가
    //     영문 EB-01 실거래 중앙값이 $903 → $140 으로 무너진 채 배포됐다. 단어 목록은 tools/other-game-words.js 한 곳.
    //     원장에 한 건이라도 있으면 FAIL — 적재(ingest)가 막고, 놓치면 repair-box-ledger 가 excluded 로 옮긴다.
    try {
      const { OTHER_GAME } = require("./other-game-words");
      const hits = [];
      for (const [code, eds] of Object.entries(lg.sets || {})) {
        for (const ed of ["jp", "en"]) for (const r of (eds || {})[ed] || []) {
          if (OTHER_GAME.test(r.title || "")) hits.push(`${code}.${ed} ${r.id} "${(r.title || "").slice(0, 50)}"`);
        }
      }
      if (hits.length) errors.push(`D12: 원장에 다른 카드게임 상품 ${hits.length}건 — node tools/repair-box-ledger.js 로 옮길 것: ${hits.slice(0, 3).join(" · ")}`);
    } catch (e) { errors.push("D12: tools/other-game-words.js 를 읽을 수 없음 — " + e.message); }
  }
  for (const [code, eds] of Object.entries(bs.sets || {})) {
    for (const ed of ["jp", "en"]) {
      const arr = (eds || {})[ed];
      if (!Array.isArray(arr)) continue;
      let prev = "";
      for (const p of arr) {
        if (!p || typeof p.d !== "string") { errors.push(`D5: ${code}.${ed} 날짜 없는 점`); break; }
        if (p.d <= prev) { errors.push(`D5: ${code}.${ed} 날짜 역행/중복 (${prev}→${p.d}) — append-only 위반`); break; }
        if (!(typeof p.median === "number" && p.median > 0)) { errors.push(`D5: ${code}.${ed} ${p.d} median 이상`); break; }
        if (p.n != null && (!Number.isInteger(p.n) || p.n < 0)) { errors.push(`D5: ${code}.${ed} ${p.d} n(판매수) 이상`); break; }
        prev = p.d;
      }
    }
  }
}

// ── D16. 미발매 판에 sold 숫자 금지 — 2026-10-14 신설.
//    사고: 미발매 OP-18 의 예약판매 8건(매물 2개)이 일본판 sold 시계열에 들어가, AI 인용 1위 글(발매일 글)의
//    "OP-17 박스값" 자리에 OP-18 값 $110 이 찍혔고(실제 OP-17 $125), 7개 페이지 표에 OP-18·EB-05 예약판매가가
//    "sold median" 으로 섞였다(compare 의 EB-05 −42% 도 그 값). 같은 날 sets/op-18 은 "no completed sale" 이었다.
//    규칙: sold 시계열(주·월·일·건수)은 판별 공식 발매일 당일부터만. 발매일 이전 판매는 preRelease 로만(원장 건수와 일치).
//    미발매 판(release > asOf)은 current 가 없어야 하고, 모든 가격표 칸은 "—". 발매 전 세트 페이지의 판매 칸은 "presale" 라벨.
// ── D17. 페이지 간 현재가 일치 — 2026-10-14 신설.
//    같은 세트·같은 판의 "지금 값" 이 페이지마다 달랐다(소비자마다 기준일·신선도를 따로 셌다). 이제 원천은
//    box-sold-series 의 current 하나 — 표 칸은 정확히 money(current.median) 또는 (current 가 없으면) "—" 여야 하고,
//    세트 페이지 큰 숫자(Box price JP/EN)는 그 판 마지막 점과 같아야 한다. 같은 (세트, 판)의 숫자가 둘 이상이면 FAIL.
if (exists("data/box-sold-series.json")) {
  const bs = JSON.parse(read("data/box-sold-series.json"));
  const SS = bs.sets || {};
  const asOf = bs.asOf || "";
  const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
  const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
  const relOf = (code, ed) => (SS[code] && SS[code].release && SS[code].release[ed]) || null;
  const unreleased = (code, ed) => { const r = relOf(code, ed); return !!(r && (!asOf || r > asOf)); };
  const curOf = (code, ed) => (SS[code] && SS[code].current && SS[code].current[ed]) || null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) errors.push("D17: box-sold-series.asOf 가 없다 — 모든 표가 같은 기준일을 읽어야 한다");

  // (a) 시계열 — 발매일 이전 점·건수 금지, 원장의 발매 전 즉구 건수 == preRelease.sales
  let LG = null;
  try { LG = JSON.parse(read("data/box-sold-ledger.json")); } catch {}
  const isBin = (r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number(r.unit) > 0 && r.fmt === "bin";
  for (const [code, node] of Object.entries(SS)) {
    if (!node.release || !node.current || !node.preRelease) { errors.push(`D16: ${code} 에 release/current/preRelease 가 없다 — build-box-sold-series.js 가 발매일로 자르지 않았다`); continue; }
    for (const ed of ["jp", "en"]) {
      const rel = node.release[ed];
      if (rel) {
        const bad = [];
        for (const p of [...(node[ed] || []), ...(ed === "en" ? node.enBlue || [] : []), ...((node.daily || {})[ed] || [])]) if (p && p.d < rel) bad.push(p.d);
        for (const p of (node.monthly || {})[ed] || []) if (p && p.d.slice(0, 7) < rel.slice(0, 7)) bad.push(p.d);
        for (const d of Object.keys((node.counts || {})[ed] || {})) if (d < rel) bad.push(d);
        if (bad.length) errors.push(`D16: ${code}.${ed} sold 시계열에 발매일(${rel}) 이전 점 ${bad.length}개(${bad[0]}) — 예약판매는 preRelease 로만`);
        if (LG) {
          const pre = (((LG.sets || {})[code] || {})[ed] || []).filter((r) => isBin(r) && r.d < rel).length;
          const got = (node.preRelease[ed] && node.preRelease[ed].sales) || 0;
          if (pre !== got) errors.push(`D16: ${code}.${ed} 원장의 발매일(${rel}) 이전 즉구 ${pre}건 ≠ preRelease ${got}건 — 예약판매가 sold 쪽에 남았거나 빠졌다`);
        }
      }
      if (unreleased(code, ed) && node.current[ed]) errors.push(`D16: ${code}.${ed} 미발매(${rel})인데 current 값이 있다`);
      const pr = node.preRelease[ed];
      if (pr && pr.median != null && !(pr.listings >= (bs.preReleaseMinListings || 3))) errors.push(`D16: ${code}.${ed} 예약판매 매물 ${pr.listings}개로 중앙값을 냈다 — 소수 매물 반복 판매는 값이 아니다`);
    }
  }
  // 화면 카드(packs.json boxMarket.*.ebaySold)도 발매일 이후 관측이어야 한다.
  try {
    const P = JSON.parse(read("data/onepiece-packs.json"));
    for (const [code, s] of Object.entries(P.sets || {})) for (const ed of ["jp", "en"]) {
      const es = s.boxMarket && s.boxMarket[ed] && s.boxMarket[ed].ebaySold, rel = relOf(code, ed);
      if (es && rel && es.updated && es.updated < rel) errors.push(`D16: packs ${code}.${ed} ebaySold(${es.updated})가 발매일(${rel}) 이전 관측이다`);
    }
  } catch {}

  // (b) 페이지 표 — 칸 추출
  const strip = (h) => h.replace(/<small[\s\S]*?<\/small>/g, "").replace(/<[^>]+>/g, "").replace(/&times;/g, "×").replace(/\s+/g, " ").trim();
  const cellsOf = (tr) => [...tr.matchAll(/<t[dh](?:\s[^>]*)?>[\s\S]*?<\/t[dh]>/g)].map((m) => m[0]);
  // 비교표 행 머리는 <b>EB-05</b><span>이름</span> 이라 글자가 붙는다("EB-05Heroines") — \b 대신 숫자 아님으로 끊는다.
  const codeOf = (h) => (strip(h).match(/^((?:OP|EB|PRB)-\d{2})(?!\d)/) || [])[1] || null;
  const shown = [];   // { file, code, ed, text, kind: "table" | "setpage", d? }
  const tableRows = (file, scope, pick) => {
    if (!exists(file)) return;
    const html = read(file);
    const part = scope ? (html.match(scope) || [""])[0] : html;
    let n = 0;
    for (const m of part.matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
      const cs = cellsOf(m[0]);
      const code = cs.length ? codeOf(cs[0]) : null;
      if (!code) continue;
      for (const [ed, idx] of pick(cs)) { if (cs[idx] != null) { shown.push({ file, code, ed, text: strip(cs[idx]), kind: "table" }); n++; } }
    }
    if (!n) errors.push(`D17: ${file} 의 가격표 행을 못 읽었다 — 표 구조가 바뀌었으면 이 검사도 같이 고칠 것`);
  };
  // 1) 발매일 글: 세트 목록 표의 JP box 칸(첫 class="num") — 행 머리가 코드만 든 <td>
  if (exists("articles/one-piece-set-list-release-dates.html")) {
    const f = "articles/one-piece-set-list-release-dates.html", html = read(f);
    let n = 0;
    const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const shortD = (iso) => { const [, mo, d] = iso.split("-").map(Number); return `${MON3[mo - 1]} ${d}`; };
    for (const m of html.matchAll(/<tr><td>((?:OP|EB|PRB)-\d{2})<\/td>([\s\S]*?)<\/tr>/g)) {
      const c = m[2].match(/<td class="num">((?:(?!<\/td>)[\s\S])*)<\/td>/);
      if (!c) continue;
      shown.push({ file: f, code: m[1], ed: "jp", text: strip(c[1]), kind: "table" }); n++;
      // 값 옆 날짜 = 그 current 의 날짜(열 머리에 월을 박던 시절 값 날짜와 열 이름이 엇갈렸다 — 2026-10-14 QA)
      const cur = curOf(m[1], "jp"), sm = (c[1].match(/<small>\s*([^<]*)<\/small>/) || [])[1];
      if (cur && (sm || "").trim() !== shortD(cur.d)) errors.push(`D17: ${f} ${m[1]} JP box 날짜 "${sm || "없음"}" ≠ 그 값의 날짜 ${shortD(cur.d)}`);
    }
    if (!n) errors.push(`D17: ${f} 의 JP box 칸을 못 읽었다`);
    if (/<th class="num">JP box \((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4}\)<\/th>/.test(html)) errors.push(`D17: ${f} JP box 열 이름에 월이 박혀 있다 — 값마다 날짜가 다르다`);
    // 본문의 최신 세트 박스값 표시 구간(data-newest-box) — 표와 같은 값·같은 날짜. 최신 세트 = set-facts 일본판 발매일 ≤ asOf 인 가장 늦은 OP.
    let SF0 = {};
    try { SF0 = JSON.parse(read("data/set-facts.json")).sets || {}; } catch {}
    const relJ = (c) => (SF0[c] && SF0[c].jpRelease && SF0[c].jpRelease.date) || null;
    const newest = Object.keys(SF0).filter((c) => /^OP-\d+$/.test(c) && relJ(c) && relJ(c) <= asOf).sort((a, b) => relJ(a).localeCompare(relJ(b))).pop() || null;
    if (/data-op17-box/.test(html)) errors.push(`D17: ${f} 에 옛 표시 구간 data-op17-box 가 남아 있다 — 최신 세트는 데이터로(data-newest-box)`);
    const cur = newest ? curOf(newest, "jp") : null;
    const boxes = [...html.matchAll(/<span data-newest-box>([^<]*)<\/span>/g)];
    if (!boxes.length) errors.push(`D17: ${f} 에 최신 세트 박스값 표시 구간(data-newest-box)이 없다`);
    for (const m of boxes) {
      const want = cur ? `${money(cur.median)} on ${longDate(cur.d)}` : "—";
      if (m[1].trim() !== want) errors.push(`D17: ${f} data-newest-box "${m[1].trim()}" ≠ ${newest} 일본판 현재가 "${want}" — 최신 세트 판정·예약판매 혼입 확인`);
    }
    // 최신 배지·"Newest main set" 줄이 데이터의 최신 세트를 가리켜야 한다(손글씨 "OP-17" 이 발매 뒤에 남지 않게)
    const badge = (html.match(/<a href="\.\.\/sets\/([a-z0-9-]+)\.html">(?:<span[^>]*>)?[A-Z]+-\d+ release date(?:<\/span>)? <small[^>]*data-newest[^>]*>/) || [])[1];
    if (newest && badge !== newest.toLowerCase()) errors.push(`D17: ${f} "latest" 배지가 ${badge || "없음"} — 최신 발매 세트는 ${newest}`);
    const nm = (html.match(/<strong>Newest main set \(([A-Z]+-\d+)\):<\/strong>/) || [])[1];
    if (newest && nm !== newest) errors.push(`D17: ${f} "Newest main set" 줄이 ${nm || "없음"} — 최신 발매 세트는 ${newest}`);
    const nx = (html.match(/<strong>Next (?:release|booster) \(([A-Z]+-\d+)/) || [])[1];
    if (nx && relJ(nx) && relJ(nx) <= asOf) errors.push(`D17: ${f} "Next release" 가 이미 발매된 ${nx}(${relJ(nx)}) 를 가리킨다`);
  }
  // 2) 팩 수 글: Box sold(5번째 칸, JP)
  tableRows("articles/how-many-packs-one-piece-booster-box.html", /<div class="tblWrap" data-pack-math>[\s\S]*?<\/table>/, () => [["jp", 4]]);
  // 3) 박스 가격 가이드: JP·EN
  tableRows("articles/one-piece-booster-box-price-guide.html", /<tbody>[\s\S]*?<\/tbody>/, () => [["jp", 1], ["en", 2]]);
  // 4) 일본판 vs 영문판(구매 가이드): JP·EN (둘 다 신선한 쌍만 실린다)
  tableRows("articles/japan-vs-english.html", /<tbody[^>]*>[\s\S]*?<\/tbody>/, () => [["jp", 1], ["en", 2]]);
  // 5) 일본판 vs 영문판 데이터 글: 마지막 세 칸이 JP now · EN now · EN/JP now
  tableRows("articles/japanese-vs-english-box-price-data-2026.html", /<table class="dataTable">[\s\S]*?<\/table>/, (cs) => [["jp", cs.length - 3], ["en", cs.length - 2]]);
  // 6·7) 세트 비교표(compare · best 글): 행 머리 <th>, 그다음 JP·EN
  for (const f of ["compare.html", "articles/best-one-piece-booster-box.html"]) {
    tableRows(f, /<!-- SET-COMPARISON:START -->[\s\S]*?<!-- SET-COMPARISON:END -->/, () => [["jp", 1], ["en", 2]]);
  }
  // 8) 세트 페이지 큰 숫자 — 일본판 sets/<code>.html "Box price (JP)", 영문판 sets/<code>-english.html "Box price (EN)".
  //    기준은 current — 2026-10-14 QA: 마지막 점을 날짜와 함께 내면(OP-02 $147 as of 07-07) 같은 세트가 표에선 "—" 라 두 규칙이 됐다.
  for (const [code, node] of Object.entries(SS)) {
    for (const [ed, file, label] of [["jp", `sets/${code.toLowerCase()}.html`, "Box price (JP)"], ["en", `sets/${code.toLowerCase()}-english.html`, "Box price (EN)"]]) {
      if (!exists(file)) continue;
      const html = read(file);
      const lab = label.replace(/[()]/g, "\\$&");
      const m0 = html.match(new RegExp(`${lab}(?:</a>)?</div><div class="statValue">([^<]*)</div><div class="statBase">([^<]*)`));
      if (!m0) continue;
      const m = [m0[0], m0[1], (m0[2].match(/as of (\d{4}-\d{2}-\d{2})/) || [])[1]];   // 영문판은 "reprint (White) · as of …" 처럼 앞에 라벨이 붙는다
      const last = curOf(code, ed);
      if (unreleased(code, ed) && m[1].trim() !== "—") { errors.push(`D16: ${file} 미발매 판에 ${label} ${m[1]} 이 있다`); continue; }
      if (!last) { if (m[1].trim() !== "—") errors.push(`D17: ${file} ${label} ${m[1]}(${m[2] || "날짜 없음"}) — current 가 없으면 "—"(28일 넘은 값을 날짜와 함께 내지 않는다)`); continue; }
      if (m[1].trim() !== money(last.median) || m[2] !== last.d) errors.push(`D17: ${file} ${label} ${m[1]}(${m[2]}) ≠ current ${money(last.median)}(${last.d})`);
      if (curOf(code, ed)) shown.push({ file, code, ed, text: m[1].trim(), kind: "setpage" });
    }
  }
  // 8b) 홈·box-prices·packs·세트 허브 요약표 — 값 = current(없으면 "—"), 날짜 칸(MM-DD) = 그 값의 날짜. 2026-10-14 QA:
  //     board 가 마지막 점(98일 전 값)을 그대로 써서 이 표들만 OP-02 $147 을 냈다.
  for (const f of ["index.html", "packs.html", "box-prices.html", "sets/index.html"]) {
    if (!exists(f)) continue;
    const html = read(f);
    let n = 0;
    for (const tbl of html.matchAll(/<table class="homeSummaryTable[^"]*"(?![^>]*data-cheapest)[^>]*>[\s\S]*?<\/table>/g)) {
      for (const m of tbl[0].matchAll(/<tr(?: class="[^"]*")?>[\s\S]*?<\/tr>/g)) {
        const cs = cellsOf(m[0]);
        const code = cs.length ? codeOf(cs[0]) : null;
        if (!code || cs.length < 4) continue;
        shown.push({ file: f, code, ed: "jp", text: strip(cs[2]), kind: "table" }); n++;
        const cur = curOf(code, "jp"), when = strip(cs[3]);
        if (cur ? when !== cur.d.slice(5) : when !== "—") errors.push(`D17: ${f} ${code} 날짜 칸 "${when}" ≠ ${cur ? cur.d.slice(5) + "(그 값의 날짜)" : "—"}`);
      }
    }
    if (!n) errors.push(`D17: ${f} 요약표 행을 못 읽었다 — 표 구조가 바뀌었으면 이 검사도 같이 고칠 것`);
  }
  // 8c) 설명문(meta description) — 한국어 세트 페이지의 원화 값·기준일, 영문판 세트 페이지의 배수("Nx the JP box")
  {
    let FX = null;
    try { FX = (JSON.parse(read("data/onepiece-packs.json")).fx || {}).usdKrw || null; } catch {}
    for (const code of Object.keys(SS)) {
      const slug = code.toLowerCase();
      const kf = `ko/${slug}.html`;
      if (exists(kf)) {
        const desc = (read(kf).match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
        const m = desc.match(/([\d,]+)원 \((\d{4}-\d{2}-\d{2}) 기준\)/);
        const cur = curOf(code, "jp");
        if (m && !cur) errors.push(`D17: ${kf} 설명문에 ${m[1]}원 — current 가 없으면 값을 싣지 않는다`);
        else if (m && cur) {
          if (m[2] !== cur.d) errors.push(`D17: ${kf} 설명문 기준일 ${m[2]} ≠ 그 값의 날짜 ${cur.d}`);
          if (FX && m[1] !== Math.round(cur.median * FX).toLocaleString("ko-KR")) errors.push(`D17: ${kf} 설명문 ${m[1]}원 ≠ current ${Math.round(cur.median * FX).toLocaleString("ko-KR")}원`);
        }
      }
      const ef = `sets/${slug}-english.html`;
      if (exists(ef)) {
        const desc = (read(ef).match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
        const m = desc.match(/([\d.]+)x the (?:JP|Japanese) box/);
        const j = curOf(code, "jp"), e = curOf(code, "en");
        if (m && !(j && e)) errors.push(`D17: ${ef} 설명문 "${m[0]}" — 배수는 JP·EN current 가 둘 다 있을 때만`);
        else if (m && String(Math.round((e.median / j.median) * 10) / 10) !== m[1]) errors.push(`D17: ${ef} 설명문 "${m[0]}" ≠ current 배수 ${Math.round((e.median / j.median) * 10) / 10}`);
      }
    }
  }
  // 9) 발매 전 세트 페이지(upcoming): 판매 칸은 "presale" 라벨, 매물 3개 미만이면 값 "—", 상태 줄은 데이터에서.
  try {
    const UP = JSON.parse(read("data/upcoming-set-pages.json"));
    for (const p of UP.pages || []) {
      const f = `sets/${p.slug}.html`;
      if (!exists(f)) continue;
      const html = read(f);
      const node = SS[p.code] || null;
      const tbl = html.match(/<table class="factTable preTbl">[\s\S]*?<\/table>/);
      if (tbl) {
        const allPre = unreleased(p.code, "jp") && unreleased(p.code, "en");
        if (allPre && !/Presale sold median<\/th>/.test(tbl[0])) errors.push(`D16: ${f} 발매 전인데 판매 열 머리가 "Presale sold median" 이 아니다 — 예약판매를 실거래처럼 부르지 않는다`);
        for (const tr of tbl[0].matchAll(/<tr>[\s\S]*?<\/tr>/g)) {
          const cs = cellsOf(tr[0]);
          if (cs.length < 3 || /<th/.test(cs[0])) continue;
          const ed = /Japanese/.test(cs[0]) ? "jp" : /English/.test(cs[0]) ? "en" : null;
          if (!ed || !unreleased(p.code, ed)) continue;
          const pr = node && node.preRelease && node.preRelease[ed];
          const want = pr && pr.median != null ? money(pr.median) : "—";
          if (strip(cs[2]) !== want) errors.push(`D16: ${f} ${ed} 판매 칸 "${strip(cs[2])}" ≠ 예약판매 요약 "${want}"`);
          if (pr && !/<small[^>]*>presale · /.test(cs[2])) errors.push(`D16: ${f} ${ed} 판매 칸에 "presale" 라벨이 없다`);
        }
      }
      const st = html.match(/<th scope="row"[^>]*>Market-data status<\/th><td>([^<]*)<\/td>/);
      if (!st) errors.push(`D16: ${f} 에 Market-data status 줄이 없다`);
      else if (/no completed sale/i.test(st[1]) && node && ((node.preRelease.jp && node.preRelease.jp.sales) || (node.preRelease.en && node.preRelease.en.sales))) {
        errors.push(`D16: ${f} 상태 줄 "${st[1]}" — 예약판매 실거래가 있는데 "no completed sale"`);
      }
    }
  } catch (e) { errors.push("D16: upcoming 페이지 검사 실패 — " + e.message); }

  // (c) 판정 — 칸마다 원천과 같아야 하고, 같은 (세트, 판)에 숫자가 둘 이상이면 안 된다.
  const byKey = new Map();
  for (const s of shown) {
    if (s.kind === "table") {
      const cur = curOf(s.code, s.ed);
      const want = cur ? money(cur.median) : "—";
      if (unreleased(s.code, s.ed) && s.text !== "—") errors.push(`D16: ${s.file} ${s.code} ${s.ed} 미발매(${relOf(s.code, s.ed)})인데 sold 칸이 "${s.text}"`);
      else if (s.text !== want) errors.push(`D17: ${s.file} ${s.code} ${s.ed} 칸 "${s.text}" ≠ 현재가 "${want}"(box-sold-series current)`);
    }
    if (/^\$/.test(s.text)) {
      const k = `${s.code}.${s.ed}`;
      if (!byKey.has(k)) byKey.set(k, new Map());
      byKey.get(k).set(s.text, (byKey.get(k).get(s.text) || []).concat(s.file));
    }
  }
  for (const [k, vals] of byKey) {
    if (vals.size > 1) errors.push(`D17: ${k} 현재가가 페이지마다 다르다 — ${[...vals].map(([v, fs]) => `${v}: ${fs.slice(0, 2).join(", ")}${fs.length > 2 ? ` 외 ${fs.length - 2}` : ""}`).join(" / ")}`);
  }
}

// ── D18. 라벨·정의 문구 = 실제 규칙 — 2026-10-14 QA 신설.
//    표의 n 은 그 중앙값 점의 평균 창(28~56일) 안 판매 건수인데 "n (week)"·"n = sales that week" 로 적혀 AI·사람이 "주 55건"으로 읽었다.
//    "Last sale" 칸은 마지막 판매일이 아니라 중앙값 점의 날짜였고, "—" 의 사유는 "28일 안 판매 없음"이 아니라
//    "28일 안에 날짜가 찍힌 중앙값 없음(창 안 6건 미만)" 이다(발매된 세트는 전부 28일 안에 판매가 있었다).
//    (a) 금지 문구 — 공개 HTML·llms 전부  (b) box-prices 두 표의 머리 = 쓰는 필드("As of", "n / window")
{
  const BAD = [
    [/\bn \(week\)/i, "n (week) — n 은 창 전체 건수"],
    [/n = sales that week/i, "n = sales that week — n 은 창 전체 건수"],
    [/no completed sale in the last 28 days|sale in the last 28 days|sold in the last 28 days/i, "'28일 안 판매 없음' — 실제 규칙은 '28일 안에 날짜가 찍힌 중앙값 없음'"],
    [/last-sale date, sample size/i, "last-sale date — 값의 날짜는 중앙값 점의 날짜"],
    [/그 주 거래 수/, "그 주 거래 수 — n 은 창 전체 건수"],
  ];
  const files = [...PUBLIC_HTML, ...["llms.txt", "llms-full.txt"].filter(exists)];
  const hits = [];
  for (const f of files) {
    const t = read(f);
    for (const [re, why] of BAD) if (re.test(t)) { hits.push(`${f}: ${why}`); break; }
  }
  for (const h of hits.slice(0, 10)) errors.push(`D18: ${h}`);
  if (hits.length > 10) errors.push(`D18: 그 밖에 ${hits.length - 10}곳`);
  if (exists("box-prices.html")) {
    const h = read("box-prices.html");
    const heads = (re) => { const t = h.match(re); return t ? [...t[0].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => m[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()) : null; };
    const cheap = heads(/<table class="homeSummaryTable[^"]*" data-cheapest>[\s\S]*?<\/thead>/);
    if (cheap && (cheap[2] !== "As of" || !/^n \/ window$/.test(cheap[3] || ""))) errors.push(`D18: box-prices 최저가 표 머리 ${JSON.stringify(cheap)} — 날짜 칸은 "As of"(중앙값 점의 날짜), n 칸은 "n / window"`);
    const all = heads(/<table class="homeSummaryTable[^"]*" data-all-sets>[\s\S]*?<\/thead>/);
    if (all && all[3] !== "As of n / window") errors.push(`D18: box-prices 전체 표 날짜 칸 머리 "${all[3]}" — "As of n / window"(값의 날짜 + 창 안 판매 수)`);
  }
}

// ── R2. 재판 출처 구분 — 2026-08-13 신설.
//    우리가 가진 "재판" 기록은 대부분 **매장·유통처의 재입고 공지**이지, 반다이가 재판을 발표한 일정이 아니다.
//    둘을 한 줄에 뭉쳐 "reprint records" 라고 쓰면 공식 발표처럼 읽힌다.
//    또 페이지 상단의 발매일은 **영문판** 날짜라, 일본판 재판 기록의 기준일로 쓸 수 없다.
{
  const factsPath = "data/set-facts.json";
  if (exists(factsPath)) {
    const F = JSON.parse(read(factsPath));
    for (const [code, sf] of Object.entries(F.sets || {})) {
      for (const r of sf.reprintRecords || []) {
        if (!r.kind) errors.push(`R2: ${code} 재판 기록에 kind(출처 구분)가 없다 — retailer/distributor/official 중 하나여야 한다`);
      }
      // 공식 발매일은 반드시 출처와 함께. 출처 없는 날짜는 추측과 구분되지 않는다.
      if (sf.jpRelease && !sf.jpRelease.source) {
        errors.push(`R2: ${code}.jpRelease 에 source 가 없다 — 공식 페이지 링크 없이 발매일을 싣지 않는다`);
      }
      // 추첨판매는 **발매 전에도** 열린다(초회 물량 선판매). 발매일과 대조하지 않고 "발매 후 추가 공급" 이라
      // 부르면 공급이 늘지도 않았는데 늘었다고 쓰는 셈이다(2026-08-13: OP-17 은 발매 8/22 인데 추첨이 7/30 이었다).
      for (const r of sf.reprintRecords || []) {
        // 반다이 문구 = 분류 — 2026-10-15(4차). 메모가 "再販"이라 적은 추첨(부정형 "no 再販" 제외)은 official-reprint-lottery(재판으로 셈),
        // 그 말이 없는 추첨은 official-lottery 여야 한다. 3차는 OP-09("Bandai Namco shop 再販 pre-order lottery")를 재판 밖으로 뺐다.
        const saysSaihan = /再販/.test(String(r.note || "").replace(/no 再販/gi, "")) || /reprint lottery/i.test(String(r.kindWas || ""));
        if (/lottery/i.test(r.kind || "") && !/pre-release|unverified-timing/i.test(r.kind || "")) {
          if (saysSaihan && r.kind !== "official-reprint-lottery") errors.push(`R2: ${code} 의 ${r.date} 추첨 메모가 "再販"인데 kind=${r.kind} — official-reprint-lottery(재판)여야 한다`);
          if (!saysSaihan && r.kind === "official-reprint-lottery") errors.push(`R2: ${code} 의 ${r.date} 추첨을 재판(official-reprint-lottery)으로 분류했는데 메모에 "再販" 문구가 없다`);
        }
      }
      for (const r of sf.reprintRecords || []) {
        const isPost = /^official-(?:reprint-)?lottery$/.test(r.kind || "");
        if (!isPost) continue;
        if (!sf.jpRelease || !sf.jpRelease.date) {
          errors.push(`R2: ${code} 의 ${r.date} 추첨을 "발매 후" 로 분류했는데 발매일이 확인돼 있지 않다 — official-lottery-unverified-timing 으로 두거나 발매일을 먼저 확인할 것`);
          continue;
        }
        // 월(YYYY-MM) 단위 비교. 발매월보다 앞서면 사전판매다.
        const rel = sf.jpRelease.date.slice(0, 7);
        if (String(r.date).slice(0, 7) < rel) {
          errors.push(`R2: ${code} 의 ${r.date} 추첨이 발매(${sf.jpRelease.date}) 이전인데 "발매 후" 로 분류돼 있다 — pre-release-lottery 여야 한다`);
        }
        // 일(YYYY-MM-DD) 단위 — 2026-10-15(감사 #8): 기록 날짜가 월 단위라 같은 달 발매(05-30) 하루 전에 응모가 열린 OP-16 1차 추첨
        // (메모 "entries opened 2026-05-29")이 위 월 비교를 통과해 "발매 후" 로 남았고, 한국어 페이지가 그걸 재판으로 셌다.
        // 메모에 적힌 응모 시작일이 일본판 발매일보다 앞서면 발매 전 추첨(초판 배정)이다.
        const open = (String(r.note || "").match(/entries (?:opened )?(\d{4}-\d{2}-\d{2})/) || [])[1];
        if (open && open < sf.jpRelease.date) {
          errors.push(`R2: ${code} 의 ${r.date} 추첨 응모 시작 ${open} 이 발매(${sf.jpRelease.date}) 전인데 kind=${r.kind} — pre-release-lottery 여야 한다`);
        }
      }
    }
  }
  // 생성된 세트 페이지가 매장 재입고를 공식 재판으로 표기하지 않는지 실물로 확인한다.
  for (const f of PUBLIC_HTML.filter((p) => /^sets\/(op|eb|prb)-\d+\.html$/.test(p))) {
    const html = read(f);
    const m = html.match(/Retailer-reported restocks:[\s\S]{0,400}?<\/li>/);
    if (m && !/not a Bandai reprint announcement/.test(m[0])) {
      errors.push(`R2: ${f} 매장 재입고 줄에 "공식 발표가 아님" 단서가 빠졌다`);
    }
    if (/Retailer\/distributor reprint records/.test(html)) {
      errors.push(`R2: ${f} 옛 문구(Retailer/distributor reprint records)가 남아 있다 — 출처가 뭉뚱그려진다`);
    }
    // 방법 설명 문장 금지(2026-10-15, 4차) — "Bandai does not call these reprints, so we do not either"
    if (/does not call these reprints|we do not either/.test(html)) errors.push(`R2: ${f} 에 방법 설명 문장("Bandai does not call these reprints…")이 남아 있다 — 줄은 라벨·날짜만`);
  }
  // 영문 세트 페이지의 再販 추첨 줄 = 원장의 official-reprint-lottery(4차). 홈 배지 툴팁(packs.js)에도 방법 설명 문장이 없어야 한다.
  if (exists(factsPath)) {
    const F = JSON.parse(read(factsPath));
    for (const [code, sf] of Object.entries(F.sets || {})) {
      const f = `sets/${code.toLowerCase()}.html`;
      if (!exists(f) || !sf.jpMsrpYen) continue;
      const n = (sf.reprintRecords || []).filter((r) => r.kind === "official-reprint-lottery").length;
      const has = /<li>Bandai Namco shop reprint [(]再販[)] lottery:/.test(read(f));
      if (!!n !== has) errors.push(`R2: ${f} 再販 추첨 줄 ${has ? "있음" : "없음"} ≠ 원장 official-reprint-lottery ${n}건`);
    }
  }
  if (/does not call these reprints|'재판'이라 부르지 않습니다/.test(read("packs.js"))) errors.push("R2: packs.js 배지 툴팁에 방법 설명 문장(Bandai does not call these reprints)이 남아 있다");
}

// ── R3. sold 수집 URL 에 카테고리를 걸지 않는다 — 2026-08-13 신설.
//    _sacat 을 붙이면 eBay 가 &Language= 패싯을 무시한다. 실측(OP-13 즉구):
//      카테고리 없음  jp 70 · en 72 · 겹침 1      ← 언어가 제대로 나뉜다
//      _sacat=261068 jp 87 · en 87 · 겹침 87     ← 완전히 같은 결과
//    노이즈가 확 줄어 보여서 다시 넣고 싶어지는 종류의 실수다. 그래서 코드로 막는다.
{
  const f = "tools/box-sold-urls.js";
  if (exists(f)) {
    const src = read(f);
    if (/_sacat=/.test(src.replace(/^\s*\/\/.*$/gm, ""))) {
      errors.push("R3: box-sold-urls.js 가 _sacat(카테고리)을 다시 걸고 있다 — eBay 가 Language 패싯을 무시해 일본판/영문판이 같은 결과가 된다");
    }
    if (!/Language=/.test(src)) {
      errors.push("R3: box-sold-urls.js 에서 Language 패싯이 사라졌다 — 판별 근거가 제목 추측으로 되돌아간다");
    }
  }
}

// ── R4. 수집 빠짐 그물이 살아있는가 — 2026-09-02 신설.
//    소유자 절대지시: "여태 수집하던 것 하나도 빼먹지 마라. 그래프 틀리면 안 된다."
//    collect-status.js 가 data/ 와 packs.json 을 전수 스캔해 목록에 없는 수집을 고발한다.
//    그런데 **그물은 조용히 죽는다** — 실제로 그날 정규식의 \d 가 d 로 깨져(셸에서 백슬래시가 먹혔다)
//    아무것도 검사하지 않으면서 "UNTRACKED 0" 을 출력했다. 검사 안 하고 통과했다고 말하는 상태였다.
//    그래서 여기서 가짜 수집을 심어 잡히는지 매번 확인한다. 이게 통과해야 푸시할 수 있다.
{
  const f = "tools/test-collect-status.js";
  if (!exists(f)) {
    errors.push("R4: test-collect-status.js 가 사라졌다 — 수집 빠짐 그물을 검증할 방법이 없어진다");
  } else {
    try {
      const out = require("node:child_process").execFileSync(
        process.execPath, [path.join(ROOT, f)], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, cwd: ROOT }
      );
      const r = JSON.parse(out.trim().split("\n").pop());
      if (r.test !== "OK") errors.push("R4: 수집 빠짐 그물 검사 실패 — 새 수집이 조용히 누락될 수 있다");
      if (r.sources < 22) errors.push(`R4: 등록된 수집원이 ${r.sources}개로 줄었다(22개 이상이어야 한다) — 수집원이 목록에서 사라졌는지 확인할 것`);
    } catch (e) {
      errors.push("R4: 수집 빠짐 그물 검사가 죽었다 — " + String(e.message || e).slice(0, 120));
    }
  }
}

// ── Q1. 다수량(lot) 개당가 규칙 — 2026-07-22. "3박스 낙찰 총액"이 1박스 가격으로 오염되지 않아야 한다.
//    경매(tools/lot-quantity.js)와 브라우저 sold 수집(box-sold-urls.js 추출기)이 같은 규칙으로 동작하는지
//    함정 제목(세트코드 13, 연도, 케이스, 복수형)까지 실제로 실행해 검증한다.
{
  const { parseLotQuantity } = require("./lot-quantity");
  const lotCases = [
    ["One Piece OP-13 Booster Box Japanese Sealed", "box", 1],        // 세트코드 13(하이픈)이 수량이면 안 됨
    ["One Piece Card Game OP 13 Booster Box Japanese Sealed", "box", 1], // 공백형 OP 13 — 레드팀 확정 버그
    ["One Piece OP 05 Booster Box English", "box", 1],                // 공백형 OP 05
    ["ST 21 One Piece box sealed Japanese", "box", 1],               // 공백형 ST 21
    ["One Piece Card Game OP05 Booster Box 2023", "box", 1],          // 연도가 수량으로 잡히면 안 됨
    ["One Piece Romance Dawn OP-01 Japanese 1 Box", "box", 1],
    ["One Piece OP-01 Booster Box - 24 Packs Japanese Sealed", "box", 1], // 박스가 담는 24팩 → 수량 아님
    ["OP-13 booster box x3 Japanese", "box", 3],
    ["3 Booster Boxes One Piece OP-08 Sealed", "box", 3],
    ["ワンピースカードゲーム OP-13 2BOX 未開封", "box", 2],
    ["Set of 2 One Piece PRB-01 Premium Booster Box", "box", 2],
    ["One Piece Booster Boxes OP-09 Sealed Japanese", "box", null],   // 개수 없는 복수형 — 모름
    ["One Piece OP-01 Booster Box Case Sealed", "box", null],         // 케이스 — 개수 불명
    ["One Piece OP-13 Sealed Case 12 boxes", "box", 12],              // 개수 명시된 케이스는 나눔
    // 2026-09-30: PRB-02 이름 속 권 번호("Vol. 2"·"Premium Booster 2")가 2박스로 읽혀 원장 22건이 반값이 됐다.
    ["Sealed Japanese The Best Vol. 2 PRB-02 Booster Box US SELLER One Piece Card Game", "box", 1],
    ["One Piece TCG PRB-02 Premium Booster 2 Booster Box (FREE SHIPPING✔️)", "box", 1],
    ["10 Booster Packs One Piece OP-05 Japanese", "pack", 10],        // 팩 묶음 — 레드팀 확정 버그
    ["3 Packs One Piece Card Game OP-08 Sealed", "pack", 3],
    ["One Piece OP-09 Booster Packs Japanese", "pack", null],         // 개수 없는 팩 복수형 — 모름
    ["Monkey D Luffy OP01-003 Alt Art x4", "card", 4],
    ["One Piece card lot 50+ cards", "card", null],
    ["Shanks OP01-120 Manga Alt Art PSA 10", "card", 1],
  ];
  for (const [title, kind, want] of lotCases) {
    const got = parseLotQuantity(title, kind);
    if (got !== want) errors.push(`Q1: lot-quantity "${title}" → ${JSON.stringify(got)} (기대 ${JSON.stringify(want)})`);
  }

  // sold 원장 판정(box-sold-ingest.judgeItem)도 같은 규칙인지 — 함정 케이스를 실제 실행해 확인.
  try {
    const { judgeItem } = require("./box-sold-ingest");
    const R = data.fx.usdKrw;
    const it = (t, k, cur, d) => ({ id: "1", t, k, cur: cur || "KRW", d: d || "Sold  Jul 20, 2026" });
    const ingestCases = [
      // [항목, 기대: rec.unit(USD, ±0.01) 또는 drop 이유 문자열, 기대 에디션]
      [it("One Piece OP-13 Booster Box Japanese Sealed", 200000), 200000 / R, "jp"],
      [it("One Piece Card Game OP-13 Booster Box Japanese Sealed", 200000), 200000 / R, "jp"], // "Card Game" 박스 유지
      [it("One Piece OP-13 Booster Box - 24 Packs Japanese Sealed", 250000), 250000 / R, "jp"], // "24 Packs" 박스 유지
      [it("OP-13 booster box Japanese x2", 380000), 190000 / R, "jp"],                       // 개당가 나눔
      [it("3 Booster Boxes OP-13 Japanese Sealed", 540000), 180000 / R, "jp"],
      [it("One Piece OP-13 Booster Box English Sealed", 210, "USD"), 210, "en"],             // USD 표기
      [it("One Piece OP-13 Booster Boxes Japanese", 500000), "uncountable-lot"],             // 개수 불명 복수형
      [it("One Piece OP-13 Booster Box Case Japanese", 2000000), "bad-word"],                // 케이스
      [it("Sleeved Boosters Double Pack Set (OP 13,14,16) Japanese", 385240), "not-booster-box"],
      [it("One Piece OP-13 OP-14 Booster Box Japanese", 400000), "cross-set"],               // 멀티세트
      [it("One Piece OP-13 Booster Box Sealed", 200000), "no-language"],                     // 언어 미표기
      [it("One Piece OP-13 Booster Box Japanese", 50000), "price-out-of-range"],             // 팩 가격대
      [it("One Piece OP-13 Booster Box Japanese", 200000, "KRW", "no date here"), "bad-date"],
      // 2026-09-30: "case" 가 붙은 단품 박스는 살리고 12박스 케이스는 계속 버린다(box-case-words.js). 덤프 원문.
      //   9/18~9/30 덤프에서 단품 109건이 bad-word 로 빠져 있었다(EB-01 영문은 9/12 뒤로 원장이 비었다).
      [it("One Piece TCG OP13 Booster Box MINT English - New & Sealed CASE FRESH 🚀✅", 594499), 594499 / R, "en"],
      [it("One Piece Card Game OP-13 Booster Box English Sealed + Acrylic Case", 666560), 666560 / R, "en"],
      [it("One Piece TCG OP-13 Carrying On His Will Booster Box Case SEALED ENGLISH", 10015219), "bad-word"],
      [it("One Piece OP-13 Carrying On His Will 12 BOX BOOSTER BOX CASE Factory Sealed", 9051726), "bad-word"],
    ];
    for (const [item, want, wantEd] of ingestCases) {
      const r = judgeItem(item, "OP-13", R);
      if (typeof want === "string") {
        if (r.drop !== want) errors.push(`Q1: ingest "${item.t}" → ${r.drop || "통과"} (기대 drop ${want})`);
      } else if (!r.rec || Math.abs(r.rec.unit - want) > 0.01 || r.ed !== wantEd) {
        errors.push(`Q1: ingest "${item.t}" → ${JSON.stringify(r.rec ? { unit: r.rec.unit, ed: r.ed } : r)} (기대 unit ${want.toFixed(2)} ed ${wantEd})`);
      } else if (r.rec.d !== "2026-07-20") {
        // 판매일은 eBay 표시일("Sold  Jul 20, 2026") 그대로다 — 2026-10-01. 종전 파서는 KST 에서 하루 이른 2026-07-19 를 적었다.
        errors.push(`Q1: ingest "${item.t}" → d ${r.rec.d} (기대 2026-07-20 — 표시일 그대로, 타임존 변환 금지)`);
      }
    }
  } catch (e) {
    errors.push(`Q1: ingest 판정 실행 실패 — ${e.message}`);
  }

  // 박스 sold 판정 회귀 — 2026-09-30. 실제 덤프 제목으로 단품 살림/케이스·불명·액세서리 버림,
  // PRB-02 권 번호, 팰월드 원장 id+판매일 중복 키를 함께 검증한다(tools/test-box-sold-filters.js).
  {
    const r = spawnSync(process.execPath, [path.join(__dirname, "test-box-sold-filters.js")], { cwd: ROOT, encoding: "utf8" });
    if (r.error || r.status !== 0) errors.push(`Q1: test-box-sold-filters.js 실패 — ${(r.stderr || r.error?.message || r.stdout || "unknown").trim().slice(0, 500)}`);
  }
}

// ── Q5. 시리즈 이름 충돌 — 2026-09-30 신설.
//    EB-03 "Heroine's Edition" 과 EB-05 "Heroines Edition vol.2" 처럼 한 이름이 다른 이름의 앞부분이면,
//    종전 ingest 는 둘 다 걸어 EB-05 판매를 cross-set 으로 버리고, 코드 없는 2권 제목은 EB-03 에 섞었다.
//    또 ingest 이름표가 packs.json 만 읽어 수집 목록(UPCOMING)의 세트 이름을 몰랐다.
//    실제 덤프 제목(box-2026-09-29: "ONE PIECE Heroines Edition Vol.2 EB-05 Japanese Booster Box PRE-ORDER")으로 실행해 잠근다.
//    상세 회귀 테스트: tools/test-box-sold-name-collision.js
{
  try {
    const { judgeItem, buildNameMap, ingestNameMap } = require("./box-sold-ingest");
    const { UPCOMING } = require("./box-sold-urls");
    const R = data.fx.usdKrw;
    const next = buildNameMap(data, [{ code: "EB-05", nameEn: "Heroines Edition vol.2" }]);
    const now = buildNameMap(data);
    const it = (t, k) => ({ id: "1", t, k, cur: "KRW", d: "Sold  Sep 28, 2026" });
    const cases = [
      // [제목, 원화, 대상, 언어, 이름표, 기대: "keep" 또는 drop 이유]
      ["ONE PIECE Heroines Edition Vol.2 EB-05 Japanese Booster Box PRE-ORDER", 345287.85, "EB-05", "jp", next, "keep"],
      ["ONE PIECE Heroines Edition Vol.2 EB-05 Japanese Booster Box PRE-ORDER", 345287.85, "EB-03", "jp", next, "code-missing"],
      ["One Piece Heroines Edition Vol.2 Booster Box Japanese", 345000, "EB-03", "jp", now, "code-missing"],
      ["One Piece Heroines Edition Vol.2 Booster Box Japanese", 345000, "EB-03", "jp", next, "code-missing"],
      ["One Piece Heroines Edition 2 Booster Box Japanese", 345000, "EB-03", "jp", next, "name-ambiguous"],
      ["One Piece Heroines Edition Booster Box Japanese Sealed", 200000, "EB-03", "jp", next, "keep"],
    ];
    for (const [t, k, code, ed, map, want] of cases) {
      const r = judgeItem(it(t, k), code, R, map, ed, "bin");
      const got = r.drop || (r.rec && r.rec.qty === 1 ? "keep" : "qty " + (r.rec && r.rec.qty));
      if (got !== want) errors.push(`Q5: ${code} "${t}" → ${got} (기대 ${want})`);
    }
    // 수집하는 세트는 이름표에도 있어야 한다 — UPCOMING 에 넣고 이름표에서 빠지면 위 사고가 되살아난다.
    const live = new Set(ingestNameMap(data).map(([, c]) => c));
    for (const u of UPCOMING) {
      if (data.sets[u.code] || String(u.nameEn || "").replace(/[^a-z0-9]/gi, "").length < 6) continue;
      if (!live.has(u.code)) errors.push(`Q5: UPCOMING ${u.code}(${u.nameEn}) 가 ingest 이름표에 없다 — 같은 시리즈 앞 권 이름에 걸려 버려지거나 섞인다`);
    }
  } catch (e) {
    errors.push(`Q5: 이름 충돌 검사 실행 실패 — ${e.message}`);
  }
}

// ── Q2. 경매 매물 분류 — "박스 통계는 무조건 부스터박스만". 팩·더블팩이 box 로 새거나
//    카톤(박스 여러개)이 box 로 잡히면 거래량 왜곡. 함정 제목으로 실제 실행해 검증.
{
  const { categorize } = require("./auction-classify");
  const cat = [
    ["One Piece OP-13 Booster Box Japanese Sealed", "box"],
    ["One Piece 3 Booster Boxes OP-08 Sealed", "box"],                 // 다수박스도 box(갯수는 qty에서)
    ["One Piece OP-05 Double Pack Set Sealed", "pack"],                // 더블팩 = 팩, box 아님
    ["One Piece OP-11 Booster Pack Japanese", "pack"],
    ["One Piece OP-07 24 Packs Sealed", "pack"],
    ["One Piece OP-01 Booster Box Carton Sealed (12 boxes)", "carton"],// 카톤 = box 아님
    ["One Piece OP-05 Sealed Case of 12 Booster Box", "carton"],       // 케이스 = carton
    ["One Piece OP-06 Full Case Booster Box English", "carton"],
    ["Monkey D Luffy OP01-120 Manga PSA 10", "card"],
    ["One Piece OP-13 Display Box Japanese", "box"],
    // 2026-09-01 실측 원장에서 샌 것들 — "Booster Box Case" 가 카톤 규칙에 없어 box 로 들어갔다.
    ["One Piece TCG OP-05 Awakening Booster Box Case SEALED ENGLISH", "carton"],
    ["One Piece A Fist Of Divine Speed Booster Box Case (12 Boxes) OP11", "carton"],
    ["2022 One Piece OP02 Paramount War JPN Booster Box Case - Factory Sealed", "carton"],
    // 반대로 케이스라는 말이 붙었어도 박스 1개인 것 — 이건 carton 으로 새면 안 된다.
    ["One Piece Premium Booster Box The Best PRB-01 Sealed English with acrylic case", "box"],
    ["One Piece TCG OP01 Romance Dawn Booster Box Sealed w/ Acrylic Case", "box"],
    ["One Piece OP-14 ENG Booster Box New Sealed (CASE FRESH)", "box"],
    // 개봉 카드뭉치는 밀봉 상품이 아니다 — box 로 잡히면 박스 낙찰가가 통째로 내려간다.
    ["Opened! One Piece Card Game OP-17 Booster Box Bulk LR And SR", "card"],
    ["One Piece, Op16 and OP13 Booster Box Bulk, Common, Uncommon, Rare", "card"],
  ];
  for (const [title, want] of cat) {
    const got = categorize(title);
    if (got !== want) errors.push(`Q2: categorize "${title}" → ${got} (기대 ${want}) — 박스 통계 오염 위험`);
  }
}

// ── Q3. TAG pop 세트명 → 박스 매핑. 오매핑되면 박스별 그레이딩 집계·고등급 확률이 통째로 틀린다.
{
  const { matchBox } = require("./tag-classify");
  const cases = [
    ["One Piece Romance Dawn Japanese Alternate Art", "OP-01", "jp"],
    ["One Piece Romance Dawn", "OP-01", "en"],
    ["One Piece Two Legends Alternate Art", "OP-08", "en"],
    ["One Piece Extra Booster Memorial Collection Japanese", "EB-01", "jp"],
    ["One Piece Extra Booster Anime 25th Collection Japanese", "EB-02", "jp"],
    ["One Piece Extra Booster Heroines Edition Alternate Art", "EB-03", "en"],
    ["One Piece Premium Booster The Best Japanese Alternate Art", "PRB-01", "jp"],
    ["One Piece Premium Booster The Best Vol. 2 Alternate Art", "PRB-02", "en"],   // Vol.2 먼저 매칭
    ["One Piece Premium Card Collection 25th Edition Japanese", null, null],       // 부스터박스 아님 → 매핑 없음
    ["One Piece 2nd Anniversary Set Japanese Alternate Art", null, null],
  ];
  for (const [name, code, ed] of cases) {
    const m = matchBox(name);
    const got = m ? `${m.code}/${m.ed}` : "null";
    const want = code ? `${code}/${ed}` : "null";
    if (got !== want) errors.push(`Q3: TAG matchBox "${name}" → ${got} (기대 ${want})`);
  }
}

// ── D7. TAG 그레이딩 주간 이력 무결성 — append-only, total>0, 0<=gem<=total.
if (exists("data/tag-grading-history.json")) {
  const tg = JSON.parse(read("data/tag-grading-history.json"));
  if (tg.grader !== "tag") errors.push("D7: tag-grading-history.grader 가 tag 가 아님");
  if (!/tag/i.test(tg.note || "") || !/append-only/i.test(tg.note || "")) errors.push("D7: note 에 tag·append-only 고지 누락");
  for (const [code, eds] of Object.entries(tg.sets || {})) {
    for (const ed of ["jp", "en"]) {
      const arr = (eds || {})[ed];
      if (!Array.isArray(arr)) continue;
      let prev = "";
      for (const p of arr) {
        if (!p || typeof p.d !== "string") { errors.push(`D7: ${code}.${ed} 날짜 없는 점`); break; }
        if (p.d <= prev) { errors.push(`D7: ${code}.${ed} 날짜 역행/중복 (${prev}→${p.d}) — append-only 위반`); break; }
        if (!(Number.isInteger(p.total) && p.total > 0)) { errors.push(`D7: ${code}.${ed} ${p.d} total 이상`); break; }
        if (!(Number.isInteger(p.gem) && p.gem >= 0 && p.gem <= p.total)) { errors.push(`D7: ${code}.${ed} ${p.d} gem 이상`); break; }
        prev = p.d;
      }
    }
  }
}

// ── D8. CGC 그레이딩 주간 이력 무결성 — 박스별 총 그레이딩수, append-only.
if (exists("data/cgc-grading-history.json")) {
  const cg = JSON.parse(read("data/cgc-grading-history.json"));
  if (cg.grader !== "cgc") errors.push("D8: cgc-grading-history.grader 가 cgc 가 아님");
  if (!/cgc/i.test(cg.note || "") || !/append-only/i.test(cg.note || "")) errors.push("D8: note 에 cgc·append-only 고지 누락");
  for (const [code, eds] of Object.entries(cg.sets || {})) {
    for (const ed of ["jp", "en"]) {
      const arr = (eds || {})[ed];
      if (!Array.isArray(arr)) continue;
      let prev = "";
      for (const p of arr) {
        if (!p || typeof p.d !== "string") { errors.push(`D8: ${code}.${ed} 날짜 없는 점`); break; }
        if (p.d <= prev) { errors.push(`D8: ${code}.${ed} 날짜 역행/중복 (${prev}→${p.d}) — append-only 위반`); break; }
        if (!(Number.isInteger(p.total) && p.total > 0)) { errors.push(`D8: ${code}.${ed} ${p.d} total 이상`); break; }
        prev = p.d;
      }
    }
  }
}

// ── D9. 카드 경매 집계(auction-card-stats) 정합성 — 파생 스냅샷이라 이상값이면 카드 페이지가 틀린다.
if (exists("data/auction-card-stats.json")) {
  const cs = JSON.parse(read("data/auction-card-stats.json"));
  if (!/per-card/i.test(cs.note || "") || !/auction-archive/i.test(cs.note || "")) errors.push("D9: note 에 파생 출처(auction-archive) 고지 누락");
  for (const [id, c] of Object.entries(cs.cards || {})) {
    if (!(Number.isInteger(c.sold) && c.sold >= 3)) { errors.push(`D9: ${id} sold(${c.sold}) 표본 기준 미달 노출`); break; }
    if (c.medPrice != null && !(c.medPrice > 0)) { errors.push(`D9: ${id} medPrice 이상 (${c.medPrice})`); break; }
    if (c.sellThrough != null && !(c.sellThrough >= 0 && c.sellThrough <= 100)) { errors.push(`D9: ${id} sellThrough 이상 (${c.sellThrough})`); break; }
    if (c.low != null && c.high != null && c.low > c.high) { errors.push(`D9: ${id} low>high`); break; }
    if (!(c.name === null || typeof c.name === "string")) { errors.push(`D9: ${id} name 이 문자열|null 아님`); break; }
  }
  // 변형(판×티어) 집계 — 2026-10-13 확장. 이름표·이상치 표식이 붙었으니 형식까지 본다.
  // suspect 가 boolean 이 아니면 화면이 "의심 아님"으로 읽어 오분류 값이 1위로 올라간다.
  // official = 반다이 공식 영문 카드리스트 이름(build-card-names.js, 2026-10-14 W7 — override 다음 순위).
  const NAME_SOURCES = new Set(["override", "official", "catalog", "title"]);
  for (const [key, v] of Object.entries(cs.variants || {})) {
    if (!(Number.isInteger(v.sold) && v.sold >= 3)) { errors.push(`D9: variant ${key} sold(${v.sold}) 표본 기준 미달 노출`); break; }
    if (!(v.medPrice > 0)) { errors.push(`D9: variant ${key} medPrice 이상 (${v.medPrice})`); break; }
    if (v.sellThrough != null && !(v.sellThrough >= 0 && v.sellThrough <= 100)) { errors.push(`D9: variant ${key} sellThrough 이상 (${v.sellThrough})`); break; }
    if (v.low != null && v.high != null && v.low > v.high) { errors.push(`D9: variant ${key} low>high`); break; }
    if (typeof v.suspect !== "boolean") { errors.push(`D9: variant ${key} suspect 가 boolean 아님`); break; }
    if (!(v.name === null || typeof v.name === "string")) { errors.push(`D9: variant ${key} name 이 문자열|null 아님`); break; }
    if (!(v.nameSource === null || NAME_SOURCES.has(v.nameSource))) { errors.push(`D9: variant ${key} nameSource 이상 (${v.nameSource})`); break; }
    if (!(Number.isInteger(v.contestedSold) && v.contestedSold >= 0 && v.contestedSold <= v.sold)) { errors.push(`D9: variant ${key} contestedSold 이상 (${v.contestedSold})`); break; }
    if (v.psa10Med != null && !(v.psa10Med > 0)) { errors.push(`D9: variant ${key} psa10Med 이상 (${v.psa10Med})`); break; }
  }
}

// ── A1. 경매 원장(일자별 아카이브) 무결성 — 여기가 깨지면 되돌릴 방법이 없다.
//    경매는 끝나면 사라지므로 소급 재수집이 불가능하다. 그래서 "이미 쌓인 날의 기록이 줄어드는 것"을
//    가장 엄하게 본다(2026-07-29 분리 시 신설). 한 파일=하루, 하루가 지나면 다시 쓰이지 않는다.
{
  const dir = "data/auction-archive";
  if (fs.existsSync(path.join(ROOT, dir))) {
    const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) errors.push("A1: 경매 아카이브가 비어 있다 — 원장 유실 의심");
    const seen = new Set();
    for (const f of files) {
      const day = f.slice(0, 10);
      let j;
      try { j = JSON.parse(read(`${dir}/${f}`)); } catch { errors.push(`A1: ${f} 파싱 실패`); continue; }
      const sales = j.sales;
      if (!Array.isArray(sales) || !sales.length) { errors.push(`A1: ${f} sales 비어 있음`); continue; }
      if (j.d !== day) errors.push(`A1: ${f} 내부 날짜(${j.d})가 파일명과 다름`);
      for (const s of sales) {
        if (!s || typeof s.id !== "string") { errors.push(`A1: ${f} id 없는 기록`); break; }
        if (s.d !== day) { errors.push(`A1: ${f} 에 다른 날짜(${s.d}) 기록 혼입`); break; }
        if (seen.has(s.id)) { errors.push(`A1: ${s.id} 가 여러 날짜 파일에 중복`); break; }
        seen.add(s.id);
        // 낙찰가는 팔린 건에만 있어야 한다. 유찰(sold=false)에 가격이 붙으면 "안 팔린 값"이 시세로 샌다.
        if (s.sold === false && s.price != null) { errors.push(`A1: ${f} 유찰 기록에 낙찰가(${s.price})`); break; }
        if (s.price != null && !(s.price > 0)) { errors.push(`A1: ${f} 가격 이상 (${s.price})`); break; }
        // 등급은 제목에서 읽은 값이라 출처를 반드시 남긴다 — 나중에 재검증할 수 있어야 한다.
        if (s.grade && s.gradeSrc !== "title") { errors.push(`A1: ${f} grade 에 출처(gradeSrc) 누락`); break; }
        if (s.ed && !["jp", "en"].includes(s.ed)) { errors.push(`A1: ${f} ed 값 이상 (${s.ed})`); break; }
        // 개인 식별 정보를 원장에 남기지 않는다(판매자는 구간만).
        if (s.seller && (s.seller.username || s.seller.u)) { errors.push(`A1: ${f} 판매자 username 저장됨 — 구간만 남길 것`); break; }
      }
    }
    // 파생 집계가 원장보다 많으면 어딘가에서 없는 거래를 만들어낸 것이다.
    // 2026-08-31 이전에는 auction-sold.json 이 최근 하루치 개별 판매를 통째로 들고 있어서
    // id 를 하나씩 대조했다. 그 창이 1.2MB 라 2시간마다 커밋될 때마다 저장소가 하루 14MB 씩
    // 불어났고, 정작 그 개별 판매를 읽는 소비자는 이 대조뿐이었다. 그래서 개별 판매는 빼고
    // "집계된 건수가 원장 건수를 넘지 않는가"만 본다 — 없는 거래를 지어내면 여기서 걸린다.
    if (exists("data/auction-sold.json")) {
      const hot = JSON.parse(read("data/auction-sold.json"));
      if (hot.sales) errors.push("A1: auction-sold.json 에 sales 가 다시 들어왔다 — 이 파일은 집계 전용이다(settle-auctions.js 주석 참고)");
      const counts = new Map();
      for (const f of files) {
        try { counts.set(f.slice(0, 10), (JSON.parse(read(`${dir}/${f}`)).sales || []).length); } catch { /* 위에서 이미 보고됨 */ }
      }
      for (const r of hot.daily || []) {
        if (!counts.has(r.d)) continue;          // 아카이브 보존 범위 밖의 옛 집계는 대조 대상이 아니다
        if (r.n > counts.get(r.d)) errors.push(`A1: ${r.d} 집계 ${r.n}건이 원장 ${counts.get(r.d)}건보다 많다`);
      }
    }
  }
}

// ── A2. 경매 시계열(auction-series.json) 축 무결성 — 2026-08-07 판본·시세·입찰 축 신설과 함께 추가.
//    이 파일은 화면이 그대로 그리는 값이라, 축이 조용히 빠지거나 합이 어긋나면 없는 사실이 그려진다.
//    특히 "표본이 얇을 때 값을 비운다"는 규칙은 지키기 쉬운 만큼 되돌리기도 쉬워서 여기에 못 박는다.
{
  const f = "data/auction-series.json";
  if (exists(f)) {
    const s = JSON.parse(read(f));
    const EDS = ["jp", "en", "other"];
    const CATS = ["box", "graded", "raw", "pack", "lot"];
    // ── 일별 금액을 **원본 아카이브와 직접 대조**한다 — 2026-08-25 신설.
    // 파생값끼리만 검사하면 생성 규칙이 통째로 틀렸을 때 전부 사이좋게 틀린다.
    // 실제로 amount 를 price × qty 로 쌓아 GMV 가 +16.9% 부풀었는데 기존 A2 는 전량 통과했다.
    // 아카이브의 낙찰·USD 행 price 합이 정답이다(price 는 묶음 총액이라 qty 를 곱하지 않는다).
    {
      const dir = path.join(ROOT, "data", "auction-archive");
      if (fs.existsSync(dir)) {
        const byDay = new Map();
        for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".json"))) {
          let sales = [];
          try { sales = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")).sales || []; } catch { continue; }
          let sum = 0;
          for (const r of sales) if (r.sold && r.currency === "USD" && r.price > 0) sum += r.price;
          byDay.set(f.slice(0, 10), sum);
        }
        let checked = 0;
        for (const r of s.daily || []) {
          const want = byDay.get(r.d);
          if (want == null) continue;
          checked += 1;
          // 반올림 여유 1달러. 그 이상 어긋나면 집계 규칙이 원본과 다르다는 뜻이다.
          if (Math.abs((r.amount || 0) - want) > 1) {
            errors.push(`A2: ${r.d} amount ${Math.round(r.amount)} ≠ 아카이브 낙찰 price 합 ${Math.round(want)}`);
          }
        }
        if (!checked) errors.push("A2: 아카이브와 대조된 날이 0일 — 금액 검증이 무력화됐다");
      }
    }
    const minN = s.minPriceSample;
    if (!(minN > 0)) errors.push("A2: minPriceSample 이 없다 — 시세 표본 하한이 사라짐");
    for (const scope of ["daily", "weekly", "monthly"]) {
      const rows = s[scope];
      if (!Array.isArray(rows) || !rows.length) { errors.push(`A2: ${scope} 비어 있음`); continue; }
      for (const r of rows) {
        // 축의 합은 언제나 전체와 같아야 한다. 어긋나면 어떤 건은 세다 말았다는 뜻이다.
        for (const [name, axis] of [["byEd", EDS], ["byCat", CATS]]) {
          if (!r[name]) { errors.push(`A2: ${scope} ${r.d} ${name} 축 누락`); continue; }
          const sum = axis.reduce((a, k) => a + ((r[name][k] || {}).ended || 0), 0);
          if (sum !== r.ended) errors.push(`A2: ${scope} ${r.d} ${name} 합계 ${sum} ≠ ended ${r.ended}`);
        }
        if (r.sold + r.unsold !== r.ended) errors.push(`A2: ${scope} ${r.d} 낙찰+유찰 ≠ 종료`);
        // 금액은 낙찰건 수를 넘는 규모가 될 수 없다 — 2026-08-25 추가.
        // 종전에 price × qty 로 쌓아 묶음(케이스 12박스)이 통째로 이중계상됐고, 전 기간 GMV 가
        // \$1,330,037 → \$1,554,258(+16.9%)로 부풀었다. price 가 이미 묶음 총액인데 qty 를 또 곱한 탓이다.
        // 아래는 그 부류를 잡는 최소 불변식: 낙찰이 0인데 금액이 있으면 어딘가에서 만들어낸 값이다.
        if (r.sold === 0 && (r.amount || 0) > 0) errors.push(`A2: ${scope} ${r.d} 낙찰 0건인데 금액 ${r.amount}`);
        // 판본 커버리지가 낮은 구간을 "집계 가능"으로 표시하면, 못 읽은 걸 다른 판으로 읽게 된다.
        if (r.edTracked && r.edCoverage < s.edMinCoverage) errors.push(`A2: ${scope} ${r.d} edCoverage ${r.edCoverage}% 인데 edTracked=true`);
        // 표본이 하한 미만인데 중앙값이 있으면, 없는 시세를 만들어낸 것이다.
        for (const k of [...CATS, "all"]) {
          const p = (r.price || {})[k];
          if (!p) { errors.push(`A2: ${scope} ${r.d} price.${k} 누락`); continue; }
          if (p.n < minN && p.med !== null) errors.push(`A2: ${scope} ${r.d} price.${k} 표본 ${p.n}건인데 중앙값(${p.med}) 노출`);
          if (p.med !== null && !(p.p25 <= p.med && p.med <= p.p75)) errors.push(`A2: ${scope} ${r.d} price.${k} 백분위 순서 뒤집힘 (${p.p25}/${p.med}/${p.p75})`);
        }
        // 입찰 평균은 낙찰건 기준이라 1 미만이 나올 수 없다(0 입찰이 섞였다는 뜻).
        for (const k of [...CATS, "all"]) {
          const b = (r.bidders || {})[k];
          if (b !== null && b !== undefined && b < 1) errors.push(`A2: ${scope} ${r.d} bidders.${k}=${b} — 유찰 혼입 의심`);
        }
      }
    }
  }
}

// ── S3. 세트 페이지 고유 해설 — 2026-08-07 애드센스 "가치가 별로 없는 콘텐츠" 거절의 재발 방지.
//    실측: 세트 페이지 21장이 문장 기준 63% 동일(숫자만 교체)이었다. 수기 해설(set-commentary.json)을
//    도입했고, 이 검사는 그 해설이 (1) 모든 세트에 있고 (2) 세트끼리 문장을 재사용하지 않고
//    (3) 실제 빌드된 페이지에 주입되어 있는지를 강제한다. 하나라도 무너지면 템플릿으로 되돌아간 것이다.
{
  const cmPath = "data/set-commentary.json";
  const packsPath = "data/onepiece-packs.json";
  if (exists(cmPath) && exists(packsPath)) {
    const cm = JSON.parse(read(cmPath));
    const packs = JSON.parse(read(packsPath));
    const order = [...(packs.jp?.list || []), ...(packs.extra?.list || [])]
      .filter((c) => (packs.sets?.[c]?.cards || []).length > 0);
    const fp = (s) => s.replace(/[^a-z0-9]/gi, "").toLowerCase();
    const seenSent = new Map();   // 정규화 문장 -> 처음 쓴 세트
    const seenDesc = new Set();
    for (const code of order) {
      const c = cm.sets?.[code];
      // 해설이 "있어야 함"은 2026-08-28 이전 발매 세트까지만 — 그날 소유자가 "보고서식 설명 문단 금지, 표만"으로 정했다.
      // 그 뒤 세트(OP-17~)에 새 문단을 요구하면 두 규칙이 부딪혀 top10 을 올릴 수 없다(2026-09-30, OP-17 이 여기서 막혔다).
      // 해설이 있는 세트는 발매일과 무관하게 아래 길이·중복·주입 검사를 전부 받는다.
      if (!c) {
        if (String(packs.sets[code].release || "") < "2026-08-28") errors.push(`S3: ${code} 수기 해설 없음 — 템플릿 문구로 노출된다`);
        continue;
      }
      const body = (c.body || []).join(" ");
      if (body.length < 350) errors.push(`S3: ${code} 해설이 ${body.length}자 — 350자 미만은 껍데기다`);
      if (!c.desc || c.desc.length < 60) errors.push(`S3: ${code} desc 부실`);
      if (seenDesc.has(c.desc)) errors.push(`S3: ${code} desc 가 다른 세트와 동일`);
      seenDesc.add(c.desc);
      for (const raw of body.split(/[.!?]/)) {
        const s = raw.trim().replace(/[0-9,.%$]+/g, "#");
        if (s.length < 45) continue;
        if (seenSent.has(s) && seenSent.get(s) !== code) {
          errors.push(`S3: ${code} 해설 문장이 ${seenSent.get(s)} 와 중복 — "${raw.trim().slice(0, 50)}…"`);
        }
        seenSent.set(s, code);
      }
      // 빌드 산출물에 주입됐는지 — 생성기가 조용히 주입을 빼먹으면 파일만 있고 화면엔 없다.
      const pagePath = `sets/${code.toLowerCase()}.html`;
      if (exists(pagePath)) {
        const html = read(pagePath);
        if (!fp(html).includes(fp((c.body || [""])[0]).slice(0, 60))) {
          errors.push(`S3: ${pagePath} 에 해설이 주입되지 않음 — 생성기 재실행 필요`);
        }
      }
    }
  }
}

// ── A3. TCG 경매 원장·집계 무결성 — 2026-08-07 수집 시작과 함께 신설.
//    원피스와 같은 사고를 그대로 반복할 자리다: 유찰에 가격이 붙거나, 같은 매물이 두 날에 세어지거나,
//    "물량"과 "거래"를 같은 방식으로 합치는 것. 셋 다 조용히 틀리고, 틀린 채로 그래프가 그려진다.
{
  const dir = "data/tcg-archive";
  if (fs.existsSync(path.join(ROOT, dir))) {
    const files = fs.readdirSync(path.join(ROOT, dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const seen = new Set();
    const byId = new Map();
    for (const f of files) {
      const day = f.slice(0, 10);
      let j;
      try { j = JSON.parse(read(`${dir}/${f}`)); } catch { errors.push(`A3: ${f} 파싱 실패`); continue; }
      for (const s of (j.sales || [])) {
        if (!s || typeof s.id !== "string") { errors.push(`A3: ${f} id 없는 기록`); break; }
        if (s.d !== day) { errors.push(`A3: ${f} 에 다른 날짜(${s.d}) 기록 혼입`); break; }
        // 같은 경매가 두 날에 세어지면 낙찰률 분모가 부풀고, 되돌릴 방법이 없다.
        if (seen.has(s.id)) { errors.push(`A3: ${s.id} 가 여러 날짜 파일에 중복`); break; }
        seen.add(s.id);
        if (!s.g) { errors.push(`A3: ${f} 게임 표시 없는 기록`); break; }
        // 검색어가 겹치면 한 매물이 두 게임에 들어간다(2026-08-07 실측: pokemon/pokemonjp).
        // 그대로 두면 두 게임의 분모가 같이 부풀어 비교가 통째로 틀어진다.
        if (byId.has(s.id) && byId.get(s.id) !== s.g) {
          errors.push(`A3: ${s.id} 가 두 게임(${byId.get(s.id)}, ${s.g})에 기록됨 — 검색어 겹침`);
          break;
        }
        byId.set(s.id, s.g);
        // 유찰에 가격이 붙으면 "안 팔린 값"이 시세로 샌다.
        if (s.sold === false && s.price != null) { errors.push(`A3: ${f} 유찰 기록에 낙찰가(${s.price})`); break; }
        if (s.sold === true && s.price != null && !(s.price > 0)) { errors.push(`A3: ${f} 가격 이상(${s.price})`); break; }
      }
    }
  }

  const sf = "data/tcg-series.json";
  if (exists(sf)) {
    const S = JSON.parse(read(sf));
    const keys = Object.keys(S.games || {});
    if (!keys.length) errors.push("A3: tcg-series 에 게임 목록이 없다");
    for (const scope of ["daily", "weekly", "monthly"]) {
      for (const r of (S[scope] || [])) {
        for (const k of keys) {
          const g = r.games[k];
          if (!g) { errors.push(`A3: ${scope} ${r.d} ${k} 누락`); continue; }
          if (g.sold > g.ended) errors.push(`A3: ${scope} ${r.d} ${k} 낙찰(${g.sold}) > 종료(${g.ended})`);
          // 표본이 얇은데 비율이 붙어 있으면, 없는 추세를 만든 것이다.
          if (g.ended < S.minRateSample && g.sellThrough !== null) {
            errors.push(`A3: ${scope} ${r.d} ${k} 표본 ${g.ended}건인데 낙찰률(${g.sellThrough}) 노출`);
          }
          // 물량은 그 순간의 사진이라 기간을 늘려도 "평균"이어야 한다. 합으로 바뀌면 주봉이 일봉의 7배가 된다.
          if (scope !== "daily" && r.days > 1 && g.live != null) {
            const dailyMax = Math.max(...(S.daily || []).filter((d) => d.games[k]?.live != null).map((d) => d.games[k].live), 0);
            if (dailyMax && g.live > dailyMax * 1.5) {
              errors.push(`A3: ${scope} ${r.d} ${k} 물량(${g.live})이 일봉 최대(${dailyMax})를 넘음 — 평균이 아니라 합으로 집계된 듯`);
            }
          }
        }
      }
    }
  }
}

// ── A5. TCG 스냅샷 시각(at)과 다른 시각 표본일(offHour) — 2026-10-13 신설.
//    감시 표본은 스냅샷 때 고른 "종료 임박 순" 경매라 낙찰률이 찍은 시각을 탄다(10/8~10/10 07:18~07:19 UTC 12.3~22.9% vs 표준일 최저 25.6%).
//    tcg-auction.html 은 offHour 날 표본을 비교값에서 뺀다. 오류로 막는 것은 series 표시가 스냅샷 at 과 표준 시각
//    (tcg-config TCG_SNAPSHOT_STD_HOURS)에서 그대로 나오지 않는 경우뿐이다 — 어긋나면 낮은 날이 조용히 비교에 다시 섞이거나
//    멀쩡한 날이 빠진다. 화면은 여기서 보지 않는다 — collect-tcg 는 series 만 굽고 페이지는 다른 워크플로가 굽는다.
//    at 이 없는 점은 경고만 한다(2026-10-13 QA): 이 가드는 collect-tcg·settle-auctions·collect-grading·collect-auction-market 에서도
//    커밋 전에 돈다. 날짜를 박아 오류로 막으면, 옛 수집기가 at 없이 커밋한 점 하나에 모든 수집·배포가 멈추고 30시간 시한을
//    넘긴 정산분이 영구 공백이 된다. at 이 없는 날은 offHour 를 표시하지 않으므로(build-tcg-series) 숫자가 틀어지지는 않는다.
{
  const { TCG_SNAPSHOT_STD_HOURS: STD } = require("./tcg-config");
  const { isoWeek } = require("./build-tcg-series");
  const AT_SINCE = "2026-10-14";   // 수집기가 at 을 쓰기 시작한 다음 날. 그 전 점은 git 이력에서 채웠다 — 이후 누락만 경고한다.
  if (exists("data/tcg-snapshot.json")) {
    const snap = JSON.parse(read("data/tcg-snapshot.json"));
    const atOf = new Map();
    for (const p of snap.points || []) {
      if (p.at == null) {
        if (p.d >= AT_SINCE) warnings.push(`A5(경고) tcg-snapshot ${p.d} 점에 at(찍은 시각) 없음 — 그날은 다른 시각 표본일을 가리지 못한다`);
        continue;
      }
      const t = Date.parse(p.at);
      const dayStart = Date.parse(`${p.d}T00:00:00Z`);
      // 그날 안이어야 한다. 자정 직전에 시작한 실행이 넘어가는 몫으로 1시간만 더 준다.
      if (!Number.isFinite(t) || t < dayStart || t >= dayStart + 25 * 3600 * 1000) {
        errors.push(`A5: tcg-snapshot ${p.d} at(${p.at}) 이 그날 시각이 아님`);
        continue;
      }
      atOf.set(p.d, t);
    }
    if (exists("data/tcg-series.json")) {
      const S = JSON.parse(read("data/tcg-series.json"));
      const off = [];
      for (const r of S.daily || []) {
        const t = atOf.get(r.d);
        const h = t == null ? null : new Date(t).getUTCHours();
        const want = h != null && (h < STD.from || h >= STD.to);   // at 이 없는 날은 표시하지 않는다
        if ("offHour" in r && r.offHour !== true) errors.push(`A5: tcg-series daily ${r.d} offHour=${JSON.stringify(r.offHour)} — 표준 시각 날은 필드를 두지 않는다`);
        if ((r.offHour === true) !== want) {
          errors.push(`A5: tcg-series daily ${r.d} offHour=${r.offHour === true} 인데 스냅샷 시각 ${t == null ? "없음" : new Date(t).toISOString().slice(11, 16) + " UTC"} → ${want} — build-tcg-series 재실행 필요`);
        }
        if (r.offHour === true) off.push(r.d);
      }
      // 주·월 offHourDays = 그 기간의 daily offHour 일수(합계 필드는 그대로 — 표시만 더한다)
      for (const [scope, keyOf] of [["weekly", isoWeek], ["monthly", (d) => `${d.slice(0, 7)}-01`]]) {
        for (const r of S[scope] || []) {
          const n = off.filter((d) => keyOf(d) === r.d).length;
          // 필드가 없는 옛 series(표시가 하나도 없던 때)는 0 으로 본다 — 표시할 날이 생겼는데 0 이면 그때 걸린다.
          if ((r.offHourDays ?? 0) !== n) errors.push(`A5: tcg-series ${scope} ${r.d} offHourDays=${r.offHourDays} ≠ daily 표시 ${n}일`);
        }
      }
    }
  }
}

// ── Q4. 그레이더 카드매칭 변형(tier) 규칙 — "카드번호만 보고 매칭" 사고(유유테이/eBay top10) 재발 금지.
//    CGC/TAG 실측 라벨 코퍼스로 ourTier/cgcTier/tagTier 를 실제 실행해 검증. 번호+변형 둘 다 맞아야 기록된다.
{
  const { ourTier, cgcTier } = require("./cgc-card-pop-ingest");
  const { tagTier } = require("./tag-card-pop-ingest");
  const cases = [
    [() => ourTier("Monkey D. Luffy 118 Red Manga Alternate Art"), "red"],
    [() => ourTier("Monkey D. Luffy 118 Super Alternate Art"), "super"],
    [() => ourTier("Kuzan Manga"), "super"],
    [() => ourTier("Shanks OP09-004 Gold Parallel"), "gold"],
    [() => ourTier("Boa Hancock SP"), "sp"],
    [() => cgcTier("Monkey D. Luffy (2025) Red Manga Alt. Art SEC"), "red"],
    [() => cgcTier("Monkey D. Luffy (2025) Manga Alt. Art Parallel SEC"), "super"],
    [() => cgcTier("Roronoa Zoro (2022) (Map Text Box) Alt. Art L"), "alt"],          // 마침표 "Alt. Art" 실측
    [() => cgcTier("Boa Hancock (2025) Foil Parallel L"), "sp"],                      // EB SP = Foil Parallel 실측
    [() => cgcTier("Shanks (2025) SP Ver. (SP next to number) Silver SR"), "silver"],
    [() => tagTier("One Piece Carrying On His Will Japanese Manga Alternate Art"), "super"],
    [() => tagTier("One Piece Carrying On His Will Japanese Red Manga Alternate Art"), "red"],
    [() => tagTier("One Piece Romance Dawn Japanese Special Alternate Art"), "sp"],   // TAG SP 표기 실측
    [() => tagTier("One Piece Romance Dawn Japanese Alternate Art"), "alt"],
    [() => tagTier("One Piece Carrying On His Will Japanese"), "base"],
    [() => ourTier("Boa Hancock Box Topper"), "boxtopper"],                        // base 오염 사고(2026-07-24) 재발 방지
    [() => ourTier("Silvers Rayleigh Parallel Manga"), "super"],                   // 캐릭터명 'Silvers'≠silver 변형
    [() => ourTier("Marshall D. Teach SP Silver"), "silver"],                      // 진짜 silver 는 여전히 silver
  ];
  for (const [fn, want] of cases) {
    let got; try { got = fn(); } catch (e) { got = "ERR:" + e.message; }
    if (got !== want) errors.push(`Q4: tier 매칭 회귀 — ${fn.toString().slice(10, 80)} → ${got} (기대 ${want})`);
  }
}

// ── D11. TAG 카드별 등급분포 이력 무결성 — top10 카드 매칭본, append-only (D10 과 동형).
if (exists("data/tag-card-pop.json")) {
  const tp = JSON.parse(read("data/tag-card-pop.json"));
  if (tp.grader !== "tag") errors.push("D11: tag-card-pop.grader 가 tag 가 아님");
  if (!/append-only/i.test(tp.note || "")) errors.push("D11: note 에 append-only 고지 누락");
  // 2026-08-25 부터 판별로 나뉜다: sets[코드][jp|en][카드키]. 그 전 파일은 sets[코드][카드키] 였고
  // 이관이 .jp 로 옮긴다. 둘 다 검사한다 — 옛 파일이 남아 있어도 조용히 넘어가지 않게(D10 과 동형).
  const walkTag = (code, label, cards) => {
    for (const [key, arr] of Object.entries(cards || {})) {
      if (!Array.isArray(arr)) { errors.push(`D11: ${code}${label} ${key} 점 목록이 배열이 아님`); continue; }
      let prev = "";
      for (const p of arr) {
        if (!p || typeof p.d !== "string" || p.d <= prev) { errors.push(`D11: ${code}${label} ${key} 날짜 이상/역행`); break; }
        if (!(Number.isInteger(p.total) && p.total > 0)) { errors.push(`D11: ${code}${label} ${key} ${p.d} total 이상`); break; }
        const sum = Object.values(p.g || {}).reduce((a, v) => a + (Number(v) || 0), 0);
        if (sum > p.total) { errors.push(`D11: ${code}${label} ${key} ${p.d} 등급합(${sum})>total(${p.total})`); break; }
        prev = p.d;
      }
    }
  };
  for (const [code, bucket] of Object.entries(tp.sets || {})) {
    const eds = Object.keys(bucket || {}).filter((k) => k === "jp" || k === "en");
    if (eds.length) for (const ed of eds) walkTag(code, `.${ed}`, bucket[ed]);
    else walkTag(code, "", bucket);
  }
}

// ── D10. CGC 카드별 등급분포 이력 무결성 — top10 카드 매칭본, append-only.
if (exists("data/cgc-card-pop.json")) {
  const cp = JSON.parse(read("data/cgc-card-pop.json"));
  if (cp.grader !== "cgc") errors.push("D10: cgc-card-pop.grader 가 cgc 가 아님");
  if (!/append-only/i.test(cp.note || "")) errors.push("D10: note 에 append-only 고지 누락");
  // 2026-08-03 부터 판별로 나뉜다: sets[코드][jp|en][카드키]. 그 전 파일은 sets[코드][카드키] 였고
  // 이관 스크립트가 .jp 로 옮긴다. 둘 다 검사한다 — 옛 파일이 남아 있어도 조용히 넘어가지 않게.
  const walk = (code, label, cards) => {
    for (const [key, arr] of Object.entries(cards || {})) {
      if (!Array.isArray(arr)) { errors.push(`D10: ${code}${label} ${key} 점 목록이 배열이 아님`); continue; }
      let prev = "";
      for (const p of arr) {
        if (!p || typeof p.d !== "string" || p.d <= prev) { errors.push(`D10: ${code}${label} ${key} 날짜 이상/역행`); break; }
        if (!(Number.isInteger(p.total) && p.total > 0)) { errors.push(`D10: ${code}${label} ${key} ${p.d} total 이상`); break; }
        const sum = Object.values(p.g || {}).reduce((a, v) => a + (Number(v) || 0), 0);
        if (sum > p.total) { errors.push(`D10: ${code}${label} ${key} ${p.d} 등급합(${sum})>total(${p.total})`); break; }
        prev = p.d;
      }
    }
  };
  for (const [code, bucket] of Object.entries(cp.sets || {})) {
    const eds = Object.keys(bucket || {}).filter((k) => k === "jp" || k === "en");
    if (eds.length) for (const ed of eds) walk(code, `.${ed}`, bucket[ed]);
    else walk(code, "", bucket);
  }
}

// ── D6. 박스 SOLD 원장(ledger) 무결성 — 판매 1건=1레코드, append-only 저장소.
//    id 중복(이중 계상), 단가/수량 이상, 날짜 형식 오류가 들어오면 주간 집계 전체가 오염된다.
if (exists("data/box-sold-ledger.json")) {
  const lg = JSON.parse(read("data/box-sold-ledger.json"));
  if (!/append-only|never modified/i.test(lg.note || "")) errors.push("D6: ledger note 에 append-only 고지 누락");
  // 유일성 키는 **id + 판매일**이다 — 2026-08-25.
  // eBay 의 sold 검색은 매물 하나를 한 줄로 보여주고 날짜는 최근 판매일만 싣는다.
  // 재고가 여럿인 매물은 같은 id 로 여러 번 팔리므로 id 만으로 유일성을 요구하면
  // 진짜 판매를 중복으로 오인해 버리게 된다(실측: 그렇게 193건을 놓치고 있었다).
  // 같은 id + 같은 날은 여전히 중복이다 — 그건 한 건이다.
  const ids = new Set();
  for (const [code, eds] of Object.entries(lg.sets || {})) {
    for (const ed of ["jp", "en"]) {
      for (const r of (eds || {})[ed] || []) {
        const uniqKey = `${r.id}|${r.d}`;
        if (!r.id || ids.has(uniqKey)) { errors.push(`D6: ${code}.${ed} id+판매일 누락/중복 (${r.id} ${r.d})`); break; }
        ids.add(uniqKey);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.d || "")) { errors.push(`D6: ${code}.${ed} ${r.id} 날짜 형식 이상 (${r.d})`); break; }
        // 상한 8000: OP-01 영문 Blue Bottom(초판)은 실제로 $4~6천대에서 팔린다. 5000 이던 상한은
        // 2026-08-17 환율 보정(tools/restore-box-fx.js) 후 실거래 1건($5,205)을 튕겨냈다 — 데이터가
        // 이상한 게 아니라 상한이 이 세트의 현실을 몰랐던 것이라 올린다. box-sold-ingest.js 와 같은 값.
        if (!(Number.isFinite(r.unit) && r.unit > 0 && r.unit <= 8000)) { errors.push(`D6: ${code}.${ed} ${r.id} unit 이상 (${r.unit})`); break; }
        if (!(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= 24)) { errors.push(`D6: ${code}.${ed} ${r.id} qty 이상 (${r.qty})`); break; }
      }
    }
  }
}

// ── D15. 박스 SOLD 원장의 판매일은 eBay 표시일 기준(dateBasis) — 2026-10-01 신설.
//    box-sold-ingest.soldDateOf 가 2026-07-22 신설 때부터 Date.parse(KST 로컬 자정)→toISOString 으로 하루 이른 날짜를
//    적었다(9/30 덤프 255,760건 전부 -1일, 같은 날 0건). 원장 5,890행 + excluded 145행을 +1일 이관하고
//    (tools/migrate-box-sold-dates-20261001.js) 파서를 표시일 그대로 쓰게 고쳤다. 둘은 한 몸이다 — 중복 키가
//    id|판매일이라 이관 안 된 원장에 새 파서가 돌면 지난 90일 판매가 전부 새 키로 다시 들어온다(이중 적재).
//    이관 전 원장(마커 없음)으로 되돌아가면 여기서 막는다. 파서 쪽은 Q1 이 soldDateOf 값을 단언한다.
//    판매일이 수집일(seen·updated)보다 늦을 수는 없다 — 두 번 이관(+2일)되면 여기서 걸린다.
if (exists("data/box-sold-ledger.json")) {
  const lg = JSON.parse(read("data/box-sold-ledger.json"));
  if (lg.dateBasis !== "ebay-display-date") errors.push(`D15: box-sold-ledger.json dateBasis 가 "ebay-display-date" 가 아니다 (${JSON.stringify(lg.dateBasis)}) — 이관 전 원장. node tools/migrate-box-sold-dates-20261001.js`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(lg.migratedAt || "")) errors.push(`D15: box-sold-ledger.json migratedAt 누락 (${JSON.stringify(lg.migratedAt)})`);
  for (const [code, eds] of Object.entries(lg.sets || {})) {
    for (const ed of ["jp", "en"]) {
      const late = ((eds || {})[ed] || []).find((r) => r.d > (r.seen || lg.updated || "9999-99-99"));
      if (late) { errors.push(`D15: ${code}.${ed} ${late.id} 판매일 ${late.d} 이 수집일 ${late.seen || lg.updated} 보다 늦다 — 날짜가 두 번 이관됐나`); break; }
    }
  }
}

// ── D2. (철회) 마켓 인덱스/개봉 미터는 2026-07-29 제거됐다.
//    지수 입력이던 외부 주간시세가 7/13 에 끊겨 홈에 "매일 갱신 157.4"가 2주간 박혀 있었고,
//    소유자 판단으로 위젯·market.html·나브를 전부 내렸다. 대신 등급(PSA/CGC/TAG) 데이터에 집중한다.
//    우리 자체 eBay 시계열(boxSeriesEbay / boxSeriesEnEbay)은 계속 쌓이며, 9월에 일판/영문판
//    두 지수로 다시 세울 예정이다(기준일은 중국셀러 정리 이후인 2026-07-17 이후로 잡을 것).
// ── S1. 외부 소스명 공개 금지 (영구 규칙)
// data/card-series.json — 2026-10-14 packs.json 에서 떼어낸 카드별 이력(공개 data/). 떼어내도 검사 범위는 그대로.
for (const f of [...PUBLIC_HTML, "packs.js", "data/onepiece-packs.json", "data/card-series.json", "opbox-ai-data.json", "llms.txt", "feed.xml"]) {
  if (!exists(f)) continue;
  if (/collectr/i.test(read(f))) errors.push(`S1: ${f} 에 외부 소스명 노출 (Weekly ungraded market 라벨 사용)`);
}

// ── S2. AI/검색 접근성 보호 — 구글·Bing·AI 답변엔진 접근을 실수로 막으면 배포 차단
{
  const robots = read("robots.txt");
  // 전면 차단(Disallow: /) 금지 — 어떤 그룹에서든
  const groups = robots.split(/\n\s*\n/);
  for (const g of groups) {
    const ua = (g.match(/User-agent:\s*(\S+)/) || [])[1];
    if (!ua) continue;
    if (/^Disallow:\s*\/\s*$/m.test(g) && !["GPTBot", "ClaudeBot", "anthropic-ai", "CCBot", "Bytespider", "Applebot-Extended", "Amazonbot"].includes(ua))
      errors.push(`S2: robots.txt에서 ${ua} 전면 차단됨 — 훈련 전용 봇 외에는 금지`);
  }
  // AI 답변/검색 봇 허용 그룹이 반드시 존재해야 함
  for (const bot of ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Claude-User", "Claude-SearchBot", "Google-Extended", "Bingbot", "Googlebot"]) {
    if (!new RegExp(`User-agent:\\s*${bot}`).test(robots)) errors.push(`S2: robots.txt에 ${bot} 그룹이 사라짐 (AI/검색 접근성)`);
  }
  if (!robots.includes("Sitemap: https://opboxindex.com/sitemap.xml")) errors.push("S2: robots.txt에 Sitemap 선언 누락");
  // S2b. 답변/검색 AI가 llms.txt에서 안내하는 데이터 경로(/data/, CSV)에 접근 가능해야 함.
  // robots.txt는 전용 그룹이 있으면 * 를 무시하므로, 각 봇 그룹 자체에 /data/ 차단이 없어야 한다.
  {
    const noComment = robots.replace(/^\s*#.*$/gm, "");
    const ANSWER_BOTS = ["OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User", "Claude-User", "Claude-SearchBot", "GrokBot", "xAI-Crawler", "Google-Extended", "Googlebot", "Bingbot", "Yeti"];
    const blocks = noComment.split(/\n\s*\n/);
    for (const bot of ANSWER_BOTS) {
      const blk = blocks.find((b) => new RegExp(`User-agent:\\s*${bot}\\s*$`, "m").test(b));
      if (!blk) { errors.push(`S2: robots.txt에 ${bot} 전용 그룹 없음 — * 상속으로 /data/ 가 막힘`); continue; }
      const dis = [...blk.matchAll(/Disallow:\s*(\S+)/g)].map((m) => m[1]);
      if (dis.some((d) => d === "/" || d.startsWith("/data"))) errors.push(`S2: ${bot} 가 /data/ 차단됨 — llms.txt가 안내하는 데이터 경로는 열려 있어야 함`);
    }
  }
  // 주요 페이지에 noindex가 끼어들면 안 됨
  for (const f of ["index.html", "sets/op-16.html", "cards/index.html", "articles/index.html"]) {
    if (/<meta[^>]+robots[^>]+noindex/i.test(read(f))) errors.push(`S2: ${f} 에 noindex — 검색/AI 노출 차단됨`);
  }
}

// ── F1. 삭제 금지 파일 존재 확인
for (const f of ["googlee0d71bc0695b5651.html", "google1d76c313bd3d0b59.html", "naver933afc5e4330d8e58701ba45b0319b4a.html", "3d439f302e46fc08f76ddba4eee3726f.txt", "ads.txt", "robots.txt", "sitemap.xml", "llms.txt", "opbox-ai-data.json", "data/set-facts.json"]) {
  if (!exists(f)) errors.push(`F1: 필수 파일 삭제됨: ${f}`);
}

// ── H2. 홈 요약표 = board — 2026-09-24 신설.
//    정적 요약표(inject-home-summary)와 티커(marketIndex.board, 클라이언트 렌더)는 같은 숫자를 보여야 한다.
//    2026-09-23 감사: 주간 워크플로가 build-market-index 만 돌리고 inject-home-summary 를 안 돌려
//    같은 화면에 OP-15 $107(표) / $100(티커) 이 동시에 떴다. 표 안의 모든 $값이 board.nowUsd 와 같아야 한다.
if (exists("index.html") && exists("data/onepiece-packs.json")) {
  const html = read("index.html");
  const m = html.match(/<!-- HOME_SUMMARY:START -->([\s\S]*?)<!-- HOME_SUMMARY:END -->/);
  const board = (JSON.parse(read("data/onepiece-packs.json")).marketIndex || {}).board || [];
  if (m && board.length) {
    const byCode = {}; for (const b of board) byCode[b.code] = b;
    const rowRe = /<tr[^>]*><td(?: class="code")?><a href="sets\/([a-z0-9-]+)\.html">([A-Z0-9-]+)<\/a><\/td><td(?: class="name")?>[\s\S]*?<td class="num">\$?([\d,]+|—)<\/td>/g;
    let seen = 0, drift = [];
    for (const r of m[1].matchAll(rowRe)) {
      const code = r[2], shown = r[3] === "—" ? null : Number(r[3].replace(/,/g, ""));
      const b = byCode[code]; if (!b) continue;
      seen++;
      const want = b.nowUsd == null ? null : Math.round(b.nowUsd);
      if (shown !== want) drift.push(`${code} 표 ${shown} ≠ board ${want}`);
    }
    if (!seen) errors.push("H2: 홈 요약표에서 세트 행을 하나도 못 읽음 — 행 템플릿이 바뀌었으면 가드도 맞출 것");
    if (drift.length) errors.push(`H2: 홈 요약표와 board 불일치 ${drift.length}건 — node tools/inject-home-summary.js 다시 실행: ${drift.slice(0, 4).join(" · ")}`);
  }
}

// ── H1. hreflang 정합성 — 2026-07-19 사고: 홈이 "한국어판=/?hl=ko"로 선언해
//    파라미터 변형(packs.html?hl=)을 우리가 정당화 → 홈 노출이 변형들로 갈라짐.
//    규칙: (a)hreflang 타겟에 ?hl= 파라미터 금지 (b)타겟은 실재 파일 (c)ko↔en 상호확인.
{
  const hrefOf = (html) => [...html.matchAll(/<link rel="alternate" hreflang="([a-z-]+)" href="([^"]+)"/g)].map((m) => ({ lang: m[1], url: m[2] }));
  const toRel = (u) => {
    let p;
    try { p = new URL(u).pathname; } catch { return null; }
    return p === "/" ? "index.html" : decodeURIComponent(p.slice(1)) + (p.endsWith("/") ? "index.html" : "");
  };
  const declared = new Map(); // rel파일 -> {lang:url}
  // canonical이 자기 자신이 아닌 페이지(예: 홈 별칭 packs.html)는 언어신호를 canonical 대상이 대표하므로 제외
  const selfCanonical = (f, html) => {
    const m = html.match(/rel="canonical" href="([^"]+)"/);
    if (!m) return true;
    const rel = toRel(m[1]);
    return rel === f || rel === null;
  };
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    if (!selfCanonical(f, html)) continue;
    const list = hrefOf(html);
    if (!list.length) continue;
    const map = {};
    for (const { lang, url } of list) {
      if (/[?&]hl=/.test(url)) errors.push(`H1: ${f} hreflang ${lang} 이 파라미터 변형을 가리킴 (${url}) — 실 디렉터리 URL만 허용`);
      const rel = toRel(url);
      if (rel && !exists(rel)) errors.push(`H1: ${f} hreflang ${lang} 타겟 파일 없음 (${url})`);
      map[lang] = url;
    }
    declared.set(f, map);
  }
  // 상호확인: A가 B를 ko/en으로 지목하면 B도 A를 되가리켜야 구글이 인정.
  // ※ 2026-07-21 사각지대 수정: 상대가 hreflang 을 "아예 선언 안 한" 경우도 실패다.
  //    과거엔 !declared.has(rel) 로 skip 해서, ko 세트페이지가 en 을 가리키는데 en 쪽이 침묵하는
  //    단방향(=구글이 무시)을 놓쳤다. 우리가 관리하는 페이지(PUBLIC_HTML)면 되가림 부재를 잡는다.
  for (const [f, map] of declared) {
    for (const [lang, url] of Object.entries(map)) {
      if (lang === "x-default") continue;
      const rel = toRel(url);
      if (!rel || rel === f) continue;            // 자기참조는 대상 아님
      if (!PUBLIC_HTML.includes(rel)) continue;   // 우리가 관리하지 않는 외부/미존재 페이지는 대상 아님
      const back = declared.get(rel);             // undefined = 상대가 hreflang 미선언
      const pointsBack = back && Object.values(back).some((u) => toRel(u) === f);
      if (!pointsBack) errors.push(`H1: ${f} → ${rel} (${lang}) 단방향 hreflang — 상대가 되가리키지 않음(미선언 포함)`);
    }
  }
}

// ── H3. 런타임 SEO 재작성 금지 — 2026-09-29 발견: H1 은 정적 HTML 만 봐서 통과했지만 packs.js 가 렌더 뒤
//    (a) hreflang 을 지우고 ko=/?hl=ko 로 다시 만들어 7/19 수정을 되돌렸고,
//    (b) ?set= 로 들어오면 canonical 을 packs.html?set=…(noindex) 로 바꿔 썼다.
//    세트 페이지 44곳의 주 CTA 가 /?set=CODE 라 색인 불가 URL 88개가 생겼다(7월 홈 증발 사고와 같은 중복 클러스터).
//    구글은 JS 렌더 뒤의 canonical·hreflang 을 읽으므로 정적 HTML 만 검사해서는 못 잡는다.
{
  const js = read("packs.js");
  const code = js.replace(/\/\/[^\n]*/g, ""); // 주석 속 설명 문구는 검사하지 않는다
  if (/canonical\.href\s*=\s*[`'"][^`'"]*packs\.html\?/.test(code) || /canonical\.href\s*=\s*`\$\{SITE_BASE\}\/packs\.html/.test(code))
    errors.push("H3: packs.js 가 canonical 을 packs.html?… (noindex) 로 재작성한다 — 정적 canonical 을 그대로 둬야 함");
  if (/hreflang[\s\S]{0,400}\?hl=/.test(code) && /createElement\(\s*["']link["']\s*\)[\s\S]{0,300}hreflang/.test(code))
    errors.push("H3: packs.js 가 hreflang 을 ?hl= 파라미터 URL 로 만들어 넣는다 — 정적 hreflang(/ko/) 을 덮어씀");
  if (/querySelectorAll\(\s*['"]link\[rel="alternate"\]\[hreflang\]['"]\s*\)\s*\.forEach\([\s\S]{0,60}?remove\(\)/.test(code))
    errors.push("H3: packs.js 가 정적 hreflang 태그를 지운다 — 렌더 뒤 hreflang 이 정적 HTML 과 달라짐");
}

// ── U1. 글의 수정일 ≥ 본문에 적힌 "As of" 날짜 — 2026-09-30 발견: best-one-piece-booster-box 의 표는
//    inject-set-comparison 이 매일 "As of 2026-09-28" 로 다시 쓰는데 JSON-LD dateModified·화면 Updated 는
//    2026-08-10 에 멈춰 있었다. 구글은 수정일로 신선도를 읽는다. 과거 시점 문장("As of July 14, 2026")은
//    수정일보다 이르므로 걸리지 않는다 — 본문이 수정일보다 새로울 때만 실패.
{
  const MON = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };
  const pad = (n) => String(n).padStart(2, "0");
  const files = ["compare.html", ...fs.readdirSync(path.join(ROOT, "articles")).filter((f) => f.endsWith(".html")).map((f) => "articles/" + f)];
  for (const f of files) {
    const html = read(f);
    const dm = (html.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!dm) continue;
    const body = html.replace(/<script[\s\S]*?<\/script>/g, " ");
    let latest = "";
    for (const m of body.matchAll(/\bas of (\d{4}-\d{2}-\d{2})/gi)) if (m[1] > latest) latest = m[1];
    for (const m of body.matchAll(/\bas of ([A-Z][a-z]+) (\d{1,2}), (\d{4})/gi)) {
      const mo = MON[m[1].toLowerCase()];
      if (mo) { const d = `${m[3]}-${pad(mo)}-${pad(m[2])}`; if (d > latest) latest = d; }
    }
    if (latest && latest > dm) errors.push(`U1: ${f} 본문은 "as of ${latest}" 인데 dateModified 가 ${dm} — 주입기가 수정일·Updated 도 같이 갱신해야 함`);
  }
}

// ── C4. 카드 페이지 PSA 인구 = 변형 정확 매칭 원천(graderPop.psa.jp.total) — 2026-09-29 발견:
//    generate-card-pages.js 가 세트 psa 표에서 "번호 부분일치 + 이름 앞 10자"로 첫 행을 집어 rarity 를 무시했다.
//    인구를 보여 주던 88장이 전부 틀렸고(OP13-118 Super AA·Red Manga 둘 다 4,349, 실제 2,574·744) 24장은 비어 있었다.
//    세트 페이지는 같은 카드를 맞게 보여 줘서 두 페이지가 서로 다른 숫자를 냈다.
{
  const slugifyC4 = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  const setsC4 = data.sets || data;
  let bad = 0;
  for (const code of Object.keys(setsC4)) {
    for (const c of setsC4[code].cards || []) {
      const f = `cards/${slugifyC4(c.number + "-" + c.name)}.html`;
      if (!exists(f)) continue;
      const shown = (read(f).match(/PSA population<\/span><b>([^<]+)<\/b>/) || [])[1];
      const src = c.graderPop && c.graderPop.psa && c.graderPop.psa.jp && c.graderPop.psa.jp.total;
      if (src && shown && shown.trim() !== Number(src).toLocaleString("en-US")) {
        if (bad++ < 5) errors.push(`C4: ${f} PSA 인구 표시 ${shown.trim()} ≠ 원천 ${Number(src).toLocaleString("en-US")} (변형 오매칭)`);
      } else if (src && !shown) {
        if (bad++ < 5) errors.push(`C4: ${f} PSA 인구 원천(${src})이 있는데 표시 안 됨`);
      } else if (!src && shown) {
        if (bad++ < 5) errors.push(`C4: ${f} 원천 없는 PSA 인구 ${shown.trim()} 표시`);
      }
    }
  }
  if (bad > 5) errors.push(`C4: 그 밖에 ${bad - 5}장 더 불일치`);
}

// ── L1. 구조화 데이터(JSON-LD) 파싱 유효성 — 깨진 스키마는 리치결과·AI 인용에서 통째로 무시됨
for (const f of PUBLIC_HTML) {
  for (const m of read(f).matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); } catch (e) { errors.push(`L1: ${f} JSON-LD 파싱 실패 (${e.message.slice(0, 60)})`); }
  }
}

// ── L2. 숨긴 FAQ 금지 — FAQPage 구조화데이터의 질문은 본문(스크립트 제외)에도 보여야 한다.
//    구글은 본문에 없는 FAQPage 를 스팸으로 취급하고(FAQ 리치결과는 2023년 폐지, 이득 0), 애드센스에도 악재.
//    2026-07-21 감사: 세트 23페이지가 JSON-LD 에만 FAQ 를 담아 화면엔 안 보이던 상태.
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const m of html.matchAll(/"@type"\s*:\s*"FAQPage"[\s\S]*?<\/script>/g)) {
    for (const qm of m[0].matchAll(/"@type"\s*:\s*"Question"\s*,\s*"name"\s*:\s*"((?:[^"\\]|\\.)*)"/g)) {
      const q = qm[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
      const probe = q.slice(0, 40);   // 앞 40자만 대조(HTML 이스케이프 차이 회피)
      if (probe && !visible.includes(probe)) { errors.push(`L2: ${f} FAQPage 질문이 본문에 없음(숨긴 FAQ): "${probe}…"`); break; }
    }
  }
}

// ── L3. 세트 페이지는 FAQPage 스키마가 있어야 한다 — audit-seo.js:80 과 동일 규칙을 가드에도.
//    2026-07-22 사고: 숨긴 FAQ 정리 때 eb-05·op-17 의 FAQPage 를 지웠는데, 로컬 guard 는 통과하고
//    CI 의 audit-seo 만 실패해 야간 워크플로가 이틀 죽어 있었다. guard 가 CI 검사의 부분집합이면 안 된다.
//    2026-10-14(W7): 세트별 공식 카드리스트(sets/*-card-list.html)는 새 FAQ 금지 규칙이라 FAQ 대신
//    CollectionPage + ItemList + BreadcrumbList 를 요구한다(audit-seo 와 같은 규칙, 행 대조는 CL1).
for (const f of PUBLIC_HTML) {
  if (!f.startsWith("sets/") || f === "sets/index.html") continue;
  const html = read(f);
  if (/-card-list\.html$/.test(f)) {
    for (const t of ["CollectionPage", "ItemList", "BreadcrumbList"]) {
      if (!new RegExp(`"@type"\\s*:\\s*"${t}"`).test(html)) errors.push(`L3: ${f} 에 ${t} 스키마 없음 (카드리스트 페이지 필수 — audit-seo 도 동일 검사)`);
    }
    continue;
  }
  if (!/"@type"\s*:\s*"FAQPage"/i.test(html)) errors.push(`L3: ${f} 에 FAQPage 스키마 없음 (세트 페이지 필수 — audit-seo 도 동일 검사)`);
}

// ── I1. 이미지 외부 핫링크 금지 — 2026-07-19: 카드 이미지 48건이 외부 CDN 직링크라
//    이미지검색 유입을 남에게 주고, CDN이 끊기면 페이지가 통째로 깨짐. 자체 호스팅만 허용.
for (const f of PUBLIC_HTML) {
  for (const m of read(f).matchAll(/<img[^>]+src="(https?:\/\/[^"]+)"/g)) {
    if (!/^https?:\/\/opboxindex\.com\//.test(m[1])) errors.push(`I1: ${f} 외부 이미지 핫링크 (${m[1].slice(0, 60)}) — /img/ 또는 /card-img/ 로 자체 호스팅할 것`);
  }
}

// ── R1. 홈 정적 렌더 보장 — 2026-07-19: 홈 시세표가 JS 전용이라 JS 미실행 크롤러/AI가
//    가격을 못 읽었음. 홈은 색인된 핵심 자산이므로 JS 없이도 최소 본문·가격이 있어야 함.
//
//    하한을 4,000 → 5,800 자로 올림(2026-08-28). 그날 "표만" 정리로 홈 본문이
//    7,861 → 4,425 자(-44%)로 줄었는데 4,000 하한을 아슬아슬하게 통과해 그대로 배포됐고,
//    구글이 홈 노출 급감을 경고했다. 하한이 실제 수준보다 낮으면 가드가 아니라 통과 도장이다.
//    ⚠️ 이 값을 낮추려는 변경은 곧 "검색이 읽을 글을 지우는 변경"이다. 낮추지 말 것.
//    화면을 짧게 하고 싶으면 글을 지우지 말고 <details> 로 접어라 — 구글은 접힌 것도 읽는다.
const HOME_MIN_TEXT = 5800;
for (const f of ["index.html", "packs.html"]) {
  if (!exists(f)) continue;
  const body = read(f).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const prices = (text.match(/\$[0-9][0-9,]{2,}/g) || []).length;
  if (text.length < HOME_MIN_TEXT) errors.push(`R1: ${f} JS 없는 본문이 ${text.length}자 — 정적 콘텐츠 부족(${HOME_MIN_TEXT}자 이상 필요). 화면을 줄이려면 글을 지우지 말고 <details> 로 접을 것`);
  if (prices < 8) errors.push(`R1: ${f} JS 없는 본문의 가격 표기가 ${prices}개 — 정적 시세표 누락 의심(8개 이상 필요)`);
}

// ── T1. 데이터 신선도 — 야간 파이프라인이 조용히 죽으면 구데이터가 계속 서빙됨
{
  const upd = data.updated;
  if (!upd) errors.push("T1: data.updated 없음");
  else {
    const days = Math.round((Date.now() - new Date(upd + "T00:00:00Z").getTime()) / 86400000);
    if (days > 4) errors.push(`T1: 데이터가 ${days}일 경과 (${upd}) — 야간 파이프라인 점검 필요`);
  }
}

// ── P1. 공급 시계열 무결성 — 'gone(사라진 매물)'을 판매(sold)로 표기하면 허위 데이터가 된다.
//    eBay Browse API로는 판매/취소/만료 구분이 불가능하므로 라벨은 영구히 "delisted or sold".
{
  if (exists("data/supply-series.json")) {
    const sp = JSON.parse(read("data/supply-series.json"));
    const days = Math.round((Date.now() - new Date((sp.updated || "1970-01-01") + "T00:00:00Z").getTime()) / 86400000);
    if (days > 4) errors.push(`P1: 공급 시계열이 ${days}일 경과 (${sp.updated}) — update-supply-series.js 점검`);
    // 순서 무관하게 "판매인지 내림인지 구분 불가"라는 고지가 남아 있는지 확인
    const note = sp.note || "";
    if (!(/delisted/i.test(note) && /\bsold\b/i.test(note) && /cannot distinguish|not.*a sale|never.*sale/i.test(note)))
      errors.push("P1: supply-series.note 에 '판매/내림 구분 불가' 고지 누락 — gone을 판매로 오해시킬 수 있음");
    const codes = Object.keys(sp.sets || {});
    if (codes.length < 15) errors.push(`P1: 공급 시계열 세트 부족 (${codes.length})`);
  }
  // 공개 산출물에서 gone을 sold로 표기하지 않았는지 확인(라벨 오염 차단)
  for (const f of [...PUBLIC_HTML, "opbox-set-prices.csv", "opbox-ai-data.json", "llms.txt"]) {
    if (!exists(f)) continue;
    const t = read(f);
    if (/(sold|판매)\s*(count|건수|volume|량)/i.test(t) && /gone|delist/i.test(t))
      errors.push(`P1: ${f} 에서 사라진 매물을 판매량처럼 표기한 정황 — 라벨 재확인`);
  }
}

// ── W1. 야간 산출물 커밋 누락 방지 — 2026-07-20 실사고.
//    fetch-auction-deals.js 가 만든 data/auction-deals.json 이 워크플로 커밋 목록에 없어
//    작업트리에 미스테이징 변경이 남았고, 푸시 충돌 시 `git rebase` 가 "unstaged changes"로
//    실패해 야간 배포가 통째로 죽었다. 같은 유형으로 data/price-quality-audit.json 도 누락돼 있었다.
// 2026-07-20 2차: 워크플로가 늘어나면서 이 검사가 야간 파일 하나만 보고 있다는 게 드러났다.
// 새 워크플로(경매 수집·정산)는 검사 밖이었다 — 같은 사고가 그대로 재현될 자리였다. 전 워크플로로 넓힌다.
{
  const wfDir = path.join(ROOT, ".github", "workflows");
  const CURATED = new Set(["set-facts.json"]);   // 사람이 관리하는 읽기 전용 — 산출물이 아님
  const dataFiles = fs.existsSync(path.join(ROOT, "data"))
    ? fs.readdirSync(path.join(ROOT, "data")).filter((n) => n.endsWith(".json"))
    : [];

  for (const wf of fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)) : []) {
    const y = read(`.github/workflows/${wf}`);
    const addLines = [...y.matchAll(/^\s*git add ([^\n]+)/gm)].map((match) => match[1]);
    const diffLines = [...y.matchAll(/git diff --quiet ([^\n]+?);\s*then/g)].map((match) => match[1]);
    const addLine = addLines[0] || "";
    if (!addLine && !diffLines.length) continue;    // 커밋하지 않는 워크플로는 대상 아님

    // 두 목록이 어긋나면 "변경은 감지되는데 커밋은 안 되는" 구멍이 생긴다.
    // `--` 는 경로 구분자일 뿐 대상 목록이 아니다. 빼고 비교하지 않으면 오탐이 난다.
    const norm = (t) => t.trim().split(/\s+/).filter((x) => x && x !== "--").sort().join(" ");
    for (const [index, candidate] of addLines.entries()) {
      if (norm(candidate) !== norm(addLine)) errors.push(`W1: ${wf} 의 ${index + 1}번째 git add 범위가 최초 커밋 범위와 불일치 — rebase 후 누락 구멍`);
    }
    for (const candidate of diffLines) {
      if (addLine && norm(candidate) !== norm(addLine)) errors.push(`W1: ${wf} 의 git diff 목록과 git add 목록 불일치 — 커밋 누락 구멍`);
    }

    // 이 워크플로가 돌리는 도구가 기록하는 data/*.json 은 전부 커밋 목록에 있어야 한다.
    const tools = [...y.matchAll(/node tools\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
    // Navigation regeneration also writes informational root pages (2026-10-10).
    // Missing these blocked publication of the entire collected dataset.
    if (tools.includes("inject-nav.js")) {
      for (const output of ["about.html", "amazon-lottery.html", "changelog.html", "disclaimer.html", "methodology.html", "privacy.html", "psa-grading.html"]) {
        if (!addLine.split(/\s+/).includes(output)) errors.push(`W1: ${wf} navigation output missing from commit scope: ${output}`);
      }
    }
    // generate-set-pages.js 는 sets/ 밖의 루트 페이지도 함께 굽는다. 이 파일을 빼면
    // PSA 호가가 바뀐 날에만 미스테이징 변경이 남아 push 경합 후 rebase 가 실패한다.
    if (tools.includes("generate-set-pages.js")) {
      if (!addLine.includes("psa10-ranking.html")) {
        errors.push(`W1: psa10-ranking.html 은 ${wf} 의 산출물인데 커밋 목록에 없음 — rebase 실패를 유발함`);
      }
      if (!y.includes("Tracked generated files remain unstaged")) {
        errors.push(`W1: ${wf} 에 staging 후 추적 파일 잔여 검사 없음 — 새 산출물 누락을 사전에 차단할 수 없음`);
      }
    }
    if (tools.includes("backfill-english-box-series.js") && !addLine.includes("logs/en-backfill-status.json")) {
      errors.push(`W1: logs/en-backfill-status.json 은 ${wf} 의 산출물인데 커밋 목록에 없음 — rebase 실패를 유발함`);
    }
    if (tools.includes("generate-ai-data.js") && !addLine.includes("opbox-ai-data.json")) {
      errors.push(`W1: opbox-ai-data.json 은 ${wf} 의 산출물인데 커밋 목록에 없음 — AI 데이터가 구버전으로 남음`);
    }
    if (tools.includes("generate-free-data.js")) {
      for (const output of ["free-data.html", "opbox-set-prices.csv", "opbox-grading-population.csv", "opbox-auction-daily.csv", "sitemap.xml"]) {
        if (!addLine.includes(output)) errors.push(`W1: ${output} 은 ${wf} 의 산출물인데 커밋 목록에 없음 — 무료 데이터가 구버전으로 남음`);
      }
    }
    const src = [...new Set(tools)]
      .filter((f) => exists(`tools/${f}`))
      .map((f) => read(`tools/${f}`))
      .join("\n");
    if (!src) continue;
    for (const f of dataFiles) {
      if (CURATED.has(f)) continue;
      // 도구가 "쓰는" 파일만 대상 — 읽기만 하는 파일도 소스에 이름이 나오므로 writeFileSync 로 판별한다.
      const esc = f.replace(/[.]/g, "\\.");
      // 경로를 변수에 담아 쓰는 경우: `const xPath = path.join(..., "foo.json")` 로 잡은 변수명이
      // 실제로 writeFileSync 의 **첫 인자**로 쓰였을 때만 산출물로 본다.
      // 예전에는 경로 상수가 있기만 하면 쓴다고 판정해서, 읽기 전용 입력까지 산출물로 오탐했다
      // (2026-08-12: collect-cgc-card-pop.js 가 읽기만 하는 onepiece-packs.json 이 걸렸다).
      const pathVars = [...src.matchAll(new RegExp(`(\\w+)\\s*=\\s*path\\.join\\([^;\\n]*"${esc}"`, "g"))].map((m) => m[1]);
      const writes = new RegExp(`writeFileSync\\([^)]*${esc}`).test(src)
        || new RegExp(`"${esc}"[^\\n]*\\n?[^\\n]*writeFileSync`).test(src)
        || pathVars.some((v) => new RegExp(`writeFileSync\\(\\s*${v}\\b`).test(src));
      if (!writes) continue;
      if (!addLine.includes(`data/${f}`)) {
        errors.push(`W1: data/${f} 는 ${wf} 의 산출물인데 커밋 목록에 없음 — rebase 실패를 유발함`);
      }
    }
  }
}

// ── W2. 수집 건강검사는 앞 검사가 실패해도 전부 돈다 — 2026-09-30 발견.
//    collection-health.yml 의 검사 단계가 기본값(success())이라 첫 단계 'Check data freshness' 가 실패하면
//    뒤 7개(수집기·YAML·계약·공백·귀속·박스 그래프·가격)가 전부 skip 됐다(9/20·9/23·9/26 실행).
//    그날 생긴 공백·가격 문제는 신선도가 고쳐질 때까지 안 보였다. 두 번째 run 단계부터 !cancelled() 필수.
//    continue-on-error 는 금지 — 하나라도 실패하면 job 이 실패해야 메일이 간다.
//    `if: !cancelled()` 맨몸은 안 된다 — YAML 에서 ! 는 태그라 워크플로가 통째로 거부된다(audit-workflows 도 못 잡음).
{
  const y = read(".github/workflows/collection-health.yml").replace(/\r\n/g, "\n");
  const runSteps = y.split(/\n(?=      - )/).slice(1).filter((s) => /^\s+run:/m.test(s));
  if (runSteps.length < 2) errors.push("W2: collection-health.yml 에서 검사 단계를 찾지 못함 — 구조를 바꿨으면 이 검사도 같이 고칠 것");
  for (const s of runSteps.slice(1)) {
    const name = ((s.match(/name:\s*(.+)/) || [])[1] || s.slice(0, 40)).trim();
    if (!/^\s+if:\s*(\$\{\{\s*(!cancelled\(\)|always\(\))\s*\}\}|always\(\))\s*$/m.test(s)) {
      errors.push(`W2: collection-health.yml '${name}' 에 if: \${{ !cancelled() }} 없음 — 앞 검사가 실패하면 이 검사가 skip 된다`);
    }
  }
  if (/^\s+continue-on-error:/m.test(y)) errors.push("W2: collection-health.yml 에 continue-on-error — 실패가 성공으로 덮여 메일이 안 간다");
}

// ── W3. 러너에서 0건으로 끝나면서 성공으로 보이는 단계 금지 — 2026-09-30 발견.
//    ① update-market-data 가 `update-ebay-japanese-nm-sold-prices.js --continue-on-error` 로 불렀는데
//      스크립트가 process.argv.slice(2) 를 세트코드로 받아 플래그가 코드로 먹혔다 → 대상 0장.
//      7/12~9/27 매주 rows:[] 로 "성공"했다(원천 Finding API 도 418/503 이라 그 경로는 통째로 삭제).
//      그래서 워크플로가 --플래그를 넘기는 스크립트는 slice(2) 를 .filter 로 걸러서 써야 한다(옵션 파서인 run-with-retry 제외).
//    ② 유유테이 NM 을 8/25 워크플로에 넣었지만 러너 IP 가 403 이라 봇 7회(8/28~9/27) 동안 nmUpdated 갱신 0.
//      continue-on-error 라 성공으로 보였다. 이 PC 에서만 되는 수집기는 워크플로에 넣지 않는다.
{
  const RUNNER_BLOCKED = {
    "update-yuyutei-nm-prices.js": "유유테이가 러너 IP 에 403 — 10일 주기 로컬 수동(collect-status nm)",
  };
  const wfDir = path.join(ROOT, ".github", "workflows");
  for (const wf of fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)) : []) {
    const y = read(`.github/workflows/${wf}`);
    for (const [script, why] of Object.entries(RUNNER_BLOCKED)) {
      if (y.includes(`tools/${script}`)) errors.push(`W3: ${wf} 가 ${script} 를 돌린다 — ${why}`);
    }
    for (const line of y.split(/\r?\n/)) {
      if (/^\s*#/.test(line)) continue;
      const calls = [...line.matchAll(/node\s+tools\/([a-z0-9-]+\.js)/g)];
      for (const [i, m] of calls.entries()) {
        if (m[1] === "run-with-retry.js" || !exists(`tools/${m[1]}`)) continue;
        const end = i + 1 < calls.length ? calls[i + 1].index : line.length;
        const args = line.slice(m.index + m[0].length, end).split(/\s(?:2>|\||&&|;|>)/)[0];
        const flags = args.split(/\s+/).filter((a) => /^-/.test(a));
        if (!flags.length) continue;
        const src = read(`tools/${m[1]}`);
        if (/process\.argv\.slice\(2\)(?!\s*\.filter\()/.test(src)) {
          errors.push(`W3: ${wf} 가 ${m[1]} 에 ${flags.join(" ")} 를 넘기는데 스크립트가 process.argv.slice(2) 를 거르지 않고 쓴다 — 플래그가 위치 인자(세트코드)로 먹혀 대상 0건`);
        }
      }
    }
  }
}

// ── X1. 외부로 fetch 하는 주소는 CSP connect-src 에 있어야 한다 — 2026-07-20 실사고.
// 경매 중계기를 붙였는데 connect-src 에 안 넣어서 브라우저가 조용히 막았다. 서버는 200을 주고
// 콘솔에도 CSP 위반은 우리 코드 에러로 안 잡히니, 위젯이 "그냥 안 보이는" 형태로 실패했다.
// 새 외부 엔드포인트를 붙일 때마다 같은 함정이 있으므로 자동 검사한다.
{
  const js = exists("packs.js") ? read("packs.js") : "";
  // packs.js 안의 절대 https 주소 중 fetch 대상이 될 수 있는 상수들
  const relays = [...js.matchAll(/const\s+\w*RELAY\w*\s*=\s*"(https:\/\/[^"]+)"/g)].map((m) => m[1]);
  for (const url of relays) {
    let origin;
    try { origin = new URL(url).origin; } catch { continue; }
    for (const page of ["index.html", "packs.html"]) {
      if (!exists(page)) continue;
      const html = read(page);
      if (!/Content-Security-Policy/i.test(html)) continue;   // CSP 없는 페이지는 대상 아님
      const connect = (html.match(/connect-src ([^;"]+)/) || [])[1] || "";
      if (!connect.includes(origin)) {
        errors.push(`X1: ${page} 의 CSP connect-src 에 ${origin} 없음 — 브라우저가 조용히 차단함`);
      }
    }
  }

  // X1b: 경매 위젯이 eBay 썸네일을 넣으면 CSP img-src 에 i.ebayimg.com 이 있어야 한다 — 2026-07-21.
  //      ※ 이미지 URL 은 런타임 릴레이 데이터라 packs.js 에 도메인 문자열이 없다. 기능 마커(aucThumb)로 감지한다.
  if (/aucThumb/.test(js)) {
    for (const page of ["index.html", "packs.html"]) {
      if (!exists(page)) continue;
      const html = read(page);
      if (!/Content-Security-Policy/i.test(html)) continue;
      const imgSrc = (html.match(/img-src ([^;"]+)/) || [])[1] || "";
      if (!imgSrc.includes("i.ebayimg.com")) errors.push(`X1: ${page} 의 CSP img-src 에 i.ebayimg.com 없음 — 경매 썸네일이 조용히 안 뜸`);
    }
  }
  // X1c: 카드 이미지를 반다이 일본판(onepiece-cardgame.com)으로 쓰므로 CSP img-src 에 그 도메인이 있어야 한다 — 2026-07-23.
  //      데이터(onepiece-packs.json)에 일본판 이미지 URL 이 하나라도 있으면 SPA 페이지 CSP 에 도메인 필수.
  if (JSON.stringify(data).includes("onepiece-cardgame.com")) {
    for (const page of ["index.html", "packs.html"]) {
      if (!exists(page)) continue;
      const html = read(page);
      if (!/Content-Security-Policy/i.test(html)) continue;
      const imgSrc = (html.match(/img-src ([^;"]+)/) || [])[1] || "";
      if (!imgSrc.includes("onepiece-cardgame.com")) errors.push(`X1: ${page} 의 CSP img-src 에 onepiece-cardgame.com 없음 — 일본판 카드 이미지가 조용히 차단됨`);
    }
  }
}

// ── T3. 저장소 증가 속도 상한 — 2026-08-28 전수 수집 전환과 함께 신설.
//
// 왜 필요한가: 수집량을 하루 1,000건 → 12,000건으로 올렸다. 원장(아카이브)은 하루 한 번
// 쓰고 다시 안 건드리니 선형으로만 늘지만, **2시간마다 통째로 재작성되는 파일**은
// 하루 12개의 새 blob 을 만든다. 사람이 눈치채기 전에 저장소가 못 쓰게 되므로 배포를 막는다.
//
// 얼마나 늘어나는가(2026-08-31 실측, 신입 개발자용):
//   파일 크기 × 12 가 아니다. git 은 blob 을 압축하고 앞뒤가 같은 JSON 은 델타로 저장한다.
//   14일치 131 blob 의 디스크 합이 5.2MB — 파일이 800KB 이던 시절 blob 평균이 40KB(원본의 5%)였다.
//   즉 실제 증가는 "크기 × 12 × 0.05" 쯤이다. 그래도 상한을 크기로 거는 이유는,
//   크기가 곧 그 계수의 분모라서 가장 일찍·가장 싸게 잡히는 신호이기 때문이다.
//
// 상한에 걸렸을 때 순서대로 볼 것:
//   1) auction-sold.json 에 개별 판매(sales)가 다시 들어왔는가 — 가드 A1 이 따로 잡는다.
//      이 파일은 집계 전용이고, 개별 판매는 data/<game>auction-archive/ 가 원장이다.
//   2) daily 에 아무도 안 읽는 축이 늘었는가. 축은 아카이브에서 언제든 다시 구울 수 있으니
//      "지금 화면이 쓰는 축"만 실어 둔다.
//   3) 그래도 커야 한다면 상한을 올리고, 왜 올렸는지 커밋 메시지에 남긴다.
{
  // bytes. 2026-08-31 개별 판매를 뺀 뒤 190KB(daily 40일치). daily 는 하루 ~4.7KB 씩 늘고
  // KEEP_DAILY_DAYS(365일)까지 자라므로, 상한 400KB 는 대략 6개월 뒤 다시 걸리도록 잡은 값이다.
  // 그때 위 2)번(안 읽는 축 정리)을 하라는 뜻이지, 그냥 올리라는 뜻이 아니다.
  const HOT_LIMIT = 400_000;
  for (const f of ["data/auction-sold.json", "data/palworld-auction-sold.json"]) {
    if (!exists(f)) continue;
    const size = fs.statSync(path.join(ROOT, f)).size;
    if (size > HOT_LIMIT) {
      errors.push(`T3: ${f} 가 ${(size / 1024).toFixed(0)}KB — 상한 ${HOT_LIMIT / 1024}KB 초과. 2시간마다 커밋되는 파일이다(저장소 증가 ≈ 하루 ${((size * 12 * 0.05) / 1048576).toFixed(1)}MB). 이 검사 위의 주석에 볼 순서가 적혀 있다`);
    }
  }
}

// ── T2. 방문자 페이로드 상한 — 2026-07-20. 시계열은 소급 못 지우니 방치하면 무한히 큰다.
// data/onepiece-packs.json 은 방문자가 페이지마다 통째로 받는다. compact-series.js 가 오래된
// 구간을 성기게 만들어 유한하게 묶지만, 그 장치가 고장나거나 새 시계열이 상한 밖에서 늘면
// 조용히 커진다. 원본 1.2MB(전송 압축 후 ~200KB)를 넘으면 배포를 막아 사람이 보게 한다.
//
// ⚠️ 크기의 절반은 시계열이 아니라 **저장 포맷**이다(2026-08-31 실측). compact-series.js 는
//    들여쓰기 없이 저장하고(752KB), 이 파일을 쓰는 다른 20여 개 도구는 `JSON.stringify(x, null, 1)`
//    로 저장한다(1177KB). 그래서 "무엇이 마지막에 썼는가"에 따라 크기가 425KB 씩 오갔고,
//    compact-series 스텝이 없는 워크플로(update-fx)가 상한을 넘겨 3일간 죽어 있었다.
//    아래 두 번째 검사가 그 포맷을 못 박는다 — 파이프라인 끝에 compact-series.js 를 돌리면 된다.
// 2026-10-14: 1,073KB(하루 ~7.7KB 증가, 10/28 전후 FAIL 예상). 가장 크게 자라던 카드별 이력(card.series, 314KB·하루 ~4.2KB)은
//    방문자 화면이 안 읽는 값이라 data/card-series.json 으로 옮겼다(tools/card-series-store.js) → 759KB. 상한은 그대로다.
//    다음으로 자라는 것은 박스 진행매물 시계열(boxSeriesEbay·EnEbay, 화면 미사용 — 감사·D13 만 읽는다)이다.
{
  const PAYLOAD_LIMIT = 1_200_000;   // bytes, 원본 기준. 압축 전 크기가 커도 결국 파싱은 원본으로 한다.
  const f = "data/onepiece-packs.json";
  if (exists(f)) {
    const size = fs.statSync(path.join(ROOT, f)).size;
    if (size > PAYLOAD_LIMIT) {
      errors.push(`T2: ${f} 가 ${(size / 1024).toFixed(0)}KB — 상한 ${PAYLOAD_LIMIT / 1024}KB 초과. compact-series.js 동작 확인 필요(방문자가 매번 받는 파일)`);
    }
    // 들여쓰기된 채로 배포되면 방문자가 받는 바이트가 그냥 1.5배가 된다. 값은 같은데 요금만 낸다.
    const head = read(f).slice(0, 4000);
    if (head.includes(String.fromCharCode(10) + " ")) {
      errors.push(`T2: ${f} 가 들여쓰기된 채로 저장돼 있다 — 방문자 전송량이 1.5배가 된다. 이 파일을 쓴 워크플로 끝에 \`node tools/compact-series.js\` 를 넣을 것`);
    }
  }
}

// ── I2. cards/ 하위 페이지의 로컬 이미지 경로는 img/ 로 시작하면 안 된다 — 2026-07-21 실사고.
//    generate-card-pages 가 허브 썸네일 경로에서 "../" 를 벗겨 24장이 전부 /cards/img/... 404 났다.
//    cards/ 깊이에서 로컬 이미지는 ../img/ 또는 루트절대 /img/ 여야 한다.
for (const f of PUBLIC_HTML.filter((p) => p.startsWith("cards/"))) {
  for (const m of read(f).matchAll(/<img[^>]+src="([^"]+)"/g)) {
    const src = m[1];
    if (/^(https?:|data:|\/)/.test(src)) continue;   // 절대URL·data·루트절대는 OK
    if (src.startsWith("img/")) errors.push(`I2: ${f} 이미지 src="${src}" 가 img/ 로 시작 — cards/ 에서 /cards/img/ 로 해석돼 404 (../img/ 또는 /img/ 필요)`);
  }
}

// ── P2. TCGplayer 폴백 이상치(트롤/오매칭 밈가격)가 세트 페이지에 새어나가지 않았는지 검증 — 2026-07-21 실사고.
//    데이터에서 고립 스파이크(세트 2등의 2배 초과 & $3,000 초과)를 재도출해, 그 반올림 표시가가
//    렌더된 세트 페이지에 나타나면 억제 실패로 본다. (예: EB-02 $6,969.69, OP-09 $6,720)
{
  const pk = JSON.parse(read("data/onepiece-packs.json"));
  for (const [code, s] of Object.entries(pk.sets || {})) {
    const page = `sets/${code.toLowerCase()}.html`;
    if (!exists(page)) continue;
    const vals = (s.cards || []).slice(0, 10)
      .filter((c) => c.nmJpy == null && typeof c.priceUsd === "number")
      .map((c) => c.priceUsd).sort((a, b) => b - a);
    const bad = [];
    for (let i = 0; i < vals.length; i++) {
      const next = vals.find((v) => v < vals[i]);
      if (next != null && vals[i] > 3000 && vals[i] > next * 2) bad.push(vals[i]);
      else break;
    }
    if (!bad.length) continue;
    const html = read(page);
    for (const v of bad) {
      const shown = "$" + Math.round(v).toLocaleString("en-US");
      if (html.includes(shown)) errors.push(`P2: ${page} 에 이상치 폴백가 ${shown} 노출 — 밈/트롤 가격 억제 실패 (markTcgOutliers 확인)`);
    }
  }
}

// ── X2. 일본판 카드 이미지 오배정 재발 방지 — 2026-07-27 실사고.
//    번호가 같아도 변형(접미사)이 다르면 완전히 다른 그림이다. 실제로 TR 카드에 패럴렐/프로모
//    그림이 붙어 나갔다. 사람 눈으로 확인한 결과를 data/jp-image-verdicts.json 에 박제해두고,
//    (1) 그 판정과 어긋난 배정, (2) TR 카드에 일본판 이미지가 다시 붙는 것, (3) 참조된 webp 실종
//    을 전부 막는다. 판정을 뒤집으려면 다시 눈으로 보고 원장을 고쳐야 한다.
{
  const pk = JSON.parse(read("data/onepiece-packs.json"));
  // (2) TR = 영문 전용 등급 → 같은 번호의 일본판 변형은 다른 그림이다
  for (const [code, s] of Object.entries(pk.sets || {})) {
    (s.cards || []).forEach((c, i) => {
      if (/\bTR\b/.test(c.name || "") && /img\/jp\//.test(c.image || "")) {
        errors.push(`X2: ${code}[${i}] ${c.number} "${c.name}" 은 TR(영문 전용)인데 일본판 이미지 ${c.image} 배정 — 같은 번호라도 다른 그림이다`);
      }
      // (3) 우리가 호스팅하는 일본판 이미지인데 파일이 없으면 조용히 깨진 썸네일
      //     데이터는 절대 URL(https://opboxindex.com/img/jp/…)로 적히므로 도메인을 벗겨서 본다
      const local = (c.image || "").replace(/^https?:\/\/opboxindex\.com\//, "");
      if (/^img\/jp\//.test(local) && !exists(local)) {
        errors.push(`X2: ${code}[${i}] ${c.number} 의 이미지 ${c.image} 파일 없음 — 깨진 썸네일로 나간다`);
      }
    });
  }
  // (1) 눈으로 확인한 수정 원장과 어긋나면 되돌아간 것
  if (exists("data/jp-image-verdicts.json")) {
    const led = JSON.parse(read("data/jp-image-verdicts.json"));
    for (const f of led.fixed || []) {
      const c = ((pk.sets[f.set] || {}).cards || [])[f.idx];
      if (!c || c.number !== f.num) continue;   // top10 순서가 바뀌면 인덱스가 어긋난다 — 그건 X2로 잡지 않는다
      const cur = (c.image || "").split("/").pop();
      if (cur !== f.after) {
        errors.push(`X2: ${f.set}[${f.idx}] ${f.num} 이미지가 ${cur} — 시각검증 결과는 ${f.after} (${f.why}). 되돌리려면 눈으로 다시 보고 jp-image-verdicts.json 을 고칠 것`);
      }
    }
  }
}

// ── Y1/Y2. 세트 카드 목록 — 2026-09-30. (K1/K2 는 known-gaps 검사가 먼저 쓰고 있어 Y 로 둔다)
//   Y1: OP/EB/PRB 세트의 cardCount 는 있으면 50 이상. OP-16 에 5 가 들어가 세트 페이지에 "5 cards" 로 나갔다
//       (공식 상품 페이지는 全126種). 수록 종류가 50 아래인 부스터·EB·PRB 는 없다 — 더 작으면 다른 숫자가 들어간 것이다.
//   Y2: 영문 발매일(release)이 오늘 이전인 가장 최근 부스터(OP-xx) 세트의 cards 가 비면 실패.
//       8/28 발매 OP-17 이 6주 동안 top10 없이 나갔다. 채우는 법: node tools/seed-set-top-cards.js <CODE>
{
  const today = new Date().toISOString().slice(0, 10);
  let latest = null;
  for (const [code, s] of Object.entries(data.sets || {})) {
    if (/^(OP|EB|PRB)-\d+$/.test(code) && s.cardCount != null && !(Number(s.cardCount) >= 50)) {
      errors.push(`Y1: ${code} cardCount=${s.cardCount} — 50 미만이면 세트 수록 종류 수가 아니다. 확인 전에는 비워 둘 것`);
    }
    if (/^OP-\d+$/.test(code) && s.release && s.release < today && (!latest || s.release > latest.s.release)) latest = { code, s };
  }
  if (latest && !(latest.s.cards || []).length) {
    errors.push(`Y2: ${latest.code}(발매 ${latest.s.release}) cards 가 비어 있음 — 가장 최근 발매 부스터에 top10 이 없다. node tools/seed-set-top-cards.js ${latest.code}`);
  }
}

// ── J1. packs.js 안에서 호출하는 render*/init* 함수가 실제로 선언돼 있는지 — 2026-07-27 실사고.
//    죽은 차트 코드를 블록으로 잘라내다 그 사이에 있던 renderEditionTable 까지 함께 지웠다.
//    문법은 통과하고(정의되지 않은 이름은 실행 시점에야 터진다) 가드도 통과했지만,
//    세트 상세가 통째로 빈 화면이 됐다. SPA 를 실행하지 않는 가드는 이걸 못 보므로 이름만 대조한다.
{
  const js = read("packs.js");
  const declared = new Set([...js.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]));
  for (const m of js.matchAll(/\b((?:render|init|build)[A-Z]\w*)\s*\(/g)) {
    const name = m[1];
    if (declared.has(name)) continue;
    // 선언과 함께 쓰이는 형태(const x = function ...)나 메서드 호출(.renderX()) 은 제외
    const idx = m.index;
    if (/[.\w$]$/.test(js.slice(Math.max(0, idx - 1), idx))) continue;
    if (new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(js)) continue;
    errors.push(`J1: packs.js 가 ${name}() 를 호출하는데 선언이 없음 — 렌더가 런타임에 통째로 죽는다`);
  }
}

// ── V2. 페이지 생성기가 캐시버전을 하드코딩하면 안 된다 — 2026-07-27, 하루에 세 번 막혔다.
//    생성기가 옛 버전 문자열을 박아 넣으면, 야간 워크플로가 페이지를 재생성하는 순간
//    V1(동시 범프)에 걸려 배포가 통째로 막힌다. 데이터는 다 받아놓고 커밋만 못 하는 상태가 된다.
//    생성기는 packs.js 의 DATA_VERSION 을 읽어 써야 한다.
for (const f of fs.readdirSync(path.join(ROOT, "tools")).filter((n) => /^(generate|inject)-.*\.js$/.test(n))) {
  const src = read(`tools/${f}`);
  for (const m of src.matchAll(/(?:\?v=|const\s+\w*(?:CACHE|VER|VERSION)\w*\s*=\s*")(\d{8}[a-z0-9]*)/g)) {
    errors.push(`V2: tools/${f} 가 캐시버전 "${m[1]}" 을 하드코딩 — packs.js 의 DATA_VERSION 을 읽게 할 것(범프 때 배포가 막힌다)`);
  }
}

// ── M1/M2. 변형 혼입 검사 — 2026-07-28 실사고. 사용자가 화면에서 먼저 발견했다.
//   M1: 같은 카드번호의 다른 변형에 **동일한 PSA10 sold 구간**이 붙어 있으면, 그 값은
//       변형별 시세가 아니라 하나의 표본을 나눠 쓴 것이다(OP09-051 금/은, OP05-119 패럴렐/원티드).
//   M2: NM 대비 PSA10 배율이 터무니없으면 둘 중 하나가 다른 카드 값이다.
//       (OP02-059 박스토퍼 NM 80엔에 PSA10 38만원 = 475배 / OP05-119 NM 12,800엔에 1,330만원 = 103배)
//       싼 카드는 등급비 때문에 배율이 크게 나오므로, NM 1만엔 이상인 카드만 본다.
{
  const KRW_PER_JPY = 10.1, MAX_MULT = 30, USD_KRW = data.fx?.usdKrw;
  for (const [code, s] of Object.entries(data.sets || {})) {
    const byNum = {};
    (s.cards || []).forEach((c, i) => {
      const n = (c.number || "").toUpperCase();
      if (n) (byNum[n] ||= []).push({ i, c });
    });
    for (const [n, arr] of Object.entries(byNum)) {
      const sig = arr.filter((x) => x.c.psa10Ebay).map((x) => `${x.c.psa10Ebay.low}|${x.c.psa10Ebay.high}`);
      if (sig.length > 1 && new Set(sig).size < sig.length) {
        errors.push(`M1: ${code} ${n} — 서로 다른 변형이 같은 PSA10 sold 구간을 쓰고 있음(변형별 값이 아님). 확인 전까지 내릴 것`);
      }
      for (const { i, c } of arr) {
        const p = c.psa10Ebay, mid = p?.middle;
        if (!mid || !c.nmJpy || c.nmJpy < 10000) continue;
        // psa10Ebay 는 통화가 섞여 있다(USD = eBay US, KRW = 국내). 환산 없이 비교하면 USD 카드의 배율이
        // 1/1300 로 작아져 검사를 통째로 빠져나간다 — 2026-09-16 기준 108건 중 90건이 USD 였다.
        const cur = p.currency;
        if (cur !== "USD" && cur !== "KRW") { errors.push(`M2: ${code} #${i} ${c.name} — psa10Ebay.currency 가 "${cur}" — 원화 환산을 못 해 배율 검사를 건너뛴다`); continue; }
        if (cur === "USD" && !USD_KRW) { errors.push(`M2: ${code} #${i} ${c.name} — fx.usdKrw 가 없어 USD 표기 PSA10 값을 환산 못 함`); continue; }
        const mult = (cur === "USD" ? mid * USD_KRW : mid) / (c.nmJpy * KRW_PER_JPY);
        if (mult > MAX_MULT) errors.push(`M2: ${code} #${i} ${c.name} — PSA10 이 NM 의 ${mult.toFixed(0)}배. 둘 중 하나가 다른 변형 값일 가능성`);
      }
    }
  }
}

// ── G8. 그레이더 주간 커버리지 회귀 — "이번 주에 세트가 줄었다"는 대개 데이터가 아니라 수집기가 잘못된 것이다.
//    2026-07-22·07-27 CGC 수집이 목록 2페이지 중 1페이지만 읽어 일본판 7세트를 통째로 빠뜨렸는데,
//    값이 다 그럴듯해서 2주간 아무도 몰랐다(커버리지 36 vs 실제 43). 적재기(cgc-set-grades-ingest·tag-pop-ingest)가 1차로 막지만,
//    손으로 만든 파일이 들어올 수도 있으니 원장 자체에서도 본다. 마지막 수집일이 직전보다 적으면 FAIL.
for (const [grader, file] of [["CGC", "data/cgc-grading-history.json"], ["TAG", "data/tag-grading-history.json"]]) {
  if (!exists(file)) continue;
  let h; try { h = JSON.parse(read(file)); } catch { errors.push(`G8: ${file} 파싱 실패`); continue; }
  const byDate = {};
  for (const [code, eds] of Object.entries(h.sets || {})) {
    for (const ed of ["jp", "en"]) for (const p of eds[ed] || []) (byDate[p.d] ||= new Set()).add(`${code}|${ed}`);
  }
  const days = Object.keys(byDate).sort();
  if (days.length < 2) continue;
  const [prev, last] = [days.at(-2), days.at(-1)];
  if (byDate[last].size < byDate[prev].size) {
    const missing = [...byDate[prev]].filter((k) => !byDate[last].has(k));
    errors.push(`G8: ${grader} ${last} 커버리지 ${byDate[last].size} < 직전 ${prev} ${byDate[prev].size} — 목록 페이지를 끝까지 읽었는지 확인할 것 (빠진 것: ${missing.slice(0, 6).join(", ")})`);
  }
}

// ── G9. 만점 분리값(CGC Pristine 10 / Gem Mint 10 · TAG 10 / 10P)이 버려지지 않는가 — 2026-09-30 실사고.
//    둘 다 8/3 뒤로 원장에 안 쌓여 화면 열이 전 세트 '—' 였다. CGC 는 자동 수집(collect-grading)이 매주 받은
//    덤프의 세트 합을 적재하지 않고 버렸고, TAG 는 브라우저 집계(__tagAgg)가 10+10P 를 gem 하나로 합쳤다.
//    분리값을 담는 적재기(cgc-set-grades·tag-pop-split)는 있었지만 어떤 절차에도 없었다 — 있어도 안 돌면 없는 것이다.
{
  // (1) CGC 카드 덤프를 받는 워크플로는 같은 덤프로 세트 합도 적재하고, 화면 블록을 다시 주입해야 한다.
  const wfDir = path.join(ROOT, ".github", "workflows");
  for (const wf of fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)) : []) {
    const y = read(`.github/workflows/${wf}`);
    const dump = (y.match(/node tools\/collect-cgc-card-pop\.js ("[^"]+"|\S+)/) || [])[1];
    if (!dump) continue;
    const at = y.indexOf(`node tools/cgc-set-grades-ingest.js ${dump}`);
    if (at < 0) errors.push(`G9: ${wf} 가 CGC 덤프(${dump})를 받고 세트 합(cgc-set-grades-ingest.js)을 적재하지 않는다 — 세트 분리값을 버린다`);
    else if (y.indexOf("node tools/inject-grader-editions.js", at) < 0) errors.push(`G9: ${wf} 가 세트 원장에 점을 늘리고 화면 블록(inject-grader-editions.js)을 다시 주입하지 않는다 — 등급 감사 G7 이 막힌다`);
  }

  // (2) 적재 경로 자체 — 세트 합의 모양, 분리값 없는 입력·커버리지 축소 거부, 새 세트의 미끼 그룹 배제, __tagAgg 의 10/10P 분리.
  const t = spawnSync(process.execPath, [path.join(__dirname, "test-pop-ingest-guards.js")], { cwd: ROOT, encoding: "utf8" });
  if (t.error || t.status !== 0) errors.push(`G9: test-pop-ingest-guards.js 실패 — ${(t.stderr || t.error?.message || t.stdout || "unknown").trim().slice(0, 500)}`);

  // (3) 원장 분리값이 말이 되는가, 그리고 화면은 **마지막 점(= 총량과 같은 관측)** 의 분리값만 싣는가.
  //     옛 분리값을 끌어오면 날짜 칸 없는 표에서 8/3 값이 9/29 총량 옆에 '현재'처럼 붙는다 — 빈 칸이 낫다.
  const led = {};
  for (const [key, file] of [["cgc", "data/cgc-grading-history.json"], ["tag", "data/tag-grading-history.json"]]) {
    if (!exists(file)) continue;
    let h; try { h = JSON.parse(read(file)); } catch { continue; }   // 파싱 실패는 G8 이 알린다
    led[key] = h;
    for (const [code, eds] of Object.entries(h.sets || {})) {
      for (const ed of ["jp", "en"]) {
        for (const p of eds[ed] || []) {
          if (key === "cgc" && p.grades) {
            const top = ["Pristine 10", "Gem Mint 10", "Perfect 10"].reduce((a, g) => a + (p.grades[g] || 0), 0);
            if (Object.values(p.grades).some((v) => !Number.isInteger(v) || v < 0) || top > p.total) errors.push(`G9: CGC ${code}.${ed} ${p.d} 분리값 이상 (만점 합 ${top} / 총량 ${p.total})`);
          }
          if (key === "tag" && (p.g10 != null || p.g10p != null) && p.gem !== p.g10 + p.g10p) errors.push(`G9: TAG ${code}.${ed} ${p.d} gem ${p.gem} ≠ 10(${p.g10}) + 10P(${p.g10p})`);
        }
      }
    }
  }
  const packsNow = exists("data/onepiece-packs.json") ? JSON.parse(read("data/onepiece-packs.json")) : { sets: {} };
  const FIELDS = { cgc: [["pristine10", (p) => p.grades?.["Pristine 10"]], ["gemMint10", (p) => p.grades?.["Gem Mint 10"]], ["perfect10", (p) => p.grades?.["Perfect 10"]]],
    tag: [["g10", (p) => p.g10], ["g10p", (p) => p.g10p]] };
  for (const [code, s] of Object.entries(packsNow.sets || {})) {
    for (const key of ["cgc", "tag"]) {
      for (const ed of ["jp", "en"]) {
        const e = s.graders?.[key]?.[ed];
        const last = (led[key]?.sets?.[code]?.[ed] || []).slice().sort((a, b) => a.d.localeCompare(b.d)).at(-1);
        if (!e || !last) continue;
        for (const [f, get] of FIELDS[key]) {
          if ((e[f] ?? null) !== (get(last) ?? null)) errors.push(`G9: ${code} ${key}.${ed}.${f} 화면 ${e[f] ?? "—"} ≠ 원장 마지막 점(${last.d}) ${get(last) ?? "—"} — 분리값은 총량과 같은 관측만 싣는다`);
        }
      }
    }
  }

  // (4) 구운 페이지도 같은 규칙 — 없는 분리값을 0 으로 적거나(한국어 세트 페이지 22장이 "프리스틴 10 0장과 젬 민트 10 0장"),
  //     날짜 칸 없는 표에 옛 분리값을 붙이면(free-data 미리보기: 9/29 총량 옆 8/3 Pristine 10) 안 된다.
  //     방향은 하나만 본다: 화면 블록에 분리값이 **없는데** 페이지가 말하면 FAIL. 새 분리값이 생긴 뒤 페이지가 하루 늦는 건 정상이다.
  for (const f of fs.existsSync(path.join(ROOT, "ko")) ? fs.readdirSync(path.join(ROOT, "ko")).filter((n) => /^(op|eb|prb)-\d{2}\.html$/.test(n)) : []) {
    const m = read(`ko/${f}`).match(/CGC (일본판|영문판) 표본은 [\d,]+장으로, 프리스틴 10/);
    if (!m) continue;
    const e = packsNow.sets?.[f.replace(/\.html$/, "").toUpperCase()]?.graders?.cgc?.[m[1] === "일본판" ? "jp" : "en"];
    if (!e || e.pristine10 == null) errors.push(`G9: ko/${f} 가 화면 블록에 없는 CGC 만점 수를 적는다 — 분리값이 없는 관측은 말하지 않는다`);
  }
  if (exists("free-data.html") && exists("opbox-grading-population.csv")) {
    const [head, ...rows] = read("opbox-grading-population.csv").trim().split("\n").map((l) => l.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/));
    const col = (r, n) => r[head.indexOf(n)];
    const splitDate = {};
    for (const r of rows) splitDate[`${col(r, "set_code")}|${col(r, "edition")}`] = [col(r, "cgc_grade_split_as_of"), col(r, "cgc_total_as_of")];
    for (const m of read("free-data.html").matchAll(/<tr><td>([A-Z]+-\d{2})<\/td><td>(Japanese|English)<\/td>(?:<td class="num">[^<]*<\/td>){3}<td class="num">([^<]*)<\/td>/g)) {
      const [split, total] = splitDate[`${m[1]}|${m[2].toLowerCase()}`] || [];
      if (m[3] !== "—" && (!split || split !== total)) errors.push(`G9: free-data.html 미리보기 ${m[1]} ${m[2]} Pristine 10 ${m[3]} 이 CGC 총량(${total})과 다른 날(${split || "없음"}) 값이다 — 날짜 칸 없는 표에는 같은 관측만`);
    }
  }
}

// ── W4. 전역 신선도 감사는 커밋 뒤에 — 2026-09-30 실사고.
//    collect-grading 이 'Collection health'(audit-collection-health, 전 수집원 신선도)를 커밋 앞에 두고 있었다.
//    9/7·9/14·9/21·9/28 네 번, CGC 수집·적재·오늘 날짜 확인·가드를 다 통과하고도 CGC 와 무관한 항목
//    (PSA 판본별 12일째 등)으로 실패해 결과를 버렸다 — 9/21분은 CGC 카드별 W39 영구 공백이 됐다.
//    이 감사들은 알림용이다. 커밋 앞에 두면 남의 지연이 내 관측을 지운다.
//    수집 결과 자체의 검사(오늘 날짜 확인·guard-invariants)는 여기 해당하지 않는다 — 커밋 앞이 맞다.
{
  const GLOBAL_AUDITS = /node tools\/(audit-collection-health|audit-series-gaps|collect-status)\.js/;
  const wfDir = path.join(ROOT, ".github", "workflows");
  for (const wf of fs.existsSync(wfDir) ? fs.readdirSync(wfDir).filter((n) => /\.ya?ml$/.test(n)) : []) {
    const lines = read(`.github/workflows/${wf}`).split("\n");
    // 파서 없이 스텝을 자른다: 스텝 머리("- name:"/"- uses:")의 들여쓰기는 파일 안에서 하나다(audit-workflows 가 본다).
    const heads = lines.map((l, i) => [i, (l.match(/^(\s*)- (?:name|uses):/) || [])[1]]).filter(([, ind]) => ind != null);
    if (!heads.length) continue;
    const ind = heads[0][1].length;
    const starts = heads.filter(([, s]) => s.length === ind).map(([i]) => i);
    const steps = starts.map((s, k) => lines.slice(s, starts[k + 1] ?? lines.length).join("\n"));
    const commitAt = steps.findIndex((t) => /^\s*git commit\b/m.test(t));
    if (commitAt < 0) continue;                       // 커밋하지 않는 워크플로(collection-health 등)는 대상 아님
    steps.slice(0, commitAt).forEach((t) => {
      const m = t.match(GLOBAL_AUDITS);
      if (m) errors.push(`W4: ${wf} 에서 전역 감사 ${m[1]} 가 커밋 단계보다 앞에 있다 — 무관한 지연이 이번 수집 결과를 버리게 한다(커밋 뒤로 옮길 것)`);
    });
  }
}

// ── A4. AdSense 승인 준비도 — 최종 생성 HTML을 별도 SRP 감사로 검사한다.
//    noindex+광고, 자동생성/내비 페이지 광고, 박문서 광고, 세트 문장 반복,
//    packs 홈 별칭과 EPN campid 보존을 한 번에 확인한다.
{
  const result = spawnSync(process.execPath, [path.join(__dirname, "audit-adsense-readiness.js")], {
    cwd: ROOT,
    encoding: "utf8",
  });
  let report = null;
  try { report = JSON.parse(result.stdout || ""); } catch {}
  if (result.error) {
    errors.push(`A4: AdSense readiness 감사 실행 실패 — ${result.error.message}`);
  } else if (result.status !== 0) {
    const details = Array.isArray(report?.errors) && report.errors.length
      ? report.errors.map((error) => `A4: ${error}`)
      : [`A4: AdSense readiness 감사 실패${result.stderr ? ` — ${result.stderr.trim()}` : ""}`];
    errors.push(...details);
  }
}

// ── E1. EPN 제휴 고지 — 제휴 링크가 뜨는 페이지에는 눈에 띄는 상단 고지가 있어야 한다.
//    2026-08-10 EPN 위반 통지(기한 8/19): 고지 문구는 적절하나 푸터에만 있어 이용자가 놓치기 쉽다.
//    Participation Requirements I.G. 위반이며, 방치하면 계정 정지 + 대기 수수료 100% 회수다.
//    그래서 "고지가 있나"가 아니라 **"제휴 링크보다 먼저 나오나"**를 검사한다.
//    campid 가 HTML 에 박힌 페이지와 packs.js 가 링크를 주입하는 페이지 둘 다 대상이다.
{
  const CAMPID = "5339163744";
  const injectors = ["packs.js"].filter((j) => read(j).includes(CAMPID));
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    const baked = html.includes(CAMPID);
    const injected = injectors.some((j) => html.includes(j));
    if (!baked && !injected) continue;
    const iNote = html.indexOf('class="affTop"');
    if (iNote < 0) {
      errors.push(`E1: ${f} 에 제휴 링크가 있는데 상단 고지(.affTop)가 없다 — EPN I.G. 위반`);
      continue;
    }
    // 푸터로 밀려나면 다시 위반이다. 링크가 HTML 에 박힌 경우 순서를 실제로 확인한다.
    if (baked) {
      const iLink = html.indexOf(CAMPID);
      if (iNote > iLink) errors.push(`E1: ${f} 의 고지가 첫 제휴 링크보다 뒤에 있다 — 접힘선 위로 올려야 한다`);
    }
  }
  // 고지를 다시 작게/흐리게 만들면 EPN 이 지적한 상태(11px · opacity .8 · 흐린 회색)로 되돌아간다.
  // 크기·투명도뿐 아니라 **대비**까지 본다 — opacity 를 1로 두고 글자색만 어둡게 하면
  // 검사를 통과하면서 실제로는 안 보이게 만들 수 있기 때문이다.
  const css = read("styles.css");
  const rule = (css.match(/\.affTop\s*\{[^}]*\}/) || [])[0] || "";
  if (!rule) errors.push("E1: styles.css 에 .affTop 규칙이 없다");
  else {
    const size = parseFloat((rule.match(/font-size:\s*([\d.]+)px/) || [])[1] || "0");
    if (size < 12.5) errors.push(`E1: .affTop font-size ${size}px — 12.5px 미만이면 "눈에 띄지 않는다"는 지적으로 되돌아간다`);
    const op = (rule.match(/opacity:\s*([\d.]+)/) || [])[1];
    if (op && parseFloat(op) < 1) errors.push(`E1: .affTop opacity ${op} — 고지를 흐리게 하면 안 된다`);

    // WCAG 상대휘도 → 배경 대비. 본문용 최소 기준 4.5:1 을 하한으로 쓴다.
    const hex = (h) => { const n = h.replace("#", ""); return [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16)); };
    const lum = (rgb) => rgb.map((v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    const varOf = (name) => (css.match(new RegExp(`${name}:\\s*(#[0-9a-f]{6})`, "i")) || [])[1];
    let fg = (rule.match(/color:\s*(#[0-9a-f]{6})/i) || [])[1];
    if (!fg) { const v = (rule.match(/color:\s*var\((--[\w-]+)\)/) || [])[1]; if (v) fg = varOf(v); }
    const bg = varOf("--bg");
    if (fg && bg) {
      const [a, b] = [lum(hex(fg)), lum(hex(bg))].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      if (ratio < 4.5) errors.push(`E1: .affTop 대비 ${ratio.toFixed(1)}:1 — 4.5:1 미만이면 고지를 숨긴 것으로 본다`);
    }
  }
}

// ── R5. 경매 수집 신뢰성 — 날짜 존재만 보는 감사가 부분수집을 놓치지 않아야 하고,
//    실제 크론·쿼터 예약·자가치유·그래프 18조합 계약이 함께 움직여야 한다.
for (const test of [
  "test-auction-continuity.js",
  "test-ebay-budget-schedule.js",
  "test-self-heal-policy.js",
  "test-workflow-dispatch.js",
  "test-tcg-trend-model.js",
]) {
  const result = spawnSync(process.execPath, [path.join(__dirname, test)], { cwd: ROOT, encoding: "utf8" });
  if (result.error || result.status !== 0) {
    errors.push(`R5: ${test} 실패 — ${(result.stderr || result.error?.message || result.stdout || "unknown").trim().slice(0, 500)}`);
  }
}

// ── K1. known-gaps 기록부가 데이터와 맞는가 — 2026-09-30 신설.
//    5c155cb3 이 PSA 카드별 W38 — 9/14 에 386점을 관측한(seen) 주 — 을 영구 공백으로 등록했다. 감사가 d(GemRate 변동일)만
//    보던 오판을 기록부가 그대로 굳혀, 감사를 고쳐도 틀린 기록이 남는다. 등록된 날·주가 그 계열 기준으로 실제로 비어 있어야
//    하고(관측이 있거나 아직 회수 중이면 FAIL), 계열 이름이 감사 이름과 맞아야 한다(오타면 아무것도 안 덮는다).
//    판정은 audit-series-gaps.js D) 가 한다 — 감사와 같은 기준이어야 해서 여기서 다시 짜지 않는다.
//    감사 자체는 소급 불가 공백으로 FAIL 할 수 있으므로 종료 코드가 아니라 knownWrong 만 본다.
// ── K2. 공백 감사 회귀검사 — seen||d, 세트 누적·진행 매물 계열, known-gaps 검증이 되살아나지 않게.
{
  const result = spawnSync(process.execPath, [path.join(__dirname, "audit-series-gaps.js"), "--json"], { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  let report = null;
  try { report = JSON.parse(result.stdout); } catch {}
  if (!report || !Array.isArray(report.knownWrong)) errors.push(`K1: 공백 감사가 결과를 못 냈다 — ${(result.stderr || result.stdout || "").trim().slice(0, 300)}`);
  else for (const m of report.knownWrong) errors.push(`K1: data/known-gaps.json 오기재 — ${m}`);

  const t = spawnSync(process.execPath, [path.join(__dirname, "test-series-gaps.js")], { cwd: ROOT, encoding: "utf8" });
  if (t.error || t.status !== 0) errors.push(`K2: test-series-gaps.js 실패 — ${(t.stderr || t.error?.message || t.stdout || "unknown").trim().slice(0, 500)}`);
}

// ── GA1. GA 로더 — 2026-10-14 측정 복구. 10/8 부터 gtag.js 를 load+1.5초에만 붙여 그 전에 나가는 방문이 통째로 빠졌다.
//    모든 페이지가 inject-nav.js 의 같은 로더 한 줄을 갖고, 그 로더가 아래 동작대로 도는지 가짜 문서에서 실제로 돌려 본다.
//    · 자동화(navigator.webdriver)·/__v/ 경로 → GA 안 붙음  · utm_source·AI/검색 리퍼러 → DOMContentLoaded 직후
//    · 그 밖 → load 전 0, load+1.5초 / 첫 pointerdown·keydown·문서 scroll / 탭 숨김 중 먼저 오는 때 1번만
//    · scroll 은 capture 금지 — 메뉴 줄 가로 맞춤(요소 scroll)이 모바일 첫 그리기 전에 GA 를 당겨 온다.
{
  const vm = require("vm");
  const loaders = new Map();
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    if (/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js/.test(html)) errors.push(`GA1: ${f} 에 gtag.js 를 바로 받는 async 태그가 남았다 — node tools/inject-nav.js 로 로더로 바꿀 것`);
    const found = [...html.matchAll(/<script data-gtag-deferred="([A-Z0-9-]+)">([\s\S]*?)<\/script>/g)];
    if (found.length > 1) errors.push(`GA1: ${f} 에 GA 로더가 ${found.length}개`);
    if (!found.length) {
      if (/gtag\(\s*['"]config['"]/.test(html)) errors.push(`GA1: ${f} 는 gtag config 가 있는데 로더가 없다 — 방문이 집계되지 않는다`);
      continue;
    }
    if (!loaders.has(found[0][2])) loaders.set(found[0][2], []);
    loaders.get(found[0][2]).push(f);
  }
  if (loaders.size > 1) errors.push(`GA1: GA 로더 글자가 페이지마다 다르다(${loaders.size}종: ${[...loaders.values()].map((v) => v[0]).join(", ")}) — node tools/inject-nav.js 를 다시 돌릴 것`);
  const run = (src, { search = "", pathname = "/", referrer = "", webdriver = false } = {}) => {
    const added = [], listeners = [], timers = [];
    const on = (target) => (type, fn, opts) => listeners.push({ target, type, fn, capture: opts === true || !!(opts && opts.capture) });
    const document = { referrer, readyState: "loading", visibilityState: "visible", head: { appendChild: (s) => added.push(s.src) }, createElement: () => ({}), addEventListener: on("document") };
    vm.runInNewContext(src, { document, window: { addEventListener: on("window") }, location: { search, pathname }, navigator: { webdriver }, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
    const fire = (target, type) => listeners.filter((x) => x.target === target && x.type === type).forEach((x) => x.fn());
    const flush = () => timers.splice(0).forEach((t) => t.fn());
    return { added, listeners, timers, fire, flush, document };
  };
  for (const src of loaders.keys()) {
    const bad = (msg) => errors.push(`GA1: 로더 동작 위반 — ${msg}`);
    try {
      for (const opt of [{ webdriver: true, search: "?utm_source=chatgpt.com" }, { pathname: "/__v/sets/op-01.html", referrer: "https://chatgpt.com/" }]) {
        const r = run(src, opt);
        ["DOMContentLoaded", "visibilitychange"].forEach((t) => r.fire("document", t));
        ["load", "pointerdown", "keydown", "scroll"].forEach((t) => r.fire("window", t));
        r.flush();
        if (r.added.length) bad(`${JSON.stringify(opt)} 에서 gtag.js 를 붙였다(자동화·/__v/ 는 0이어야 한다)`);
      }
      for (const opt of [{ search: "?set=OP-13&hl=en&utm_source=chatgpt.com" }, { referrer: "https://chatgpt.com/" }, { referrer: "https://www.perplexity.ai/search/x" }, { referrer: "https://copilot.microsoft.com/" }, { referrer: "https://www.bing.com/" }, { referrer: "https://www.google.co.kr/" }, { referrer: "https://m.search.naver.com/search.naver?q=x" }, { referrer: "https://duckduckgo.com/" }]) {
        const r = run(src, opt);
        if (r.added.length) bad(`${JSON.stringify(opt)} 에서 DOMContentLoaded 전에 붙였다`);
        r.fire("document", "DOMContentLoaded");
        if (r.added.length !== 1 || !/googletagmanager\.com\/gtag\/js\?id=G-/.test(r.added[0] || "")) bad(`${JSON.stringify(opt)} 에서 DOMContentLoaded 직후 gtag.js 1번이 아니다(${r.added.length})`);
      }
      const plain = { referrer: "https://opboxindex.com/sets/op-01.html" };
      {
        const r = run(src, plain);
        r.fire("document", "DOMContentLoaded");
        if (r.added.length) bad("일반 진입에서 load 전에 gtag.js 를 붙였다");
        r.fire("window", "load");
        if (r.added.length || r.timers.length !== 1 || r.timers[0].ms !== 1500) bad("일반 진입이 load+1500ms 예약 1개가 아니다");
        r.flush(); r.fire("window", "pointerdown");
        if (r.added.length !== 1) bad(`일반 진입 load+1.5초 뒤 gtag.js ${r.added.length}번(1이어야 한다)`);
        const scroll = r.listeners.filter((x) => x.target === "window" && x.type === "scroll");
        if (scroll.length !== 1 || scroll[0].capture) bad("문서 scroll 리스너가 window 에 capture 없이 1개가 아니다");
      }
      for (const [target, type] of [["window", "pointerdown"], ["window", "keydown"], ["window", "scroll"], ["document", "visibilitychange"]]) {
        const r = run(src, plain);
        if (type === "visibilitychange") { r.fire(target, type); if (r.added.length) bad("탭이 보이는 상태의 visibilitychange 에서 붙였다"); r.document.visibilityState = "hidden"; }
        r.fire(target, type);
        if (r.added.length !== 1) bad(`${type} 가 load 전에 gtag.js 를 1번 붙이지 않았다(${r.added.length})`);
        r.fire("window", "load"); r.flush(); r.fire("window", "keydown");
        if (r.added.length !== 1) bad(`${type} 뒤 load·keydown 에서 gtag.js 를 또 붙였다(${r.added.length})`);
      }
    } catch (e) {
      bad(`가짜 문서에서 실행 실패 ${e.message}`);
    }
  }
}

// ── GA2. 홈·packs URL 재작성이 utm 등 모르는 파라미터를 지우지 않는가 — 2026-10-14 실측: /?set=OP-13&hl=en&utm_source=chatgpt.com
//    → updateUrl(true) 가 set·hl 만 남겨 page_view 의 dl 에서 utm 이 사라졌다(ChatGPT 홈 착지가 (direct) 로).
{
  const vm = require("vm");
  const fnAt = packsJs.indexOf("function updateUrl(");
  const close = fnAt < 0 ? null : /\r?\n\}\r?\n/.exec(packsJs.slice(fnAt));   // 함수 끝(줄 맨 앞의 }) — packs.js 는 CRLF
  if (fnAt < 0 || !close) errors.push("GA2: packs.js 에서 updateUrl 을 찾지 못함");
  else {
    const constAt = packsJs.indexOf("const ROUTE_PARAMS");
    const code = (constAt >= 0 && constAt < fnAt ? packsJs.slice(constAt, fnAt) : "") + packsJs.slice(fnAt, fnAt + close.index + close[0].length);
    for (const [st, search, want] of [
      [{ selected: "OP-13", hasExplicitSet: true, lang: "jp", view: "hits", hl: "en" }, "?set=OP-13&hl=en&utm_source=chatgpt.com&utm_medium=referral", "/?set=OP-13&hl=en&utm_source=chatgpt.com&utm_medium=referral"],
      [{ selected: "OP-05", hasExplicitSet: false, lang: "extra", view: "hits", hl: "ko" }, "?set=OP-01&view=psa&hl=en&gclid=x1", "/?lang=extra&gclid=x1"],
    ]) {
      let got = null;
      try {
        vm.runInNewContext(code + "\nupdateUrl(true);", { state: st, location: { pathname: "/", search }, URLSearchParams, history: { replaceState: (a, b, u) => { got = u; }, pushState: (a, b, u) => { got = u; } } });
      } catch (e) { got = "실행 실패 " + e.message; }
      if (got !== want) errors.push(`GA2: updateUrl(${search}) → ${got} (기대 ${want}) — 화면 상태 밖 파라미터(utm 등)를 보존해야 한다`);
    }
  }
}

// ── UP1·RD1·AD1. 발매일 묶음(W3, 2026-10-14) — EB-05(10/30·31)·OP-18(11/20·21) 발매 전 사실 갱신을 잠근다.
//    사고: sets/eb-05 는 공식이 75+2종을 올린 뒤에도 "Total card types: Not listed" 였고, op-18·eb-05·발매일 글 첫 화면에
//    "facts checked September 28/30" 이 2주 넘게 남았다. 발매일 글 바이라인은 Published 7/16 만 있어 Bing 스니펫이 'Jul 16' 이었다.
{
  const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const long = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
  const MON3 = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
  const isoOf = (t) => { const m = String(t).replace(/<[^>]+>/g, "").trim().match(/^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/); return m && MON3[m[1]] ? `${m[3]}-${String(MON3[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
  const ldBlocks = (html) => [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  let FACTS = {}, UP = { pages: [] };
  try { FACTS = JSON.parse(read("data/set-facts.json")).sets || {}; UP = JSON.parse(read("data/upcoming-set-pages.json")); } catch (e) { errors.push("UP1: set-facts/upcoming 읽기 실패 — " + e.message); }

  // set-facts: 레어리티 합 = 카드 종류("A+B" 의 A = DON 뺀 합, B = DON)
  for (const [code, f] of Object.entries(FACTS)) {
    if (!f.jpRarityCounts || !f.cardTypes) continue;
    const [a, b] = String(f.cardTypes).split("+").map(Number);
    const rc = f.jpRarityCounts;
    const sum = Object.entries(rc).filter(([k, v]) => typeof v === "number" && k !== "don").reduce((s, [, v]) => s + v, 0);
    if (sum !== a || (rc.don || 0) !== b) errors.push(`UP1: set-facts ${code} 레어리티 합 ${sum}+${rc.don || 0} ≠ cardTypes ${f.cardTypes}`);
  }

  // UP1: 발매 전 세트 페이지
  for (const p of UP.pages || []) {
    const f = `sets/${p.slug}.html`;
    if (!exists(f)) { errors.push(`UP1: ${f} 가 없다`); continue; }
    const html = read(f);
    const sf = FACTS[p.code] || {};
    if (!sf.jpRelease || sf.jpRelease.date !== p.releaseJp) errors.push(`UP1: ${p.code} set-facts jpRelease(${sf.jpRelease && sf.jpRelease.date}) ≠ upcoming releaseJp(${p.releaseJp})`);
    if (!sf.enRelease || sf.enRelease.date !== p.releaseEn) errors.push(`UP1: ${p.code} set-facts enRelease(${sf.enRelease && sf.enRelease.date}) ≠ upcoming releaseEn(${p.releaseEn})`);
    const typesRow = (p.facts || []).find(([l]) => l === "Total card types");
    if (sf.cardTypes && (!typesRow || !typesRow[1].replace(/\s+/g, "").startsWith(sf.cardTypes))) errors.push(`UP1: ${f} "Total card types" ≠ set-facts ${sf.cardTypes}`);
    if (/\bNot listed\b/i.test(html)) errors.push(`UP1: ${f} 에 "Not listed" 가 남아 있다 — 공식 값이 있으면 값을, 없으면 "Not stated … (checked 날짜)"`);
    const checked = long(p.modified);
    for (const m of html.replace(/<[^>]+>/g, " ").matchAll(/\b(?:[Cc]hecked|[Rr]ead)(?: on)? ([A-Z][a-z]+ \d{1,2}, \d{4})/g)) {
      if (m[1] !== checked) { errors.push(`UP1: ${f} 확인일 "${m[0]}" ≠ modified ${checked}`); break; }
    }
    const lds = ldBlocks(html);
    const prods = lds.filter((j) => j["@type"] === "Product");
    for (const [label, want] of [["Japanese", p.releaseJp], ["English", p.releaseEn]]) {
      const pr = prods.find((j) => new RegExp(`\\(${label}\\)$`).test(j.name || ""));
      if (!pr || pr.releaseDate !== want) errors.push(`UP1: ${f} Product(${label}) releaseDate ${pr ? pr.releaseDate : "없음"} ≠ ${want}`);
    }
    // 수정일 = 사실 확인일(modified)과 화면에 찍힌 시세 날짜("as of/through YYYY-MM-DD", "through Month D, YYYY") 중 가장 늦은 날 — 2026-10-15(2차).
    // 종전엔 modified 로 잠가 "Presale … through 2026-10-15" 인 페이지의 수정일이 10-14 였다. 화면 날짜에서 다시 계산하므로
    // 그보다 이른 날(백데이트)도, 화면 어디에도 없는 늦은 날(지어낸 날)도 실패한다.
    const isoLong = (t) => { const m = String(t).match(/^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/); const i = m ? MONTHS.indexOf(m[1]) : -1; return i >= 0 ? `${m[3]}-${String(i + 1).padStart(2, "0")}-${m[2].padStart(2, "0")}` : null; };
    const vis = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const dataDays = [...vis.matchAll(/\b(?:as of|through) (\d{4}-\d{2}-\d{2})\b/g)].map((m) => m[1])
      .concat([...vis.matchAll(/\bthrough ([A-Z][a-z]+ \d{1,2}, \d{4})/g)].map((m) => isoLong(m[1])).filter(Boolean));
    const wantMod = [p.modified, ...dataDays].sort().pop();
    const art = lds.find((j) => j["@type"] === "Article");
    if (!art || art.dateModified !== wantMod) errors.push(`UP1: ${f} Article dateModified ${art ? art.dateModified : "없음"} ≠ ${wantMod}(사실 확인일 ${p.modified}·화면 시세 날짜 중 늦은 날)`);
    if (!html.includes(`<meta property="article:modified_time" content="${wantMod}" />`)) errors.push(`UP1: ${f} article:modified_time ≠ ${wantMod}`);
    if (!new RegExp(`Updated <time datetime="${wantMod}">[^<]*</time> · Published <time datetime="${p.published}">`).test(html)) errors.push(`UP1: ${f} 바이라인이 "Updated ${wantMod} · Published" 순서가 아니다`);
    if ((p.revealedCards || []).length) {
      const tbl = html.match(/<table class="factTable revTbl[^"]*">[\s\S]*?<\/table>/);
      const rows = tbl ? [...tbl[0].matchAll(/<tr><td><a href="([^"]+)"[^>]*>([^<]+)<\/a><\/td>/g)] : [];
      if (rows.length !== p.revealedCards.length) errors.push(`UP1: ${f} 공개 카드 표 ${rows.length}행 ≠ 데이터 ${p.revealedCards.length}장(번호 링크는 첫 칸)`);
    }
  }

  // RD1: 발매일 글 — 원천(set-facts)과 표·ItemList 가 같아야 한다
  const RF = "articles/one-piece-set-list-release-dates.html";
  if (exists(RF)) {
    const html = read(RF);
    const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    if (!/\b2026\b/.test(title) || title.length > 60) errors.push(`RD1: ${RF} title "${title}" — 2026 포함·60자 이내`);
    if (/\b(?:checked|read)(?: on)? September (?:28|30), 2026/i.test(html)) errors.push(`RD1: ${RF} 에 낡은 확인일(September 28/30)이 남아 있다`);
    const top = (html.match(/<!-- RELEASE-TOP:START -->[\s\S]*?<!-- RELEASE-TOP:END -->/) || [""])[0];
    const factsBlk = (html.match(/<!-- RELEASE-FACTS:START -->[\s\S]*?<!-- RELEASE-FACTS:END -->/) || [""])[0];
    if (!top || !factsBlk) errors.push(`RD1: ${RF} RELEASE-TOP/RELEASE-FACTS 표시 구간이 없다 — inject-set-list-prices.js 가 굽는 자리`);
    // 최신 발매 세트는 손으로 적지 않고 데이터로(set-facts 일본판 발매일 ≤ 데이터일 중 가장 늦은 OP) — 2026-10-14 QA.
    let asOfRD = "";
    try { asOfRD = JSON.parse(read("data/box-sold-series.json")).asOf || ""; } catch {}
    const relRD = (c) => (FACTS[c] && FACTS[c].jpRelease && FACTS[c].jpRelease.date) || null;
    const newestRD = Object.keys(FACTS).filter((c) => /^OP-\d+$/.test(c) && relRD(c) && relRD(c) <= asOfRD).sort((a, b) => relRD(a).localeCompare(relRD(b))).pop();
    for (const code of [newestRD, ...(UP.pages || []).map((p) => p.code)].filter(Boolean)) {
      const sf = FACTS[code] || {};
      const jp = sf.jpRelease && sf.jpRelease.date, en = sf.enRelease && sf.enRelease.date;
      if (!jp || !en) { errors.push(`RD1: set-facts ${code} 에 jpRelease·enRelease 가 없다`); continue; }
      if (!new RegExp(`<a href="\\.\\./sets/${code.toLowerCase()}\\.html">(?:<span[^>]*>)?${code} release date`).test(top)) errors.push(`RD1: ${RF} 맨 위 표에 ${code} 행이 없다`);
      for (const iso of [jp, en]) if (!top.includes(`<time datetime="${iso}">`)) errors.push(`RD1: ${RF} 맨 위 표 ${code} 날짜 ${iso} 없음`);
      const sec = (factsBlk.match(new RegExp(`<h2 id="${code.toLowerCase()}"[^>]*>${code} release date</h2>[\\s\\S]*?</p>`)) || [""])[0];
      if (!sec) { errors.push(`RD1: ${RF} "${code} release date" H2 가 없다`); continue; }
      for (const iso of [jp, en]) if (!sec.includes(`<time datetime="${iso}">`)) errors.push(`RD1: ${RF} ${code} 구간 날짜 ${iso} 없음`);
      if (sf.cardTypes && !sec.includes(`<td>${sf.cardTypes}</td>`)) errors.push(`RD1: ${RF} ${code} 구간 카드 종류 ≠ ${sf.cardTypes}`);
    }
    // 세트 목록 표: 일본 발매일 = set-facts, 영문 칸 → -english 페이지, ItemList = 표
    // ItemList 는 ListItem(이름·주소)만 — 발매일 Product 에 offers/review/aggregateRating 이 없어 GSC 무효 항목이 됐다(2026-10-14 QA).
    const itemList = ldBlocks(html).find((j) => j["@type"] === "ItemList");
    const items = itemList ? itemList.itemListElement : [];
    if (items.some((e) => e.item && e.item["@type"] === "Product")) errors.push(`RD1: ${RF} ItemList 안에 Product — offers 없는 Product 는 무효 항목이다(ListItem 이름·주소로)`);
    for (const e of items) if (e.url && !exists(e.url.replace("https://opboxindex.com/", ""))) errors.push(`RD1: ${RF} ItemList 주소 ${e.url} 가 저장소에 없다(404)`);
    const jpOfArticle = {};
    let rowsN = 0;
    for (const m of html.matchAll(/<tr><td>((?:OP|EB|PRB)-\d+)<\/td><td>([\s\S]*?)<\/td><td>([^<]*)<\/td><td>([\s\S]*?)<\/td><td class="num">/g)) {
      rowsN++;
      const [, code, , jpTxt, enCell] = m;
      const jpIso = isoOf(jpTxt), enIso = isoOf(enCell);
      jpOfArticle[code] = jpIso;
      const sf = FACTS[code] || {};
      if (!sf.jpRelease && jpIso) errors.push(`RD1: ${RF} ${code} JP ${jpTxt} — set-facts 에 출처·확인일이 없는 날짜(공식 확인 전엔 "—")`);
      if (sf.jpRelease && sf.jpRelease.date && jpIso !== sf.jpRelease.date) errors.push(`RD1: ${RF} ${code} JP ${jpTxt} ≠ set-facts ${sf.jpRelease.date}`);
      const eng = `sets/${code.toLowerCase()}-english.html`;
      if (enIso && exists(eng) && !enCell.includes(`href="../${eng}"`)) errors.push(`RD1: ${RF} ${code} 영문 발매일 칸이 ${eng} 로 링크되지 않았다`);
      if (jpIso && !items.some((it) => new RegExp(` ${code} .*\\(Japanese\\): ${jpIso}$`).test(it.name || ""))) errors.push(`RD1: ${RF} ItemList 에 ${code} 일본판 ${jpIso} 가 없다`);
      if (enIso && !items.some((it) => new RegExp(` ${code} .*\\(English\\): ${enIso}$`).test(it.name || ""))) errors.push(`RD1: ${RF} ItemList 에 ${code} 영문판 ${enIso} 가 없다`);
    }
    if (!rowsN) errors.push(`RD1: ${RF} 세트 목록 표 행을 못 읽었다`);
    if (!itemList || items.length < rowsN) errors.push(`RD1: ${RF} ItemList ${items.length}개 < 표 ${rowsN}행`);
    // ja 발매일 표 ↔ 영문 발매일 글 — 같은 세트의 일본 발매일이 같아야 한다(EB-04 가 영문 'Jan 31, 2026' · ja '—' 로 갈렸다, 2026-10-14 QA)
    if (exists("ja/release-dates.html")) {
      const ja = read("ja/release-dates.html");
      for (const m of ja.matchAll(/<tr><td>(?:<time datetime="(\d{4}-\d{2}-\d{2})">[^<]*<\/time>|—)<\/td><td>[\s\S]*?<\/td><td class="num">((?:OP|EB|PRB)-\d+)<\/td>/g)) {
        const [, jaIso, code] = m;
        if (code in jpOfArticle && (jaIso || null) !== (jpOfArticle[code] || null)) errors.push(`RD1: ${code} 일본 발매일 ja/release-dates ${jaIso || "—"} ≠ ${RF} ${jpOfArticle[code] || "—"}`);
      }
      const jaLd = ldBlocks(ja).find((j) => j["@type"] === "ItemList");
      if (jaLd && (jaLd.itemListElement || []).some((e) => e.item && e.item["@type"] === "Product")) errors.push("RD1: ja/release-dates.html ItemList 안에 Product — ListItem(이름·주소)로");
    }
  }

  // AD1: 모든 글의 날짜 — sync-article-dates.js 한 곳의 규칙(본문이 바뀐 날·메타·바이라인 Updated 먼저)과 같아야 한다
  try {
    const sad = require("./sync-article-dates.js");
    const today = new Date().toISOString().slice(0, 10);
    for (const rel of sad.listArticles()) {
      const html = read(rel);
      const w = sad.wantedDates(rel, html, today);
      if (!w) continue;
      if (sad.applyDates(html, w.pub, w.mod) !== html) {
        const ld = sad.articleLd(html);
        errors.push(`AD1: ${rel} 날짜가 규칙과 다르다(파일 dateModified ${ld && ld.json.dateModified} · 규칙 ${w.mod} · ${w.reason}) — node tools/sync-article-dates.js`);
      }
    }
  } catch (e) { errors.push("AD1: 글 날짜 검사 실패 — " + e.message); }
}

// ── CL1. 세트별 공식 카드리스트 — 2026-10-14 신설(W7).
//    원천은 data/official-cardlist.json(fetch-official-cardlist.js) 하나. 소유자 결정: 사실 열만, 효과 텍스트·카드 이미지 금지,
//    페이지마다 공식 출처 링크와 확인일. 여기서 페이지를 공식 데이터와 직접 대조한다(생성기 코드를 거치지 않는 독립 검사):
//    (a) 데이터 — 저장 필드 화이트리스트(효과 텍스트 칸이 생기면 FAIL), 상품의 모든 ID 가 카드 표에 있다
//    (b) 일본판 상품마다 sets/·ko/ 페이지가 있고 표 행(data-id) = 공식 ID 목록(개수·순서), 요약 "Cards N" = 개수
//    (c) 효과 텍스트 표식·<img>·공식 이미지 주소 0 (페이지·CSV·JSON)
//    (d) 공식 출처 링크(series)와 확인일(checked) 표기, 박스 값 = box-sold-series current(D17 과 같은 값) 또는 "—"
//    (e) 사이트맵에 두 페이지, llms.txt 에 영문 페이지, CSV·JSON 행 수 = 공식 수
{
  const OFF = "data/official-cardlist.json";
  if (!exists(OFF)) errors.push(`CL1: ${OFF} 가 없다 — node tools/fetch-official-cardlist.js`);
  else {
    let D = null;
    try { D = JSON.parse(read(OFF)); } catch (e) { errors.push(`CL1: ${OFF} JSON 파싱 실패 — ${e.message}`); }
    const ALLOWED = ["num", "rarity", "type", "name", "costKind", "cost", "attribute", "power", "counter", "color", "feature", "trigger"];
    const EFFECT = /【(?:登場時|起動メイン|アタック時|ブロッカー|カウンター|トリガー|自分のターン中|相手のターン中|KO時|ドン!!×\d)】|\[(?:On Play|Activate: ?Main|When Attacking|Blocker|Trigger|Counter|Your Turn|Opponent's Turn|On K\.O\.|DON!! x\d|Rush|Double Attack|Banish)\]/;
    if (D) {
      for (const lang of ["jp", "en"]) {
        const L = D[lang] || {};
        for (const [id, c] of Object.entries(L.cards || {})) {
          const extra = Object.keys(c).filter((k) => !ALLOWED.includes(k));
          if (extra.length) { errors.push(`CL1: ${OFF} ${lang} ${id} 에 저장 목록 밖 필드 ${extra.join(",")} — 효과 텍스트 등은 저장하지 않는다`); break; }
          if (EFFECT.test(JSON.stringify(c))) { errors.push(`CL1: ${OFF} ${lang} ${id} 에 효과 텍스트 표식`); break; }
        }
        for (const [code, p] of Object.entries(L.products || {})) {
          const miss = (p.ids || []).filter((id) => !(L.cards || {})[id]);
          if (miss.length) errors.push(`CL1: ${OFF} ${lang} ${code} ID ${miss.length}개가 카드 표에 없다(${miss[0]})`);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(p.checked || "")) errors.push(`CL1: ${OFF} ${lang} ${code} 확인일(checked)이 없다`);
        }
      }
      let SSv = {};
      try { SSv = JSON.parse(read("data/box-sold-series.json")).sets || {}; } catch {}
      const moneyV = (v) => "$" + Math.round(v).toLocaleString("en-US");
      const sm = exists("sitemap.xml") ? read("sitemap.xml") : "";
      const llmsTxt = exists("llms.txt") ? read("llms.txt") : "";
      for (const [code, p] of Object.entries((D.jp || {}).products || {})) {
        if (!/^(?:OP|EB|PRB)-\d{2}$/.test(code)) continue;
        const slug = code.toLowerCase();
        // 표 순서 = 그 세트 번호 먼저, 다른 세트 번호 뒤(각각 공식 목록 순서) — 2026-10-14 QA. 생성기와 독립으로 다시 계산한다.
        const ownPre = code.replace("-", "") + "-";
        const want = [...(p.ids || []).filter((id) => id.startsWith(ownPre)), ...(p.ids || []).filter((id) => !id.startsWith(ownPre))];
        const enUrl = `https://opboxindex.com/sets/${slug}-card-list.html`, koUrl = `https://opboxindex.com/ko/${slug}-card-list.html`;
        for (const [f, lbl] of [[`sets/${slug}-card-list.html`, "Cards"], [`ko/${slug}-card-list.html`, "카드"]]) {
          if (!exists(f)) { errors.push(`CL1: ${f} 가 없다 — 공식 목록에 ${code} 가 있다(node tools/generate-card-list-pages.js)`); continue; }
          const html = read(f);
          const ids = [...html.matchAll(/<tr id="[^"]+" data-id="([^"]+)">/g)].map((m) => m[1]);
          if (ids.length !== want.length) errors.push(`CL1: ${f} 표 ${ids.length}행 ≠ 공식 ${code} ${want.length}장`);
          else if (ids.some((id, i) => id !== want[i])) errors.push(`CL1: ${f} 표 행 순서·ID 가 공식 목록(자기 세트 번호 먼저)과 다르다(${ids.find((id, i) => id !== want[i])})`);
          if (!html.includes(`${lbl}</span> <b>${want.length}</b>`) && !html.includes(`<span>${lbl} <b>${want.length}</b>`)) errors.push(`CL1: ${f} 요약 "${lbl} ${want.length}" 이 없다`);
          if (/<img\b/i.test(html) || /onepiece-cardgame\.com\/images/i.test(html)) errors.push(`CL1: ${f} 에 이미지 — 카드 이미지는 쓰지 않는다(외부 이미지 0)`);
          if (EFFECT.test(html)) errors.push(`CL1: ${f} 에 효과 텍스트 표식(${(html.match(EFFECT) || [])[0]})`);
          if (!html.includes(`href="${p.url}"`)) errors.push(`CL1: ${f} 공식 출처 링크(${p.url})가 없다`);
          if (!html.includes(`<time datetime="${p.checked}">${p.checked}</time>`)) errors.push(`CL1: ${f} 공식 목록 확인일 ${p.checked} 표기가 없다`);
          const cur = (SSv[code] && SSv[code].current && SSv[code].current.jp) || null;
          const boxM = html.match(/(?:JP box sold median|일본판 박스 판매 중앙값) <b>([^<]*)<\/b>/);
          if (!boxM) errors.push(`CL1: ${f} 일본판 박스 값 줄이 없다`);
          else if (boxM[1] !== (cur ? moneyV(cur.median) : "—")) errors.push(`CL1: ${f} 일본판 박스 "${boxM[1]}" ≠ box-sold-series current "${cur ? moneyV(cur.median) : "—"}"`);
        }
        for (const [f, n] of [[`sets/${slug}-card-list.csv`, (t) => t.trim().split("\n").length - 1], [`sets/${slug}-card-list.json`, (t) => (JSON.parse(t).cards || []).length]]) {
          if (!exists(f)) { errors.push(`CL1: ${f} 가 없다`); continue; }
          const t = read(f);
          let got = -1;
          try { got = n(t); } catch (e) { errors.push(`CL1: ${f} 읽기 실패 — ${e.message}`); }
          if (got !== want.length) errors.push(`CL1: ${f} ${got}행 ≠ 공식 ${want.length}장`);
          if (EFFECT.test(t)) errors.push(`CL1: ${f} 에 효과 텍스트 표식`);
        }
        for (const u of [enUrl, koUrl]) if (!sm.includes(`<loc>${u}</loc>`)) errors.push(`CL1: sitemap.xml 에 ${u} 가 없다`);
        if (exists(`sets/${slug}-card-list.html`) && /Power -(?:<| ·)/.test(read(`sets/${slug}-card-list.html`))) errors.push(`CL1: sets/${slug}-card-list.html 빈 파워가 "-" 로 나간다 — 값이 없으면 "—" 또는 생략`);
        if (!llmsTxt.includes(enUrl)) errors.push(`CL1: llms.txt 에 ${enUrl} 가 없다`);
      }
      // 우리 숫자 칸(경매 JP/EN·PSA 10) — 원천 변형과 정확히 같고, suspect 아니고, 표본 3건 이상, 같은 키를 두 ID 가 나눠 갖지 않는다(2026-10-14 QA).
      try {
        const { checkCells } = require("./card-list-cell-check");
        const docs = Object.keys((D.jp || {}).products || {}).filter((c) => /^(?:OP|EB|PRB)-\d{2}$/.test(c) && exists(`sets/${c.toLowerCase()}-card-list.json`)).map((c) => JSON.parse(read(`sets/${c.toLowerCase()}-card-list.json`)));
        const AUC = JSON.parse(read("data/auction-card-stats.json"));
        // 경매 수집 워크플로(매시간)는 원천만 바꾸고 카드리스트를 다시 굽지 않는다 — 그때 어긋남으로 수집 커밋을 막으면 데이터를 잃는다
        // ([[opbox-never-miss-collection]]). 카드리스트 파일을 이번 실행이 바꿨을 때만 FAIL, 아니면 경고(다음 페이지 생성이 바로잡는다).
        const touched = (() => { try { const r = spawnSync("git", ["status", "--porcelain", "--", "sets/*-card-list.json"], { cwd: ROOT, encoding: "utf8" }); return r.status !== 0 || !!String(r.stdout || "").trim(); } catch { return true; } })();
        for (const p of checkCells(docs, AUC).slice(0, 10)) (touched ? errors : warnings).push(`CL1${touched ? "" : "(경고)"}: 카드리스트 칸 — ${p}`);
      } catch (e) { errors.push("CL1: 카드리스트 칸 검사 실패 — " + e.message); }
    }
  }
}

// ── KF1. 세트 페이지 상단 Key facts — 2026-10-14 신설(W5a).
//    사고: ChatGPT 가 보내던 세트 페이지(sets/op-01-english·op-16·op-01)에서 발매일·정가·팩 수가 HTML 97% 지점(접힌 재판 이력)에만
//    있었고, 머리의 카드 수는 낡은 값(OP-01 "106 cards" — 공식 121종·154장), 발매일은 "Aug 2026" 처럼 월 단위였다.
//    OP-17 은 Top 10 표가 있는데 "chase list is verified" 뒤에 카드 데이터를 붙인다는 문장이 남아 있었다.
//    생성기(set-page-shared.keyFactsModel)를 거치지 않고 원장·공식 데이터와 직접 대조한다:
//    (a) 일본판·영문판·한국어 세트 페이지마다 H1 바로 아래(사이엔 nextLinks 만) kfTable. 영어 페이지는 HTML 앞쪽 25% 안,
//        한국어 페이지(머리가 본문보다 커서 바이트로는 못 잰다)는 본문 글자 앞쪽 25% 안
//    (b) 행 = 원천: sold = box-sold-series 그 판 current(값·건수·날짜, 없으면 "—" — 2026-10-14 QA: 표와 같은 28일 규칙) · ask = bestListing 총액(구매 버튼 값과 같다) 또는 "—" ·
//        발매일 = set-facts jpRelease / enRelease(없으면 packs release) · 정가·팩 수 = set-facts · 카드 종류 = set-facts cardTypes(공식)
//        또는 공식 카드 리스트 번호 수 · 카드 리스트 = 공식 목록 장수 + 첫 칸 링크
//    (c) Product JSON-LD releaseDate = 표 발매일(일본판 페이지 JP · 영문판 EN), AggregateOffer lowPrice = 표 최저 매물가
//    (d) 월 단위 날짜("Aug 2026") 0, Top 10 카드가 있는 세트에 "chase list is verified" 0
//    (e) 최신 세트(계열별 가장 늦은 일본판 발매 · 120일 이내 · 공식 카드 리스트): 제목·H1 에 Release Date. "Card List" 는 카드리스트 페이지(<code>-card-list.html)
//        몫이라 세트 페이지 제목에 넣지 않는다 — 2026-10-14 QA: sets/op-17 과 op-17-card-list 가 "op 17 card list" 질의를 두고 경쟁했다.
{
  let P = null, SS = {}, SF = {}, OFF = null;
  try { P = JSON.parse(read("data/onepiece-packs.json")); SS = JSON.parse(read("data/box-sold-series.json")).sets || {}; SF = JSON.parse(read("data/set-facts.json")).sets || {}; } catch (e) { errors.push("KF1: 원천 읽기 실패 — " + e.message); }
  try { OFF = JSON.parse(read("data/official-cardlist.json")); } catch {}
  if (P) {
    const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
    const textOf = (h) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
    const bodyText = (h) => h.replace(/<head[\s\S]*?<\/head>/, " ").replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const ldOf = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
    const asOf = P.updated || "";
    const codes = [...((P.jp || {}).list || []), ...((P.extra || {}).list || [])].filter((c) => exists(`sets/${c.toLowerCase()}.html`));
    const product = (code) => (OFF && OFF.jp && OFF.jp.products && OFF.jp.products[code]) || null;
    // 최신 세트 — 계열별 가장 늦은 일본판 발매(asOf 이전), 120일 이내, 공식 카드 리스트 있음
    const latest = new Set();
    {
      const best = {};
      for (const c of codes) {
        const d = SF[c] && SF[c].jpRelease && SF[c].jpRelease.date;
        if (!d || d > asOf) continue;
        const fam = c.split("-")[0];
        if (!best[fam] || d > best[fam].d) best[fam] = { c, d };
      }
      for (const { c, d } of Object.values(best)) if ((Date.parse(asOf) - Date.parse(d)) / 864e5 <= 120 && product(c)) latest.add(c);
    }
    let checked = 0;
    for (const code of codes) {
      const slug = code.toLowerCase();
      const s = P.sets[code] || {}, sf = SF[code] || {}, ser = SS[code] || {};
      const jpRel = (sf.jpRelease && sf.jpRelease.date) || null;
      const enRel = (sf.enRelease && sf.enRelease.date) || s.release || null;
      if (sf.enRelease && sf.enRelease.date && s.release && sf.enRelease.date !== s.release) errors.push(`KF1: ${code} 영문 발매일이 set-facts(${sf.enRelease.date})와 packs(${s.release})에서 다르다`);
      const prod = product(code);
      const numbers = prod ? new Set(prod.ids.map((id) => ((OFF.jp.cards || {})[id] || {}).num)).size : null;
      for (const [f, ed, lang] of [[`sets/${slug}.html`, "jp", "en"], [`sets/${slug}-english.html`, "en", "en"], [`ko/${slug}.html`, "jp", "ko"]]) {
        if (!exists(f)) continue;
        checked++;
        const html = read(f);
        const at = html.indexOf('<table class="kfTable');
        const h1End = html.indexOf("</h1>");
        if (at < 0) { errors.push(`KF1: ${f} 에 Key facts 표(kfTable)가 없다 — H1 바로 아래 라벨:값 표`); continue; }
        const between = html.slice(h1End + 5, at).replace(/<nav class="nextLinks"[^>]*>[\s\S]*?<\/nav>/, "").replace(/\s+/g, "");
        if (h1End < 0 || h1End > at || between) errors.push(`KF1: ${f} Key facts 표가 H1 바로 아래가 아니다(사이: ${between.slice(0, 60) || "H1 없음"})`);
        if (lang === "en") {
          if (at / html.length > 0.25) errors.push(`KF1: ${f} Key facts 표가 HTML ${(at / html.length * 100).toFixed(1)}% 지점 — 앞쪽 25% 안이어야 한다(머리 CSS·구조화데이터 증가 확인)`);
        } else {
          const all = bodyText(html).length, before = bodyText(html.slice(0, at)).length;
          if (before / all > 0.25) errors.push(`KF1: ${f} Key facts 표가 본문 글자 ${(before / all * 100).toFixed(1)}% 지점 — 앞쪽 25% 안이어야 한다`);
        }
        const tbl = html.slice(at, html.indexOf("</table>", at));
        const row = {}, head = {};
        for (const m of tbl.matchAll(/<tr data-k="(\w+)"><th scope="row">([\s\S]*?)<\/th><td>([\s\S]*?)<\/td><\/tr>/g)) { head[m[1]] = m[2]; row[m[1]] = m[3]; }
        // types 행은 반다이 상품 페이지의 종류 수가 있을 때만(없으면 카드 리스트 행 하나 — 같은 숫자를 두 줄로 쓰지 않는다)
        for (const k of ["sold", "ask", "release", "msrp", "packs", "cardlist", ...(sf.cardTypes || !prod ? ["types"] : [])]) if (row[k] == null) errors.push(`KF1: ${f} Key facts 에 ${k} 행이 없다`);
        if (!sf.cardTypes && prod && row.types != null) errors.push(`KF1: ${f} 상품 페이지 종류 수가 없는데 types 행이 있다 — 카드 리스트 행과 같은 숫자를 두 번 쓴다`);
        if (/ebay\.com/i.test(tbl)) errors.push(`KF1: ${f} Key facts 표에 eBay 링크 — 표는 제휴 고지(affTop)보다 앞이라 제휴 링크를 두지 않는다`);
        // sold — 그 판 current(지표칸 "Box price"·모든 표와 같은 값). current 가 없으면 "—"(날짜 붙은 옛 값 금지)
        const last = (ser.current && ser.current[ed]) || null;
        if (row.sold != null) {
          const t = textOf(row.sold);
          if (!last) { if (!t.startsWith("—") || /\$/.test(t)) errors.push(`KF1: ${f} sold "${t}" — current 가 없으면 "—"(28일 넘은 값을 날짜와 함께 내지 않는다)`); }
          else {
            if (!t.startsWith(money(last.median))) errors.push(`KF1: ${f} sold "${t.slice(0, 30)}" ≠ ${code}.${ed} current ${money(last.median)}`);
            if (!row.sold.includes(`<time datetime="${last.d}">`)) errors.push(`KF1: ${f} sold 기준일 ≠ current ${last.d}`);
            if (last.n != null && !(lang === "ko" ? t.includes(`${last.n}건`) : t.includes(`${last.n} sales`))) errors.push(`KF1: ${f} sold 건수 ≠ ${last.n}`);
          }
        }
        // ask — 검증된 최저 실매물(구매 버튼과 같은 값)
        const bl = s.boxMarket && s.boxMarket[ed] && s.boxMarket[ed].ebayActive && s.boxMarket[ed].ebayActive.bestListing;
        let askV = null;
        if (row.ask != null) {
          const t = textOf(row.ask);
          if (t !== "—") {
            askV = Number((t.match(/^\$([\d,]+)/) || [])[1]?.replace(/,/g, ""));
            if (!bl || bl.total == null || money(bl.total) !== `$${askV.toLocaleString("en-US")}`) errors.push(`KF1: ${f} ask "${t.slice(0, 20)}" ≠ ${code}.${ed} 최저 실매물 ${bl && bl.total != null ? money(bl.total) : "없음"}`);
          }
          const buy = html.match(/<a class="buyNow"[^>]*>[\s\S]*?<b>(\$[\d,]+)<\/b>/);
          if (lang === "en" && (buy ? buy[1] : null) !== (askV != null ? `$${askV.toLocaleString("en-US")}` : null)) errors.push(`KF1: ${f} 구매 버튼 ${buy ? buy[1] : "없음"} ≠ 표 최저 매물가 ${askV != null ? "$" + askV : "—"} — 같은 함수(lowestAsk)여야 한다`);
        }
        // 발매일·정가·팩 수·카드 종류·카드 리스트 — 세트 단위 사실, 세 페이지 같은 값
        if (row.release != null) {
          if (jpRel && !row.release.includes(`<time datetime="${jpRel}">`)) errors.push(`KF1: ${f} 일본판 발매일 ≠ set-facts ${jpRel}`);
          if (enRel && !row.release.includes(`<time datetime="${enRel}">`)) errors.push(`KF1: ${f} 영문판 발매일 ≠ ${enRel}`);
        }
        if (row.msrp != null) {
          const t = textOf(row.msrp);
          if (sf.jpMsrpYen && !t.includes("¥" + sf.jpMsrpYen.toLocaleString("en-US"))) errors.push(`KF1: ${f} 일본판 정가 ≠ ¥${sf.jpMsrpYen}`);
          const enPack = sf.enRelease && sf.enRelease.msrpUsdPerPack;
          if (enPack != null ? !t.includes(`$${Number(enPack).toFixed(2)}`) : /\$/.test(t)) errors.push(`KF1: ${f} 영문판 정가 "${t}" ≠ set-facts ${enPack != null ? "$" + enPack : "없음(—)"}`);
        }
        if (row.packs != null && (sf.packsPerBox ? !textOf(row.packs).startsWith(String(sf.packsPerBox)) : textOf(row.packs) !== "—")) errors.push(`KF1: ${f} 박스당 팩 수 "${textOf(row.packs)}" ≠ set-facts ${sf.packsPerBox || "—"}`);
        if (row.types != null) {
          const t = textOf(row.types);
          const want = sf.cardTypes ? String(sf.cardTypes) : numbers != null ? String(numbers) : "—";
          if (want === "—" ? t !== "—" : !t.startsWith(want + " ")) errors.push(`KF1: ${f} 카드 종류 "${t.slice(0, 30)}" ≠ ${sf.cardTypes ? `set-facts ${sf.cardTypes}` : `공식 카드 리스트 번호 ${want}`}`);
          if (sf.cardTypes && !/Bandai product page|반다이 상품 페이지/.test(t)) errors.push(`KF1: ${f} 카드 종류에 출처 라벨(Bandai product page)이 없다 — 카드 리스트(Bandai card list)와 구분`);
        }
        if (row.cardlist != null) {
          const t = textOf(row.cardlist);
          if (prod) {
            if (!head.cardlist.includes(`href="${slug}-card-list.html"`)) errors.push(`KF1: ${f} 카드 리스트 링크(첫 칸)가 ${slug}-card-list.html 이 아니다`);
            if (!t.startsWith(String(prod.ids.length) + " ")) errors.push(`KF1: ${f} 카드 리스트 "${t.slice(0, 20)}" ≠ 공식 ${prod.ids.length}장`);
          } else if (t !== "—") errors.push(`KF1: ${f} 공식 카드 리스트가 없는데 "${t}"`);
        }
        // 구조화데이터 — 화면 값과 같아야 한다
        if (lang === "en") {
          const prodLd = ldOf(html).find((j) => j["@type"] === "Product");
          if (prodLd) {
            const wantRel = ed === "jp" ? jpRel : enRel;
            if (wantRel && prodLd.releaseDate !== wantRel) errors.push(`KF1: ${f} Product releaseDate ${prodLd.releaseDate} ≠ 표 ${wantRel}`);
            const of = prodLd.offers || {};
            if (askV != null && of["@type"] === "AggregateOffer" && of.lowPrice !== askV) errors.push(`KF1: ${f} AggregateOffer lowPrice ${of.lowPrice} ≠ 표 최저 매물가 ${askV}`);
          }
          // 월 단위 날짜 금지(관측일·발매일은 일 단위로) · 카드 목록이 있는데 "chase list is verified"
          const mm = bodyText(html).match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/);
          if (mm) errors.push(`KF1: ${f} 월 단위 날짜 "${mm[0]}" — 일 단위(ISO)로`);
          if (/card list/i.test(((html.match(/<title>([^<]*)<\/title>/) || [])[1] || ""))) errors.push(`KF1: ${f} 세트 페이지 제목에 "Card List" — 카드리스트 페이지(${slug}-card-list.html)와 같은 질의를 두고 경쟁한다`);
          if ((s.cards || []).length && /chase list is verified/i.test(html)) errors.push(`KF1: ${f} Top 10 카드가 있는데 "chase list is verified" 문장이 남아 있다`);
          // 최신 세트 제목·H1
          if (latest.has(code)) {
            const title = ((html.match(/<title>([^<]*)<\/title>/) || [])[1] || "").replace(/&amp;/g, "&");
            const h1 = textOf((html.match(/<h1>([\s\S]*?)<\/h1>/) || [])[1] || "");
            if (!/release date/i.test(title) || !/release date/i.test(h1)) errors.push(`KF1: ${f} 최신 세트 ${code} 의 제목/H1 에 "release date" 가 없다(제목 "${title}")`);
          }
        }
      }
    }
    if (!checked) errors.push("KF1: 검사한 세트 페이지가 0장이다");
  }
}

// ── RF1. AI 사실 공급(발매·제품 사실) — 2026-10-14 신설(W4).
//    opbox-ai-data.json 의 releaseFacts · llms-full.txt 표 · llms.txt 예정 세트 줄이 data/set-facts.json(반다이 공식 확인값)과
//    한 칸도 어긋나면 안 된다. 답변 AI 는 이 파일들을 그대로 인용한다 — 세트 페이지만 고치고 여기가 낡으면 틀린 발매일이 인용된다.
//    기대값은 모델(ai-data-model.js)을 부르지 않고 원천 파일에서 다시 계산한다.
{
  let AI = null, SF = null, PK = null, OCL = null;
  try { AI = JSON.parse(read("opbox-ai-data.json")); SF = JSON.parse(read("data/set-facts.json")).sets || {}; PK = JSON.parse(read("data/onepiece-packs.json")); } catch (e) { errors.push("RF1: 원천/산출 파일을 못 읽었다 — " + e.message); }
  try { OCL = JSON.parse(read("data/official-cardlist.json")); } catch { OCL = { jp: { products: {} } }; }
  if (AI && SF && PK) {
    const RF = AI.releaseFacts;
    if (!Array.isArray(RF)) errors.push("RF1: opbox-ai-data.json 에 releaseFacts 가 없다");
    else {
      const lists = Object.fromEntries(Object.entries((OCL.jp && OCL.jp.products) || {}).filter(([c]) => /^(OP|EB|PRB)-\d{2}$/.test(c)));
      const want = new Set([...Object.keys(SF), ...Object.keys(lists)]);
      const got = new Map(RF.map((r) => [r.setCode, r]));
      for (const c of want) if (!got.has(c)) errors.push(`RF1: releaseFacts 에 ${c} 가 없다(set-facts·공식 카드리스트에 있음)`);
      for (const c of got.keys()) if (!want.has(c)) errors.push(`RF1: releaseFacts 의 ${c} 는 원천에 없다`);
      const full = exists("llms-full.txt") ? read("llms-full.txt") : "";
      const sect = (full.match(/## Release dates and product facts[\s\S]*?\n\n/) || [""])[0];
      if (!sect) errors.push("RF1: llms-full.txt 에 발매·제품 사실 표가 없다");
      const llms = exists("llms.txt") ? read("llms.txt") : "";
      const yenS = (v) => (Number.isFinite(v) ? `¥${v.toLocaleString("en-US")}` : "—");
      const isD = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
      for (const [c, r] of got) {
        if (!want.has(c)) continue;
        const f = SF[c] || {};
        const jpRel = isD(f.jpRelease && f.jpRelease.date) ? f.jpRelease.date : null;
        const enRel = isD(f.enRelease && f.enRelease.date) ? f.enRelease.date : isD(PK.sets && PK.sets[c] && PK.sets[c].release) ? PK.sets[c].release : null;
        const perPack = f.jpMsrpYenPerPack || (f.jpMsrpYen && f.packsPerBox ? Math.round(f.jpMsrpYen / f.packsPerBox) : null);
        const exp = {
          "japanese.releaseDate": jpRel, "english.releaseDate": enRel,
          "japanese.msrpYenPerPack": perPack, "japanese.msrpYenPerBox": f.jpMsrpYen || null, "japanese.packsPerBox": f.packsPerBox || null,
          "japanese.cardsPerPack": f.cardsPerPack || null, "japanese.cardTypes": f.cardTypes ? String(f.cardTypes) : null,
          "english.msrpUsdPerPack": (f.enRelease && f.enRelease.msrpUsdPerPack) || null,
          "officialCardList.cards": lists[c] ? lists[c].ids.length : null,
        };
        for (const [k, v] of Object.entries(exp)) {
          const [a, b] = k.split(".");
          const actual = r[a] == null ? null : r[a][b] == null ? null : r[a][b];
          if (actual !== v) errors.push(`RF1: ${c} ${k} = ${JSON.stringify(actual)} ≠ 원천 ${JSON.stringify(v)}`);
        }
        const known = [jpRel, enRel].filter(Boolean).sort();
        const st = !known.length ? null : known[0] <= AI.datasetUpdatedOn ? "released" : "upcoming";
        if (r.status !== st) errors.push(`RF1: ${c} status ${r.status} ≠ ${st}(발매일 ${known[0] || "—"} vs 데이터일 ${AI.datasetUpdatedOn})`);
        // llms-full.txt 표 행 — 같은 날짜·정가·종수
        const row = (sect.match(new RegExp(`^${c.replace("-", "\\-")} \\|[^\\n]*`, "m")) || [""])[0];
        if (!row) { errors.push(`RF1: llms-full.txt 발매 표에 ${c} 행이 없다`); continue; }
        const cells = row.split(" | ");
        const wantCells = { 3: jpRel || "—", 4: enRel || "—", 5: yenS(perPack), 6: yenS(f.jpMsrpYen || null), 9: f.cardTypes ? String(f.cardTypes) : f.enRelease && f.enRelease.cardTypes ? String(f.enRelease.cardTypes) : "—" };
        for (const [i, v] of Object.entries(wantCells)) if (cells[i] !== v) errors.push(`RF1: llms-full.txt ${c} ${i}번째 칸 "${cells[i]}" ≠ 원천 "${v}"`);
        if (st === "upcoming" && !new RegExp(`${c}[^\\n]*Japan ${jpRel || "—"} · English ${enRel || "—"}`).test(llms)) errors.push(`RF1: llms.txt 의 ${c} 발매일 줄이 원천(JP ${jpRel} · EN ${enRel})과 다르다`);
      }
    }
  }
}

// ── SM1. 사이트맵 lastmod = 본문이 바뀐 날 — 2026-10-14 신설(W9).
//    얕은 checkout + 매일 메뉴·캐시 키 커밋 때문에 222개 중 205개가 매일 오늘 날짜였다. 이제 sync-sitemap-lastmod.js 가
//    본문 해시(메뉴·푸터·스크립트·캐시 키 제외)로만 날짜를 정하고 data/sitemap-lastmod-state.json 에 남긴다.
//    (a) 본문이 바뀌었는데 날짜를 다시 정하지 않았거나 (b) 본문은 그대로인데 생성기가 날짜만 올렸으면 FAIL —
//    sync-sitemap-lastmod.js 를 모든 HTML 생성기·주입기 뒤에서 돌려야 한다(워크플로 순서).
//    배포를 막는 건 "이번 실행이 페이지·사이트맵·피드를 바꾼" 경우뿐이다. 페이지를 안 건드리는 수집 워크플로(경매·TCG·등급,
//    매시간)도 이 가드를 커밋 앞에 돌린다 — 이미 커밋된 날짜 어긋남 때문에 수집 커밋이 막히면 그날 데이터를 잃는다([[opbox-never-miss-collection]]).
//    그때는 경고로만 남기고, 다음 페이지 생성 워크플로가 바로잡는다(FD1 도 같은 기준).
const PUBLISH_TOUCHED = (() => {
  try {
    const r = spawnSync("git", ["status", "--porcelain", "--", "sitemap.xml", "feed.xml", "*.html"], { cwd: ROOT, encoding: "utf8" });
    return r.status !== 0 || !!String(r.stdout || "").trim();
  } catch { return true; }
})();
{
  const sink = PUBLISH_TOUCHED ? errors : warnings;
  const code = PUBLISH_TOUCHED ? "SM1:" : "SM1(경고)";
  try {
    const problems = require("./sync-sitemap-lastmod").verify();
    for (const p of problems.slice(0, 15)) sink.push(`${code} ${p} — node tools/sync-sitemap-lastmod.js 를 생성기 뒤에서 돌릴 것`);
    if (problems.length > 15) sink.push(`${code} 그 밖에 ${problems.length - 15}건`);
  } catch (e) { sink.push(`${code} 사이트맵 날짜 검사 실패 — ` + e.message); }
}

// ── SE1. 가격·MSRP 질의 대응과 구조화데이터 누락 — 2026-10-14 신설(W6a·W6b). 한 번 채운 것이 생성기 수정으로 빠지지 않게.
{
  const dec = (s) => String(s || "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  const titleOf = (h) => dec((h.match(/<title>([^<]*)<\/title>/) || [])[1]);
  const descOf = (h) => dec((h.match(/<meta name="description" content="([^"]*)"/) || [])[1]);
  const lds = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
  if (exists("box-prices.html")) {
    const h = read("box-prices.html");
    if (titleOf(h).length > 60) errors.push(`SE1: box-prices.html 제목 ${titleOf(h).length}자 — 60자 이하`);
    if (/\bFAQ\b/.test(descOf(h))) errors.push("SE1: box-prices.html description 에 FAQ 가 남았다(페이지에 FAQ 없음)");
    const t = h.match(/<table class="homeSummaryTable[^"]*" data-cheapest>[\s\S]*?<\/table>/);
    if (!t || !/<h2 id="cheapest"[^>]*>Cheapest Japanese booster boxes<\/h2>/.test(h)) errors.push("SE1: box-prices.html 에 'Cheapest Japanese booster boxes' 표가 없다");
    else {
      const prices = [...t[0].matchAll(/<tr[^>]*><td><a [^>]*>[^<]+<\/a>[\s\S]*?<td class="num">\$([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, "")));
      if (!prices.length || prices.length > 5) errors.push(`SE1: 최저가 표 행 수 ${prices.length} — 1~5행`);
      if (prices.some((p, i) => i && p < prices[i - 1])) errors.push("SE1: 최저가 표가 가격 오름차순이 아니다");
    }
  }
  const HMP = "articles/how-many-packs-one-piece-booster-box.html";
  if (exists(HMP)) {
    const h = read(HMP);
    if (!/^How Many Packs/.test(titleOf(h)) || !/MSRP by Set/.test(titleOf(h))) errors.push(`SE1: ${HMP} 제목 "${titleOf(h)}" — 'How Many Packs…' 앞머리 + 'MSRP by Set'`);
    if (!/<h2[^>]*>[^<]*Booster Box MSRP by Set[^<]*<\/h2>\s*<p data-pack-math-lead>/.test(h)) errors.push(`SE1: ${HMP} MSRP 표 위 H2 에 'Booster Box MSRP by Set' 이 없다`);
    // "N cards per pack" 영문 주장 = set-facts enPackContents(공식 영문 페이지 확인값) — 2026-10-14 QA: EB-05 영문 페이지엔 장수가 없는데
    // 이 글만 "12 cards per pack for EB-01 and EB-05" 라고 써서 sets/eb-05("not stated")와 반대였다.
    try {
      const SFp = JSON.parse(read("data/set-facts.json")).sets || {};
      const blk = (h.match(/<!-- PACK-FACTS:START -->[\s\S]*?<!-- PACK-FACTS:END -->/) || [""])[0];
      if (!blk) errors.push(`SE1: ${HMP} PACK-FACTS 구간이 없다 — 팩 사실 줄은 inject-pack-math.js 가 set-facts 에서 굽는다`);
      for (const m of blk.matchAll(/>((?:OP|EB|PRB)-\d{2})<\/a> page (lists <strong>(\d+) cards per pack<\/strong>|states no per-pack card count)/g)) {
        const want = ((SFp[m[1]] || {}).enPackContents || {}).cardsPerPack ?? null;
        const got = m[3] ? Number(m[3]) : null;
        if (want !== got) errors.push(`SE1: ${HMP} ${m[1]} 영문 팩 장수 "${got ?? "not stated"}" ≠ set-facts ${want ?? "not stated"}`);
      }
      if (/12 cards per pack<\/strong> for [^.]*EB-05/.test(h)) errors.push(`SE1: ${HMP} EB-05 "12 cards per pack" — 공식 영문 페이지에 없다`);
    } catch (e) { errors.push(`SE1: ${HMP} 팩 사실 검사 실패 — ${e.message}`); }
  }
  // 홈 제목·설명 변경(브랜드·120~155자)은 계획서상 소유자 확인 항목이다 — 확인 전에는 HEAD 값으로 두고(2026-10-14 QA), 길이 상한만 본다.
  if (exists("index.html")) {
    const h = read("index.html");
    if (!titleOf(h) || titleOf(h).length > 60) errors.push(`SE1: 홈 제목 "${titleOf(h)}" — 비었거나 60자 초과`);
    if (!descOf(h) || descOf(h).length > 155) errors.push(`SE1: 홈 description ${descOf(h).length}자 — 비었거나 155자 초과`);
  }
  for (const f of PUBLIC_HTML.filter((x) => /^sets\/(?:op|eb|prb)-\d{2}(?:-english)?\.html$/.test(x))) {
    for (const j of lds(read(f))) if (j["@type"] === "WebPage" && !j.name) errors.push(`SE1: ${f} WebPage.name 이 비었다`);
  }
  for (const f of ["index.html", "box-prices.html", "auction.html", "tcg-auction.html", "psa-grading.html", "ko/index.html"]) {
    if (!exists(f)) continue;
    const ds = lds(read(f)).find((j) => j["@type"] === "Dataset");
    if (!ds) continue;
    for (const k of ["temporalCoverage", "license", "distribution", "url"]) if (!ds[k]) errors.push(`SE1: ${f} Dataset.${k} 누락`);
  }
  // 같은 배포 파일(contentUrl)을 가리키는 Dataset 은 페이지가 달라도 기간이 같아야 한다(tools/dataset-coverage.js 한 곳) — 2026-10-14 QA:
  // opbox-ai-data.json 이 free-data 2026-06-29/10-14 · 홈 2026-07-07/10-13 이었다. 카드리스트 Dataset 은 license·temporalCoverage 필수.
  {
    const cov = new Map(), multi = [];
    for (const f of ["index.html", "packs.html", "box-prices.html", "free-data.html", "psa-grading.html", "ko/index.html", "auction.html", "tcg-auction.html", "weekly.html"]) {
      if (!exists(f)) continue;
      const nodes = lds(read(f)).flatMap((j) => (j["@graph"] ? j["@graph"] : [j])).filter((j) => j && j["@type"] === "Dataset");
      for (const ds of nodes) {
        const dist = [].concat(ds.distribution || []);
        if (/card-lists$/.test(ds["@id"] || "") && (!ds.license || !ds.temporalCoverage)) errors.push(`SE1: ${f} 카드리스트 Dataset 에 license·temporalCoverage 가 없다`);
        if (!ds.temporalCoverage) continue;
        // 같은 파일 전체를 설명하는 Dataset 끼리만 — 경매 JSON 은 페이지(One Piece / TCG)마다 그 파일의 한 부분을 설명한다.
        const urls = dist.map((x) => x && x.contentUrl).filter((u) => u && /\/(?:opbox-ai-data\.json|opbox-set-prices\.csv|opbox-grading-population\.csv|opbox-ai-grading\.json)$/.test(u));
        // 두 파일을 함께 내려주는 Dataset(psa-grading: 등급 CSV + JSON)의 기간은 두 파일 기간의 합 — 아래에서 따로 대조한다(2026-10-15, 3차).
        if (urls.length > 1) { multi.push({ f, urls, tc: ds.temporalCoverage }); continue; }
        for (const u of urls) {
          if (!cov.has(u)) cov.set(u, new Map());
          cov.get(u).set(ds.temporalCoverage, (cov.get(u).get(ds.temporalCoverage) || []).concat(f));
        }
      }
    }
    for (const [u, m] of cov) if (m.size > 1) errors.push(`SE1: ${u} 를 가리키는 Dataset 기간이 페이지마다 다르다 — ${[...m].map(([c, fs]) => `${c}: ${fs.join(", ")}`).join(" / ")}`);
    for (const x of multi) {
      const parts = x.urls.map((u) => (cov.has(u) && cov.get(u).size === 1 ? [...cov.get(u).keys()][0] : null));
      if (parts.some((p) => !p)) continue;
      const ds = parts.flatMap((p) => p.split("/")).sort();
      const want = `${ds[0]}/${ds[ds.length - 1]}`;
      if (x.tc !== want) errors.push(`SE1: ${x.f} 두 파일(${x.urls.map((u) => u.split("/").pop()).join(" + ")}) Dataset 기간 ${x.tc} ≠ 각 파일 기간의 합 ${want}`);
    }
  }
  for (const f of PUBLIC_HTML.filter((x) => x.startsWith("articles/") && x !== "articles/index.html")) {
    const h = read(f);
    if (/<meta name="robots" content="[^"]*noindex/i.test(h)) continue;
    const L = lds(h);
    const art = L.find((j) => j["@type"] === "Article");
    if (art && !art.image) errors.push(`SE1: ${f} Article.image 누락`);
    if (art && !L.some((j) => j["@type"] === "BreadcrumbList")) errors.push(`SE1: ${f} BreadcrumbList 누락`);
  }
  try {
    for (const p of JSON.parse(read("data/upcoming-set-pages.json")).pages || []) {
      const f = `sets/${p.slug}.html`;
      if (!exists(f)) continue;
      const art = lds(read(f)).find((j) => j["@type"] === "Article");
      if (art && !art.image) errors.push(`SE1: ${f} Article.image 누락`);
    }
  } catch {}
}

// ── FD1. RSS 피드 위생 — 2026-10-14 신설(W6b).
//    제목이 "&amp;amp;" 로 두 번 이스케이프돼 나갔고, noindex 글이 실렸고, 발행일순이라 갱신된 글이 아래에 묻혔다.
//    발매 예정 세트 페이지·주간 표·카드리스트는 아예 없었다.
{
  const sink = PUBLISH_TOUCHED ? errors : warnings;
  const FD = PUBLISH_TOUCHED ? "FD1:" : "FD1(경고)";
  // 한국어 피드도 같은 정렬 규칙(최신순) — 2026-10-14 QA
  if (exists("ko/feed.xml")) {
    const kx = read("ko/feed.xml");
    const kd = [...kx.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => ({ link: (m[0].match(/<link>([^<]+)<\/link>/) || [])[1] || "", date: Date.parse((m[0].match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "") || 0 }));
    for (let i = 1; i < kd.length; i++) if (kd[i].date > kd[i - 1].date) { sink.push(`${FD} ko/feed.xml 항목이 날짜 최신순이 아니다(${kd[i].link})`); break; }
  }
  if (exists("feed.xml")) {
    const fx = read("feed.xml");
    if (/&amp;(?:amp|lt|gt|quot|#\d+);/.test(fx)) sink.push(FD + " feed.xml 에 이중 이스케이프(&amp;amp; 등)가 있다");
    const items = [...fx.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => ({
      link: (m[0].match(/<link>([^<]+)<\/link>/) || [])[1] || "",
      date: Date.parse((m[0].match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "") || 0,
    }));
    for (let i = 1; i < items.length; i++) if (items[i].date > items[i - 1].date) { sink.push(`${FD} feed.xml 항목이 날짜 최신순이 아니다(${items[i].link})`); break; }
    for (const it of items) {
      const rel = it.link.replace(/^https:\/\/opboxindex\.com\//, "").replace(/\/$/, "/index.html");
      if (exists(rel) && /<meta name="robots" content="[^"]*noindex/i.test(read(rel))) sink.push(`${FD} feed.xml 에 noindex 페이지 ${rel}`);
      else if (!exists(rel)) sink.push(`${FD} feed.xml 링크의 실파일 없음 ${it.link}`);
    }
    const links = new Set(items.map((it) => it.link));
    const must = ["https://opboxindex.com/weekly.html"];
    try { for (const p of JSON.parse(read("data/upcoming-set-pages.json")).pages || []) must.push(`https://opboxindex.com/sets/${p.slug}.html`); } catch {}
    try { for (const p of require("./card-list-shared").products()) must.push(`https://opboxindex.com/${require("./card-list-shared").pagePath(p.code)}`); } catch {}
    for (const u of must) if (exists(u.replace("https://opboxindex.com/", "")) && !links.has(u)) sink.push(`${FD} feed.xml 에 ${u} 가 없다`);
  }
  // 발행 시각 ≤ 빌드 시각 — 2026-10-15(3차): 오늘 날짜 항목 13개가 pubDate 09:00 GMT 인데 lastBuildDate 는 02:26 GMT 였다(발행이 빌드보다 미래).
  for (const f of ["feed.xml", "ko/feed.xml"].filter(exists)) {
    const x = read(f);
    const built = Date.parse((x.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/) || [])[1] || "");
    if (!built) { sink.push(`${FD} ${f} lastBuildDate 를 못 읽었다`); continue; }
    const late = [...x.matchAll(/<item>[\s\S]*?<\/item>/g)].filter((m) => Date.parse((m[0].match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "") > built);
    if (late.length) sink.push(`${FD} ${f} pubDate ${late.length}건이 lastBuildDate 보다 늦다(${(late[0][0].match(/<link>([^<]+)<\/link>/) || [])[1] || ""})`);
  }
}

// ════ 2026-10-15 외부 감사(확정 22건) 재발 방지 — SF1·U2·PL1·S4·NM1·KO1~KO4·AB1·AS1·LP1·PO1·CL2·UP2·DS1 ════
// 공용: JSON-LD 읽기·보이는 글자 뽑기. 각 검사는 생성기를 부르지 않고 원천 파일(data/·AI JSON)과 산출물을 직접 대조한다.
const ldOf15 = (h) => [...h.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
const shownText15 = (h) => h.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ").replace(/<svg[\s\S]*?<\/svg>/g, " ")
  .replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ");
const money15 = (v) => "$" + Math.round(v).toLocaleString("en-US");
const ISO15 = /^\d{4}-\d{2}-\d{2}$/;
let UPC15 = new Set();
try { UPC15 = new Set((JSON.parse(read("data/upcoming-set-pages.json")).pages || []).map((p) => `${p.slug}.html`)); } catch {}
// 일본판·영문판 세트 페이지(발매 전 세트 페이지는 UP1·UP2 가 본다)
const SET_PAGES15 = PUBLIC_HTML.filter((p) => /^sets\/(?:op|eb|prb)-\d+(?:-english)?\.html$/.test(p) && !UPC15.has(p.slice(5)));
const KO_SET_PAGES15 = PUBLIC_HTML.filter((p) => /^ko\/(?:op|eb|prb)-\d+\.html$/.test(p));
// NM 을 써도 되는가(값·읽은 날 있음·숨김 표시 없음) — 생성기 전부가 쓰는 술어 그대로(2026-10-15, 2차). 화면·피드 값의 유무 규칙이 이것 하나다.
const { nmUsable: nmUsable15 } = require("./market-data-normalizers");

// ── SF1. 세트 페이지 FAQ 의 박스 가격 = Key facts 표의 판매 중앙값(28일 규칙) — 2026-10-15 신설(감사 #0).
//    OP-02·OP-04·EB-01 의 FAQ(화면·FAQPage JSON-LD)가 "As of 2026-07-07 … about $147" 과 그 값으로 낸 "3.8x" 를 현재가처럼 냈다.
//    같은 페이지 Key facts 는 "— no median dated within 28 days" 였다. 가격 문답 = 표와 같은 값·날짜(표가 "—" 면 가격을 내지 않음),
//    배수 문답과 접힌 해설의 "현재" 문장(verdict·배수) = 두 판(해설은 일본판) current 가 있을 때만. 같은 값을 다른 꼴로 쓰는 것($1424 · $1,424)도 잡는다.
if (exists("data/box-sold-series.json")) {
  const SS = JSON.parse(read("data/box-sold-series.json")).sets || {};
  let n = 0;
  for (const f of SET_PAGES15) {
    const html = read(f);
    const code = f.slice(5).replace(/(?:-english)?\.html$/, "").toUpperCase();
    const cur = (SS[code] && SS[code].current) || {};
    const faq = ldOf15(html).find((o) => o["@type"] === "FAQPage");
    const kf = (html.match(/<tr data-k="sold">[\s\S]*?<\/tr>/) || [""])[0];
    const kfVal = (kf.match(/<b>(\$[\d,]+)<\/b>/) || [])[1] || null;
    const kfDate = kfVal ? (kf.match(/<time datetime="(\d{4}-\d{2}-\d{2})"/) || [])[1] : null;
    for (const q of (faq && faq.mainEntity) || []) {
      const a = (q.acceptedAnswer && q.acceptedAnswer.text) || "";
      if (/^How much is a sealed /.test(q.name)) {
        n++;
        const m = a.match(/^As of (\d{4}-\d{2}-\d{2}), completed eBay sales[^.]*?median at about (\$[\d,]+)/);
        if (!kfVal && m) errors.push(`SF1: ${f} FAQ 가 ${m[2]}(${m[1]})를 현재가로 낸다 — Key facts 는 "—"(28일 안의 중앙값 없음)`);
        if (kfVal && (!m || m[2] !== kfVal || m[1] !== kfDate)) errors.push(`SF1: ${f} FAQ 가격 "${m ? `${m[2]} ${m[1]}` : "없음"}" ≠ Key facts ${kfVal} ${kfDate}`);
      }
      if (/compare with the Japanese box\?$/.test(q.name)) {
        if (!(cur.jp && cur.en)) errors.push(`SF1: ${f} 배수 문답이 있는데 ${cur.jp ? "영문판" : "일본판"} current 가 없다 — 28일 넘은 값으로 배수를 냈다`);
        else if (!a.includes(money15(cur.jp.median)) || !a.includes(money15(cur.en.median))) errors.push(`SF1: ${f} 배수 문답 값 ≠ current(JP ${money15(cur.jp.median)} · EN ${money15(cur.en.median)})`);
      }
    }
    if (!/-english\.html$/.test(f) && !cur.jp && /compares with its tracked range|x<\/strong> the Japanese box/.test(html))
      errors.push(`SF1: ${f} 일본판 current 가 없는데 현재가 해설(verdict·배수)이 남아 있다`);
  }
  if (!n) errors.push("SF1: 가격 FAQ 를 읽은 세트 페이지가 0장이다 — 문답 구조가 바뀌었으면 이 검사도 같이 고칠 것");
}

// ── U2. 세트·영문판·한국어 세트·카드 상세 페이지 수정일 ≥ 화면에 찍힌 가장 늦은 데이터 날짜 — 2026-10-15 신설(감사 #4).
//    op-17-english 의 WebPage dateModified 가 2026-10-14(packs.updated)인데 화면·FAQ 엔 "as of 2026-10-15" 판매 중앙값이 있었다.
//    카드 상세 21장도 등급사 표에 "2026-10-15" TAG 값이 있는데 Article dateModified 10-14 였다. U1 은 글·비교표만 본다.
//    발매일 행(data-k="release")은 미래일 수 있는 사실이라 뺀다. 화면 "Data updated"(한국어 "갱신") · 카드 설명의 "Updated" 도 같은 날이어야 한다.
{
  let n = 0;
  const pages = [...SET_PAGES15, ...KO_SET_PAGES15, ...PUBLIC_HTML.filter((p) => /^cards\/(?!index\.html$)[^/]+\.html$/.test(p))];
  for (const f of pages) {
    const html = read(f);
    if (/name="robots" content="[^"]*noindex/i.test(html)) continue;   // 리다이렉트 스텁(C2 예외)
    const ld = ldOf15(html);
    const node = ld.find((o) => o["@type"] === "WebPage" && o.dateModified) || ld.find((o) => o["@type"] === "Article" && o.dateModified);
    const dm = node && node.dateModified;
    if (!dm) { errors.push(`U2: ${f} WebPage/Article dateModified 가 없다`); continue; }
    n++;
    // 보이는 글자만 — 차트 SVG 의 data-e(구간 끝, 배타적 = 다음 날)는 화면 날짜가 아니다. meta description 은 검색결과에 보이므로 넣는다.
    const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "";
    const shown = shownText15(html.replace(/<tr data-k="release">[\s\S]*?<\/tr>/, " ")) + " " + desc;
    let latest = "";
    for (const m of shown.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)) if (m[1] > latest) latest = m[1];
    if (latest > dm) errors.push(`U2: ${f} 화면에 ${latest} 데이터가 있는데 dateModified 가 ${dm} — 수정일은 화면 날짜 중 가장 늦은 날 이상(set-page-shared.setPageDate)`);
    const upd = f.startsWith("cards/") ? (desc.match(/Updated (\d{4}-\d{2}-\d{2})\.$/) || [])[1]
      : f.startsWith("ko/") ? (html.match(/· 갱신 (\d{4}-\d{2}-\d{2})\.<\/p>/) || [])[1]
        : (html.match(/Data updated <time datetime="(\d{4}-\d{2}-\d{2})"/) || [])[1];
    if (upd !== dm) errors.push(`U2: ${f} 화면 갱신일 "${upd || "없음"}" ≠ dateModified ${dm}`);
  }
  if (!n) errors.push("U2: 검사한 세트·카드 페이지가 0장이다");
}

// ── PL1. 세트 페이지 Product 구조화데이터의 가격·매물 수는 화면에 있어야 한다 — 2026-10-15 신설(감사 #6).
//    op-07(매물 2건)은 호가 위젯·Range 줄이 숨는데 AggregateOffer highPrice 157 이 JSON-LD 에만 있었다(영문판은 SD4 로 고친 같은 결함).
//    차트 SVG 의 눈금 글자는 가격 표시가 아니라 뺀다. 예정 세트 페이지(예약 호가)는 UP1 이 본다.
{
  let n = 0;
  for (const f of SET_PAGES15) {
    const html = read(f);
    const text = shownText15(html);
    for (const p of ldOf15(html).filter((o) => o["@type"] === "Product" && o.offers)) {
      n++;
      const o = p.offers;
      for (const v of o["@type"] === "AggregateOffer" ? [o.lowPrice, o.highPrice] : [o.price]) {
        if (v == null) { errors.push(`PL1: ${f} Product ${o["@type"]} 에 가격이 비어 있다`); continue; }
        if (!text.includes(money15(v))) errors.push(`PL1: ${f} Product ${o["@type"]} 가격 ${money15(v)} 이 화면에 없다 — 구조화데이터에만 있는 값`);
      }
      if (o.offerCount != null && !new RegExp(`(^|\\D)${o.offerCount} (?:active )?listings`).test(text)) errors.push(`PL1: ${f} offerCount ${o.offerCount} 가 화면 매물 수에 없다`);
    }
  }
  if (!n) errors.push("PL1: Product 구조화데이터를 읽은 세트 페이지가 0장이다");
}

// ── S4. 외부 시세 업체명 공개 금지(S1 확장) — 2026-10-15 신설(감사 #20).
//    PRB-01 본문에 "with a TCGplayer market price around $4,250" 이 나갔다(S1 은 collectr 만 본다). 표의 중립 라벨은 "TCG".
//    생성기가 만드는 세트·카드·한국어·일본어 페이지와 llms 파일 전부. 소문자 gemRatePct 같은 필드명은 업체명이 아니라 \b 로 끊는다.
//    CSP meta 의 이미지 CDN 도메인은 보이는 글자가 아니라 뺀다. (about·methodology·weekly·글 3장의 기존 표기는 범위 밖 — 남은 일)
{
  const VENDOR = /tcgplayer|yuyu-?tei|遊々亭|pricecharting|cardmarket|cardrush|snkrdunk|\bgemrate\b|collectr/i;
  for (const f of [...PUBLIC_HTML.filter((x) => /^(?:sets|cards|ko|ja)\//.test(x)), "llms.txt", "llms-full.txt"]) {
    if (!exists(f)) continue;
    const m = read(f).replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, " ").match(VENDOR);
    if (m) errors.push(`S4: ${f} 에 외부 시세 업체명 "${m[0]}" — 중립 라벨(TCG · Weekly ungraded market)을 쓸 것`);
  }
}

// ── NM1. NM 호가 관측일 = 그 변형을 실제로 읽은 날(packs card.nmUpdated) — 2026-10-15 신설(감사 #10).
//    피드·카드 상세가 card-series 마지막 점(환율만 움직여도 생기는 점)·페이지 빌드일을 관측일로 내보내, 10-11 에 읽은 ¥1,280,000 이
//    "observedOn 2026-10-14 · 경과 0일"·"Japanese retail · as of 2026-10-14" 로 나갔다(카드리스트는 10-11). 09-07 값(OP09-093 SP Gold)도 10-14.
//    (a) AI 핵심 topHits·카드 파일 pages: rawNmAsk.observedOn === nmUpdated, nmUpdated 가 없으면 rawNmAsk 는 null
//    (b) 카드 상세 "Japanese retail · as of X" = nmUpdated(없으면 날짜 없음) (c) 카드리스트 JSON nm.observedOn = 같은 번호 변형의 nmUpdated 중 하나(지어낸 날 금지)
//    (d) 한국어 세트 페이지 인기 카드 문단 — "DATA_DATE 기준으로 비교" 금지, 관측일 = 표 카드들의 nmUpdated 범위
//    (e) 일본판 세트 페이지 Top 10 NM 칸 — 지금은 날짜를 싣지 않는다. 싣게 되면 nmUpdated 여야 한다(행 순서 = packs cards 앞 10장)
//    (f) 카드 허브 "Raw NM as of <빌드일>" 금지
{
  try {
    const PK = JSON.parse(read("data/onepiece-packs.json"));
    const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const want = (c) => (c.nmHiddenReason || !(c.nmJpy > 0) || !ISO15.test(c.nmUpdated || "") ? null : c.nmUpdated);
    const byKey = new Map(), byNum = new Map();
    for (const [code, s] of Object.entries(PK.sets || {})) for (const c of s.cards || []) {
      byKey.set(`${code}|${c.number}|${norm(c.name)}`, c);
      if (!byNum.has(c.number)) byNum.set(c.number, new Set());
      if (ISO15.test(c.nmUpdated || "")) byNum.get(c.number).add(c.nmUpdated);
    }
    let bad = 0;
    const push = (msg) => { if (bad++ < 12) errors.push(msg); };
    // (a)
    const CORE = JSON.parse(read("opbox-ai-data.json")), CARDS = JSON.parse(read("opbox-ai-cards.json"));
    const checkOne = (where, code, number, name, nm) => {
      const c = byKey.get(`${code}|${number}|${norm(name)}`);
      if (!c) return;
      const got = nm ? nm.observedOn : null;
      if (got !== want(c)) push(`NM1: ${where} ${code} ${number} ${name} NM 관측일 ${got} ≠ 원천 nmUpdated ${want(c)}`);
    };
    for (const s of CORE.sets || []) for (const h of s.topHits || []) checkOne("opbox-ai-data.json", s.setCode, h.cardNumber, h.name, h.rawNmAsk);
    for (const p of CARDS.pages || []) checkOne("opbox-ai-cards.json", p.containerSetCode, p.cardNumber, p.name, p.rawNmAsk);
    // (b) — 카드 페이지 파일명 = 번호+이름 슬러그(C4 와 같은 규칙)
    const slug = (s) => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").replace(/[\s_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
    let pagesSeen = 0;
    for (const s of Object.values(PK.sets || {})) for (const c of s.cards || []) {
      const f = `cards/${slug(c.number + "-" + c.name)}.html`;
      if (!exists(f)) continue;
      const m = read(f).match(/<span>Japanese NM \(raw\)<\/span><b>[^<]*<\/b><small>([^<]*)<\/small>/);
      if (!m) continue;
      pagesSeen++;
      const shown = (m[1].match(/as of (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
      // 숨김 표시 NM 은 읽은 날이 있어도 화면에 값·날짜가 없다(nmUsable, 2026-10-15 2차)
      if (shown !== (nmUsable15(c) ? c.nmUpdated : null)) push(`NM1: ${f} NM "as of ${shown}" ≠ nmUpdated ${nmUsable15(c) ? c.nmUpdated : "없음(쓸 수 없는 NM)"} — 빌드일을 관측일로 쓰지 말 것`);
    }
    if (!pagesSeen) errors.push("NM1: 카드 상세의 NM 칸을 한 장도 못 읽었다 — 칸 구조가 바뀌었으면 이 검사도 같이 고칠 것");
    // (c)
    for (const f of fs.readdirSync(path.join(ROOT, "sets")).filter((x) => /-card-list\.json$/.test(x))) {
      for (const r of JSON.parse(read("sets/" + f)).cards || []) {
        const d = r.nm && r.nm.observedOn;
        if (d && !(byNum.get(r.number) || new Set()).has(d)) push(`NM1: sets/${f} ${r.id} NM 관측일 ${d} — 같은 번호 변형의 nmUpdated(${[...(byNum.get(r.number) || [])].join(",") || "없음"})가 아니다`);
      }
    }
    // (d)
    for (const f of KO_SET_PAGES15) {
      const html = read(f);
      if (/NM 카드 \d+장을 \d{4}-\d{2}-\d{2} 기준으로 비교합니다/.test(html)) push(`NM1: ${f} 인기 카드 문단이 데이터일을 NM 기준일로 쓴다 — 관측일(nmUpdated)을 따로 적을 것`);
      const m = html.match(/NM 카드 (\d+)장을 비교합니다\((?:관측일 ([\d~-]+), )?환율/);
      if (!m) continue;
      const cards = ((PK.sets || {})[f.slice(3, -5).toUpperCase()] || {}).cards || [];
      const days = cards.filter((c) => nmUsable15(c) && c.number).slice(0, Number(m[1])).map((c) => c.nmUpdated).filter((x) => ISO15.test(x || "")).sort();
      const span = days.length ? (days[0] === days.at(-1) ? days[0] : `${days[0]}~${days.at(-1)}`) : undefined;
      if (m[2] !== span) push(`NM1: ${f} 인기 카드 관측일 "${m[2] || "없음"}" ≠ nmUpdated 범위 ${span || "없음"}`);
    }
    // (e)
    for (const [code, s] of Object.entries(PK.sets || {})) {
      const f = `sets/${code.toLowerCase()}.html`;
      if (!exists(f) || !(s.cards || []).length) continue;
      const tbl = (read(f).match(/<table class="chaseTable">[\s\S]*?<\/table>/) || [""])[0];
      for (const r of tbl.matchAll(/<tr><td>(\d+)<\/td>[\s\S]*?<\/tr>/g)) {
        const c = s.cards[Number(r[1]) - 1];
        const nmCell = ([...r[0].matchAll(/<td class="num[^"]*"[^>]*>([\s\S]*?)<\/td>/g)][0] || [])[1] || "";
        const shown = (nmCell.match(/\b(\d{4}-)?(\d{2}-\d{2})\b/) || [])[0];
        if (!shown) continue;
        const w = c && c.nmUpdated ? (shown.length === 10 ? c.nmUpdated : c.nmUpdated.slice(5)) : null;
        if (shown !== w) push(`NM1: ${f} ${c ? c.number : "?"} NM 칸 날짜 ${shown} ≠ nmUpdated ${c && c.nmUpdated ? c.nmUpdated : "없음"}`);
      }
    }
    // (f)
    if (exists("cards/index.html") && /Raw NM as of \d{4}-\d{2}-\d{2}/.test(read("cards/index.html"))) push("NM1: cards/index.html \"Raw NM as of <날짜>\" — NM 은 행마다 읽은 날이 다르다(관측일 범위로)");
    if (bad > 12) errors.push(`NM1: 그 밖에 ${bad - 12}건 더`);
  } catch (e) { errors.push("NM1: NM 관측일 검사 실패 — " + e.message); }
}

// ── KO1. 한국어 세트·허브 문답 = 같은 페이지 Key facts 정의 — 2026-10-15 신설(감사 #1·#2·#3·#7·#12·#14).
//    시세 문답이 데이터 갱신일(10-14)을 09-23 값(OP-06)에 붙였고, 값이 없는 세트(OP-02·OP-04·EB-01)는 "추적가는 약 —이며".
//    변동률 문답이 4주 비교 기준일(09-15)을 "발매 시점"으로 적어 OP-17(발매 08-22)·OP-16 페이지 안에 발매일이 둘.
//    허브 문답·Dataset 은 "2026년 1월 대비·OP-16만 발매 시점부터" 옛 정의를 들고 있었다. FAQPage 구조화데이터도 같은 문장이다.
{
  let SS = {}, FX = null;
  try { SS = JSON.parse(read("data/box-sold-series.json")).sets || {}; FX = (JSON.parse(read("data/onepiece-packs.json")).fx || {}).usdKrw || null; } catch (e) { errors.push("KO1: 원천 읽기 실패 — " + e.message); }
  const faqOf = (h) => (ldOf15(h).find((j) => j["@type"] === "FAQPage") || {}).mainEntity || [];
  const ansOf = (faq, re) => ((faq.find((q) => re.test(q.name)) || {}).acceptedAnswer || {}).text || null;
  const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let n = 0;
  for (const f of KO_SET_PAGES15) {
    const code = f.slice(3, -5).toUpperCase(), html = read(f), faq = faqOf(html);
    n++;
    if (/약 —/.test(html)) errors.push(`KO1: ${f} 에 "약 —" — 값이 없으면 금액 문장 대신 사유("28일 안에 날짜가 찍힌 판매 중앙값이 없어")`);
    if (/발매 시점|발매 초기 대비/.test(html)) errors.push(`KO1: ${f} 에 "발매 시점/발매 초기 대비" — 변동률은 28일 전 중앙값 대비다(발매일과 무관)`);
    // 시세 문답 날짜·값 = Key facts sold 행 = box-sold-series current(없으면 금액 없이)
    const sold = (html.match(/<tr data-k="sold">[\s\S]*?<\/tr>/) || [""])[0];
    const cur = (SS[code] && SS[code].current && SS[code].current.jp) || null;
    const pa = ansOf(faq, /박스 시세는 지금 얼마/);
    if (cur) {
      const w = FX ? Math.round(cur.median * FX).toLocaleString("ko-KR") + "원" : null;
      if (!sold.includes(`<time datetime="${cur.d}">`)) errors.push(`KO1: ${f} Key facts 기준일 ≠ current ${cur.d}`);
      if (!pa || !pa.startsWith(`${cur.d} 기준 `)) errors.push(`KO1: ${f} 시세 문답 날짜 "${(pa || "없음").slice(0, 12)}" ≠ 그 중앙값의 날짜 ${cur.d}(데이터 갱신일이 아니다)`);
      // 원화 금액은 환율(packs.fx)에 따라 바뀐다 — 환율 워크플로(update-fx)는 페이지를 다시 굽지 않으므로, 이번 실행이 페이지를 바꿨을 때만 FAIL
      // (아니면 경고 — 다음 페이지 생성이 바로잡는다. 수집·환율 커밋을 막지 않는다, SM1 과 같은 기준).
      if (pa && w && !pa.includes(`약 ${w}`)) (PUBLISH_TOUCHED ? errors : warnings).push(`KO1${PUBLISH_TOUCHED ? ":" : "(경고)"} ${f} 시세 문답 금액 ≠ Key facts ${w}`);
    } else if (pa && /[\d,]+원/.test(pa)) errors.push(`KO1: ${f} current 가 없는데 시세 문답에 금액 "${pa.slice(0, 40)}"`);
    // 변동률 문답 = 팩트 줄의 기준일("YYYY-MM-DD 대비 … — 발매일 대비가 아님")
    const basis = (html.match(/<li>(\d{4}-\d{2}-\d{2}) 대비 <strong>[^<]*<\/strong> — 발매일 대비가 아님<\/li>/) || [])[1] || null;
    const ca = ansOf(faq, /변동률은/);
    // 4차(2026-10-15): 답은 정의 문장 하나 — "변동률(x%)은 <값 날짜> 판매 중앙값을 N일 전(<기준일>) 중앙값과 비교한 값입니다." "발매일 대비가 아닙니다" 꼬리는 뺐다.
    if (basis && (!ca || !ca.includes(`(${basis}) 중앙값과 비교한 값입니다.`))) errors.push(`KO1: ${f} 변동률 문답 "${(ca || "없음").slice(0, 50)}" — 팩트 줄 기준일 ${basis} 과 같은 정의 문장이어야 한다`);
    // 값이 없으면 문답이 없다 — 사유 문장("…표시하지 않습니다")·방어 꼬리("발매일 대비가 아닙니다")를 싣지 않는다(4차).
    if (!basis && ca) errors.push(`KO1: ${f} 변동률이 없는데 변동률 문답 "${ca.slice(0, 40)}" 이 있다 — 문답을 싣지 않는다`);
    if (!cur && pa) errors.push(`KO1: ${f} current 가 없는데 시세 문답 "${pa.slice(0, 40)}" 이 있다 — 문답을 싣지 않는다`);
    for (const q of faq) if (/표시하지 않습니다|대비가 아닙니다|포함하지 않습니다/.test(q.acceptedAnswer.text)) errors.push(`KO1: ${f} 문답 "${q.name}" 에 사유·방어 문장 "${q.acceptedAnswer.text.slice(0, 40)}"`);
    // 보이는 FAQ = 구조화데이터(L2 는 질문만 본다 — 답도 같아야 한다)
    for (const q of faq) if (!html.includes(`<p>${escH(q.acceptedAnswer.text)}</p>`)) errors.push(`KO1: ${f} FAQPage 답 "${q.name}" 이 본문 FAQ 와 다르다`);
  }
  if (!n) errors.push("KO1: 한국어 세트 페이지를 0장 읽었다");
  if (exists("ko/index.html")) {
    const h = read("ko/index.html"), a = ansOf(faqOf(h), /변동률은 발매일 대비/);
    if (!a || /1월 대비|발매 시점/.test(a) || !/28일 전 중앙값/.test(a)) errors.push(`KO1: ko/index.html 변동률 문답 "${(a || "없음").slice(0, 60)}" — 범례와 같은 정의(28일 전 중앙값 대비)여야 한다`);
    if (/1월 대비 변동률/.test(h)) errors.push("KO1: ko/index.html 에 \"1월 대비 변동률\"(옛 정의)이 남아 있다 — Dataset 설명 확인");
  }
}

// ── KO2. 재판 분류 = 영문 세트 페이지 분류 — 2026-10-15 신설(감사 #8). (원장의 일 단위 발매 전후 비교는 R2 가 본다)
//    한국어 페이지가 반다이 공식 추첨판매(OP-16 2건·OP-13 2025-12)를 "유통사·리테일러 재입고 기준 재판"으로 세어
//    영문("Bandai does not call these reprints")과 횟수가 갈렸다(OP-16 KO 2회 / EN 0회).
//    재판 횟수 = 재입고(리테일러·유통사)만, 발매 후 추첨은 따로 "재판 아님", 발매 전 추첨은 싣지 않는다 — 세트 페이지·허브 행 모두.
{
  let SF = {};
  try { SF = JSON.parse(read("data/set-facts.json")).sets || {}; } catch (e) { errors.push("KO2: set-facts 읽기 실패 — " + e.message); }
  const kind = (r) => String(r.kind || "");
  // 4차(2026-10-15): 재판 = 재입고(리테일러·유통사) + "再販"이라 적힌 추첨(official-reprint-lottery), 재판 밖 = 그 말이 없는 발매 후 추첨(official-lottery).
  const pre = (r) => /pre-release/i.test(kind(r)), unver = (r) => /unverified-timing/i.test(kind(r)), official = (r) => kind(r) === "official-lottery";
  const hub = exists("ko/index.html") ? read("ko/index.html") : null;
  // 이유 설명 꼬리 금지 — "…반다이가 재판이라 부르지 않아 재판 횟수에 포함하지 않습니다"(ko 세트)·"…재판으로 세지 않고 …따로 적습니다"(ko 허브)
  for (const f of [...KO_SET_PAGES15, "ko/index.html"].filter(exists)) if (/재판이라 부르지 않|재판 횟수에 포함하지 않|재판으로 세지 않고/.test(read(f))) errors.push(`KO2: ${f} 에 재판 분류를 설명하는 문장이 남아 있다 — 팩트 줄 라벨("— 재판 아님")만`);
  for (const [code, sf] of Object.entries(SF)) {
    const recs = sf.reprintRecords || [];
    const restock = recs.filter((r) => !pre(r) && !unver(r) && !official(r)).length;
    const lottery = recs.filter((r) => !pre(r) && !unver(r) && official(r)).length;
    const f = `ko/${code.toLowerCase()}.html`;
    if (exists(f)) {
      const html = read(f);
      const got = (html.match(/<li>재판 기록 <strong>(\d+)회<\/strong>/) || [])[1];
      if (restock ? Number(got) !== restock : !/<li><strong>재판 기록 없음<\/strong>/.test(html)) errors.push(`KO2: ${f} 재판 기록 ${got || "없음"}회 ≠ 재입고 기록 ${restock}회(영문 분류 — 반다이 추첨판매는 재판이 아니다)`);
      if (lottery && !html.includes(`<li>발매 후 반다이 공식 추첨판매 ${lottery}회(`)) errors.push(`KO2: ${f} 발매 후 반다이 추첨 ${lottery}회 줄("— 재판 아님")이 없다`);
      if (!lottery && /발매 후 반다이 공식 추첨판매/.test(html)) errors.push(`KO2: ${f} 발매 후 추첨 기록이 없는데 추첨판매 문장이 있다`);
      const lst = (html.match(/재판이 \d+회<\/strong> 확인됐습니다\(([^)]*)\)/) || [])[1];
      if (lst && /추첨/.test(lst)) errors.push(`KO2: ${f} 재판 목록 "(${lst})" 에 추첨판매가 섞였다`);
    }
    if (hub) {
      const row = (hub.match(new RegExp(`<a href="${code.toLowerCase()}\\.html">${code}</a>[\\s\\S]*?<td class="rp">([\\s\\S]*?)</td>`)) || [])[1];
      if (row != null) {
        const hn = (row.match(/재판 (\d+)회/) || [])[1];
        if (restock ? Number(hn) !== restock : !/재판 기록 없음/.test(row)) errors.push(`KO2: ko/index.html ${code} 재판 칸 "${row.replace(/<[^>]+>/g, "")}" ≠ 재입고 ${restock}회`);
        if (lottery && !row.includes(`발매 후 추첨 ${lottery}회`)) errors.push(`KO2: ko/index.html ${code} 발매 후 추첨 ${lottery}회 표기가 없다`);
      }
    }
  }
}

// ── KO3. 한국어 경매 문단 — 통화·유형 라벨 — 2026-10-15 신설(감사 #13·#15).
//    거래액·중앙 낙찰가(달러)가 "182,037"·"9.99" 로 통화 없이 나가 원화 페이지에서 원으로 읽혔다(약 1,340배).
//    경매 유형 표엔 내부 키 "carton" 이 번역 없이 나갔다.
if (exists("data/set-auction-stats.json")) {
  const AS = JSON.parse(read("data/set-auction-stats.json")).sets || {};
  for (const f of KO_SET_PAGES15) {
    const sec = (read(f).match(/<section aria-label="경매 실적">[\s\S]*?<\/section>/) || [])[0];
    if (!sec) continue;
    const a = AS[f.slice(3, -5).toUpperCase()] || {};
    const amt = (sec.match(/거래액은 <strong>([^<]*)<\/strong>/) || [])[1], med = (sec.match(/중앙 낙찰가는 <strong>([^<]*)<\/strong>/) || [])[1];
    if (amt != null && amt !== `$${Number(a.amount).toLocaleString("en-US")}`) errors.push(`KO3: ${f} 거래액 "${amt}" ≠ $${Number(a.amount).toLocaleString("en-US")}(달러 표기 — 영문 세트 페이지와 같은 값)`);
    if (med != null && med !== `$${a.medPrice}`) errors.push(`KO3: ${f} 중앙 낙찰가 "${med}" ≠ $${a.medPrice}`);
    for (const m of sec.matchAll(/<td class="l">([^<]*)<\/td>/g)) if (/^[a-z_-]+$/.test(m[1])) errors.push(`KO3: ${f} 경매 유형 칸에 내부 키 "${m[1]}" — 한국어 라벨(catKo)에 추가할 것`);
  }
}

// ── KO4. 한국어 세트 페이지 인기 카드 레어도 = 공식 카드 리스트 — 2026-10-15 신설(감사 #16).
//    원본 카드 레어도를 그대로 써서 SP 판(ST31-004_p1)이 세트 페이지는 SR, ko/op-17-card-list.html 은 SP 였다.
//    사람 확인 변형(_imgSuffix)이 가리키는 공식 ID 의 레어도와 같아야 한다(SPカード → "SP").
try {
  const P = JSON.parse(read("data/onepiece-packs.json")).sets || {};
  const OFFC = ((JSON.parse(read("data/official-cardlist.json")).jp) || {}).cards || {};
  const show = (r) => (/^SP/i.test(String(r || "")) ? "SP" : String(r || ""));
  const unH = (s) => s.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  let n = 0;
  for (const f of KO_SET_PAGES15) {
    const cards = (P[f.slice(3, -5).toUpperCase()] || {}).cards || [];
    const sec = (read(f).match(/<section aria-label="인기 카드 시세">[\s\S]*?<\/section>/) || [""])[0];
    for (const m of sec.matchAll(/<td class="nm">([^<]*)<\/td><td class="code">([^<]*)<\/td><td>([^<]*)<\/td>/g)) {
      const c = cards.find((x) => x.number === unH(m[2]) && x.name === unH(m[1]));
      const off = c && typeof c._imgSuffix === "string" ? OFFC[c.number + c._imgSuffix] : null;
      if (!off || !off.rarity) continue;
      n++;
      if (unH(m[3]) !== show(off.rarity)) errors.push(`KO4: ${f} ${m[2]} ${unH(m[1])} 레어도 "${unH(m[3])}" ≠ 공식 ${c.number + c._imgSuffix} "${show(off.rarity)}"(카드 리스트 페이지와 같은 값)`);
    }
  }
  if (!n) errors.push("KO4: 공식 ID 로 대조한 인기 카드가 0장이다 — 표 구조·_imgSuffix 확인");
} catch (e) { errors.push("KO4: 원천 읽기 실패 — " + e.message); }

// ── AB1. AI 경매 세트별 행 = 알려진·발매된 세트만 — 2026-10-15 신설(감사 #9·#17·#18).
//    opbox-ai-auctions.json onePiece.bySet 에 제목 파싱이 만든 없는 코드 12개(OP-53·EB-09·PRB-06 …)와 발매 전 OP-18(낙찰 2건 $18)이
//    실려 llms-full 표까지 나갔다. OP/EB/PRB 는 set-facts·공식 카드리스트에 있고 일본 발매일 ≤ 창 끝(to), ST 는 경매 페이지 최소 건수 이상.
//    llms-full 표 행은 피드 행과 같아야 하고, 피드에 있는 세트는 경매 페이지 세트 표에도 있어야 한다(페이지·피드 세트 목록 일치).
{
  try {
    const AU = JSON.parse(read("opbox-ai-auctions.json")).onePiece.bySet;
    const SF = JSON.parse(read("data/set-facts.json")).sets || {};
    let OCL = {};
    try { OCL = JSON.parse(read("data/official-cardlist.json")).jp.products || {}; } catch { OCL = {}; }
    const rel = (c) => (SF[c] && SF[c].jpRelease && SF[c].jpRelease.date) || (SF[c] && SF[c].enRelease && SF[c].enRelease.date) || null;
    const min = Number(AU.minEnded) || 30;
    for (const s of AU.sets || []) {
      const c = s.setCode;
      if (/^ST-\d{2}$/.test(c)) { if (!(s.ended >= min)) errors.push(`AB1: AI 경매 bySet ${c} 종료 ${s.ended}건 < 경매 페이지 기준 ${min}`); continue; }
      if (!(c in SF) && !(c in OCL)) { errors.push(`AB1: AI 경매 bySet 에 없는 세트 코드 ${c}(set-facts·공식 카드리스트에 없음)`); continue; }
      const d = rel(c);
      if (!d || d > AU.to) errors.push(`AB1: AI 경매 bySet 에 미발매 세트 ${c}(발매 ${d || "—"} > 창 끝 ${AU.to}) — sold ${s.sold}, amountUsd ${s.amountUsd}`);
    }
    const full = read("llms-full.txt");
    const sect = (full.match(/\nPer set, last \d+ days[^\n]*\n([\s\S]*?)\n\n/) || [null, ""])[1];
    const llmsCodes = sect.split("\n").map((l) => l.split(" | ")[0]).filter(Boolean);
    const feedCodes = (AU.sets || []).map((s) => s.setCode);
    if (llmsCodes.join(",") !== feedCodes.join(",")) errors.push(`AB1: llms-full 세트별 경매 표(${llmsCodes.length}행)가 AI 피드 bySet(${feedCodes.length}행)과 다르다`);
    const h = read("auction.html"), i = h.indexOf('id="setBody"');
    const page = new Set([...h.slice(i, h.indexOf("</tbody>", i)).matchAll(/\b(?:OP|EB|PRB|ST)-\d{2}\b/g)].map((m) => m[0]));
    for (const c of feedCodes) if (!page.has(c)) errors.push(`AB1: AI 피드 bySet 의 ${c} 가 auction.html 세트 표에 없다(페이지·피드 세트 목록 불일치)`);
    // 경매 페이지 표 자체도 같은 규칙 — auction-page-model 은 30건 기준만 본다(발매 전 OP-18 이 30건을 넘기면 표에 오른다).
    for (const c of page) if (!/^ST-/.test(c) && (!(c in SF || c in OCL) || !rel(c) || rel(c) > AU.to)) errors.push(`AB1: auction.html 세트 표에 없는/미발매 세트 ${c}(발매 ${rel(c) || "—"})`);
  } catch (e) { errors.push("AB1: AI 경매 세트별 검사 실패 — " + e.message); }
}

// ── AS1. 데이터 기준일 ≥ 실린 값의 관측일 — 2026-10-15 신설(감사 #11).
//    "data as of 2026-10-14" 파일 안에 10-15 판매 표본·경매 일별 값이 있었고 경과일 -1 이 0 으로 잘렸다.
//    AI 파일 4개의 datasetUpdatedOn 은 한 날이어야 하고(같은 값의 경과일이 파일마다 같게), 어느 관측일도 그 뒤일 수 없으며,
//    경과일은 기준일 − 관측일 그대로여야 한다. llms.txt·llms-full.txt 의 "as of" 도 같은 날.
{
  try {
    const files = ["opbox-ai-data.json", "opbox-ai-cards.json", "opbox-ai-grading.json", "opbox-ai-auctions.json"];
    const objs = files.map((f) => [f, JSON.parse(read(f))]);
    const asOf = objs[0][1].datasetUpdatedOn;
    // 파일 사이 일치(기준일·llms "as of")는 네 파일을 함께 굽는 페이지 생성 실행에서만 FAIL — 환율 워크플로는 핵심 파일 하나만 다시 굽는다
    // (그때 어긋남은 경고, 다음 전체 생성이 바로잡는다 — SM1 과 같은 기준). 파일 안 규칙(늦은 관측일·경과일)은 늘 FAIL.
    const sinkX = PUBLISH_TOUCHED ? errors : warnings, tagX = PUBLISH_TOUCHED ? "AS1:" : "AS1(경고)";
    for (const [f, o] of objs) if (o.datasetUpdatedOn !== asOf) sinkX.push(`${tagX} ${f} datasetUpdatedOn ${o.datasetUpdatedOn} ≠ opbox-ai-data.json ${asOf}`);
    const KEYS = new Set(["observedOn", "sampleCollectedOn", "fxObservedOn", "checkedOn", "releaseCheckedOn", "specCheckedOn", "date", "to"]);
    for (const [f, o] of objs) {
      let late = 0, badAge = 0, first = "";
      const walk = (nd) => {
        if (Array.isArray(nd)) return nd.forEach(walk);
        if (!nd || typeof nd !== "object") return;
        for (const [k, v] of Object.entries(nd)) {
          if (KEYS.has(k) && ISO15.test(v || "") && v > o.datasetUpdatedOn) { late++; first = first || `${k}=${v}`; }
          else if (v && typeof v === "object") walk(v);
        }
        const d = nd.observedOn || nd.sampleCollectedOn;
        if (ISO15.test(d || "") && "ageDaysAtDatasetUpdate" in nd && nd.ageDaysAtDatasetUpdate !== Math.round((Date.parse(o.datasetUpdatedOn) - Date.parse(d)) / 864e5)) badAge++;
      };
      walk(o);
      if (late) errors.push(`AS1: ${f} 에 기준일 ${o.datasetUpdatedOn} 보다 늦은 관측일 ${late}건(예: ${first})`);
      if (badAge) errors.push(`AS1: ${f} 경과일(ageDaysAtDatasetUpdate) ${badAge}건이 기준일 − 관측일과 다르다(음수를 0 으로 자른 흔적)`);
    }
    const llms = read("llms.txt"), full = read("llms-full.txt");
    if (!llms.includes(`Data as of ${asOf}.`)) sinkX.push(`${tagX} llms.txt "Data as of" 가 ${asOf} 가 아니다`);
    if (!full.startsWith(`# OP Box Index — full facts file (data as of ${asOf})`)) sinkX.push(`${tagX} llms-full.txt 제목 "data as of" 가 ${asOf} 가 아니다`);
  } catch (e) { errors.push("AS1: 데이터 기준일 검사 실패 — " + e.message); }
}

// ── LP1. llms-full 카드 표의 PSA 인구 칸에 관측일 — 2026-10-15 신설(감사 #19).
//    누적값(매주 증가)인데 이 칸만 날짜가 없었다. 칸 = "total / PSA 10 (observedOn)" 이고 값·날짜는 opbox-ai-cards.json 과 같다.
{
  try {
    const CARDS = JSON.parse(read("opbox-ai-cards.json"));
    const full = read("llms-full.txt");
    const rows = new Map(full.split("\n").filter((l) => l.includes("https://opboxindex.com/cards/")).map((l) => { const c = l.split(" | "); return [c[c.length - 1], c]; }));
    const nf = (v) => (Number.isFinite(v) ? v.toLocaleString("en-US") : "n/a");
    let bad = 0;
    for (const p of CARDS.pages || []) {
      const row = rows.get(p.url);
      if (!row) { if (bad++ < 5) errors.push(`LP1: llms-full 카드 표에 ${p.url} 행이 없다`); continue; }
      const w = p.psaPopulation ? `${nf(p.psaPopulation.total)} / ${nf(p.psaPopulation.grade10)} (${p.psaPopulation.observedOn})` : "n/a";
      if (row[5] !== w && bad++ < 5) errors.push(`LP1: llms-full ${p.cardNumber} ${p.name} PSA 인구 칸 "${row[5]}" ≠ "${w}"`);
    }
    if (bad > 5) errors.push(`LP1: 그 밖에 ${bad - 5}행 더`);
  } catch (e) { errors.push("LP1: llms-full PSA 인구 칸 검사 실패 — " + e.message); }
}

// ── PO1. 카드 페이지 Product offers = 화면에 보이는 지금 호가만 — 2026-10-15 신설(감사 #5).
//    generate-card-pages.js 가 PSA 10 sold 중앙값(최대 3달 묵은 값)을 AggregateOffer 범위에 InStock 으로 넣고 offerCount 를
//    판매 건수+1 로 적었다(115장 중 92장). Offer 는 화면의 NM 호가 또는 "Cheapest PSA 10" 버튼 값과 같아야 하고 AggregateOffer·offerCount 는 쓰지 않는다.
{
  const numPO = (s) => (s == null ? null : Number(String(s).replace(/[$,]/g, "")));
  let bad = 0;
  for (const f of PUBLIC_HTML.filter((p) => /^cards\/(?!index\.html$)[^/]+\.html$/.test(p))) {
    const html = read(f);
    const prod = ldOf15(html).find((j) => j["@type"] === "Product");
    if (!prod) continue;
    const offers = [].concat(prod.offers || []);
    const push = (msg) => { if (bad++ < 10) errors.push(msg); };
    if (!offers.length) { push(`PO1: ${f} Product 에 offers 가 없다 — 지금 나와 있는 호가가 없으면 Product 를 내지 않는다`); continue; }
    const shown = {
      "Japanese NM (raw)": numPO((html.match(/<span>Japanese NM \(raw\)<\/span><b>([^<]+)<\/b>/) || [])[1]),
      "PSA 10 (lowest listing)": numPO((html.match(/class="buyLine">Cheapest PSA 10 [^<]*<b>([^<]+)<\/b>/) || [])[1]),
    };
    for (const o of offers) {
      if (o["@type"] !== "Offer") { push(`PO1: ${f} offers 에 ${o["@type"]} — 호가 Offer 만 싣는다(AggregateOffer 범위에 PSA 10 sold 중앙값이 섞였었다)`); continue; }
      if ("offerCount" in o) push(`PO1: ${f} offerCount — 매물 수를 세지 않으므로 쓰지 않는다`);
      if (!Number.isFinite(o.price) || o.priceCurrency !== "USD" || !/^https:\/\/schema\.org\/(?:InStock|OutOfStock)$/.test(o.availability || "")) push(`PO1: ${f} Offer "${o.name}" 에 price·priceCurrency·availability 가 다 있지 않다`);
      if (!(o.name in shown)) { push(`PO1: ${f} 알 수 없는 Offer "${o.name}" — NM 호가·PSA 10 최저 매물만`); continue; }
      if (shown[o.name] == null || shown[o.name] !== o.price) push(`PO1: ${f} Offer "${o.name}" ${o.price} ≠ 화면 값 ${shown[o.name]} — 지난 판매가가 아니라 화면의 호가여야 한다`);
    }
  }
  if (bad > 10) errors.push(`PO1: 그 밖에 ${bad - 10}건 더`);
}

// ── CL2. 카드리스트 페이지 수정일 ≥ 화면에 찍힌 가장 늦은 날짜 — 2026-10-15 신설(감사 #4).
//    CollectionPage dateModified 가 packs 데이터일(10-14)이었는데 화면은 경매 "last 45 days to 2026-10-15"·영문판 박스 "(2026-10-15, n=274)".
//    카드리스트는 "as of" 문구가 없어 U1 이 못 본다 — 본문(script 제외)의 YYYY-MM-DD 전부와 비교한다.
for (const f of PUBLIC_HTML.filter((p) => /^(?:sets|ko)\/[^/]+-card-list\.html$/.test(p))) {
  const html = read(f);
  const dms = [...html.matchAll(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
  if (!dms.length) { errors.push(`CL2: ${f} dateModified 가 없다`); continue; }
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ");
  const latest = [...body.matchAll(/\b(20\d{2}-\d{2}-\d{2})\b/g)].map((m) => m[1]).sort().pop() || "";
  const stale = dms.find((dm) => latest > dm);
  if (stale) errors.push(`CL2: ${f} 화면엔 ${latest} 가 있는데 dateModified 가 ${stale} — generate-card-list-pages.js pageDate 에 화면 날짜를 다 넣을 것`);
}

// ── UP2. 발매 전 세트 페이지는 표·라벨만 보인다 — 2026-10-15 신설(감사 #21).
//    sets/op-18·eb-05 만 도입 문단과 해설 섹션 5개("What is confirmed and what is still open", "Update policy" …)가
//    펼쳐진 채 보였다. 일반 세트 페이지는 2026-08-12 부터 같은 글을 접힌 "Set notes"(details.setMore)에 넣는다.
//    (a) main 에서 <details> 를 중첩까지 걷어낸 나머지: <p> 는 라벨·출처 줄(eyebrow·articleMeta·sourceNoteA·revCount·affTop·relBuy)만,
//        <section> 은 발매일 상자(relBox)·FAQ(setFaq)만 — 클래스 없는 산문 p·해설 section 이 하나라도 펼쳐져 있으면 실패
//    (b) 지우지 않고 접었다: introHtml·섹션 머리·문단이 전부 details.setMore 안에 있다(구글은 접힌 글도 읽는다 — R1 과 같은 원칙)
{
  let UP = { pages: [] };
  try { UP = JSON.parse(read("data/upcoming-set-pages.json")); } catch (e) { errors.push("UP2: upcoming 읽기 실패 — " + e.message); }
  const stripDetails = (h) => {
    let out = "", depth = 0, i = 0;
    for (const m of h.matchAll(/<details\b[^>]*>|<\/details>/g)) {
      if (depth === 0) out += h.slice(i, m.index);
      depth += m[0][1] === "/" ? -1 : 1;
      i = m.index + m[0].length;
    }
    return out + (depth === 0 ? h.slice(i) : "");
  };
  const escH = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const OPEN_P = /^(?:eyebrow|articleMeta|sourceNoteA|revCount|affTop|relBuy)$/;
  for (const p of UP.pages || []) {
    const f = `sets/${p.slug}.html`;
    if (!exists(f)) continue;
    const main = (read(f).match(/<main\b[^>]*>([\s\S]*?)<\/main>/) || [])[1] || "";
    const open = stripDetails(main);
    for (const m of open.matchAll(/<p(?:\s+class="([^"]*)")?[^>]*>([\s\S]{0,80})/g)) {
      if (OPEN_P.test(m[1] || "")) continue;
      errors.push(`UP2: ${f} 펼쳐진 산문 <p${m[1] ? ` class="${m[1]}"` : ""}> "${m[2].replace(/<[^>]+>/g, "").slice(0, 60)}…" — 해설은 details.setMore 안으로`);
      break;
    }
    for (const m of open.matchAll(/<section(?:\s+class="([^"]*)")?[^>]*>\s*(?:<h2[^>]*>([^<]*))?/g)) {
      if (!/^(?:relBox|setFaq)$/.test(m[1] || "")) errors.push(`UP2: ${f} 펼쳐진 해설 섹션 "${m[2] || m[1] || "?"}" — details.setMore 안으로`);
    }
    const notes = (main.match(/<details class="setMore">([\s\S]*?)<\/details>\s*<section class="setFaq"/) || [])[1] || "";
    const keep = [p.introHtml, ...(p.sections || []).flatMap((s) => [`<h2>${escH(s.heading)}</h2>`, ...s.paragraphsHtml])].filter(Boolean);
    const lost = keep.filter((t) => !notes.includes(t));
    if (lost.length) errors.push(`UP2: ${f} 접힌 Set notes 에 해설 ${lost.length}개가 없다("${lost[0].replace(/<[^>]+>/g, "").slice(0, 50)}…") — 글은 지우지 말고 접는다`);
  }
}

// ── DS1. Dataset 수정일 ≥ 기간 끝, 같은 파일의 Dataset 은 같은 날 — 2026-10-15 신설(감사 #4).
//    /·box-prices·free-data·ko/·weekly 의 Dataset 이 dateModified 2026-10-14 인데 temporalCoverage 는 …/2026-10-15 였고,
//    free-data 한 페이지 안에서도 8개 10-14 · 1개 10-15 로 갈렸다. 수정일보다 늦은 관측이 기간 안에 있을 수 없다.
//    opbox-ai-data.json 을 가리키는 Dataset(홈·box-prices·free-data#ai-json)은 그 파일의 datasetUpdatedOn·같은 기간을 쓴다(한 사실 = 한 값).
{
  let aiAsOf = null;
  try { aiAsOf = JSON.parse(read("opbox-ai-data.json")).datasetUpdatedOn; } catch {}
  const flat = (o) => (Array.isArray(o) ? o.flatMap(flat) : o && o["@graph"] ? flat(o["@graph"]) : o ? [o] : []);
  const aiNodes = [];
  let n = 0;
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    if (!html.includes('"Dataset"')) continue;
    for (const node of ldOf15(html).flatMap(flat).filter((x) => x["@type"] === "Dataset")) {
      n++;
      const dm = node.dateModified, end = String(node.temporalCoverage || "").split("/")[1] || "";
      if (!ISO15.test(dm || "")) { errors.push(`DS1: ${f} Dataset "${node.name}" dateModified 가 없다`); continue; }
      if (ISO15.test(end) && end > dm) errors.push(`DS1: ${f} Dataset "${node.name}" dateModified ${dm} < 기간 끝 ${end} — 수정일은 기간 끝 이상`);
      const urls = [].concat(node.distribution || []).map((x) => x && x.contentUrl);
      if (urls.includes("https://opboxindex.com/opbox-ai-data.json")) aiNodes.push({ f, dm, tc: node.temporalCoverage || "" });
    }
  }
  // 파일 기준일과의 일치는 페이지를 굽는 실행에서만 FAIL — 환율 워크플로는 opbox-ai-data.json 만 다시 굽고 페이지는 그대로 둔다(경고, AS1 과 같은 기준).
  for (const a of aiNodes) {
    if (aiAsOf && a.dm !== aiAsOf) (PUBLISH_TOUCHED ? errors : warnings).push(`DS1${PUBLISH_TOUCHED ? ":" : "(경고)"} ${a.f} opbox-ai-data.json Dataset dateModified ${a.dm} ≠ 파일 datasetUpdatedOn ${aiAsOf}`);
    if (a.tc !== aiNodes[0].tc) errors.push(`DS1: ${a.f} opbox-ai-data.json Dataset 기간 ${a.tc} ≠ ${aiNodes[0].f} ${aiNodes[0].tc}`);
  }
  if (!n) errors.push("DS1: Dataset 구조화데이터를 하나도 못 읽었다");
  // free-data Dataset 하나하나 = 그 Dataset 이 내려주는 파일 — 2026-10-15(3차). #ai-grading-json·#ai-auctions-json 이 dateModified 10-14(기간 …/10-14)인데
  // 가리키는 opbox-ai-grading.json·opbox-ai-auctions.json 은 datasetUpdatedOn 10-15 에 10-15 행이 있었다. 위 검사는 opbox-ai-data.json 을 가리키는 것만 봤다.
  //   JSON(datasetUpdatedOn 있음): dateModified = datasetUpdatedOn, 기간 끝 = 파일 안 관측 행 날짜(observedOn·sampleCollectedOn·date) 최댓값.
  //   CSV: dateModified = 기간 끝 = 파일 안 날짜 칸 최댓값. 카드리스트(JSON 여러 개): 기간 끝 = 공식 목록 확인일·행 관측일(nm·auction·psa10) 최댓값, dateModified ≥ 각 파일 updated.
  if (exists("free-data.html")) {
    const maxD = (arr) => arr.filter((d) => ISO15.test(d || "")).sort().at(-1) || "";
    const ROW_KEYS = new Set(["observedOn", "sampleCollectedOn", "date"]);
    const rowMax = (doc) => { const out = []; const walk = (o, k) => { if (Array.isArray(o)) o.forEach((v) => walk(v, k)); else if (o && typeof o === "object") for (const [kk, v] of Object.entries(o)) walk(v, kk); else if (ROW_KEYS.has(k)) out.push(o); }; walk(doc, ""); return maxD(out); };
    let fdN = 0;
    for (const node of ldOf15(read("free-data.html")).flatMap(flat).filter((x) => x["@type"] === "Dataset")) {
      const files = [].concat(node.distribution || []).map((x) => String((x && x.contentUrl) || "").replace("https://opboxindex.com/", "")).filter((p) => p && exists(p));
      const dm = node.dateModified, end = String(node.temporalCoverage || "").split("/")[1] || "";
      const who = `free-data.html Dataset "${node.name}"`;
      if (!files.length) { errors.push(`DS1: ${who} 가 내려주는 파일을 못 찾았다`); continue; }
      fdN++;
      if (files.length === 1 && files[0].endsWith(".json")) {
        let doc = {};
        try { doc = JSON.parse(read(files[0])); } catch (e) { errors.push(`DS1: ${files[0]} 읽기 실패 — ${e.message}`); continue; }
        const want = rowMax(doc);
        if (ISO15.test(doc.datasetUpdatedOn || "") && dm !== doc.datasetUpdatedOn) errors.push(`DS1: ${who} dateModified ${dm} ≠ ${files[0]} datasetUpdatedOn ${doc.datasetUpdatedOn}`);
        if (want && end !== want) errors.push(`DS1: ${who} 기간 끝 ${end || "(없음)"} ≠ ${files[0]} 가장 늦은 관측 행 ${want}`);
      } else if (files.length === 1 && files[0].endsWith(".csv")) {
        const want = maxD(read(files[0]).match(/\b\d{4}-\d{2}-\d{2}\b/g) || []);
        if (dm !== want || end !== want) errors.push(`DS1: ${who} dateModified ${dm} · 기간 끝 ${end || "(없음)"} ≠ ${files[0]} 가장 늦은 날짜 ${want}`);
      } else {
        const ends = [], ups = [];
        for (const p of files.filter((x) => x.endsWith(".json"))) {
          let j = {};
          try { j = JSON.parse(read(p)); } catch { continue; }
          ups.push(j.updated);
          ends.push(j.officialList && j.officialList.checked);
          for (const c of j.cards || []) ends.push(c.nm && c.nm.observedOn, c.auction && c.auction.through, c.auctionEnglishPrint && c.auctionEnglishPrint.through, c.psa10 && c.psa10.observedOn);
        }
        if (end !== maxD(ends)) errors.push(`DS1: ${who} 기간 끝 ${end || "(없음)"} ≠ 카드리스트 파일 가장 늦은 날짜 ${maxD(ends)}`);
        if (!(dm >= maxD(ups))) errors.push(`DS1: ${who} dateModified ${dm} < 카드리스트 파일 updated ${maxD(ups)}`);
      }
    }
    if (!fdN) errors.push("DS1: free-data.html Dataset 을 파일과 하나도 대조하지 못했다");
  }
}

// ════ 2026-10-15 2차 — 1차 수정이 남긴 "한 사실 두 값" (RY1·NM2) ════
// 원천 카드 열쇠 = 번호|정규화 이름(카드 상세·AI 카드 파일·card-map.json 과 같은 열쇠).
const cardKey15 = (num, name) => `${num}|${String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "")}`;
const unH15 = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
let CMAP15 = {}, AIC15 = [], AID15 = [], PK15 = {};
try { CMAP15 = JSON.parse(read("cards/card-map.json")); AIC15 = JSON.parse(read("opbox-ai-cards.json")).pages || []; AID15 = JSON.parse(read("opbox-ai-data.json")).sets || []; PK15 = JSON.parse(read("data/onepiece-packs.json")).sets || {}; }
catch (e) { errors.push("RY1: 원천(card-map·AI 피드·packs) 읽기 실패 — " + e.message); }

// ── RY1. 한 카드 한 레어도 — 2026-10-15 신설(2차).
//    1차 수정이 한국어 세트 페이지만 공식 레어도로 바꿔 ST31-004 SP 인쇄가 ko/op-17 은 SP, sets/op-17 은 Super Rare, 카드 상세·AI JSON 은 SR 이었다
//    (한국어 인기 카드 168행 중 72행이 영문과 달랐다). 같은 카드(번호|이름)의 레어도 코드가 세트 Top 10(영문 낱말)·한국어 인기 카드·PSA 10 랭킹·
//    카드 상세 "Rarity label"·opbox-ai-cards.json·opbox-ai-data.json topHits 에서 하나여야 한다(없으면 모두 없음).
//    카드 상세 <title> 은 보지 않는다(SEO 민감 요소). H1 의 작은 "번호 · 레어도" 표기는 3차(2026-10-15)부터 같이 본다.
{
  // 영문 낱말 → 코드. 생성기 사전(card-list-shared.RARITY_EN)을 읽지 않고 여기 따로 둔다 — 사전이 바뀌면 이 검사가 먼저 깨져 알린다.
  const EN2CODE = { Leader: "L", "Secret Rare": "SEC", "Super Rare": "SR", Rare: "R", Uncommon: "UC", Common: "C", "SP Card": "SP", Special: "SP", "Treasure Rare": "TR", Promo: "P" };   // TR 낱말(2026-10-15, 4차)
  const absent = (r) => (r == null || r === "" || r === "—" || r === "not supplied" ? "" : r);
  const seen = new Map();
  const add = (num, name, where, r) => { const k = cardKey15(num, name); if (!seen.has(k)) seen.set(k, []); seen.get(k).push({ where, r: absent(r) }); };
  try {
    for (const code of Object.keys(PK15)) {
      const f = `sets/${code.toLowerCase()}.html`;
      if (exists(f)) {
        const tbl = (read(f).match(/<table class="chaseTable">[\s\S]*?<\/table>/) || [""])[0];
        for (const m of tbl.matchAll(/<td class="cn">(?:<a [^>]*>)?<strong>([^<]*)<\/strong>(?:<\/a>)?<span class="cNum">([^<]*)<\/span>/g)) {
          const [num, label] = unH15(m[2]).split(" · ");
          add(num, unH15(m[1]), f, label ? EN2CODE[label] || label : "");
        }
      }
      const k = `ko/${code.toLowerCase()}.html`;
      if (exists(k)) {
        const sec = (read(k).match(/<section aria-label="인기 카드 시세">[\s\S]*?<\/section>/) || [""])[0];
        for (const m of sec.matchAll(/<td class="nm">([^<]*)<\/td><td class="code">([^<]*)<\/td><td>([^<]*)<\/td>/g)) add(unH15(m[2]), unH15(m[1]), k, unH15(m[3]));
      }
    }
    if (exists("psa10-ranking.html")) {
      for (const m of read("psa10-ranking.html").matchAll(/<span><b>([^<]*)<\/b><small>([^<]*)<\/small><\/span>/g)) {
        const parts = unH15(m[2]).split(" · ");   // 세트 · 번호 · 레어도
        if (parts.length >= 2) add(parts[1], unH15(m[1]), "psa10-ranking.html", parts[2] ? EN2CODE[parts[2]] || parts[2] : "");
      }
    }
    for (const [key, file] of Object.entries(CMAP15)) {
      const f = `cards/${file}`;
      if (!exists(f)) continue;
      const html = read(f);
      const m = html.match(/<li>Rarity label: ([^<]*)<\/li>/);
      if (!m) { errors.push(`RY1: ${f} 변형 기록에 "Rarity label" 줄이 없다 — 칸 구조가 바뀌었으면 이 검사도 고칠 것`); continue; }
      if (!seen.has(key)) seen.set(key, []);
      seen.get(key).push({ where: f, r: absent(unH15(m[1])) });
      // H1 의 작은 표기("번호 · 레어도")도 같은 코드 — 2026-10-15(3차). H1 은 원본 c.rarity, "Rarity label" 은 공식 코드라
      // EB03-026 Boa Hancock SP 가 한 페이지에서 H1 "· SR" · label "SP" 였다(52장). label 이 없으면 H1 에도 없다.
      const h1 = html.match(/<h1>[^<]*<small[^>]*>([^<]*)<\/small><\/h1>/);
      if (!h1) { errors.push(`RY1: ${f} H1 의 <small> 표기를 못 읽었다 — 구조가 바뀌었으면 이 검사도 고칠 것`); continue; }
      seen.get(key).push({ where: `${f} H1`, r: absent(unH15(h1[1]).split(" · ")[1] || "") });
    }
    for (const p of AIC15) add(p.cardNumber, p.name, "opbox-ai-cards.json", p.rarity);
    for (const s of AID15) for (const h of s.topHits || []) add(h.cardNumber, h.name, `opbox-ai-data.json ${s.setCode}`, h.rarity);
  } catch (e) { errors.push("RY1: 산출물 읽기 실패 — " + e.message); }
  let compared = 0, bad = 0;
  for (const [key, list] of seen) {
    if (list.length < 2) continue;
    compared++;
    const vals = [...new Set(list.map((x) => x.r))];
    if (vals.length > 1 && bad++ < 15) errors.push(`RY1: ${key} 레어도가 갈린다 — ${list.map((x) => `${x.where} ${x.r || "(없음)"}`).join(" · ")} (공식 카드 리스트의 그 인쇄 레어도 하나로)`);
  }
  if (bad > 15) errors.push(`RY1: 그 밖에 ${bad - 15}장 더`);
  if (!compared) errors.push("RY1: 두 곳 이상에 나온 카드가 0장 — 표 구조 확인");
}

// ── NM2. NM 호가 하나 = 어디서나 같은 값(또는 어디서나 없음) — 2026-10-15 신설(2차).
//    1차 수정 뒤 AI 피드만 읽은 날 없는 NM 5장·숨김 표시 NM 5장을 null 로 냈다. 같은 카드가 카드 상세엔 $1,250·$31·$38(날짜 없이), Product 엔 숨김 표시 2장의
//    NM Offer($157·$630), sets/prb-02 Key facts 엔 "most valuable PRB-02 card … $1,250 raw NM", 카드리스트엔 "$31<small></small>"·nm {usd, observedOn:null}.
//    (a) 카드 상세 화면 NM = opbox-ai-cards.json 같은 url 의 rawNmAsk(달러 반올림) — 둘 다 있고 같거나 둘 다 없음.
//        Product 의 NM Offer·설명(meta·Article·Product)·FAQ 금액도 화면 값과 같고, 화면에 없으면 없다. 형제 카드 표·카드 허브 칸도 그 카드의 피드 값.
//    (b) 세트 Top 10 NM 칸 — 원천 카드의 NM 을 못 쓰면(nmJpy 는 있는데 nmUsable 거짓) "—", 쓸 수 있으면 값. topHits 에 있으면 rawNmAsk 와 같은 값.
//    (c) 세트 "most valuable … raw NM"·"raw Japanese NM copy runs about" 금액 — 3차(2026-10-15)부터 PC1 이 가장 비싼 카드(priciest) 기준으로 본다.
//    (d) 카드리스트 JSON nm.usd 는 nm.observedOn 이 있을 때만(CSV·HTML 은 같은 행 모델). (e) 한국어 세트 인기 카드 표의 카드는 모두 쓸 수 있는 NM.
{
  let bad = 0;
  const push = (msg) => { if (bad++ < 15) errors.push(msg); };
  const feedUsd = (ask) => (ask && Number.isFinite(ask.usdEquivalent) ? money15(ask.usdEquivalent) : null);
  const byUrl = new Map(AIC15.map((p) => [p.url, p]));
  const fileFeed = (file) => { const p = byUrl.get(`https://opboxindex.com/cards/${file}`); return p ? feedUsd(p.rawNmAsk) : undefined; };
  // (a)
  let pages = 0;
  for (const f of PUBLIC_HTML.filter((p) => /^cards\/(?!index\.html$)[^/]+\.html$/.test(p))) {
    const html = read(f);
    if (/http-equiv="refresh"/i.test(html)) continue;
    const box = html.match(/<span>Japanese NM \(raw\)<\/span><b>([^<]*)<\/b>/);
    if (!box) continue;
    pages++;
    const shown = /^\$[\d,]+$/.test(box[1]) ? box[1] : null;
    const feed = fileFeed(f.slice(6));
    if (feed === undefined) { if (shown) push(`NM2: ${f} 화면 NM ${shown} — opbox-ai-cards.json 에 이 페이지가 없다`); continue; }
    if (shown !== feed) push(`NM2: ${f} 화면 NM ${shown || "없음"} ≠ AI 피드 rawNmAsk ${feed || "null"} — 둘 다 같은 값이거나 둘 다 없어야 한다`);
    const lds = ldOf15(html);
    const prod = lds.find((j) => j["@type"] === "Product");
    const nmOffer = prod ? [].concat(prod.offers || []).find((o) => o && o.name === "Japanese NM (raw)") : null;
    if (nmOffer && (!shown || money15(nmOffer.price) !== shown)) push(`NM2: ${f} Product NM Offer ${nmOffer.price} — 화면 NM ${shown || "없음"} 과 다르다(숨김·날짜 없는 NM 은 Offer 도 없다)`);
    const descs = [(html.match(/<meta name="description" content="([^"]*)"/) || [])[1], ...lds.filter((j) => j.description).map((j) => j.description)].filter(Boolean).map(unH15);
    for (const d of descs) {
      const m = d.match(/\bNM (\$\d{1,3}(?:,\d{3})*)/);
      if ((m ? m[1] : null) !== shown) push(`NM2: ${f} 설명의 NM ${m ? m[1] : "없음"} ≠ 화면 ${shown || "없음"} — "${d.slice(0, 60)}"`);
    }
    const faq = (lds.find((j) => j["@type"] === "FAQPage") || {}).mainEntity || [];
    for (const q of faq) {
      const m = ((q.acceptedAnswer || {}).text || "").match(/tracked near (\$\d{1,3}(?:,\d{3})*) in Japanese near-mint/);
      if (m && m[1] !== shown) push(`NM2: ${f} FAQ NM ${m[1]} ≠ 화면 ${shown || "없음"}`);
      if (!m && shown && /worth\?$/.test(q.name || "")) push(`NM2: ${f} 시세 문답에 화면 NM ${shown} 이 없다`);
    }
    // 같은 세트 형제 카드 표 — 각 칸 = 링크된 카드의 피드 값
    const sib = (html.match(/<h2>More [^<]* cards tracked here<\/h2>[\s\S]*?<\/table>/) || [""])[0];
    for (const r of sib.matchAll(/<tr><td><a href="([^"]+\.html)">[^<]*<\/a><\/td><td class="num">([^<]*)<\/td>/g)) {
      const fv = fileFeed(r[1]);
      if (fv === undefined) continue;
      const cell = /^\$[\d,]+$/.test(r[2]) ? r[2] : null;
      if (cell !== fv) push(`NM2: ${f} 형제 카드 표 ${r[1]} NM ${cell || "—"} ≠ AI 피드 ${fv || "null"}`);
    }
  }
  if (!pages) errors.push("NM2: 카드 상세의 NM 칸을 한 장도 못 읽었다 — 칸 구조가 바뀌었으면 이 검사도 고칠 것");
  if (exists("cards/index.html")) {
    for (const m of read("cards/index.html").matchAll(/<a href="([^"]+\.html)">(?:<img [^>]*>)?<b>[^<]*<\/b><small>[^<]*<\/small><span class="pr">([^<]*)<\/span><\/a>/g)) {
      const fv = fileFeed(m[1]);
      if (fv === undefined) continue;
      const cell = /^\$[\d,]+$/.test(m[2]) ? m[2] : null;
      if (cell !== fv) push(`NM2: cards/index.html ${m[1]} NM ${cell || "—"} ≠ AI 피드 ${fv || "null"}`);
    }
  }
  // (b)(c)
  const topHitOf = (code, c) => { const s = AID15.find((x) => x.setCode === code); return s ? (s.topHits || []).find((h) => h.cardNumber === c.number && h.name === c.name) : null; };
  for (const [code, s] of Object.entries(PK15)) {
    const f = `sets/${code.toLowerCase()}.html`;
    const cards = s.cards || [];
    if (!exists(f) || !cards.length) continue;
    const html = read(f);
    const tbl = (html.match(/<table class="chaseTable">[\s\S]*?<\/table>/) || [""])[0];
    for (const r of tbl.matchAll(/<tr><td>(\d+)<\/td>[\s\S]*?<\/tr>/g)) {
      const c = cards[Number(r[1]) - 1];
      if (!c || !(c.nmJpy > 0)) continue;   // NM 조사 전 카드(TCG 폴백)는 이 검사 밖
      const cellHtml = ([...r[0].matchAll(/<td class="num[^"]*"[^>]*>([\s\S]*?)<\/td>/g)][0] || [])[1] || "";
      const cell = (cellHtml.match(/^\$\d{1,3}(?:,\d{3})*/) || [])[0] || null;
      const th = topHitOf(code, c);
      if (!nmUsable15(c)) { if (cell) push(`NM2: ${f} ${c.number} ${c.name} NM 칸 ${cell} — 읽은 날 없음·숨김 표시 NM 은 "—"(피드 null)`); continue; }
      if (!cell) push(`NM2: ${f} ${c.number} ${c.name} NM 칸이 비었다 — 쓸 수 있는 NM 이 있다`);
      // topHits 는 환율 워크플로가 opbox-ai-data.json 만 다시 구울 때 새 환율로 바뀐다 — 페이지를 굽는 실행에서만 FAIL(2026-10-15, 3차: 그 워크플로가 막히지 않게)
      else if (th && feedUsd(th.rawNmAsk) !== cell) { if (PUBLISH_TOUCHED) push(`NM2: ${f} ${c.number} NM 칸 ${cell} ≠ AI topHits ${feedUsd(th.rawNmAsk) || "null"}`); else warnings.push(`NM2(경고) ${f} ${c.number} NM 칸 ${cell} ≠ AI topHits ${feedUsd(th.rawNmAsk) || "null"}`); }
    }
    // (c) 는 3차(2026-10-15)에 PC1 로 옮겼다 — 기준이 1순위 카드(cards[0])에서 가장 비싼 카드(priciest)로 바뀌었다.
  }
  // (d)
  for (const f of fs.readdirSync(path.join(ROOT, "sets")).filter((x) => /-card-list\.json$/.test(x))) {
    for (const r of JSON.parse(read("sets/" + f)).cards || []) {
      if (r.nm && (r.nm.usd != null) !== ISO15.test(r.nm.observedOn || "")) push(`NM2: sets/${f} ${r.id} nm ${JSON.stringify(r.nm)} — 값은 관측일과 함께만`);
    }
  }
  for (const f of PUBLIC_HTML.filter((p) => /-card-list\.html$/.test(p))) if (read(f).includes("<small></small>")) push(`NM2: ${f} 빈 <small></small> 칸 — 날짜 없는 값`);
  // (e)
  for (const k of KO_SET_PAGES15) {
    const cards = (PK15[k.slice(3, -5).toUpperCase()] || {}).cards || [];
    const sec = (read(k).match(/<section aria-label="인기 카드 시세">[\s\S]*?<\/section>/) || [""])[0];
    for (const m of sec.matchAll(/<td class="nm">([^<]*)<\/td><td class="code">([^<]*)<\/td>/g)) {
      const c = cards.find((x) => x.number === unH15(m[2]) && x.name === unH15(m[1]));
      if (c && !nmUsable15(c)) push(`NM2: ${k} 인기 카드 ${c.number} ${c.name} — 읽은 날 없음·숨김 표시 NM 을 원화로 보인다(피드 null)`);
    }
  }
  if (bad > 15) errors.push(`NM2: 그 밖에 ${bad - 15}건 더`);
}

// ════ 2026-10-15 3차 — 지표·가장 비싼 카드가 페이지마다 다른 규칙으로 셈 (CM1·PC1) ════
const { priciest: priciest15, tcgSpikes: tcgSpikes15, toUsd: toUsd15 } = require("./market-data-normalizers");
const FX15 = (() => { try { return JSON.parse(read("data/onepiece-packs.json")).fx || {}; } catch { return {}; } })();
// 검증된 값 / 검증 안 된 값 — 2026-10-15(4차). 생성기 함수(market-data-normalizers.rawValues)를 읽지 않고 여기서 따로 셈한다 — 함수가 틀리면 이 검사가 먼저 깨진다.
//   verified = 쓸 수 있는 NM(값·읽은 날 있음·숨김 표시 없음)의 달러(높은 순). unverified = 못 쓰는 NM 의 NM 값 · NM 없는 카드의 1회성 TCG 값(숨김 표시 포함, 스파이크 제외).
const rawSplit15 = (cards) => {
  const list = (cards || []).filter(Boolean);
  const spikes = tcgSpikes15(list);
  const verified = list.filter((c) => nmUsable15(c)).map((c) => ({ c, usd: toUsd15(c.nmJpy, "JPY", FX15) })).filter((x) => x.usd > 0).sort((a, b) => b.usd - a.usd);
  // 2026-10-15(5차): 못 쓰는 카드마다 가진 raw 값 중 큰 것 하나(NM 값·날짜 없는 TCG 값, 스파이크 제외). 4차는 NM 이 남은 숨김 카드의 NM 만 세서
  //   EB-02 Boa SP(NM $630·TCG $6,970)·Chopper SP(TCG $2,856)가 Luffy 061 $2,197 아래로 잡혔다(같은 숨김 표시 OP-08 Luffy TR 은 TCG $455 로 빈칸).
  const unverified = list.filter((c) => !nmUsable15(c)).map((c) => {
    const v = [c.nmJpy > 0 ? toUsd15(c.nmJpy, "JPY", FX15) : null, c.priceUsd > 0 && !spikes.has(c.priceUsd) ? c.priceUsd : null].filter((x) => x != null);
    return v.length ? Math.max(...v) : null;
  }).filter((v) => v != null);
  return { verified, unverified };
};

// ── CM1. 세트 지표(Value density · Chase concentration · Floor of the top N) — 2026-10-15 신설(3차), 4차에 규칙 교체.
//    2차가 못 쓰는 NM 카드를 빼고 계산해 sets/prb-02 Chase concentration 이 50% → 20%(#1 카드가 표 1위 산지가 아니라 $251 카드),
//    sets/eb-02 는 10장 중 5장으로 셌다. 3차는 날짜 없는 TCG 값을 같이 세어 OP-08 Chase concentration 35% 의 #1 이 숨김 표시 Luffy TR TCG $455 였다.
//    4차 규칙: 검증된 값(쓸 수 있는 NM)만 센다. 검증 안 된 값이 센 값 중 가장 낮은 값 이상이면 세 칸 모두 "—"(raw 값이 있는 카드 5장 이상일 때 칸은 둔다).
{
  let bad = 0, sets = 0;
  // 값 대조는 페이지를 굽는 실행에서만 FAIL — 환율 워크플로는 packs.fx 만 바꾸고 세트 페이지는 그대로 둔다(경고, DS1·AS1 과 같은 기준).
  const push = (msg) => { if (bad++ < 15) (PUBLISH_TOUCHED ? errors : warnings).push(PUBLISH_TOUCHED ? msg : msg.replace(/^CM1:/, "CM1(경고)")); };
  const strip = (h) => unH15(String(h).replace(/<[^>]+>/g, "")).trim();
  for (const [code, s] of Object.entries(PK15)) {
    const f = `sets/${code.toLowerCase()}.html`;
    if (!exists(f)) continue;
    const grid = {};
    for (const m of read(f).matchAll(/<div class="statLabel">([\s\S]*?)<\/div><div class="statValue">([\s\S]*?)<\/div>/g)) grid[strip(m[1])] = strip(m[2]);
    const floorKey = Object.keys(grid).find((k) => /^Floor of the top \d+$/.test(k));
    const shown = { dens: grid["Value density"], conc: grid["Chase concentration"], floor: floorKey ? grid[floorKey] : undefined };
    const list = (s.cards || []).slice(0, 10);
    const { verified, unverified } = rawSplit15(list);
    const vals = verified.map((x) => x.usd);
    const floorV = vals.length ? vals[vals.length - 1] : 0;
    const blockers = unverified.filter((v) => v >= floorV);
    if (blockers.length) {
      sets++;
      for (const [k, v] of Object.entries(shown)) if (v !== undefined && v !== "—") push(`CM1: ${f} ${k === "floor" ? floorKey : k === "conc" ? "Chase concentration" : "Value density"} ${v} — 검증 안 된 값 ${blockers.map((v) => money15(v)).join("·")} 이 센 값의 바닥 ${money15(floorV)} 이상이면 "—"`);
      if (vals.length + unverified.length >= 5 && Object.values(shown).some((v) => v === undefined)) push(`CM1: ${f} 지표 칸이 빠졌다 — 검증 안 된 값 때문이면 칸은 두고 값만 "—"`);
      continue;
    }
    if (vals.length < 5) { if (Object.values(shown).some((v) => v !== undefined)) push(`CM1: ${f} raw 값 ${vals.length}장으로 지표를 냈다(5장 미만이면 칸 없음)`); continue; }
    sets++;
    const total = vals.reduce((a, v) => a + v, 0);
    const want = { dens: `${vals.filter((v) => v >= 25).length} / ${vals.length}`, conc: `${Math.round((vals[0] / total) * 100)}%`, floor: money15(Math.round(vals[vals.length - 1])) };
    if (floorKey !== `Floor of the top ${vals.length}`) push(`CM1: ${f} 지표 이름 "${floorKey || "(없음)"}" ≠ "Floor of the top ${vals.length}"`);
    for (const k of Object.keys(want)) if (shown[k] !== want[k]) push(`CM1: ${f} ${k === "floor" ? "Floor" : k === "conc" ? "Chase concentration" : "Value density"} ${shown[k] || "(없음)"} ≠ ${want[k]}(Top 10 검증된 NM ${vals.length}장으로 다시 셈)`);
  }
  if (bad > 15) (PUBLISH_TOUCHED ? errors : warnings).push(`CM1${PUBLISH_TOUCHED ? ":" : "(경고)"} 그 밖에 ${bad - 15}건 더`);
  if (!sets) errors.push("CM1: 지표를 대조한 세트가 0개 — 칸 구조 확인");
}

// ── PC1. 가장 비싼 카드 하나 = 어디서나 같은 카드·같은 값·같은 라벨 — 2026-10-15 신설(3차).
//    세트 Key facts·추적 문단·한국어 문단은 소유자 순위 1위, 비교표 2곳은 nmJpy 최댓값을 써서 OP-05 가 세트 페이지 "$3,144 Monkey D. Luffy (OP05-119)" ·
//    비교표 "$5,038 Monkey D. Luffy 012 …"(같은 페이지 Top 10 2행도 $5,038) · ko/op-05 "4,203,120원" 이었다. PRB-01 은 세트 페이지 $4,250(TCG) · 비교표 $1,250.
//    기대값(4차, 2026-10-15) = 검증된 값(쓸 수 있는 NM) 최댓값, 검증 안 된 값(못 쓰는 NM·날짜 없는 1회성 TCG·숨김 표시 카드의 TCG) 중 그 값 이상이 있으면 없음.
//    여기서 따로 셈하고(rawSplit15) 모듈 priciest 와도 맞춘다 — 3차 모듈은 TCG 값도 1위로 올려 OP-08(숨김 Luffy TR TCG $455)·OP-15(Koby TCG $652)·
//    PRB-01(TCG $4,250)이 "가장 비싼 카드"가 됐다. 라벨은 NM 하나 — "raw TCG market price"/"TCG 시세"/칸의 "TCG" 가 보이면 실패.
//    (a) sets/<code>.html·<code>-english.html "The most valuable …" · "The chase in … is led by" · 박스 대비 배수("The top card alone (…)" 등)
//    (b) ko/<code>.html "이 박스의 가치를 끌고 가는 카드는"(원화 ÷ 환율 = 달러 ±1)  (c) compare.html·articles/best-one-piece-booster-box.html "Priciest card (raw)" 칸
//    가장 비싼 카드가 없으면(null) 세 곳 모두 그 문장·값이 없다.
{
  let bad = 0, said = 0;
  // 값 대조는 페이지를 굽는 실행에서만 FAIL — 환율 워크플로는 packs.fx 만 바꾸고 페이지는 그대로 둔다(경고, DS1·AS1 과 같은 기준).
  const push = (msg) => { if (bad++ < 15) (PUBLISH_TOUCHED ? errors : warnings).push(PUBLISH_TOUCHED ? msg : msg.replace(/^PC1:/, "PC1(경고)")); };
  const nm = (h) => unH15(String(h)).trim();
  const namesOk = (got, pc) => pc.ties.every((c) => got.includes(c.name)) && (pc.ties.length > 1 || got === pc.card.name);
  // 따로 셈한 가장 비싼 카드 — { card, price: { usd }, ties } | null
  const expect = (cards) => {
    const { verified, unverified } = rawSplit15(cards);
    if (!verified.length || unverified.some((v) => v >= verified[0].usd)) return null;
    const ties = verified.filter((x) => x.usd === verified[0].usd).map((x) => x.c);
    return { card: ties[0], price: { usd: verified[0].usd }, ties };
  };
  const cmpBlocks = ["compare.html", "articles/best-one-piece-booster-box.html"].filter(exists).map((f) => [f, (read(f).match(/<!-- SET-COMPARISON:START -->[\s\S]*?<!-- SET-COMPARISON:END -->/) || [""])[0]]);
  if (cmpBlocks.length < 2 || cmpBlocks.some(([, b]) => !b)) errors.push("PC1: 비교표(compare.html·best-one-piece-booster-box.html) 블록을 못 읽었다");
  for (const [code, s] of Object.entries(PK15)) {
    const pc = expect(s.cards || []);
    const mod = priciest15(s.cards || [], FX15);
    if (!!pc !== !!mod || (pc && (mod.price.usd !== pc.price.usd || mod.ties.map((c) => c.name).join("|") !== pc.ties.map((c) => c.name).join("|"))))
      push(`PC1: ${code} market-data-normalizers.priciest "${mod ? `${mod.ties.map((c) => c.name).join(" · ")} ${money15(mod.price.usd)}${mod.price.kind === "TCG" ? " TCG" : ""}` : "없음"}" ≠ 검증된 NM 규칙 "${pc ? `${pc.ties.map((c) => c.name).join(" · ")} ${money15(pc.price.usd)}` : "없음(검증 안 된 값이 1위 이상)"}"`);
    const want = pc ? { usd: money15(pc.price.usd), tcg: false } : null;
    const tag = pc ? `${pc.card.name} ${want.usd}${want.tcg ? " TCG" : ""}` : "없음";
    // (a)
    for (const f of [`sets/${code.toLowerCase()}.html`, `sets/${code.toLowerCase()}-english.html`].filter(exists)) {
      const html = read(f);
      const found = [];
      // 금액 뒤 "(YYYY-MM-DD)" = 그 카드 NM 관측일(nmUpdated) — 2026-10-15(5차): OP-12 Teach SP Gold $1,566(09-07 값)이 날짜 없이 나갔다.
      for (const m of html.matchAll(/The most valuable \S+ card is <strong>([^<]*)<\/strong>(?: \([^)]*\))? at about <strong>(\$[\d,]+)<\/strong> (raw NM|raw TCG market price)(?: \((\d{4}-\d{2}-\d{2})\))?/g)) found.push({ k: "Key facts", n: nm(m[1]), v: m[2], tcg: m[3] !== "raw NM", d: m[4] || null });
      for (const m of html.matchAll(/The most valuable \S+ cards are <strong>([^<]*)<\/strong>, tied at about <strong>(\$[\d,]+)<\/strong> (raw NM|raw TCG market price) each(?: \((\d{4}-\d{2}-\d{2})\))?/g)) found.push({ k: "Key facts(동가)", n: nm(m[1]), v: m[2], tcg: m[3] !== "raw NM", d: m[4] || null });
      for (const m of html.matchAll(/The chase in \S+ is led by <strong>([^<]*)<\/strong>(?: \([^)]*\))?, whose (raw Japanese NM copy|raw TCG market price) runs about (\$[\d,]+)(?: \((\d{4}-\d{2}-\d{2})\))?/g)) found.push({ k: "추적 문단", n: nm(m[1]), v: m[3], tcg: m[2] !== "raw Japanese NM copy", d: m[4] || null });
      for (const m of html.matchAll(/The chase in \S+ is led by <strong>([^<]*)<\/strong>, tied at about (\$[\d,]+) (raw Japanese NM|raw TCG market price) each(?: \((\d{4}-\d{2}-\d{2})\))?/g)) found.push({ k: "추적 문단(동가)", n: nm(m[1]), v: m[2], tcg: m[3] !== "raw Japanese NM", d: m[4] || null });
      for (const m of html.matchAll(/The top (?:card alone|chase|\d+ cards) \((.*?)\) (?:is worth|runs about|are each worth)/g)) found.push({ k: "박스 대비 배수", n: nm(m[1]), v: null });
      const ledBy = (html.match(/The chase in \S+ is led by/g) || []).length;
      const ledParsed = found.filter((x) => x.k.startsWith("추적 문단")).length;
      if (ledBy !== ledParsed) push(`PC1: ${f} "The chase in … is led by" 문장 ${ledBy}개 중 ${ledParsed}개만 raw 값과 함께 읽힘 — 값 없는 1순위 카드 문장이 남았다`);
      if (!pc) { for (const x of found) push(`PC1: ${f} ${x.k} "${x.n}${x.v ? " " + x.v : ""}" — 가장 비싼 카드를 모른다(검증 안 된 값이 1위 값 이상)면 문장이 없어야 한다`); continue; }
      if (f.endsWith(`${code.toLowerCase()}.html`) && !found.some((x) => x.v)) push(`PC1: ${f} 가장 비싼 카드(${tag}) 문장이 없다`);
      for (const x of found) {
        said++;
        if (!namesOk(x.n, pc)) push(`PC1: ${f} ${x.k} 카드 "${x.n}" ≠ 가장 비싼 카드 ${pc.ties.map((c) => c.name).join(" · ")}`);
        if (x.v && x.v !== want.usd) push(`PC1: ${f} ${x.k} 금액 ${x.v} ≠ ${want.usd}(${pc.card.name})`);
        if (x.v && x.tcg !== want.tcg) push(`PC1: ${f} ${x.k} 라벨 ${x.tcg ? "TCG" : "NM"} ≠ ${want.tcg ? "TCG" : "NM"}`);
        if (x.v && x.d !== (pc.card.nmUpdated || null)) push(`PC1: ${f} ${x.k} 금액 뒤 NM 관측일 ${x.d || "(없음)"} ≠ ${pc.card.nmUpdated}(${pc.card.name})`);
      }
    }
    // (b)
    const k = `ko/${code.toLowerCase()}.html`;
    if (exists(k)) {
      const html = read(k);
      const m = html.match(/이 박스의 가치를 끌고 가는 카드는 <strong>([^<]*)<\/strong>(?:\(([^)]*)\))?로, (일본판 NM 시세|TCG 시세)가 (?:모두 )?약 <strong>([\d,]+)원<\/strong>(?:\((\d{4}-\d{2}-\d{2})\))?/);
      if (m && pc && (m[5] || null) !== (pc.card.nmUpdated || null)) push(`PC1: ${k} 원화 뒤 NM 관측일 ${m[5] || "(없음)"} ≠ ${pc.card.nmUpdated}(${pc.card.name}) — 2026-10-15(5차)`);
      if (/이 박스의 가치를 끌고 가는 카드는/.test(html) && !m) push(`PC1: ${k} "가치를 끌고 가는 카드" 문장을 못 읽었다 — 문장 구조가 바뀌었으면 이 검사도 고칠 것`);
      if (m && !pc) push(`PC1: ${k} "${nm(m[1])}" ${m[4]}원 — 가장 비싼 카드를 모르면 문장이 없어야 한다`);
      if (m && pc) {
        said++;
        const names = nm(m[1]).split(" · ");
        if (!(names.length === pc.ties.length && pc.ties.every((c) => names.includes(c.name)))) push(`PC1: ${k} 카드 "${nm(m[1])}" ≠ 가장 비싼 카드 ${pc.ties.map((c) => c.name).join(" · ")}`);
        if (m[2] && m[2] !== pc.card.number) push(`PC1: ${k} 카드 번호 ${m[2]} ≠ ${pc.card.number}`);
        if ((m[3] === "TCG 시세") !== want.tcg) push(`PC1: ${k} 라벨 "${m[3]}" ≠ ${want.tcg ? "TCG 시세" : "일본판 NM 시세"}`);
        const usdOfKrw = Number(m[4].replace(/,/g, "")) / FX15.usdKrw;
        if (!(Math.abs(usdOfKrw - pc.price.usd) < 1)) push(`PC1: ${k} ${m[4]}원(≈$${usdOfKrw.toFixed(2)}) ≠ ${want.usd}(${pc.card.name})`);
      }
    }
    // (c)
    for (const [f, blk] of cmpBlocks) {
      const row = blk.match(new RegExp(`<a href="/sets/${code.toLowerCase()}\\.html"><b>${code}</b>[\\s\\S]*?</tr>`));
      if (!row) continue;
      const cell = ([...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][4] || [])[1];   // JP box · EN box · 4-wk · EN/JP · Priciest card (raw) · PSA 10 rate
      if (cell == null) { push(`PC1: ${f} ${code} 행의 Priciest 칸을 못 읽었다`); continue; }
      // 금액 뒤 "(YYYY-MM-DD)" = NM 관측일 — 표의 "As of" 날짜와 다를 때만 붙는다(2026-10-15, 5차).
      const c = cell.match(/^(\$[\d,]+)(?: \((\d{4}-\d{2}-\d{2})\))?( TCG)? <small[^>]*>([^<]*)<\/small>$/);
      if (!pc) { if (cell !== "—") push(`PC1: ${f} ${code} Priciest "${nm(cell.replace(/<[^>]+>/g, ""))}" — 가장 비싼 카드를 모르면 "—"`); continue; }
      said++;
      if (!c) { push(`PC1: ${f} ${code} Priciest 칸 "${nm(cell.replace(/<[^>]+>/g, ""))}" ≠ ${tag}`); continue; }
      // 동가는 전부(세트 페이지와 같은 목록 — 2026-10-15 4차: OP-16 이 "Kuzan (Manga)" 하나뿐이었다)
      const tieNames = pc.ties.map((t) => t.name).join(", ");
      if (c[1] !== want.usd || !!c[3] !== want.tcg || nm(c[4]) !== tieNames) push(`PC1: ${f} ${code} Priciest "${c[1]}${c[3] || ""} ${nm(c[4])}" ≠ "${want.usd} ${tieNames}"`);
      const asOfT = (blk.match(/As of (\d{4}-\d{2}-\d{2})\./) || [])[1] || null;
      const wantD = pc.card.nmUpdated && pc.card.nmUpdated !== asOfT ? pc.card.nmUpdated : null;
      if ((c[2] || null) !== wantD) push(`PC1: ${f} ${code} Priciest 날짜 ${c[2] || "(없음)"} ≠ ${wantD || "(없음 — As of 와 같은 날)"}(NM 관측일 ${pc.card.nmUpdated}, 표 As of ${asOfT})`);
    }
  }
  if (bad > 15) (PUBLISH_TOUCHED ? errors : warnings).push(`PC1${PUBLISH_TOUCHED ? ":" : "(경고)"} 그 밖에 ${bad - 15}건 더`);
  if (!said) errors.push("PC1: 가장 비싼 카드 문장을 한 곳도 못 읽었다 — 문장 구조 확인");
}

// ════ 2026-10-15 4차 — 4주 변동률 한 값(CW1)·사유/방어 문장 재발(DF1) ════
// ── CW1. "4주 변동률" 한 사실 = 한 값 — 2026-10-15 신설(4차).
//    비교표(compare.html·best-one-piece-booster-box.html)의 4-wk 만 "5점 전(jp[len-5])"을 써서, 빈 주가 있는 세트가
//    OP-06 비교표 +7% · 세트 페이지 -6.5%(부호 반대) · OP-07 +0% · -40.3% 였다. 기대값은 여기서 따로 셈한다:
//    current.jp vs 그 날짜에서 28일 이상 앞선 마지막 중앙값 점, 소수 한 자리. 세트 페이지 "4-week change" 칸·한국어 팩트 줄·비교표 칸이 모두 이 값(없으면 모두 없음/"—").
{
  let SS = {};
  try { SS = JSON.parse(read("data/box-sold-series.json")).sets || {}; } catch (e) { errors.push("CW1: box-sold-series 읽기 실패 — " + e.message); }
  const want = (code, ed = "jp") => {
    const e = SS[code] || {}, cur = e.current && e.current[ed];
    if (!cur || !(cur.median > 0)) return null;
    const cut = Date.parse(cur.d) - 28 * 864e5;
    const prior = (e[ed] || []).filter((p) => p && p.median > 0 && Date.parse(p.d) <= cut).pop();
    return prior ? Math.round((cur.median / prior.median - 1) * 1000) / 10 : null;
  };
  // 영문판 페이지의 "4-week change" 도 같은 정의(영문판 시계열) — 4차에 en[len-5] 를 같은 함수로 바꿨다.
  for (const code of Object.keys(SS)) {
    const ep = `sets/${code.toLowerCase()}-english.html`;
    if (!exists(ep)) continue;
    const cell = (read(ep).match(/4-week change(?:<\/a>)?<\/div><div class="statValue">([\s\S]*?)<\/div>/) || [])[1];
    const got = cell == null ? null : Number(cell.replace(/<[^>]+>/g, "").replace(/[+%\s]/g, ""));
    const w = want(code, "en");
    if (got !== w) errors.push(`CW1: ${ep} 4-week change ${got == null ? "(없음)" : got + "%"} ≠ ${w == null ? "(없음)" : w + "%"}(영문판 current vs 28일 전 점)`);
  }
  const num = (t) => (t == null || t === "—" ? null : Number(String(t).replace(/[+%\s]/g, "")));
  const cmp = ["compare.html", "articles/best-one-piece-booster-box.html"].filter(exists).map((f) => [f, (read(f).match(/<!-- SET-COMPARISON:START -->[\s\S]*?<!-- SET-COMPARISON:END -->/) || [""])[0]]);
  let rowsRead = 0;
  for (const code of Object.keys(SS)) {
    const w = want(code);
    const sp = `sets/${code.toLowerCase()}.html`;
    if (exists(sp)) {
      const cell = (read(sp).match(/4-week change<\/a><\/div><div class="statValue">([\s\S]*?)<\/div>/) || [])[1];
      const got = cell == null ? null : num(cell.replace(/<[^>]+>/g, ""));
      if (got !== w) errors.push(`CW1: ${sp} 4-week change ${got == null ? "(없음)" : got + "%"} ≠ ${w == null ? "(없음)" : w + "%"}(current vs 28일 전 점)`);
    }
    const kp = `ko/${code.toLowerCase()}.html`;
    if (exists(kp)) {
      const li = (read(kp).match(/<li>\d{4}-\d{2}-\d{2} 대비 <strong>([^<]*)<\/strong>/) || [])[1];
      const got = li == null ? null : num(li);
      if (got !== w) errors.push(`CW1: ${kp} 변동률 ${li || "(없음)"} ≠ ${w == null ? "(없음)" : w + "%"}`);
    }
    for (const [f, blk] of cmp) {
      const row = blk.match(new RegExp(`<a href="/sets/${code.toLowerCase()}\\.html"><b>${code}</b>[\\s\\S]*?</tr>`));
      if (!row) continue;
      rowsRead++;
      const cell = ([...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][2] || [])[1];   // JP box · EN box · 4-wk
      const got = num(cell);
      if (got !== w) errors.push(`CW1: ${f} ${code} 4-wk "${cell}" ≠ ${w == null ? "—" : (w > 0 ? "+" : "") + w + "%"}(세트 페이지 4-week change 와 같은 값)`);
    }
  }
  if (cmp.length && !rowsRead) errors.push("CW1: 비교표 행을 하나도 못 읽었다 — 표 구조 확인");
}

// ── CL3. 날짜 한 값 — 카드리스트 화면 "Data"/"데이터" = CollectionPage dateModified = 세트 JSON "updated", free-data #card-lists = 그 updated 최댓값,
//    free-data 화면 "Page regenerated" = DataCatalog dateModified — 2026-10-15 신설(4차). 3차 결과가 화면 10-14 · dateModified 10-15 · JSON 10-14 였다.
{
  const ups = [];
  for (const f of PUBLIC_HTML.filter((p) => /^(?:sets|ko)\/[a-z]+-\d+-card-list\.html$/.test(p))) {
    const h = read(f);
    const shown = (h.match(/(?:Data|데이터) (\d{4}-\d{2}-\d{2})<\/p>/) || [])[1] || null;
    const dm = ((ldOf15(h).find((j) => j["@type"] === "CollectionPage") || {}).dateModified) || null;
    const jf = `sets/${f.replace(/^(?:sets|ko)\//, "").replace(/\.html$/, "")}.json`;
    let up = null;
    try { up = JSON.parse(read(jf)).updated || null; } catch { /* JSON 없음 */ }
    if (up) ups.push(up);
    if (!shown || shown !== dm || (up && up !== dm)) errors.push(`CL3: ${f} 화면 날짜 ${shown || "(없음)"} · CollectionPage dateModified ${dm || "(없음)"} · ${jf} updated ${up || "(없음)"} — 한 값이어야 한다`);
  }
  if (exists("free-data.html")) {
    const h = read("free-data.html");
    const graph = ldOf15(h).flatMap((j) => j["@graph"] || [j]);
    const cat = graph.find((n) => /#catalog$/.test(n["@id"] || "")), cl = graph.find((n) => /#card-lists$/.test(n["@id"] || ""));
    const regen = (h.match(/Page regenerated (\d{4}-\d{2}-\d{2})/) || [])[1] || null;
    if (cat && regen !== cat.dateModified) errors.push(`CL3: free-data.html 화면 "Page regenerated ${regen}" ≠ DataCatalog dateModified ${cat.dateModified}`);
    const maxUp = ups.sort().at(-1) || null;
    if (cl && maxUp && cl.dateModified !== maxUp) errors.push(`CL3: free-data.html #card-lists dateModified ${cl.dateModified} ≠ 카드리스트 JSON updated 최댓값 ${maxUp}`);
  }
}

// ── DF1. 사유·방어·방법 설명 문장 재발 금지 — 2026-10-15 신설(4차). 화면엔 숫자·표·라벨만(소유자 지시).
//    1~3차가 덧붙였다가 4차에 뺀 문장들: ko 세트 FAQ "…표시하지 않습니다"·"발매일 대비가 아닙니다"·"…재판 횟수에 포함하지 않습니다",
//    영문 세트 FAQ "…has no completed eBay sales median dated within 28 days", 카드 상세 "No dated Japanese near-mint price is shown for …",
//    세트 재판 줄 "Bandai does not call these reprints, so we do not either". 값이 없으면 문장 대신 문답을 빼거나 칸에 "—".
//    화면 텍스트와 JSON-LD(FAQPage 등) 모두 본다 — HTML 원문 전체를 검사한다.
{
  const BAN = [/표시하지 않습니다/, /포함하지 않습니다/, /대비가 아닙니다/, /재판이라 부르지 않/, /has no completed eBay sales median/, /No dated Japanese near-mint price is shown/, /does not call these reprints/, /we do not either/];
  let bad = 0;
  for (const f of PUBLIC_HTML.filter((p) => /^(?:ko|sets|cards)\//.test(p))) {
    const h = read(f);
    for (const re of BAN) {
      const m = h.match(re);
      if (m && bad++ < 20) errors.push(`DF1: ${f} 에 사유·방어 문장 "${m[0]}" — 값이 없으면 문장 대신 문답을 빼거나 "—"`);
    }
  }
  if (bad > 20) errors.push(`DF1: 그 밖에 ${bad - 20}건 더`);
}

// ════ 2026-10-15 5차 — 4차 검증에서 나온 모순·문구 결함 재발 방지 (PK1·FQ1·SP1·AN1·EQ1·EL1·CH1·KD1·FQ2·WK1) ════
// 값 대조(PK1·CH1·KD1·WK1)는 페이지를 굽는 실행에서만 FAIL — 환율·수집 워크플로는 데이터만 바꾸고 페이지는 그대로 둔다(PC1·CM1 과 같은 기준).
const esc15 = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");   // 생성기 esc 와 같은 이스케이프
const sink5 = (code) => (msg) => (PUBLISH_TOUCHED ? errors : warnings).push(PUBLISH_TOUCHED ? `${code}: ${msg}` : `${code}(경고) ${msg}`);

// ── PK1. PSA 10 실거래 중앙값 하나 = 한국어·영문 같은 값(±1%) — 2026-10-15 신설(5차).
//    ko 생성기가 옛 KRW 저장값을 그대로 써서 같은 관측(2026-06-29, n=10)이 ko/op-03 1,147,931원(= $859) · sets/op-03 $744 였다(ko/eb-02·op-13 도 12~15%).
//    기대값은 여기서 따로 셈한다: USD 저장값 그대로, KRW 저장값은 관측일(그 날 또는 직전 영업일) 환율로 되돌린 달러. 원화 = 그 달러 × packs.fx.usdKrw.
{
  const push = sink5("PK1");
  let FXH = {};
  try { FXH = JSON.parse(read("data/fx-history.json")).rates || {}; } catch { /* 없으면 오늘 환율 */ }
  const fxOn = (d) => { const k = Object.keys(FXH).filter((x) => x <= d).sort().pop(); return k ? FXH[k] : null; };
  const p10Usd = (c) => {
    const s = c && c.psa10Ebay;
    if (!s || !s.soldBased || !(s.middle > 0) || (s.sampleSize || 0) < 3) return null;
    if (s.currency === "USD") return s.middle;
    if (s.currency === "KRW") { const r = fxOn(String(s.updated || "").slice(0, 10)) || FX15.usdKrw; return r ? s.middle / r : null; }
    return null;
  };
  const off = (krw, usd) => Math.abs(krw / FX15.usdKrw / usd - 1);
  let seen = 0;
  for (const [code, s] of Object.entries(PK15)) {
    const k = `ko/${code.toLowerCase()}.html`;
    if (!exists(k)) continue;
    const m = read(k).match(/([^>]*)의 <strong>PSA 10 실거래 중앙값은 ([\d,]+)원<\/strong>/);
    if (!m) continue;
    seen++;
    const pc = priciest15(s.cards || [], FX15);
    const card = pc && pc.card;
    const exp = p10Usd(card);
    if (!card || unH15(m[1]).trim() !== card.name || exp == null) { push(`${k} PSA 10 문장 "${unH15(m[1]).trim()}" — 가장 비싼 카드의 PSA 10 실거래 중앙값이 없다`); continue; }
    const krw = Number(m[2].replace(/,/g, ""));
    if (off(krw, exp) > 0.01) push(`${k} PSA 10 ${m[2]}원(≈${money15(krw / FX15.usdKrw)}) ≠ 영문 ${money15(exp)}(${card.name}, ${card.psa10Ebay.updated}) — ±1% 밖`);
    // 영문 세트 Top 10 의 PSA 10 칸(같은 카드)도 같은 달러
    const sp = `sets/${code.toLowerCase()}.html`;
    if (exists(sp)) {
      const nameRe = esc15(card.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const row = read(sp).match(new RegExp(`<tr><td>\\d+</td><td class="cn">(?:(?!</tr>)[\\s\\S])*?<strong>${nameRe}</strong>[\\s\\S]*?</tr>`));
      const cell = row ? ([...row[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)][3] || [])[1] : null;
      const usdShown = cell ? (cell.match(/\$[\d,]+/) || [])[0] : null;
      if (usdShown && usdShown !== money15(exp)) push(`${sp} Top 10 ${card.name} PSA 10 ${usdShown} ≠ ${money15(exp)}`);
      if (usdShown && off(krw, Number(usdShown.replace(/[$,]/g, ""))) > 0.01) push(`${k} ${m[2]}원 vs ${sp} ${usdShown} — ±1% 밖`);
    }
  }
  // ko/cards.html "PSA 10 실낙찰" 칸 — 같은 규칙(카드 = 행의 영문명 + 번호 + 세트 코드)
  if (exists("ko/cards.html")) {
    for (const r of read("ko/cards.html").matchAll(/<small>([^<]+)<\/small><small>([A-Z0-9]+-\d+) · ([A-Z]+-\d+) [^<]*<\/small>(?:(?!<\/tr>)[\s\S])*?<\/td><td class="hideM">[^<]*<\/td><td>([\d,]+)원<\/td>/g)) {
      const card = ((PK15[r[3]] || {}).cards || []).find((c) => c.name === unH15(r[1]) && String(c.number) === r[2]);
      const exp = p10Usd(card);
      seen++;
      if (exp == null) { push(`ko/cards.html ${r[3]} ${unH15(r[1])} PSA 10 ${r[4]}원 — 데이터에 실거래 중앙값이 없다`); continue; }
      const krw = Number(r[4].replace(/,/g, ""));
      if (off(krw, exp) > 0.01) push(`ko/cards.html ${r[3]} ${unH15(r[1])} PSA 10 ${r[4]}원(≈${money15(krw / FX15.usdKrw)}) ≠ 영문 ${money15(exp)} — ±1% 밖`);
    }
  }
  if (!seen) errors.push("PK1: 한국어 PSA 10 금액을 한 곳도 못 읽었다 — 문장·표 구조 확인");
}

// ── FQ1. "How much is a sealed … Japanese/English booster box?" 의 답 = 그 판 박스의 판매 중앙값(28일 규칙) — 2026-10-15 신설(5차).
//    4차가 일본판 중앙값이 없는 OP-02·OP-04·EB-01 에 "The English … box runs about $559" 로 답했다. 값이 없으면 문답을 뺀다.
{
  for (const f of SET_PAGES15) {
    const fq = ldOf15(read(f)).find((j) => j["@type"] === "FAQPage");
    for (const q of (fq && fq.mainEntity) || []) {
      const a = String((q.acceptedAnswer || {}).text || "");
      const ed = (String(q.name).match(/ (Japanese|English) booster box\?$/) || [])[1];
      if (/^How much is a sealed /.test(q.name) && ed && !new RegExp(`^As of \\d{4}-\\d{2}-\\d{2}, completed eBay sales ${ed === "Japanese" ? "of the Japanese " : ""}`).test(a))
        errors.push(`FQ1: ${f} "${q.name}" 의 답이 그 판 판매 중앙값이 아니다: "${a.slice(0, 90)}…" — 값이 없으면 문답을 뺀다`);
    }
  }
}

// ── SP1. 카드 상세의 raw 대 PSA 차이 문장 = NM 칸에 값이 있을 때만 — 2026-10-15 신설(5차).
//    NM 칸이 "—"인 eb01-061·op07-038 에 "…which helps explain its raw-to-slab spread" 가 남아 화면에 없는 차이를 가리켰다.
{
  for (const f of PUBLIC_HTML.filter((p) => /^cards\/[^/]+\.html$/.test(p) && p !== "cards/index.html")) {
    const h = read(f);
    const nmCell = (h.match(/<span>Japanese NM \(raw\)<\/span><b>([^<]*)<\/b>/) || [])[1];
    if (nmCell !== "—") continue;
    const m = shownText15(h).match(/raw-to-slab spread|slab premium|raw (?:NM )?reference/);
    if (m) errors.push(`SP1: ${f} NM 칸이 "—" 인데 "${m[0]}" 문장이 있다`);
  }
}

// ── AN1. 숫자 앞 부정관사 — 읽는 소리가 모음으로 시작하면 "an"(8·80~89·11·18 …) — 2026-10-15 신설(5차). 카드 42장에 "a 80%"·"a 89%"가 나갔다.
{
  let bad = 0;
  const re = /\b[Aa] \$?(?:8[\d,]*|11|18)(?:\.\d+)?(?:%|-[a-z]|x\b| percent\b)/;
  for (const f of PUBLIC_HTML) {
    const m = read(f).match(re);
    if (m && bad++ < 10) errors.push(`AN1: ${f} "${m[0]}" — "an"`);
  }
  if (bad > 10) errors.push(`AN1: 그 밖에 ${bad - 10}건 더`);
}

// ── EQ1. 같은 값끼리의 비교 절 금지 — 2026-10-15 신설(5차): "($134 vs peak $134, …)" · ko "고점 대비 +0.0%"·"저점 대비 +0.0%".
{
  for (const f of PUBLIC_HTML.filter((p) => /^(?:sets|ko)\//.test(p))) {
    const m = read(f).match(/\((\$[\d,]+) vs peak \1[,)]|\b0% under its tracked peak|(?:저점|고점) 대비 [+-]?0\.0%/);
    if (m) errors.push(`EQ1: ${f} "${m[0]}" — 두 쪽이 같은 값이면 비교 절을 뺀다`);
  }
}

// ── EL1. 글자 없는 링크 금지 — 2026-10-15 신설(5차): sets/prb-01 "Distributor reprint: <a …></a>." (날짜 없는 기록의 날짜 칸).
{
  for (const f of PUBLIC_HTML) {
    const m = read(f).match(/<a\b[^>]*>\s*<\/a>/);
    if (m) errors.push(`EL1: ${f} 글자 없는 링크 ${m[0].slice(0, 100)}`);
  }
}

// ── CH1. 가장 싼 박스 = 최저가가 같은 세트 전부 — 2026-10-15 신설(5차). OP-07·OP-08 이 둘 다 $80(106,943원)인데
//    index.html FAQ 는 OP-08 하나, ko/index.html 은 OP-07 하나였다. 기대값 = marketIndex.board 의 nowUsd 최솟값(화면 반올림 기준)인 세트 전부.
{
  const push = sink5("CH1");
  let board = [];
  try { board = (JSON.parse(read("data/onepiece-packs.json")).marketIndex || {}).board || []; } catch { /* 아래에서 0건 */ }
  const priced = board.filter((b) => b.nowUsd != null);
  const min = Math.min(...priced.map((b) => Math.round(b.nowUsd)));
  const ties = priced.filter((b) => Math.round(b.nowUsd) === min).map((b) => b.code);
  if (!ties.length) errors.push("CH1: board 에 현재가가 있는 세트가 없다");
  if (exists("index.html") && ties.length) {
    const fq = ldOf15(read("index.html")).find((j) => j["@type"] === "FAQPage");
    const a = String((((fq && fq.mainEntity) || []).find((q) => q.name === "How much is a One Piece booster box?") || {}).acceptedAnswer?.text || "");
    const seg = (a.match(/range from about \$[\d,]+ \(([^)]*)\)/) || [])[1];
    if (seg == null) push(`index.html FAQ "How much is a One Piece booster box?" 의 최저가 구절을 못 읽었다`);
    else for (const c of ties) if (!seg.includes(c)) push(`index.html FAQ 최저가 "${seg}" 에 같은 값 세트 ${c} 가 없다(${ties.join("·")})`);
  }
  if (exists("ko/index.html") && ties.length) {
    const seg = (read("ko/index.html").match(/가장 싼 박스는 ([\s\S]*?)\([\d,]+원\)/) || [])[1];
    if (seg == null) push(`ko/index.html "가장 싼 박스는" 문장을 못 읽었다`);
    else for (const c of ties) if (!seg.includes(c)) push(`ko/index.html 가장 싼 박스 "${unH15(seg.replace(/<[^>]+>/g, ""))}" 에 같은 값 세트 ${c} 가 없다(${ties.join("·")})`);
  }
}

// ── KD1. ko/index.html "기준일"·"마지막 갱신" = 그 표에 보이는 가장 늦은 중앙값 날짜 — 2026-10-15 신설(5차). 표의 OP-07 행은 10-15, 두 날짜는 10-14 였다.
if (exists("ko/index.html")) {
  const push = sink5("KD1");
  const h = read("ko/index.html");
  const newest = [...h.matchAll(/<small class="fromDate">(\d{4}-\d{2}-\d{2})<\/small>/g)].map((m) => m[1]).sort().pop() || null;
  const base = (h.match(/기준일 (\d{4}-\d{2}-\d{2})\./) || [])[1] || null;
  const last = (h.match(/마지막 갱신 (\d{4}-\d{2}-\d{2})\./) || [])[1] || null;
  if (!newest || base !== newest || last !== newest) push(`ko/index.html 기준일 ${base || "(없음)"} · 마지막 갱신 ${last || "(없음)"} ≠ 표의 가장 늦은 날짜 ${newest || "(없음)"}`);
}

// ── FQ2. articles/how-many-packs FAQPage = 화면 FAQ(문항·답) — 2026-10-15 신설(5차). JSON-LD 는 화면에 없는 1문항, 화면은 JSON-LD 에 없는 4문항이었다.
{
  const f = "articles/how-many-packs-one-piece-booster-box.html";
  if (exists(f)) {
    const h = read(f);
    const blk = (h.match(/<!-- PACK-FAQ:START -->([\s\S]*?)<!-- PACK-FAQ:END -->/) || [])[1];
    const shown = blk ? [...blk.matchAll(/<h3>([\s\S]*?)<\/h3>\s*<p>([\s\S]*?)<\/p>/g)].map((m) => [unH15(m[1]).trim(), unH15(m[2].replace(/<[^>]+>/g, "")).trim()]) : [];
    const fq = ldOf15(h).find((j) => j["@type"] === "FAQPage");
    const ld = ((fq && fq.mainEntity) || []).map((q) => [q.name, String((q.acceptedAnswer || {}).text || "").trim()]);
    if (!shown.length) errors.push(`FQ2: ${f} 화면 FAQ 블록(PACK-FAQ)을 못 읽었다 — node tools/inject-pack-math.js`);
    else if (JSON.stringify(shown) !== JSON.stringify(ld)) errors.push(`FQ2: ${f} FAQPage ${ld.length}문항 ≠ 화면 FAQ ${shown.length}문항(문항·답이 같아야 한다)`);
  }
}

// ── WK1. weekly.html 4-wk = 세트 페이지 "4-week change"(boxChange28 — current vs 28일 이상 앞선 마지막 점) — 2026-10-15 신설(5차).
//    weekly 만 current 대신 마지막 점으로 따로 계산해 current 가 없는 OP-04 -5.4% · EB-01 +6.3% 가 다른 표의 "—" 와 갈렸다.
if (exists("weekly.html")) {
  const push = sink5("WK1");
  let SS = {};
  try { SS = JSON.parse(read("data/box-sold-series.json")).sets || {}; } catch { /* 아래에서 0행 */ }
  const want = (code, ed) => {
    const e = SS[code] || {}, cur = e.current && e.current[ed];
    if (!cur || !(cur.median > 0)) return null;
    const cut = Date.parse(cur.d) - 28 * 864e5;
    const prior = (e[ed] || []).filter((p) => p && p.median > 0 && Date.parse(p.d) <= cut).pop();
    return prior ? Math.round((cur.median / prior.median - 1) * 1000) / 10 : null;
  };
  let n = 0;
  for (const r of read("weekly.html").matchAll(/<tr[^>]*><td><a href="sets\/([a-z]+-\d+)(-english)?\.html">[\s\S]*?<\/tr>/g)) {
    const tds = [...r[0].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, "").trim());
    if (tds.length < 8) continue;   // 매물 수 표(5칸)는 건너뛴다
    n++;
    const code = r[1].toUpperCase(), ed = r[2] ? "en" : "jp";
    const got = tds[5] === "—" ? null : Number(tds[5].replace(/[+%]/g, ""));
    const w = want(code, ed);
    if (got !== w) push(`weekly.html ${code} ${ed.toUpperCase()} 4-wk ${tds[5]} ≠ ${w == null ? "—" : w + "%"}(세트 페이지 4-week change 와 같은 값)`);
  }
  if (!n) errors.push("WK1: weekly.html 표 행을 하나도 못 읽었다 — 표 구조 확인");
}

if (errors.length) {
  console.error(JSON.stringify({ guard: "FAIL", errors, ...(warnings.length ? { warnings } : {}) }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ guard: "OK", checkedPages: PUBLIC_HTML.length, version: ver, ...(warnings.length ? { warnings } : {}), checks: ["V1", "C1", "C2", "C3", "N1", "D1", "D3", "D4", "D5", "D5b", "D6", "D7", "D8", "D9", "D10", "D11", "D12", "D13", "D14", "D15", "D16", "D17", "D18", "Q1", "Q2", "Q3", "Q4", "Q5", "S1", "S2", "S3", "F1", "H1", "H2", "H3", "U1", "C4", "L1", "L2", "L3", "I1", "R1", "R5", "T1", "T2", "T3", "P1", "W1", "W4", "W2", "W3", "X1", "X2", "I2", "P2", "J1", "V2", "M1", "M2", "A1", "A2", "A3", "A4", "A5", "E1", "G8", "G9", "R2", "R3", "R4", "K1", "K2", "Y1", "Y2", "GA1", "GA2", "UP1", "RD1", "AD1", "CL1", "KF1", "RF1", "SM1", "SE1", "FD1", "SF1", "U2", "PL1", "S4", "NM1", "KO1", "KO2", "KO3", "KO4", "AB1", "AS1", "LP1", "PO1", "CL2", "UP2", "DS1", "RY1", "NM2", "CM1", "PC1", "CW1", "CL3", "DF1", "PK1", "FQ1", "SP1", "AN1", "EQ1", "EL1", "CH1", "KD1", "FQ2", "WK1"] }));
