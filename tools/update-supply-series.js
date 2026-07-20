// 공급 시계열 — 세트별 이베이 매물 수와 "신규 등록 / 소멸" 건수를 매일 축적.
//
// 왜: 시세만으로는 시장을 못 읽는다. 매물이 늘면서 가격이 버티는 것과, 매물이 마르면서
//     가격이 오르는 것은 완전히 다른 신호다. 이 데이터를 공개하는 곳이 사실상 없다.
//
// 방법: eBay Browse API 결과의 itemId 집합을 전일과 대조한다.
//   - 신규(new)  = 어제 없던 ID  → 신규 출품
//   - 소멸(gone) = 어제 있었는데 오늘 없는 ID → 판매됐거나 내려간 것
//   ⚠️ 소멸은 "판매"가 아니다. eBay Browse API로는 판매/취소를 구분할 수 없다.
//      절대 sold(실거래)로 표기하지 말 것 — 표시할 땐 "delisted or sold"로만 쓴다.
//
// 파일: data/listing-ids.json  (오늘 스냅샷만, 매일 덮어씀 — 대조용)
//       data/supply-series.json (일자별 집계, 180일 롤링)
// Run: node tools/update-supply-series.js   (eBay 수집기 실행 뒤)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const HISTORY_DAYS = 180;

const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const idsPath = path.join(ROOT, "data", "listing-ids.json");
const seriesPath = path.join(ROOT, "data", "supply-series.json");

const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const readJson = (p, fallback) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; } };

const prevIds = readJson(idsPath, { sets: {} });
const series = readJson(seriesPath, { updated: "", note: "", sets: {} });

const nextIds = { updated: today, sets: {} };
let touched = 0, firstDay = 0;

for (const [code, set] of Object.entries(data.sets || {})) {
  const jp = set.boxMarket?.jp?.ebayActive;
  const en = set.boxMarket?.en?.ebayActive;
  if (!jp && !en) continue;

  const jpIds = Array.isArray(jp?.itemIds) ? jp.itemIds : null;
  const enIds = Array.isArray(en?.itemIds) ? en.itemIds : null;
  nextIds.sets[code] = { jp: jpIds || [], en: enIds || [] };

  const prev = prevIds.sets?.[code] || {};
  const diff = (curr, before) => {
    // 어제 스냅샷이 없으면 신규/소멸을 계산할 수 없다 → null(0으로 속이지 않는다)
    if (!Array.isArray(curr) || !Array.isArray(before) || before.length === 0) return { added: null, gone: null };
    const b = new Set(before);
    const c = new Set(curr);
    return {
      added: curr.filter((id) => !b.has(id)).length,
      gone: before.filter((id) => !c.has(id)).length,
    };
  };
  const dJp = diff(jpIds, prev.jp);
  const dEn = diff(enIds, prev.en);
  if (dJp.added == null && dEn.added == null) firstDay += 1;

  const point = {
    d: today,
    jp: jp?.sampleSize ?? null,          // 오늘 유효 매물 수(필터 통과분)
    en: en?.sampleSize ?? null,
    jpExcluded: jp?.excludedCount ?? null, // 필터로 제외된 매물(제외 셀러/지역 등)
    enExcluded: en?.excludedCount ?? null,
    jpNew: dJp.added, jpGone: dJp.gone,   // null = 대조할 전일 데이터 없음
    enNew: dEn.added, enGone: dEn.gone,
  };

  series.sets[code] = series.sets[code] || { points: [] };
  const pts = series.sets[code].points.filter((p) => p.d !== today);
  pts.push(point);
  // 180일 롤링
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  series.sets[code].points = pts.filter((p) => new Date(p.d) >= cutoff).sort((a, b) => a.d.localeCompare(b.d));
  touched += 1;
}

series.updated = today;
series.note = "Daily eBay active-listing supply per set. 'gone' means the listing disappeared (sold OR delisted) — eBay Browse API cannot distinguish the two, so this is never labelled as a sale. null = no prior-day snapshot to compare.";

fs.writeFileSync(idsPath, JSON.stringify(nextIds) + "\n", "utf8");
fs.writeFileSync(seriesPath, JSON.stringify(series, null, 1) + "\n", "utf8");
console.log(JSON.stringify({ sets: touched, firstDayNoDiff: firstDay, idsBytes: fs.statSync(idsPath).size, seriesBytes: fs.statSync(seriesPath).size }));
