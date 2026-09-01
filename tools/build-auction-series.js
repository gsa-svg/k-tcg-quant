#!/usr/bin/env node
// 경매 시계열 집계 — 2026-08-06(판본·가격·입찰 축 추가 2026-08-07).
//
// data/auction-archive/<날짜>.json(하루 1파일, 한 번 쓰고 다시 안 고침)을 전부 읽어
// data/auction-series.json 에 **일봉·주봉·월봉**을 굽는다. 화면(일/주/월 토글)은 이 파일만 읽으면 된다.
//
// 왜 원장에서 매번 다시 굽나: 아카이브가 append-only 라 언제든 전 기간 재생성이 된다.
// 나중에 기준이 바뀌어도(분류를 쪼개거나 통화를 바꾸거나) 이 스크립트만 고쳐 다시 구우면 되고,
// 과거 값을 손으로 고칠 일이 없다.
//
// ⚠️ **불완전한 구간은 표시로 남긴다**(partial). 수집이 빠진 날(7/25·26)이나 부분 수집(7/27·8/6)을
//    그냥 그리면 "그날 경매가 급감"이라는 없는 사실이 생긴다. 지우지도 않고 섞지도 않는다 —
//    표시만 해두고 그릴지 말지는 화면이 정한다.
//
// 네 개의 축을 같은 구간에 대해 굽는다. 하나만으로는 시장을 못 읽는다:
//   1) 물량   ended / sold / sellThrough      … 얼마나 나왔고 얼마나 팔렸나
//   2) 금액   amount / price(p25·중앙·p75)     … 얼마에 팔렸나 (합계는 물량에 끌려다닌다. 중앙값이 진짜 시세다)
//   3) 경쟁   bidders / bids 평균              … 몇 명이 붙었나 (가격보다 먼저 움직인다)
//   4) 판본   byEd = jp / en / other          … 어느 판이 팔리나
//
// 분류(5종, 서로 겹치지 않음):
//   box   … 밀봉 박스·카톤        graded … 등급 카드(제목에서 읽은 등급이 있는 것)
//   pack  … 낱팩                  raw    … 낱장 카드(무등급)
//   lot   … 여러 장·여러 개 묶음("Set of 100", "Lot of 10" 류). 낱장과 섞으면 낱장 통계가 오염된다.
//   ※ grade 는 2026-07-22 부터 기록된다. 그 이전 날짜는 graded 를 집계하지 않고 gradeTracked:false 로 남긴다.
// Run: node tools/build-auction-series.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE = path.join(ROOT, "data", "auction-archive");
const OUT = path.join(ROOT, "data", "auction-series.json");

// 등급 파싱이 들어간 날. 그 전 파일에는 grade 필드 자체가 없어서 0 이 아니라 "모름"이다.
const GRADE_SINCE = "2026-07-22";
// 하루 종료 건수가 이보다 적으면 수집이 덜 돈 날로 본다(정상일은 500건 이상, 부분 수집일은 91·271건이었다).
const PARTIAL_BELOW = 400;
// 중앙값을 이 표본 미만으로 내놓지 않는다. 박스는 하루 5건짜리라 한 건에 중앙값이 통째로 흔들린다.
const MIN_PRICE_N = 5;
// 판본 판정이 붙은 비율이 이보다 낮은 날은 other 를 "다른 판"으로 읽으면 안 된다 — 그냥 못 읽은 것이다.
// (실측: 7/20–21 0%, 7/29 66%, 7/30부터 80%대로 안정. 등급 때와 같은 함정이라 같은 방식으로 표시한다.)
const ED_MIN_COVERAGE = 70;

const CATS = ["box", "graded", "raw", "pack", "lot"];
// 판본은 jp / en / other 셋뿐이다. 원장의 ed 는 eBay 언어 속성이나 제목에서 온 jp·en 만 채워지고,
// 나머지(한국판·중국판·판단 불가)는 전부 other 로 간다 — 그 안을 더 쪼개도 쓸 데가 없다.
const EDS = ["jp", "en", "other"];

const edition = (s) => (s.ed === "jp" || s.ed === "en" ? s.ed : "other");

// "100장 묶음"은 카드 한 장이 아니다. 제목이 묶음을 말하면 낱장·낱팩과 섞지 않고 lot 으로 뺀다
// (2026-08-07 실측: 싱글 버킷 9,788건 중 242건이 묶음. 낙찰률이 17.4% vs 낱장 28.1% 로 아예 다른 물건이다).
// ⚠️ 제목이 없는 행(1,731건, 전부 7/22 이전)은 묶음인지 알 방법이 없어 그대로 낱장에 남는다.
const LOT_TITLE = /\blots?\s+of\b|\blot\b|\bbundle\b|\bbrick\b|\bplaysets?\b|\bset\s+of\s+\d|\b\d{2,}\s*(?:cards?|pcs|pieces)\b|\bx\s?\d{2,}\b/i;

const category = (s) => {
  if (s.title && LOT_TITLE.test(s.title)) return "lot";  // 묶음이 먼저다 — 낱장 통계를 오염시키는 쪽이라
  if (s.kind === "box" || s.kind === "carton") return "box";
  if (s.kind === "pack") return "pack";
  return s.grade ? "graded" : "raw";
};

// 낙찰 단가. 여러 장 묶음이면 묶음가를 장수로 나눈 unitPrice 를 쓴다 —
// 10장 묶음 $100 을 $100 짜리 카드로 세면 시세가 통째로 부풀어 오른다.
// lot 은 장수를 모르는 게 대부분(196건 중 191건)이라 장당가를 만들 수 없다. 대신 **묶음 하나의 값**을
// 그대로 쓴다 — 자기 버킷 안에서는 그게 맞는 단위다.
const unit = (s, cat) => (cat === "lot" ? s.price : (s.unitPrice > 0 ? s.unitPrice : s.price));

const isoWeekStart = (day) => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); // 월요일 시작
  return t.toISOString().slice(0, 10);
};

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

// 선형보간 없는 최근접 백분위. 표본이 작을 때 없는 값을 만들어내지 않는다.
function pct(sorted, q) {
  if (!sorted.length) return null;
  return round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]);
}

function stats(sales) {
  const b = {
    ended: 0, sold: 0, unsold: 0, amount: 0, noTitle: 0,
    byCat: Object.fromEntries(CATS.map((c) => [c, { ended: 0, sold: 0, amount: 0 }])),
    byEd: Object.fromEntries(EDS.map((e) => [e, { ended: 0, sold: 0, amount: 0 }])),
  };
  const prices = Object.fromEntries([...CATS, "all"].map((k) => [k, []]));
  const bidders = Object.fromEntries([...CATS, "all"].map((k) => [k, []]));
  const bids = Object.fromEntries([...CATS, "all"].map((k) => [k, []]));

  for (const s of sales) {
    const cat = category(s);
    const ed = edition(s);
    b.ended += 1;
    b.byCat[cat].ended += 1;
    b.byEd[ed].ended += 1;
    if (!s.title) b.noTitle += 1;
    if (!s.sold) { b.unsold += 1; continue; }
    b.sold += 1;
    b.byCat[cat].sold += 1;
    b.byEd[ed].sold += 1;
    // 낙찰액은 실제 결제 규모다. **price 가 이미 묶음 총액**이라 qty 를 다시 곱하면 안 된다 — 2026-08-25 수정.
    // 아카이브 note 가 그렇게 적어 뒀고("'price' is the final winning bid (lot total)"),
    // 실측으로도 qty>=2 낙찰행 483건 전부 unitPrice == price/qty 였다(unitPrice == price 인 행은 0건).
    // 곱했을 때: 전 기간 GMV 가 $1,330,037 → $1,554,258 (+16.9%), 2026-07 은 +25.8% 로 부풀었다.
    // 최악 단일건 — 'A Fist Of Divine Speed Booster Box Case (12 Boxes)' price $6,211 × qty 12 = $74,532 가
    // 하루 금액에 실려, 그날 정상 총합($65,767)보다 큰 한 건이 됐다.
    // 통화가 USD 가 아니면 금액에서 뺀다(환산해서 섞으면 어느 시점 환율인지 알 수 없다 — 빈 값이 틀린 값보다 낫다).
    if (s.currency === "USD" && s.price > 0) {
      const v = s.price;
      b.amount += v;
      b.byCat[cat].amount += v;
      b.byEd[ed].amount += v;
      const u = unit(s, cat);
      // all 에는 묶음을 넣지 않는다. 묶음가는 카드 한 장 값이 아니라서 섞으면 전체 중앙값이 뜻을 잃는다.
      if (u > 0) { prices[cat].push(u); if (cat !== "lot") prices.all.push(u); }
    }
    // 입찰 경쟁은 낙찰된 건에서만 센다. 유찰은 0 입찰이 대부분이라 섞으면 평균이 무너진다.
    if (s.bidders > 0) { bidders[cat].push(s.bidders); bidders.all.push(s.bidders); }
    if (s.bids > 0) { bids[cat].push(s.bids); bids.all.push(s.bids); }
  }

  const avg = (a) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length, 1) : null);
  const priceBlock = (k) => {
    const a = prices[k].slice().sort((x, y) => x - y);
    // 표본이 얇으면 값을 아예 안 내놓는다. n 은 항상 같이 실어 독자가 무게를 판단하게 한다.
    if (a.length < MIN_PRICE_N) return { n: a.length, p25: null, med: null, p75: null };
    return { n: a.length, p25: pct(a, 0.25), med: pct(a, 0.5), p75: pct(a, 0.75) };
  };

  b.amount = round(b.amount);
  for (const c of CATS) b.byCat[c].amount = round(b.byCat[c].amount);
  for (const e of EDS) b.byEd[e].amount = round(b.byEd[e].amount);
  b.sellThrough = b.ended ? round((b.sold / b.ended) * 100) : null;
  // 판정이 붙은 비율. 날짜 상수로 박지 않고 매번 세서, 나중에 커버리지가 떨어지면 저절로 드러나게 한다.
  b.edCoverage = b.ended ? round(((b.byEd.jp.ended + b.byEd.en.ended) / b.ended) * 100, 1) : null;
  b.edTracked = b.edCoverage !== null && b.edCoverage >= ED_MIN_COVERAGE;
  b.price = Object.fromEntries([...CATS, "all"].map((k) => [k, priceBlock(k)]));
  b.bidders = Object.fromEntries([...CATS, "all"].map((k) => [k, avg(bidders[k])]));
  b.bids = Object.fromEntries([...CATS, "all"].map((k) => [k, avg(bids[k])]));

  // 축이 늘면 합이 안 맞는 실수를 조용히 내보내기 쉽다. 여기서 터뜨려 잘못된 파일이 나가는 걸 막는다.
  for (const [name, axis] of [["byCat", CATS], ["byEd", EDS]]) {
    const sum = axis.reduce((a, k) => a + b[name][k].ended, 0);
    if (sum !== b.ended) throw new Error(`${name} 합계(${sum})가 ended(${b.ended})와 다르다`);
  }
  return b;
}

// 하루 24시간 중 종료건이 0인 시간의 수. 경매는 하루 종일 끝나므로 연속 공백은 수집 누락 신호다.
// 시간 정보가 없는 아카이브(구 포맷)는 0 을 돌려 기존 판정을 바꾸지 않는다.
function hourGap(sales) {
  const h = new Array(24).fill(0);
  let known = 0;
  for (const s of sales || []) {
    const t = s.endedAt || s.ended || s.endTime;
    if (!t) continue;
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) continue;
    h[d.getUTCHours()] += 1; known += 1;
  }
  if (known < 50) return 0;   // 표본이 얇으면 시간 분포로 판정하지 않는다
  return h.filter((x) => x === 0).length;
}

function main() {
  if (!fs.existsSync(ARCHIVE)) throw new Error("auction-archive 폴더가 없다");
  const files = fs.readdirSync(ARCHIVE).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) throw new Error("아카이브가 비어 있다");

  // 주봉·월봉은 일봉을 더해서 만들 수 없다 — 중앙값은 더해지지 않는다.
  // 그래서 원본 낙찰건을 날짜별로 들고 있다가 구간마다 다시 계산한다(전 기간 1만여 건, 비용은 무시할 수준).
  const byDay = new Map();
  for (const f of files) {
    const day = f.slice(0, 10);
    byDay.set(day, JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || []);
  }

// 공백이 이만큼 넘으면 그 날의 **비율·가격 지표를 비운다**(건수는 남긴다) — 2026-08-31 신설.
//
// 왜 표시만으로 부족한가: partial 플래그는 이미 달고 있었지만, 공개 CSV 를 받아가는 쪽은
// 대개 플래그를 안 본다. 그러면 수집 구멍이 '그날의 시장'으로 인용된다.
//
// 임계값 12시간의 근거(2026-08-31 실측, 40일):
//   공백 없는 30일 낙찰률 32.0% · 공백 1~11시간 9일 27~34%(정상 범위)
//   공백 17시간 하루만 56.3% — 여기서 깨진다.
// 왜 낙찰률만 올라가나: 종료된 경매를 나중에 조회해 정산하는데, eBay 는 팔린 항목을
// 유찰된 항목보다 오래 보여준다. 조회가 늦어질수록 유찰이 먼저 사라져 분모가 깎인다.
// 그래서 건수는 줄고 낙찰률만 튄다 — 8/27 이 357건에 56.3% 였던 이유다.
const GAP_VOID_HOURS = 12;

function voidRates(b, gapHours, day) {
  if (!(gapHours > GAP_VOID_HOURS)) return b;
  // 건수(ended/sold/unsold/amount)는 '우리가 확인한 수'로서 여전히 사실이다. 남긴다.
  // 비율과 가격은 그 표본이 하루를 대표한다는 전제 위에서만 뜻이 있다 — 그 전제가 깨졌으니 비운다.
  // 축(카테고리 키)은 남기고 값만 비운다. 축 자체를 없애면 "그날 그 카테고리가 없었다"로 읽히고,
  // 가드 A2 도 축 누락으로 잡는다 — 2026-08-31 실측.
  const blankPrice = b.price ? Object.fromEntries(Object.keys(b.price).map((k) => [k, { n: b.price[k].n, p25: null, med: null, p75: null }])) : b.price;
  const blankBidders = b.bidders ? Object.fromEntries(Object.keys(b.bidders).map((k) => [k, null])) : b.bidders;
  return { ...b, sellThrough: null, price: blankPrice, bidders: blankBidders, bids: null, ratesVoided: true };
}

  const daily = [...byDay.entries()].map(([day, sales]) => {
    const b = stats(sales);
    return {
      d: day,
      // 두 가지를 다 partial 로 본다:
      //  (1) 수집이 덜 돈 날(400건 미만)
      //  (2) **오늘** — 아직 안 끝난 날이다. 2026-08-24 실측: 낮 시점 카드 낙찰률 49.5% 인데
      //      완결일은 26% 대다(경매는 하루 종일 종료되고, 낙찰된 건이 먼저 원장에 들어온다).
      //      건수 임계값만으로는 못 잡는다 — 그날 591건이라 400을 넘겨 완결로 나갔고,
      //      그 왜곡된 하루가 공개 CSV 에 그대로 실렸다.
      // 세 가지를 다 partial 로 본다:
      //  (1) 수집이 덜 돈 날(400건 미만)
      //  (2) 오늘 — 아직 안 끝난 날
      //  (3) **시간 공백** — 경매는 24시간 내내 종료되므로 종료건이 0인 시간대가 길면 그 구간을 못 받은 것이다.
      //      건수 임계값만으로는 못 잡는다: 2026-08-22 는 UTC 03~08시 5시간이 0건인데 총 813건이라
      //      400 을 넘겨 완결일로 발행됐다(이웃날 같은 시간대는 142~255건). 그 낙찰률이 공개 CSV 에 실렸다.
      partial: b.ended < PARTIAL_BELOW || day >= new Date().toISOString().slice(0, 10) || hourGap(sales) >= 2,
      hourGapHours: hourGap(sales),
      gradeTracked: day >= GRADE_SINCE,          // false 면 graded/raw 구분이 없는 날이다
      ...voidRates(b, hourGap(sales), day),
    };
  });

  // 빠진 날짜를 찾아 둔다. 그래프에서 선을 이으면 없는 날이 채워진 것처럼 보인다.
  const gaps = [];
  for (let i = 1; i < daily.length; i += 1) {
    const prev = new Date(`${daily[i - 1].d}T00:00:00Z`);
    const cur = new Date(`${daily[i].d}T00:00:00Z`);
    for (let t = prev.getTime() + 86400000; t < cur.getTime(); t += 86400000) {
      gaps.push(new Date(t).toISOString().slice(0, 10));
    }
  }

  const roll = (keyOf) => {
    const map = new Map();
    for (const [day, sales] of byDay) {
      const k = keyOf(day);
      if (!map.has(k)) map.set(k, { sales: [], days: 0, partialDays: 0, gradeDays: 0 });
      const g = map.get(k);
      g.sales.push(...sales);
      g.days += 1;
      if (sales.length < PARTIAL_BELOW) g.partialDays += 1;
      if (day >= GRADE_SINCE) g.gradeDays += 1;
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, g]) => ({
        d: k, days: g.days, partialDays: g.partialDays, gradeTracked: g.gradeDays === g.days, ...stats(g.sales),
      }));
  };

  const out = {
    basis: "completed eBay auctions for One Piece Card Game items",
    note: "Daily, weekly and monthly rollups built from data/auction-archive (one append-only file per day). A day is flagged partial when fewer auctions were captured than a normal day, and missing days are listed in gaps — neither is silently smoothed over. Item grade is only parsed from listing titles since 2026-07-22, so earlier days carry gradeTracked:false and their graded/raw split is unknown, not zero. Amounts are winning bid x quantity in USD; price holds the 25th, 50th and 75th percentile of the per-card winning price (lot listings divided by their card count), left null below 5 sales because a median of three is not a market; multi-item listings (title says lot, bundle, set of N and so on) get their own lot category instead of being mixed into single cards, and their price is the price of the whole lot, so lot is left out of the all bucket. Listings stored before titles were kept (1,731 rows, all on or before 2026-07-22) cannot be checked for this and stay in raw. bidders and bids are averages over won auctions only, since unsold ones mostly have zero and would drag the mean. byEd splits the same auctions by printing: jp and en come from the listing's own language field or title, and everything else -- other printings and listings we could not read -- falls into other. Edition parsing was rolled out gradually (0% of listings on 2026-07-20, ~85% from 2026-07-30), so edCoverage records how many rows in each bucket actually carry a printing, and edTracked is false wherever that is under 70% -- there, other means unread, not foreign.",
    builtFrom: { first: daily[0].d, last: daily[daily.length - 1].d, files: files.length },
    gradeSince: GRADE_SINCE,
    minPriceSample: MIN_PRICE_N,
    edMinCoverage: ED_MIN_COVERAGE,
    gaps,
    daily,
    weekly: roll(isoWeekStart),
    monthly: roll((d) => `${d.slice(0, 7)}-01`),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`, "utf8");
  const last = daily[daily.length - 1];
  console.log(JSON.stringify({
    status: "ok",
    days: daily.length, weeks: out.weekly.length, months: out.monthly.length,
    partialDays: daily.filter((d) => d.partial).length, gaps: gaps.length,
    ended: daily.reduce((a, d) => a + d.ended, 0),
    amount: Math.round(daily.reduce((a, d) => a + d.amount, 0)),
    lastDay: { d: last.d, medPrice: last.price.all.med, bidders: last.bidders.all, ed: Object.fromEntries(EDS.map((e) => [e, last.byEd[e].ended])) },
  }));
}

if (require.main === module) main();
module.exports = { category, edition, isoWeekStart };
