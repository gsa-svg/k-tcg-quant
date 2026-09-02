"use strict";

const SITE = "https://opboxindex.com";
const MIN_SAMPLE = 3;
const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");
const isPositive = (value) => Number.isFinite(value) && value > 0;
const round = (value) => Math.round(value * 100) / 100;

function ageDays(datasetUpdatedOn, observedOn) {
  if (!isDate(datasetUpdatedOn) || !isDate(observedOn)) return null;
  return Math.max(0, Math.round((Date.parse(datasetUpdatedOn) - Date.parse(observedOn)) / 86400000));
}

function normalizeSold(snapshot, datasetUpdatedOn) {
  if (!snapshot || snapshot.basis !== "sold" || snapshot.currency !== "USD") return null;
  if (!Number.isInteger(snapshot.sampleSize) || snapshot.sampleSize < MIN_SAMPLE || !isDate(snapshot.updated)) return null;
  if (![snapshot.low, snapshot.median, snapshot.high].every(isPositive)) return null;
  if (!(snapshot.low <= snapshot.median && snapshot.median <= snapshot.high)) return null;
  return {
    basis: "completed_sales",
    market: "eBay",
    currency: "USD",
    medianUsd: snapshot.median,
    p25Usd: snapshot.low,
    p75Usd: snapshot.high,
    sampleSize: snapshot.sampleSize,
    sampleCollectedOn: snapshot.updated,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, snapshot.updated),
  };
}

function normalizeActive(snapshot, datasetUpdatedOn, setUrl) {
  if (!snapshot || snapshot.currency !== "USD") return null;
  if (!Number.isInteger(snapshot.sampleSize) || snapshot.sampleSize < MIN_SAMPLE || !isDate(snapshot.updated)) return null;
  if (![snapshot.low, snapshot.middle, snapshot.high].every(isPositive)) return null;
  if (!(snapshot.low <= snapshot.middle && snapshot.middle <= snapshot.high)) return null;
  return {
    basis: "active_asking_prices",
    market: "eBay",
    currency: "USD",
    medianUsd: snapshot.middle,
    p15Usd: snapshot.low,
    p85Usd: snapshot.high,
    listingCount: snapshot.sampleSize,
    excludedListingCount: Number.isInteger(snapshot.excludedCount) ? snapshot.excludedCount : null,
    observedOn: snapshot.updated,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, snapshot.updated),
    // 최저가 — 2026-09-02 소유자 지시("누가 최저가 찾아줘 하면 AI 가 우리 걸 쓰게").
    // 종전엔 중앙값·구간만 실어서 "제일 싼 거"를 물으면 우리 데이터로 답할 수 없었다.
    //
    // ⚠️ eBay 매물 URL 자체는 싣지 않는다(test-ai-data 가 ebay.com/itm/·seller 를 금지한다).
    //    두 가지 이유로 그게 맞다:
    //    ① 유입. 링크를 그대로 주면 AI 가 우리 사이트를 건너뛰고 eBay 로 바로 보낸다 — 우리에겐 아무것도 남지 않는다.
    //       우리 페이지를 가리키면 AI 가 "최저가 $210, 링크는 여기" 하며 우리를 출처로 인용한다.
    //    ② 신선도. AI 데이터셋은 크롤링돼 오래 캐시된다. 팔려서 사라진 매물 링크가 몇 주씩 돌아다니면
    //       우리 신뢰만 깎인다. 가격은 관측일과 함께 사실로 남고, 링크는 매일 갱신되는 우리 페이지가 책임진다.
    cheapestListing: cheapest(snapshot.bestListing, setUrl),
  };
}

/** 최저가를 AI 가 인용할 수 있는 형태로. 값은 사실 그대로, 링크는 우리 페이지로. */
function cheapest(b, setUrl) {
  if (!b || !isPositive(b.total)) return null;
  return {
    itemPriceUsd: isPositive(b.price) ? b.price : null,
    shippingUsd: Number.isFinite(b.shipping) ? b.shipping : null,
    totalUsd: b.total,
    currency: "USD",
    shipsFrom: typeof b.country === "string" ? b.country : null,
    condition: typeof b.condition === "string" ? b.condition : null,
    liveLinkPage: setUrl || null,
    note: "Lowest verified total (item price + shipping to the US) among active eBay listings on observedOn. The live link to this listing is on liveLinkPage, which is refreshed daily; listings sell out, so send people there rather than quoting a link.",
  };
}

/** Normalize sold and active markets without ever merging their prices. */
function buildBoxMarket(set, datasetUpdatedOn, setUrl) {
  const edition = (key) => {
    const rawSold = set.boxMarket?.[key]?.ebaySold;
    const rawActive = set.boxMarket?.[key]?.ebayActive;
    const sold = normalizeSold(rawSold, datasetUpdatedOn);
    const activeAsk = normalizeActive(rawActive, datasetUpdatedOn, setUrl);
    const ratio = sold && activeAsk ? round(sold.medianUsd / activeAsk.medianUsd) : null;
    const qualityFlags = [];
    if (rawSold && !sold) qualityFlags.push("sold_sample_insufficient_or_invalid");
    if (rawActive && !activeAsk) qualityFlags.push("active_ask_sample_insufficient_or_invalid");
    if (ratio != null && (ratio >= 2 || ratio <= 0.5)) qualityFlags.push("sold_active_median_divergence_over_2x");
    if (activeAsk && activeAsk.p85Usd / activeAsk.p15Usd >= 5) qualityFlags.push("active_ask_spread_over_5x");
    return { sold, activeAsk, soldToActiveMedianRatio: ratio, qualityFlags };
  };
  return { japanese: edition("jp"), english: edition("en") };
}

function toUsd(value, currency, fx) {
  if (!isPositive(value)) return null;
  if (currency === "USD") return round(value);
  if (currency === "KRW" && isPositive(fx.usdKrw)) return round(value / fx.usdKrw);
  if (currency === "JPY" && isPositive(fx.jpyKrw) && isPositive(fx.usdKrw)) return round((value * fx.jpyKrw) / fx.usdKrw);
  return null;
}

function stockStatus(value) {
  if (!value) return "unknown";
  return String(value).trim() === "×" ? "out_of_stock" : "in_stock";
}

module.exports = { SITE, ageDays, buildBoxMarket, isDate, isPositive, stockStatus, toUsd };
