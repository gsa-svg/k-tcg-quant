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

function normalizeActive(snapshot, datasetUpdatedOn) {
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
  };
}

/** Normalize sold and active markets without ever merging their prices. */
function buildBoxMarket(set, datasetUpdatedOn) {
  const edition = (key) => {
    const rawSold = set.boxMarket?.[key]?.ebaySold;
    const rawActive = set.boxMarket?.[key]?.ebayActive;
    const sold = normalizeSold(rawSold, datasetUpdatedOn);
    const activeAsk = normalizeActive(rawActive, datasetUpdatedOn);
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
