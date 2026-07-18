// market.html 생성 — OPBX 지수 + 개봉 미터 + 전세트 성적표(1월 이후). 숫자 구워넣기(SEO/AI).
// data.marketIndex 필요 → tools/build-market-index.js를 먼저 실행. Run: node tools/generate-market-page.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = "20260718a";
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const mi = d.marketIndex;
if (!mi) { console.error("marketIndex 없음 — build-market-index.js 먼저 실행"); process.exit(1); }
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const idx = mi.index, m = mi.meter, board = mi.board;
const up = idx.weekChangePct >= 0;

// 지수 라인차트
function lineChart(series, w, h, pad) {
  const vals = series.map((p) => p.v), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const gridV = [min, (min + max) / 2, max].map((v) => `<line x1="${pad}" y1="${y(v).toFixed(1)}" x2="${w - pad}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,.06)"/><text x="${pad - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="#7d8698" font-size="10">${Math.round(v)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="ixChart" role="img" aria-label="OPBX index history"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(255,255,255,.12)"/>${gridV}<polyline points="${pts}" fill="none" stroke="#50dad9" stroke-width="2"/></svg>`;
}
const first = idx.series[0], last = idx.series[idx.series.length - 1];

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monLbl = (iso) => { const dt = new Date(iso + "T00:00:00Z"); return `${MON[dt.getUTCMonth()]} ${dt.getUTCDate()}`; };
const BASE_DATE = mi.base.date; // 2026-01-07
const rows = board.map((b, i) => {
  const cls = b.changePct >= 0 ? "up" : "down";
  // base가 기준일과 다르면(후발 세트) 실제 시작일을 정직하게 표기 — "Jan 대비"로 오해 방지
  const lateNote = b.baseDate !== BASE_DATE ? `<span class="fromDate" title="tracked from ${b.baseDate}">from ${monLbl(b.baseDate)}</span>` : "";
  const basisLabel = b.launchTracked ? `<span class="basisTag" title="tracked from actual release">launch</span>` : "";
  return `<tr><td class="num">${i + 1}</td><td><a href="sets/${b.code.toLowerCase()}.html">${b.code}</a> <span class="bName">${esc(b.nameEn)}</span></td><td class="num">$${b.baseUsd.toLocaleString()}${lateNote}</td><td class="num">$${b.nowUsd.toLocaleString()}</td><td class="num ${cls}">${b.changePct >= 0 ? "+" : ""}${b.changePct}% ${basisLabel}</td></tr>`;
}).join("");

const bmax = Math.max(...m.weeks.map((w) => w.v));
const meterBars = m.weeks.map((w) => `<div class="owBar"><span style="height:${Math.round((w.v / bmax) * 100)}%"></span><small>${w.d.slice(5)}</small></div>`).join("");

const keyFacts = [
  `The OPBX Index — an equal-weight index of ${mi.constituents.length} Japanese One Piece booster boxes (Jan 7, 2026 = 100) — stands at <strong>${idx.value.toFixed(1)}</strong> as of ${esc(idx.asOf)}, ${idx.sinceBasePct >= 0 ? "up" : "down"} <strong>${Math.abs(idx.sinceBasePct)}%</strong> since January.`,
  `Over the past week the index moved ${up ? "+" : ""}${idx.weekChangePct}%.`,
  m.latestWeek ? `In the week of ${esc(m.latestWeek.d)}, collectors sent <strong>${m.latestWeek.v.toLocaleString()}</strong> One Piece cards to PSA (${m.wowPct >= 0 ? "+" : ""}${m.wowPct}% vs the prior week); ${m.allTimeGraded.toLocaleString()} have been graded all-time.` : "",
  `The strongest set since January is ${board[0].code} (${board[0].changePct >= 0 ? "+" : ""}${board[0].changePct}%); the weakest is ${board[board.length - 1].code} (${board[board.length - 1].changePct}%).`,
].filter(Boolean);

const faq = [
  { q: "What is the OPBX Index?", a: `It is a free equal-weight index of ${mi.constituents.length} Japanese One Piece Card Game booster boxes, based to 100 on January 7, 2026. Each day it averages every constituent box's price relative to its January 7 value. As of ${idx.asOf} it is ${idx.value.toFixed(1)} — ${idx.sinceBasePct >= 0 ? "up" : "down"} ${Math.abs(idx.sinceBasePct)}% since January. Sets first tracked after that date (${mi.constituents.length < 21 ? d.jp.list.concat(d.extra.list).filter((c) => d.sets[c] && !mi.constituents.includes(c) && (d.sets[c].boxSeries || {}).points) .join(", ") : "none"}) are shown individually but excluded from the index.` },
  { q: "What is the Opening Meter?", a: m.latestWeek ? `It counts how many One Piece cards were newly graded by PSA each week — a proxy for how fast sealed product is being opened. In the week of ${m.latestWeek.d}, ${m.latestWeek.v.toLocaleString()} cards were graded. Rising grading volume while box prices hold is the supply-burn pattern sealed collectors watch for.` : "A weekly count of newly PSA-graded One Piece cards." },
  { q: "Why is the change measured 'since January', not since launch?", a: `Our daily price tracking began in January 2026. Only a few sets (currently OP-16) were tracked from their actual release, so for every other set we honestly label changes 'since January' rather than claiming a launch-to-now figure we did not measure.` },
];
const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
const artLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset", name: "OPBX One Piece booster box market index", description: `Daily equal-weight price index of ${mi.constituents.length} Japanese One Piece booster boxes, plus weekly PSA grading volume.`, creator: { "@type": "Organization", name: "OP Box Index", url: SITE + "/" }, dateModified: mi.updated, isAccessibleForFree: true, url: SITE + "/market.html" });

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/market.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>OPBX Index — Live One Piece Booster Box Market Index &amp; Opening Meter | OP Box Index</title>
    <meta name="description" content="The OPBX Index tracks the whole Japanese One Piece booster box market in one number (Jan 2026 = 100), now ${idx.value.toFixed(1)} (${idx.sinceBasePct >= 0 ? "+" : ""}${idx.sinceBasePct}% since January). Plus the Opening Meter (weekly PSA grading volume) and every set's performance — free, updated daily." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="OPBX Index — One Piece Booster Box Market Index" />
    <meta property="og:description" content="The whole JP booster box market in one number, now ${idx.value.toFixed(1)}. Free, updated daily." />
    <meta property="og:url" content="${SITE}/market.html" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${faqLd}</script>
    <script type="application/ld+json">${artLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .ixHero { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 6px 0 2px; }
      .ixHero .big { font-size: 46px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
      .ixChg { font-size: 14px; font-weight: 800; padding: 3px 11px; border-radius: 8px; }
      .up { color: #10d7a0; } .down { color: #ff7d7d; }
      .ixChg.up { background: rgba(16,215,160,.12); } .ixChg.down { background: rgba(255,125,125,.12); }
      .ixChart { width: 100%; max-width: 720px; height: 220px; margin: 10px 0; }
      .mBoard { width: 100%; max-width: 720px; border-collapse: collapse; font-size: 14px; margin: 8px 0; }
      .mBoard th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; text-transform: uppercase; }
      .mBoard th:nth-child(2), .mBoard td:nth-child(2) { text-align: left; }
      .mBoard td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .mBoard td.num { text-align: right; white-space: nowrap; }
      .mBoard .bName { color: #7d8698; font-size: 12px; }
      .basisTag { font-size: 9px; background: rgba(80,218,217,.15); color: #50dad9; padding: 1px 5px; border-radius: 5px; text-transform: uppercase; }
      .fromDate { display: block; font-size: 10px; color: #7d8698; }
      .owMeter { display: flex; gap: 8px; align-items: flex-end; height: 120px; max-width: 520px; margin: 12px 0; }
      .owBar { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
      .owBar span { width: 100%; background: #ff7d3c; opacity: .6; border-radius: 4px 4px 0 0; min-height: 6px; }
      .owBar:last-child span { opacity: 1; }
      .owBar small { font-size: 10px; color: #7d8698; }
      .keyFacts { margin: 14px 0; padding: 12px 16px 12px 30px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 720px; font-size: 13.5px; line-height: 1.65; }
      .keyFacts strong { color: #50dad9; }
      .mNote { color: #7d8698; font-size: 12.5px; max-width: 720px; margin: 6px 0 14px; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./">Booster Boxes</a><a href="compare.html">Compare</a><a href="psa10-ranking.html">Top PSA 10</a><a href="sets/index.html">Set Guides</a><a href="market.html" aria-current="page">Market Index</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow">Market Index</p>
      <h1>OPBX Index — the whole One Piece box market in one number</h1>
      <section aria-label="Key facts"><ul class="keyFacts">${keyFacts.map((f) => `<li>${f}</li>`).join("")}</ul></section>

      <div class="ixHero"><span class="big">${idx.value.toFixed(1)}</span><span class="ixChg ${up ? "up" : "down"}">${up ? "▲ +" : "▼ "}${idx.weekChangePct}% this week</span><span style="color:#9aa4b6;font-size:14px;">${idx.sinceBasePct >= 0 ? "+" : ""}${idx.sinceBasePct}% since Jan 7, 2026</span></div>
      ${lineChart(idx.series, 720, 220, 26)}
      <p class="mNote">${esc(mi.method)} Jan 7, 2026 = 100. As of ${esc(idx.asOf)}. Not investment advice.</p>

      <h2 id="opening">Opening Meter — how fast product is being ripped</h2>
      <p>Every graded card came out of a sealed pack, so weekly PSA grading volume is a live read on how fast One Piece product is being opened. ${m.latestWeek ? `In the week of <strong>${esc(m.latestWeek.d)}</strong>, <strong>${m.latestWeek.v.toLocaleString()}</strong> cards were graded${m.wowPct != null ? ` — ${m.wowPct >= 0 ? "up" : "down"} ${Math.abs(m.wowPct)}% from the week before` : ""}. All-time, <strong>${m.allTimeGraded.toLocaleString()}</strong> One Piece cards have been PSA-graded across the sets we track.` : ""}</p>
      <div class="owMeter">${meterBars}</div>
      <p class="mNote">Weekly new PSA grades, summed across all tracked sets. Grading has a turnaround lag, so recent weeks may revise up.</p>

      <h2>Every set since January 2026</h2>
      <p>Ranked by price change since our tracking began (Jan 7, 2026 — not since each set's launch, which we did not track for older sets). Tap a set for its full page.</p>
      <div style="overflow-x:auto;"><table class="mBoard"><thead><tr><th class="num">#</th><th>Set</th><th class="num">Start price</th><th class="num">Now</th><th class="num">Change</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="mNote">Start price is each set's value on Jan 7, 2026 unless a "from [month]" note shows a later date (sets we began tracking after January). A "launch" tag means we tracked that set from its actual release, so its change is a true since-launch figure.</p>

      <h2>FAQ</h2>
      ${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join("")}
    </main>
    <footer class="articleFooter">
      <p class="affNote">OP Box Index is a free, data-driven research site — not investment advice. Prices are references, not offers. Updated daily.</p>
    </footer>
  </body>
</html>`;
fs.writeFileSync(path.join(ROOT, "market.html"), html);
console.log(JSON.stringify({ wrote: "market.html", index: idx.value, rows: board.length, keyFacts: keyFacts.length }));
