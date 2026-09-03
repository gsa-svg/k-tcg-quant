#!/usr/bin/env node
// TCG 경매 정산 — 2026-08-07 신설. 끝난 경매를 다시 읽어 "팔렸는지, 얼마에"를 기록한다.
//
// collect-tcg-snapshot.js 가 게임별로 감시 목록에 넣어둔 매물을, 종료된 뒤 getItem 으로 재조회한다.
// Browse API 의 getItem 은 경매가 끝난 뒤에도 응답하고 bidCount / currentBidPrice /
// estimatedSoldQuantity 를 준다 — 이게 승인 없이 실거래를 쌓을 수 있는 유일한 경로다.
//
// ⚠️ 원피스 원장(data/auction-archive)과 **절대 섞지 않는다**. 그쪽은 세트·카드번호·등급까지 분류된
//    깊은 원장이고, 이쪽은 게임 단위 얕은 원장이다. 한 파일에 담으면 원피스 통계가 오염된다.
//
// ⚠️ soldQuantity 가 0/미상이면 "팔림"으로 적지 않는다. 유찰도 데이터다(낙찰률의 분모).
// Run: node tools/settle-tcg.js
const fs = require("node:fs");
const path = require("node:path");
const { settleBudget } = require("./ebay-budget");

const ROOT = path.join(__dirname, "..");
const WATCH = path.join(ROOT, "data", "tcg-watch.json");
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
// 하루에 감시 목록으로 들어오는 양(17게임 × 200 = 3,400)보다 처리 능력이 커야 밀리지 않는다.
// 900 × 하루 4회 = 3,600 — 여유 6%. 이보다 낮추면 못 읽은 채 30시간이 지나 영영 빈칸이 되는 건이 생긴다.
// 한 번에 정산할 건수. 2026-08-20: 600 → 900.
// 감시 유입이 게임당 500(17게임 = 하루 약 8,900건)으로 늘었는데 600 × 12회 = 7,200 이라
// 하루 1,700건씩 밀렸다. 밀린 건은 종료 후 30시간이 지나면 eBay 가 조회를 막아 영원한 빈칸이 된다.
// 실측: 622건 처리에 5분 38초(건당 0.54초) — 900건이면 약 8분, 워크플로 타임아웃 20분 안에 든다.
// 2026-09-02: 고정값 → 잔여 쿼터에서 계산. 원피스와 반대로 TCG 는 감시 유입이 정산 능력을
// 넘어서는 쪽이라(게임당 200건 × 17게임 × 4회), 쿼터가 남으면 더 처리하고 없으면 줄여야 한다.
// 배분 규칙은 tools/ebay-budget.js 한 곳에 있다.
const MIN_PER_RUN = 60;
const MAX_PER_RUN_CAP = 900;      // 워크플로 타임아웃(20분) 안에 드는 실측 상한 — 건당 0.54초
const GIVE_UP_HOURS = 30;         // 이보다 오래된 건 조회가 안 될 수 있다 — 추측하지 않고 버린다.

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
  return (await r.json()).access_token;
}

async function getItem(tok, id) {
  const u = `https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (r.status === 404) return null;          // 사라진 매물 — 결과 없음으로 둔다
  if (!r.ok) throw new Error(`item ${r.status}`);
  return r.json();
}

(async () => {
  if (!fs.existsSync(WATCH)) { console.log(JSON.stringify({ status: "skip", why: "감시 목록 없음" })); return; }
  const watch = JSON.parse(fs.readFileSync(WATCH, "utf8"));
  const now = Date.now();
  // 원피스가 이 창에서 끝나는 건수(감시목록의 실제 개수)·검색·안전 몫을 먼저 남기고, 나머지에서 쓴다.
  // 2026-09-03 정정: 종전엔 검색·안전만 남겨서 TCG 가 회차마다 남은 쿼터의 절반을 가져갔고,
  // 자가치유가 TCG 를 3번 더 돌린 날 원피스 정산 예산이 0 이 됐다. 이 사이트의 주제는 원피스다.
  // drainKey: 창 마지막 회차(06:45 UTC)는 남김 없이 쓴다 — 리셋되면 사라지는 몫이고, 포켓몬 여유분이 기다리고 있다.
  const budget = await settleBudget({ min: MIN_PER_RUN, max: MAX_PER_RUN_CAP, reserveFor: ["auction", "search", "safety"], share: 0.5, drainKey: "tcg" });
  if (budget.n <= 0) {
    console.log(JSON.stringify({ status: "ok", settled: 0, pending: watch.pending.length, note: "쿼터 없음 — 건너뜀", budget: budget.note }));
    return;
  }
  const dueAll = watch.pending
    .filter((p) => Date.parse(p.end) < now && Date.parse(p.end) > now - GIVE_UP_HOURS * 3600 * 1000)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end));    // 오래된 것부터 — 조회 가능 시한이 먼저 끝난다
  // 게임별로 돌아가며 뽑는다 — 2026-09-03. 오래된 순으로만 자르면 큰 게임(포켓몬·매직)이 회차를 독점해
  // 작은 게임은 0건이 된다(실측 9/3: 포켓몬 250 · 건담 1). 각 게임 안에서는 여전히 오래된 것부터다.
  const byGameQueue = new Map();
  for (const p of dueAll) {
    if (!byGameQueue.has(p.g)) byGameQueue.set(p.g, []);
    byGameQueue.get(p.g).push(p);
  }
  const due = [];
  while (due.length < budget.n) {
    let took = false;
    for (const queue of byGameQueue.values()) {
      if (!queue.length || due.length >= budget.n) continue;
      due.push(queue.shift());
      took = true;
    }
    if (!took) break;
  }
  if (!due.length) { console.log(JSON.stringify({ status: "ok", settled: 0, pending: watch.pending.length })); return; }

  const tok = await token();
  const byDay = new Map();
  const done = new Set();
  let gone = 0;

  for (const p of due) {
    let it;
    try { it = await getItem(tok, p.id); } catch { continue; }   // 실패는 남겨두고 다음 실행에서 재시도
    done.add(p.id);
    if (!it) { gone += 1; continue; }
    const bids = Number.isFinite(it.bidCount) ? it.bidCount : 0;
    // 팔림 판정은 eBay 가 준 판매수량 하나만 믿는다. 입찰이 붙었어도 최저가 미달이면 안 팔린다.
    const soldQty = Number(it.estimatedAvailabilities?.[0]?.estimatedSoldQuantity ?? 0);
    const sold = soldQty > 0;
    const price = Number(it.currentBidPrice?.value);
    const cur = it.currentBidPrice?.currency || null;
    const day = (it.itemEndDate || p.end).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push({
      d: day,
      g: p.g,
      id: p.id,
      sold,
      // 낙찰가는 팔린 건에만 적는다. 유찰에 값이 붙으면 "안 팔린 값"이 시세로 샌다.
      price: sold && Number.isFinite(price) && price > 0 ? price : null,
      currency: sold ? cur : null,
      bids,
      // 제목 — 2026-09-02 추가. Riftbound 최고가($24,000)가 실물인지 검증하려는데 원장에
      // 제목이 없어 숫자만으로는 확인 불가였다(getItem 재조회는 쿼터를 또 쓴다).
      // 하루 1,500건 × ~60자 = 90KB — 검증 가능성의 값으로 싸다. 이미 받아온 응답에서 꺼낼 뿐이다.
      title: (it.title || "").slice(0, 120) || undefined,
      // 남는 쿼터로 더 읽은 포켓몬 여유분(topup-pokemon-watch.js). 표본 250 과 나눠 볼 수 있게 남긴다.
      extra: p.extra ? true : undefined,
    });
  }

  fs.mkdirSync(ARCHIVE, { recursive: true });
  // 이미 어느 날짜 파일에든 들어간 id 는 다시 쓰지 않는다. 같은 경매가 두 번 세어지면
  // 낙찰률 분모가 부풀고, append-only 원장이라 되돌릴 수도 없다.
  const already = new Set();
  for (const f of fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) {
    for (const s2 of (JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || [])) already.add(s2.id);
  }
  let written = 0;
  for (const [day, rows] of byDay) {
    const f = path.join(ARCHIVE, `${day}.json`);
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { d: day, sales: [] };
    const have = new Set(prev.sales.map((s) => s.id));
    const add = rows.filter((r) => {
      if (have.has(r.id) || already.has(r.id)) return false;
      already.add(r.id);        // 같은 실행 안에서 두 번 들어오는 것도 막는다(검색어가 겹칠 때 생긴다)
      return true;
    });
    prev.sales = prev.sales.concat(add);
    prev.note = "Settled eBay auctions by game. One file per day, appended only -- a day that has passed is never rewritten. sold comes from eBay's own sold-quantity on the ended listing; price is the winning bid and is left null on unsold listings. Terms of use: https://opboxindex.com/free-data.html#terms";
    fs.writeFileSync(f, `${JSON.stringify(prev)}\n`, "utf8");
    written += add.length;
  }

  const cutoff = now - GIVE_UP_HOURS * 3600 * 1000;
  const pending = watch.pending.filter((p) => !done.has(p.id) && Date.parse(p.end) > cutoff);
  // checkedAt: 정산이 실제로 돈 시각. 자가치유가 "쿼터 창이 열렸는데 이번 창에 정산이 없다"를 이걸로 판단한다
  // (2026-09-03: 창 첫 크론 07:30 UTC 를 GitHub 이 건너뛰었는데 backlog 기준(800건)에 안 걸려 아무도 안 돌렸다).
  fs.writeFileSync(WATCH, `${JSON.stringify({ ...watch, updated: new Date().toISOString(), checkedAt: new Date().toISOString(), pending })}\n`, "utf8");

  const byGame = {};
  for (const rows of byDay.values()) for (const r of rows) {
    byGame[r.g] = byGame[r.g] || [0, 0];
    byGame[r.g][0] += 1; if (r.sold) byGame[r.g][1] += 1;
  }
  console.log(JSON.stringify({
    status: "ok", settled: written, 사라진매물: gone, pending: pending.length,
    게임별: Object.fromEntries(Object.entries(byGame).map(([k, [n, s]]) => [k, `${s}/${n}`])),
  }, null, 1));
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
