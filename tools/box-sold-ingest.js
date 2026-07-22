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
const BAD = /\blots?\b|\bcases?\b|carton|display|sleeved?|bundle|wholesale|\bbulk\b|choose|\bpick\b|blister|proxy|\bempty\b|chinese|simplified/i;
const BOOSTER = /booster box/i;
const SET_CODE = /\b(OP|EB|PRB|ST)[-\s]?(\d{2})\b/gi;

function editionOf(title) {
  if (/english|\beng\b/i.test(title)) return "en";
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
function judgeItem(item, targetCode, fxUsdKrw) {
  const t = String(item.t || "");
  if (!BOOSTER.test(t)) return { drop: "not-booster-box" };
  if (BAD.test(t)) return { drop: "bad-word" };
  const codes = new Set();
  for (const m of t.matchAll(SET_CODE)) codes.add(`${m[1].toUpperCase()}-${m[2]}`);
  if (!codes.has(targetCode)) return { drop: "code-missing" };
  if ([...codes].some((c) => c !== targetCode)) return { drop: "cross-set" };
  const ed = editionOf(t);
  if (!ed) return { drop: "no-language" };
  const qty = parseLotQuantity(t, "box");
  if (qty == null) return { drop: "uncountable-lot" };
  const totalUsd = item.cur === "USD" ? item.k : item.cur === "KRW" ? item.k / fxUsdKrw : null;
  if (!Number.isFinite(totalUsd)) return { drop: "bad-currency" };
  const unit = unitPrice(totalUsd, qty);
  if (unit == null || unit < 90000 / fxUsdKrw || unit > 5000) return { drop: "price-out-of-range" };
  const d = soldDateOf(item.d);
  if (!d) return { drop: "bad-date" };
  return { rec: { id: String(item.id), d, unit: Number(unit.toFixed(2)), total: Number(totalUsd.toFixed(2)), qty, title: t.slice(0, 140) }, ed };
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
  const today = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || "")) throw new Error("dump.collectedAt 필요 (YYYY-MM-DD)");

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { ledger = { sets: {} }; }
  ledger.sets = ledger.sets || {};
  const knownIds = new Set();
  for (const eds of Object.values(ledger.sets)) for (const arr of Object.values(eds)) if (Array.isArray(arr)) for (const r of arr) knownIds.add(r.id);

  const summary = {};
  const drops = {};
  for (const page of dump.pages || []) {
    const code = page.code;
    if (!data.sets[code]) continue;
    // 이번 덤프에서 유효 판정된 건 전부(이미 아는 id 포함) — 스냅샷 계산용
    const seen = { jp: [], en: [] };
    let appended = 0;
    for (const item of page.items || []) {
      const j = judgeItem(item, code, fx);
      if (j.drop) { drops[j.drop] = (drops[j.drop] || 0) + 1; continue; }
      seen[j.ed].push(j.rec);
      if (knownIds.has(j.rec.id)) continue;                       // 이미 원장에 있음 — 절대 덮어쓰지 않음
      knownIds.add(j.rec.id);
      ledger.sets[code] = ledger.sets[code] || { jp: [], en: [] };
      ledger.sets[code][j.ed].push(j.rec);
      appended++;
    }
    // 스냅샷(기존 시리즈 연속성): 이번 페이지에서 보인 유효 sold 전체 기준, n>=3일 때만.
    for (const ed of ["jp", "en"]) {
      const units = seen[ed].map((r) => r.unit);
      if (units.length >= 3) {
        data.sets[code].boxMarket = data.sets[code].boxMarket || {};
        data.sets[code].boxMarket[ed] = data.sets[code].boxMarket[ed] || {};
        data.sets[code].boxMarket[ed].ebaySold = {
          median: Math.round(med(units)), low: Math.round(q(units, 0.25)), high: Math.round(q(units, 0.75)),
          sampleSize: units.length, basis: "sold", updated: today,
        };
      }
    }
    summary[code] = { jpSeen: seen.jp.length, enSeen: seen.en.length, appended };
  }

  for (const eds of Object.values(ledger.sets)) for (const arr of Object.values(eds)) if (Array.isArray(arr)) arr.sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
  ledger.note = "Append-only ledger of individual completed eBay sales of sealed One Piece booster boxes, one record per sold listing (deduplicated by eBay item id). Collected via a real browser because eBay blocks server access to completed-sale data. Prices are per box: multi-box lots are divided by the quantity stated in the title, and listings whose quantity or language cannot be determined are excluded rather than guessed. Weekly medians, sold counts, and sales volume are derived from this file. Past records are never modified or deleted.";
  ledger.updated = today;
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger) + "\n", "utf8");
  fs.writeFileSync(dataPath, JSON.stringify(data) + "\n", "utf8");

  const totals = Object.values(ledger.sets).reduce((a, s) => a + (s.jp || []).length + (s.en || []).length, 0);
  console.log(JSON.stringify({ pages: (dump.pages || []).length, summary, drops, ledgerTotal: totals }));
}

module.exports = { judgeItem, editionOf, soldDateOf };
if (require.main === module) {
  if (!process.argv[2]) { console.error("usage: node tools/box-sold-ingest.js <dump.json>"); process.exit(1); }
  main(process.argv[2]);
}
