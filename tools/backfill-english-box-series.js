#!/usr/bin/env node

// 영문판 박스 시세 이력 소급 구축 — eBay Finding API(판매완료) 주간 중앙값.
// 일본판 boxSeries와 같은 구조로 boxSeriesEn에 basis:"sold" 포인트를 채운다.
// 기존 active 포인트(오늘)는 유지하고 그 앞을 sold 주간값으로 채움. 재실행해도 안전(날짜 중복 대체).
// Run: node tools/backfill-english-box-series.js [CODE ...]

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation, isEnglishSealedBoosterBoxTitle } = require("./ebay-listing-filters");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const envPath = path.join(projectRoot, ".env");
const historyDays = 180;

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

function marketKrw(value, currency, fx) {
  if (!Number.isFinite(value)) return null;
  if (currency === "KRW") return Math.round(value);
  if (currency === "JPY") return Math.round(value * (fx.jpyKrw || 9.1));
  if (currency === "USD") return Math.round(value * (fx.usdKrw || 1388.2));
  return null;
}

function buildQuery(code, set) {
  const boxType = code.startsWith("PRB") ? "Premium Booster Box" : code.startsWith("EB") ? "Extra Booster Box" : "Booster Box";
  return ["One Piece Card Game", code, set.nameEn, boxType, "English", "sealed"].filter(Boolean).join(" ");
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
  url.searchParams.set("paginationInput.entriesPerPage", "100");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
  const text = await res.text();
  if (!res.ok) throw new Error(`Finding API failed (${res.status}): ${text.slice(0, 220)}`);
  const data = JSON.parse(text);
  const ack = data.findCompletedItemsResponse?.[0]?.ack?.[0];
  if (ack !== "Success") throw new Error(`Finding API ack=${ack || "unknown"}: ${text.slice(0, 220)}`);
  return data.findCompletedItemsResponse?.[0]?.searchResult?.[0]?.item || [];
}

// 주 시작일(월요일) ISO 날짜
function weekStart(dateStr) {
  const d = new Date(dateStr);
  const day = (d.getUTCDay() + 6) % 7; // 월=0
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

function median(sorted) {
  if (!sorted.length) return null;
  const m = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
}

async function main() {
  const onlyCodes = process.argv.slice(2);
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const fx = data.fx || {};
  const codes = onlyCodes.length ? onlyCodes : [...data.jp.list, ...data.extra.list].filter((c) => data.sets[c]?.nameEn);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - historyDays);

  for (const code of codes) {
    const set = data.sets[code];
    if (!set) continue;
    let items = [];
    try {
      items = await searchFindingCompleted(buildQuery(code, set));
    } catch (err) {
      console.log(`${code}: Finding 실패 — ${String(err.message).slice(0, 80)}`);
      continue;
    }
    // 제목 필터 + 셀러 필터 + 주간 버킷
    const weeks = {};
    for (const item of items) {
      const title = item.title?.[0] || "";
      if (!isEnglishSealedBoosterBoxTitle(title, code)) continue;
      const seller = { seller: item.sellerInfo?.[0]?.sellerUserName?.[0] || "", itemLocation: { country: item.country?.[0] || "" } };
      if (isExcludedEbaySellerOrLocation(seller)) continue;
      const priceNode = item.sellingStatus?.[0]?.currentPrice?.[0];
      const value = Number(priceNode?.__value__);
      const currency = priceNode?.["@currencyId"];
      const end = item.listingInfo?.[0]?.endTime?.[0];
      if (!Number.isFinite(value) || !currency || !end) continue;
      if (new Date(end) < cutoff) continue;
      const krw = marketKrw(value, currency, fx);
      if (!Number.isFinite(krw)) continue;
      const wk = weekStart(end);
      (weeks[wk] = weeks[wk] || []).push(krw);
    }
    const soldPoints = Object.entries(weeks)
      .map(([d, vals]) => {
        vals.sort((a, b) => a - b);
        return { d, p: Math.round(median(vals)), n: vals.length, basis: "sold" };
      })
      .sort((a, b) => a.d.localeCompare(b.d));

    if (soldPoints.length < 2) {
      console.log(`${code} EN: sold 주간 ${soldPoints.length}개 — 표본 부족, 소급 생략`);
      continue;
    }

    set.boxSeriesEn = set.boxSeriesEn || {};
    const existing = (set.boxSeriesEn.points || []).filter((p) => p.basis === "active");
    const soldDates = new Set(soldPoints.map((p) => p.d));
    const merged = [...soldPoints, ...existing.filter((p) => !soldDates.has(p.d))].sort((a, b) => a.d.localeCompare(b.d));
    set.boxSeriesEn.currency = "KRW";
    set.boxSeriesEn.source = "eBay Sold weekly medians (Finding API) plus eBay Active snapshots";
    set.boxSeriesEn.updated = new Date().toISOString().slice(0, 10);
    set.boxSeriesEn.points = merged;
    console.log(`${code} EN: sold 주간 ${soldPoints.length}개 + active ${existing.length}개 = ${merged.length}포인트 (${merged[0].d} ~ ${merged[merged.length - 1].d})`);
  }

  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log("English box series backfill done.");
}

main().catch((err) => { console.error(err); process.exit(1); });
