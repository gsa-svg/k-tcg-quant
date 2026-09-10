#!/usr/bin/env node
// TCG 여유분 감시 — 남는 쿼터를 13개 게임에 고르게 나눠 더 읽는다 — 2026-09-07.
//
// 소유자 지시 정정: 9/3 "남으면 포켓몬" → 9/7 "다른 곳에도 배분해서 다 써라". 포켓몬만 받던 여유분을
// 모든 게임이 같은 몫으로 받는다(topup-pokemon-watch.js 대체).
//
// 규칙
//  · 표본(스냅샷 250/게임)이 먼저다. settle-tcg 는 표본을 다 읽은 뒤에만 여유분(extra)을 읽는다.
//  · 넣는 양은 남는 쿼터만큼만. 창 잔여 − 원피스 정산 몫 − 검색 − 안전 = TCG 가 쓸 수 있는 콜 수이고,
//    거기서 아직 못 읽은 대기(표본+여유분, 시한 30시간 안)를 빼면 "이번에 더 넣어도 읽을 수 있는 수"다.
//    읽는 데 건당 1콜이므로 그 수만큼만 넣는다 — 못 읽고 시한을 넘길 것을 넣지 않는다(9/6 실측: 회차마다
//    400건씩 넣어 하루 만에 대기 1만 건, 그중 6천 건이 버려졌다).
//  · 게임마다 같은 몫(정수 나눗셈). 게임당 한 페이지(200건 = 1콜) 안에서만 — 검색은 싸다.
//  · 끝났는데 못 읽은 여유분이 게임당 MAX_DUE_PER_GAME 을 넘으면 그 게임은 이번 회차를 쉰다.
//
// Run: node tools/topup-tcg-watch.js [--dry-run]   (--dry-run: 검색까지만 하고 감시목록에 쓰지 않는다)
const fs = require("fs");
const path = require("path");
const { token, settleBudget, nextReset } = require("./ebay-budget");
const { TCGS } = require("./tcg-config");

const ROOT = path.join(__dirname, "..");
const WATCH = path.join(ROOT, "data", "tcg-watch.json");
const PAGE = 200;               // Browse API 한 호출 상한
const GIVE_UP_HOURS = 30;       // settle-tcg.js 와 같은 시한
const MAX_DUE_PER_GAME = 400;   // 끝났는데 못 읽은 여유분이 이보다 많은 게임은 더 넣지 않는다
const MARGIN = 50;              // 계산 오차 여유 — 이만큼은 남긴다
const marketplaceId = process.env.EBAY_MARKETPLACE_ID || "EBAY_US";

async function search(tok, q) {
  const u = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  u.searchParams.set("q", q);
  u.searchParams.set("filter", "buyingOptions:{AUCTION}");
  u.searchParams.set("limit", String(PAGE));
  u.searchParams.set("sort", "endingSoonest");
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) throw new Error(`search ${r.status} ${q}`);
  return (await r.json()).itemSummaries || [];
}

/** Pure split: how many extras each game may receive this run. */
function planTopup({ usable, owed, games, dueByGame = {} }) {
  const room = usable - owed - MARGIN;
  if (!Number.isFinite(room) || room < games.length) return { room, perGame: 0, eligible: [] };
  const eligible = games.filter((g) => (dueByGame[g] || 0) < MAX_DUE_PER_GAME);
  if (!eligible.length) return { room, perGame: 0, eligible };
  return { room, perGame: Math.min(PAGE, Math.floor(room / eligible.length)), eligible };
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const watch = fs.existsSync(WATCH) ? JSON.parse(fs.readFileSync(WATCH, "utf8")) : { pending: [] };
  const now = Date.now();
  const cutoff = now - GIVE_UP_HOURS * 3600 * 1000;
  const resetMs = nextReset(now);   // 이 쿼터 창이 끝나는 시각(07:00 UTC)
  const have = new Set(watch.pending.map((p) => p.id));

  // 아직 못 읽은 대기(시한 안) — 전부 1콜씩 든다. 게임별 "끝났는데 못 읽은 여유분"은 상한 판정용.
  let owed = 0;
  const dueByGame = {};
  for (const p of watch.pending) {
    const end = Date.parse(p.end);
    if (!(end > cutoff)) continue;
    owed += 1;
    if (p.extra && end <= now) dueByGame[p.g] = (dueByGame[p.g] || 0) + 1;
  }

  // share 1 · min 0 · max 큰 값 = "원피스·검색·안전을 뺀 TCG 가용 콜 수" 그 자체를 받는다.
  const budget = await settleBudget({ reserveFor: ["auction", "search", "safety", "active"], share: 1, min: 0, max: 1e9 });
  if (budget.left == null) { console.log(JSON.stringify({ status: "skip", why: "잔여량을 못 읽음" })); return; }
  const games = TCGS.map((g) => g.k);
  const plan = planTopup({ usable: budget.n, owed, games, dueByGame });
  if (plan.perGame <= 0) {
    console.log(JSON.stringify({ status: "skip", why: "더 넣어도 못 읽는다", usable: budget.n, owed, room: plan.room, dueByGame }));
    return;
  }

  const tok = await token();
  const day = new Date(now).toISOString().slice(0, 10);
  const fresh = [];
  const added = {};
  let calls = 0;
  for (const g of TCGS) {
    if (!plan.eligible.includes(g.k)) { added[g.k] = `쉼(못 읽은 여유분 ${dueByGame[g.k]})`; continue; }
    calls += 1;
    let n = 0;
    for (const it of await search(tok, g.q)) {
      if (n >= plan.perGame) break;
      if (!it.itemId || !it.itemEndDate || have.has(it.itemId)) continue;
      if (Date.parse(it.itemEndDate) <= now) continue;
      // 여유분은 **이 창 안에서 끝나는 것만** 넣는다(리셋 30분 전까지). 리셋 뒤에 끝나는 여유분은 다음 창의 쿼터로
      // 읽게 되는데, 그 창의 표본(base)이 아직 안 끝난 이른 시간에 먼저 읽혀 표본 몫을 잡아먹는다
      // (2026-09-09 실제: 9/8 여유분 ≈2,000건이 9/9 창을 먼저 써서 9/9 표본이 lorcana 0·weiss 4 로 굶었다).
      if (Date.parse(it.itemEndDate) > resetMs - 30 * 60 * 1000) continue;
      have.add(it.itemId);
      // extra: 표본(스냅샷 250)이 아니라 남는 쿼터로 더 읽는 여유분 — 원장에도 같이 적혀 나중에 나눠 볼 수 있다.
      fresh.push({ g: g.k, id: it.itemId, end: it.itemEndDate, seen: day, extra: true });
      n += 1;
    }
    added[g.k] = n;
  }
  if (!dryRun) {
    watch.pending = watch.pending.concat(fresh);
    watch.updated = new Date().toISOString();
    fs.writeFileSync(WATCH, `${JSON.stringify(watch)}\n`, "utf8");
  }
  console.log(JSON.stringify({ status: dryRun ? "dry-run" : "ok", calls, added: fresh.length, perGame: plan.perGame, byGame: added, usable: budget.n, owed, room: plan.room, pending: watch.pending.length + (dryRun ? fresh.length : 0), remaining: budget.left }));
}

if (require.main === module) main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });

module.exports = { planTopup, MAX_DUE_PER_GAME, PAGE, MARGIN };
