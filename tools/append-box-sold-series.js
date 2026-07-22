// 박스 eBay SOLD(실거래) 주간 시계열 append-only 축적 — 레퍼런스 차트(가격라인 + 판매수 막대)용 데이터 레이어.
//
// 왜 이렇게: eBay 는 sold(판매완료) 데이터를 API/서버로 막아 실제 브라우저(사용자 IP)로만 수집된다.
// 그 수집 결과가 data/onepiece-packs.json 의 boxMarket.[jp|en].ebaySold = {median, low, high, sampleSize, basis:"sold", updated}.
// 이건 "가장 최근 스냅샷 1점"이라, 이 도구가 그 스냅샷을 날짜별로 data/box-sold-series.json 에 **덧붙여** 시계열로 만든다.
//
// ⚠️ 원칙(핸드오프 2026-07-22):
//  - append-only. 과거 점은 절대 덮어쓰거나 지우지 않는다. 같은 날짜는 스킵(중복 방지).
//  - basis 는 항상 "sold" 인 스냅샷만 담는다. active/추정값을 sold 로 섞지 않는다.
//  - 조작 금지. ebaySold 스냅샷이 없으면 그 세트/판은 그냥 건너뛴다(빈 값을 지어내지 않음).
//  - n = 그 스냅샷의 판매완료 매물 수(sampleSize). 차트 막대가 될 값.
//
// 절차: 브라우저로 sold 재수집(box-sold-urls.js 참고) → ebaySold 갱신 → `node tools/append-box-sold-series.js` → 시계열에 새 점 추가.
// Run: node tools/append-box-sold-series.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const seriesPath = path.join(ROOT, "data", "box-sold-series.json");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const codes = [...(data.jp.list || []), ...(data.extra.list || [])];

let store;
try { store = JSON.parse(fs.readFileSync(seriesPath, "utf8")); } catch { store = { note: "", updated: "", sets: {} }; }
store.sets = store.sets || {};

let appended = 0, skipped = 0;
for (const code of codes) {
  const bm = (data.sets[code] && data.sets[code].boxMarket) || {};
  for (const ed of ["jp", "en"]) {
    const s = bm[ed] && bm[ed].ebaySold;
    // sold 스냅샷이 있고, median 이 수치이고, basis 가 sold 일 때만 담는다.
    if (!s || s.basis !== "sold" || typeof s.median !== "number" || !s.updated) continue;
    const point = {
      d: s.updated,
      median: s.median,
      low: typeof s.low === "number" ? s.low : null,
      high: typeof s.high === "number" ? s.high : null,
      n: Number.isFinite(s.sampleSize) ? s.sampleSize : null,
    };
    store.sets[code] = store.sets[code] || { jp: [], en: [] };
    const arr = store.sets[code][ed] = store.sets[code][ed] || [];
    if (arr.some((p) => p.d === point.d)) { skipped++; continue; }   // 같은 날짜 이미 있음 → 절대 덮어쓰지 않음
    arr.push(point);
    arr.sort((a, b) => a.d.localeCompare(b.d));
    appended++;
  }
}

store.note = "Append-only weekly eBay SOLD box-price series per set and edition (JP/EN). eBay blocks server access to completed-sale data, so each point is collected via a real browser and recorded here; basis is always sold. n = number of completed sold listings in that snapshot (chart bar value). Past points are never overwritten or backfilled.";
store.basis = "sold";
store.updated = new Date().toISOString().slice(0, 10);
fs.writeFileSync(seriesPath, JSON.stringify(store, null, 1) + "\n", "utf8");

const totalPoints = Object.values(store.sets).reduce((a, s) => a + (s.jp || []).length + (s.en || []).length, 0);
console.log(JSON.stringify({ appended, skipped, sets: Object.keys(store.sets).length, totalPoints }));
