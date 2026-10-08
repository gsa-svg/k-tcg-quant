#!/usr/bin/env node
// 예약판매(발매 전) 박스 호가 수집 — 2026-10-08 신설.
// 소유자 지시: "eb05랑 op18도 가격 미리 수집하자, 출시 후 합치면 되니께" — 시계열은 소급이 안 되니 발매 전부터 쌓는다.
//
// 발매 전 세트는 data/onepiece-packs.json 에 없어서 update-ebay-pack-prices(-english) 가 보지 않는다.
// box-sold-urls.js 의 UPCOMING 가운데 아직 발매 전인 세트(발매일 > 오늘)의 일판·영문판 미개봉 박스 매물을
// Browse API 로 하루 한 번 받아 data/preorder-series.json 에 append-only 로 쌓는다(같은 날은 덮어쓴다).
//
// 같은 잣대: 검색어 구성·제목 필터·판매자/지역 제외·한도 100·배송비 포함 총액·15/50/85 백분위·
// 최저 매물 조건(새 제품, 중앙값 50% 이상)까지 update-ebay-pack-prices 와 동일하게 둔다 — 발매 뒤 세트가
// packs.json 에 들어가면 이 시계열이 진행매물 시계열의 앞부분으로 이어져야 하기 때문이다.
// 실거래(sold)는 box-sold 러너가 2026-09-30 부터 이미 같은 세트를 받고 있다(box-sold-series.json).
//
// 호출: 세트 × 판본당 1콜(현재 2세트 → 4콜/일). 잔여 쿼터 10 미만이면 건너뛴다(exit 0) — 필요한 건 4콜뿐이다.
// Run: node tools/collect-preorder-prices.js
const fs = require("node:fs");
const path = require("node:path");
const { token, remaining } = require("./ebay-budget");
const { UPCOMING } = require("./box-sold-urls");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle, isEnglishSealedBoosterBoxTitle } = require("./ebay-listing-filters");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "preorder-series.json");
const PACKS = path.join(ROOT, "data", "onepiece-packs.json");
const TODAY = new Date().toISOString().slice(0, 10);
const searchLimit = "100";   // 가드 D14 — 진행매물 수집기와 같은 한도
const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

function buildQuery(code, nameEn, ed) {
  const boxType = code.startsWith("PRB") ? "Premium Booster Box" : code.startsWith("EB") ? "Extra Booster Box" : "Booster Box";
  return ["One Piece Card Game", code, nameEn, boxType, ed === "jp" ? "Japanese" : "English", "sealed"].join(" ");
}
async function search(tok, q) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", searchLimit);
  u.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) throw new Error(`Browse search failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
  return (await r.json()).itemSummaries || [];
}
const pct = (sorted, ratio) => (sorted.length ? Number(sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)))].toFixed(2)) : null);
const total = (it) => { const p = Number(it.price?.value); if (!Number.isFinite(p)) return null; const s = Number(it.shippingOptions?.[0]?.shippingCost?.value || 0); return Number((p + (Number.isFinite(s) ? s : 0)).toFixed(2)); };

function aggregate(items, code, ed) {
  const titleOk = ed === "jp" ? isJapaneseSealedBoosterBoxTitle : isEnglishSealedBoosterBoxTitle;
  const kept = [];
  let excluded = 0;
  for (const it of items) {
    if (!titleOk(it.title || "", code)) continue;
    if (isExcludedEbaySellerOrLocation(it)) { excluded += 1; continue; }
    const t = total(it);
    if (t == null) continue;
    kept.push({ total: t, currency: it.price.currency, url: it.itemWebUrl || "", title: it.title || "", condition: it.condition || "" });
  }
  const byCur = {};
  for (const k of kept) (byCur[k.currency] = byCur[k.currency] || []).push(k);
  const currency = Object.entries(byCur).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || "USD";
  const sel = byCur[currency] || [];
  const values = sel.map((k) => k.total).sort((a, b) => a - b);
  const median = pct(values, 0.5);
  const best = sel.filter((k) => k.url && /new/i.test(k.condition) && (median == null || k.total >= median * 0.5)).sort((a, b) => a.total - b.total)[0] || null;
  return {
    d: TODAY, currency, n: values.length, excluded,
    low: pct(values, 0.15), median, high: pct(values, 0.85),
    best: best ? { total: best.total, url: best.url, title: best.title.slice(0, 120) } : null,
  };
}

(async () => {
  const packs = JSON.parse(fs.readFileSync(PACKS, "utf8"));
  const targets = UPCOMING.filter((u) => u.release > TODAY && !packs.sets?.[u.code]);
  if (!targets.length) { console.log(JSON.stringify({ status: "skip", why: "발매 전 세트 없음" })); return; }
  const left = await remaining();
  if (left != null && left < 10) { console.log(JSON.stringify({ status: "skip", why: "쿼터 부족", remaining: left })); return; }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { sets: {} };
  const tok = await token();
  const log = {};
  for (const u of targets) {
    const set = (prev.sets[u.code] = prev.sets[u.code] || { nameEn: u.nameEn, release: u.release, jp: [], en: [] });
    set.nameEn = u.nameEn; set.release = u.release;
    for (const ed of ["jp", "en"]) {
      const items = await search(tok, buildQuery(u.code, u.nameEn, ed));
      const point = aggregate(items, u.code, ed);
      set[ed] = (set[ed] || []).filter((p) => p.d !== TODAY).concat([point]).sort((a, b) => a.d.localeCompare(b.d));
      log[`${u.code}/${ed}`] = { raw: items.length, n: point.n, median: point.median, best: point.best?.total ?? null };
    }
  }
  const out = {
    note: "Asking prices for sealed booster boxes of sets that have not been released yet (pre-orders), from eBay fixed-price listings: one point per day per edition, shipping included, 15/50/85 percentiles over listings that pass the same title/seller filters as the main active-listing collector. 'best' is the cheapest new-condition listing at or above half the median. These are asking prices, not sales; completed pre-order sales live in box-sold-series.json. After release the set moves into onepiece-packs.json and this series becomes the early part of its active-listing history.",
    updated: TODAY,
    sets: prev.sets,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", date: TODAY, sets: targets.map((t) => t.code), ...log }));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
