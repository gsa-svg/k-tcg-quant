#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");
const { percentile, removePriceOutliers } = require("./price-outliers");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const envPath = path.join(projectRoot, ".env");
const reportPath = path.join(projectRoot, "data", "japanese-nm-sold-audit.json");

const minimumMatchScore = 80;

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
const appId = env.EBAY_APP_ID || env.EBAY_CLIENT_ID;
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
const searchLimit = env.EBAY_JAPANESE_NM_SOLD_SEARCH_LIMIT || "50";
const findingTimeoutMs = Number(env.EBAY_FINDING_TIMEOUT_MS || 8000);

function normalizeNumber(number, setCode) {
  const raw = (number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  return raw;
}

function compact(value) {
  return String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function hasNumber(title, number) {
  if (!number || number === "-") return false;
  return compact(title).includes(compact(number));
}

function hasConflictingCardNumber(title, expectedNumber) {
  const expected = compact(expectedNumber);
  const found = title.match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(compact).some((number) => number !== expected);
}

function nameTokens(card) {
  return (card.name || "")
    .replace(/\b(OP|EB|ST)\d{2}\s*\d{3}\b/gi, "")
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

function scoreSoldNm(item, setCode, card) {
  const title = item.title || "";
  const number = normalizeNumber(card.number, setCode);
  const hasJapaneseSignal =
    /japanese|japan|\bjpn\b|\bjp\b/i.test(title) ||
    /PRB\s*-?\s*0?1|PRB01|the best/i.test(title) ||
    /^PRB-/.test(setCode);
  const hasNegative =
    /psa|bgs|cgc|ars|sgc|graded|gem\s*mint|slab|english|\beng\b|\ben\b|korean|chinese|simplified|proxy|digital|custom|metal|orica|case only|stand|display|lot of|bundle|playset|complete set|booster|box|case|pack/i.test(title);
  const tokens = nameTokens(card);
  const hasName = tokens.length === 0 || tokens.every((token) => new RegExp(`\\b${token}\\b`, "i").test(title));
  const hasExpectedNumber = hasNumber(title, number);
  const hasConflict = hasConflictingCardNumber(title, number);
  const hasVariant = hasVariantSignal(title, card);

  let score = 0;
  if (/one piece/i.test(title)) score += 15;
  if (hasJapaneseSignal) score += 20;
  if (hasExpectedNumber) score += 25;
  if (hasName) score += 15;
  if (hasVariant) score += 20;
  if (hasConflict) score -= 60;
  if (hasNegative) score -= 70;

  return {
    matched: /one piece/i.test(title) && hasJapaneseSignal && !hasNegative && hasExpectedNumber && !hasConflict && hasName && hasVariant && score >= minimumMatchScore,
    score,
  };
}

function buildQuery(setCode, card) {
  const number = normalizeNumber(card.number, setCode);
  const setSignal = /^PRB-|^EB-/.test(setCode) ? setCode : "";
  return ["One Piece", number, card.name, setSignal, "Japanese"].filter(Boolean).join(" ");
}

async function searchFindingCompleted(query) {
  if (!appId) throw new Error("Missing EBAY_APP_ID or EBAY_CLIENT_ID for Finding API.");
  const url = new URL("https://svcs.ebay.com/services/search/FindingService/v1");
  url.searchParams.set("OPERATION-NAME", "findCompletedItems");
  url.searchParams.set("SERVICE-VERSION", "1.13.0");
  url.searchParams.set("SECURITY-APPNAME", appId);
  url.searchParams.set("RESPONSE-DATA-FORMAT", "JSON");
  url.searchParams.set("REST-PAYLOAD", "");
  url.searchParams.set("keywords", query);
  url.searchParams.set("itemFilter(0).name", "SoldItemsOnly");
  url.searchParams.set("itemFilter(0).value", "true");
  url.searchParams.set("paginationInput.entriesPerPage", searchLimit);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), findingTimeoutMs);
  const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  const text = await res.text();
  if (!res.ok) throw new Error(`Finding API failed (${res.status}): ${text.slice(0, 220)}`);
  const data = JSON.parse(text);
  const ack = data.findCompletedItemsResponse?.[0]?.ack?.[0];
  if (ack !== "Success") throw new Error(`Finding API ack=${ack || "unknown"}: ${text.slice(0, 220)}`);
  return data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
}

function isExcludedSoldSeller(item) {
  return isExcludedEbaySellerOrLocation(item);
}

function analyzeSoldItems(items, setCode, card) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const price = item.sellingStatus?.[0]?.currentPrice?.[0];
    const value = Number(price?.__value__);
    const currency = price?.["@currencyId"] || "USD";
    if (!Number.isFinite(value)) continue;
    if (isExcludedSoldSeller(item)) {
      excludedCount += 1;
      continue;
    }
    const match = scoreSoldNm({ title: item.title?.[0] || "" }, setCode, card);
    if (!match.matched) continue;
    kept.push({ value, currency, matchScore: match.score });
  }

  const grouped = kept.reduce((acc, item) => {
    acc[item.currency] = acc[item.currency] || [];
    acc[item.currency].push(item);
    return acc;
  }, {});
  const currency = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "USD";
  const selected = grouped[currency] || [];
  const rawValues = selected.map((item) => item.value).sort((a, b) => a - b);
  const { values, outlierCount } = removePriceOutliers(rawValues);
  const referenceFloor = currency === "USD" && Number.isFinite(card.priceUsd) ? card.priceUsd * 0.25 : null;
  const qualityFailed = values.length < 1 || (referenceFloor != null && percentile(values, 0.5) < referenceFloor);
  const matchScore = selected.length
    ? Number((selected.reduce((sum, item) => sum + item.matchScore, 0) / selected.length).toFixed(1))
    : 0;

  return {
    currency,
    low: qualityFailed ? null : percentile(values, 0.15),
    middle: qualityFailed ? null : percentile(values, 0.5),
    high: qualityFailed ? null : percentile(values, 0.85),
    sampleSize: qualityFailed ? 0 : values.length,
    excludedCount: excludedCount + outlierCount + (qualityFailed ? values.length : 0),
    outlierCount,
    matchScore: qualityFailed ? 0 : matchScore,
    confidence: qualityFailed ? "hidden" : values.length >= 5 ? "A" : values.length >= 2 ? "B" : "C",
  };
}

function appendHistory(existing, snapshot) {
  const cutoff = new Date(snapshot.date);
  cutoff.setDate(cutoff.getDate() - 180);
  const history = Array.isArray(existing) ? existing.filter((row) => new Date(row.date) >= cutoff) : [];
  return [...history.filter((row) => row.date !== snapshot.date), snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

function targets(data, requestedCodes) {
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
  const requestedCodes = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const report = {
    updated: new Date().toISOString(),
    source: "eBay Finding API findCompletedItems",
    marketplaceId,
    updatedCount: 0,
    emptyCount: 0,
    errorCount: 0,
    rows: [],
  };
  let soldEndpointUnavailable = false;

  for (const { code, card } of targets(data, requestedCodes)) {
    if (soldEndpointUnavailable && !process.argv.includes("--continue-on-error")) break;
    const query = buildQuery(code, card);
    try {
      const items = await searchFindingCompleted(query);
      const market = analyzeSoldItems(items, code, card);
      if (market.sampleSize > 0) {
        const previousHistory = card.japaneseNmEbay?.history;
        card.japaneseNmEbay = {
          source: "eBay Finding API findCompletedItems",
          query,
          updated: today,
          marketplaceId,
          soldBased: true,
          ...market,
          history: appendHistory(previousHistory, {
            date: today,
            currency: market.currency,
            low: market.low,
            middle: market.middle,
            high: market.high,
            sampleSize: market.sampleSize,
            matchScore: market.matchScore,
            confidence: market.confidence,
          }),
        };
        report.updatedCount += 1;
      } else {
        report.emptyCount += 1;
      }
      report.rows.push({ code, rank: card.rank, number: card.number, name: card.name, query, sampleSize: market.sampleSize, middle: market.middle, currency: market.currency });
      console.log(`${code} #${card.rank} ${card.number}: sold=${market.sampleSize} mid=${market.middle}`);
    } catch (error) {
      const message = String(error.message || error).slice(0, 300);
      report.errorCount += 1;
      report.rows.push({ code, rank: card.rank, number: card.number, name: card.name, query, error: message });
      if (/Finding API failed \(503\)|aborted|timeout/i.test(message)) {
        soldEndpointUnavailable = true;
        report.endpointUnavailable = true;
      }
      console.log(`${code} #${card.rank} ${card.number}: sold error`);
    }
  }

  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ updated: report.updatedCount, empty: report.emptyCount, errors: report.errorCount }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
