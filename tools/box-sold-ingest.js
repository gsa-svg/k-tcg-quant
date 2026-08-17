// 박스 eBay SOLD 원장(ledger) 적재 — "우리만의 데이터"의 원본 저장소.
//
// 입력: 브라우저(사용자 IP)에서 box-sold-urls.js 의 수집기(EXTRACTOR)로 긁은 원시 덤프 파일.
//   { collectedAt:"YYYY-MM-DD", pages:[ { code:"OP-13", query:"jp"|"en", items:[{id,t,d,k,cur}] } ] }
//   (id=eBay 상품번호, t=제목, d="Sold  Jul 22, 2026", k=표시가 숫자, cur=KRW|USD|OTHER)
//
// 출력 1: data/box-sold-ledger.json — 판매 1건 = 1레코드(append-only, id로 전역 중복제거).
//   여기서 주차별 중앙값·판매건수·판매액이 전부 파생된다. 과거 레코드는 절대 수정/삭제하지 않는다.
// 출력 2: data/onepiece-packs.json 의 boxMarket.[jp|en].ebaySold 스냅샷(이번 덤프에서 유효 n>=3일 때만)
//   — 기존 box-sold-series(D5) 흐름과의 연속성 유지용. 기준(페이지에 보이는 sold 전체의 중앙값) 동일.
//
// 판정 규칙(정확도 최우선 — 빈 값이 틀린 숫자보다 낫다):
//  - "booster box" 제목 + 대상 세트코드 일치, 다른 세트코드가 같이 있으면 버림(멀티세트 묶음).
//  - pack/lot/case/display/sleeve/bundle 등 비단품 신호 버림. 중국어판 버림.
//  - 다수량: lot-quantity.js 규칙 — "x3"/"3 boxes"는 총액÷개수=개당가, 개수 불명은 버림.
//  - 언어: 제목에 english→en, japanese→jp, 표기 없으면 버림(추측 금지).
//  - 개당가 문턱: 9만원(≈$58) 미만 버림(팩/오매칭), $5,000 초과 버림(이상치).
//  - 날짜: "Sold <날짜>" 파싱 실패·미래 날짜 버림.
//
// Run: node tools/box-sold-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");
const { parseLotQuantity, unitPrice } = require("./lot-quantity");

const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const ledgerPath = path.join(ROOT, "data", "box-sold-ledger.json");

// BOOSTER(/booster box/)가 이미 단품 카드·팩을 배제하므로 여기선 "박스인데 단일 봉인박스가 아닌"
// 신호만 거른다. ⚠️ "packs"(박스는 24팩을 담는다)·"card"("Card Game" 정품 박스명)를 넣으면 정상 박스가
// 대량 탈락한다(2026-07-22 레드팀 지적). lot/case/carton/display/bundle/sleeve/blister 등만.
// 한국판(korean)도 뺀다 — 이 원장은 일본판/영문판 두 판만 다루는데, 한국판이 일본판 검색에 섞여 들어왔다
// (2026-08-13: "Romance Dawn OP01 Booster Box Korean" $98 이 OP-01 일본판으로 적재됨).
const BAD = /\blots?\b|\bcases?\b|carton|display|sleeved?|bundle|wholesale|\bbulk\b|choose|\bpick\b|blister|proxy|\bempty\b|chinese|simplified|korean/i;
const BOOSTER = /booster box/i;
// "Booster Pack ... x1 -From Fresh booster box" 처럼 **낱팩**을 팔면서 설명에 booster box 를
// 적는 매물이 있다. 단수 "booster pack" 이 보이면 박스가 아니다 — 박스는 "24 booster packs"(복수)로 쓴다.
// 2026-08-13: 이 두 건이 박스 시세에 $251(OP-01 영문 초판) · $66(PRB-01 영문)으로 섞여 있었다.
const SINGLE_PACK = /\bbooster pack\b(?!s)/i;
const SET_CODE = /\b(OP|EB|PRB|ST)[-\s]?(\d{2})\b/gi;

// 세트 이름으로도 코드를 잡는다 — 2026-08-12 신설.
// eBay 제목 상당수가 코드 없이 이름만 쓴다: "One Piece Card Game Romance Dawn Booster Box English".
// 코드만 보던 때는 이런 건이 code-missing 으로 통째로 버려졌다.
//
// ⚠️ 이름이 겹치는 세트는 제외한다. PRB-01·PRB-02 는 둘 다 nameEn 이 "Premium Booster" 라
//    이름만으로는 어느 쪽인지 알 수 없다 — 그런 건 추측하지 않고 코드에만 의존한다.
// 이름표는 onepiece-packs.json 을 그대로 읽는다(하드코딩하면 세트가 늘 때 조용히 어긋난다).
const normName = (s) => String(s).toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
function buildNameMap(packs) {
  const byName = new Map();
  const codes = [...(packs.jp?.list || []), ...(packs.extra?.list || [])];
  for (const code of codes) {
    const n = normName(packs.sets[code]?.nameEn || "");
    if (n.length < 6) continue;             // 너무 짧은 이름은 오탐 위험 — 쓰지 않는다
    if (byName.has(n)) byName.set(n, null); // 중복 이름 → 판별 불가로 표시
    else byName.set(n, code);
  }
  // null(중복)은 버리고 유일한 이름만 남긴다
  return [...byName.entries()].filter(([, v]) => v).sort((a, b) => b[0].length - a[0].length);
}
// 제목에서 세트 이름을 찾아 코드를 돌려준다(긴 이름부터 — 짧은 이름이 긴 이름 안에 묻히지 않게).
function codesFromName(title, nameMap) {
  const t = normName(title);
  const out = [];
  for (const [n, code] of nameMap) if (t.includes(n)) out.push(code);
  return out;
}

// 영문판에만 있는 물리적 특징. 판매자가 Language 를 Japanese 로 잘못 신고해도 이건 안 바뀐다.
//  · White/Blue Bottom — 영문판 초판 박스 바닥 색. 일본판에는 이 구분 자체가 없다.
//  · Wave 1/2 — 영문판 재생산 차수 표기. 일본판은 이렇게 부르지 않는다.
// 2026-08-13 실사고: 이 신호가 없어서 White Bottom $1,458~$1,686, Blue Bottom $4,101 짜리
// 영문판이 OP-01 "일본판" 시세로 들어갔고 5월 중앙값이 $1,437 로 찍혔다(실제 일본판은 $290 대).
const EN_ONLY_TRAIT = /\b(white|blue)\s*bottom\b|\bwave\s*[12]\b/i;

function editionOf(title) {
  if (/english|\beng\b/i.test(title)) return "en";
  if (EN_ONLY_TRAIT.test(title)) return "en";
  if (/japanese|japan\b/i.test(title)) return "jp";
  return null;   // 언어 표기 없음 — 추측하지 않는다
}

function soldDateOf(caption) {
  const m = String(caption || "").match(/sold\s+(.+)$/i);
  if (!m) return null;
  const ts = Date.parse(m[1].trim());
  if (!Number.isFinite(ts)) return null;
  const iso = new Date(ts).toISOString().slice(0, 10);
  if (iso > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return null;  // 미래 날짜 — 파싱 오류
  return iso;
}

// 한 건 판정. 통과하면 원장 레코드, 아니면 {drop:이유}. (가드 Q1이 코퍼스로 검증하는 진입점)
// declaredEd — 2026-08-12 신설. eBay 검색의 `&Language=Japanese|English` 패싯으로 받아온 페이지면
// 그 판별은 **판매자가 신고한 값**이다. 제목 키워드 추측보다 훨씬 정확하다.
//   실측(OP-01): 제목만 보면 언어 미표기로 614건을 버렸는데, 패싯으로 받으면 일본판만 226건이다.
// 다만 신고가 틀린 건도 있다(같은 실측에서 일본어 패싯에 영문 제목 8건). 그래서 그대로 믿지 않고
// **제목이 정반대로 말하면 버린다**(lang-conflict). 둘이 일치하거나 제목이 침묵할 때만 채택한다.
// declaredEd 가 없으면(구 덤프·가드 코퍼스) 종전대로 제목에서만 판별한다.
function judgeItem(item, targetCode, fxUsdKrw, nameMap, declaredEd, fmt) {
  const t = String(item.t || "");
  if (!BOOSTER.test(t)) return { drop: "not-booster-box" };
  if (SINGLE_PACK.test(t)) return { drop: "single-pack" };
  if (BAD.test(t)) return { drop: "bad-word" };
  const codes = new Set();
  for (const m of t.matchAll(SET_CODE)) codes.add(`${m[1].toUpperCase()}-${m[2]}`);
  // 코드가 없으면 세트 이름으로 찾아본다. 이름으로 찾은 코드도 같은 집합에 넣어야
  // 아래 cross-set 검사(다른 세트가 같이 적힌 제목 배제)가 그대로 적용된다.
  if (nameMap) for (const c of codesFromName(t, nameMap)) codes.add(c);
  if (!codes.has(targetCode)) return { drop: "code-missing" };
  if ([...codes].some((c) => c !== targetCode)) return { drop: "cross-set" };
  const fromTitle = editionOf(t);
  // 신고값이 있으면 그걸 쓰되, 제목이 정반대로 말하면 버린다(판매자 오신고 방어).
  if (declaredEd && fromTitle && fromTitle !== declaredEd) return { drop: "lang-conflict" };
  const ed = declaredEd || fromTitle;
  if (!ed) return { drop: "no-language" };
  const qty = parseLotQuantity(t, "box");
  if (qty == null) return { drop: "uncountable-lot" };
  const totalUsd = item.cur === "USD" ? item.k : item.cur === "KRW" ? item.k / fxUsdKrw : null;
  if (!Number.isFinite(totalUsd)) return { drop: "bad-currency" };
  const unit = unitPrice(totalUsd, qty);
  // 상한 8000 — OP-01 영문 Blue Bottom(초판)은 실제 $4~6천대다. 5000 이면 그 세트의 진짜 거래를 버린다.
  if (unit == null || unit < 90000 / fxUsdKrw || unit > 8000) return { drop: "price-out-of-range" };
  const d = soldDateOf(item.d);
  if (!d) return { drop: "bad-date" };
  // fmt: "bin"(즉시구매) | "auction"(경매). 시세 그래프는 즉시구매만 쓴다 — 경매는 입찰이 안 붙으면
  // 시세보다 훨씬 낮게 끝나 섞으면 잡음이 된다. 구 덤프에는 이 값이 없어 undefined 로 남는다.
  const rec = { id: String(item.id), d, unit: Number(unit.toFixed(2)), total: Number(totalUsd.toFixed(2)), qty, title: t.slice(0, 140) };
  if (fmt === "bin" || fmt === "auction") rec.fmt = fmt;
  // 원화 원본과 적용 환율을 함께 박는다 — 2026-08-17.
  // 그 전에는 달러값만 남겼는데, fx.json 이 47일 멈춰 있던 걸 뒤늦게 발견했을 때
  // "이 기록은 어느 환율로 환산됐나"를 알 길이 없어 git 이력으로 수집일을 역추적해야 했다
  // (tools/restore-box-fx.js). 두 번 다시 추정하지 않도록 원본을 그대로 보관한다.
  if (item.cur === "KRW") { rec.krw = Math.round(item.k / qty); rec.fx = Number(fxUsdKrw.toFixed(2)); }
  return { rec, ed };
}

const med = (a) => {
  const x = a.filter(Number.isFinite).sort((m, n) => m - n);
  if (!x.length) return null;
  const i = Math.floor(x.length / 2);
  return x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2;
};
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))]; };

function main(dumpFile) {
  const dump = JSON.parse(fs.readFileSync(dumpFile, "utf8"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const fx = data.fx.usdKrw;
  const nameMap = buildNameMap(data);
  const today = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || "")) throw new Error("dump.collectedAt 필요 (YYYY-MM-DD)");

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { ledger = { sets: {} }; }
  ledger.sets = ledger.sets || {};
  const knownIds = new Set();
  for (const eds of Object.values(ledger.sets)) for (const arr of Object.values(eds)) if (Array.isArray(arr)) for (const r of arr) knownIds.add(r.id);

  const summary = {};
  const drops = {};
  let backfilled = 0;   // 기존 레코드에 fmt 를 뒤늦게 채운 수
  const seenBySet = {};  // 세트별로 이번 덤프에서 본 유효 sold (스냅샷 계산용)
  // eBay 는 한 검색에 240~265건까지만 준다(_pgn 은 무시된다). 그 수에 닿은 페이지는 **잘린 것**이라
  // 그 구간의 오래된 판매를 못 봤다는 뜻이다. 조용히 넘어가면 "다 모았다"고 착각한다.
  const cappedPages = [];
  for (const page of dump.pages || []) {
    const code = page.code;
    if (!data.sets[code]) continue;
    if (Number(page.rawN) >= 240) cappedPages.push(code + "/" + page.query + (page.band != null ? "/" + page.band : ""));
    // 이번 덤프에서 유효 판정된 건 전부(이미 아는 id 포함) — 스냅샷 계산용
    const seen = { jp: [], en: [] };
    let appended = 0;
    for (const item of page.items || []) {
      // 덤프가 Language 패싯으로 수집됐다고 표시한 경우에만 신고값을 쓴다.
      // 구 덤프(langFacet 없음)는 종전대로 제목에서만 판별한다 — 과거 원장과 기준이 흔들리지 않게.
      const declaredEd = dump.langFacet ? (page.query === "jp" ? "jp" : "en") : null;
      // 덤프가 즉구/경매를 나눠 받았다고 표시한 경우에만 fmt 를 붙인다.
      const fmt = dump.fmtSplit ? (page.fmt === "auction" ? "auction" : "bin") : null;
      const j = judgeItem(item, code, fx, nameMap, declaredEd, fmt);
      if (j.drop) { drops[j.drop] = (drops[j.drop] || 0) + 1; continue; }
      seen[j.ed].push(j.rec);
      if (knownIds.has(j.rec.id)) {
        // 가격·날짜는 절대 덮어쓰지 않는다. 다만 fmt 는 예전에 아예 수집하지 않던 값이라
        // 비어 있을 때만 채운다 — 과거 레코드가 즉구였는지 경매였는지 알아낼 유일한 기회다.
        if (j.rec.fmt) {
          const arr = (ledger.sets[code] || {})[j.ed] || [];
          const old = arr.find((r) => r.id === j.rec.id);
          if (old && !old.fmt) { old.fmt = j.rec.fmt; backfilled++; }
        }
        continue;
      }
      knownIds.add(j.rec.id);
      ledger.sets[code] = ledger.sets[code] || { jp: [], en: [] };
      ledger.sets[code][j.ed].push(j.rec);
      appended++;
    }
    // 스냅샷은 페이지마다 계산하면 안 된다 — 한 세트가 언어 2 × 가격대 5 = 10 페이지로 나뉘어 오므로
    // 페이지마다 쓰면 마지막 가격대(600k+)의 값이 세트 전체 시세로 남는다(2026-08-13 수정).
    // 세트별로 모아 두었다가 루프가 끝난 뒤 한 번만 계산한다.
    const bucket = seenBySet[code] || (seenBySet[code] = { jp: [], en: [] });
    bucket.jp.push(...seen.jp);
    bucket.en.push(...seen.en);

    // 요약도 페이지마다 덮어쓰지 말고 더한다.
    // 예전엔 덮어써서 jp 페이지 결과가 en 페이지에 지워졌고, jpSeen 이 늘 0 으로 보였다(2026-08-13 수정).
    const s = summary[code] || (summary[code] = { jpSeen: 0, enSeen: 0, appended: 0 });
    s.jpSeen += seen.jp.length;
    s.enSeen += seen.en.length;
    s.appended += appended;
  }

  // 세트별 스냅샷: 이번 덤프에서 그 세트로 본 유효 sold 전체 기준, n>=3 일 때만.
  // 같은 id 가 여러 가격대 페이지에 겹쳐 나올 일은 없지만(가격이 하나뿐), 안전하게 id 로 한 번 걸러낸다.
  for (const [code, seen] of Object.entries(seenBySet)) {
    for (const ed of ["jp", "en"]) {
      const byId = new Map();
      for (const r of seen[ed]) byId.set(r.id, r);
      const units = [...byId.values()].map((r) => r.unit);
      if (units.length >= 3) {
        data.sets[code].boxMarket = data.sets[code].boxMarket || {};
        data.sets[code].boxMarket[ed] = data.sets[code].boxMarket[ed] || {};
        data.sets[code].boxMarket[ed].ebaySold = {
          median: Math.round(med(units)), low: Math.round(q(units, 0.25)), high: Math.round(q(units, 0.75)),
          sampleSize: units.length, basis: "sold", currency: "USD", updated: today,
        };
      }
    }
  }

  for (const eds of Object.values(ledger.sets)) for (const arr of Object.values(eds)) if (Array.isArray(arr)) arr.sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
  ledger.note = "Append-only ledger of individual completed eBay sales of sealed One Piece booster boxes, one record per sold listing (deduplicated by eBay item id). Collected via a real browser because eBay blocks server access to completed-sale data. Prices are per box: multi-box lots are divided by the quantity stated in the title, and listings whose quantity or language cannot be determined are excluded rather than guessed. Weekly medians, sold counts, and sales volume are derived from this file. Past records are never modified or deleted.";
  ledger.updated = today;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger) + "\n", "utf8");
  fs.writeFileSync(dataPath, JSON.stringify(data) + "\n", "utf8");

  const totals = Object.values(ledger.sets).reduce((a, s) => a + (s.jp || []).length + (s.en || []).length, 0);
  const cappedNote = cappedPages.length
    ? `${cappedPages.length}/${(dump.pages || []).length} pages hit eBay's ~240-result ceiling — older sales in those slices were not visible. Narrow the price bands to recover them.`
    : null;
  console.log(JSON.stringify({ pages: (dump.pages || []).length, summary, drops, backfilled, capped: cappedPages.length, cappedNote, ledgerTotal: totals }));
}

module.exports = { judgeItem, editionOf, soldDateOf, buildNameMap, codesFromName };
if (require.main === module) {
  if (!process.argv[2]) { console.error("usage: node tools/box-sold-ingest.js <dump.json>"); process.exit(1); }
  main(process.argv[2]);
}
