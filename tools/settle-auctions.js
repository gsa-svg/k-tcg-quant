// 경매 정산 — 종료된 경매를 다시 조회해 "실제 낙찰가"를 기록한다.
//
// 왜 이게 가능한가 (2026-07-20 실측): Browse API 의 getItem 은 경매가 끝난 뒤에도 응답한다.
// 종료 항목에서 bidCount(최종 입찰수), currentBidPrice(낙찰가),
// estimatedAvailabilities[].estimatedSoldQuantity(팔렸는지), uniqueBidderCount 를 준다.
// Marketplace Insights(Limited Release) 승인 없이도 실거래를 쌓을 수 있는 유일한 경로다.
//
// 왜 추정으로 때우면 안 되는가: 같은 경매를 종료 21분 전에 봤을 때 20건/$107.2 였는데
// 최종은 26건/$135.04 였다. 마지막 20분에 26% 올랐다. 스나이핑 때문에 "종료 N시간 전 현재가"는
// 낙찰가가 아니다. 끝난 뒤에 읽어야 진짜 값이다.
//
// ⚠️ 반드시 지킬 것
//  - 조회 가능 기간이 무한하지 않을 수 있다. 종료 직후에 정산하도록 자주 돌린다(30분 간격).
//    실패한 건은 재시도하되, 오래된 건 미정산으로 버린다 — 추측값을 채우지 않는다.
//  - soldQuantity 가 0/미상이면 "팔림"으로 적지 않는다. 유찰도 데이터다(낙찰률의 분모).
//  - price 는 마켓플레이스 통화(USD) 기준값을 쓴다. 원 통화는 참고로만 남긴다.
//
// Run: node tools/settle-auctions.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const watchPath = path.join(ROOT, "data", "auction-watch.json");
const soldPath = path.join(ROOT, "data", "auction-sold.json");

// 개별 낙찰 기록 보관 기간. 이 파일은 2시간마다 다시 쓰이므로(=커밋마다 새 blob) 길수록 저장소가 큰다.
// 45일이면 발매 전후 비교와 최근 추세에 충분하고, 그 이전은 일별 집계로 남는다.
const KEEP_SALES_DAYS = 45;
const KEEP_DAILY_DAYS = 365;   // 일별 집계는 더 오래
const MAX_PER_RUN = 250;       // 한 번에 조회할 최대 건수 (API 한도 보호)
const GIVE_UP_HOURS = 30;      // 종료 후 이만큼 지나도 정산 못 하면 포기(조회 불가 추정)

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

async function getItem(tok, id) {
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item/${encodeURIComponent(id)}`,
    { headers: { Authorization: `Bearer ${tok}`, "X-EBAY-C-MARKETPLACE-ID": marketplaceId } });
  if (!r.ok) return { ok: false, status: r.status };
  return { ok: true, item: await r.json() };
}

const med = (a) => {
  const x = a.filter(Number.isFinite).sort((m, n) => m - n);
  if (!x.length) return null;
  const i = Math.floor(x.length / 2);
  return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(2));
};

(async () => {
  if (!env.EBAY_CLIENT_ID || !env.EBAY_CLIENT_SECRET) throw new Error("Missing eBay credentials");

  let watch;
  try { watch = JSON.parse(fs.readFileSync(watchPath, "utf8")); } catch { watch = { pending: [] }; }
  const now = Date.now();

  const due = watch.pending
    .filter((w) => Date.parse(w.endsAt) < now - 60000)   // 종료 1분 뒤부터 (반영 지연 여유)
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
    .slice(0, MAX_PER_RUN);

  if (!due.length) {
    console.log(JSON.stringify({ settled: 0, pending: watch.pending.length, note: "nothing due" }));
    return;
  }

  const tok = await token();
  const settled = [];
  const failedIds = new Set();

  for (const w of due) {
    const res = await getItem(tok, w.id);
    if (!res.ok) { failedIds.add(w.id); continue; }
    const j = res.item;
    const bids = Number.isFinite(j.bidCount) ? j.bidCount : 0;
    const price = Number(j.currentBidPrice?.value ?? j.price?.value);
    const avail = (j.estimatedAvailabilities || [])[0] || {};
    // 팔렸다고 단정할 근거가 있을 때만 sold=true. 근거가 없으면 null(모름) — false 로 단정하지 않는다.
    const soldQty = Number.isFinite(avail.estimatedSoldQuantity) ? avail.estimatedSoldQuantity : null;
    const sold = soldQty == null ? (bids > 0 ? null : false) : soldQty > 0;
    const listedDays = j.itemCreationDate
      ? Math.round((Date.parse(j.itemEndDate) - Date.parse(j.itemCreationDate)) / 86400000)
      : null;

    settled.push({
      d: new Date(Date.parse(w.endsAt)).toISOString().slice(0, 10),
      id: w.id,
      kind: w.kind,
      set: w.set,
      cardId: w.cardId,
      sold,
      price: Number.isFinite(price) && sold !== false ? Number(price.toFixed(2)) : null,
      currency: j.currentBidPrice?.currency || j.price?.currency || "USD",
      srcCurrency: j.currentBidPrice?.convertedFromCurrency || null,
      bids,
      bidders: Number.isFinite(j.uniqueBidderCount) ? j.uniqueBidderCount : null,
      listedDays,
    });
  }

  const settledIds = new Set(settled.map((s) => s.id));
  const giveUpBefore = now - GIVE_UP_HOURS * 3600000;
  watch.pending = watch.pending.filter((w) => {
    if (settledIds.has(w.id)) return false;                       // 정산 완료
    if (Date.parse(w.endsAt) < giveUpBefore) return false;        // 너무 오래됨 — 포기(추측 안 함)
    return true;
  });
  watch.updated = new Date(now).toISOString();
  fs.writeFileSync(watchPath, JSON.stringify(watch) + "\n", "utf8");

  // ── 낙찰 기록 저장
  let out;
  try { out = JSON.parse(fs.readFileSync(soldPath, "utf8")); } catch { out = { sales: [], daily: [] }; }
  const known = new Set(out.sales.map((s) => s.id));
  out.sales.push(...settled.filter((s) => !known.has(s.id)));

  const cutSales = new Date(now - KEEP_SALES_DAYS * 86400000).toISOString().slice(0, 10);
  out.sales = out.sales.filter((s) => s.d >= cutSales).sort((a, b) => a.d.localeCompare(b.d));

  // ── 일별 집계 재계산 (개별 기록에서 다시 만든다 — 집계와 원본이 어긋날 여지를 없앤다)
  const days = [...new Set(out.sales.map((s) => s.d))];
  const agg = (rows) => {
    const soldRows = rows.filter((r) => r.sold === true && Number.isFinite(r.price));
    const decided = rows.filter((r) => r.sold !== null);      // 팔림/유찰이 확정된 것만 낙찰률 분모
    return {
      n: rows.length,
      sold: soldRows.length,
      sellThrough: decided.length ? Number((decided.filter((r) => r.sold).length / decided.length * 100).toFixed(1)) : null,
      medPrice: med(soldRows.map((r) => r.price)),
      maxPrice: soldRows.length ? Math.max(...soldRows.map((r) => r.price)) : null,
      medBids: med(soldRows.map((r) => r.bids)),
    };
  };
  const daily = days.map((d) => {
    const rows = out.sales.filter((s) => s.d === d);
    const bySet = {};
    for (const s of new Set(rows.filter((r) => r.set).map((r) => r.set))) {
      const rs = rows.filter((r) => r.set === s);
      if (rs.length < 2) continue;                              // 표본 1건은 잡음
      bySet[s] = agg(rs);
    }
    return {
      d,
      ...agg(rows),
      byKind: Object.fromEntries(["box", "pack", "card"].map((k) => [k, agg(rows.filter((r) => r.kind === k))])),
      bySet,
    };
  });
  const cutDaily = new Date(now - KEEP_DAILY_DAYS * 86400000).toISOString().slice(0, 10);
  const priorDaily = (out.daily || []).filter((p) => p.d >= cutDaily && !days.includes(p.d));
  out.daily = [...priorDaily, ...daily].sort((a, b) => a.d.localeCompare(b.d));

  out.note = "Completed eBay auction results for One Piece Card Game items. Each record is read from the listing AFTER the auction closed, so 'price' is the final winning bid, not an asking price or a mid-auction bid. 'sold' is taken from eBay's sold-quantity field; where eBay does not report it we store null rather than guessing, and null rows are excluded from the sell-through denominator. Sellers and locations excluded from our price data are excluded here too.";
  out.updated = new Date(now).toISOString();
  fs.writeFileSync(soldPath, JSON.stringify(out) + "\n", "utf8");

  const soldNow = settled.filter((s) => s.sold === true);
  console.log(JSON.stringify({
    due: due.length,
    settled: settled.length,
    failed: failedIds.size,
    soldConfirmed: soldNow.length,
    medPrice: med(soldNow.map((s) => s.price)),
    pendingLeft: watch.pending.length,
    totalSales: out.sales.length,
  }));
})();
