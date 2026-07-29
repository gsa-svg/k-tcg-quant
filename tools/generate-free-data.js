// 무료 데이터셋 생성 — /free-data.html + CSV 3종
// 목적: 피인용(백링크)으로 도메인 신뢰도를 올리는 자산. 색인 병목의 실제 원인이 외부링크 부족이라 이걸 겨냥.
//
// 2026-07-29 개편: 박스 시세 21줄만 내주던 걸 바꿨다. 그 표는 홈에도 그대로 있어서
// 굳이 받을 이유가 없었고(소유자 지적), 정가 대비 배수·재판 횟수는 각각 쓸모없다고 판단되었거나
// 세트 페이지로 옮겨갔다. 대신 우리만 가진 두 가지를 낸다:
//   ① 등급 인구 — PSA/CGC/TAG 3사를 세트별·판별로 쪼갠 것. 이렇게 나눠 내는 곳이 없다.
//   ② 경매 실거래 — 일별 낙찰가 중앙값·낙찰률·입찰경쟁. eBay 도 무료로는 안 준다.
//
// ⚠️ 원시 리스팅 덤프 금지 — "파생 집계"만 낸다. 외부 소스명 표기 금지(가드 S1).
// ⚠️ 판별·등급사 합산 금지. 합치면 젬률도 낙찰률도 아무것도 설명하지 못하는 값이 된다.
// Run: node tools/generate-free-data.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";  // 하드코딩 금지 — 범프 때 가드 V1 이 배포를 막는다(2026-07-27)

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

const writeCsv = (name, head, lines) => {
  fs.writeFileSync(path.join(ROOT, name), [head.join(","), ...lines].join("\n") + "\n", "utf8");
  return lines.length;
};

// ---- ① 박스 시세 (파생 집계만)
// 정가 대비 배수·재판 횟수는 뺐다 — 배수는 쓰지 않기로 했고(소유자 판단), 재판 기록은
// 세트 페이지에서 소스와 함께 보여주는 편이 정확하다.
const HEAD = [
  "set_code", "set_name_en", "set_name_ko", "box_price_krw", "box_price_usd",
  "change_pct_since_base", "base_date", "launch_tracked", "as_of",
];
const nPrices = writeCsv("opbox-set-prices.csv", HEAD, rows.map((b) => {
  const s = d.sets[b.code] || {};
  return [
    b.code, s.nameEn ?? "", s.nameKo ?? "",
    boxKrw(b.code, b.nowUsd) ?? "", b.nowUsd ?? "",
    b.changePct ?? "", b.baseDate ?? "", b.launchTracked ? "true" : "false", DATA_DATE,
  ].map(cell).join(",");
}));

// ---- ② 등급 인구 (세트 × 판별 × 등급사)
// 한 행 = 한 세트의 한 판(일본판 또는 영문판). 세 등급사를 나란히 두되 절대 더하지 않는다 —
// PSA 10, CGC Pristine 10, TAG 10 은 기준이 다른 등급이라 합계에 의미가 없다.
const GRADE_HEAD = [
  "set_code", "set_name_en", "edition",
  "psa_total", "psa10_rate_pct", "psa_weekly_add",
  "cgc_total", "cgc_pristine10", "cgc_gem_mint10",
  "tag_total", "tag_10", "tag_10p",
  "as_of",
];
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8")); } catch { return null; } };
const cgcSrc = readJson("cgc-grading-history.json");
const tagSrc = readJson("tag-grading-history.json");
const latest = (src, code, ed) => {
  const arr = src && src.sets && src.sets[code] && src.sets[code][ed];
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
};
const gradeLines = [];
for (const b of rows) {
  const s = d.sets[b.code] || {};
  for (const ed of ["jp", "en"]) {
    const psa = ed === "jp" ? s.psaFull : s.psaFullEn;
    const cgc = latest(cgcSrc, b.code, ed);
    const tag = latest(tagSrc, b.code, ed);
    if (!psa && !cgc && !tag) continue;                       // 세 곳 다 없으면 행을 만들지 않는다
    const g = (cgc && cgc.grades) || {};
    gradeLines.push([
      b.code, s.nameEn ?? "", ed === "jp" ? "japanese" : "english",
      psa?.total ?? "", psa?.gemRate ?? "", psa?.wowAdd ?? "",
      cgc?.total ?? "", g["Pristine 10"] ?? "", g["Gem Mint 10"] ?? "",
      tag?.total ?? "", tag?.g10 ?? "", tag?.g10p ?? "",
      psa?.updated || cgc?.d || tag?.d || DATA_DATE,
    ].map(cell).join(","));
  }
}
const nGrades = writeCsv("opbox-grading-population.csv", GRADE_HEAD, gradeLines);

// ---- ③ 경매 실거래 (일별)
// 낙찰가는 경매가 끝난 뒤에 읽은 값이라 호가가 아니다. 유찰도 그대로 남겨 낙찰률의 분모로 쓴다.
const AUCTION_HEAD = [
  "date", "kind", "auctions", "sold", "sell_through_pct", "median_price_usd", "median_bids",
];
const auctionSrc = readJson("auction-sold.json");
const auctionLines = [];
for (const p of (auctionSrc && auctionSrc.daily) || []) {
  const put = (kind, a) => {
    if (!a || !a.n) return;
    auctionLines.push([p.d, kind, a.n, a.sold, a.sellThrough ?? "", a.medPrice ?? "", a.medBids ?? ""].map(cell).join(","));
  };
  put("all", p);
  for (const k of ["box", "card", "pack"]) put(k, (p.byKind || {})[k]);
}
const nAuctions = writeCsv("opbox-auction-daily.csv", AUCTION_HEAD, auctionLines);

// ---- 랜딩 페이지
// 미리보기 — 등급 인구를 앞세운다. 이게 이 페이지에서 유일하게 다른 데 없는 표다.
const gradePreview = gradeLines.slice(0, 8).map((line) => {
  const c = line.split(",");
  const td = (v) => `<td class="num">${v === "" ? "—" : esc(v)}</td>`;
  return `<tr><td>${esc(c[0])}</td><td>${c[2] === "japanese" ? "Japanese" : "English"}</td>${td(c[3])}${td(c[4] === "" ? "" : c[4] + "%")}${td(c[6])}${td(c[7])}${td(c[9])}</tr>`;
}).join("\n");

const datasetLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece Card Game grading population and auction results (free CSV)",
  description: `Three free CSVs, updated daily. Grading population: PSA, CGC and TAG graded counts per set with Japanese and English printings recorded separately and never summed (${nGrades} set-edition rows). Completed eBay auction results by day: number of auctions, how many sold, sell-through rate, median winning bid and median bid count, split by sealed box, single card and pack. Japanese booster box prices for ${nPrices} sets with change since tracking start.`,
  url: `${SITE}/free-data.html`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true,
  dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  distribution: [
    { "@type": "DataDownload", name: "Grading population by set and edition", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-grading-population.csv` },
    { "@type": "DataDownload", name: "Completed auction results by day", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-auction-daily.csv` },
    { "@type": "DataDownload", name: "Japanese booster box prices", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-set-prices.csv` },
  ],
  variableMeasured: [...GRADE_HEAD, ...AUCTION_HEAD, ...HEAD].filter((v, i, a) => a.indexOf(v) === i),
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
    <title>Free One Piece TCG Data — Grading Population &amp; Auction Results (CSV) | OP Box Index</title>
    <meta name="description" content="Free CSV data for the One Piece Card Game: PSA, CGC and TAG grading population per set with Japanese and English kept separate, completed eBay auction results by day (sell-through, median winning bid, bid counts), and Japanese booster box prices. Updated daily, CC BY 4.0." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Free One Piece TCG Data — Grading Population &amp; Auction Results (CSV)" />
    <meta property="og:description" content="PSA / CGC / TAG population by set and printing, plus daily completed-auction results. Free, updated daily, CC BY 4.0." />
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
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow">Free data</p>
      <h1>Free One Piece TCG data — grading population and auction results</h1>
      <p>Three CSVs, regenerated daily, free under CC BY 4.0. The first two are things you cannot get anywhere else for free: <strong>grading population split by grader and by printing</strong>, and <strong>completed eBay auction outcomes</strong> — not asking prices, but what auctions actually closed at.</p>

      <div class="dlRow">
        <a class="primary" href="opbox-grading-population.csv" download>Grading population (${nGrades} rows)</a>
        <a class="primary" href="opbox-auction-daily.csv" download>Auction results by day (${nAuctions} rows)</a>
        <a class="ghost" href="opbox-set-prices.csv" download>Box prices (${nPrices} sets)</a>
      </div>
      <p class="note">Last updated ${esc(DATA_DATE)} · FX ₩${fx.usdKrw}/$ (${esc(fx.date)})</p>

      <h2>1. Grading population — <code>opbox-grading-population.csv</code></h2>
      <p>One row per set <em>per printing</em>. Japanese and English are different print runs with different pull rates, so we record them separately and <strong>never add them together</strong> — a combined gem rate describes neither. The same applies across graders: a PSA 10, a CGC Pristine 10 and a TAG 10 are different standards, so the columns sit side by side and are never summed.</p>
      <div class="fields">
        <code>set_code</code> · <code>edition</code> — <code>japanese</code> or <code>english</code><br />
        <code>psa_total</code> · <code>psa10_rate_pct</code> · <code>psa_weekly_add</code> — cumulative PSA count, PSA 10 share, and how many were added in the latest week we recorded<br />
        <code>cgc_total</code> · <code>cgc_pristine10</code> · <code>cgc_gem_mint10</code> — CGC splits its top grade in two; Pristine 10 is the stricter one<br />
        <code>tag_total</code> · <code>tag_10</code> · <code>tag_10p</code> — TAG's 10 and its stricter 10P<br />
        <code>as_of</code> — the date that row was collected. Blank means we have not confirmed a figure, not zero.
      </div>

      <h2>Preview — grading population</h2>
      <div style="overflow-x:auto">
      <table class="dTable">
        <thead><tr><th>Set</th><th>Printing</th><th>PSA</th><th>PSA 10 rate</th><th>CGC</th><th>Pristine 10</th><th>TAG</th></tr></thead>
        <tbody>
${gradePreview}
        </tbody>
      </table>
      </div>

      <h2>2. Auction results by day — <code>opbox-auction-daily.csv</code></h2>
      <p>Every row is one day and one product type. Each auction is read <em>after</em> it closed, so <code>median_price_usd</code> is the final winning bid, not a mid-auction figure — the difference is real, since sniping regularly moves a price in the last minutes. Auctions that ended unsold stay in the data as the denominator of <code>sell_through_pct</code>; dropping them would flatter every price.</p>
      <div class="fields">
        <code>date</code> · <code>kind</code> — <code>all</code>, <code>box</code>, <code>card</code> or <code>pack</code><br />
        <code>auctions</code> · <code>sold</code> · <code>sell_through_pct</code> — how many ran, how many actually sold<br />
        <code>median_price_usd</code> — median final winning bid, per item for multi-item lots<br />
        <code>median_bids</code> — median bid count, a rough read on competition
      </div>

      <h2>3. Japanese booster box prices — <code>opbox-set-prices.csv</code></h2>
      <p>Current sealed box price per set in KRW and USD, with change measured from each set's tracking start date — <strong>not</strong> from its release date, except where <code>launch_tracked</code> is true. Reprint history moved to the individual <a href="sets/index.html">set guides</a>, where it can be shown with its sources.</p>

      <h2>How it's built</h2>
      <p>Prices are aggregates of real completed sales and verified active listings, normalised to one sealed Japanese booster box. Grading counts come from each grader's own public population reporting, collected weekly and appended to a ledger we never rewrite. Auction figures are read from listings after they close. We publish derived aggregates only — never raw listing dumps. Where a value cannot be verified we leave it blank rather than estimate it.</p>

      <div class="attrBox">
        <strong>Attribution (CC BY 4.0)</strong> — free to use, including commercially, if you credit the source:
        <code>Data: OP Box Index — https://opboxindex.com/free-data.html</code>
      </div>

      <h2>Update frequency</h2>
      <p>All three files are regenerated every night alongside the site's data pipeline, so the download URLs always serve current data. If you need a specific historical snapshot, <a href="about.html">get in touch</a>.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="sets/index.html">Set Guides</a><a href="psa-grading.html">Grading Population</a><a href="ko/">한국어 시세</a><a href="about.html">About</a><a href="privacy.html">Privacy</a></nav>
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
  console.log(JSON.stringify({
    wrote: ["free-data.html", "opbox-grading-population.csv", "opbox-auction-daily.csv", "opbox-set-prices.csv"],
    gradingRows: nGrades, auctionRows: nAuctions, priceRows: nPrices, sitemapAdded: added,
  }));
}
