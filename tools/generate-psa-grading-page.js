#!/usr/bin/env node
// PSA 그레이딩 접수 현황 페이지 생성 — 2026-07-27 신설.
//
// 무엇: 추적 21개 세트의 PSA 누적 등급 수를 일본판/영문판으로 나눠 한 페이지에 모으고,
// 최근 두 주의 차이(주간 증감)를 함께 싣는다. 주간 막대 그래프는 쓰지 않는다 —
// 두 날짜의 숫자 두 개면 같은 이야기를 더 정확하게 할 수 있다.
//
// 데이터: data/psa-edition-weekly.json (판별 누적 스냅샷, append-only)
//        data/onepiece-packs.json (psaFull / psaFullEn 최신 총량)
// 합산 금지: 일본판+영문판을 더하면 젬률이 어느 쪽도 설명하지 못하는 값이 된다.
// Run: node tools/generate-psa-grading-page.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "psa-grading.html");
const pk = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const led = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "psa-edition-weekly.json"), "utf8"));
const ver = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1];

const weeks = led.weeks.slice(-2);
if (weeks.length < 2) { console.error("주간 비교에 두 점이 필요 — 페이지 미생성"); process.exit(1); }
const [wPrev, wNow] = weeks;
const n = (v) => (v == null ? "&mdash;" : v.toLocaleString("en-US"));
const pc = (v) => (v == null ? null : (v >= 0 ? "+" : "") + v.toFixed(2) + "%");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const codes = [...(pk.jp?.list || []), ...(pk.extra?.list || [])];
const rows = codes.map((code) => {
  const set = pk.sets[code];
  const s = led.sets[code] || {};
  const delta = (ed) => {
    const arr = s[ed] || [];
    const a = arr.find((p) => p.d === wPrev), b = arr.find((p) => p.d === wNow);
    return a && b ? { add: b.g - a.g, pct: ((b.g - a.g) / a.g) * 100 } : null;
  };
  return {
    code, name: set.nameEn,
    jp: set.psaFull ? { total: set.psaFull.total, gem: set.psaFull.gemRate } : null, jpD: delta("jp"),
    en: set.psaFullEn ? { total: set.psaFullEn.total, gem: set.psaFullEn.gemRate } : null, enD: delta("en"),
  };
});
rows.sort((a, b) => ((b.jp?.total || 0) + (b.en?.total || 0)) - ((a.jp?.total || 0) + (a.en?.total || 0)));

const sum = (f) => rows.reduce((t, r) => t + (f(r) || 0), 0);
const tj = sum((r) => r.jp?.total), te = sum((r) => r.en?.total);
const aj = sum((r) => r.jpD?.add), ae = sum((r) => r.enD?.add);
const updated = pk.sets[codes[0]].psaFull.updated;
const enCount = rows.filter((r) => r.en).length;

const cell = (d, ed) => (d
  ? `<td class="pgAdd">+${n(d.add)}</td><td class="pgPct ${ed}">${pc(d.pct)}</td>`
  : `<td class="pgAdd">&mdash;</td><td class="pgPct"><span class="pgNa">no PSA data</span></td>`);
const tr = (r) => `        <tr data-code="${r.code}">
          <th scope="row"><a href="sets/${r.code.toLowerCase()}.html"><b>${r.code}</b><span>${esc(r.name)}</span></a></th>
          <td class="pgNum">${n(r.jp?.total)}</td><td class="pgGem">${r.jp ? r.jp.gem + "%" : "&mdash;"}</td>${cell(r.jpD, "jp")}
          <td class="pgNum pgSplit">${n(r.en?.total)}</td><td class="pgGem">${r.en ? r.en.gem + "%" : "&mdash;"}</td>${cell(r.enD, "en")}
        </tr>`;

const TITLE = "One Piece PSA Population by Set — Japanese vs English | OP Box Index";
const DESC = `How many One Piece cards from each booster set have been PSA graded, split by Japanese and English printing, with gem rate and week-over-week change. ${rows.length} sets, updated ${updated}.`;
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="https://opboxindex.com/psa-grading.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${TITLE}</title>
    <meta name="description" content="${esc(DESC)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${TITLE}" />
    <meta property="og:description" content="${esc(DESC)}" />
    <meta property="og:url" content="https://opboxindex.com/psa-grading.html" />
    <meta property="og:image" content="https://opboxindex.com/og-image.png" />
    <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset", name: "One Piece PSA population by set (Japanese and English)", description: DESC, isAccessibleForFree: true, creator: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" }, temporalCoverage: `${wPrev}/${wNow}`, dateModified: updated, variableMeasured: ["Total PSA graded", "PSA 10 gem rate", "Weekly change in graded count"] })}</script>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "OP Box Index", item: "https://opboxindex.com/" }, { "@type": "ListItem", position: 2, name: "PSA Population", item: "https://opboxindex.com/psa-grading.html" }] })}</script>
    <link rel="stylesheet" href="styles.css?v=${ver}" />
    <style>
      .pgWrap { max-width: 980px; margin: 0 auto; padding: 20px clamp(16px,3vw,28px) 44px; }
      .pgWrap h1 { margin: 6px 0; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .pgWrap .lead { color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 680px; }
      .pgTot { display: grid; grid-template-columns: repeat(2,1fr); gap: 12px; margin: 20px 0 6px; }
      .pgCard { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; }
      .pgCard .k { font-size: 11px; text-transform: uppercase; letter-spacing: .5px; font-weight: 800; }
      .pgCard.jp .k { color: #55d8ea; } .pgCard.en .k { color: #4ad9a4; }
      .pgCard .v { display: block; font-family: "JetBrains Mono", monospace; font-size: 27px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 4px 0 1px; }
      .pgCard .d { font-family: "JetBrains Mono", monospace; font-size: 12.5px; font-weight: 800; font-variant-numeric: tabular-nums; }
      .pgCard.jp .d { color: #55d8ea; } .pgCard.en .d { color: #4ad9a4; }
      .pgCard .d em { font-style: normal; color: var(--muted); font-weight: 400; margin-left: 6px; }
      .pgTableWrap { overflow-x: auto; margin: 16px 0 8px; }
      .pgTable { width: 100%; border-collapse: collapse; font-size: 13.5px; }
      .pgTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .pgTable thead th:first-child { text-align: left; }
      .pgTable thead th.hjp { color: #55d8ea; } .pgTable thead th.hen { color: #4ad9a4; }
      .pgTable tbody th { text-align: left; font-weight: 400; padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.05); white-space: nowrap; }
      .pgTable tbody th a { display: block; }
      .pgTable tbody th b { display: block; font-family: "JetBrains Mono", monospace; font-size: 12.5px; }
      .pgTable tbody th span { display: block; color: var(--muted); font-size: 11.5px; }
      .pgTable td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.05); text-align: right; font-family: "JetBrains Mono", monospace; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .pgGem { color: var(--muted); }
      .pgAdd { color: #cfd6e6; }
      .pgPct { font-weight: 800; }
      .pgPct.jp { color: #55d8ea; } .pgPct.en { color: #4ad9a4; }
      .pgNa { color: #6f7889; font-weight: 400; font-family: system-ui, sans-serif; font-size: 11.5px; }
      .pgSplit { border-left: 1px solid var(--line); }
      .pgTable tfoot th, .pgTable tfoot td { border-top: 1px solid var(--line); border-bottom: 0; font-weight: 800; padding-top: 11px; }
      .pgNotes { margin: 14px 0 0; color: var(--muted); font-size: 12.5px; line-height: 1.65; }
      .pgNotes b { color: var(--ink); }
      @media (max-width: 640px) { .pgTot { grid-template-columns: 1fr; } .pgTable { font-size: 12.5px; } .pgTable td, .pgTable th { padding: 8px 7px; } }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" aria-current="page" data-ko="PSA 인구">PSA Population</a><a href="market.html" data-ko="마켓 지수">Market Index</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="pgWrap">
      <p class="eyebrow">PSA Population</p>
      <h1>One Piece PSA population by set</h1>
      <p class="lead">How many cards from each booster set have been submitted to PSA, kept separate for the Japanese and English printings. Grading volume is the clearest proxy we have for sealed boxes being opened &mdash; every graded card came out of a pack. Cumulative totals are as of ${updated}; the weekly change compares ${wNow} against ${wPrev}.</p>
      <div class="pgTot">
        <div class="pgCard jp"><span class="k">Japanese &mdash; total graded</span><span class="v">${n(tj)}</span><span class="d">+${n(aj)} <em>this week ${pc((aj / (tj - aj)) * 100)}</em></span></div>
        <div class="pgCard en"><span class="k">English &mdash; total graded</span><span class="v">${n(te)}</span><span class="d">+${n(ae)} <em>this week ${pc((ae / (te - ae)) * 100)}</em></span></div>
      </div>
      <div class="pgTableWrap">
      <table class="pgTable">
        <caption class="sr-only">PSA graded population and weekly change for every tracked One Piece booster set</caption>
        <thead><tr>
          <th scope="col">Booster set</th>
          <th scope="col" class="hjp">JP graded</th><th scope="col" class="hjp">JP gem</th><th scope="col" class="hjp">JP week</th><th scope="col" class="hjp">%</th>
          <th scope="col" class="hen">EN graded</th><th scope="col" class="hen">EN gem</th><th scope="col" class="hen">EN week</th><th scope="col" class="hen">%</th>
        </tr></thead>
        <tbody>
${rows.map(tr).join("\n")}
        </tbody>
        <tfoot><tr>
          <th scope="row"><b>All sets</b><span>${rows.length} tracked</span></th>
          <td class="pgNum">${n(tj)}</td><td class="pgGem"></td><td class="pgAdd">+${n(aj)}</td><td class="pgPct jp">${pc((aj / (tj - aj)) * 100)}</td>
          <td class="pgNum pgSplit">${n(te)}</td><td class="pgGem"></td><td class="pgAdd">+${n(ae)}</td><td class="pgPct en">${pc((ae / (te - ae)) * 100)}</td>
        </tr></tfoot>
      </table>
      </div>
      <h2>How to read this</h2>
      <p class="pgNotes"><b>Total graded</b> is every card from that set sitting in a PSA holder, at any grade &mdash; not one specific card. <b>Gem</b> is the share that came back PSA 10. <b>Week</b> is how many new grades appeared between ${wPrev} and ${wNow}, and <b>%</b> is that change against the earlier total.</p>
      <p class="pgNotes"><b>We never add the two editions together.</b> Japanese and English are separate print runs with different card stock and different print quality, so a combined gem rate would describe neither. ${rows.length - enCount} set${rows.length - enCount === 1 ? " has" : "s have"} no English row at all &mdash; those printings have not been released, which is different from zero cards graded.</p>
      <p class="pgNotes">A high weekly number is not automatically bullish. It means packs are being opened, which thins the sealed supply, but it also means more graded copies competing on the market. Read it next to the box price on each <a href="sets/index.html">set guide</a>, and against completed sales on the <a href="psa10-ranking.html">PSA 10 value ranking</a>.</p>
      <p class="pgNotes">Population figures are compiled from public PSA population reporting. We publish weekly change only from the point we began recording it ourselves; we do not republish historical series compiled by others.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(OUT, html, "utf8");
console.log(JSON.stringify({ page: "psa-grading.html", sets: rows.length, enSets: enCount, weeks: [wPrev, wNow], jpTotal: tj, enTotal: te, bytes: html.length }));
