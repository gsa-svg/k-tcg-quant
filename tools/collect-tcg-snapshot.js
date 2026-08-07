#!/usr/bin/env node
// TCG별 경매 시장 스냅샷 — 2026-08-07 신설.
//
// 원피스 하나만 깊게 파던 걸, 다른 TCG 는 **넓고 얕게** 같이 본다.
// 목적은 "지금 어느 게임이 잘 팔리나"를 같은 잣대로 비교하는 것이다.
//
// 왜 오늘 시작하나: 시계열은 소급 수집이 안 된다. 오늘 안 쌓으면 오늘 데이터는 영원히 없다.
// 그래서 완성형을 기다리지 않고, 지금 확실히 얻을 수 있는 것부터 append-only 로 적는다.
//
// ⚠️ 이 파일이 **아닌** 것
//  - 낙찰가가 아니다. currentBid 는 "지금 붙어 있는 값"이고 경매는 마지막 20분에 뒤집힌다
//    (실측: 종료 21분 전 $107 → 최종 $135). 그래서 필드명을 bid 로만 쓰고 sold/price 라 부르지 않는다.
//  - 거래액이 아니다. 진행 중 입찰 합계는 GMV 의 **하한**일 뿐이다. 진짜 거래액은
//    종료 후 재조회(정산)로만 나온다 — 원피스가 그렇게 하고 있고, 다른 TCG 도 다음 단계에서 붙인다.
//  - 시장 규모가 아니다. eBay 경매는 TCG 거래의 일부다(즉시구매·TCGplayer·카드마켓 제외).
//    게임끼리의 **비교**는 같은 잣대라 유효하지만, 절대 규모로 인용하면 틀린다.
//
// 비용: 게임당 (전체건수 1회 + 표본 1페이지) = 2회. 8개 게임이면 하루 16회. 무시할 수준이다.
// Run: node tools/collect-tcg-snapshot.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "tcg-snapshot.json");
const WATCH = path.join(ROOT, "data", "tcg-watch.json");
const SAMPLE = 200;        // 게임당 표본(종료 임박 순). 중앙값·입찰 비율을 내기에 충분하다.
const KEEP_DAYS = 730;
// 정산(낙찰 여부·낙찰가)까지 볼 표본. 게임당 이만큼만 감시 목록에 넣는다.
// 8게임 × 150 = 하루 1,200건. 원피스(하루 871건)와 합쳐도 API 한도 안에 든다.
// 150건이면 낙찰률 오차가 ±4%p 안쪽이라 게임 간 비교에는 충분하고, 전수는 애초에 불가능하다
// (포켓몬만 하루 4만 건이 끝난다 — 우리 정산 능력의 14배).
const WATCH_PER_GAME = 100;

// 검색어는 "그 게임을 가장 넓게 잡는 것" 하나로 고정한다. 게임마다 검색어 수가 다르면 비교가 깨진다.
// (원피스 실측: 'One Piece TCG' 14,544 vs 'One Piece Card Game' 6,770 — 검색어 하나로 2배가 갈린다.)
//
// 목록 기준: 2026-08-07 실측으로 **진행 중 경매 250건 이상**인 게임만 넣는다.
// 그 아래(배틀스피리츠 24, 그랜드아카이브 19, 아코라 7)는 하루 표본이 한 자리라 비율이 의미를 잃고,
// 호출만 축낸다. 볼륨이 올라오면 그때 넣는다.
const TCGS = [
  { k: "pokemon",    nm: "Pokemon",                  q: "Pokemon TCG" },
  { k: "pokemonjp",  nm: "Pokemon (Japanese)",       q: "Pokemon Card Japanese" },
  { k: "magic",      nm: "Magic: The Gathering",     q: "Magic The Gathering" },
  { k: "yugioh",     nm: "Yu-Gi-Oh!",                q: "Yu-Gi-Oh" },
  { k: "onepiece",   nm: "One Piece",                q: "One Piece TCG" },
  { k: "lorcana",    nm: "Disney Lorcana",           q: "Disney Lorcana" },
  { k: "weiss",      nm: "Weiss Schwarz",            q: "Weiss Schwarz" },
  { k: "digimon",    nm: "Digimon",                  q: "Digimon Card Game" },
  { k: "riftbound",  nm: "Riftbound (LoL)",          q: "Riftbound League of Legends" },
  { k: "unionarena", nm: "Union Arena",              q: "Union Arena" },
  { k: "swu",        nm: "Star Wars Unlimited",      q: "Star Wars Unlimited" },
  { k: "gundam",     nm: "Gundam Card Game",         q: "Gundam Card Game" },
  { k: "dragonball", nm: "Dragon Ball Fusion World", q: "Dragon Ball Fusion World" },
  { k: "fab",        nm: "Flesh and Blood",          q: "Flesh and Blood TCG" },
  { k: "metazoo",    nm: "MetaZoo",                  q: "MetaZoo TCG" },
  { k: "vanguard",   nm: "Cardfight Vanguard",       q: "Cardfight Vanguard" },
  { k: "palworld",   nm: "Palworld TCG",             q: "Palworld TCG" },
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
    body: `grant_type=client_credentials&scope=${encodeURIComponent("https://api.ebay.com/oauth/api_scope")}`,
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  const j = await r.json();
  if (!j.access_token) throw new Error("no access_token");
  return j.access_token;
}

async function search(tok, q, limit, sort, buying = "AUCTION") {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("filter", `buyingOptions:{${buying}}`);
  u.searchParams.set("limit", String(limit));
  if (sort) u.searchParams.set("sort", sort);
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) throw new Error(`search ${r.status} ${q}`);
  const j = await r.json();
  return { total: j.total ?? null, items: j.itemSummaries || [] };
}

const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return Math.round(s[Math.floor(s.length / 2)] * 100) / 100;
};

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("eBay 자격증명 없음");
  const tok = await token();
  const day = new Date().toISOString().slice(0, 10);
  const games = [];
  const watchAdd = [];

  for (const g of TCGS) {
    // 1) 전체 진행 중 건수 — limit=1 로 total 만 받는다
    const head = await search(tok, g.q, 1);
    // 즉시구매도 같이 센다. 경매는 TCG 거래의 작은 쪽이다(실측: 디지몬 경매 1,935 vs 즉구 188,221).
    // 경매만 보고 "시장"이라 하면 100배를 빠뜨린 얘기가 된다. 다만 즉구는 팔릴 때까지 몇 달도 걸려
    // "지금 걸린 개수"일 뿐이고, 낙찰률 같은 걸 낼 수는 없다 — 그래서 건수만 적는다.
    const fixed = await search(tok, g.q, 1, null, "FIXED_PRICE");
    // 2) 종료 임박 순 표본 — 입찰이 붙은 비율과 현재가 분포를 본다
    const { items } = await search(tok, g.q, SAMPLE, "endingSoonest");
    let withBids = 0;
    const bids = [];
    let bidSum = 0;
    for (const it of items) {
      const n = Number.isFinite(it.bidCount) ? it.bidCount : 0;
      const v = Number(it.currentBidPrice?.value);
      const cur = it.currentBidPrice?.currency;
      if (n > 0) withBids += 1;
      if (n > 0 && cur === "USD" && v > 0) { bids.push(v); bidSum += v; }
    }
    // 낙찰률·거래액은 끝난 뒤에야 알 수 있다. 표본 앞쪽(가장 먼저 끝나는 것들)을 감시 목록에 넣어
    // settle-tcg.js 가 종료 후 다시 읽게 한다. 표본을 "종료 임박 순" 앞에서 자르는 이유는,
    // 다음 실행 전에 끝나야 놓치지 않기 때문이다.
    for (const it of items.slice(0, WATCH_PER_GAME)) {
      if (!it.itemId || !it.itemEndDate) continue;
      watchAdd.push({ g: g.k, id: it.itemId, end: it.itemEndDate, seen: day });
    }
    games.push({
      k: g.k,
      live: head.total,                                   // eBay 가 알려준 진행 중 경매 수
      liveFixed: fixed.total,                             // 진행 중 즉시구매 수 (건수만 — 낙찰 개념이 없다)
      sampled: items.length,
      withBids,                                           // 표본 중 입찰이 하나라도 붙은 건수
      bidRate: items.length ? Math.round(withBids / items.length * 1000) / 10 : null,
      medBid: median(bids),                               // 진행 중 현재가 중앙값(낙찰가 아님)
      bidSum: Math.round(bidSum),                         // 표본의 현재 입찰 합계 — GMV 하한
      bidN: bids.length,
    });
  }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : { points: [] };
  // 하루 한 줄. 같은 날 다시 돌면 덮어쓴다(하루가 지나면 다시 쓰지 않는다).
  const points = prev.points.filter((p) => p.d !== day).concat([{ d: day, games }]);
  points.sort((a, b) => a.d.localeCompare(b.d));
  const cut = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);

  fs.writeFileSync(OUT, `${JSON.stringify({
    basis: "Live eBay auction listings by trading card game, sampled once a day",
    note: "live is how many auction listings, and liveFixed how many fixed-price listings, eBay reports for that game's search term right now -- a snapshot, not a period total. The rest comes from a sample of up to 200 listings ending soonest: withBids counts how many already have a bid, medBid is the median current bid, and bidSum adds those bids up. Current bids are not winning bids -- auctions move in their final minutes -- so bidSum is a floor for turnover, never the turnover itself. Games are comparable to each other because every game is measured the same way, but none of these numbers is the size of that game's market: eBay auctions are only one channel, and fixed-price sales are excluded.",
    marketplace: marketplaceId,
    sampleSize: SAMPLE,
    terms: Object.fromEntries(TCGS.map((g) => [g.k, { name: g.nm, query: g.q }])),
    updated: new Date().toISOString(),
    points: points.filter((p) => p.d >= cut),
  })}\n`, "utf8");

  // 감시 목록 — 이미 들어 있는 id 는 건드리지 않는다(중복 정산 방지).
  const prevWatch = fs.existsSync(WATCH) ? JSON.parse(fs.readFileSync(WATCH, "utf8")) : { pending: [] };
  const have = new Set(prevWatch.pending.map((p) => p.id));
  const fresh = watchAdd.filter((p) => !have.has(p.id));
  // 종료 후 30시간이 지나도 못 읽은 건 버린다 — 추측값을 채우느니 비워 둔다.
  const cutoff = Date.now() - 30 * 3600 * 1000;
  const pending = prevWatch.pending
    .filter((p) => Date.parse(p.end) > cutoff)
    .concat(fresh);
  fs.writeFileSync(WATCH, `${JSON.stringify({
    note: "Auctions we are waiting to settle, one row per listing. settle-tcg.js re-reads each after it ends and writes the outcome to data/tcg-archive. Entries older than 30 hours past their end time are dropped rather than guessed at.",
    updated: new Date().toISOString(),
    pending,
  })}\n`, "utf8");

  console.log(JSON.stringify({
    status: "ok", day, games: games.length,
    watchAdded: fresh.length, watchPending: pending.length,
    rows: games.map((g) => `${g.k} auc=${g.live} fix=${g.liveFixed} bid=${g.bidRate}% med=${g.medBid}`),
  }, null, 1));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
