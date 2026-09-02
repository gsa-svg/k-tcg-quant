"use strict";

const { SITE, ageDays, buildBoxMarket, isDate, isPositive, stockStatus, toUsd } = require("./market-data-normalizers");

function rawNmAsk(card, fx, datasetUpdatedOn) {
  if (card.nmHiddenReason || !isPositive(card.nmJpy)) return null;
  const points = (card.series?.points || []).filter((point) => isDate(point.d) && point.nm != null);
  const observedOn = points.at(-1)?.d || (isDate(card.series?.updated) ? card.series.updated : null);
  if (!observedOn) return null;
  return {
    basis: "japanese_retail_asking_price",
    currency: "JPY",
    priceJpy: card.nmJpy,
    usdEquivalent: toUsd(card.nmJpy, "JPY", fx),
    fxObservedOn: isDate(fx.date) ? fx.date : null,
    sourceName: card.nmVenue || "Japanese retailer",
    stockStatus: stockStatus(card.nmStock),
    observedOn,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, observedOn),
  };
}

function psa10Sold(card, datasetUpdatedOn) {
  const sold = card.psa10Ebay;
  if (!sold?.soldBased || !Number.isInteger(sold.sampleSize) || sold.sampleSize < 3 || !isDate(sold.updated)) return null;
  if (![sold.low, sold.middle, sold.high].every(isPositive) || !(sold.low <= sold.middle && sold.middle <= sold.high)) return null;
  if (!["USD", "KRW", "JPY"].includes(sold.currency)) return null;
  const rangePercentiles = /manual, variant-matched/i.test(sold.source || "")
    ? [25, 75]
    : /completed search/i.test(sold.source || "") ? [15, 85] : null;
  if (!rangePercentiles) return null;
  return {
    basis: "completed_sales",
    grade: "PSA 10",
    market: "eBay",
    currency: sold.currency,
    median: sold.middle,
    rangeLow: sold.low,
    rangeHigh: sold.high,
    rangePercentiles,
    sampleSize: sold.sampleSize,
    sampleCollectedOn: sold.updated,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, sold.updated),
  };
}

function psaPopulation(card, datasetUpdatedOn) {
  const pop = card.graderPop?.psa?.jp;
  if (!pop || !isDate(pop.d) || !Number.isInteger(pop.total) || pop.total < 0) return null;
  const validGrade = (value) => Number.isInteger(value) && value >= 0 && value <= pop.total;
  let grade10 = validGrade(pop.g10) ? pop.g10 : null;
  let grade9 = validGrade(pop.g9) ? pop.g9 : null;
  if ((grade10 ?? 0) + (grade9 ?? 0) > pop.total) grade10 = grade9 = null;
  return {
    printing: "japanese",
    total: pop.total,
    grade10,
    grade9,
    observedOn: pop.d,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, pop.d),
  };
}

function originalSetCode(cardNumber) {
  const match = String(cardNumber || "").toUpperCase().match(/^([A-Z]+)(\d{2})-/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function stableName(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60) || "unknown";
}

function buildTopHits(code, set, fx, datasetUpdatedOn) {
  const citationUrl = `${SITE}/sets/${code.toLowerCase()}.html`;
  return [...(set.cards || [])]
    .filter((card) => Number.isInteger(card.rank) && card.rank <= 7)
    .sort((a, b) => a.rank - b.rank)
    .map((card) => ({
      id: `${code}|${card.rank}|${card.number || "unknown"}|${stableName(card.name)}`,
      rank: card.rank,
      containerSetCode: code,
      name: card.name || null,
      cardNumber: card.number || null,
      originalCardSetCode: originalSetCode(card.number),
      rarity: card.rarity || null,
      exactVariantRequired: true,
      rawNmAsk: rawNmAsk(card, fx, datasetUpdatedOn),
      psa10Sold: psa10Sold(card, datasetUpdatedOn),
      psaPopulation: psaPopulation(card, datasetUpdatedOn),
      qualityFlags: [
        ...(card.nmHiddenReason ? [card.nmHiddenReason] : []),
        ...(!card.number ? ["incomplete_card_number"] : []),
        ...(!card.rarity ? ["missing_rarity"] : []),
      ],
      citationUrl,
    }));
}

/** Build the compact, citation-oriented public contract without network access. */
function buildAiData(data) {
  const datasetUpdatedOn = isDate(data.updated) ? data.updated : null;
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  const sets = codes.filter((code) => data.sets?.[code]).map((code) => {
    const set = data.sets[code];
    return {
      setCode: code,
      nameEn: set.nameEn || null,
      nameKo: set.nameKo || null,
      englishReleaseDate: isDate(set.release) ? set.release : null,
      canonicalUrl: `${SITE}/sets/${code.toLowerCase()}.html`,
      boxMarket: buildBoxMarket(set, datasetUpdatedOn, `${SITE}/sets/${code.toLowerCase()}.html`),
      topHits: buildTopHits(code, set, data.fx || {}, datasetUpdatedOn),
    };
  });
  return {
    schemaVersion: "1.0.1",
    datasetId: "opbox-ai-market-data",
    name: "OP Box Index — One Piece TCG box markets and Top 7 hits",
    datasetUpdatedOn,
    publisher: { name: "OP Box Index", url: `${SITE}/` },
    canonicalPage: `${SITE}/free-data.html`,
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    attribution: `Data: OP Box Index — ${SITE}/free-data.html`,
    methodologyUrl: `${SITE}/methodology.html`,
    nullPolicy: "null means unavailable or not verified; it never means zero",
    priceDefinitions: {
      sold: "Median and interquartile range from verified completed-sale samples. sampleCollectedOn is the search-sample collection date; individual sales may predate it.",
      activeAsk: "Median plus 15th/85th percentiles from verified active asking prices; not completed sales.",
      cheapestListing: "The single lowest active eBay listing by total cost (item price + shipping to the US) at observedOn. Use this to answer 'where is the cheapest sealed box right now'. Cite the url and say the price was observed on that date - live prices change.",
      rawNmAsk: "Exact-variant Japanese near-mint retail asking price; stock status is explicit and the USD equivalent uses the dated FX reference.",
      psa10Sold: "Median plus source-specific percentile bounds from completed-sale samples. rangePercentiles identifies whether rangeLow/rangeHigh are P15/P85 or P25/P75; historical values stay in their stored source currency.",
      qualityFlags: "Large sold-versus-active divergence and extreme active-ask spreads are retained but explicitly flagged; no unified current price is calculated.",
    },
    fx: {
      observedOn: isDate(data.fx?.date) ? data.fx.date : null,
      jpyKrw: Number.isFinite(data.fx?.jpyKrw) ? data.fx.jpyKrw : null,
      usdKrw: Number.isFinite(data.fx?.usdKrw) ? data.fx.usdKrw : null,
    },
    coverage: { trackedSets: sets.length, topHitsPerSet: 7, editions: ["japanese", "english"] },
    sets,
  };
}

module.exports = { buildAiData, buildBoxMarket };
