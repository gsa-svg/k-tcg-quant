#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { percentile, removePriceOutliers } = require("./price-outliers");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const envPath = path.join(projectRoot, ".env");

const excludedLocationCountries = new Set(["CN", "HK", "MO"]);
const excludedSellerPattern = /(china|chinese|hongkong|hong kong|shenzhen|guangzhou|shanghai|beijing|\bcn\b|\bhk\b)/i;
const minimumSampleSize = 1;

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
const searchLimit = env.EBAY_JAPANESE_NM_SEARCH_LIMIT || env.EBAY_SEARCH_LIMIT || "50";

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
  const setSignal = /^PRB-|^EB-/.test(setCode) ? setCode : "";
  return ["One Piece", number, card.name, setSignal, "Japanese"].filter(Boolean).join(" ");
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
  if (!number || number === "-") return false;
  const compact = number.replace("-", "");
  const spaced = number.replace("-", "[-\\s]?");
  return new RegExp(`\\b${spaced}\\b`, "i").test(title) || new RegExp(`\\b${compact}\\b`, "i").test(title);
}

function normalizeTitleNumber(number) {
  return (number || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function hasConflictingCardNumber(title, expectedNumber) {
  const expected = normalizeTitleNumber(expectedNumber);
  const found = title.match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(normalizeTitleNumber).some((number) => number !== expected);
}

function nameTokens(card) {
  return (card.name || "")
    .replace(/\bOP\d{2}\s*\d{3}\b/gi, "")
    .replace(/\bEB\d{2}\s*\d{3}\b/gi, "")
    .replace(/\bST\d{2}\s*\d{3}\b/gi, "")
    .replace(/\b\d{3}\b/g, "")
    .replace(/\bmanga|comic|parallel|alternate|alt|art|special|sp|wanted|poster\b/gi, "")
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3)
    .slice(0, 3);
}

function hasVariantSignal(title, card) {
  const target = `${card.name || ""} ${card.rarity || ""}`;
  if (/manga|comic/i.test(target)) return /manga|comic/i.test(title);
  if (/\bsp\b|special/i.test(target)) return /\bsp\b|special|parallel/i.test(title);
  if (/parallel|alternate/i.test(target)) return /parallel|alternate|alt\s*art|\baa\b/i.test(title);
  return true;
}

function isJapaneseRawNmCard(item, setCode, card) {
  const title = item.title || "";
  const condition = item.condition || "";
  const number = normalizeNumber(card.number, setCode);
  const hasJapaneseSignal =
    /japanese|japan|\bjpn\b|\bjp\b/i.test(title) ||
    /PRB\s*-?\s*0?1|PRB01|the best/i.test(title) ||
    /^PRB-/.test(setCode);
  const positive = [/one piece/i];
  const negative = [
    /psa|bgs|cgc|ars|sgc|graded|gem\s*mint|slab/i,
    /english|\beng\b|\ben\b|korean|chinese|simplified/i,
    /proxy|digital|custom|metal|orica|case only|stand|display/i,
    /lot of|bundle|playset|complete set|booster|box|case|pack/i,
  ];
  const tokens = nameTokens(card);
  const hasName = tokens.length === 0 || tokens.every((token) => new RegExp(`\\b${token}\\b`, "i").test(title));

  return (
    positive.every((pattern) => pattern.test(title)) &&
    hasJapaneseSignal &&
    !negative.some((pattern) => pattern.test(title)) &&
    !/graded/i.test(condition) &&
    hasNumber(title, number) &&
    !hasConflictingCardNumber(title, number) &&
    hasName &&
    hasVariantSignal(title, card)
  );
}

function analyzeItems(items, setCode, card) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const value = Number(item.price?.value);
    const currency = item.price?.currency;
    if (!Number.isFinite(value) || !currency) continue;
    if (!isJapaneseRawNmCard(item, setCode, card)) continue;
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
  const { values, outlierCount } = removePriceOutliers(rawValues);
  const referenceFloor = currency === "USD" && Number.isFinite(card.priceUsd) ? card.priceUsd * 0.25 : null;
  const qualityFailed =
    values.length < minimumSampleSize ||
    (referenceFloor != null && values.length > 0 && percentile(values, 0.5) < referenceFloor);

  return {
    currency,
    low: qualityFailed ? null : percentile(values, 0.15),
    middle: qualityFailed ? null : percentile(values, 0.5),
    high: qualityFailed ? null : percentile(values, 0.85),
    sampleSize: qualityFailed ? 0 : values.length,
    excludedCount: excludedCount + outlierCount + (qualityFailed ? values.length : 0),
    outlierCount,
  };
}

function appendHistory(existing, snapshot) {
  const cutoff = new Date(snapshot.date);
  cutoff.setDate(cutoff.getDate() - 90);
  const history = Array.isArray(existing) ? existing.filter((row) => new Date(row.date) >= cutoff) : [];
  const withoutToday = history.filter((row) => row.date !== snapshot.date);
  return [...withoutToday, snapshot].sort((a, b) => a.date.localeCompare(b.date));
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
  const targets = targetCards(data, requestedCodes);
  let updated = 0;
  let empty = 0;
  const today = new Date().toISOString().slice(0, 10);

  for (const { code, card } of targets) {
    const query = buildQuery(code, card);
    const result = await searchActiveListings(token, query);
    const market = analyzeItems(result.itemSummaries || [], code, card);

    if (market.sampleSize > 0) {
      const previousHistory = card.japaneseNmEbay?.history;
      card.japaneseNmEbay = {
        source: "eBay Browse API item_summary/search",
        query,
        updated: today,
        marketplaceId,
        soldBased: false,
        ...market,
        history: appendHistory(previousHistory, {
          date: today,
          currency: market.currency,
          low: market.low,
          middle: market.middle,
          high: market.high,
          sampleSize: market.sampleSize,
        }),
      };
      updated += 1;
    } else {
      empty += 1;
    }

    console.log(
      `${code} #${card.rank} ${card.number || "-"}: kept=${market.sampleSize} low=${market.low} mid=${market.middle} high=${market.high}`,
    );
  }

  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`Japanese NM eBay updated=${updated} empty=${empty}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
