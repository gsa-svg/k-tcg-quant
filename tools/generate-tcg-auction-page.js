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

const days = (series.daily || []).filter((d) => d && d.games);
if (days.length < 3) throw new Error("TCG 시계열이 너무 짧다 — 페이지를 만들지 않는다");
const from = days[0].d, to = days[days.length - 1].d;

// 게임별 합계(기간 전체)
const names = snapshot.terms || {};
const agg = {};
for (const day of days) {
  for (const [key, g] of Object.entries(day.games)) {
    const a = (agg[key] = agg[key] || { ended: 0, sold: 0, amount: 0, prices: [], live: null, endingToday: null, liveFixed: null });
    a.ended += g.ended || 0;
    a.sold += g.sold || 0;
    a.amount += g.amount || 0;
    if (Number.isFinite(g.medPrice) && (g.priceN || 0) >= 5) a.prices.push({ v: g.medPrice, n: g.priceN });
    // 진행 중 수는 그날 값이라 마지막 날 것을 쓴다(합산하면 같은 매물을 여러 번 센다).
    if (Number.isFinite(g.live)) a.live = g.live;
    if (Number.isFinite(g.endingToday)) a.endingToday = g.endingToday;
    if (Number.isFinite(g.liveFixed)) a.liveFixed = g.liveFixed;
  }
}

const rows = Object.entries(agg)
  .map(([key, a]) => {
    const meta = names[key] || {};
    const priceN = a.prices.reduce((t, p) => t + p.n, 0);
    const med = a.prices.length ? a.prices.map((p) => p.v).sort((x, y) => x - y)[Math.floor(a.prices.length / 2)] : null;
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
      medPrice: priceN >= MIN_PRICE_N ? med : null,
      live: a.live,
      endingToday: a.endingToday,
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

const tableRows = rows.map((r) => `          <tr>
            <td class="tgName">${esc(r.name)}</td>
            <td>${num(r.live)}</td>
            <td>${num(r.endingToday)}</td>
            <td>${num(r.ended)}</td>
            <td>${r.sellThrough == null ? "—" : r.sellThrough + "%"}</td>
            <td>${r.passThrough == null ? "—" : r.passThrough + "%"}</td>
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
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("", "tcg-auction.html", { ariaLabel: "Primary navigation" })}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">TCG Auction Data</p>
      <h1>Card game auctions: what sells and what passes</h1>
      <p>Every auction here was read again <strong>after it closed</strong>, so these are settled outcomes — not asking prices. Unsold auctions stay in the denominator. ${esc(from)} to ${esc(to)}.</p>

      <div class="tgStats">
        <div class="tgStat"><b>${num(totLive)}</b><small>auctions live now</small></div>
        <div class="tgStat"><b>${num(totEndingToday)}</b><small>ending today</small></div>
        <div class="tgStat"><b>${num(totEnded)}</b><small>settled by us</small></div>
        <div class="tgStat"><b>${totEnded ? Math.round((totSold / totEnded) * 1000) / 10 : "—"}%</b><small>sold</small></div>
        <div class="tgStat"><b>${usd(totAmount)}</b><small>hammer value</small></div>
      </div>

      <h2>Every game side by side</h2>
      <div style="overflow-x:auto">
        <table class="tgTable">
          <thead>
            <tr><th>Game</th><th>Live</th><th>Ending today</th><th>Ended</th><th>Sold</th><th>Passed</th><th>Hammer</th><th>Median bid</th></tr>
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
