#!/usr/bin/env node

// 영문판 미개봉 부스터박스 시세 수집 (eBay US Active) — 일판 update-ebay-pack-prices.js의 자매 스크립트.
// - 제목에 English 명시된 매물만 인정(무표기는 일판 혼입 위험으로 제외 — 정확도 우선)
// - set.boxMarket.en.ebayActive 에 기록. UI는 표본 3건 미만이면 표시하지 않는다.
// Run: node tools/update-ebay-english-pack-prices.js [CODE ...]

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation, isEnglishSealedBoosterBoxTitle } = require("./ebay-listing-filters");

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
const searchLimit = env.EBAY_SEARCH_LIMIT || "50";

function requireCredentials() {
  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. Put the rotated Production keyset in .env.");
  }
}

function buildQuery(code, set) {
  const boxType = code.startsWith("PRB") ? "Premium Booster Box" : code.startsWith("EB") ? "Extra Booster Box" : "Booster Box";
  return ["One Piece Card Game", code, set.nameEn, boxType, "English", "sealed"].filter(Boolean).join(" ");
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

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)));
  return Number(sortedValues[index].toFixed(2));
}

function listingTotal(item) {
  const price = Number(item.price?.value);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value || 0);
  if (!Number.isFinite(price)) return null;
  return Number((price + (Number.isFinite(shipping) ? shipping : 0)).toFixed(2));
}

function listingSnapshot(item) {
  const total = listingTotal(item);
  if (total == null) return null;
  return {
    title: item.title || "",
    url: item.itemWebUrl || "",
    price: Number(item.price.value),
    shipping: Number(item.shippingOptions?.[0]?.shippingCost?.value || 0),
    total,
    currency: item.price.currency,
    country: item.itemLocation?.country || "",
    seller: item.seller?.username || "",
    condition: item.condition || "",
  };
}

function analyzeItems(items, code) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const value = Number(item.price?.value);
    const currency = item.price?.currency;
    if (!Number.isFinite(value) || !currency) continue;
    if (!isEnglishSealedBoosterBoxTitle(item.title, code)) continue;
    if (isExcludedEbaySellerOrLocation(item)) {
      excludedCount += 1;
      continue;
    }
    kept.push({ value, currency, listing: listingSnapshot(item) });
  }

  const grouped = kept.reduce((acc, item) => {
    acc[item.currency] = acc[item.currency] || [];
    acc[item.currency].push(item);
    return acc;
  }, {});
  const currency = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "USD";
  const selectedItems = grouped[currency] || [];
  const values = selectedItems.map((item) => item.value).sort((a, b) => a - b);
  const bestListing = selectedItems
    .map((item) => item.listing)
    .filter((item) => item?.url && item.currency === currency)
    .sort((a, b) => a.total - b.total)[0] || null;

  return {
    currency,
    low: percentile(values, 0.15),
    middle: percentile(values, 0.5),
    high: percentile(values, 0.85),
    sampleSize: values.length,
    excludedCount,
    bestListing,
  };
}

async function main() {
  requireCredentials();

  const onlyCodes = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const defaultCodes = [...data.jp.list, ...data.extra.list].filter((code) => data.sets[code]?.nameEn);
  const codes = onlyCodes.length ? onlyCodes : defaultCodes;
  const token = (await getApplicationToken()).access_token;

  for (const code of codes) {
    const set = data.sets[code];
    if (!set) continue;
    const query = buildQuery(code, set);
    const result = await searchActiveListings(token, query);
    const market = analyzeItems(result.itemSummaries || [], code);
    set.boxMarket = set.boxMarket || {};
    set.boxMarket.en = set.boxMarket.en || {};
    set.boxMarket.en.ebayActive = {
      source: "eBay Browse API item_summary/search",
      query,
      updated: new Date().toISOString().slice(0, 10),
      marketplaceId,
      ...market,
    };
    console.log(
      `${code} EN: ${market.currency} low=${market.low} mid=${market.middle} high=${market.high} kept=${market.sampleSize} excluded=${market.excludedCount}`,
    );
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log("English box prices updated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
