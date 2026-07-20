#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");

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
  return isExcludedEbaySellerOrLocation(item);
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
  // 프리미엄(망가/수퍼패러렐) 티어 신호 — "Super Rare"(SR 레어도 표기)는 프리미엄이 아님
  const premiumTitle = /manga|comic|super\s*parall|super\s*alt/i;
  if (/signature|stamped|stamp/i.test(name)) return /signature|signed|stamped|stamp/i.test(title);
  // Red(레드망가 등) 변형: 제목에 red 명시 필수 — 일반 망가가 레드 행에 붙는 사고 방지 (2026-07-08 OP13-118 실사고)
  if (/\bred\b/i.test(name)) return /\bred\b/i.test(title) && premiumTitle.test(title);
  if (/manga|comic|\bsuper\b/i.test(name)) return premiumTitle.test(title);
  // SP는 별도 변형 — 일반 parallel 매물이 섞이지 않게 SP/special 명시 요구 + 프리미엄 배제 (speci4l = leetspeak 회피 방지)
  if (/\bsp\b|speci[a4]l/i.test(name)) return /\bsp\b|speci[a4]l/i.test(title) && !premiumTitle.test(title);
  // 일반 패러렐/알트아트 — 프리미엄·SP·Special 매물이 저가 행에 붙지 않게 배제
  if (/parallel|alternate/i.test(name))
    return /parallel|alternate|alt\s*art|leader\s*parallel|paralle/i.test(title) && !premiumTitle.test(title) && !/\bsp\b|speci[a4]l|red\s*text/i.test(title);
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

// 매물 집계 신호 — 실거래(sold) API가 Limited Release라 못 쓰는 대신,
// "재등록률·매물 나이·협상 허용률"로 판매 부진을 간접 측정한다.
//  - relistRate: itemCreationDate ≠ itemOriginDate → 안 팔려서 다시 올린 매물 비율
//  - medianAgeDays: 현재 매물이 며칠째 걸려 있는지(중앙값) → 회전율
//  - bestOfferRate: 가격 협상을 받는 매물 비율 → 정가에 못 파는 정도
//  - countryMix: 공급 출처 구성(제외 대상 포함 전 원본 기준은 별도 excludedCount)
function supplySignals(items) {
  const now = Date.now();
  const ages = [], relist = [], offers = [], country = {};
  for (const it of items) {
    const raw = it.raw || {};
    if (raw.itemCreationDate) {
      const d = Date.parse(raw.itemCreationDate);
      if (Number.isFinite(d)) ages.push(Math.max(0, Math.round((now - d) / 86400000)));
      if (raw.itemOriginDate) {
        const o = Date.parse(raw.itemOriginDate);
        // 최초 등록일과 현재 등록일이 하루 넘게 차이나면 재등록으로 본다
        if (Number.isFinite(o)) relist.push(Math.abs(d - o) > 86400000 ? 1 : 0);
      }
    }
    if (Array.isArray(raw.buyingOptions)) offers.push(raw.buyingOptions.includes("BEST_OFFER") ? 1 : 0);
    const c = raw.itemLocation && raw.itemLocation.country;
    if (c) country[c] = (country[c] || 0) + 1;
  }
  const med = (a) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
  const rate = (a) => (a.length ? Number((a.reduce((x, y) => x + y, 0) / a.length * 100).toFixed(1)) : null);
  return {
    medianAgeDays: med(ages),
    relistRate: rate(relist),      // % — 높을수록 안 팔리고 재등록 중
    bestOfferRate: rate(offers),   // % — 높을수록 정가에 못 파는 중
    // ── 시장 구조 신호(전부 Browse 응답에 이미 오던 값. 소급 불가라 지금부터 축적)
    uniqueSellers: (() => { const s = new Set(items.map((i) => (i.raw && i.raw.seller || {}).username).filter(Boolean)); return s.size || null; })(),
    top3SellerShare: (() => {
      const c = {}; items.forEach((i) => { const u = (i.raw && i.raw.seller || {}).username; if (u) c[u] = (c[u] || 0) + 1; });
      const v = Object.values(c).sort((a, b) => b - a); if (!v.length) return null;
      const n = v.reduce((a, b) => a + b, 0);
      return Number((v.slice(0, 3).reduce((a, b) => a + b, 0) / n * 100).toFixed(1)); // % — 높을수록 소수 셀러가 매물 장악
    })(),
    discountRate: items.length ? Number((items.filter((i) => i.raw && i.raw.marketingPrice).length / items.length * 100).toFixed(1)) : null, // % 할인표시 매물 = 셀러가 내리는 중
    medianSellerFeedback: (() => {
      const a = items.map((i) => (i.raw && i.raw.seller || {}).feedbackScore).filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    })(),
    countryMix: country,
    sampleForSignals: items.length,
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
    // raw(원본 아이템)는 매물 나이·재등록률 계산용. 저장되는 bestListing에서는 아래에서 제거한다.
    if (listing) kept.push({ ...listing, raw: item });
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
    // raw 는 신호 계산 전용이므로 저장 전에 떼어낸다(데이터 파일 비대화 방지)
    bestListing: selected[0] ? (({ raw, ...rest }) => rest)(selected[0]) : null,
    // 카드 단위 수요 대용 신호 — 박스와 동일 기준(매물 나이·재등록률·협상허용률·셀러집중도)
    supplySignals: supplySignals(selected),
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
    // 안전장치: 최저 매물이 판매완료(Sold) 중간값의 35% 미만이면 변형 오매칭 의심 → 버튼 숨김(검색링크로 폴백)
    if (market?.bestListing && card.psa10Ebay?.soldBased && card.psa10Ebay.middle != null) {
      const fx = data.fx || {};
      const toUsd = (v, cur) =>
        cur === "USD" ? v : cur === "KRW" ? v / (fx.usdKrw || 1388.2) : cur === "JPY" ? (v * (fx.jpyKrw || 9.1)) / (fx.usdKrw || 1388.2) : null;
      const bestUsd = toUsd(market.bestListing.total, market.currency);
      const soldUsd = toUsd(card.psa10Ebay.middle, card.psa10Ebay.currency || "KRW");
      if (bestUsd != null && soldUsd != null && bestUsd < soldUsd * 0.35) {
        console.log(`  sanity-drop ${code} ${card.number}: best $${bestUsd.toFixed(0)} < 35% of sold-mid $${soldUsd.toFixed(0)}`);
        market.bestListing = null;
        market.sampleSize = 0;
      }
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
