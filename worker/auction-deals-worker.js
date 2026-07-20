/**
 * opboxindex 경매 중계기 (Cloudflare Worker)
 *
 * 왜 필요한가: 우리 사이트는 정적 호스팅(GitHub Pages)이라 스스로 실시간 데이터를 가져올 수 없다.
 * 브라우저에서 eBay API를 직접 부르면 키가 노출되어 누구나 우리 할당량을 훔쳐 쓸 수 있다.
 * 이 중계기가 키를 서버 쪽에 보관하고, 결과만 우리 페이지에 돌려준다.
 *
 * 보호 장치
 *  - 60초 캐시: 방문자가 1000명이어도 eBay 호출은 분당 1회. 할당량 안전.
 *  - CORS 허용 출처를 opboxindex.com 으로 제한 — 남이 우리 중계기를 퍼가지 못하게.
 *  - 토큰도 캐시(2시간 미만) — 매 요청마다 OAuth를 치지 않는다.
 *
 * 필터 원칙 (tools/fetch-auction-deals.js 와 동일하게 유지할 것)
 *  - 시세 계산에서 제외한 지역/셀러는 여기서도 제외. 못 믿는다고 걸러놓고 추천하면 모순.
 *  - OPTCG가 아닌 반다이 상품(OnePy Berry Match 등) 제외.
 *  - 입찰 유무를 구분해 내려보낸다. "경쟁 중"과 "아직 입찰 없음"은 다른 정보다.
 *
 * 설정할 시크릿 (Cloudflare 대시보드에서 직접 입력)
 *  EBAY_CLIENT_ID / EBAY_CLIENT_SECRET
 */

const ALLOWED_ORIGINS = ["https://opboxindex.com", "https://www.opboxindex.com"];
const WINDOW_MIN = 180; // 3시간
const MAX_ITEMS = 5;
const CACHE_SECONDS = 60;

// 제외 지역 — 가품/오배송 신고 이력이 많아 시세 계산에서도 빼는 곳
const EXCLUDED_COUNTRIES = new Set(["CN", "HK"]);
const JUNK = /proxy|custom|orica|digital|reprint\s*card|fan\s*made|not\s*official|sticker|playmat|sleeve|binder|deck\s*box|empty|damaged|water|bent/i;
const NOT_OPTCG = /berry\s*match|onepy|one\s*py|wafer|gumi|shokugan|ichiban\s*kuji|figure|keychain|poster|manga\s*volume|dvd|blu-?ray/i;
const ONEPIECE = /one\s*piece/i;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
    "Content-Type": "application/json; charset=utf-8",
  };
}

async function getToken(env, ctx) {
  const cache = caches.default;
  const key = new Request("https://opbox-internal/ebay-token");
  const hit = await cache.match(key);
  if (hit) return (await hit.json()).access_token;

  const auth = btoa(`${env.EBAY_CLIENT_ID}:${env.EBAY_CLIENT_SECRET}`);
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope",
  });
  if (!res.ok) throw new Error(`OAuth ${res.status}`);
  const data = await res.json();
  // eBay 토큰 수명보다 짧게 캐시(안전 여유)
  const ttl = Math.max(300, Math.min(6000, (data.expires_in || 7200) - 600));
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(data), {
    headers: { "Cache-Control": `max-age=${ttl}`, "Content-Type": "application/json" },
  })));
  return data.access_token;
}

function categorize(title) {
  if (/booster\s*box|display\s*box|carton/i.test(title)) return "box";
  if (/booster\s*pack|\d+\s*pack|sealed\s*pack/i.test(title)) return "pack";
  return "card";
}

async function search(token, q) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", "200");
  u.searchParams.set("filter", "buyingOptions:{AUCTION}");
  u.searchParams.set("sort", "endingSoonest");
  const r = await fetch(u.toString(), {
    headers: { Authorization: `Bearer ${token}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US" },
  });
  if (!r.ok) throw new Error(`Browse ${r.status}`);
  return (await r.json()).itemSummaries || [];
}

async function buildDeals(env, ctx) {
  const token = await getToken(env, ctx);
  const now = Date.now();
  const seen = new Set();
  const pool = [];

  for (const q of ["One Piece Card Game", "One Piece Card Game Japanese booster"]) {
    for (const it of await search(token, q)) {
      const id = it.itemId;
      const title = it.title || "";
      if (!id || seen.has(id)) continue;
      if (!ONEPIECE.test(title) || JUNK.test(title) || NOT_OPTCG.test(title)) continue;
      if (EXCLUDED_COUNTRIES.has(it.itemLocation?.country)) continue;
      if (!it.itemEndDate) continue;
      const minutesLeft = Math.round((Date.parse(it.itemEndDate) - now) / 60000);
      if (!(minutesLeft > 0 && minutesLeft <= WINDOW_MIN)) continue;
      seen.add(id);
      const bidCount = Number.isFinite(it.bidCount) ? it.bidCount : 0;
      const bid = Number(it.currentBidPrice?.value);
      pool.push({
        id,
        title: title.slice(0, 110),
        url: it.itemWebUrl,
        kind: categorize(title),
        bidCount,
        contested: bidCount > 0,
        currentBid: Number.isFinite(bid) ? bid : null,
        currency: it.currentBidPrice?.currency || it.price?.currency || "USD",
        shipping: Number(it.shippingOptions?.[0]?.shippingCost?.value || 0),
        endsAt: it.itemEndDate,
        minutesLeft,
        country: it.itemLocation?.country || "",
        sellerFeedback: it.seller?.feedbackScore ?? null,
        image: it.thumbnailImages?.[0]?.imageUrl || it.image?.imageUrl || null,
      });
    }
  }

  // 입찰 경쟁 → 셀러 규모 → 임박 순
  pool.sort((a, b) =>
    (b.bidCount - a.bidCount) ||
    ((b.sellerFeedback ?? 0) - (a.sellerFeedback ?? 0)) ||
    (a.minutesLeft - b.minutesLeft));

  return {
    generatedAt: new Date().toISOString(),
    windowMinutes: WINDOW_MIN,
    candidates: pool.length,
    items: pool.slice(0, MAX_ITEMS),
    note: "Live eBay auctions ending within 3 hours. Bids shown are current, not final sale prices.",
  };
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return new Response(null, { headers: corsHeaders(origin) });
    if (request.method !== "GET") return new Response("Method Not Allowed", { status: 405 });

    const cache = caches.default;
    const cacheKey = new Request(new URL(request.url).origin + "/deals-v1");
    const cached = await cache.match(cacheKey);
    if (cached) {
      const body = await cached.text();
      return new Response(body, { headers: { ...corsHeaders(origin), "X-Cache": "HIT" } });
    }

    try {
      const data = await buildDeals(env, ctx);
      const body = JSON.stringify(data);
      ctx.waitUntil(cache.put(cacheKey, new Response(body, {
        headers: { "Cache-Control": `max-age=${CACHE_SECONDS}`, "Content-Type": "application/json" },
      })));
      return new Response(body, { headers: { ...corsHeaders(origin), "X-Cache": "MISS" } });
    } catch (err) {
      // 실패해도 페이지가 깨지지 않도록 빈 목록을 정상 응답으로 돌려준다(프런트에서 섹션 숨김)
      return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), items: [], error: String(err).slice(0, 120) }),
        { headers: { ...corsHeaders(origin), "X-Cache": "ERROR" } });
    }
  },
};
