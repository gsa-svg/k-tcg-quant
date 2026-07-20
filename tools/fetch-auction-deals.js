// 종료 임박 경매 수집 — 3시간 이내 종료되는 원피스 경매 중 상위 5건.
//
// 왜: 입찰은 "실제 구매 의사"의 직접 증거다. 고정가 호가는 부풀려져 있지만 경매에 붙은 입찰은
//     진짜 수요다. 종료 임박 + 입찰 경쟁은 방문자에게도 재방문 이유가 된다.
//
// 순위: 입찰 수 ↓ → 셀러 피드백 수 ↓ → 종료 임박 순.
//   입찰이 최우선인 이유: 경쟁이 붙은 매물이 실제로 볼 가치가 있다. 셀러 규모는 신뢰도 보조 지표.
//
// ⚠️ 우리가 시세 계산에서 제외한 셀러/지역은 여기서도 제외한다.
//    시세에선 못 믿는다고 걸러놓고 핫딜로 띄우면 앞뒤가 맞지 않는다.
// ⚠️ 경매는 시시각각 끝난다. 생성 시각(generatedAt)을 반드시 함께 노출해 만료 오해를 막을 것.
//
// Run: node tools/fetch-auction-deals.js
const fs = require("fs");
const path = require("path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");

const ROOT = path.join(__dirname, "..");
const outPath = path.join(ROOT, "data", "auction-deals.json");
const envPath = path.join(ROOT, ".env");

const WINDOW_MIN = 180; // 3시간
const MAX_ITEMS = 5;

function loadEnv(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .reduce((v, l) => { const i = l.indexOf("="); if (i > -1) v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); return v; }, {});
}
const env = { ...loadEnv(envPath), ...process.env };
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";

// 명백한 비대상 매물 배제 — 커스텀/프록시/디지털/복제품/주변용품
const JUNK = /proxy|custom|orica|digital|reprint\s*card|fan\s*made|not\s*official|sticker|playmat|sleeve|binder|deck\s*box|empty|damaged|water|bent/i;
// 원피스 IP지만 OPTCG(원피스 카드게임)가 아닌 다른 반다이 상품들 — 방문자에게 무의미하므로 제외.
// 실수집에서 "OnePy Berry Match"가 섞여 들어와 확인된 케이스.
const NOT_OPTCG = /berry\s*match|onepy|one\s*py|wafer|carddass\s*(?!.*card\s*game)|gumi|shokugan|ichiban\s*kuji|figure|keychain|poster|manga\s*volume|dvd|blu-?ray/i;
const ONEPIECE = /one\s*piece/i;

async function token() {
  const auth = Buffer.from(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`).toString("base64");
  const r = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "client_credentials", scope: "https://api.ebay.com/oauth/api_scope" }),
  });
  if (!r.ok) throw new Error(`OAuth ${r.status}`);
  return (await r.json()).access_token;
}

async function search(tok, q) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "200");
  u.searchParams.set("filter", "buyingOptions:{AUCTION}");
  u.searchParams.set("sort", "endingSoonest");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) throw new Error(`Browse ${r.status}`);
  return (await r.json()).itemSummaries || [];
}

function categorize(title) {
  if (/booster\s*box|display\s*box|carton/i.test(title)) return "box";
  if (/booster\s*pack|\d+\s*pack|sealed\s*pack/i.test(title)) return "pack";
  return "card";
}

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("Missing eBay credentials");
  const tok = await token();
  const now = Date.now();
  const seen = new Set();
  const pool = [];

  for (const q of ["One Piece Card Game", "One Piece Card Game Japanese booster"]) {
    for (const it of await search(tok, q)) {
      const id = it.itemId;
      if (!id || seen.has(id)) continue;
      const title = it.title || "";
      if (!ONEPIECE.test(title) || JUNK.test(title) || NOT_OPTCG.test(title)) continue;
      if (isExcludedEbaySellerOrLocation(it)) continue;      // 시세에서 제외한 셀러/지역은 여기서도 제외
      if (!it.itemEndDate) continue;
      const minsLeft = Math.round((Date.parse(it.itemEndDate) - now) / 60000);
      if (!(minsLeft > 0 && minsLeft <= WINDOW_MIN)) continue;
      seen.add(id);
      const bid = Number(it.currentBidPrice?.value);
      const ship = Number(it.shippingOptions?.[0]?.shippingCost?.value || 0);
      pool.push({
        id,
        title: title.slice(0, 110),
        url: it.itemWebUrl,
        kind: categorize(title),
        bidCount: Number.isFinite(it.bidCount) ? it.bidCount : 0,
        contested: Number.isFinite(it.bidCount) && it.bidCount > 0, // 입찰 있음 = 경쟁 중 / 없음 = 아직 입찰 없음
        currentBid: Number.isFinite(bid) ? bid : null,
        shipping: Number.isFinite(ship) ? ship : 0,
        currency: it.currentBidPrice?.currency || it.price?.currency || "USD",
        endsAt: it.itemEndDate,
        minutesLeft: minsLeft,
        country: it.itemLocation?.country || "",
        sellerFeedback: it.seller?.feedbackScore ?? null,
        image: it.thumbnailImages?.[0]?.imageUrl || it.image?.imageUrl || null,
      });
    }
  }

  // 입찰 경쟁 > 셀러 규모 > 임박 순
  pool.sort((a, b) =>
    (b.bidCount - a.bidCount) ||
    ((b.sellerFeedback ?? 0) - (a.sellerFeedback ?? 0)) ||
    (a.minutesLeft - b.minutesLeft));

  const out = {
    generatedAt: new Date().toISOString(),
    windowMinutes: WINDOW_MIN,
    note: "Live eBay auctions ending within 3 hours. Ranked by active bids, then seller size, then time left. Sellers and locations excluded from our price data are excluded here too. Auctions end continuously — always check the listing for current status.",
    candidates: pool.length,
    items: pool.slice(0, MAX_ITEMS),
  };
  fs.writeFileSync(outPath, JSON.stringify(out, null, 1) + "\n", "utf8");

  // ── 경매 시장 통계 일자별 축적 (표시와 별개. 소급 불가하므로 지금부터 쌓는다)
  //    입찰은 실거래에 가장 가까운 수요 증거다. sold API 없이 수요 강도를 재는 최선의 지표.
  const statsPath = path.join(ROOT, "data", "auction-stats.json");
  let stats;
  try { stats = JSON.parse(fs.readFileSync(statsPath, "utf8")); } catch { stats = { note: "", points: [] }; }
  const today = new Date().toISOString().slice(0, 10);
  const contested = pool.filter((p) => p.bidCount > 0);
  const bids = pool.map((p) => p.bidCount);
  const med = (a) => { if (!a.length) return null; const x = [...a].sort((m, n) => m - n); const i = Math.floor(x.length / 2); return x.length % 2 ? x[i] : Math.round((x[i - 1] + x[i]) / 2); };
  const point = {
    d: today,
    endingSoon: pool.length,                     // 3시간 내 종료 경매 수
    contested: contested.length,                 // 그중 입찰이 붙은 건수
    contestedPct: pool.length ? Number((contested.length / pool.length * 100).toFixed(1)) : null,
    avgBids: pool.length ? Number((bids.reduce((a, b) => a + b, 0) / pool.length).toFixed(2)) : null,
    maxBids: pool.length ? Math.max(...bids) : null,
    medianBidPrice: med(contested.map((p) => p.currentBid).filter(Number.isFinite)),
    byKind: pool.reduce((a, p) => { a[p.kind] = (a[p.kind] || 0) + 1; return a; }, {}),
  };
  stats.note = "Daily snapshot of One Piece auctions ending within 3 hours: how many are running, how many attracted bids, and the median current bid. Bids are the closest available evidence of real buyer intent — eBay does not expose completed-sale data at this access tier, so these are live bids, not final sale prices.";
  stats.updated = today;
  stats.points = [...stats.points.filter((p) => p.d !== today), point].sort((a, b) => a.d.localeCompare(b.d)).slice(-365);
  fs.writeFileSync(statsPath, JSON.stringify(stats, null, 1) + "\n", "utf8");

  console.log(JSON.stringify({ candidates: pool.length, kept: out.items.length, contested: contested.length, avgBids: point.avgBids }));
})();
