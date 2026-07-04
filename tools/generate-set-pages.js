// Generate static SEO landing pages per set: sets/<code>.html + sets/index.html
// - Static text contains only stable facts (set name, release, chase-card list).
// - Volatile prices are loaded client-side from /data/onepiece-packs.json (always fresh).
// - Idempotently inserts new URLs into sitemap.xml.
// Run: node tools/generate-set-pages.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));

const ORDER = [...data.jp.list, ...data.extra.list].filter((c) => (data.sets[c]?.cards || []).length > 0);
const slug = (code) => code.toLowerCase();

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function head({ title, desc, canonical, ogType = "article", extraLd = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Google Analytics 4 (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-P73SE1WVD0');
    </script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta name="twitter:card" content="summary" />
    ${extraLd}
    <link rel="stylesheet" href="../styles.css" />
    <style>
      .setHero { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
      .setHero img { width: 132px; border-radius: 10px; border: 1px solid var(--line); }
      .liveBox { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: rgba(16,215,160,.05); }
      .liveBox b { font-size: 22px; color: var(--accent); }
      .liveBox small { color: var(--muted); display: block; margin-top: 4px; }
      .chaseList li { margin: 6px 0; }
      .ctaRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .ctaRow a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); font-weight: 800; }
      .ctaRow a.primary { background: rgba(16,215,160,.14); border-color: rgba(16,215,160,.5); color: var(--accent); }
      .setNavLinks { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; color: var(--muted); font-size: 13px; }
      .affNote { margin-top: 16px; color: var(--muted); font-size: 11px; opacity: .8; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="../packs.html?hl=en"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav"><a href="../packs.html?hl=en">Booster Packs</a><a href="index.html">Set Guides</a><a href="../about.html">About</a></nav>
    </header>
    <main class="bodyPage">`;
}

const FOOT = `
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this page — at no extra cost to you. Prices and availability change; always confirm details on eBay before buying.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="../about.html">About</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

// 라이브 가격 위젯: 데이터 fetch 실패/부재 시 위젯 자체를 숨김(불확실하면 숨김 원칙)
function liveWidget(code) {
  return `
      <div class="liveBox" id="livePrice" hidden>
        <span id="lpLabel">Current eBay listing price (mid)</span><br />
        <b id="lpMid">–</b>
        <small id="lpMeta"></small>
      </div>
      <script>
        (function () {
          fetch("../data/onepiece-packs.json?v=" + new Date().toISOString().slice(0, 10))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              var s = d.sets && d.sets["${code}"];
              var m = s && s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
              if (!m || m.middle == null) return;
              var usd = m.currency === "USD" ? m.middle : m.middle / ((d.fx && d.fx.usdKrw) || 1388.2);
              var lo = m.low != null ? (m.currency === "USD" ? m.low : m.low / ((d.fx && d.fx.usdKrw) || 1388.2)) : null;
              var hi = m.high != null ? (m.currency === "USD" ? m.high : m.high / ((d.fx && d.fx.usdKrw) || 1388.2)) : null;
              document.getElementById("lpMid").textContent = "$" + Math.round(usd).toLocaleString("en-US");
              var meta = [];
              if (lo != null && hi != null) meta.push("Range $" + Math.round(lo).toLocaleString("en-US") + " – $" + Math.round(hi).toLocaleString("en-US"));
              if (m.sampleSize) meta.push(m.sampleSize + " listings");
              meta.push("Updated " + (m.updated || d.updated || ""));
              if (s.psaGem != null) meta.push("Set PSA10 rate " + s.psaGem + "%");
              document.getElementById("lpMeta").textContent = meta.join(" · ");
              document.getElementById("livePrice").hidden = false;
            })
            .catch(function () {});
        })();
      </script>`;
}

function faqLd(code, nameEn) {
  const q = [
    {
      q: `What is the current ${code} ${nameEn} booster box price?`,
      a: `OP Box Index tracks ${code} ${nameEn} Japanese sealed booster box prices daily from eBay active listings and sold history, shown in USD with KRW and JPY conversions. Check the live tracker for today's price band.`,
    },
    {
      q: `What are the top chase cards in ${code} ${nameEn}?`,
      a: `The most valuable ${code} pulls are ranked on this page by market price, including parallel, manga rare and special art cards, with PSA 10 population data where available.`,
    },
    {
      q: `Is a Japanese ${code} booster box a good buy?`,
      a: `That depends on price versus recent sold data, chase-card strength, supply and reseal risk. OP Box Index shows the data signals but does not give investment advice.`,
    },
  ];
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: q.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
  })}</script>
    <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/packs.html?hl=en` },
      { "@type": "ListItem", position: 2, name: "Set Guides", item: `${SITE}/sets/index.html` },
      { "@type": "ListItem", position: 3, name: `${code} Guide`, item: `${SITE}/sets/${slug(code)}.html` },
    ],
  })}</script>`;
}

function setPage(code, prev, next) {
  const s = data.sets[code];
  const nameEn = s.nameEn || code;
  const cards = (s.cards || []).slice(0, 10);
  const top3 = cards.slice(0, 3).map((c) => c.name).join(", ");
  const canonical = `${SITE}/sets/${slug(code)}.html`;
  const title = `${code} ${nameEn} Booster Box Price (Japanese) — Top Chase Cards & PSA Data | OP Box Index`;
  const desc = `Live ${code} ${nameEn} Japanese booster box price from eBay listings and sold data, top 10 chase cards (${top3}), PSA 10 population stats and a pre-purchase checklist.`;
  const ebaySearch = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece Card Game ${code} ${nameEn} Booster Box Japanese sealed`)}&LH_BIN=1&_sop=15&${EPN}`;
  const release = s.release ? `<p class="eyebrow">Released ${esc(s.release)} · Japanese edition</p>` : `<p class="eyebrow">Japanese edition</p>`;

  const chase = cards
    .map(
      (c) =>
        `<li><strong>${esc(c.name)}</strong> — ${esc(c.number || "")}${c.rarity ? ` · ${esc(c.rarity)}` : ""}</li>`,
    )
    .join("\n          ");

  const compareLink =
    code === "OP-05"
      ? `<li>Comparing this to a nearby set? See <a href="../articles/op-05-vs-op-06.html">OP-05 vs OP-06</a>.</li>`
      : code === "OP-06"
        ? `<li>Comparing this to a nearby set? See <a href="../articles/op-05-vs-op-06.html">OP-05 vs OP-06</a>.</li>`
        : "";

  return `${head({ title, desc, canonical, extraLd: faqLd(code, nameEn) })}
      <p class="eyebrow">Set Guide</p>
      <div class="setHero">
        ${s.box ? `<img src="${esc(s.box)}" alt="${esc(`${code} ${nameEn} Japanese booster box`)}" loading="lazy" decoding="async" />` : ""}
        <div>
          <h1>${code} ${esc(nameEn)} — Japanese booster box price &amp; chase cards</h1>
          ${release}
        </div>
      </div>
      <p><strong>${code} ${esc(nameEn)}</strong> is tracked daily on OP Box Index using eBay active listings and sold history for the Japanese sealed booster box, plus per-card data for its most valuable pulls. The strongest chase cards in this set include ${esc(top3)} — the cards that effectively set the floor for what a sealed box is worth.</p>
      ${liveWidget(code)}
      <div class="ctaRow">
        <a class="primary" href="../packs.html?set=${encodeURIComponent(code)}&hl=en">Open live ${code} tracker</a>
        <a href="${ebaySearch}" target="_blank" rel="noopener noreferrer sponsored">Browse ${code} boxes on eBay</a>
      </div>
      <h2>Top 10 chase cards in ${code}</h2>
      <p>Ranked by market value. Live prices for each card (Japanese NM, PSA 10 sold data and lowest verified eBay listings) are on the <a href="../packs.html?set=${encodeURIComponent(code)}&hl=en">live tracker</a>.</p>
      <ol class="chaseList">
          ${chase}
      </ol>
      <h2>Before you buy a sealed ${code} box</h2>
      <ul>
        <li>Compare the asking price against recent <strong>sold</strong> prices, not just listings — active prices are often above what boxes actually sell for.</li>
        <li>Check the seller's history, photos of the actual box and shrink-wrap condition to reduce <a href="../articles/reseal-checklist.html">reseal risk</a>.</li>
        <li>Japanese and English boxes price very differently — see <a href="../articles/japan-vs-english.html">Japanese vs English boxes</a>.</li>
        <li>Understand <a href="../articles/sealed-box-rules.html">what actually moves sealed box prices</a> before treating any box as an investment.</li>
        <li>Chase-card value often tracks <a href="../articles/psa-population-and-prices.html">PSA population and gem rate</a>, not just character popularity.</li>
        ${compareLink}
      </ul>
      <div class="setNavLinks">
        ${prev ? `<a href="${slug(prev)}.html">← ${prev} guide</a>` : ""}
        <a href="index.html">All set guides</a>
        ${next ? `<a href="${slug(next)}.html">${next} guide →</a>` : ""}
      </div>${FOOT}`;
}

function hubPage() {
  const canonical = `${SITE}/sets/index.html`;
  const title = `One Piece Booster Box Price Guides by Set (Japanese) | OP Box Index`;
  const desc = `Japanese One Piece booster box price guides for every set: OP-01 through OP-15, EB and PRB — live eBay prices, top chase cards and PSA 10 data.`;
  const items = ORDER.map((code) => {
    const s = data.sets[code];
    return `<li><a href="${slug(code)}.html"><strong>${code}</strong> ${esc(s.nameEn || "")}</a> — box price, top chase cards &amp; PSA data</li>`;
  }).join("\n        ");
  const ld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "One Piece booster box price guides",
    itemListElement: ORDER.map((code, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${code} ${data.sets[code].nameEn || ""} guide`,
      url: `${SITE}/sets/${slug(code)}.html`,
    })),
  })}</script>`;
  return `${head({ title, desc, canonical, ogType: "website", extraLd: ld })}
      <p class="eyebrow">Set Guides</p>
      <h1>One Piece booster box price guides — every Japanese set</h1>
      <p>Pick a set to see its live Japanese sealed booster box price, top 10 chase cards, PSA 10 population data and buying checklist. All prices update daily from eBay listings and sold history.</p>
      <ul class="chaseList">
        ${items}
      </ul>
      <div class="setNavLinks">
        <a href="../packs.html?hl=en">Open the live price tracker</a>
        <a href="../articles/sealed-box-rules.html">What moves box prices</a>
        <a href="../articles/reseal-checklist.html">Reseal checklist</a>
        <a href="../articles/psa-population-and-prices.html">PSA population &amp; prices</a>
        <a href="../articles/op-05-vs-op-06.html">OP-05 vs OP-06</a>
      </div>${FOOT}`;
}

// ---- write files
const outDir = path.join(ROOT, "sets");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
let written = 0;
ORDER.forEach((code, i) => {
  const html = setPage(code, ORDER[i - 1], ORDER[i + 1]);
  fs.writeFileSync(path.join(outDir, `${slug(code)}.html`), html, "utf8");
  written++;
});
fs.writeFileSync(path.join(outDir, "index.html"), hubPage(), "utf8");
written++;

// ---- sitemap: idempotent insert
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
const today = new Date().toISOString().slice(0, 10);
const urls = [`${SITE}/sets/index.html`, ...ORDER.map((c) => `${SITE}/sets/${slug(c)}.html`)];
let added = 0;
for (const u of urls) {
  if (sm.includes(`<loc>${u}</loc>`)) continue;
  const entry = `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  sm = sm.replace("</urlset>", entry + "</urlset>");
  added++;
}
fs.writeFileSync(smPath, sm, "utf8");
console.log(JSON.stringify({ pagesWritten: written, sitemapAdded: added }));
