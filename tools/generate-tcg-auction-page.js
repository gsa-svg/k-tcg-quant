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
// 낙찰률은 우리가 종료 후 다시 읽어 확인한 것만 쓴다. 게임마다 하루 ~200건을 같은 잣대로 훑는
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
// 하루 표본이 게임당 200건 안팎이라 일별 중앙값이 크게 흔들리고, 그것들을 다시 중앙값 내면
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
  .filter((r) => r.ended > 0)
  .sort((a, b) => b.ended - a.ended);

const totEnded = rows.reduce((t, r) => t + r.ended, 0);
const totSold = rows.reduce((t, r) => t + r.sold, 0);
const totAmount = rows.reduce((t, r) => t + r.amount, 0);
const totLive = rows.reduce((t, r) => t + (r.live || 0), 0);
const totEndingToday = rows.reduce((t, r) => t + (r.endingToday || 0), 0);

// ── 커버리지 — 2026-09-02 추가. 이것 없이 거래액을 나란히 놓으면 순위가 거꾸로 읽힌다.
// 게임마다 하루 200건 안팎씩 같은 잣대로 훑는데, 그 게임이 하루에 끝내는 총 건수는
// 포켓몬 42,363건 · Riftbound 167건으로 250배 차이난다. 그래서 우리가 담는 비율이
// 0.4% ~ 63% 로 벌어지고, 거래액 합계는 '시장 규모'가 아니라 '우리가 얼마나 봤는가'가 된다.
// 실제로 Riftbound 가 포켓몬의 12배로 나와 시장이 그만큼 크다는 오해를 샀다.
// 낙찰률·중앙 낙찰가는 표본이어도 견디지만 합계는 그렇지 않다 — 그 차이를 화면에 적는다.
const dayCount = days.length || 1;
for (const r of rows) {
  const perDayEnding = r.endingAvg;   // 기간 평균(마지막 날 하나는 크게 흔들린다)
  const ourPerDay = r.ended / dayCount;
  r.coveragePct = Number.isFinite(perDayEnding) && perDayEnding > 0
    ? Math.round((ourPerDay / perDayEnding) * 1000) / 10
    : null;
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
            <td class="cov">${r.coveragePct == null ? "—" : r.coveragePct + "%"}</td>
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
    <title>TCG Auction Data — Sell-Through &amp; Hammer Value by Card Game | OP Box Index</title>
    <meta name="description" content="Settled eBay auction results across ${rows.length} trading card games: how many auctions run, what share sells, what passes unsold, and how much money changes hands. Every auction is read again after it closes." />
    <meta property="og:title" content="TCG Auction Data — Sell-Through by Card Game" />
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
      <p data-ko="여기 모든 경매는 <strong>끝난 뒤에</strong> 다시 읽은 것이라 호가가 아니라 정산된 결과입니다. 유찰 건도 분모에 그대로 둡니다. ${esc(from)}~${esc(to)}.">Every auction here was read again <strong>after it closed</strong>, so these are settled outcomes — not asking prices. Unsold auctions stay in the denominator. ${esc(from)} to ${esc(to)}.</p>

      <div class="tgStats">
        <div class="tgStat"><b>${num(totLive)}</b><small data-ko="진행 중인 경매">auctions live now</small></div>
        <div class="tgStat"><b>${num(totEndingToday)}</b><small data-ko="오늘 종료">ending today</small></div>
        <div class="tgStat"><b>${num(totEnded)}</b><small data-ko="우리가 정산 확인">settled by us</small></div>
        <div class="tgStat"><b>${totEnded ? Math.round((totSold / totEnded) * 1000) / 10 : "—"}%</b><small data-ko="낙찰률">sold</small></div>
        <div class="tgStat"><b>${usd(totAmount)}</b><small data-ko="총 거래액">hammer value</small></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2 data-ko="하루에 끝나는 카드 경매 수">How many card auctions end each day</h2>
            <p class="sub">${esc(from)}–${esc(to)}</p>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-metric="ending" aria-pressed="true" data-ko="오늘 종료 예정">Auctions ending today</button>
            <button type="button" data-metric="ended" aria-pressed="false" data-ko="종료 후 확인">Checked after close</button>
            <button type="button" data-metric="sold" aria-pressed="false" data-ko="그중 낙찰">Of those, sold</button>
            <button type="button" data-metric="rate" aria-pressed="false" data-ko="낙찰률">Sell-through</button>
            <button type="button" data-metric="gmv" aria-pressed="false" data-ko="거래액">Hammer value</button>
          </div>
        </div>
        <p class="covWarn" id="tgCovWarn" style="display:none" data-ko="⚠ 이 순위는 시장 규모가 아닙니다. 게임마다 하루에 끝나는 경매 수가 크게 다른데(포켓몬 ${num(rows.find((r) => r.key === 'pokemon') ? rows.find((r) => r.key === 'pokemon').endingToday : 0)}건 대 Riftbound ${num(rows.find((r) => r.key === 'riftbound') ? rows.find((r) => r.key === 'riftbound').endingToday : 0)}건) 우리는 어느 게임이든 하루 200건 안팎만 확인합니다. 그래서 표본 비율이 게임마다 다르고, 합계는 시장 크기가 아니라 우리가 담은 양을 따라갑니다. 비교하려면 낙찰률이나 중앙 낙찰가를 보십시오.">⚠ This is not market size. The number of auctions each game ends per day differs enormously (${num(rows.find((r) => r.key === "pokemon") ? rows.find((r) => r.key === "pokemon").endingToday : 0)} for Pokemon vs ${num(rows.find((r) => r.key === "riftbound") ? rows.find((r) => r.key === "riftbound").endingToday : 0)} for Riftbound), yet we settle roughly the same couple of hundred per game per day. Our share of each game therefore ranges from a fraction of a percent to well over half, and a hammer-value total tracks how much we saw, not how big the market is. For comparison across games, use sell-through or median winning bid.</p>
        <div class="barList" id="tcgBars"></div>
        <div class="legend" id="tcgLegend"></div>
      </div>

      <h2 data-ko="게임별 한눈에 보기">Every game side by side</h2>
      <div style="overflow-x:auto">
        <table class="tgTable">
          <thead>
            <tr><th data-ko="게임">Game</th><th>Live</th><th data-ko="오늘 종료">Ending today</th><th data-ko="종료">Ended</th><th data-ko="낙찰">Sold</th><th>Passed</th><th data-ko="표본 비율">Our share</th><th data-ko="거래액">Hammer</th><th>Median bid</th></tr>
          </thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
      </div>
      <p class="priceNote" style="color:#7d8698;font-size:12.5px;">
        <strong>Live</strong> and <strong>ending today</strong> are counts eBay reports directly, not samples.
        <strong>Ended</strong> is what we settled ourselves — we sample roughly 200 auctions per game per day and read each one after close, so the same yardstick applies to every game.
        Rates are hidden below ${MIN_ENDED} settled auctions and median bids below ${MIN_PRICE_N} sales, because a rate built on a handful of lots is not a rate.
        One Piece has its own deeper collection (about five times this sample) on the <a href="auction.html">One Piece auction page</a>, so its numbers there differ from this cross-game table.
      </p>

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
            return r.cov == null ? base : base + W(" · 표본 " + r.cov + "%", " · " + r.cov + "% of that game");
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
        var tabs = document.querySelectorAll(".metricTabs button");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            draw(b.getAttribute("data-metric"));
          });
        });
        draw("ending");
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
