#!/usr/bin/env node
// tcg-auction.html — 카드게임 전체의 경매 시장 페이지 — 2026-09-01 신설.
//
// ── 왜 원피스와 나누나 (소유자 지시)
// 원피스는 유형별로 깊게(싱글·박스·팩), 나머지 TCG 는 넓게(거래액·낙찰률·유찰률·
// 진행 중·종료 건수) 본다. 한 페이지에 섞으면 둘 다 어중간해진다.
//
// ── 데이터
//   data/tcg-series.json   게임 × 날짜: ended/sold/amount/medPrice + live/endingToday
//   data/tcg-snapshot.json 그날 eBay 가 직접 알려준 진행 중·오늘 종료 수(표본이 아니라 실제 수)
// 낙찰률은 우리가 종료 후 다시 읽어 확인한 것만 쓴다. 게임마다 하루 최대 250건을 같은 잣대로 훑는
// 횡단 표본이라, 원피스 전용 수집(하루 1,000건대)과 수치가 다르다 — 그 사실을 화면에 적는다.
//
// ⚠️ 순위표를 만들되 "어느 게임이 좋다"는 판정은 하지 않는다. 정렬은 규모(종료 건수) 순이다.
// Run: node tools/generate-tcg-auction-page.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const OUT = path.join(ROOT, "tcg-auction.html");
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const { navHtml } = require("./site-nav");
const { EXCLUDED_TCG_KEYS } = require("./tcg-config");
const { visibleTrendRows } = require("./tcg-trend-model");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("en-US"));
const usd = (n) => (n == null || !isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

const series = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-series.json"), "utf8"));
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-snapshot.json"), "utf8"));

const MIN_ENDED = 100;      // 낙찰률을 말하려면 이만큼은 확인했어야 한다
const MIN_PRICE_N = 20;     // 중앙 낙찰가를 말하려면 낙찰 건수가 이만큼

// 게임별 중앙 낙찰가는 원장에서 직접 낸다 — 2026-09-01 정정.
// 종전에는 일별 중앙값들을 다시 중앙값 냈는데, 그건 그 기간의 중앙값이 아니다.
// 실측 차이: Union Arena $20.50(실제 $28.00, +37%) · Weiss Schwarz $28.00(실제 $21.50, -23%).
// 하루 표본이 게임당 최대 250건이라 일별 중앙값이 크게 흔들리고, 그것들을 다시 중앙값 내면
// 원래 분포와 상관없는 수가 남는다. 낙찰 건을 한 줄로 세워 자르는 것만이 중앙값이다.
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
const ledgerPrices = {};
for (const f of fs.readdirSync(ARCHIVE).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  const day = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8"));
  for (const r of day.sales || []) {
    if (!r || r.sold !== true || !Number.isFinite(r.price)) continue;
    (ledgerPrices[r.g] = ledgerPrices[r.g] || []).push(r.price);
  }
}
const ledgerMed = (key) => {
  const a = (ledgerPrices[key] || []).slice().sort((x, y) => x - y);
  return a.length ? a[Math.floor((a.length - 1) / 2)] : null;
};
const ledgerN = (key) => (ledgerPrices[key] || []).length;

const days = (series.daily || []).filter((d) => d && d.games);
if (days.length < 3) throw new Error("TCG 시계열이 너무 짧다 — 페이지를 만들지 않는다");
const from = days[0].d, to = days[days.length - 1].d;

// 게임별 합계(기간 전체)
const names = snapshot.terms || {};

// 화면 제외 — 2026-09-03 소유자 지시("수집하지 말고 제외시켜"). 수집 목록(collect-tcg-snapshot)에서
// 뺀 네 게임을 화면에서도 뺀다. 안 빼면 수집이 멈춘 게임이 죽어가는 데이터로 표에 계속 남는다.
// 원장(tcg-archive)의 과거 기록은 그대로다 — 목록에 되넣으면 이어진다.
const EXCLUDED_GAMES = new Set(EXCLUDED_TCG_KEYS);
const agg = {};
for (const day of days) {
  for (const [key, g] of Object.entries(day.games)) {
    const a = (agg[key] = agg[key] || { ended: 0, sold: 0, amount: 0, live: null, endingToday: null, liveFixed: null });
    a.ended += g.ended || 0;
    a.sold += g.sold || 0;
    a.amount += g.amount || 0;
    // (일별 중앙값은 모으지 않는다 — 중앙값의 중앙값은 중앙값이 아니다. 위 ledgerMed 참고)
    // 진행 중 수는 그날 값이라 마지막 날 것을 쓴다(합산하면 같은 매물을 여러 번 센다).
    if (Number.isFinite(g.live)) a.live = g.live;
    if (Number.isFinite(g.endingToday)) {
      a.endingToday = g.endingToday;               // 마지막 날 값(표에 그대로 싣는다)
      a.endingSum = (a.endingSum || 0) + g.endingToday;   // 평균용 누적
      a.endingDays = (a.endingDays || 0) + 1;
    }
    if (Number.isFinite(g.liveFixed)) a.liveFixed = g.liveFixed;
  }
}

const rows = Object.entries(agg)
  .map(([key, a]) => {
    const meta = names[key] || {};

    return {
      key,
      name: meta.name || key,
      ended: a.ended,
      sold: a.sold,
      unsold: a.ended - a.sold,
      // 표본이 얇으면 비율을 내보내지 않는다 — 빈 값이 흔들리는 숫자보다 낫다.
      sellThrough: a.ended >= MIN_ENDED ? Math.round((a.sold / a.ended) * 1000) / 10 : null,
      passThrough: a.ended >= MIN_ENDED ? Math.round(((a.ended - a.sold) / a.ended) * 1000) / 10 : null,
      amount: a.amount,
      medPrice: ledgerN(key) >= MIN_PRICE_N ? ledgerMed(key) : null,
      live: a.live,
      endingToday: a.endingToday,
      endingAvg: a.endingDays ? a.endingSum / a.endingDays : null,
      liveFixed: a.liveFixed,
    };
  })
  .filter((r) => r.ended > 0 && !EXCLUDED_GAMES.has(r.key))
  .sort((a, b) => b.ended - a.ended);

const totEnded = rows.reduce((t, r) => t + r.ended, 0);
const totSold = rows.reduce((t, r) => t + r.sold, 0);
const totAmount = rows.reduce((t, r) => t + r.amount, 0);
const totLive = rows.reduce((t, r) => t + (r.live || 0), 0);
const totEndingToday = rows.reduce((t, r) => t + (r.endingToday || 0), 0);

// ── 게임별 흐름 시계열 — 2026-09-02 소유자 제안("표는 하루 지나면 사라지는 데이터").
// tcg-series 의 일별×게임 기록을 그대로 싣는다. live/ending 은 eBay 가 알려준 실제 수,
// ended/sold/rate 는 우리 정산 표본, med 는 그날 낙찰가 중앙값(표본 5건 미만이면 비움).
// ── 게임별 흐름: 일·주·월 — 2026-09-03 소유자 지시("이것도 일봉·주봉·월봉으로 다 만들어야지").
// live/ending 은 eBay 가 알려준 실제 수, ended/sold 는 우리 정산 표본.
// 주·월의 낙찰가 중앙값은 원장(tcg-archive)에서 그 기간 낙찰 건을 한 줄로 세워 다시 자른다 —
// 일별 중앙값을 평균 내면 중앙값이 아니다(원피스 페이지와 같은 원칙).
const ledgerByGameDay = {};
// ⚠️ 정규식의 \d 는 셸을 거치면 d 로 깨진다 — 오늘만 두 번째다(collect-status 그물, 여기).
//    이 파일을 스크립트로 패치할 때는 반드시 Edit 도구로 쓰거나, 쓰고 나서 \d 가 살아있는지 확인할 것.
for (const f of fs.readdirSync(ARCHIVE).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  const day = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8"));
  for (const r of day.sales || []) {
    if (!r || r.sold !== true || !Number.isFinite(r.price)) continue;
    const d = (r.endedAt || f.slice(0, 10)).slice(0, 10);
    ((ledgerByGameDay[r.g] = ledgerByGameDay[r.g] || {})[d] = ledgerByGameDay[r.g][d] || []).push(r.price);
  }
}
const weekKeyOf = (d) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const midOf = (arr) => { const q = arr.slice().sort((x, y) => x - y); return q[Math.floor((q.length - 1) / 2)]; };

const trendGames = {};
for (const day of days) {
  for (const [key, g] of Object.entries(day.games || {})) {
    if (EXCLUDED_GAMES.has(key)) continue;
    const t = (trendGames[key] = trendGames[key] || { name: (names[key] || {}).name || key, daily: [] });
    t.daily.push({
      d: day.d, ax: day.d.slice(5).replace("-", "/"),
      live: Number.isFinite(g.live) ? g.live : null,
      ending: Number.isFinite(g.endingToday) ? g.endingToday : null,
      ended: g.ended || 0, sold: g.sold || 0,
      rate: Number.isFinite(g.sellThrough) ? g.sellThrough : null,
      gmv: Math.round(g.amount || 0),
      med: Number.isFinite(g.medPrice) && (g.priceN || 0) >= 5 ? g.medPrice : null,
    });
  }
}
// 주·월 접기. 스냅샷 성격(live)은 평균, 유량(ending/ended/sold/gmv)은 합, 비율은 합에서 다시 계산.
function foldTrend(dailyRows, keyOf, labOf, axOf, gameKey) {
  const buckets = new Map();
  for (const r of dailyRows) {
    const k = keyOf(r.d);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const keys = [...buckets.keys()].sort();
  return keys.map((k, i) => {
    const rs = buckets.get(k);
    const known = (f) => rs.map((r) => r[f]).filter((v) => v != null && isFinite(v));
    const sum = (f) => { const v = known(f); return v.length ? v.reduce((x, y) => x + y, 0) : null; };
    const ended = rs.reduce((x, r) => x + (r.ended || 0), 0);
    const sold = rs.reduce((x, r) => x + (r.sold || 0), 0);
    const prices = [];
    for (const r of rs) for (const p of (ledgerByGameDay[gameKey] || {})[r.d] || []) prices.push(p);
    return {
      d: labOf(k), ax: axOf(k),
      p: i === keys.length - 1 ? 1 : 0,          // 마지막 기간은 아직 차는 중
      live: known("live").length ? Math.round(sum("live") / known("live").length) : null,
      ending: sum("ending"),
      ended, sold,
      rate: ended >= 30 ? Math.round((sold / ended) * 1000) / 10 : null,
      gmv: rs.reduce((x, r) => x + (r.gmv || 0), 0),
      med: prices.length >= 5 ? midOf(prices) : null,
    };
  });
}
for (const [key, t] of Object.entries(trendGames)) {
  t.weekly = foldTrend(t.daily, weekKeyOf, (k) => "Week of " + k.slice(5).replace("-", "/"), (k) => k.slice(5).replace("-", "/"), key);
  t.monthly = foldTrend(t.daily, (d) => d.slice(0, 7), (k) => k, (k) => k.slice(2), key);
}
const trendOrder = rows.map((r) => r.key).filter((k) => trendGames[k]);
const tcgTrendJson = JSON.stringify({ order: trendOrder, games: trendGames });

// ── 커버리지 — 2026-09-02 추가. 이것 없이 거래액을 나란히 놓으면 순위가 거꾸로 읽힌다.
// 게임마다 하루 최대 250건씩 같은 잣대로 훑는데, 그 게임이 하루에 끝내는 총 건수는
// 포켓몬 42,363건 · Riftbound 167건으로 250배 차이난다. 그래서 우리가 담는 비율이
// 0.4% ~ 63% 로 벌어지고, 거래액 합계는 '시장 규모'가 아니라 '우리가 얼마나 봤는가'가 된다.
// 실제로 Riftbound 가 포켓몬의 12배로 나와 시장이 그만큼 크다는 오해를 샀다.
// 낙찰률·중앙 낙찰가는 표본이어도 견디지만 합계는 그렇지 않다 — 그 차이를 화면에 적는다.
const dayCount = days.length || 1;
for (const r of rows) {
  const perDayEnding = r.endingAvg;   // 기간 평균(마지막 날 하나는 크게 흔들린다)
  const ourPerDay = r.ended / dayCount;
  // 분모(오늘 종료 예정)는 조회 시점의 스냅샷이라, 그 뒤에 올라온 단기 경매는 못 센다.
  // 작은 게임(하루 수십 건)에서는 우리 정산 수가 그 스냅샷을 넘을 수 있어 100%가 넘게 나온다 —
  // 그건 '사실상 전수'라는 뜻이므로 ≈100% 로 표기한다(숫자가 100을 넘는 채로 두면 오해를 부른다).
  const rawPct = Number.isFinite(perDayEnding) && perDayEnding > 0
    ? Math.round((ourPerDay / perDayEnding) * 1000) / 10
    : null;
  r.covApprox = rawPct != null && rawPct > 100;
  r.coveragePct = rawPct == null ? null : Math.min(100, rawPct);
}
// 커버리지가 이만큼 벌어지면 합계를 나란히 놓는 것 자체가 오해를 부른다.
const covs = rows.map((r) => r.coveragePct).filter((x) => x != null);
const covSpread = covs.length >= 2 ? Math.max(...covs) / Math.max(0.1, Math.min(...covs)) : 1;

// 막대차트가 읽는 형태로 변환한다(원피스 페이지에서 쓰던 것과 같은 필드).
const chartRows = rows.map((r) => ({
  key: r.key,
  name: r.name,
  n: r.ended,
  sold: r.sold,
  rate: r.sellThrough == null ? null : r.sellThrough,
  gmv: Math.round(r.amount),
  cov: r.coveragePct,
  covA: r.covApprox ? 1 : 0,
  ending: r.endingToday || 0,
  live: r.live || 0,
  isOp: r.key === "onepiece",
}));
const chartJson = JSON.stringify(chartRows);


const tableRows = rows.map((r) => `          <tr>
            <td class="tgName">${esc(r.name)}</td>
            <td>${num(r.live)}</td>
            <td>${num(r.endingToday)}</td>
            <td>${num(r.ended)}</td>
            <td>${r.sellThrough == null ? "—" : r.sellThrough + "%"}</td>
            <td>${r.passThrough == null ? "—" : r.passThrough + "%"}</td>
            <td class="cov">${r.coveragePct == null ? "—" : (r.covApprox ? "≈100%" : r.coveragePct + "%")}</td>
            <td>${usd(r.amount)}</td>
            <td>${r.medPrice == null ? "—" : usd(r.medPrice)}</td>
          </tr>`).join("\n");

const ld = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Trading card game auction results by game",
  description: `Settled eBay auction outcomes across ${rows.length} trading card games: ended and sold counts, sell-through and pass-through rates, hammer value and median winning bid.`,
  isAccessibleForFree: true,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  temporalCoverage: `${from}/${to}`,
  dateModified: series.updated || to,
  variableMeasured: ["Live auctions", "Auctions ending today", "Ended auctions", "Sell-through rate", "Pass-through rate", "Hammer value", "Median winning bid"],
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${SITE}/tcg-auction.html" />
    <title>TCG Auction Data — What Sells and For How Much, by Card Game | OP Box Index</title>
    <meta name="description" content="Settled eBay auction results across ${rows.length} trading card games: how many auctions run, what share sells, what passes unsold, and how much money changes hands. Every auction is read again after it closes." />
    <meta property="og:title" content="TCG Auction Data — What Sells, by Card Game" />
    <meta property="og:description" content="Ended, sold, unsold and hammer value across ${rows.length} card games, from auctions we settle ourselves." />
    <meta property="og:url" content="${SITE}/tcg-auction.html" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <script type="application/ld+json">${ld}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .tgTable { width: 100%; border-collapse: collapse; font-size: 13.5px; }
      .tgTable th, .tgTable td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.07); text-align: right; white-space: nowrap; }
      .tgTable th { color: #8d95a7; font-weight: 700; font-size: 12px; text-align: right; }
      .tgTable th:first-child, .tgTable td:first-child { text-align: left; }
      .tgName { color: #eef2ff; font-weight: 700; }
      .tgStats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 18px 0 6px; }
      .tgStat { border: 1px solid rgba(255,255,255,.1); border-radius: 12px; padding: 12px 14px; background: rgba(20,23,28,.6); }
      .tgStat b { display: block; font-size: 21px; color: #50dad9; font-family: "JetBrains Mono", monospace; }
      .tgStat small { color: #8d95a7; font-size: 12px; }
      .trendHead { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
      /* 게임 고르는 곳이라는 걸 놓치지 않게 눈에 띄게 만든다 — 2026-09-02 소유자 지적
         ("모르고 지나갈 수도 있어"). 강조색 테두리 + 살짝 빛나는 배경 + 큰 글씨.
         라벨도 위에 붙여 "무엇을 고르는 것인지"를 글로 말한다. */
      .trendPick { display: flex; flex-direction: column; gap: 4px; }
      .trendPick > span { font-size: 12.5px; color: #50dad9; font-weight: 600; letter-spacing: .02em; }
      .trendHead select { font: inherit; font-size: 15px; font-weight: 600; padding: 10px 34px 10px 13px;
        border-radius: 10px; cursor: pointer; appearance: none; -webkit-appearance: none;
        background-color: rgba(80,218,217,.10); color: #eef2ff;
        background-image: url("data:image/svg+xml;charset=utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2350dad9' stroke-width='2.5' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
        background-repeat: no-repeat; background-position: right 10px center; background-size: 16px;
        border: 2px solid #50dad9; box-shadow: 0 0 0 3px rgba(80,218,217,.14); }
      .trendHead select:hover { background-color: rgba(80,218,217,.18); }
      .trendHead select:focus-visible { outline: 3px solid #8af3f2; outline-offset: 2px; }
      /* ⚠️ select 배경을 바꾸면 펼친 목록(option)도 그 배경을 물려받는다. 글자색을 같이 지정하지 않으면
         밝은 바탕에 밝은 글씨가 되어 아무것도 안 보인다(2026-09-03 실제로 그렇게 나갔다).
         option 은 브라우저가 따로 그리므로 배경·글자색을 명시한다. */
      .trendHead select option { background-color: #14171c; color: #eef2ff; font-weight: 500; }
      .trendHead select option:checked { background-color: #1d3b3b; color: #8af3f2; }
      /* 한 문장 요약 — 그래프를 못 읽어도 이것만 읽으면 뜻이 통해야 한다(2026-09-02 소유자 지시). */
      .opPlain { margin: 14px 0 2px; font-size: 17px; line-height: 1.55; color: #eef2ff; }
      .opPlain strong { color: #8af3f2; font-weight: 650; }
      .opPlain .opHelp { display: block; margin-top: 4px; font-size: 13.5px; color: #8d95a7; }
      @media (max-width: 560px) { .opPlain { font-size: 15.5px; } .opPlain .opHelp { font-size: 12.5px; } }
      .opReadout { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 12px 0 8px; font-size: 12.5px; color: #8d95a7; }
      .opReadout b { color: #eef2ff; font-variant-numeric: tabular-nums; }
      .opReadout .hi b { color: #50dad9; }
      .opChart { position: relative; margin-top: 6px; }
      .opBars { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 180px; padding: 0 0 2px; }
      .opCol { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
      .opCol i { display: block; background: #50dad9; border-radius: 4px 4px 0 0; min-height: 2px; }
      .opCol.nul i { background: repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 3px, transparent 3px 6px); border-radius: 4px; }
      .opCol:hover i, .opCol.on i { background: #8af3f2; }
      .opAxis { position: relative; height: 16px; margin-top: 6px; color: #8d95a7; font-size: 11px; }
 /* 눈금선 3줄(0·절반·최고) — 막대 높이를 값으로 읽으려면 기준선이 있어야 한다. */
      .opGuide { position: absolute; inset: 0; pointer-events: none; }
      .opGuide .gLine { position: absolute; left: 0; right: 0; display: block; border-top: 1px dashed rgba(255,255,255,.16); }
      .opGuide .gLine span { position: absolute; right: 0; top: -15px; font-size: 11px; color: #8d95a7;
        background: #0a0c10; padding: 0 4px; font-variant-numeric: tabular-nums; }
      .covWarn { margin: 10px 0 0; padding: 9px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.6;
        background: rgba(255, 202, 110, .08); border: 1px solid rgba(255, 202, 110, .3); color: #f0d9ae; }
      .tgTable td.cov { color: #8d95a7; font-variant-numeric: tabular-nums; }
      .chartCard { border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 12px; margin: 18px 0 8px; background: rgba(255,255,255,.015); }
      .chartHead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
      .chartHead h2 { margin: 0; font-size: 17px; }
      .chartHead .sub { font-size: 12px; color: var(--muted); margin: 0; }
      /* wrap 필수 — 버튼 5개가 한 줄이면 375px 에서 42px 가로로 넘친다(2026-08-26 모바일 실측) */
      .metricTabs { display: flex; gap: 6px; flex-wrap: wrap; }
      /* min-height 44px — 34px 는 모바일 권장 터치 타겟에 못 미쳐 두 줄로 감긴 버튼 사이 오터치가 났다(2026-08-26 감사) */
      .metricTabs button { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; min-height: 44px; }
      .metricTabs button[aria-pressed="true"] { border-color: #14A882; color: #14A882; background: rgba(20,168,130,.1); }
      .metricTabs button:focus-visible { outline: 2px solid #14A882; outline-offset: 2px; }

      .barList { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 4px; }
      .barRow { display: grid; grid-template-columns: minmax(88px,132px) 1fr minmax(62px,78px); align-items: center; gap: 10px; }
      .barName { font-size: 12.5px; color: var(--muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .barRow.me .barName { color: var(--ink); font-weight: 800; }
      .barTrack { height: 16px; background: rgba(255,255,255,.045); border-radius: 4px; overflow: hidden; }
      .barFill { height: 100%; border-radius: 0 4px 4px 0; transition: width .45s cubic-bezier(.22,.61,.36,1); }
      .barVal { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 700; }
      .barRow .ci { color: var(--muted); font-weight: 400; font-size: 11px; }
      .barRow:hover .barName, .barRow:focus-within .barName { color: var(--ink); }

      .legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 10px 0 2px; font-size: 11.5px; color: var(--muted); }
      .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }

      .noteFold { max-width: 760px; margin: 10px 0 0; }
      .noteFold summary { cursor: pointer; font-size: 12.5px; color: var(--muted); padding: 6px 0; }
      .noteFold p { font-size: 12.5px; margin: 4px 0 8px; }
      @media (prefers-reduced-motion: reduce) { .barFill { transition: none; } }
    
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("", "tcg-auction.html", { ariaLabel: "Primary navigation" })}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow" data-ko="TCG 경매 데이터">TCG Auction Data</p>
      <h1 data-ko="카드게임 경매 — 무엇이 팔리고 무엇이 유찰되는가">Card game auctions: what sells and what passes</h1>

      <div class="tgStats">
        <div class="tgStat"><b>${num(totLive)}</b><small data-ko="진행 중인 경매">auctions live now</small></div>
        <div class="tgStat"><b>${num(totEndingToday)}</b><small data-ko="오늘 종료">ending today</small></div>
        <div class="tgStat"><b>${num(totEnded)}</b><small data-ko="확인 수">checked</small></div>
        <div class="tgStat"><b>${totEnded ? Math.round((totSold / totEnded) * 1000) / 10 : "—"}%</b><small data-ko="낙찰률">sold</small></div>
        <div class="tgStat"><b>${usd(totAmount)}</b><small data-ko="거래액">total spent</small></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2 data-ko="하루에 끝나는 카드 경매 수">How many card auctions end each day</h2>
            <p class="sub">${esc(from)}–${esc(to)}</p>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-metric="ending" aria-pressed="true" data-ko="오늘 종료">Ending today</button>
            <button type="button" data-metric="ended" aria-pressed="false" data-ko="확인 수">Checked</button>
            <button type="button" data-metric="sold" aria-pressed="false" data-ko="낙찰 수">Sold</button>
            <button type="button" data-metric="rate" aria-pressed="false" data-ko="낙찰률">Sold %</button>
            <button type="button" data-metric="gmv" aria-pressed="false" data-ko="거래액">Total spent</button>
          </div>
        </div>
        <p class="covWarn" id="tgCovWarn" style="display:none" data-ko="⚠ 이 순위는 시장 규모가 아닙니다. 게임마다 우리가 확인한 비율이 달라서, 합계는 시장 크기가 아니라 우리가 담은 양을 따라갑니다.">⚠ Not market size. We check a different share of each game, so totals follow what we saw, not the market.</p>
        <div class="barList" id="tcgBars"></div>
        <div class="legend" id="tcgLegend"></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2 data-ko="게임별 흐름">One game over time</h2>
            <p class="sub" data-ko="${esc(from)} ~ ${esc(to)}">${esc(from)}–${esc(to)}</p>
          </div>
        </div>
        <div class="trendHead">
          <label class="trendPick" for="trendGame">
            <span data-ko="게임 선택">Pick a game</span>
            <select id="trendGame" aria-label="Game"></select>
          </label>
          <div class="metricTabs" role="group" aria-label="Period">
            <button type="button" data-tp="daily" aria-pressed="true" data-ko="일별">Daily</button>
            <button type="button" data-tp="weekly" aria-pressed="false" data-ko="주별">Weekly</button>
            <button type="button" data-tp="monthly" aria-pressed="false" data-ko="월별">Monthly</button>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-tm="live" aria-pressed="false" data-ko="진행중">Live</button>
            <button type="button" data-tm="ending" aria-pressed="true" data-ko="오늘 종료">Ending today</button>
            <button type="button" data-tm="ended" aria-pressed="false" data-ko="확인 수">Checked</button>
            <button type="button" data-tm="rate" aria-pressed="false" data-ko="낙찰률">Sold %</button>
            <button type="button" data-tm="gmv" aria-pressed="false" data-ko="거래액">Total spent</button>
            <button type="button" data-tm="med" aria-pressed="false" data-ko="낙찰가">Price</button>
          </div>
        </div>
        <div class="opPlain" id="trendPlain" aria-live="polite"></div>
        <div class="opReadout" id="trendReadout" aria-live="polite"></div>
        <div class="opChart" id="trendChart"></div>
      </div>

      <h2 data-ko="게임별 한눈에 보기">Every game side by side</h2>
      <div style="overflow-x:auto">
        <table class="tgTable">
          <thead>
            <tr><th data-ko="게임">Game</th><th data-ko="진행중">Live</th><th data-ko="오늘 종료">Ending today</th><th data-ko="확인 수">Checked</th><th data-ko="낙찰률">Sold %</th><th data-ko="유찰률">Unsold %</th><th data-ko="표본 비율">Coverage</th><th data-ko="거래액">Total spent</th><th data-ko="낙찰가">Price</th></tr>
          </thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
      </div>
      <p style="margin-top:16px;"><a href="free-data.html">Download the raw daily CSVs</a> · <a href="methodology.html">How we count</a></p>
    </main>
<script>
      // 게임별 낙찰률/거래액/물량 막대. dataviz 검증 통과 6색(+중립) — 색은 익숙한 게임을
      // 눈으로 찾게 하는 보조수단이고, 모든 막대에 이름표가 붙어 색만으로 구분하지 않는다.
      (function () {
        var rows = ${chartJson};
        var el = document.getElementById("tcgBars");
        var lg = document.getElementById("tcgLegend");
        if (!el || !rows.length) return;
        var HUE = { onepiece: "#14A882", pokemon: "#3987e5", pokemonjp: "#d95926", magic: "#9085e9", yugioh: "#c98500", lorcana: "#d55181" };
        var GREY = "#5A6273";
        // 막대 라벨 단어는 현재 언어를 따른다. lang-toggle.js 가 <html lang> 을 바꾸므로 그것을 본다.
        var KO = function () { return document.documentElement.lang === "ko"; };
        var W = function (ko, en) { return KO() ? ko : en; };
        var M = {
          ending: { get: function (r) { return r.ending; }, fmt: function (r) { return r.ending.toLocaleString("en-US") + W("건 오늘 종료", " ending today"); } },
          sold: { get: function (r) { return r.sold; }, fmt: function (r) { return r.sold.toLocaleString("en-US") + W("건 낙찰", " sold"); } },
          ended: { get: function (r) { return r.n; }, fmt: function (r) { return r.n.toLocaleString("en-US") + W("건 확인", " checked"); } },
          rate: { get: function (r) { return r.rate; }, fmt: function (r) { return r.rate + "%"; }, ci: true },
          // 거래액은 커버리지를 함께 적는다. 숫자만 놓으면 '시장 규모 순위'로 읽힌다.
          gmv: { get: function (r) { return r.gmv; }, fmt: function (r) {
            var base = "$" + r.gmv.toLocaleString("en-US");
            var covTxt = r.covA ? "≈100%" : r.cov + "%";
            return r.cov == null ? base : base + W(" · 표본 " + covTxt, " · " + covTxt + " of that game");
          } }
        };
        // 언어를 바꾸면 막대 라벨도 다시 그린다.
        var lastKey = "ending";
        document.addEventListener("opboxlang", function () { draw(lastKey); });
        // 거래액 탭에서만 보이는 경고. 다른 지표(비율·중앙값)는 표본이어도 견딘다.
        var warn = document.getElementById("tgCovWarn");
        function toggleWarn(key) {
          if (!warn) return;
          warn.style.display = key === "gmv" ? "block" : "none";
        }
        function draw(key) {
          toggleWarn(key);
          lastKey = key;
          var m = M[key];
          var list = rows.slice().sort(function (a, b) { return m.get(b) - m.get(a); });
          var max = m.get(list[0]) || 1;
          el.innerHTML = list.map(function (r) {
            var c = HUE[r.key] || GREY;
            var w = Math.max(1.5, (m.get(r) / max) * 100);
            var ci = m.ci && r.ci != null ? ' <span class="ci">±' + r.ci + "</span>" : "";
            return '<div class="barRow' + (r.isOp ? " me" : "") + '">' +
              '<div class="barName" title="' + r.name + '">' + r.name + "</div>" +
              '<div class="barTrack"><div class="barFill" style="width:0;background:' + c + '" data-w="' + w.toFixed(1) + '"></div></div>' +
              '<div class="barVal">' + m.fmt(r) + ci + "</div></div>";
          }).join("");
          // 강제 리플로우로 0 → 최종값 전이를 만든다. requestAnimationFrame 을 쓰면
          // 화면에 안 뜬 탭(백그라운드/비합성)에서 콜백이 영영 안 돌아 막대가 0 인 채로 남는다.
          // 동기 처리라 애니메이션이 없어도 너비는 항상 맞다.
          void el.offsetWidth;
          Array.prototype.forEach.call(el.querySelectorAll(".barFill"), function (b) { b.style.width = b.getAttribute("data-w") + "%"; });
        }
        if (lg) {
          lg.innerHTML = Object.keys(HUE).map(function (k) {
            var r = rows.filter(function (x) { return x.key === k; })[0];
            return r ? '<span><i style="background:' + HUE[k] + '"></i>' + r.name + "</span>" : "";
          }).join("") + '<span><i style="background:' + GREY + '"></i>All other games</span>';
        }
        // ⚠️ ".metricTabs button" 은 **페이지의 모든 탭 버튼**을 잡는다 — 아래 게임별 흐름 차트의
        //    기간(일별·주별·월별)·지표 버튼까지 전부. 그래서 이 차트의 지표를 누르면 흐름 차트의
        //    기간 선택이 통째로 꺼져 "지금 일별인지 주별인지" 알 수 없었다(2026-09-03 소유자 발견).
        //    자기 그룹만 잡도록 data-metric 으로 좁힌다.
        var tabs = document.querySelectorAll("button[data-metric]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            draw(b.getAttribute("data-metric"));
          });
        });
        draw("ending");
      })();
    </script>
    <script>
      // 게임별 흐름 차트 — 2026-09-03 다시 씀(소유자: "이 그래프가 뭘 의미하는지 전혀 모르겠어").
      // 고친 것 셋:
      //  ① 측정 전 구간을 빗금 벽으로 그리던 것 → 그 지표의 첫 측정일부터만 그린다.
      //     (live/ending 은 8/21부터 기록돼, 그 전 2주가 화면의 절반을 빗금으로 채우고 있었다.)
      //  ② 일별/주별/월별 전환 — 원피스 차트와 같은 방식.
      //  ③ 막대를 짚으면 숫자 나열 대신 **관계가 보이는 문장**으로 말한다:
      //     "종료 10,902건 중 200건 확인, 46건 낙찰" — 셋이 무슨 사이인지 문장이 말해준다.
      (function () {
        var DATA = ${tcgTrendJson};
        var host = document.getElementById("trendChart");
        var readout = document.getElementById("trendReadout");
        var plain = document.getElementById("trendPlain");
        var sel = document.getElementById("trendGame");
        if (!host || !sel || !DATA.order.length) return;
        var KO = function () { return document.documentElement.lang === "ko"; };
        DATA.order.forEach(function (k) {
          var o = document.createElement("option");
          o.value = k; o.textContent = DATA.games[k].name;
          sel.appendChild(o);
        });
        var game = DATA.order.indexOf("onepiece") >= 0 ? "onepiece" : DATA.order[0];
        sel.value = game;
        var metric = "ending";
        var period = "daily";
        var M = {
          live: { en: "Live", ko: "진행중", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); },
            help: ["Auctions open at our daily check.", "매일 확인 시점에 열려 있던 경매 수"] },
          ending: { en: "Ending today", ko: "오늘 종료", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); },
            help: ["Auctions closing that day (eBay's own count).", "그날 끝나는 경매 수 (eBay 가 알려준 실제 수)"] },
          ended: { en: "Checked", ko: "확인 수", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); },
            help: ["We re-read up to ~250 per game after close.", "끝난 뒤 우리가 다시 읽은 수 (게임당 하루 최대 250건 표본)"] },
          rate: { en: "Sold %", ko: "낙찰률", fmt: function (v) { return v.toFixed(1) + "%"; },
            help: ["Of the ones we checked, the share that sold.", "우리가 확인한 것 중 팔린 비율"] },
          gmv: { en: "Total spent", ko: "거래액", fmt: function (v) { return "$" + Math.round(v).toLocaleString("en-US"); },
            help: ["Winning bids added up (checked sample only).", "확인한 표본의 낙찰가 합계"] },
          med: { en: "Price", ko: "낙찰가", fmt: function (v) { return "$" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")); },
            help: ["Middle winning price of the checked sample.", "확인한 표본의 낙찰가 중앙값"] }
        };
        var bars = document.createElement("div"); bars.className = "opBars";
        var guide = document.createElement("div"); guide.className = "opGuide";
        var axis = document.createElement("div"); axis.className = "opAxis";
        host.appendChild(bars); bars.appendChild(guide); host.appendChild(axis);
        var cols = [], rows = [];
        // 이 지표가 측정되기 시작한 날부터만 그린다 — 앞의 "측정 전" 빗금 벽을 없앤다.
        // 그래프는 **끊긴 적 없는 구간**만 그린다 — 2026-09-03 소유자 지시("빈칸 보이면 누가 믿냐").
        // 계열 중간의 결측일(수집 사고로 영구 소실된 날)은 공개 데이터(CSV·JSON)에 null 로 남고,
        // 화면은 마지막 결측 다음날부터 그린다. 보이는 모든 막대가 실측이고, 라벨이 없는 날을
        // 가리키는 일이 없어진다(09/01 라벨이 8% 스텁 위에 찍혀 옆의 8/31 막대가 주인처럼 읽혔다).
        // 자가치유 수집이 새 결측을 막으므로 이 창은 매일 자란다.
        // 앞뒤로 값이 없는 구간만 잘라낸다 — 계열 **중간**의 결측은 자르지 않고 빈 자리로 남긴다.
        // 2026-09-03 실패에서 배운 것: 마지막 결측 다음날부터만 그렸더니 Weiss Schwarz 가
        // 막대 2개(9/2·9/3)로 화면을 채워 그래프 자체가 쓸모없어졌다. 빈칸을 숨기려다 차트를 죽였다.
        // 이제 시간축은 통째로 유지하고, 값이 없는 날은 막대를 그리지 않아 **눈에 띄는 빈 자리**로 둔다.
        var visibleTrendRows = ${visibleTrendRows.toString()};
        function visibleRows() {
          return visibleTrendRows(DATA.games[game][period] || [], metric);
        }
        function buildBars() {
          rows = visibleRows();
          bars.querySelectorAll(".opCol").forEach(function (c) { c.remove(); });
          cols = rows.map(function (r) {
            var c = document.createElement("div");
            c.className = "opCol";
            c.appendChild(document.createElement("i"));
            bars.appendChild(c);
            return c;
          });
          axis.innerHTML = "";
          if (!rows.length) return;
          var want = bars.getBoundingClientRect().width < 420 ? 3 : 5;
          var step = Math.max(1, Math.round((rows.length - 1) / (want - 1)));
          var ticks = [];
          for (var t = 0; t < rows.length; t += step) ticks.push(t);
          if (ticks[ticks.length - 1] !== rows.length - 1) ticks.push(rows.length - 1);
          ticks.forEach(function (idx) { var sp = document.createElement("span"); sp.textContent = rows[idx].ax; sp.style.position = "absolute"; if (idx === 0) { sp.style.left = "0"; } else if (idx === rows.length - 1) { sp.style.right = "0"; } else { sp.style.left = (((idx + 0.5) / rows.length) * 100) + "%"; sp.style.transform = "translateX(-50%)"; } axis.appendChild(sp); });
        }
        function summary() {
          var m = M[metric];
          var withV = rows.filter(function (r) { return r[metric] != null && isFinite(r[metric]); });
          readout.innerHTML = "";
          if (plain) plain.innerHTML = "";
          if (!withV.length) {
            if (plain) plain.textContent = KO() ? "이 지표는 아직 기록이 없습니다." : "No data recorded yet for this view.";
            return;
          }
          var last = withV[withV.length - 1];
          var hi = withV.slice().sort(function (a, b) { return b[metric] - a[metric]; })[0];
          var lo = withV.slice().sort(function (a, b) { return a[metric] - b[metric]; })[0];
          [[(KO() ? "최근" : "Latest"), last, "hi"], [(KO() ? "최고" : "High"), hi, ""], [(KO() ? "최저" : "Low"), lo, ""]].forEach(function (t) {
            var sp = document.createElement("span");
            if (t[2]) sp.className = t[2];
            sp.appendChild(document.createTextNode(t[0] + " "));
            var b = document.createElement("b"); b.textContent = m.fmt(t[1][metric]); sp.appendChild(b);
            sp.appendChild(document.createTextNode(" · " + t[1].ax));
            readout.appendChild(sp);
          });
          if (!plain) return;
          var st = document.createElement("strong");
          st.textContent = DATA.games[game].name + " · " + (KO() ? m.ko : m.en) + " " + m.fmt(last[metric]);
          plain.appendChild(st);
          var half = Math.max(1, Math.min(7, Math.floor(withV.length / 2)));
          var mid = function (a) { var q = a.slice().sort(function (x, y) { return x - y; }); return q[Math.floor((q.length - 1) / 2)]; };
          var recent = mid(withV.slice(-half).map(function (r) { return r[metric]; }));
          var older = withV.length > half ? mid(withV.slice(-half * 2, -half).map(function (r) { return r[metric]; })) : null;
          if (older != null) {
            var pct = older ? Math.abs((recent - older) / older) * 100 : 0;
            plain.appendChild(document.createTextNode(pct < 5 ? (KO() ? " 최근 흐름은 비슷합니다." : " Holding steady lately.")
              : recent > older ? (KO() ? " 최근 늘고 있습니다." : " Trending up lately.")
              : (KO() ? " 최근 줄고 있습니다." : " Trending down lately.")));
          }
          var hp = document.createElement("span");
          hp.className = "opHelp";
          hp.textContent = m.help[KO() ? 1 : 0];
          plain.appendChild(hp);
        }
        function draw() {
          var m = M[metric];
          var vals = rows.map(function (r) { return r[metric]; }).filter(function (v) { return v != null && isFinite(v); });
          var top = vals.length ? Math.max.apply(null, vals) : 0;
          rows.forEach(function (r, i) {
            var v = r[metric];
            var c = cols[i], bar = c.firstChild;
            c.classList.toggle("pt", !!r.p);
            if (v == null || !isFinite(v)) {
              // 계열 중간의 결측일 — 막대를 아예 그리지 않아 **빈 자리**로 남긴다.
              // 빗금 벽(값처럼 보임)도, 8% 토막(라벨이 그 위에 찍혀 옆 막대를 가리킴)도 안 된다.
              // 시간축은 유지되므로 빠진 날이 몇 개인지 눈으로 보인다 — 숨기지도, 꾸미지도 않는다.
              c.classList.add("nul"); bar.style.height = "0";
              c.setAttribute("aria-label", r.d + " — not measured");
            } else {
              c.classList.remove("nul");
              bar.style.height = Math.max(2, Math.round((v / (top || 1)) * 100)) + "%";
              c.setAttribute("aria-label", r.d + " — " + m.en + " " + m.fmt(v));
            }
          });
          guide.innerHTML = "";
          if (vals.length) {
            [1, 0.5, 0].forEach(function (fr) {
              var ln = document.createElement("i"); ln.className = "gLine"; ln.style.bottom = (fr * 100) + "%";
              var tg = document.createElement("span"); tg.textContent = m.fmt(top * fr); ln.appendChild(tg);
              guide.appendChild(ln);
            });
          }
          summary();
        }
        var picked = -1;
        function select(i) {
          if (i === picked || !rows[i]) return;
          if (cols[picked]) cols[picked].classList.remove("on");
          picked = i; cols[i].classList.add("on");
          var r = rows[i], m = M[metric];
          readout.innerHTML = "";
          // 숫자 나열이 아니라 관계를 문장으로: "종료 10,902건 중 200건 확인, 46건 낙찰".
          var sp = document.createElement("span"); sp.className = "hi";
          var n = function (v) { return v == null ? "—" : Math.round(v).toLocaleString("en-US"); };
          var txt;
          if (KO()) {
            txt = r.d + " — ";
            if (metric === "live" && r.live != null) txt += "진행중 " + n(r.live) + "건 · ";
            if (r.ending != null) txt += "종료 " + n(r.ending) + "건 중 ";
            txt += n(r.ended) + "건 확인, " + n(r.sold) + "건 낙찰";
            if (metric === "gmv") txt += " · 거래액 " + m.fmt(r.gmv);
            if (metric === "med" && r.med != null) txt += " · 낙찰가 " + m.fmt(r.med);
          } else {
            txt = r.d + " — ";
            if (metric === "live" && r.live != null) txt += n(r.live) + " open · ";
            if (r.ending != null) txt += n(r.ending) + " ended; ";
            txt += "we checked " + n(r.ended) + ", " + n(r.sold) + " sold";
            if (metric === "gmv") txt += " · " + m.fmt(r.gmv) + " spent";
            if (metric === "med" && r.med != null) txt += " · typical price " + m.fmt(r.med);
          }
          sp.textContent = txt;
          readout.appendChild(sp);
        }
        function clear() {
          if (cols[picked]) cols[picked].classList.remove("on");
          picked = -1; summary();
        }
        bars.addEventListener("pointermove", function (ev) {
          if (!rows.length) return;
          var rr = bars.getBoundingClientRect();
          var i = Math.round(((ev.clientX - rr.left) / rr.width) * (rows.length - 1));
          select(Math.max(0, Math.min(rows.length - 1, i)));
        });
        bars.addEventListener("pointerleave", clear);
        sel.addEventListener("change", function () { game = sel.value; picked = -1; buildBars(); draw(); });
        Array.prototype.forEach.call(document.querySelectorAll("button[data-tm]"), function (b) {
          b.addEventListener("click", function () {
            metric = b.getAttribute("data-tm"); picked = -1;
            Array.prototype.forEach.call(document.querySelectorAll("button[data-tm]"), function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            buildBars(); draw();
          });
        });
        Array.prototype.forEach.call(document.querySelectorAll("button[data-tp]"), function (b) {
          b.addEventListener("click", function () {
            period = b.getAttribute("data-tp"); picked = -1;
            Array.prototype.forEach.call(document.querySelectorAll("button[data-tp]"), function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            buildBars(); draw();
          });
        });
        document.addEventListener("opboxlang", function () { picked = -1; buildBars(); draw(); });
        buildBars(); draw();
      })();
    </script>

    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Free data (CSV)</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
    <script defer src="track.js"></script>
  </body>
</html>
`;

fs.writeFileSync(OUT, html, "utf8");

// 사이트맵에 넣는다(없으면 추가, 있으면 그대로).
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
const loc = `${SITE}/tcg-auction.html`;
let added = 0;
if (!sm.includes(`<loc>${loc}</loc>`)) {
  const today = new Date().toISOString().slice(0, 10);
  sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
  fs.writeFileSync(smPath, sm, "utf8");
  added = 1;
}

console.log(JSON.stringify({ games: rows.length, ended: totEnded, live: totLive, hammer: Math.round(totAmount), range: `${from} ~ ${to}`, sitemapAdded: added }, null, 1));
