// 무료 데이터셋 생성 — /free-data.html + /opbox-set-prices.csv
// 목적: 피인용(백링크)으로 도메인 신뢰도를 올리는 자산. 색인 병목의 실제 원인이 외부링크 부족이라 이걸 겨냥.
// ⚠️ 원시 리스팅 덤프 금지 — 세트 단위 "파생 집계"만. 외부 소스명 표기 금지(가드 S1).
// Run: node tools/generate-free-data.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = "20260719d";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const mi = d.marketIndex;
const fx = d.fx || {};
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// CSV 셀: 쉼표/따옴표/개행 있으면 인용부호 처리
const cell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

function orderKey(code) {
  const m = code.match(/^([A-Z]+)-?(\d+)/);
  const fam = { OP: 0, EB: 1, PRB: 2 }[m ? m[1] : "OP"] ?? 9;
  return fam * 1000 + (m ? parseInt(m[2], 10) : 0);
}
const rows = [...mi.board].sort((a, b) => orderKey(a.code) - orderKey(b.code));

function boxKrw(code, nowUsd) {
  const s = d.sets[code];
  const pts = s && s.boxSeries && s.boxSeries.points;
  if (pts && pts.length) return pts[pts.length - 1].p;
  return nowUsd != null && fx.usdKrw ? Math.round(nowUsd * fx.usdKrw) : null;
}

// ---- CSV (파생 집계만)
const HEAD = [
  "set_code", "set_name_en", "set_name_ko", "box_price_krw", "box_price_usd",
  "change_pct_since_base", "base_date", "launch_tracked",
  "msrp_jpy", "price_vs_msrp_multiple", "reprint_records",
  "psa_graded_total", "psa10_rate_pct", "as_of",
];
const csvRows = rows.map((b) => {
  const s = d.sets[b.code] || {};
  const krw = boxKrw(b.code, b.nowUsd);
  const rr = ((mi.reprints.bySet[b.code] || {}).reprintRecords) || [];
  return [
    b.code, s.nameEn ?? "", s.nameKo ?? "",
    krw ?? "", b.nowUsd ?? "",
    b.changePct ?? "", b.baseDate ?? "", b.launchTracked ? "true" : "false",
    b.msrpYen ?? "", b.vsMsrp ?? "", rr.length,
    s.psaTotal ?? "", s.psaGem ?? "", DATA_DATE,
  ].map(cell).join(",");
});
const csv = [HEAD.join(","), ...csvRows].join("\n") + "\n";
fs.writeFileSync(path.join(ROOT, "opbox-set-prices.csv"), csv, "utf8");

// ---- 랜딩 페이지
const previewRows = rows.slice(0, 8).map((b) => {
  const s = d.sets[b.code] || {};
  const krw = boxKrw(b.code, b.nowUsd);
  return `<tr><td>${esc(b.code)}</td><td>${esc(s.nameEn || "")}</td><td class="num">$${b.nowUsd ?? "—"}</td><td class="num">${b.changePct != null ? (b.changePct >= 0 ? "+" : "") + b.changePct + "%" : "—"}</td><td class="num">${b.vsMsrp ? "×" + b.vsMsrp : "—"}</td><td class="num">${((mi.reprints.bySet[b.code] || {}).reprintRecords || []).length}</td></tr>`;
}).join("\n");

const datasetLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece Booster Box Price Dataset (Japanese sets)",
  description: `Free CSV of Japanese One Piece booster box aggregates for ${rows.length} sets: current box price (KRW/USD), change since tracking start, original Japanese MSRP and price-vs-MSRP multiple, verified reprint record counts, and PSA graded population with PSA 10 rate. Updated daily.`,
  url: `${SITE}/free-data.html`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true,
  dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-set-prices.csv` }],
  variableMeasured: HEAD,
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/free-data.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>Free One Piece Booster Box Price Dataset (CSV) | OP Box Index</title>
    <meta name="description" content="Free CSV dataset of Japanese One Piece booster box prices: ${rows.length} sets with box price, change since tracking start, original MSRP and price-vs-MSRP multiple, reprint records and PSA population. Updated daily, CC BY 4.0." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Free One Piece Booster Box Price Dataset (CSV)" />
    <meta property="og:description" content="${rows.length} Japanese sets: box price, vs-MSRP multiple, reprint records, PSA population. Free, updated daily, CC BY 4.0." />
    <meta property="og:url" content="${SITE}/free-data.html" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${datasetLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .dlRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .dlRow a { display: inline-block; padding: 12px 20px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .dlRow .primary { background: #50dad9; color: #08131a; }
      .dlRow .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
      .dTable { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .dTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; text-transform: uppercase; }
      .dTable th:nth-child(1), .dTable th:nth-child(2) { text-align: left; }
      .dTable td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .dTable td.num { text-align: right; }
      .fields { font-size: 13.5px; color: #9aa4b6; line-height: 1.9; max-width: 760px; }
      .fields code { color: #50dad9; background: rgba(80,218,217,.08); padding: 1px 6px; border-radius: 5px; }
      .attrBox { margin: 16px 0; padding: 12px 16px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 760px; font-size: 13.5px; line-height: 1.7; }
      .attrBox code { display: block; margin-top: 6px; color: #cfd6e4; background: rgba(255,255,255,.04); padding: 8px 10px; border-radius: 8px; font-size: 12.5px; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="market.html" data-ko="마켓 지수">Market Index</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow">Free data</p>
      <h1>One Piece booster box price dataset — free CSV</h1>
      <p>A machine-readable snapshot of the Japanese One Piece booster box market: <strong>${rows.length} sets</strong>, updated daily. Use it for research, videos, spreadsheets or your own charts. Free under CC BY 4.0 — just credit and link back.</p>

      <div class="dlRow">
        <a class="primary" href="opbox-set-prices.csv" download>Download CSV (${rows.length} sets)</a>
        <a class="ghost" href="market.html">See the live market index →</a>
      </div>
      <p class="note">Last updated ${esc(DATA_DATE)} · FX ₩${fx.usdKrw}/$ (${esc(fx.date)})</p>

      <h2>What's inside</h2>
      <div class="fields">
        <code>set_code</code> · <code>set_name_en</code> · <code>set_name_ko</code> — set identity<br />
        <code>box_price_krw</code> · <code>box_price_usd</code> — current sealed Japanese box price<br />
        <code>change_pct_since_base</code> · <code>base_date</code> · <code>launch_tracked</code> — price change since we began tracking that set (<strong>not</strong> since its release date, except where <code>launch_tracked</code> is true)<br />
        <code>msrp_jpy</code> · <code>price_vs_msrp_multiple</code> — original Japanese retail price and today's multiple of it<br />
        <code>reprint_records</code> — count of verified distributor/retailer reprint restocks (Bandai does not officially announce per-set reprints; 0 means no confirmed record, not "never reprinted")<br />
        <code>psa_graded_total</code> · <code>psa10_rate_pct</code> — PSA population and PSA 10 rate<br />
        <code>as_of</code> — data date
      </div>

      <h2>Preview (first 8 rows)</h2>
      <div style="overflow-x:auto">
      <table class="dTable">
        <thead><tr><th>Set</th><th>Name</th><th>Box (USD)</th><th>Change</th><th>vs MSRP</th><th>Reprints</th></tr></thead>
        <tbody>
${previewRows}
        </tbody>
      </table>
      </div>

      <h2>How it's built</h2>
      <p>Box prices are daily aggregates of real completed sales and verified active listings, normalised to one sealed Japanese booster box. We publish derived per-set aggregates only — never raw listing dumps. Where a value can't be verified we leave it blank rather than estimate it. MSRP and reprint records are manually verified against retailer and official sources.</p>

      <div class="attrBox">
        <strong>Attribution (CC BY 4.0)</strong> — free to use, including commercially, if you credit the source:
        <code>Data: OP Box Index — https://opboxindex.com/free-data.html</code>
      </div>

      <h2>Update frequency</h2>
      <p>The CSV is regenerated every night alongside the site's price pipeline, so the download URL always serves current data. If you need a specific historical snapshot, <a href="about.html">get in touch</a>.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="sets/index.html">Set Guides</a><a href="market.html">Market Index</a><a href="ko/">한국어 시세</a><a href="about.html">About</a><a href="privacy.html">Privacy</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "free-data.html"), html, "utf8");

// 사이트맵 idempotent 등재
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/free-data.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>`);
    fs.writeFileSync(smPath, sm, "utf8");
    added = 1;
  }
  console.log(JSON.stringify({ wrote: ["free-data.html", "opbox-set-prices.csv"], sets: rows.length, csvBytes: csv.length, sitemapAdded: added }));
}
