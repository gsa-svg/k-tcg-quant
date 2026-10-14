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
const { tcgOffHour, TCG_SNAPSHOT_STD_HOURS } = require("./tcg-config");
const { readSeenFix, sampleOf } = require("./build-tcg-archive-seen");
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

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

  // 거래(정산) 원본 — 하루별(원장 = 종료일) 게임별로 모은다.
  // 표본(base)과 여유분(extra)을 나눈다 — 2026-10-14. ended·sold·sellThrough·amount·medPrice 는 표본만이다. 여유분은 남는
  // 쿼터로 다른 UTC 회차에 고른 종료 임박 경매라 표본과 섞이면 낙찰률이 그날 쿼터 사정을 따라 흔들린다(큰 게임 n 의 변동계수
  // 23% → 34%). 섞인 값을 ai-data 등 소비자가 그대로 썼다. 여유분은 extraEnded·extraSold·extraAmount 로 따로 싣는다.
  // 표본일(seen)별 회수 — 그날 표본 중 몇 건을 종료 후 읽었나(sampleSettled). 원장 날짜(종료일)가 아니라 표본을 고른 날로 센다.
  // seen 은 행의 seen(2026-10-14~) → 보정 파일(data/tcg-archive-seen.json, git 감시 이력에서 복원) → 원장 날짜 순.
  // 그날 표본에 들었는데 이미 여유분으로 감시 중이라 원장에 extra 로 남은 행(보정 파일 promoted)은 표본으로 센다 — 2026-10-14 QA:
  // 빠진 쪽이 무작위가 아니라 표본의 가장 먼저 끝나는 앞부분이었다(10/12 unionarena 79건). 판정은 sampleOf 한 곳에서.
  const fix = readSeenFix(ROOT);
  const { sampled } = fix;
  const sales = new Map();   // day -> game -> {ended, sold, amount, prices[], extraEnded, extraSold, extraAmount}
  const bySeen = new Map();  // 표본일 -> game -> 정산된 표본 수
  if (fs.existsSync(ARCHIVE)) {
    for (const f of fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
      const day = f.slice(0, 10);
      for (const s of (JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || [])) {
        if (!sales.has(day)) sales.set(day, new Map());
        const m = sales.get(day);
        if (!m.has(s.g)) m.set(s.g, { ended: 0, sold: 0, amount: 0, prices: [], extraEnded: 0, extraSold: 0, extraAmount: 0 });
        const b = m.get(s.g);
        // 통화가 USD 가 아니면 금액에서 뺀다 — 환산해 섞으면 어느 시점 환율인지 알 수 없는 값이 된다.
        const usd = s.sold && s.currency === "USD" && s.price > 0 ? s.price : null;
        const smp = sampleOf(s, day, fix);
        if (!smp.base) {
          b.extraEnded += 1;
          if (s.sold) b.extraSold += 1;
          if (usd != null) b.extraAmount += usd;
          continue;
        }
        const seenDay = smp.seen;
        if (!bySeen.has(seenDay)) bySeen.set(seenDay, new Map());
        bySeen.get(seenDay).set(s.g, (bySeen.get(seenDay).get(s.g) || 0) + 1);
        b.ended += 1;
        if (!s.sold) continue;
        b.sold += 1;
        if (usd != null) { b.amount += usd; b.prices.push(usd); }
      }
    }
  }

  const days = [...new Set([...snap.points.map((p) => p.d), ...sales.keys()])].sort();
  // 표준 시각(tcg-config TCG_SNAPSHOT_STD_HOURS) 밖에서 찍힌 날 — 2026-10-13. 그날 고른 표본은 다른 시각의 "종료 임박 순"
  // 이라 낙찰률이 낮게 나온다(10/8~10/10). 표본 일부는 다음 날 원장으로 넘어간다(tcg-config 주석).
  // 여기서는 표시만 한다: 합계·비율은 그대로 두고, 빼는 판단은 화면이 한다(원장 seen 이 있으면 그 날짜 기준).
  // at 이 없는 날(스냅샷 없이 정산만 있는 날)은 표시하지 않는다 — 모르는 걸 지어내지 않는다.
  const offDays = new Set(snap.points.filter((p) => tcgOffHour(p.at) === true).map((p) => p.d));

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
      let ended = 0, sold = 0, amount = 0, prices = [], extraEnded = 0, extraSold = 0, extraAmount = 0;
      for (const d of dayList) {
        const b = sales.get(d)?.get(k);
        if (!b) continue;
        ended += b.ended; sold += b.sold; amount += b.amount; prices = prices.concat(b.prices);
        extraEnded += b.extraEnded; extraSold += b.extraSold; extraAmount += b.extraAmount;
      }
      games[k] = {
        live: avg((g) => g.live),
        liveFixed: avg((g) => g.liveFixed),
        // 그날 실제로 끝난 경매 수(eBay 가 알려준 값). live 와 달리 기간 안에서 일어난 일이라
        // 주·월은 평균이 아니라 합이어야 맞지만, 스냅샷을 하루 한 번만 찍으므로 여기서는 일별 값만 쓴다.
        // 우리가 종료 후 실제로 확인한 수(ended)와는 다른 값이다 — 그쪽이 훨씬 작다.
        endingToday: avg((g) => g.endingToday),
        bidRate: avg((g) => g.bidRate),
        ended, sold,
        // 표본이 얇으면 비율을 만들지 않는다. n 은 항상 같이 실어 무게를 독자가 판단하게 한다.
        sellThrough: ended >= MIN_RATE_N ? round(sold / ended * 100) : null,
        amount: round(amount),
        medPrice: prices.length >= 5 ? median(prices) : null,
        priceN: prices.length,
        // 여유분 — 표본과 따로(비율은 만들지 않는다: 회차·쿼터 사정으로 고른 시각이 날마다 다르다)
        extraEnded, extraSold, extraAmount: round(extraAmount),
      };
    }
    return games;
  };

  // 일별 표본 회수 — sampleWatched = 그날 표본으로 감시에 넣은 수(스냅샷 games[].watched, 그 전 날은 보정 파일 sampled,
  // 둘 다 없으면 null = 모름), sampleSettled = 그중 종료 후 읽은 수(표본일 기준). 시한(종료 + 30시간)을 넘겨 못 읽은 표본은
  // 그날 원장 합계(ended)에선 다른 날 종료분에 묻혀 안 보인다 — 표본일로 세야 드러난다(audit-series-gaps).
  const withSample = (d, games) => {
    const shot = snap.points.find((p) => p.d === d);
    const recorded = (shot?.games || []).some((g) => Number.isFinite(g?.watched));
    for (const k of keys) {
      const w = recorded ? (shot.games.find((g) => g.k === k)?.watched ?? 0) : sampled[d] ? (sampled[d][k] || 0) : null;
      games[k].sampleWatched = w;
      games[k].sampleSettled = bySeen.get(d)?.get(k) || 0;
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
      .map(([k, list]) => ({ d: k, days: list.length, offHourDays: list.filter((d) => offDays.has(d)).length, games: rowFor(list) }));
  };

  const out = {
    basis: "eBay listings and settled auctions by trading card game",
    note: "Three different kinds of number live here. endingToday is how many auctions eBay says close within 24 hours -- a real count, not a sample -- while ended/sold are the ones we actually re-read after close, which is a small fraction of that. ended, sold, sellThrough, amount, medPrice and priceN cover the daily sample only -- the auctions ending soonest when that day's snapshot was taken, including the ones already being watched as extras at that moment (before 2026-10-15 those are restored from the watch-list history as a lower bound, so a few of the earliest-closing sample auctions may still sit with the extras); extraEnded, extraSold and extraAmount are the other extra auctions read with leftover quota, picked at other hours, kept apart and never mixed into the rates. On a daily row, sampleWatched is how many auctions were in that day's sample (null when not recorded) and sampleSettled how many of them were read back after close, counted by the day the sample was picked rather than the day it closed. live and liveFixed are how many listings were open when we looked, so a week is the AVERAGE of its days -- adding them would count the same listing every day it stayed up. ended, sold and amount are things that happened inside the period, so a week is the SUM. Sell-through is left null under 20 settled auctions and medPrice under 5, because a rate built on a handful of listings is noise. None of this is the size of a game's market: eBay is one channel, fixed-price listings are counted but we cannot see whether they sold, and shipping is excluded. What it is good for is comparing games with each other, since every game is measured the same way. offHour marks a day whose snapshot -- and so its settled sample, the auctions ending soonest at that moment -- was taken outside " + hh(TCG_SNAPSHOT_STD_HOURS.from) + "-" + hh(TCG_SNAPSHOT_STD_HOURS.to) + " UTC; offHourDays counts those days in a week or month, and the sums still include them. Terms of use: https://opboxindex.com/free-data.html#terms",
    games: terms,
    minRateSample: MIN_RATE_N,
    builtFrom: { first: days[0] || null, last: days[days.length - 1] || null, days: days.length },
    daily: days.map((d) => ({ d, days: 1, ...(offDays.has(d) ? { offHour: true } : {}), games: withSample(d, rowFor([d])) })),
    weekly: group(isoWeek),
    monthly: group((d) => `${d.slice(0, 7)}-01`),
  };

  fs.writeFileSync(OUT, `${JSON.stringify(out)}\n`, "utf8");
  const last = out.daily[out.daily.length - 1];
  console.log(JSON.stringify({
    status: "ok", days: days.length, weeks: out.weekly.length, months: out.monthly.length, games: keys.length,
    lastDay: last ? last.d : null,
    offHourDays: [...offDays].sort(),
    settled: keys.reduce((a, k) => a + (last?.games[k]?.ended || 0), 0),
  }, null, 1));
}

if (require.main === module) main();
module.exports = { isoWeek };
