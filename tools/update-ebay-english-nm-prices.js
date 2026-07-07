#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");
const { median, percentile } = require("./price-outliers");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const envPath = path.join(projectRoot, ".env");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((values, line) => {
      const idx = line.indexOf("=");
      if (idx === -1) return values;
      values[line.slice(0, idx).trim()] = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      return values;
    }, {});
}

const env = { ...loadEnv(envPath), ...process.env };
const clientId = env.EBAY_CLIENT_ID;
const clientSecret = env.EBAY_CLIENT_SECRET;
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
const searchLimit = env.EBAY_ENGLISH_NM_SEARCH_LIMIT || env.EBAY_SEARCH_LIMIT || "50";

function requireCredentials() {
  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. Put the rotated Production keyset in .env.");
  }
}

function normalizeNumber(number, setCode) {
  const raw = (number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) {
    return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  }
  return raw;
}

function buildQuery(setCode, card) {
  const number = normalizeNumber(card.number, setCode);
  return ["One Piece Card Game", number, card.name, "English", "NM"].filter(Boolean).join(" ");
}

async function getApplicationToken() {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`OAuth failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

async function searchActiveListings(token, query) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", searchLimit);
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
  });
  if (!res.ok) throw new Error(`Browse search failed (${res.status}): ${(await res.text()).slice(0, 500)}`);
  return res.json();
}

function isExcludedSeller(item) {
  return isExcludedEbaySellerOrLocation(item);
}

function hasNumber(title, number) {
  if (!number || number === "-") return false;
  const compact = number.replace("-", "");
  const spaced = number.replace("-", "[-\\s]?");
  return new RegExp(`\\b${spaced}\\b`, "i").test(title) || new RegExp(`\\b${compact}\\b`, "i").test(title);
}

function removeEnglishNmOutliers(sortedValues) {
  if (sortedValues.length === 2) {
    const [low, high] = sortedValues;
    if (high > low * 3 && high - low > 50) {
      return { values: [], outlierCount: 2 };
    }
    return { values: sortedValues, outlierCount: 0 };
  }

  if (sortedValues.length < 3) return { values: sortedValues, outlierCount: 0 };

  const center = median(sortedValues);
  if (!center || center <= 0) return { values: sortedValues, outlierCount: 0 };

  let values = sortedValues.filter((value) => value >= center / 4 && value <= center * 2.5);
  if (values.length >= 3) {
    const high = values[values.length - 1];
    const secondHigh = values[values.length - 2];
    if (high > secondHigh * 2 && high - secondHigh > 50) {
      values = values.slice(0, -1);
    }
  }

  return {
    values: values.length ? values : sortedValues,
    outlierCount: sortedValues.length - values.length,
  };
}

function isEnglishRawNmCard(item, setCode, card) {
  const title = item.title || "";
  const condition = item.condition || "";
  const number = normalizeNumber(card.number, setCode);
  const isParallelTarget = /parallel/i.test(card.name || "");
  const isMangaTarget = /manga/i.test(card.name || "");
  const isSpTarget = /\bSP\b/i.test(card.name || "");
  const isTreasureTarget = /\bTR\b|treasure/i.test(card.name || "");
  const nameCore = (card.name || "")
    .replace(/\b\d{3}\b/g, "")
    .replace(/\bparallel\b/gi, "")
    .trim();
  const nameTokens = nameCore
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3)
    .slice(0, 3);
  const hasName = nameTokens.length === 0 || nameTokens.every((token) => new RegExp(`\\b${token}\\b`, "i").test(title));
  const hasParallelSignal = !isParallelTarget || /parallel|alternate|alt\s*art|\baa\b/i.test(title);
  const hasMangaSignal = !isMangaTarget || /manga/i.test(title);
  const hasSpSignal = !isSpTarget || /\bSP\b|special/i.test(title);
  const hasTreasureSignal = !isTreasureTarget || /\bTR\b|treasure/i.test(title);
  const positive = [/one piece/i];
  const negative = [
    /psa|bgs|cgc|ars|sgc|graded|gem\s*mint|slab/i,
    /japanese|japan|\bjpn\b|\bjp\b|korean|chinese|simplified/i,
    /proxy|digital|custom|metal|gold|orica/i,
    /lot of|bundle|playset|complete set|booster|box|case|pack/i,
    /promo|promotion|gift collection|premium card collection|three captains|ultra deck|anniversary|reprint/i,
  ];

  return (
    positive.every((pattern) => pattern.test(title)) &&
    !negative.some((pattern) => pattern.test(title)) &&
    !/graded/i.test(condition) &&
    hasNumber(title, number) &&
    hasName &&
    hasParallelSignal &&
    hasMangaSignal &&
    hasSpSignal &&
    hasTreasureSignal
  );
}

function analyzeItems(items, setCode, card) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const value = Number(item.price?.value);
    const currency = item.price?.currency;
    if (!Number.isFinite(value) || !currency) continue;
    if (!isEnglishRawNmCard(item, setCode, card)) continue;
    if (isExcludedSeller(item)) {
      excludedCount += 1;
      continue;
    }
    kept.push({ value, currency });
  }

  const grouped = kept.reduce((acc, item) => {
    acc[item.currency] = acc[item.currency] || [];
    acc[item.currency].push(item.value);
    return acc;
  }, {});
  const currency = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "USD";
  const rawValues = (grouped[currency] || []).sort((a, b) => a - b);
  const { values, outlierCount } = removeEnglishNmOutliers(rawValues);

  return {
    currency,
    low: percentile(values, 0.15),
    middle: percentile(values, 0.5),
    high: percentile(values, 0.85),
    sampleSize: values.length,
    excludedCount: excludedCount + outlierCount,
    outlierCount,
  };
}

function targetCards(data, requestedCodes) {
  const codes = requestedCodes.length
    ? requestedCodes
    : [...data.jp.list, ...data.extra.list].filter((code) => data.sets[code]?.cards?.length);
  return codes.flatMap((code) =>
    (data.sets[code]?.cards || [])
      .filter((card) => card.number && card.number !== "-")
      .map((card) => ({ code, card })),
  );
}

async function main() {
  requireCredentials();

  const requestedCodes = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  for (const code of [...data.jp.list, ...data.extra.list]) {
    for (const card of data.sets[code]?.cards || []) {
      if (!card.number || card.number === "-") delete card.englishNmEbay;
    }
  }
  const token = (await getApplicationToken()).access_token;
  const targets = targetCards(data, requestedCodes);
  let updated = 0;
  let empty = 0;

  for (const { code, card } of targets) {
    const query = buildQuery(code, card);
    const result = await searchActiveListings(token, query);
    const market = analyzeItems(result.itemSummaries || [], code, card);

    if (market.sampleSize >= 2) {
      card.englishNmEbay = {
        source: "eBay Browse API item_summary/search",
        query,
        updated: new Date().toISOString().slice(0, 10),
        marketplaceId,
        ...market,
      };
      updated += 1;
    } else {
      delete card.englishNmEbay;
      empty += 1;
    }

    console.log(
      `${code} #${card.rank} ${card.number || "-"}: kept=${market.sampleSize} low=${market.low} mid=${market.middle} high=${market.high}`,
    );
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`English NM eBay updated=${updated} empty=${empty}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
