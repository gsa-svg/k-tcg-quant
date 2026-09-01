#!/usr/bin/env node
// 세트별 경매 실적을 뽑아 data/set-auction-stats.json 으로 굽는다 — 2026-09-01 신설.
//
// ── 왜
// 세트 페이지(24개)는 우리 사이트에서 색인되는 페이지 중 가장 두껍다(평균 9,437자).
// 그런데 거기에 **우리만 가진 데이터**인 경매 실적이 빠져 있었다. 박스 가격·체이스 카드·
// PSA 인구는 다른 곳에도 있지만, "이 세트 카드가 경매에서 몇 건 끝나고 몇 %가 팔렸나"는
// 우리가 직접 종료 후 재조회해 쌓은 원장(data/auction-archive, 35,000건+)에서만 나온다.
//
// 노출을 늘리는 방법은 두 가지뿐이다 — 색인되는 페이지를 늘리거나, 그 페이지가 잡는
// 검색어를 늘리거나. 카드 상세 28장이 애드센스 심사로 noindex 인 동안에는 후자만 가능하다.
//
// ── 무엇을 넣지 않는가
// 순위·추천·점수를 만들지 않는다. "이 세트가 좋다"는 판정은 우리 몫이 아니다.
// 표본이 얇으면 비율을 비운다 — 30건 미만은 낙찰률이 한두 건에 흔들린다.
//
// Run: node tools/build-set-auction-stats.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ARCHIVE = path.join(ROOT, "data", "auction-archive");
const OUT = path.join(ROOT, "data", "set-auction-stats.json");

const WINDOW_DAYS = 30;
const MIN_N = 30;          // 이보다 얇으면 비율을 비운다

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const med = (a) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round(((s[s.length / 2 - 1] + s[s.length / 2]) / 2) * 100) / 100;
};

const today = new Date();
const from = iso(today.getTime() - WINDOW_DAYS * 86400000);

const files = fs.readdirSync(ARCHIVE).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
const used = files.filter((f) => f.slice(0, 10) >= from);
if (!used.length) throw new Error("최근 창에 아카이브 파일이 없다");

const bySet = {};
for (const f of used) {
  let day;
  try { day = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")); } catch { continue; }
  for (const s of day.sales || []) {
    const code = s.set;
    if (!code || !/^(OP|EB|PRB|ST)-\d{2}$/.test(code)) continue;
    const b = (bySet[code] = bySet[code] || { ended: 0, sold: 0, unsold: 0, amount: 0, prices: [], bids: [], byCat: {} });
    b.ended++;
    // sold 가 null 인 건은 낙찰 여부가 확인 안 된 것 — 분모에서 뺀다(추측하지 않는다).
    if (s.sold === true) {
      b.sold++;
      const unit = "qty" in s ? s.unitPrice : s.price;
      if (Number.isFinite(unit) && unit > 0) { b.amount += s.price || unit; b.prices.push(unit); }
      if (Number.isFinite(s.bidders) && s.bidders > 0) b.bids.push(s.bidders);
    } else if (s.sold === false) b.unsold++;
    const cat = s.kind || "other";
    const c = (b.byCat[cat] = b.byCat[cat] || { ended: 0, sold: 0 });
    c.ended++;
    if (s.sold === true) c.sold++;
  }
}

const sets = {};
for (const [code, b] of Object.entries(bySet)) {
  const decided = b.sold + b.unsold;          // 낙찰/유찰이 확정된 것만 분모
  const thin = decided < MIN_N;
  sets[code] = {
    ended: b.ended,
    sold: b.sold,
    unsold: b.unsold,
    // 표본이 얇으면 비율을 내보내지 않는다. 빈 값이 흔들리는 숫자보다 낫다.
    sellThrough: thin ? null : Math.round((b.sold / decided) * 1000) / 10,
    passThrough: thin ? null : Math.round((b.unsold / decided) * 1000) / 10,
    amount: Math.round(b.amount),
    medPrice: b.prices.length >= 5 ? med(b.prices) : null,
    medBidders: b.bids.length >= 5 ? med(b.bids) : null,
    byCat: Object.fromEntries(Object.entries(b.byCat)
      .filter(([, v]) => v.ended >= 10)
      .map(([k, v]) => [k, { ended: v.ended, sold: v.sold, sellThrough: Math.round((v.sold / v.ended) * 1000) / 10 }])),
    thin,
  };
}

const out = {
  note: "Per-set auction outcomes over the last " + WINDOW_DAYS + " days, built from data/auction-archive (every auction is read again after it closes, so these are settled results, not asking prices). sellThrough and passThrough use only auctions whose outcome eBay reported; rows with fewer than " + MIN_N + " decided auctions carry null rates and thin:true. amount is winning bid x quantity in USD.",
  window: { days: WINDOW_DAYS, from, to: iso(today.getTime()), minDecided: MIN_N, files: used.length },
  updated: iso(today.getTime()),
  sets,
};
fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n", "utf8");

const ranked = Object.entries(sets).filter(([, v]) => !v.thin).sort((a, b) => b[1].ended - a[1].ended);
console.log(JSON.stringify({
  sets: Object.keys(sets).length,
  withRates: ranked.length,
  window: `${from} ~ ${iso(today.getTime())}`,
  top: ranked.slice(0, 5).map(([k, v]) => `${k} ended ${v.ended} · ${v.sellThrough}% · $${v.amount.toLocaleString()}`),
}, null, 1));
