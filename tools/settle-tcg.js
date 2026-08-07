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

const ROOT = path.join(__dirname, "..");
const WATCH = path.join(ROOT, "data", "tcg-watch.json");
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
const MAX_PER_RUN = 400;          // API 보호. 하루 여러 번 돌리면 1,200건을 무리 없이 소화한다.
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
  const due = watch.pending
    .filter((p) => Date.parse(p.end) < now && Date.parse(p.end) > now - GIVE_UP_HOURS * 3600 * 1000)
    .sort((a, b) => Date.parse(a.end) - Date.parse(b.end))     // 오래된 것부터 — 조회 가능 시한이 먼저 끝난다
    .slice(0, MAX_PER_RUN);
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
    });
  }

  fs.mkdirSync(ARCHIVE, { recursive: true });
  let written = 0;
  for (const [day, rows] of byDay) {
    const f = path.join(ARCHIVE, `${day}.json`);
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : { d: day, sales: [] };
    const have = new Set(prev.sales.map((s) => s.id));
    const add = rows.filter((r) => !have.has(r.id));
    prev.sales = prev.sales.concat(add);
    prev.note = "Settled eBay auctions by game. One file per day, appended only -- a day that has passed is never rewritten. sold comes from eBay's own sold-quantity on the ended listing; price is the winning bid and is left null on unsold listings.";
    fs.writeFileSync(f, `${JSON.stringify(prev)}\n`, "utf8");
    written += add.length;
  }

  const cutoff = now - GIVE_UP_HOURS * 3600 * 1000;
  const pending = watch.pending.filter((p) => !done.has(p.id) && Date.parse(p.end) > cutoff);
  fs.writeFileSync(WATCH, `${JSON.stringify({ ...watch, updated: new Date().toISOString(), pending })}\n`, "utf8");

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
