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
const searchLimit = env.EBAY_PSA_SEARCH_LIMIT || env.EBAY_SEARCH_LIMIT || "50";

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
  return (
    excludedLocationCountries.has(country) ||
    excludedSellerPattern.test(sellerName) ||
    excludedSellerPattern.test(locationText)
  );
}

function hasNumber(title, number) {
  if (!number) return true;
  const compact = number.replace("-", "");
  const spaced = number.replace("-", "[-\\s]?");
  return new RegExp(`\\b${spaced}\\b`, "i").test(title) || new RegExp(`\\b${compact}\\b`, "i").test(title);
}

function isPsa10JapaneseCard(item, setCode, card) {
  const title = item.title || "";
  const number = normalizeNumber(card.number, setCode);
  const positive = [/one piece/i, /psa\s*10|gem\s*mint\s*10/i, /japanese|japan|jpn/i];
  const negative = [
    /psa\s*[1-9]\b(?!0)|psa\s*9|psa\s*8|bgs|cgc|ars|raw|ungraded|proxy|digital/i,
    /english|korean|chinese|simplified/i,
    /lot of|bundle|repack|booster|box|case/i,
  ];

  return positive.every((pattern) => pattern.test(title)) && !negative.some((pattern) => pattern.test(title)) && hasNumber(title, number);
}

function percentile(sortedValues, ratio) {
  if (!sortedValues.length) return null;
  const index = Math.min(sortedValues.length - 1, Math.max(0, Math.round((sortedValues.length - 1) * ratio)));
  return Number(sortedValues[index].toFixed(2));
}

function analyzeItems(items, setCode, card) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const value = Number(item.price?.value);
    const currency = item.price?.currency;
    if (!Number.isFinite(value) || !currency) continue;
    if (!isPsa10JapaneseCard(item, setCode, card)) continue;
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
  const values = (grouped[currency] || []).sort((a, b) => a - b);

  return {
    currency,
    low: percentile(values, 0.15),
    middle: percentile(values, 0.5),
    high: percentile(values, 0.85),
    sampleSize: values.length,
    excludedCount,
  };
}

function targetCards(data, requestedCodes) {
  const codes = requestedCodes.length
    ? requestedCodes
    : [...data.jp.list, ...data.extra.list].filter((code) => data.sets[code]?.cards?.length);
  return codes.flatMap((code) =>
    (data.sets[code]?.cards || [])
      .filter((card) => card.psa10Usd == null)
      .map((card) => ({ code, card })),
  );
}

async function main() {
  requireCredentials();

  const requestedCodes = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const token = (await getApplicationToken()).access_token;
  const targets = targetCards(data, requestedCodes);
  let updated = 0;
  let empty = 0;

  for (const { code, card } of targets) {
    const query = buildQuery(code, card);
    const result = await searchActiveListings(token, query);
    const market = analyzeItems(result.itemSummaries || [], code, card);

    if (market.sampleSize > 0) {
      card.psa10Ebay = {
        source: "eBay Browse API item_summary/search",
        query,
        updated: new Date().toISOString().slice(0, 10),
        marketplaceId,
        ...market,
      };
      updated += 1;
    } else {
      delete card.psa10Ebay;
      empty += 1;
    }

    console.log(
      `${code} #${card.rank} ${card.number || "-"}: kept=${market.sampleSize} low=${market.low} mid=${market.middle} high=${market.high}`,
    );
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`PSA10 eBay updated=${updated} empty=${empty}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
