// 원피스 경매 시장 전수 스캔 — "무엇이 경매에 얼마나 나오고, 얼마에 붙고 있는가"를 매일 기록한다.
//
// 왜 별도 도구인가: fetch-auction-deals.js 는 "3시간 내 종료" 창만 본다. 그건 사이트에 띄울
// 목록용이지 시장 관측용이 아니다. 어떤 세트·어떤 카드가 경매에 많이 나오는지 알려면
// 진행 중인 경매 전체를 훑어야 한다.
//
// 왜 지금부터 쌓나: 시계열은 소급 수집이 안 된다. 오늘 안 쌓으면 오늘 데이터는 영원히 없다.
//
// ⚠️ 정확도 원칙
//  - 제목에서 세트/카드번호를 "확신할 때만" 분류한다. 애매하면 unclassified 로 두고 억지로 안 넣는다.
//    틀린 분류로 만든 그래프는 빈 그래프보다 나쁘다.
//  - 이건 전수조사가 아니라 표본이다. eBay 가 알려준 전체 건수(totalReported)를 같이 기록해
//    나중에 커버리지를 판단할 수 있게 한다.
//  - currentBid 는 "지금 붙은 값"이지 낙찰가가 아니다. 필드명·note 에서 절대 sold 로 부르지 않는다.
//
// Run: node tools/collect-auction-market.js
const fs = require("fs");
const path = require("path");
const { isExcludedEbaySellerOrLocation } = require("./ebay-listing-filters");

const ROOT = path.join(__dirname, "..");
const outPath = path.join(ROOT, "data", "auction-market.json");

// 보관 기간. 이 파일은 하루 4번 다시 쓰인다(=커밋마다 새 blob) — 무한정 키우면 저장소가 불어난다.
// 180일이면 계절성·발매 전후 비교에 충분하다.
const KEEP_DAYS = 180;
const TOP_CARDS = 25;
const TOP_CARDS_DAYS = 30;   // 인기 카드는 "지금 뜨는 것"이 쓸모라 최근 것만 남긴다
const MIN_SET_N = 2;         // 표본 1건짜리 세트는 잡음이라 기록하지 않는다
const PAGES = 3;            // 검색어당 페이지 수 (200건 × 3)
const PAGE_SIZE = 200;

// fetch-auction-deals.js 와 같은 배제 규칙 — 시세에서 뺀 걸 관측에 넣으면 통계가 오염된다.
const JUNK = /proxy|custom|orica|digital|reprint\s*card|fan\s*made|not\s*official|sticker|playmat|sleeve|binder|deck\s*box|empty|damaged|water|bent/i;
const NOT_OPTCG = /berry\s*match|onepy|one\s*py|wafer|gumi|shokugan|ichiban\s*kuji|figure|keychain|poster|manga\s*volume|dvd|blu-?ray/i;
const ONEPIECE = /one\s*piece|ワンピース/i;

// ⚠️ 표본 편향 주의: endingSoonest 로 검색어당 600건만 긁으므로, 일반 검색어만 쓰면 회전이 빠른
//    싱글카드가 표본을 독점한다(실측: 1,158건 중 박스 1건). 박스·팩은 전용 검색어로 따로 표본을 잡는다.
//    kind 별 비율을 "시장 구성비"로 읽으면 안 되는 이유이기도 하다 — note 에 명시할 것.
const QUERIES = [
  "One Piece Card Game",
  "One Piece Card Game Japanese",
  "One Piece TCG",
  "ワンピースカードゲーム",
  "One Piece Card Game booster box",
  "One Piece Card Game booster pack sealed",
  "ワンピースカードゲーム BOX 未開封",
];

function loadEnv(p) {
  if (!fs.existsSync(p)) return {};
  return fs.readFileSync(p, "utf8").split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .reduce((v, l) => { const i = l.indexOf("="); if (i > -1) v[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^['"]|['"]$/g, ""); return v; }, {});
}
const env = { ...loadEnv(path.join(ROOT, ".env")), ...process.env };
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";

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

async function search(tok, q, offset) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("limit", String(PAGE_SIZE));
  u.searchParams.set("offset", String(offset));
  u.searchParams.set("filter", "buyingOptions:{AUCTION}");
  u.searchParams.set("sort", "endingSoonest");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) throw new Error(`Browse ${r.status}`);
  const j = await r.json();
  return { items: j.itemSummaries || [], total: j.total || 0 };
}

// ── 분류 ─────────────────────────────────────────────────────────────
// 박스/팩/카드. "booster box" 와 "booster pack" 이 한 제목에 같이 나오는 경우가 있어 박스를 먼저 본다.
function categorize(title) {
  if (/booster\s*box|display\s*box|carton|\bcase\b/i.test(title)) return "box";
  if (/booster\s*pack|\d+\s*packs?\b|sealed\s*pack/i.test(title)) return "pack";
  return "card";
}

// 세트 코드: OP-06 / OP06 / EB-01 / PRB-01 / ST-21 형태를 모두 받아 정규화한다.
// 카드번호(OP06-093)가 있으면 거기서 세트를 딴다 — 제목에 세트명이 따로 없어도 정확하다.
const CARD_ID = /\b(OP|EB|PRB|ST)[-\s]?(\d{2})[-\s]?(\d{3})\b/i;
const SET_ONLY = /\b(OP|EB|PRB|ST)[-\s]?(\d{2})\b/i;

function classify(title) {
  const card = title.match(CARD_ID);
  if (card) {
    const set = `${card[1].toUpperCase()}-${card[2]}`;
    return { set, cardId: `${card[1].toUpperCase()}${card[2]}-${card[3]}` };
  }
  const s = title.match(SET_ONLY);
  if (s) return { set: `${s[1].toUpperCase()}-${s[2]}`, cardId: null };
  return { set: null, cardId: null };   // 억지로 추측하지 않는다
}

const med = (a) => {
  const x = a.filter(Number.isFinite).sort((m, n) => m - n);
  if (!x.length) return null;
  const i = Math.floor(x.length / 2);
  return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(2));
};

// 가격은 "종료 임박 + 입찰 있음" 에서만 잰다.
// 이유: 막 시작한 경매의 현재가는 시작가(대개 $0.01)라 가격 정보가 아니다. 실측에서 팩 중앙값이
// $0.01 로 나왔는데, 이건 팩이 1센트라는 뜻이 아니라 1센트 시작 경매가 표본을 덮은 것이다.
// 종료가 가까울수록 입찰이 수렴하므로 그 구간만 가격으로 쓴다.
const PRICE_WINDOW_MIN = 360;   // 6시간

function summarize(rows) {
  const contested = rows.filter((r) => r.bidCount > 0);
  const converged = contested.filter((r) => r.minsLeft != null && r.minsLeft <= PRICE_WINDOW_MIN);
  return {
    // 출품량 지표 — 표본 전체 기준
    n: rows.length,
    contested: contested.length,
    avgBidCount: rows.length ? Number((rows.reduce((a, r) => a + r.bidCount, 0) / rows.length).toFixed(2)) : null,
    // 가격 지표 — 종료 6시간 이내 + 입찰 있는 건만. nPrice 가 작으면 그래프에서 숨길 것.
    nPrice: converged.length,
    medBid: med(converged.map((r) => r.bid)),
    maxBid: converged.length ? Math.max(...converged.map((r) => r.bid).filter(Number.isFinite)) : null,
  };
}

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("Missing eBay credentials");
  const tok = await token();
  const seen = new Set();
  const rows = [];
  let totalReported = 0;

  for (const q of QUERIES) {
    for (let p = 0; p < PAGES; p++) {
      const { items, total } = await search(tok, q, p * PAGE_SIZE);
      if (p === 0) totalReported = Math.max(totalReported, total);
      if (!items.length) break;
      for (const it of items) {
        const id = it.itemId;
        const title = it.title || "";
        if (!id || seen.has(id)) continue;
        if (!ONEPIECE.test(title) || JUNK.test(title) || NOT_OPTCG.test(title)) continue;
        if (isExcludedEbaySellerOrLocation(it)) continue;
        seen.add(id);
        const bid = Number(it.currentBidPrice?.value);
        const { set, cardId } = classify(title);
        const endsAt = it.itemEndDate ? Date.parse(it.itemEndDate) : NaN;
        rows.push({
          id,
          kind: categorize(title),
          set,
          cardId,
          bidCount: Number.isFinite(it.bidCount) ? it.bidCount : 0,
          bid: Number.isFinite(bid) ? bid : null,
          minsLeft: Number.isFinite(endsAt) ? Math.round((endsAt - Date.now()) / 60000) : null,
          country: it.itemLocation?.country || "",
        });
      }
      if (items.length < PAGE_SIZE) break;
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  let out;
  try { out = JSON.parse(fs.readFileSync(outPath, "utf8")); } catch { out = { points: [] }; }
  const prior = out.points.find((p) => p.d === today);

  // ── 하루 안에서 가격 표본을 누적한다.
  // 한 번 스캔하면 "종료 6시간 이내" 구간만 잡히므로 하루 한 번으론 24시간 중 6시간만 본다.
  // 그래서 하루 여러 번 돌리는데, 같은 날 실행이 이전 표본을 덮어쓰면 여러 번 돌리는 의미가 없다.
  // 경매 id 로 합집합을 만들어 같은 경매를 두 번 세지 않으면서 표본만 두껍게 한다.
  const obs = new Map((prior?.priceObs || []).map((o) => [o.id, o]));
  for (const r of rows) {
    if (!(r.bidCount > 0)) continue;
    if (r.minsLeft == null || r.minsLeft > PRICE_WINDOW_MIN) continue;
    if (!Number.isFinite(r.bid)) continue;
    // 같은 경매를 또 봤다면 더 나중 값(더 수렴한 값)으로 갱신한다.
    obs.set(r.id, { id: r.id, kind: r.kind, set: r.set, cardId: r.cardId, bid: r.bid, bidCount: r.bidCount });
  }
  const priceObs = [...obs.values()];

  // 출품량은 "지금 몇 건이 돌고 있나"라 시점 스냅샷이다(누적이 아님) — 마지막 스캔 값을 쓴다.
  // 가격은 위에서 만든 당일 누적 표본에서 계산한다. 둘의 성격이 다르므로 분리해 둔다.
  const priceOf = (sel) => {
    const s = priceObs.filter(sel);
    return { nPrice: s.length, medBid: med(s.map((o) => o.bid)), maxBid: s.length ? Math.max(...s.map((o) => o.bid)) : null };
  };
  const counts = (rs) => ({
    n: rs.length,
    contested: rs.filter((r) => r.bidCount > 0).length,
    avgBidCount: rs.length ? Number((rs.reduce((a, r) => a + r.bidCount, 0) / rs.length).toFixed(2)) : null,
  });

  const byKind = {};
  for (const k of ["box", "pack", "card"]) {
    byKind[k] = { ...counts(rows.filter((r) => r.kind === k)), ...priceOf((o) => o.kind === k) };
  }

  const setStats = {};
  for (const s of new Set(rows.filter((r) => r.set).map((r) => r.set))) {
    const rs = rows.filter((r) => r.set === s);
    if (rs.length < MIN_SET_N) continue;
    setStats[s] = {
      ...counts(rs),
      ...priceOf((o) => o.set === s),
      byKind: Object.fromEntries(["box", "pack", "card"].map((k) => [k, rs.filter((r) => r.kind === k).length])),
    };
  }

  const cardIds = new Set(rows.filter((r) => r.cardId).map((r) => r.cardId));
  const topCards = [...cardIds]
    .map((id) => ({ id, ...counts(rows.filter((r) => r.cardId === id)), ...priceOf((o) => o.cardId === id) }))
    .sort((a, b) => b.n - a.n || (b.medBid ?? 0) - (a.medBid ?? 0))
    .slice(0, TOP_CARDS);

  const point = {
    d: today,
    runs: (prior?.runs || 0) + 1,                           // 그날 몇 번 스캔했는지 — 가격 표본 두께의 근거
    scanned: rows.length,                                   // 마지막 스캔 시점 스냅샷
    totalReported,                                          // eBay가 알려준 전체 건수(커버리지 판단용)
    unclassified: rows.filter((r) => !r.set).length,        // 세트 판별 실패 — 늘어나면 파서 점검 신호
    contested: rows.filter((r) => r.bidCount > 0).length,
    byKind,
    bySet: setStats,
    topCards,
    priceObs,                                               // 당일 누적 원표본. 날이 바뀌면 아래에서 제거된다.
  };
  out.note = "Daily sample of live One Piece Card Game auctions on eBay: how many are running by set and item type, how many have attracted bids, and the median current bid. Bids are live, not final sale prices — eBay does not expose completed-sale data at this access tier. Sellers and locations excluded from our price data are excluded here too. Set and card codes are parsed from listing titles; titles we cannot classify confidently are counted under 'unclassified' rather than guessed. Price figures (medBid) are measured only on auctions ending within 6 hours that already have bids, because a freshly listed auction still shows its opening price, not its value; nPrice reports how many listings each price is based on. This is a sample, not a census: boxes and packs are sampled with dedicated queries, so the box/pack/card split is not a market share figure — compare each category against its own history, not against the others.";
  out.updated = today;
  out.points = [...out.points.filter((p) => p.d !== today), point]
    .sort((a, b) => a.d.localeCompare(b.d))
    .slice(-KEEP_DAYS)
    // 원표본은 누적이 끝난 당일만 필요하다. 지난 날짜까지 들고 있으면 파일이 무한정 커진다.
    .map((p) => (p.d === today ? p : (delete p.priceObs, p)));
  // 오래된 날의 인기카드 목록은 지운다 — 과거 순위는 안 보고, 이게 파일 크기의 큰 몫을 먹는다.
  const cutoff = new Date(Date.now() - TOP_CARDS_DAYS * 86400000).toISOString().slice(0, 10);
  for (const p of out.points) if (p.d < cutoff) delete p.topCards;
  // 들여쓰기 없이 쓴다. 사람이 직접 읽는 파일이 아니고, 하루 4번 커밋되므로 크기가 곧 저장소 용량이다.
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n", "utf8");

  console.log(JSON.stringify({
    run: point.runs, scanned: point.scanned, totalReported, unclassified: point.unclassified,
    contested: point.contested, sets: Object.keys(setStats).length,
    priceSamples: priceObs.length, topCard: topCards[0] || null,
  }));
})();
