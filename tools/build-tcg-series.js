#!/usr/bin/env node
// TCG 시계열 집계 — 2026-08-07 신설. 화면(일/주/월 토글)이 읽을 파일 하나를 굽는다.
//
// 두 갈래 원본을 합친다:
//   data/tcg-snapshot.json  … 하루 한 번 찍은 "지금 걸려 있는 물량"(경매·즉시구매) — 재고 지표
//   data/tcg-archive/*.json … 끝난 경매를 재조회한 결과(낙찰 여부·낙찰가) — 거래 지표
//
// 왜 나눠 두고 여기서 합치나: 성격이 다르다. 물량은 그 순간의 사진이고 더할 수 없다(어제 걸린 게
// 오늘도 걸려 있다 — 주봉에서 7일치를 더하면 같은 매물을 일곱 번 세는 꼴이다). 그래서
// **물량은 평균**을 내고, **거래는 합**을 낸다. 이 구분을 틀리면 주봉·월봉이 통째로 거짓말이 된다.
//
// ⚠️ 여기 나오는 어떤 값도 "그 게임의 시장 규모"가 아니다. eBay 한 채널이고, 즉시구매는 건수만 알 뿐
//    팔렸는지는 모른다. 게임끼리 비교는 같은 잣대라 유효하다 — 그 용도로만 쓴다.
// Run: node tools/build-tcg-series.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SNAP = path.join(ROOT, "data", "tcg-snapshot.json");
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
const OUT = path.join(ROOT, "data", "tcg-series.json");

// 낙찰률을 이 표본 미만으로 내놓지 않는다. 20건짜리 비율은 한두 건에 통째로 흔들린다.
const MIN_RATE_N = 20;

const round = (n, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const isoWeek = (day) => {
  const t = new Date(`${day}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  return t.toISOString().slice(0, 10);
};
const median = (a) => {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y);
  return round(s[Math.floor(s.length / 2)]);
};

function main() {
  if (!fs.existsSync(SNAP)) throw new Error("tcg-snapshot.json 이 없다");
  const snap = JSON.parse(fs.readFileSync(SNAP, "utf8"));
  const terms = snap.terms || {};
  const keys = Object.keys(terms);

  // 거래(정산) 원본 — 하루별 게임별로 모은다
  const sales = new Map();   // day -> game -> {ended, sold, amount, prices[]}
  if (fs.existsSync(ARCHIVE)) {
    for (const f of fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
      const day = f.slice(0, 10);
      for (const s of (JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || [])) {
        if (!sales.has(day)) sales.set(day, new Map());
        const m = sales.get(day);
        if (!m.has(s.g)) m.set(s.g, { ended: 0, sold: 0, amount: 0, prices: [] });
        const b = m.get(s.g);
        b.ended += 1;
        if (!s.sold) continue;
        b.sold += 1;
        // 통화가 USD 가 아니면 금액에서 뺀다 — 환산해 섞으면 어느 시점 환율인지 알 수 없는 값이 된다.
        if (s.currency === "USD" && s.price > 0) { b.amount += s.price; b.prices.push(s.price); }
      }
    }
  }

  const days = [...new Set([...snap.points.map((p) => p.d), ...sales.keys()])].sort();

  const rowFor = (dayList) => {
    const games = {};
    for (const k of keys) {
      // 물량(재고)은 평균 — 스냅샷은 그 순간의 사진이라 더하면 같은 매물을 여러 번 세게 된다.
      const shots = dayList.map((d) => (snap.points.find((p) => p.d === d)?.games || []).find((g) => g.k === k)).filter(Boolean);
      const avg = (fn) => {
        const v = shots.map(fn).filter((x) => Number.isFinite(x));
        return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
      };
      // 거래(낙찰)는 합 — 이건 기간 안에 실제로 일어난 사건이라 더하는 게 맞다.
      let ended = 0, sold = 0, amount = 0, prices = [];
      for (const d of dayList) {
        const b = sales.get(d)?.get(k);
        if (!b) continue;
        ended += b.ended; sold += b.sold; amount += b.amount; prices = prices.concat(b.prices);
      }
      games[k] = {
        live: avg((g) => g.live),
        liveFixed: avg((g) => g.liveFixed),
        bidRate: avg((g) => g.bidRate),
        ended, sold,
        // 표본이 얇으면 비율을 만들지 않는다. n 은 항상 같이 실어 무게를 독자가 판단하게 한다.
        sellThrough: ended >= MIN_RATE_N ? round(sold / ended * 100) : null,
        amount: round(amount),
        medPrice: prices.length >= 5 ? median(prices) : null,
        priceN: prices.length,
      };
    }
    return games;
  };

  const group = (keyOf) => {
    const m = new Map();
    for (const d of days) {
      const k = keyOf(d);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(d);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([k, list]) => ({ d: k, days: list.length, games: rowFor(list) }));
  };

  const out = {
    basis: "eBay listings and settled auctions by trading card game",
    note: "Two different kinds of number live here, and they are combined differently. live and liveFixed are how many listings were open when we looked, so a week is the AVERAGE of its days -- adding them would count the same listing every day it stayed up. ended, sold and amount are things that happened inside the period, so a week is the SUM. Sell-through is left null under 20 settled auctions and medPrice under 5, because a rate built on a handful of listings is noise. None of this is the size of a game's market: eBay is one channel, fixed-price listings are counted but we cannot see whether they sold, and shipping is excluded. What it is good for is comparing games with each other, since every game is measured the same way. Terms: this dataset is published by opboxindex.com. You may quote figures with a visible link back to opboxindex.com. Bulk copying, redistribution, or resale of these files is not permitted.",
    games: terms,
    minRateSample: MIN_RATE_N,
    builtFrom: { first: days[0] || null, last: days[days.length - 1] || null, days: days.length },
    daily: days.map((d) => ({ d, days: 1, games: rowFor([d]) })),
    weekly: group(isoWeek),
    monthly: group((d) => `${d.slice(0, 7)}-01`),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`, "utf8");
  const last = out.daily[out.daily.length - 1];
  console.log(JSON.stringify({
    status: "ok", days: days.length, weeks: out.weekly.length, months: out.monthly.length, games: keys.length,
    lastDay: last ? last.d : null,
    settled: keys.reduce((a, k) => a + (last?.games[k]?.ended || 0), 0),
  }, null, 1));
}

if (require.main === module) main();
module.exports = { isoWeek };
