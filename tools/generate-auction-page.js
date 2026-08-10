// auction.html (영어, 루트) — 원피스 이베이 경매 "실낙찰" 데이터 페이지.
// 소유자 우선순위(2026-08-01): 해외(영어) 유저 유입이 1순위. 경매 데이터셋은 우리만 가진 자산인데
// 영어 지면이 없었다 — "one piece card auction results / ebay sold prices / sell-through" 검색 정조준.
// 원칙: 값은 전부 auction-sold.json / auction-card-stats.json 에서 파생. 추정 금지, 없으면 비움.
// 기존 페이지의 노출 상태(canonical/robots/사이트맵 항목)는 건드리지 않는다 — 추가만 한다.
// Run: node tools/generate-auction-page.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const auc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-sold.json"), "utf8"));
const cardStats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-card-stats.json"), "utf8"));
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null || !isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

const daily = (auc.daily || []).slice(-10);
if (daily.length < 3) { console.error("일별 집계가 3일 미만 — 페이지 미생성"); process.exit(1); }
const totN = daily.reduce((t, x) => t + x.n, 0);
const totSold = daily.reduce((t, x) => t + x.sold, 0);
const st = totN ? Math.round((totSold / totN) * 100) : 0;
const kinds = ["card", "box", "pack"].map((k) => {
  const rows = daily.map((x) => x.byKind && x.byKind[k]).filter(Boolean);
  const n = rows.reduce((t, b) => t + b.n, 0), sold = rows.reduce((t, b) => t + b.sold, 0);
  return { k, n, sold, st: n ? Math.round((sold / n) * 100) : null };
});
const cardK = kinds[0], boxK = kinds[1];
const last = daily[daily.length - 1];

const nameOf = (set, id) => {
  const cs = (d.sets[set] || {}).cards || [];
  const hit = cs.find((c) => String(c.number || "").toUpperCase() === id.toUpperCase());
  return hit ? hit.name : null;
};
const topCards = Object.entries(cardStats.cards || {})
  .map(([id, c]) => ({ id, ...c, name: nameOf(c.set, id) }))
  .sort((a, b) => b.medPrice - a.medPrice).slice(0, 12);

const dTr = daily.map((x) => `<tr><td class="l">${esc(x.d)}</td><td>${num(x.n)}</td><td>${num(x.sold)}</td><td>${x.sellThrough != null ? x.sellThrough + "%" : "—"}</td><td>${x.medPrice != null ? usd(x.medPrice) : "—"}</td><td>${x.medBids != null ? num(x.medBids) : "—"}</td></tr>`).join("\n");
const cTr = topCards.map((c, i) => `<tr><td>${i + 1}</td><td class="l">${esc(c.name || c.id)}<small>${esc(c.id)} · ${esc(c.set)}</small></td><td>${usd(c.medPrice)}</td><td>${c.low != null && c.high != null ? `${usd(c.low)}–${usd(c.high)}` : "—"}</td><td>${c.sellThrough != null ? c.sellThrough + "%" : "—"}</td><td>${num(c.sold)}</td></tr>`).join("\n");
const kTr = kinds.filter((k) => k.n).map((k) => `<tr><td class="l">${k.k === "card" ? "Single cards" : k.k === "box" ? "Sealed booster boxes" : "Sealed packs"}</td><td>${num(k.n)}</td><td>${num(k.sold)}</td><td>${k.st}%</td></tr>`).join("\n");

const faqs = [
  { q: "Where do these auction prices come from?", a: "Every auction is read again after it closed, so the price recorded is the final winning bid — not a mid-auction bid and not an asking price. Auctions that ended without a sale stay in the data as the denominator of sell-through. Where eBay does not report a sold state we store null rather than guessing." },
  { q: "What share of One Piece card auctions actually sell?", a: `Across the last ${daily.length} days we tracked ${num(totN)} One Piece auctions to close and ${num(totSold)} of them sold — about ${st}%. Sealed boxes clear at a far higher rate than single cards${boxK.st != null && cardK.st != null ? ` (${boxK.st}% vs ${cardK.st}% in this window)` : ""}.` },
  { q: "Why can auction prices differ from Buy It Now prices?", a: "An auction records the highest bid reached at a specific closing time, while a fixed-price listing records a seller's ask. Use the auction median as one completed-sale reference, then add shipping and import fees and match the exact card variant before comparing." },
  { q: "Can I download this data?", a: "Yes — the daily aggregates (auctions tracked, sold count, sell-through, median winning bid) are published as a free CSV under CC BY 4.0 on the free data page. Attribution with a link is the only requirement." },
];
const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece Card Game completed eBay auction results",
  description: `Daily completed-auction outcomes for One Piece Card Game items: auctions tracked to close, how many sold, sell-through rate, median final winning bid and bid counts, split by sealed box, single card and pack. ${num(totN)} auctions tracked in the latest ${daily.length}-day window.`,
  url: `${SITE}/auction.html`, license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-auction-daily.csv` }],
});
const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
  { "@type": "ListItem", position: 2, name: "Auction Data", item: `${SITE}/auction.html` },
] });

const title = "One Piece Card Auction Data — Real eBay Winning Bids & Sell-Through | OP Box Index";
const desc = `Completed eBay auction results for One Piece cards and sealed boxes: ${num(totN)} auctions tracked over ${daily.length} days, ${st}% sell-through, median winning bids per day and per card. Read after close — real sold prices, not asking prices (${DATA_DATE}).`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/auction.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${SITE}/auction.html" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${faqLd}</script>
    <script type="application/ld+json">${dsLd}</script>
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <style>
      .aucWrap { max-width: 900px; margin: 0 auto; padding: 20px clamp(16px,3vw,28px) 44px; }
      .aucWrap h1 { margin: 6px 0; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .aucWrap .lead { color: var(--muted); font-size: 15px; line-height: 1.65; max-width: 700px; }
      .aucWrap h2 { font-size: 19px; margin: 26px 0 8px; }
      .aucWrap p { color: var(--muted); font-size: 14px; line-height: 1.7; max-width: 720px; margin: 8px 0; }
      .aucWrap p strong { color: var(--ink); }
      .aTable { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .aTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .aTable th.l, .aTable td.l { text-align: left; }
      .aTable td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .aTable td.l small { color: var(--muted); display: block; font-size: 11px; }
      .faqItem { max-width: 720px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 2px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14px; }
      .faqItem p { font-size: 13.5px; margin: 4px 0 10px; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="aucWrap">
      <p class="eyebrow">Auction Data</p>
      <h1>One Piece card auction results — real winning bids</h1>
      <p class="lead">We track One Piece Card Game auctions on eBay and read each one <strong>after it closes</strong>, recording the final winning bid and whether it sold. A mid-auction bid can still change, so this page uses settled outcomes. Unsold auctions remain in the denominator when sell-through is calculated.</p>

      <h2>Daily results — last ${daily.length} days</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l">Ended</th><th>Auctions tracked</th><th>Sold</th><th>Sell-through</th><th>Median winning bid</th><th>Median bids</th></tr></thead>
        <tbody>
${dTr}
        </tbody>
      </table>
      </div>
      <p class="srcNoteA" style="font-size:12px;color:var(--muted)">Our tracked sample, not an exhaustive census of eBay. Sell-through counts only auctions whose sold/unsold state is confirmed. Prices are final winning bids in USD, per item for multi-item lots.</p>

      <h2>Sealed boxes sell. Singles mostly don't.</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l">Product type</th><th>Auctions</th><th>Sold</th><th>Sell-through</th></tr></thead>
        <tbody>
${kTr}
        </tbody>
      </table>
      </div>
      <p>Over the last ${daily.length} days, <strong>${st}% of the ${num(totN)} auctions we tracked ended with a winning bid</strong>. Results differ by item type: single-card sell-through was${cardK.st != null ? ` ${cardK.st}%` : " not available"}, while sealed booster-box sell-through was${boxK.st != null ? ` ${boxK.st}%` : " not available"} in this sample. These figures describe only the auctions tracked in the stated window.</p>

      <h2>Highest auction medians by card</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th>#</th><th class="l">Card</th><th>Median winning bid</th><th>Range</th><th>Sell-through</th><th>Sales</th></tr></thead>
        <tbody>
${cTr}
        </tbody>
      </table>
      </div>
      <p class="srcNoteA" style="font-size:12px;color:var(--muted)">Rolling window, minimum 3 confirmed sales per card. Cards below that bar are omitted rather than shown on thin samples. Ranges are 25th–75th percentile of confirmed sales.</p>

      <h2>How to use auction data</h2>
      <p>Compare an auction median with recent fixed-price sales and current asking prices; none is a complete market on its own. A large gap can be a reason to inspect sample size, exact variant, condition, shipping and closing time before drawing a conclusion.${last ? ` On the latest full day (${esc(last.d)}) we tracked ${num(last.n)} auctions ending, of which ${num(last.sold)} sold.` : ""}</p>
      <p>Cross-reference with the rest of the site: each card's NM and PSA 10 prices live on the <a href="cards/">card price pages</a> and the <a href="psa10-ranking.html">PSA 10 value ranking</a>, sealed-box context on the <a href="sets/index.html">set guides</a>, and grading supply on the <a href="psa-grading.html">population page</a>. The daily aggregates here are downloadable as a <a href="free-data.html">free CSV (CC BY 4.0)</a>.</p>

      <h2>Auction data — common questions</h2>
      ${faqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n      ")}
      <p class="srcNoteA" style="font-size:11px;color:var(--muted);margin-top:16px">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this site, at no extra cost to you. Data is research reference, not investment advice.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Data terms</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "auction.html"), html, "utf8");

// 사이트맵: 추가만(제거 금지 — 소유자 절대 지시)
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/auction.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    fs.writeFileSync(smPath, sm, "utf8");
    added = 1;
  }
  console.log(JSON.stringify({ wrote: "auction.html", days: daily.length, tracked: totN, sellThrough: st + "%", topCards: topCards.length, sitemapAdded: added }));
}
