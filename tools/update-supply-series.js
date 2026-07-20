// 공급 시계열 — 세트별로 매일 "매물 수 / 신규 등록 / 사라진 매물"과 그 가격대를 축적.
//
// 왜: 시세만으로는 시장을 못 읽는다. 매물이 늘면서 가격이 버티는 것과, 매물이 마르면서
//     가격이 오르는 것은 완전히 다른 신호다. 이 데이터를 공개하는 곳이 사실상 없다.
//
// 방법: eBay Browse API 결과의 itemId→가격 맵을 전일과 대조한다.
//   - new  = 어제 없던 ID            → 신규 출품
//   - gone = 어제 있었는데 오늘 없는 ID → 목록에서 사라짐
//   그리고 각각의 "중앙 가격"을 같이 남긴다. 싼 매물부터 빠지면 수요가 흡수 중이라는 뜻이고,
//   비싼 매물이 남으면 호가만 오른 것이다 — 개수만으로는 절대 안 보이는 신호.
//
// ⚠️ 정확도 원칙 (절대 위반 금지)
//   1. gone 은 "판매"가 아니다. Browse API로는 판매/취소/만료를 구분할 수 없다.
//      화면·CSV·스키마 어디에도 sold(실거래)로 표기하지 말 것. 라벨은 "delisted or sold".
//   2. 전일 스냅샷이 없으면 0이 아니라 null. 없는 걸 0으로 채우면 "거래 0건"으로 읽혀 거짓이 된다.
//
// 파일: data/listing-ids.json   (오늘 스냅샷만, 매일 덮어씀 — 대조용)
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
const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fb; } };

const prev = readJson(idsPath, { sets: {} });
const series = readJson(seriesPath, { updated: "", note: "", sets: {} });

const median = (arr) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return Number((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(2));
};

// 전일 대비 신규/소멸 + 각 가격 중앙값. 전일 자료 없으면 전부 null.
function diff(curr, before) {
  const empty = { added: null, gone: null, addedPrice: null, gonePrice: null };
  if (!curr || !before || Object.keys(before).length === 0) return empty;
  const addedIds = Object.keys(curr).filter((id) => !(id in before));
  const goneIds = Object.keys(before).filter((id) => !(id in curr));
  return {
    added: addedIds.length,
    gone: goneIds.length,
    addedPrice: median(addedIds.map((id) => curr[id]).filter((v) => Number.isFinite(v))),
    gonePrice: median(goneIds.map((id) => before[id]).filter((v) => Number.isFinite(v))),
  };
}

const nextIds = { updated: today, sets: {} };
let touched = 0, awaitingBaseline = 0;

for (const [code, set] of Object.entries(data.sets || {})) {
  const jp = set.boxMarket?.jp?.ebayActive;
  const en = set.boxMarket?.en?.ebayActive;
  if (!jp && !en) continue;

  const jpP = jp?.itemPrices && typeof jp.itemPrices === "object" ? jp.itemPrices : null;
  const enP = en?.itemPrices && typeof en.itemPrices === "object" ? en.itemPrices : null;
  nextIds.sets[code] = { jp: jpP || {}, en: enP || {} };

  const dJp = diff(jpP, prev.sets?.[code]?.jp);
  const dEn = diff(enP, prev.sets?.[code]?.en);
  if (dJp.added == null && dEn.added == null) awaitingBaseline += 1;

  const point = {
    d: today,
    jp: jp?.sampleSize ?? null,             // 오늘 유효 매물 수(필터 통과분)
    en: en?.sampleSize ?? null,
    jpExcluded: jp?.excludedCount ?? null,  // 제외 셀러/지역 등으로 걸러낸 매물
    enExcluded: en?.excludedCount ?? null,
    jpNew: dJp.added, jpGone: dJp.gone,     // null = 대조할 전일 스냅샷 없음
    enNew: dEn.added, enGone: dEn.gone,
    jpNewPrice: dJp.addedPrice, jpGonePrice: dJp.gonePrice, // 신규/소멸 매물의 중앙 가격(USD)
    enNewPrice: dEn.addedPrice, enGonePrice: dEn.gonePrice,
    // 수요 대용 신호 — 실거래 API가 막혀 있어 "안 팔리고 있음"을 간접 측정한다(판매량 아님)
    jpAgeDays: jp?.supplySignals?.medianAgeDays ?? null,     // 매물이 걸려 있는 일수(중앙값)
    jpRelistRate: jp?.supplySignals?.relistRate ?? null,     // % 재등록 = 안 팔려서 다시 올림
    jpOfferRate: jp?.supplySignals?.bestOfferRate ?? null,   // % 가격협상 허용 = 정가에 못 파는 정도
    jpCountryMix: jp?.supplySignals?.countryMix ?? null,
    // 시장 구조 — 소급 불가한 값이라 용도가 확정되기 전이라도 축적한다
    jpTotalListed: jp?.totalResults ?? null,                    // 필터 전 전체 매물수(시장 규모)
    jpSellers: jp?.supplySignals?.uniqueSellers ?? null,        // 고유 셀러 수
    jpTop3Share: jp?.supplySignals?.top3SellerShare ?? null,    // % 상위3셀러 점유 = 호가 장악도
    jpFreeShip: jp?.supplySignals?.freeShipRate ?? null,
    jpDiscount: jp?.supplySignals?.discountRate ?? null,        // % 할인표시 = 셀러가 내리는 중
    jpSellerFeedback: jp?.supplySignals?.medianSellerFeedback ?? null,
    enAgeDays: en?.supplySignals?.medianAgeDays ?? null,
    enRelistRate: en?.supplySignals?.relistRate ?? null,
    enOfferRate: en?.supplySignals?.bestOfferRate ?? null,
    enCountryMix: en?.supplySignals?.countryMix ?? null,
    enTotalListed: en?.totalResults ?? null,
    enSellers: en?.supplySignals?.uniqueSellers ?? null,
    enTop3Share: en?.supplySignals?.top3SellerShare ?? null,
    enFreeShip: en?.supplySignals?.freeShipRate ?? null,
    enDiscount: en?.supplySignals?.discountRate ?? null,
    enSellerFeedback: en?.supplySignals?.medianSellerFeedback ?? null,
  };

  series.sets[code] = series.sets[code] || { points: [] };
  const pts = series.sets[code].points.filter((p) => p.d !== today);
  pts.push(point);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - HISTORY_DAYS);
  series.sets[code].points = pts.filter((p) => new Date(p.d) >= cutoff).sort((a, b) => a.d.localeCompare(b.d));
  touched += 1;
}

series.updated = today;
series.note = "Daily eBay active-listing supply and demand-proxy signals per set (median listing age, relist rate, best-offer rate, seller country mix). None of these are sales figures: eBay does not expose sold data at this access tier. with the median price of listings that appeared or disappeared. 'gone' means the listing left the active list (sold OR delisted OR expired) — the eBay Browse API cannot distinguish these, so it is never reported as a sale. null = no prior-day snapshot to compare against.";

fs.writeFileSync(idsPath, JSON.stringify(nextIds) + "\n", "utf8");
fs.writeFileSync(seriesPath, JSON.stringify(series, null, 1) + "\n", "utf8");
console.log(JSON.stringify({
  sets: touched,
  awaitingBaseline,
  idsKB: Math.round(fs.statSync(idsPath).size / 1024),
  seriesKB: Math.round(fs.statSync(seriesPath).size / 1024),
}));
