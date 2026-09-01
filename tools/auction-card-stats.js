// 카드별 경매 실거래 집계 — 일자별 원장(data/auction-archive/)에서 카드(cardId)마다 롤링 통계를 뽑아
// data/auction-card-stats.json 으로 별도 저장한다. 카드는 경매 표본이 두꺼워(박스와 달리) 카드별로 보여줄 수 있다.
//
// 왜 별도 파일인가: 박스 페이지의 시세/공급 그래프와 성격이 다르다. 카드는 "실낙찰가 + 낙찰률 + 입찰경쟁"을
//   카드별로 따로 보여준다(사용자 방침 2026-07-23). settle-auctions 가 낙찰기록을 쌓고, 이 도구가 그걸 카드별로 굴린다.
//
// 산출(카드별, 최근 창 기준):
//   n=기록수, sold=낙찰수, sellThrough=낙찰률%(팔림/유찰 확정분 분모), medPrice=개당 낙찰 중앙값(USD),
//   low/high=사분위, medBids=입찰수 중앙값, medBidders=고유입찰자 중앙값, last=최근 낙찰 몇 건.
// 개별 낙찰기록은 아카이브가 원장이므로 여기선 파생 집계만 저장한다.
//
// 원칙: 조작 없음. 낙찰가는 sold=true + 유효 개당가만. 표본 얇은 카드(sold<MIN)는 담지 않는다(빈 값이 틀린 값보다 낫다).
// Run: node tools/auction-card-stats.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { readRecent } = require("./auction-archive");
const { reclassify } = require("./auction-aggregate");
const outPath = path.join(ROOT, "data", "auction-card-stats.json");

// 원장은 data/auction-archive/<날짜>.json 이다(2026-07-29 분리). 45일 창을 직접 읽는다 —
// 종전엔 auction-sold.json 을 읽었는데, 그 파일은 이제 최근 14일만 담는 얇은 파일이라
// 그대로 두면 표본이 조용히 3분의 1로 줄어든다.
const WINDOW_DAYS = 45;

const MIN_SOLD = 3;          // 이보다 적으면 카드별로 안 보여준다(잡음)
const LAST_N = 5;            // 카드별 최근 낙찰 표시 개수

const med = (a) => { const x = a.filter(Number.isFinite).sort((m, n) => m - n); if (!x.length) return null; const i = Math.floor(x.length / 2); return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(2)); };
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((m, n) => m - n); if (!s.length) return null; return Number(s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))].toFixed(2)); };
// 개당 낙찰가: 새 기록은 unitPrice, 옛 기록은 price(카드는 대부분 qty=1). qty가 불명(null)인 다수량은 제외.
const unit = (r) => ("qty" in r ? (r.qty == null ? null : r.unitPrice) : r.price);

function main() {
  // 원장의 kind 는 수집 당시 규칙으로 매겨진 값이라, 최신 분류 규칙으로 다시 매긴 뒤 쓴다.
  const sales = reclassify(readRecent(WINDOW_DAYS)).filter((r) => r.kind === "card" && r.cardId);

  const byCard = {};
  for (const r of sales) (byCard[r.cardId] = byCard[r.cardId] || []).push(r);

  const cards = {};
  for (const [cardId, rows] of Object.entries(byCard)) {
    const decided = rows.filter((r) => r.sold !== null);
    const soldRows = rows.filter((r) => r.sold === true && Number.isFinite(unit(r)));
    if (soldRows.length < MIN_SOLD) continue;
    const prices = soldRows.map(unit);
    const last = [...soldRows].sort((a, b) => b.d.localeCompare(a.d)).slice(0, LAST_N)
      .map((r) => ({ d: r.d, price: unit(r), bids: Number.isFinite(r.bids) ? r.bids : null }));
    cards[cardId] = {
      set: rows.find((r) => r.set)?.set || null,
      n: rows.length,
      sold: soldRows.length,
      sellThrough: decided.length ? Number((decided.filter((r) => r.sold).length / decided.length * 100).toFixed(1)) : null,
      medPrice: med(prices),
      low: q(prices, 0.25),
      high: q(prices, 0.75),
      medBids: med(soldRows.map((r) => r.bids)),
      medBidders: med(soldRows.map((r) => r.bidders)),
      last,
    };
  }

  const out = {
    note: "Per-card completed eBay auction stats for One Piece Card Game singles, derived from the daily auction archive (data/auction-archive/). medPrice is the median final winning bid per card (USD), sellThrough is the share of decided auctions that actually sold, medBids/medBidders show bidding competition. Cards with fewer than " + MIN_SOLD + " confirmed sales are omitted rather than shown on thin samples. This is a rolling snapshot recomputed from the last 45 days of the archive; those daily files are the source of truth for individual sales.",
    window: "rolling 45d (daily auction archive)",
    updated: new Date().toISOString(),
    cardCount: Object.keys(cards).length,
    cards,
  };
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n", "utf8");
  console.log(JSON.stringify({ cards: out.cardCount, totalCardSales: sales.length }));
}

module.exports = { main };
if (require.main === module) main();
