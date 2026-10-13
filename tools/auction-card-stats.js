// 카드별 경매 실거래 집계 — 일자별 원장(data/auction-archive/)에서 카드(cardId)마다 롤링 통계를 뽑아
// data/auction-card-stats.json 으로 별도 저장한다. 카드는 경매 표본이 두꺼워(박스와 달리) 카드별로 보여줄 수 있다.
//
// 왜 별도 파일인가: 박스 페이지의 시세/공급 그래프와 성격이 다르다. 카드는 "실낙찰가 + 낙찰률 + 입찰경쟁"을
//   카드별로 따로 보여준다(사용자 방침 2026-07-23). settle-auctions 가 낙찰기록을 쌓고, 이 도구가 그걸 카드별로 굴린다.
//
// 산출(카드별, 최근 창 기준):
//   n=기록수, sold=낙찰수, sellThrough=낙찰률%(팔림/유찰 확정분 분모), medPrice=개당 낙찰 중앙값(USD),
//   low/high=사분위, medBids=입찰수 중앙값, medBidders=고유입찰자 중앙값, last=최근 낙찰 몇 건,
//   name/nameSource=이름표(data/card-names.json — build-card-names.js 가 굽는다. override > catalog > title).
// 변형(variants)에는 2026-10-13 부터 이상치 표식이 붙는다:
//   contestedSold=입찰자 2명 이상 낙찰 수, medPriceContested=그 중앙값,
//   psa10Sold/psa10Med=같은 번호·판·변형의 PSA 10 낙찰(3건 이상일 때만),
//   suspect=true ⇔ contestedSold<3 이거나 medPrice>2×psa10Med.
//   왜: 변형 중앙가 1위에 "입찰 1회짜리 3건 $9,989, 같은 카드 PSA 10 은 $124" 같은 오분류가 올라왔다.
//   값을 지우지 않고 표식만 단다 — 화면이 가려서 보여주거나 순위에서 뺀다.
// 개별 낙찰기록은 아카이브가 원장이므로 여기선 파생 집계만 저장한다.
//
// 원칙: 조작 없음. 낙찰가는 sold=true + 유효 개당가만. 표본 얇은 카드(sold<MIN)는 담지 않는다(빈 값이 틀린 값보다 낫다).
// Run: node tools/auction-card-stats.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { readRecent } = require("./auction-archive");
const { reclassify } = require("./auction-aggregate");
// 변형 판별은 등급 원장 적재기와 같은 규칙(ourTier)을 쓴다 — 카드 페이지가 같은 키로 찾는다.
const { ourTier } = require("./cgc-card-pop-ingest.js");
const outPath = path.join(ROOT, "data", "auction-card-stats.json");

// 원장은 data/auction-archive/<날짜>.json 이다(2026-07-29 분리). 45일 창을 직접 읽는다 —
// 종전엔 auction-sold.json 을 읽었는데, 그 파일은 이제 최근 14일만 담는 얇은 파일이라
// 그대로 두면 표본이 조용히 3분의 1로 줄어든다.
const WINDOW_DAYS = 45;

const MIN_SOLD = 3;          // 이보다 적으면 카드별로 안 보여준다(잡음)
const LAST_N = 5;            // 카드별 최근 낙찰 표시 개수
const MIN_PSA10 = 3;         // 같은 번호·판·변형의 PSA 10 낙찰이 이보다 적으면 비교값을 내지 않는다
const MIN_CONTESTED = 3;     // 입찰자 2명 이상 낙찰이 이보다 적으면 중앙가를 확인된 값으로 보지 않는다
const SUSPECT_RATIO = 2;     // 생카드 중앙가가 PSA 10 중앙가의 이 배수를 넘으면 의심

const med = (a) => { const x = a.filter(Number.isFinite).sort((m, n) => m - n); if (!x.length) return null; const i = Math.floor(x.length / 2); return Number((x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2).toFixed(2)); };
const q = (a, p) => { const s = a.filter(Number.isFinite).sort((m, n) => m - n); if (!s.length) return null; return Number(s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))].toFixed(2)); };
// 개당 낙찰가: 새 기록은 unitPrice, 옛 기록은 price(카드는 대부분 qty=1). qty가 불명(null)인 다수량은 제외.
const unit = (r) => ("qty" in r ? (r.qty == null ? null : r.unitPrice) : r.price);
const isPsa10 = (r) => /^PSA (Gem Mint )?10$/i.test(String(r.grade || ""));
const contested = (r) => Number.isFinite(r.bidders) && r.bidders >= 2;

// 이름표 — 없으면 이름 없이 간다(집계는 이름에 의존하지 않는다).
function loadNames() {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "card-names.json"), "utf8")).names || {}; } catch { return {}; }
}

function main() {
  // 원장의 kind 는 수집 당시 규칙으로 매겨진 값이라, 최신 분류 규칙으로 다시 매긴 뒤 쓴다.
  const sales = reclassify(readRecent(WINDOW_DAYS)).filter((r) => r.kind === "card" && r.cardId);
  const names = loadNames();
  const nameOf = (cardId) => { const e = names[String(cardId).toUpperCase()]; return e && e.name ? { name: e.name, nameSource: e.source } : { name: null, nameSource: null }; };

  const byCard = {};
  for (const r of sales) (byCard[r.cardId] = byCard[r.cardId] || []).push(r);

  // 판(JP/EN) × 변형(제목에서 읽은 tier)별 집계 — 2026-09-10 신설.
  // 번호 단위 통계(cards)는 패러렐·망가·SP 와 기본판이 섞여 "이 카드" 의 값으로 쓸 수 없었다(카드 페이지 109장 중 50장 오표시).
  // 감정품(PSA/CGC/TAG)은 뺀다 — 생카드와 다른 시장이다. 판을 못 가린 건(ed 없음)도 뺀다 — 추측하지 않는다.
  // PSA 10 낙찰은 같은 키로 따로 모아 생카드 중앙가의 비교 기준으로 쓴다(같은 번호·판·변형).
  const byVariant = {};
  const psa10ByVariant = {};
  for (const r of sales) {
    if (!(r.ed === "jp" || r.ed === "en")) continue;
    const key = `${r.cardId}|${r.ed}|${ourTier(r.title)}`;
    if (!r.grade) (byVariant[key] = byVariant[key] || []).push(r);
    else if (isPsa10(r) && r.sold === true && Number.isFinite(unit(r))) (psa10ByVariant[key] = psa10ByVariant[key] || []).push(unit(r));
  }
  const variants = {};
  for (const [key, rows] of Object.entries(byVariant)) {
    const decided = rows.filter((r) => r.sold !== null);
    const soldRows = rows.filter((r) => r.sold === true && Number.isFinite(unit(r)));
    if (soldRows.length < MIN_SOLD) continue;
    const prices = soldRows.map(unit);
    const contestedRows = soldRows.filter(contested);
    const psa10 = psa10ByVariant[key] || [];
    const medPrice = med(prices);
    const psa10Med = psa10.length >= MIN_PSA10 ? med(psa10) : null;
    variants[key] = {
      n: rows.length,
      sold: soldRows.length,
      sellThrough: decided.length ? Number((decided.filter((r) => r.sold).length / decided.length * 100).toFixed(1)) : null,
      medPrice,
      low: q(prices, 0.25),
      high: q(prices, 0.75),
      last: [...soldRows].sort((a, b) => b.d.localeCompare(a.d)).slice(0, LAST_N).map((r) => ({ d: r.d, price: unit(r), bids: Number.isFinite(r.bids) ? r.bids : null })),
      ...nameOf(key.split("|")[0]),
      contestedSold: contestedRows.length,
      medPriceContested: contestedRows.length ? med(contestedRows.map(unit)) : null,
      psa10Sold: psa10.length >= MIN_PSA10 ? psa10.length : null,
      psa10Med,
      suspect: contestedRows.length < MIN_CONTESTED || (psa10Med != null && medPrice > SUSPECT_RATIO * psa10Med),
    };
  }

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
      ...nameOf(cardId),
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
    note: "Per-card completed eBay auction stats for One Piece Card Game singles, derived from the daily auction archive (data/auction-archive/). medPrice is the median final winning bid per card (USD), sellThrough is the share of decided auctions that actually sold, medBids/medBidders show bidding competition. name/nameSource come from data/card-names.json (override > catalog > title; null when unresolved). Cards with fewer than " + MIN_SOLD + " confirmed sales are omitted rather than shown on thin samples. This is a rolling snapshot recomputed from the last " + WINDOW_DAYS + " days of the archive; those daily files are the source of truth for individual sales.",
    window: "rolling 45d (daily auction archive)",
    updated: new Date().toISOString(),
    cardCount: Object.keys(cards).length,
    variantNote: "variants: key = cardNumber|print(jp/en)|variant tier read from the listing title (base/alt/super/red/sp/gold/silver/signature/boxtopper/wanted/tr); raw (ungraded) auctions only; rows with < " + MIN_SOLD + " sales omitted. contestedSold = sales with 2+ distinct bidders, medPriceContested = median of those. psa10Sold/psa10Med = PSA 10 sales of the same number, print and tier in the window (null under " + MIN_PSA10 + "). suspect = true when contestedSold < " + MIN_CONTESTED + " or medPrice > " + SUSPECT_RATIO + " × psa10Med — the price is unconfirmed, show it as such or leave it out of rankings.",
    variantCount: Object.keys(variants).length,
    suspectCount: Object.values(variants).filter((v) => v.suspect).length,
    variants,
    cards,
  };
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n", "utf8");
  console.log(JSON.stringify({ cards: out.cardCount, variants: out.variantCount, suspect: out.suspectCount, totalCardSales: sales.length }));
}

module.exports = { main };
if (require.main === module) main();
