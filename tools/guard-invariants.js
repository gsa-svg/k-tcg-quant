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
//    상대경로가 폴더마다 달라서(../market.html vs market.html) data-ko 라벨로 판정한다.
const NAV_REQUIRED = ["부스터 박스", "비교", "PSA10 랭킹", "마켓 지수", "세트 가이드", "아마존 응모"];
for (const f of PUBLIC_HTML) {
  const html = read(f);
  const navM = html.match(/<nav class="nav"[^>]*>([\s\S]*?)<\/nav>/);
  if (!navM) continue; // 네비 없는 페이지는 검사 대상 아님
  const nav = navM[1];
  for (const label of NAV_REQUIRED) {
    if (!nav.includes(`data-ko="${label}"`)) errors.push(`N1: ${f} 메인 네비에 "${label}" 링크 누락 (6개 링크 전부 필요)`);
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
  if (!/per-card/i.test(cs.note || "") || !/auction-sold/i.test(cs.note || "")) errors.push("D9: note 에 파생 출처(auction-sold) 고지 누락");
  for (const [id, c] of Object.entries(cs.cards || {})) {
    if (!(Number.isInteger(c.sold) && c.sold >= 3)) { errors.push(`D9: ${id} sold(${c.sold}) 표본 기준 미달 노출`); break; }
    if (c.medPrice != null && !(c.medPrice > 0)) { errors.push(`D9: ${id} medPrice 이상 (${c.medPrice})`); break; }
    if (c.sellThrough != null && !(c.sellThrough >= 0 && c.sellThrough <= 100)) { errors.push(`D9: ${id} sellThrough 이상 (${c.sellThrough})`); break; }
    if (c.low != null && c.high != null && c.low > c.high) { errors.push(`D9: ${id} low>high`); break; }
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

// ── D2. 마켓 인덱스 정합성(build-market-index.js 산출) — 이상값이면 배포 차단
{
  const mi = data.marketIndex;
  if (!mi) errors.push("D2: data.marketIndex 없음 (build-market-index.js 미실행)");
  else {
    const v = mi.index && mi.index.value;
    if (!(v > 50 && v < 1000)) errors.push(`D2: 지수값 이상 (${v}) — 계산 오류 의심`);
    if (!Array.isArray(mi.constituents) || mi.constituents.length < 10) errors.push(`D2: 구성종목 부족 (${mi.constituents ? mi.constituents.length : 0})`);
    if (!mi.index || !Array.isArray(mi.index.series) || mi.index.series.length < 5) errors.push("D2: 지수 시계열 부족");
    if (!mi.board || mi.board.length < 15) errors.push(`D2: 성적표 부족 (${mi.board ? mi.board.length : 0})`);
    if (!mi.meter || !mi.meter.latestWeek) errors.push("D2: 개봉 미터 없음");
    if (mi.meter?.isStale && exists("market.html")) {
      const marketHtml = read("market.html");
      if (!marketHtml.includes("Historical snapshot")) errors.push("D2: 오래된 개봉 미터가 historical snapshot으로 표시되지 않음");
      if (marketHtml.includes("is a live read")) errors.push("D2: 오래된 개봉 미터를 live read라고 잘못 표시함");
    }
    // 정가·재판 팩트: 성적표에 msrp 배수가 대부분 있어야 함(set-facts.json 로드 확인)
    const withMsrp = (mi.board || []).filter((b) => b.vsMsrp).length;
    if (withMsrp < 15) errors.push(`D2: 정가 배수(vsMsrp) 부족 (${withMsrp}) — data/set-facts.json 로드 실패 의심`);
    if (!mi.reprints || typeof mi.reprints.bandaiAnnounces !== "boolean") errors.push("D2: 재판 데이터(reprints) 없음");
    // market.html에 구운 지수값이 데이터와 일치해야 함(엇갈리면 stale)
    if (exists("market.html") && v != null) {
      const baked = (read("market.html").match(/class="big">([\d.]+)</) || [])[1];
      if (baked && Math.abs(parseFloat(baked) - v) > 0.05) errors.push(`D2: market.html 구운값 ${baked} ≠ 데이터 ${v} (재생성 필요)`);
    }
  }
}

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

if (errors.length) {
  console.error(JSON.stringify({ guard: "FAIL", errors }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ guard: "OK", checkedPages: PUBLIC_HTML.length, version: ver, checks: ["V1", "C1", "C2", "C3", "N1", "D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9", "Q1", "Q2", "Q3", "S1", "S2", "F1", "H1", "L1", "L2", "L3", "I1", "R1", "T1", "T2", "P1", "W1", "X1", "I2", "P2"] }));
