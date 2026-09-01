// 홈 정적 시세 요약 주입 — index.html / packs.html 의 마커 구간을 매일 갱신.
// 왜: 홈의 시세표는 packs.js가 JS로 렌더링해서, JS를 실행하지 않는 AI 크롤러·검색봇은 홈에서 가격을 하나도 못 읽었음
//     (홈은 현재 유일하게 색인된 페이지라 손실이 큼). 같은 데이터를 정적 HTML로도 굽는다.
// 표는 <details> 로 접어 둔다 — 이 표의 독자는 사람이 아니라 봇이고, 위쪽 JS 시세판과 같은 상품을
// 두 번 보여주면 화면만 길어진다. display:none 으로 숨기지 않는 이유는 그게 클로킹이기 때문이고,
// <details> 안의 내용은 구글이 정상 색인한다.
// ⚠️ head/canonical/hreflang 은 절대 건드리지 않는다(2026-07 홈 노출 0 사고).
// Run: node tools/inject-home-summary.js
const fs = require("fs");
const { navHtml } = require("./site-nav");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const START = "<!-- HOME_SUMMARY:START -->";
const END = "<!-- HOME_SUMMARY:END -->";

const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
// marketIndex 는 세트별 시세판(board) 공급원으로만 쓴다 — 지수 숫자·개봉미터 표시는
// 2026-07-29 소유자 지시로 전부 삭제됨(값이 실제와 안 맞았음).
const mi = d.marketIndex;
const fx = d.fx || {};
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));

function orderKey(code) {
  const m = code.match(/^([A-Z]+)-?(\d+)/);
  const fam = { OP: 0, EB: 1, PRB: 2 }[m ? m[1] : "OP"] ?? 9;
  return fam * 1000 + (m ? parseInt(m[2], 10) : 0);
}
const rows = [...mi.board].sort((a, b) => orderKey(a.code) - orderKey(b.code));

const tr = rows.map((b) => {
  const s = d.sets[b.code] || {};
  const chg = b.changePct;
  return `<tr><td><a href="sets/${b.code.toLowerCase()}.html">${esc(b.code)}</a></td><td>${esc(s.nameEn || "")}</td><td class="num">${usd(b.nowUsd)}</td><td class="num ${chg == null ? "" : chg >= 0 ? "up" : "down"}">${chg != null ? (chg >= 0 ? "+" : "") + chg + "%" : "—"}</td></tr>`;
}).join("\n");


// ── 홈은 현재 사실상 유일하게 색인된 페이지 → 검색어 표면적을 최대한 넓힌다.
// 답변은 전부 검증된 데이터에서 파생(추정 금지). 값이 없으면 그 항목을 만들지 않는다.
const byPrice = [...rows].filter((b) => b.nowUsd != null).sort((a, b) => b.nowUsd - a.nowUsd);
const cheapest = byPrice[byPrice.length - 1];
const priciest = byPrice[0];
const nameOf = (c) => (d.sets[c] || {}).nameEn || c;

// 상승/하락은 세트별로만 말한다 — 시장 전체를 숫자 하나로 요약하던 지수는 삭제됨(2026-07-29).
const withChg = rows.filter((b) => b.changePct != null);
const byChg = [...withChg].sort((a, b) => b.changePct - a.changePct);
const nUp = withChg.filter((b) => b.changePct > 0).length;
const nDn = withChg.filter((b) => b.changePct < 0).length;
const topUp = byChg[0];
const topDn = byChg[byChg.length - 1];

const faqs = [
  {
    q: "How much is a One Piece booster box?",
    a: `Sealed Japanese One Piece booster boxes currently range from about ${usd(cheapest.nowUsd)} (${cheapest.code} ${nameOf(cheapest.code)}) to ${usd(priciest.nowUsd)} (${priciest.code} ${nameOf(priciest.code)}), as of ${DATA_DATE}. Each price is the median of completed eBay sales we collect ourselves, updated daily. The table above lists all ${rows.length} sets.`,
  },
  {
    q: "Which One Piece booster box is the most valuable?",
    a: `${priciest.code} ${nameOf(priciest.code)} is the most expensive sealed Japanese box we track at about ${usd(priciest.nowUsd)}, ahead of ${byPrice[1].code} ${nameOf(byPrice[1].code)} at ${usd(byPrice[1].nowUsd)}.`,
  },
  {
    q: "Are One Piece booster boxes going up or down in price?",
    a: `They move set by set, not as one block. Of the ${withChg.length} Japanese sets where we have a tracked start price, ${nUp} are up and ${nDn} are down since tracking began${topUp ? `; the largest gain is ${topUp.code} at ${topUp.changePct >= 0 ? "+" : ""}${topUp.changePct}%` : ""}${topDn && topDn.changePct < 0 ? ` and the largest fall is ${topDn.code} at ${topDn.changePct}%` : ""}. See the change column above for each set.`,
  },
  {
    q: "Is a One Piece booster box worth buying sealed?",
    a: `It depends on the set. Older sets have had years for sealed supply to thin out, while recently released sets are still being opened. We publish each set's current price and its change since we began tracking it, alongside how many copies of its cards have been graded, so you can judge rather than guess. Reprints matter too — a distributor reprint adds supply and has historically pressured prices.`,
  },
  {
    q: "Where can I check One Piece card and booster box prices for free?",
    a: `This site is free and updated daily. You can browse per-set guides, the top PSA 10 card ranking, and PSA / CGC / TAG grading population by set and edition, or download citable JSON and CSV datasets under a CC BY 4.0 licence at /free-data.html.`,
  },
];
const faqLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece TCG box markets and Top 7 card data",
  description: `Citable data for ${rows.length} tracked One Piece Card Game products: Japanese and English completed-sale and active-ask box markets, Top 7 exact card variants, and field-level observation dates and sample sizes.`,
  url: "https://opboxindex.com/free-data.html",
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" },
  distribution: [
    { "@type": "DataDownload", encodingFormat: "application/json", contentUrl: "https://opboxindex.com/opbox-ai-data.json" },
    { "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: "https://opboxindex.com/opbox-set-prices.csv" },
  ],
});
const faqHtml = faqs.map((f) => `<details class="homeFaq"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n          ");

// ── 2026-08-28 구조 변경(소유자 지시): 보고서식 설명·FAQ 전부 삭제, TCG 퀀트처럼 표만.
//    사람용 전체 표는 전용 페이지 box-prices.html(홈에서 1클릭, 색인 O, 매일 재생성)로.
//    홈 마커 구간: 한 줄 + 링크 + **접힌 정적 표** — 표를 아예 빼면 R1(봇용 정적 시세)이
//    무너져 노출 불가침 위반이다. 접힌 표는 화면 ~40px 이고 봇은 정상 색인한다(7월 원설계).
const block = `${START}
        <section class="homeSummary" aria-label="Current Japanese booster box prices">
          <h2>Japanese booster box prices — all ${rows.length} sets (${esc(DATA_DATE)})</h2>
          <p>${usd(cheapest.nowUsd)} (${esc(cheapest.code)}) – ${usd(priciest.nowUsd)} (${esc(priciest.code)}), median of completed eBay sales, updated daily. <strong>${nUp}</strong> up · <strong>${nDn}</strong> down over 4 weeks. <a href="box-prices.html"><strong>Full table — all ${rows.length} sets →</strong></a></p>
          <details class="homeCollapse">
          <summary>Quick table (same data as the full page)</summary>
          <div style="overflow-x:auto">
          <table class="homeSummaryTable">
            <thead><tr><th>Set</th><th>Name</th><th>Box price</th><th>Change</th></tr></thead>
            <tbody>
${tr}
            </tbody>
          </table>
          </div>
          </details>
          <p class="note"><a href="free-data.html">Citable data (JSON/CSV)</a> · <a href="psa-grading.html">Grading population</a> · <a href="auction.html">Auctions</a> · <a href="ko/">한국어 시세</a></p>
        </section>
        ${/* 홈은 사이트에서 가장 많이 색인되는 페이지다. 화면은 짧게(접힘) 두되 본문은 실어야
             검색이 읽을 게 있다 — 2026-08-28 "표만" 정리로 본문이 7,861→4,425자로 줄어
             GSC 가 홈 노출 급감을 경고했다. 접힌 콘텐츠도 구글은 정상 색인한다. */ ""}
        <section class="homeFaqWrap" aria-label="Frequently asked questions">
          <details class="homeCollapse">
          <summary><h2>One Piece booster box prices — common questions</h2></summary>
          ${faqHtml}
          </details>
        </section>
        <script type="application/ld+json">${faqLd}</script>
        <script type="application/ld+json">${dsLd}</script>
        ${END}`;

const NAV = `<header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("")}
    </header>`;

const pricesPage = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-P73SE1WVD0');
    </script>
    <script defer src="/track.js"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="https://opboxindex.com/box-prices.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>One Piece Booster Box Prices — All ${rows.length} Sets, Updated Daily | OP Box Index</title>
    <meta name="description" content="Current sealed Japanese One Piece booster box prices for all ${rows.length} sets, from ${usd(cheapest.nowUsd)} to ${usd(priciest.nowUsd)}, each the median of completed eBay sales, updated daily. With 4-week change and FAQ." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="One Piece Booster Box Prices — All ${rows.length} Sets, Updated Daily" />
    <meta property="og:description" content="Sealed Japanese box prices ${usd(cheapest.nowUsd)}–${usd(priciest.nowUsd)}, median of completed eBay sales, with 4-week change per set." />
    <meta property="og:url" content="https://opboxindex.com/box-prices.html" />
    <meta property="og:image" content="https://opboxindex.com/og-image.png" />
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <script type="application/ld+json">${dsLd}</script>
    <style>
      .homeSummaryTable { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
      .homeSummaryTable th { text-align: left; padding: 6px 8px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-weight: 600; }
      .homeSummaryTable td { padding: 6px 8px; border-bottom: 1px solid rgba(255,255,255,.06); }
      .homeSummaryTable td.num { text-align: right; }
      .homeSummaryTable td.up { color: #10d7a0; } .homeSummaryTable td.down { color: #e5484d; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    ${NAV}
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">Prices · Updated ${esc(DATA_DATE)} · refreshed daily</p>
      <h1>Japanese One Piece booster box prices — all ${rows.length} sets</h1>
      <p class="note">Median of completed eBay sales · "Change" = vs 4 weeks earlier · ${nUp} up, ${nDn} down</p>
      <div style="overflow-x:auto">
      <table class="homeSummaryTable">
        <thead><tr><th>Set</th><th>Name</th><th>Box price</th><th>Change</th></tr></thead>
        <tbody>
${tr}
        </tbody>
      </table>
      </div>
      <p class="note">Updated ${esc(DATA_DATE)} · <a href="free-data.html">Data (JSON/CSV)</a> · <a href="psa-grading.html">Grading population</a> · <a href="auction.html">Auctions</a> · <a href="ko/">한국어</a></p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation">
        <a href="./">Home</a>
        <a href="sets/index.html">Set Guides</a>
        <a href="about.html">About</a>
        <a href="methodology.html">Methodology</a>
        <a href="changelog.html">Corrections</a>
        <a href="free-data.html">Free data (CSV)</a>
      </nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "box-prices.html"), pricesPage);
console.error("wrote box-prices.html");

// 사이트맵에 box-prices.html 이 없으면 추가(추가만 — 기존 항목은 절대 안 건드림).
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  if (!sm.includes("https://opboxindex.com/box-prices.html")) {
    const entry = `  <url>\n    <loc>https://opboxindex.com/box-prices.html</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;
    sm = sm.replace("</urlset>", entry + "</urlset>");
    fs.writeFileSync(smPath, sm);
    console.error("sitemap: box-prices.html added");
  }
}

let touched = 0;
for (const f of ["index.html", "packs.html"]) {
  const fp = path.join(ROOT, f);
  if (!fs.existsSync(fp)) continue;
  let h = fs.readFileSync(fp, "utf8");
  if (h.includes(START) && h.includes(END)) {
    h = h.replace(new RegExp(`${START}[\\s\\S]*?${END}`), block);
  } else {
    // 최초 삽입: 상세 영역 뒤(본문 안)에 붙인다. head 는 건드리지 않음.
    const anchor = `<div id="detail"></div>`;
    if (!h.includes(anchor)) { console.error(`SKIP ${f}: anchor not found`); continue; }
    h = h.replace(anchor, `${anchor}\n        ${block}`);
  }
  fs.writeFileSync(fp, h, "utf8");
  touched++;
}
console.log(JSON.stringify({ touched, sets: rows.length }));
