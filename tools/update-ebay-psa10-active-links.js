#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const envPath = path.join(projectRoot, ".env");

const excludedLocationCountries = new Set(["CN", "HK", "MO"]);
const excludedSellerPattern = /(china|chinese|hongkong|hong kong|shenzhen|guangzhou|shanghai|beijing|\bcn\b|\bhk\b)/i;

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
const searchLimit = env.EBAY_PSA_ACTIVE_SEARCH_LIMIT || env.EBAY_SEARCH_LIMIT || "100";

function requireCredentials() {
  if (!clientId || !clientSecret) {
    throw new Error("Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. Put the rotated Production keyset in .env.");
  }
}

function normalizeNumber(number, setCode) {
  const raw = (number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  return raw;
}

function buildQuery(setCode, card) {
  const number = normalizeNumber(card.number, setCode);
  return ["One Piece Card Game", number, card.name, "PSA 10", "Japanese"].filter(Boolean).join(" ");
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
  const country = item.itemLocation?.country;
  const sellerName = item.seller?.username || "";
  const locationText = [item.itemLocation?.city, item.itemLocation?.stateOrProvince, item.itemLocation?.postalCode]
    .filter(Boolean)
    .join(" ");
  return excludedLocationCountries.has(country) || excludedSellerPattern.test(sellerName) || excludedSellerPattern.test(locationText);
}

function compact(value) {
  return String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function hasNumber(title, number) {
  if (!number) return true;
  const normalizedTitle = compact(title);
  const normalizedNumber = compact(number);
  if (normalizedTitle.includes(normalizedNumber)) return true;
  const match = normalizedNumber.match(/^(OP|EB|PRB|ST)(\d{1,2})(\d{3})$/);
  if (!match) return false;
  return normalizedTitle.includes(`${match[1]}${Number(match[2])}${match[3]}`);
}

function hasConflictingCardNumber(title, expectedNumber) {
  const expected = compact(expectedNumber);
  const found = title.match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(compact).some((number) => number !== expected);
}

function hasVariantSignal(title, card) {
  const name = `${card.name || ""} ${card.rarity || ""}`;
  if (/signature|stamped|stamp/i.test(name)) return /signature|signed|stamped|stamp/i.test(title);
  if (/manga|comic/i.test(name)) return /manga|comic/i.test(title);
  if (/\bsp\b|special/i.test(name)) return /\bsp\b|special|parallel/i.test(title);
  if (/parallel|alternate/i.test(name)) return /parallel|alternate|alt\s*art|leader\s*parallel|paralle/i.test(title);
  return true;
}

function isPsa10JapaneseCard(item, setCode, card) {
  const title = item.title || "";
  const number = normalizeNumber(card.number, setCode);
  const hasJapaneseSignal = /japanese|japan|jpn/i.test(title) || item.itemLocation?.country === "JP";
  const positive = [/one piece/i, /psa\s*10|gem\s*mint\s*10/i];
  const negative = [
    /psa\s*[1-9]\b(?!0)|psa\s*9|psa\s*8|bgs|cgc|ars|raw|ungraded|proxy|digital/i,
    /english|\beng\b|\ben\b|korean|chinese|simplified/i,
    /lot of|bundle|repack|booster|box|case/i,
  ];
  return (
    positive.every((pattern) => pattern.test(title)) &&
    hasJapaneseSignal &&
    !negative.some((pattern) => pattern.test(title)) &&
    hasNumber(title, number) &&
    !hasConflictingCardNumber(title, number) &&
    hasVariantSignal(title, card)
  );
}

function listingSnapshot(item) {
  const price = Number(item.price?.value);
  const shipping = Number(item.shippingOptions?.[0]?.shippingCost?.value || 0);
  if (!Number.isFinite(price) || !item.itemWebUrl) return null;
  return {
    title: item.title || "",
    url: item.itemWebUrl,
    price,
    shipping: Number.isFinite(shipping) ? shipping : 0,
    total: Number((price + (Number.isFinite(shipping) ? shipping : 0)).toFixed(2)),
    currency: item.price.currency,
    country: item.itemLocation?.country || "",
    seller: item.seller?.username || "",
    condition: item.condition || "",
  };
}

function analyzeItems(items, setCode, card) {
  const kept = [];
  let excludedCount = 0;
  for (const item of items) {
    if (!isPsa10JapaneseCard(item, setCode, card)) continue;
    if (isExcludedSeller(item)) {
      excludedCount += 1;
      continue;
    }
    const listing = listingSnapshot(item);
    if (listing) kept.push(listing);
  }
  const currency = Object.entries(
    kept.reduce((acc, item) => {
      acc[item.currency] = (acc[item.currency] || 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1])[0]?.[0] || "USD";
  const selected = kept.filter((item) => item.currency === currency).sort((a, b) => a.total - b.total);
  return {
    source: "eBay Browse API item_summary/search",
    updated: new Date().toISOString().slice(0, 10),
    marketplaceId,
    currency,
    sampleSize: selected.length,
    excludedCount,
    bestListing: selected[0] || null,
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
  const token = (await getApplicationToken()).access_token;
  let updated = 0;
  let empty = 0;

  for (const { code, card } of targetCards(data, requestedCodes)) {
    const number = normalizeNumber(card.number, code);
    const queries = [
      buildQuery(code, card),
      ["One Piece", number, "PSA 10", "Japanese"].filter(Boolean).join(" "),
      ["One Piece", number, card.name, "PSA 10"].filter(Boolean).join(" "),
    ];
    let query = queries[0];
    let market = null;
    for (const candidateQuery of queries) {
      const result = await searchActiveListings(token, candidateQuery);
      market = analyzeItems(result.itemSummaries || [], code, card);
      query = candidateQuery;
      if (market.bestListing) break;
    }
    if (market.bestListing) {
      card.psa10Active = { ...market, query };
      updated += 1;
    } else {
      delete card.psa10Active;
      empty += 1;
    }
    console.log(`${code} #${card.rank} ${card.number || "-"}: active=${market.sampleSize}`);
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`PSA10 active links updated=${updated} empty=${empty}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
