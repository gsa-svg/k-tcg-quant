#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");

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
  return ["One Piece Card Game", code, set.nameEn, boxType, "Japanese", "sealed"].filter(Boolean).join(" ");
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

function isJapaneseSealedBoosterBox(item, code) {
  return isJapaneseSealedBoosterBoxTitle(item.title, code);
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
    uniqueSellers: (() => { const s = new Set(items.map((i) => i.seller && i.seller.username).filter(Boolean)); return s.size || null; })(),
    top3SellerShare: (() => {
      const c = {}; items.forEach((i) => { const u = i.seller && i.seller.username; if (u) c[u] = (c[u] || 0) + 1; });
      const v = Object.values(c).sort((a, b) => b - a); if (!v.length) return null;
      const n = v.reduce((a, b) => a + b, 0);
      return Number((v.slice(0, 3).reduce((a, b) => a + b, 0) / n * 100).toFixed(1)); // % — 높을수록 소수 셀러가 매물 장악
    })(),
    freeShipRate: (() => {
      const f = items.filter((i) => { const s = i.shippingOptions && i.shippingOptions[0]; return s && Number(s.shippingCost && s.shippingCost.value) === 0; }).length;
      return items.length ? Number((f / items.length * 100).toFixed(1)) : null;
    })(),
    discountRate: items.length ? Number((items.filter((i) => i.marketingPrice).length / items.length * 100).toFixed(1)) : null, // % 할인표시 매물 = 셀러가 내리는 중
    medianSellerFeedback: (() => {
      const a = items.map((i) => i.seller && i.seller.feedbackScore).filter(Number.isFinite).sort((x, y) => x - y);
      return a.length ? a[Math.floor(a.length / 2)] : null;
    })(),
    countryMix: country,
    sampleForSignals: items.length,
  };
}

function analyzeItems(items, code) {
  const kept = [];
  let excludedCount = 0;

  for (const item of items) {
    const value = Number(item.price?.value);
    const currency = item.price?.currency;
    if (!Number.isFinite(value) || !currency) continue;
    if (!isJapaneseSealedBoosterBox(item, code)) continue;
    if (isExcludedEbaySellerOrLocation(item)) {
      excludedCount += 1;
      continue;
    }
    kept.push({ value, currency, listing: listingSnapshot(item), itemId: item.itemId || item.legacyItemId || "", raw: item });
  }

  const grouped = kept.reduce((acc, item) => {
    acc[item.currency] = acc[item.currency] || [];
    acc[item.currency].push(item);
    return acc;
  }, {});
  const currency = Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "USD";
  const selectedItems = grouped[currency] || [];
  const values = selectedItems.map((item) => item.value).sort((a, b) => a - b);
  // 최저가 후보: 중간값의 50% 미만은 사기/오기재 의심으로 제외 (정확도 원칙)
  const median = percentile(values, 0.5);
  const bestListing = selectedItems
    .map((item) => item.listing)
    .filter((item) => item?.url && item.currency === currency && (median == null || item.total >= median * 0.5))
    .sort((a, b) => a.total - b.total)[0] || null;

  return {
    currency,
    low: percentile(values, 0.15),
    middle: percentile(values, 0.5),
    high: percentile(values, 0.85),
    sampleSize: values.length,
    excludedCount,
    bestListing,
    // 공급 시계열용 — tools/update-supply-series.js 가 전일과 대조해 신규등록/소멸과 그 가격대를 낸다.
    // id→가격(배송비 포함 총액)으로 저장해야 "어느 가격대의 매물이 빠졌는지"를 알 수 있다.
    itemPrices: selectedItems.reduce((acc, it) => {
      if (it.itemId && it.listing && it.listing.total != null) acc[it.itemId] = it.listing.total;
      return acc;
    }, {}),
    // 수요 대용 지표(집계값만 저장 — 개별 매물 저장은 파일 비대화). 실거래 API가 막혀 있어
    // "안 팔리고 있다"를 간접 증명하는 값들이다. 판매(sold)로 표기하지 말 것.
    supplySignals: supplySignals(selectedItems),
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
    // 필터 전 시장 전체 매물수 — sampleSize(필터후)만으론 시장 규모를 알 수 없다
    market.totalResults = Number.isFinite(result.total) ? result.total : null;
    set.boxMarket = set.boxMarket || {};
    set.boxMarket.jp = set.boxMarket.jp || {};
    set.boxMarket.jp.ebayActive = {
      source: "eBay Browse API item_summary/search",
      query,
      updated: new Date().toISOString().slice(0, 10),
      marketplaceId,
      ...market,
    };
    console.log(
      `${code}: ${market.currency} low=${market.low} mid=${market.middle} high=${market.high} kept=${market.sampleSize} excluded=${market.excludedCount}`,
    );
  }

  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
