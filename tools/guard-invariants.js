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
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const errors = [];
const read = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");
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
const PUBLIC_HTML = walkHtml(["", "sets", "cards", "articles", "ko"]);

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
  const m = read(f).match(/rel="canonical" href="([^"]+)"/);
  if (!m) continue;
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
const NAV_REQUIRED = ["부스터 박스", "비교", "PSA10 랭킹", "PSA 인구", "세트 가이드", "아마존 응모"];
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const navM = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navM) continue; // 네비 없는 페이지는 검사 대상 아님
  const nav = navM[1];
  for (const label of NAV_REQUIRED) {
    if (!nav.includes(`data-ko="${label}"`)) errors.push(`N1: ${f} 메인 네비에 "${label}" 링크 누락 (전부 필요)`);
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
//     재발 방지: (1) renderBoxSeries 의 정직한 '실거래 수집중' 플레이스홀더가 유지되어야 하고,
//               (2) active(매물) 중간값을 sold/이력으로 오인시키는 혼합소스 트렌드 안내가 되살아나면 안 된다.
if (!/boxChartPending/.test(packsJs)) {
  errors.push("D4: renderBoxSeries 의 정직한 '실거래 수집중' 플레이스홀더(boxChartPending)가 사라짐 — 혼합소스 트렌드차트 재도입 위험");
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

// ── D5. 박스 SOLD 주간 시계열(append-only) 무결성 — 2026-07-22 차트 데이터 레이어.
//    이 파일은 실거래(sold) 축적본이라 조작·역행이 곧 허위 데이터다. 내부 정합성만 검사(파일 없으면 스킵).
if (exists("data/box-sold-series.json")) {
  const bs = JSON.parse(read("data/box-sold-series.json"));
  if (bs.basis !== "sold") errors.push("D5: box-sold-series.basis 가 'sold' 가 아님 — active/추정 혼입 금지");
  if (!/sold/i.test(bs.note || "") || !/append/i.test(bs.note || "")) errors.push("D5: box-sold-series.note 에 sold·append-only 고지 누락");
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
    ];
    for (const [item, want, wantEd] of ingestCases) {
      const r = judgeItem(item, "OP-13", R);
      if (typeof want === "string") {
        if (r.drop !== want) errors.push(`Q1: ingest "${item.t}" → ${r.drop || "통과"} (기대 drop ${want})`);
      } else if (!r.rec || Math.abs(r.rec.unit - want) > 0.01 || r.ed !== wantEd) {
        errors.push(`Q1: ingest "${item.t}" → ${JSON.stringify(r.rec ? { unit: r.rec.unit, ed: r.ed } : r)} (기대 unit ${want.toFixed(2)} ed ${wantEd})`);
      }
    }
  } catch (e) {
    errors.push(`Q1: ingest 판정 실행 실패 — ${e.message}`);
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
    if (exists("data/auction-sold.json")) {
      const hot = JSON.parse(read("data/auction-sold.json"));
      const hotIds = new Set((hot.sales || []).map((s) => s.id));
      const orphan = [...hotIds].filter((id) => !seen.has(id));
      if (orphan.length) errors.push(`A1: 최근 창에 원장에 없는 기록 ${orphan.length}건`);
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
    const CATS = ["box", "graded", "raw", "pack"];
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
  for (const [code, cards] of Object.entries(tp.sets || {})) {
    for (const [key, arr] of Object.entries(cards || {})) {
      let prev = "";
      for (const p of arr || []) {
        if (!p || typeof p.d !== "string" || p.d <= prev) { errors.push(`D11: ${code} ${key} 날짜 이상/역행`); break; }
        if (!(Number.isInteger(p.total) && p.total > 0)) { errors.push(`D11: ${code} ${key} ${p.d} total 이상`); break; }
        prev = p.d;
      }
    }
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
  const ids = new Set();
  for (const [code, eds] of Object.entries(lg.sets || {})) {
    for (const ed of ["jp", "en"]) {
      for (const r of (eds || {})[ed] || []) {
        if (!r.id || ids.has(r.id)) { errors.push(`D6: ${code}.${ed} id 누락/중복 (${r.id})`); break; }
        ids.add(r.id);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(r.d || "")) { errors.push(`D6: ${code}.${ed} ${r.id} 날짜 형식 이상 (${r.d})`); break; }
        if (!(Number.isFinite(r.unit) && r.unit > 0 && r.unit <= 5000)) { errors.push(`D6: ${code}.${ed} ${r.id} unit 이상 (${r.unit})`); break; }
        if (!(Number.isInteger(r.qty) && r.qty >= 1 && r.qty <= 24)) { errors.push(`D6: ${code}.${ed} ${r.id} qty 이상 (${r.qty})`); break; }
      }
    }
  }
}

// ── D2. (철회) 마켓 인덱스/개봉 미터는 2026-07-29 제거됐다.
//    지수 입력이던 외부 주간시세가 7/13 에 끊겨 홈에 "매일 갱신 157.4"가 2주간 박혀 있었고,
//    소유자 판단으로 위젯·market.html·나브를 전부 내렸다. 대신 등급(PSA/CGC/TAG) 데이터에 집중한다.
//    우리 자체 eBay 시계열(boxSeriesEbay / boxSeriesEnEbay)은 계속 쌓이며, 9월에 일판/영문판
//    두 지수로 다시 세울 예정이다(기준일은 중국셀러 정리 이후인 2026-07-17 이후로 잡을 것).
// ── S1. 외부 소스명 공개 금지 (영구 규칙)
for (const f of [...PUBLIC_HTML, "packs.js", "data/onepiece-packs.json", "llms.txt", "feed.xml"]) {
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
for (const f of ["googlee0d71bc0695b5651.html", "google1d76c313bd3d0b59.html", "naver933afc5e4330d8e58701ba45b0319b4a.html", "3d439f302e46fc08f76ddba4eee3726f.txt", "robots.txt", "sitemap.xml", "llms.txt", "data/set-facts.json"]) {
  if (!exists(f)) errors.push(`F1: 필수 파일 삭제됨: ${f}`);
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
for (const f of PUBLIC_HTML) {
  if (!f.startsWith("sets/") || f === "sets/index.html") continue;
  if (!/"@type"\s*:\s*"FAQPage"/i.test(read(f))) errors.push(`L3: ${f} 에 FAQPage 스키마 없음 (세트 페이지 필수 — audit-seo 도 동일 검사)`);
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
for (const f of ["index.html", "packs.html"]) {
  if (!exists(f)) continue;
  const body = read(f).replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<style[\s\S]*?<\/style>/g, " ");
  const text = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  const prices = (text.match(/\$[0-9][0-9,]{2,}/g) || []).length;
  if (text.length < 4000) errors.push(`R1: ${f} JS 없는 본문이 ${text.length}자 — 정적 콘텐츠 부족(4000자 이상 필요)`);
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
  for (const f of [...PUBLIC_HTML, "opbox-set-prices.csv", "llms.txt"]) {
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
    const addLine = (y.match(/git add ([^\n]+)/) || [])[1] || "";
    const diffLine = (y.match(/git diff --quiet ([^\n]+?);\s*then/) || [])[1] || "";
    if (!addLine && !diffLine) continue;    // 커밋하지 않는 워크플로는 대상 아님

    // 두 목록이 어긋나면 "변경은 감지되는데 커밋은 안 되는" 구멍이 생긴다.
    // `--` 는 경로 구분자일 뿐 대상 목록이 아니다. 빼고 비교하지 않으면 오탐이 난다.
    const norm = (t) => t.trim().split(/\s+/).filter((x) => x && x !== "--").sort().join(" ");
    if (addLine && diffLine && norm(addLine) !== norm(diffLine)) {
      errors.push(`W1: ${wf} 의 git diff 목록과 git add 목록 불일치 — 커밋 누락 구멍`);
    }

    // 이 워크플로가 돌리는 도구가 기록하는 data/*.json 은 전부 커밋 목록에 있어야 한다.
    const tools = [...y.matchAll(/node tools\/([a-z0-9-]+\.js)/g)].map((m) => m[1]);
    const src = [...new Set(tools)]
      .filter((f) => exists(`tools/${f}`))
      .map((f) => read(`tools/${f}`))
      .join("\n");
    if (!src) continue;
    for (const f of dataFiles) {
      if (CURATED.has(f)) continue;
      // 도구가 "쓰는" 파일만 대상 — 읽기만 하는 파일도 소스에 이름이 나오므로 writeFileSync 로 판별한다.
      const writes = new RegExp(`writeFileSync\\([^)]*${f.replace(/[.]/g, "\\.")}`).test(src)
        || new RegExp(`"${f.replace(/[.]/g, "\\.")}"[^\\n]*\\n?[^\\n]*writeFileSync`).test(src)
        || (src.includes(`"${f}"`) && /writeFileSync/.test(src) && new RegExp(`Path[^\\n]*"${f.replace(/[.]/g, "\\.")}"`).test(src));
      if (!writes) continue;
      if (!addLine.includes(`data/${f}`)) {
        errors.push(`W1: data/${f} 는 ${wf} 의 산출물인데 커밋 목록에 없음 — rebase 실패를 유발함`);
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

// ── T2. 방문자 페이로드 상한 — 2026-07-20. 시계열은 소급 못 지우니 방치하면 무한히 큰다.
// data/onepiece-packs.json 은 방문자가 페이지마다 통째로 받는다. compact-series.js 가 오래된
// 구간을 성기게 만들어 유한하게 묶지만, 그 장치가 고장나거나 새 시계열이 상한 밖에서 늘면
// 조용히 커진다. 원본 1.2MB(전송 압축 후 ~200KB)를 넘으면 배포를 막아 사람이 보게 한다.
{
  const PAYLOAD_LIMIT = 1_200_000;   // bytes, 원본 기준. 압축 전 크기가 커도 결국 파싱은 원본으로 한다.
  const f = "data/onepiece-packs.json";
  if (exists(f)) {
    const size = fs.statSync(path.join(ROOT, f)).size;
    if (size > PAYLOAD_LIMIT) {
      errors.push(`T2: ${f} 가 ${(size / 1024).toFixed(0)}KB — 상한 ${PAYLOAD_LIMIT / 1024}KB 초과. compact-series.js 동작 확인 필요(방문자가 매번 받는 파일)`);
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
  const KRW_PER_JPY = 10.1, MAX_MULT = 30;
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
        const mid = c.psa10Ebay?.middle;
        if (!mid || !c.nmJpy || c.nmJpy < 10000) continue;
        const mult = mid / (c.nmJpy * KRW_PER_JPY);
        if (mult > MAX_MULT) errors.push(`M2: ${code} #${i} ${c.name} — PSA10 이 NM 의 ${mult.toFixed(0)}배. 둘 중 하나가 다른 변형 값일 가능성`);
      }
    }
  }
}

// ── G8. 그레이더 주간 커버리지 회귀 — "이번 주에 세트가 줄었다"는 대개 데이터가 아니라 수집기가 잘못된 것이다.
//    2026-07-22·07-27 CGC 수집이 목록 2페이지 중 1페이지만 읽어 일본판 7세트를 통째로 빠뜨렸는데,
//    값이 다 그럴듯해서 2주간 아무도 몰랐다(커버리지 36 vs 실제 43). 적재기(cgc/tag-pop-ingest)가 1차로 막지만,
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

if (errors.length) {
  console.error(JSON.stringify({ guard: "FAIL", errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ guard: "OK", checkedPages: PUBLIC_HTML.length, version: ver, checks: ["V1", "C1", "C2", "C3", "N1", "D1", "D3", "D4", "D5", "D5b", "D6", "D7", "D8", "D9", "D10", "D11", "Q1", "Q2", "Q3", "Q4", "S1", "S2", "F1", "H1", "L1", "L2", "L3", "I1", "R1", "T1", "T2", "P1", "W1", "X1", "X2", "I2", "P2", "J1", "V2", "M1", "M2", "A1", "A2", "G8"] }));
