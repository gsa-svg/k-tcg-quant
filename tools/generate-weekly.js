// 주간 시장 표 — weekly.html 한 장을 제자리에서 갱신한다(페이지가 쌓이지 않는다). 2026-09-24.
//
// 왜 한 장인가: 2026-07 에 만든 자동 주간 리포트(articles/weekly-market-report-*.html)는 얇은 자동 페이지가
// 쌓인다는 이유로 noindex 로 묶였고 한 번 만들고 멈췄다. 애드센스 심사 중이기도 하다(얇은 페이지 금지).
// 주소 하나가 매주 새 표로 바뀌는 쪽이 낫다 — 단골이 "이번 주엔 뭐가 움직였나"를 보러 올 자리가 생기고
// 색인 대상은 한 장뿐이다.
//
// 숫자는 전부 data/box-sold-series.json(주간 실거래 중앙값·그 주 판매수·매물 수)과 onepiece-packs.json 의
// marketIndex.board(4주 변화 — 홈 티커·표와 같은 값)에서 그대로 온다. 추정 없음, 문단 없음(표·라벨만).
// WoW = 이번 주 점 ÷ 정확히 7일 전 점. 그 점이 없으면(창 미달로 빠짐) "—".
// Run: node tools/generate-weekly.js
const fs = require("node:fs");
const path = require("node:path");
const { navHtml } = require("./site-nav");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const S = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8"));
const DATA_DATE = S.updated || d.updated || new Date().toISOString().slice(0, 10);
const ORDER = [...(d.jp?.list || []), ...(d.extra?.list || [])];
const board = {};
for (const b of (d.marketIndex && d.marketIndex.board) || []) board[b.code] = b;

const esc = (x) => String(x == null ? "" : x).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const DAY = 864e5;
const addDays = (iso, n) => new Date(Date.parse(iso) + n * DAY).toISOString().slice(0, 10);
const pctCell = (v) => v == null ? `<td class="num">—</td>`
  : `<td class="num ${v > 0 ? "up" : v < 0 ? "down" : "flat"}">${v > 0 ? "+" : ""}${v.toFixed(1)}%</td>`;

// 이번 주 = 시리즈 전체에서 가장 늦은 주간 점 날짜. 세트마다 마지막 점이 다를 수 있으니 "그 주"를 기준으로 맞춘다.
const weekEnd = ORDER.map((c) => ((S.sets[c] || {}).jp || []).concat((S.sets[c] || {}).en || []).map((p) => p.d)).flat().sort().pop();
const weekStart = weekEnd ? addDays(weekEnd, -6) : null;

function rowsFor(ed) {
  const rows = [];
  for (const code of ORDER) {
    const set = S.sets[code] || {};
    const pts = (set[ed] || []).filter((p) => p && p.median != null);
    if (!pts.length) continue;
    const last = pts[pts.length - 1];
    // 시리즈마다 7일 격자의 기준일이 달라(JP 09-21, EN 09-22) 마지막 점이 같은 주에 있으면 "이번 주"로 본다.
    const isThisWeek = !!(weekStart && last.d >= weekStart && last.d <= weekEnd);
    const prev = pts.find((p) => p.d === addDays(last.d, -7)) || null;
    const wow = prev ? (last.median / prev.median - 1) * 100 : null;
    // 4주 변화: 일본판은 board(홈 티커·표와 같은 값), 영문판은 같은 규칙(28일 이상 전 마지막 점)으로 여기서 계산
    let c4 = null;
    if (ed === "jp" && board[code] && board[code].changePct != null && board[code].nowDate === last.d) c4 = board[code].changePct;
    else {
      const base = pts.filter((p) => Date.parse(p.d) <= Date.parse(last.d) - 28 * DAY).pop();
      if (base) c4 = Math.round((last.median / base.median - 1) * 1000) / 10;
    }
    const sup = (set.supply || []).filter((p) => p && p[ed] != null);
    const supNow = sup.length ? sup[sup.length - 1] : null;
    const supPrev = supNow ? sup.filter((p) => p.d <= addDays(supNow.d, -7)).pop() : null;
    rows.push({
      code, name: (d.sets[code] || {}).nameEn || code, last, prev, wow, c4, isThisWeek,
      listed: supNow ? supNow[ed] : null, listedPrev: supPrev ? supPrev[ed] : null,
    });
  }
  // 이번 주 점이 있는 세트를 WoW 순으로, 그 뒤에 이번 주 점이 없는 세트(마지막 판매 주 표기)
  rows.sort((a, b) => (b.isThisWeek ? 1 : 0) - (a.isThisWeek ? 1 : 0) || (b.wow ?? -Infinity) - (a.wow ?? -Infinity));
  return rows;
}

function table(ed, rows) {
  const href = (r) => ed === "jp" ? `sets/${r.code.toLowerCase()}.html` : `sets/${r.code.toLowerCase()}-english.html`;
  const tr = rows.map((r) => `<tr${r.isThisWeek ? "" : ' class="stale"'}><td><a href="${href(r)}">${esc(r.code)}</a></td><td>${esc(r.name)}</td><td class="num">${r.prev ? usd(r.prev.median) : "—"}</td><td class="num"><b>${usd(r.last.median)}</b>${r.isThisWeek ? "" : `<small class="when"> wk ${esc(r.last.d.slice(5))}</small>`}</td>${pctCell(r.wow)}${pctCell(r.c4)}<td class="num">${r.last.vol != null ? r.last.vol : "—"}<small> / n=${r.last.n}</small></td><td class="num">${r.listed != null ? r.listed : "—"}${r.listed != null && r.listedPrev != null && r.listed !== r.listedPrev ? `<small class="${r.listed > r.listedPrev ? "up" : "down"}"> ${r.listed > r.listedPrev ? "+" : ""}${r.listed - r.listedPrev}</small>` : ""}</td></tr>`).join("\n");
  return `<div style="overflow-x:auto"><table class="wkTable">
        <thead><tr><th>Set</th><th>Name</th><th>Last week</th><th>This week</th><th>WoW</th><th>4-wk</th><th>Sales · n</th><th>Listed (Δ wk)</th></tr></thead>
        <tbody>
${tr}
        </tbody></table></div>`;
}

const jpRows = rowsFor("jp");
const enRows = rowsFor("en");
const jpThis = jpRows.filter((r) => r.isThisWeek && r.wow != null);
const up = jpThis.filter((r) => r.wow > 0.5).length, down = jpThis.filter((r) => r.wow < -0.5).length;
const volJp = jpRows.filter((r) => r.isThisWeek).reduce((a, r) => a + (r.last.vol || 0), 0);
const volEn = enRows.filter((r) => r.isThisWeek).reduce((a, r) => a + (r.last.vol || 0), 0);

// 등급 인구 주간 증가 — GemRate 주간 델타(psaWeekly). 10일 넘게 낡았으면 표를 내지 않는다(옛 값을 이번 주로 읽히지 않게).
let gradeTable = "", gradeWeek = null;
{
  const rows = [];
  for (const code of ORDER) {
    const w = (d.sets[code] || {}).psaWeekly;
    const pts = (w && w.points) || [];
    if (!pts.length) continue;
    const last = pts[pts.length - 1];
    const prev = pts[pts.length - 2] || null;
    rows.push({ code, name: (d.sets[code] || {}).nameEn || code, d: last.d, v: last.v, prev: prev ? prev.v : null });
  }
  const latest = rows.map((r) => r.d).sort().pop();
  const age = latest ? Math.round((Date.parse(DATA_DATE) - Date.parse(latest)) / DAY) : null;
  if (rows.length && age != null && age <= 10) {
    gradeWeek = latest;
    const cur = rows.filter((r) => r.d === latest).sort((a, b) => b.v - a.v);
    const total = cur.reduce((a, r) => a + r.v, 0);
    gradeTable = `<h2 id="grading" data-ko="이번 주 PSA 등급 증가 — 세트별">PSA grades added this week — by set</h2>
      <p class="note" data-ko="GemRate 세트 집계 주간 델타 · 주 ${esc(latest)} · 합계 ${total.toLocaleString("en-US")}장 · 일본판. 등급 수는 제출 활동이지 박스 개봉 수가 아닙니다.">GemRate set-level weekly delta · week of ${esc(latest)} · total ${total.toLocaleString("en-US")} · Japanese. Grades measure submission activity, not boxes opened.</p>
      <div style="overflow-x:auto"><table class="wkTable">
        <thead><tr><th>Set</th><th>Name</th><th>New PSA grades</th><th>Prev week</th><th>WoW</th></tr></thead>
        <tbody>
${cur.map((r) => `<tr><td><a href="sets/${r.code.toLowerCase()}.html">${esc(r.code)}</a></td><td>${esc(r.name)}</td><td class="num"><b>${r.v.toLocaleString("en-US")}</b></td><td class="num">${r.prev != null ? r.prev.toLocaleString("en-US") : "—"}</td>${pctCell(r.prev ? (r.v / r.prev - 1) * 100 : null)}</tr>`).join("\n")}
        </tbody></table></div>`;
  }
}

const title = `One Piece Box Prices This Week — week ending ${weekEnd}`;
const desc = `Week ending ${weekEnd}: ${up} Japanese boxes up, ${down} down week over week; ${volJp} JP and ${volEn} EN completed box sales tracked. Tables from our eBay sold ledger, dated per row.`;
const ld = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece booster box prices — weekly table", description: desc, url: `${SITE}/weekly.html`,
  temporalCoverage: `${weekStart}/${weekEnd}`, dateModified: DATA_DATE, license: "https://creativecommons.org/licenses/by/4.0/",
  creator: { "@type": "Organization", name: "OP Box Index", url: SITE },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-set-prices.csv` }],
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <!-- 광고 없음: 표 페이지는 애드센스 허용 목록 밖(audit-adsense-readiness), 심사 중 광고 코드 변경 금지 -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/weekly.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${SITE}/weekly.html" />
    <meta property="og:image" content="${SITE}/og/og-compare.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${ld}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .wkTable { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 10px 0 4px; }
      .wkTable th { text-align: right; padding: 8px 9px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; text-transform: uppercase; white-space: nowrap; }
      .wkTable th:nth-child(1), .wkTable th:nth-child(2) { text-align: left; }
      .wkTable td { padding: 7px 9px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .wkTable td.num { text-align: right; white-space: nowrap; }
      .wkTable td.up, .wkTable small.up { color: #10d7a0; } .wkTable td.down, .wkTable small.down { color: #e5484d; } .wkTable td.flat { color: #9aa4b6; }
      .wkTable small { font-size: 10.5px; color: #6f7688; }
      .wkTable tr.stale td { opacity: .6; } .wkTable tr.stale td .when { opacity: 1; color: #f5c842; }
      .wkSummary { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0 6px; }
      .wkSummary span { padding: 5px 11px; border: 1px solid #2a3140; border-radius: 999px; font-size: 12.5px; color: #cfd6e4; font-variant-numeric: tabular-nums; }
      .wkSummary b { color: #eef2ff; }
      h2 { margin-top: 30px; }
      .note { color: #9aa4b6; font-size: 12.5px; line-height: 1.6; }
      @media (max-width: 640px) { .wkTable td:nth-child(2) { display: none; } .wkTable th:nth-child(2) { display: none; } }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("")}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow" data-ko="이번 주 · 주 ${esc(weekStart)} – ${esc(weekEnd)} · 데이터 ${esc(DATA_DATE)} · 매주 갱신">This week · ${esc(weekStart)} – ${esc(weekEnd)} · data ${esc(DATA_DATE)} · refreshed weekly</p>
      <h1 data-ko="원피스 박스 시세 — 이번 주">One Piece booster box prices — this week</h1>
      <div class="wkSummary" aria-label="Week summary">
        <span data-ko-html="일본판 주간 <b>▲ ${up}</b> · <b>▼ ${down}</b>">JP week over week <b>▲ ${up}</b> · <b>▼ ${down}</b></span>
        <span data-ko-html="이번 주 실거래 <b>${volJp}</b> JP · <b>${volEn}</b> EN">Completed sales this week <b>${volJp}</b> JP · <b>${volEn}</b> EN</span>
        <span data-ko-html="세트 <b>${ORDER.length}</b> · USD · 이베이 즉시구매 실거래">Sets <b>${ORDER.length}</b> · USD · eBay Buy-It-Now sales</span>
      </div>
      <p class="note" data-ko-html="이번 주 = 주간 점 ${esc(weekEnd)}. &quot;Last week&quot;는 정확히 7일 전 점(없으면 —). 4-wk = 28일 이상 전 마지막 점 대비(홈과 같은 값). Sales = 그 주 실거래 건수, n = 중앙값이 딛고 선 표본. Listed = 지금 올라와 있는 검수 통과 매물 수(Δ = 7일 전 대비). 이번 주 점이 없는 세트는 흐리게, 마지막 판매 주를 표시. <a href=&quot;methodology.html#box-median&quot;>규칙</a>.">This week = the weekly point dated ${esc(weekEnd)}. "Last week" = the point exactly 7 days earlier (— if missing). 4-wk = vs the last point 28+ days earlier (same figure as the home page). Sales = completed sales that week; n = the sample under the median. Listed = verified listings on sale now (Δ vs 7 days earlier). Sets without a point this week are dimmed and show their last sale week. <a href="methodology.html#box-median">Rules</a>.</p>

      <h2 id="jp" data-ko="일본판 박스 — 주간 변화">Japanese boxes — week over week</h2>
      ${table("jp", jpRows)}

      <h2 id="en" data-ko="영문판 박스 — 주간 변화">English boxes — week over week</h2>
      ${table("en", enRows)}

      ${gradeTable}

      <p class="note" style="margin-top:22px" data-ko-html="같은 숫자의 다른 화면: <a href=&quot;./&quot;>홈(4주 등락·그래프)</a> · <a href=&quot;box-prices.html&quot;>전체 박스 시세</a> · <a href=&quot;sets/index.html&quot;>세트 가이드</a> · <a href=&quot;free-data.html&quot;>CSV/JSON</a>">Same numbers, other views: <a href="./">home (4-week movers, charts)</a> · <a href="box-prices.html">all box prices</a> · <a href="sets/index.html">set guides</a> · <a href="free-data.html">CSV / JSON</a></p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="sets/index.html">Set Guides</a><a href="psa-grading.html">Grading Population</a><a href="ko/">한국어 시세</a><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="changelog.html">Changelog</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "weekly.html"), html, "utf8");

// 사이트맵 idempotent 등재 + lastmod 갱신
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/weekly.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    added = 1;
  } else {
    sm = sm.replace(new RegExp(`(<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>\\s*<lastmod>)[^<]*`), `$1${DATA_DATE}`);
  }
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: "weekly.html", weekEnd, jpRows: jpRows.length, enRows: enRows.length, up, down, volJp, volEn, gradeWeek, sitemapAdded: added }));
}
