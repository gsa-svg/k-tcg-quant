#!/usr/bin/env node
// 포켓몬 여유분 감시 — 2026-09-03 소유자 지시: "이베이 한도는 항상 쓴 적도 없고, 남으면 포켓몬 수집을 해봐."
//
// 왜 포켓몬인가: 하루 4만 건이 끝나는 가장 큰 시장인데 우리는 스냅샷 때 250건만 감시했다. 그 250건은
// 스냅샷 뒤 40분 안에 다 끝나 오전에 정산이 끝나고, 그 뒤로 포켓몬 대기열은 0 이다(실측 9/3 06:30 UTC:
// pokemon·pokemonjp 대기 0건). 남는 쿼터를 쓸 대상이 없어서 그냥 버려졌다.
//
// 어떻게: TCG 워크플로 매 회차마다 "곧 끝나는 포켓몬 경매"를 검색어당 한 페이지(200건 = 1콜) 더 감시목록에 넣는다.
// 정산(settle-tcg.js)은 게임별 라운드로빈이라 다른 게임 몫을 먼저 처리하고, **남는 예산으로만** 이 여유분을
// 읽는다. 창 마지막 회차(06:45 UTC)는 남김 없이 쓴다. 30시간 안에 못 읽은 건 버려진다 — 검색은 1콜에 200건이라 싸다.
//
// 얼마나: 아직 안 끝난 포켓몬 대기가 TARGET 아래일 때만 넣는다. 정산 능력을 넘는 만큼은 만료될 뿐이다.
const fs = require("fs");
const path = require("path");
const { token, quota } = require("./ebay-budget");
const { TCGS } = require("./tcg-config");

const ROOT = path.join(__dirname, "..");
const WATCH = path.join(ROOT, "data", "tcg-watch.json");
const POKEMON_KEYS = ["pokemonjp", "pokemon"];   // 스냅샷과 같은 순서 — 일본판 검색어가 먼저 가져간다
const TARGET_LIVE = 1200;    // 아직 안 끝난 포켓몬 대기가 이보다 많으면 더 넣지 않는다
const PAGE = 200;            // Browse API 한 호출 상한
const MIN_QUOTA = 400;       // 이 아래면 정산할 몫도 없다 — 넣어 봐야 만료된다
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

(async () => {
  const watch = fs.existsSync(WATCH) ? JSON.parse(fs.readFileSync(WATCH, "utf8")) : { pending: [] };
  const now = Date.now();
  const have = new Set(watch.pending.map((p) => p.id));
  const live = watch.pending.filter((p) => POKEMON_KEYS.includes(p.g) && Date.parse(p.end) > now).length;
  if (live >= TARGET_LIVE) {
    console.log(JSON.stringify({ status: "skip", why: "포켓몬 대기 충분", live }));
    return;
  }
  const { remaining } = await quota();
  if (remaining != null && remaining < MIN_QUOTA) {
    console.log(JSON.stringify({ status: "skip", why: "쿼터 부족", remaining }));
    return;
  }

  const tok = await token();
  const day = new Date(now).toISOString().slice(0, 10);
  const fresh = [];
  let calls = 0;
  for (const g of TCGS.filter((game) => POKEMON_KEYS.includes(game.k))) {
    calls += 1;
    for (const it of await search(tok, g.q)) {
      if (!it.itemId || !it.itemEndDate || have.has(it.itemId)) continue;
      if (Date.parse(it.itemEndDate) <= now) continue;
      have.add(it.itemId);
      // extra: 표본(스냅샷 250)이 아니라 남는 쿼터로 더 읽는 여유분 — 원장에도 같이 적혀 나중에 나눠 볼 수 있다.
      fresh.push({ g: g.k, id: it.itemId, end: it.itemEndDate, seen: day, extra: true });
    }
  }
  watch.pending = watch.pending.concat(fresh);
  watch.updated = new Date().toISOString();
  fs.writeFileSync(WATCH, `${JSON.stringify(watch)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", calls, added: fresh.length, pokemonLive: live + fresh.length, pending: watch.pending.length, remaining }));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
