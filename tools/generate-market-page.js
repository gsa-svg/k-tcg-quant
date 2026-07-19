// market.html 생성 — OPBOX 지수 + 개봉 미터 + 전세트 성적표(1월 이후). 숫자 구워넣기(SEO/AI).
// data.marketIndex 필요 → tools/build-market-index.js를 먼저 실행. Run: node tools/generate-market-page.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = "20260719b";
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const mi = d.marketIndex;
if (!mi) { console.error("marketIndex 없음 — build-market-index.js 먼저 실행"); process.exit(1); }
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// data-ko 속성용 이스케이프(HTML 포함 가능). 토글 스크립트가 hl=ko일 때 innerHTML로 교체.
const attrEsc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
const da = (ko) => `data-ko="${attrEsc(ko)}"`;
const idx = mi.index, m = mi.meter, board = mi.board;
const up = idx.weekChangePct >= 0;

// 지수 라인차트
function lineChart(series, w, h, pad) {
  const vals = series.map((p) => p.v), min = Math.min(...vals), max = Math.max(...vals), span = max - min || 1;
  const x = (i) => pad + (i / (series.length - 1)) * (w - pad * 2);
  const y = (v) => h - pad - ((v - min) / span) * (h - pad * 2);
  const pts = series.map((p, i) => `${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const gridV = [min, (min + max) / 2, max].map((v) => `<line x1="${pad}" y1="${y(v).toFixed(1)}" x2="${w - pad}" y2="${y(v).toFixed(1)}" stroke="rgba(255,255,255,.06)"/><text x="${pad - 4}" y="${(y(v) + 3).toFixed(1)}" text-anchor="end" fill="#7d8698" font-size="10">${Math.round(v)}</text>`).join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="ixChart" role="img" aria-label="OPBOX index history"><line x1="${pad}" y1="${h - pad}" x2="${w - pad}" y2="${h - pad}" stroke="rgba(255,255,255,.12)"/>${gridV}<polyline points="${pts}" fill="none" stroke="#50dad9" stroke-width="2"/></svg>`;
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
  const msrpCell = b.vsMsrp ? `${b.vsMsrp}x <span class="fromDate">$${b.msrpUsd} MSRP</span>` : "—";
  const rpCell = b.reprints ? `<span class="rpDot" title="dated reprint evidence on record">${b.reprints}</span>` : "<span class='rpNone'>—</span>";
  return `<tr><td class="num">${i + 1}</td><td><a href="sets/${b.code.toLowerCase()}.html">${b.code}</a> <span class="bName">${esc(b.nameEn)}</span></td><td class="num">$${b.baseUsd.toLocaleString()}${lateNote}</td><td class="num">$${b.nowUsd.toLocaleString()}</td><td class="num ${cls}">${b.changePct >= 0 ? "+" : ""}${b.changePct}% ${basisLabel}</td><td class="num">${msrpCell}</td><td class="num">${rpCell}</td></tr>`;
}).join("");

const bmax = Math.max(...m.weeks.map((w) => w.v));
const meterBars = m.weeks.map((w) => `<div class="owBar"><span style="height:${Math.round((w.v / bmax) * 100)}%"></span><small>${w.d.slice(5)}</small></div>`).join("");

const topMsrp = [...board].filter((b) => b.vsMsrp).sort((a, b) => b.vsMsrp - a.vsMsrp)[0];
const sgn = (n) => (n >= 0 ? "+" : "");
const keyFacts = [
  { en: `The OPBOX Index — an equal-weight index of ${mi.constituents.length} Japanese One Piece booster boxes (Jan 7, 2026 = 100) — stands at <strong>${idx.value.toFixed(1)}</strong> as of ${esc(idx.asOf)}, ${idx.sinceBasePct >= 0 ? "up" : "down"} <strong>${Math.abs(idx.sinceBasePct)}%</strong> since January.`,
    ko: `OPBOX 지수 — 일본판 원피스 부스터박스 ${mi.constituents.length}개의 등가중 지수(2026-01-07 = 100) — 는 ${esc(idx.asOf)} 기준 <strong>${idx.value.toFixed(1)}</strong>로, 1월 대비 <strong>${Math.abs(idx.sinceBasePct)}%</strong> ${idx.sinceBasePct >= 0 ? "상승" : "하락"}.` },
  { en: `Over the past week the index moved ${sgn(idx.weekChangePct)}${idx.weekChangePct}%.`,
    ko: `지난 한 주간 지수는 ${sgn(idx.weekChangePct)}${idx.weekChangePct}% 움직였습니다.` },
  m.latestWeek ? { en: `In the week of ${esc(m.latestWeek.d)}, collectors sent <strong>${m.latestWeek.v.toLocaleString()}</strong> One Piece cards to PSA (${sgn(m.wowPct)}${m.wowPct}% vs the prior week); ${m.allTimeGraded.toLocaleString()} have been graded all-time.`,
    ko: `${esc(m.latestWeek.d)} 주간 수집가들이 원피스 카드 <strong>${m.latestWeek.v.toLocaleString()}</strong>장을 PSA에 등급 신청(전주 대비 ${sgn(m.wowPct)}${m.wowPct}%). 누적 ${m.allTimeGraded.toLocaleString()}장 등급 완료.` } : null,
  { en: `The strongest set since January is ${board[0].code} (${sgn(board[0].changePct)}${board[0].changePct}%); the weakest is ${board[board.length - 1].code} (${board[board.length - 1].changePct}%).`,
    ko: `1월 이후 최강 세트는 ${board[0].code}(${sgn(board[0].changePct)}${board[0].changePct}%), 최약 세트는 ${board[board.length - 1].code}(${board[board.length - 1].changePct}%).` },
  topMsrp ? { en: `Measured against original Japanese retail MSRP, ${topMsrp.code} now trades at <strong>${topMsrp.vsMsrp}x</strong> its launch price ($${topMsrp.msrpUsd} MSRP → $${topMsrp.nowUsd}).`,
    ko: `발매 당시 일본 정가(MSRP) 대비, ${topMsrp.code}는 현재 발매가의 <strong>${topMsrp.vsMsrp}배</strong>($${topMsrp.msrpUsd} 정가 → $${topMsrp.nowUsd}).` } : null,
].filter(Boolean);

const excludedList = d.jp.list.concat(d.extra.list).filter((c) => d.sets[c] && !mi.constituents.includes(c) && (d.sets[c].boxSeries || {}).points).join(", ") || "none";
const faq = [
  { q: "What is the OPBOX Index?", qKo: "OPBOX 지수가 뭔가요?",
    a: `It is a free equal-weight index of ${mi.constituents.length} Japanese One Piece Card Game booster boxes, based to 100 on January 7, 2026. Each day it averages every constituent box's price relative to its January 7 value. As of ${idx.asOf} it is ${idx.value.toFixed(1)} — ${idx.sinceBasePct >= 0 ? "up" : "down"} ${Math.abs(idx.sinceBasePct)}% since January. Sets first tracked after that date (${excludedList}) are shown individually but excluded from the index.`,
    aKo: `일본판 원피스 카드게임 부스터박스 ${mi.constituents.length}개를 등가중으로 묶은 무료 지수로, 2026년 1월 7일을 100으로 잡습니다. 매일 각 구성종목의 1월 7일 대비 가격을 평균냅니다. ${idx.asOf} 기준 ${idx.value.toFixed(1)}로, 1월 대비 ${Math.abs(idx.sinceBasePct)}% ${idx.sinceBasePct >= 0 ? "상승" : "하락"}했습니다. 그 날짜 이후에 추적을 시작한 세트(${excludedList})는 개별 표시하되 지수 계산에서는 제외합니다.` },
  { q: "What is the Opening Meter?", qKo: "개봉 미터가 뭔가요?",
    a: m.latestWeek ? `It counts how many One Piece cards were newly graded by PSA each week — a proxy for how fast sealed product is being opened. In the week of ${m.latestWeek.d}, ${m.latestWeek.v.toLocaleString()} cards were graded. Rising grading volume while box prices hold is the supply-burn pattern sealed collectors watch for.` : "A weekly count of newly PSA-graded One Piece cards.",
    aKo: m.latestWeek ? `매주 PSA에 새로 등급받은 원피스 카드 수를 집계한 것으로, 봉인 박스가 얼마나 빨리 개봉되는지를 보여주는 지표입니다. ${m.latestWeek.d} 주간에는 ${m.latestWeek.v.toLocaleString()}장이 등급받았습니다. 박스 가격이 유지되는 가운데 등급 물량이 늘어나는 것은 미개봉 수집가들이 주목하는 '공급 소진' 패턴입니다.` : "매주 PSA에 새로 등급받은 원피스 카드 수." },
  { q: "Why is the change measured 'since January', not since launch?", qKo: "왜 '발매 대비'가 아니라 '1월 이후'로 재나요?",
    a: `Our daily price tracking began in January 2026. Only a few sets (currently OP-16) were tracked from their actual release, so for every other set we honestly label changes 'since January' rather than claiming a launch-to-now figure we did not measure. For a true since-launch comparison we use the 'vs MSRP' column, which divides the current price by each set's official Japanese launch MSRP.`,
    aKo: `우리의 일별 가격 추적은 2026년 1월에 시작했습니다. 실제 발매 시점부터 추적한 세트는 몇 개(현재 OP-16)뿐이라, 나머지 세트는 측정하지 않은 '발매~현재' 수치를 주장하는 대신 정직하게 '1월 이후'로 표기합니다. 진짜 발매 대비 비교는 'vs MSRP'(정가 대비) 컬럼을 쓰는데, 이는 현재 가격을 각 세트의 공식 일본 발매 정가로 나눈 값입니다.` },
  { q: "How many times has each set been reprinted?", qKo: "세트마다 몇 번 재판됐나요?",
    a: `Bandai does not publish per-set reprint announcements for the One Piece Card Game, so a definitive count does not exist. What we can show is dated reprint evidence from retailers and distributors (e.g. MediaWorld and other Japanese shops listing 再販 batches with ship dates). The 'Reprints' column counts those dated records; a dash means none were found in our sources, not that a set was never reprinted. Each set page links the sources.`,
    aKo: `반다이는 원피스 카드게임의 세트별 재판(再販)을 공식 발표하지 않기 때문에, 확정된 횟수는 존재하지 않습니다. 우리가 보여줄 수 있는 것은 리테일러·유통사의 날짜 있는 재판 기록(예: MediaWorld 등 일본 상점의 再販 출하 날짜)입니다. 'Reprints' 컬럼은 그 날짜 기록의 개수이며, 대시(—)는 우리 소스에서 찾지 못했다는 뜻이지 '재판된 적 없음'이 아닙니다. 각 세트 페이지에 소스를 링크합니다.` },
];
const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
const artLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset", name: "OPBOX One Piece booster box market index", description: `Daily equal-weight price index of ${mi.constituents.length} Japanese One Piece booster boxes, plus weekly PSA grading volume.`, creator: { "@type": "Organization", name: "OP Box Index", url: SITE + "/" }, dateModified: mi.updated, isAccessibleForFree: true, url: SITE + "/market.html" });

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
    <link rel="alternate" hreflang="en" href="${SITE}/market.html" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>One Piece Booster Box Market Index &amp; Opening Meter | OPBOX Index</title>
    <meta name="description" content="The OPBOX Index tracks the Japanese One Piece booster box market in one number (Jan 2026 = 100), now ${idx.value.toFixed(1)} (${idx.sinceBasePct >= 0 ? "+" : ""}${idx.sinceBasePct}% since January). Free, updated daily." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="OPBOX Index — One Piece Booster Box Market Index" />
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
      .rpDot { display: inline-block; min-width: 18px; background: rgba(255,125,60,.15); color: #ff9d6c; border-radius: 6px; padding: 1px 6px; font-weight: 800; }
      .rpNone { color: #4a4f59; }
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
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small ${da("부스터박스 리서치")}>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" ${da("부스터 박스")}>Booster Boxes</a><a href="compare.html" ${da("비교")}>Compare</a><a href="psa10-ranking.html" ${da("PSA10 랭킹")}>Top PSA 10</a><a href="market.html" aria-current="page" ${da("마켓 지수")}>Market Index</a><a href="sets/index.html" ${da("세트 가이드")}>Set Guides</a><a href="amazon-lottery.html" ${da("아마존 응모")}>Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow" ${da("마켓 지수")}>Market Index</p>
      <h1 ${da("OPBOX 지수 — 원피스 박스 시장 전체를 숫자 하나로")}>OPBOX Index — the whole One Piece box market in one number</h1>
      <p style="margin:2px 0 10px"><a href="ko/" style="color:#50dad9;font-weight:700;text-decoration:none" ${da("🇰🇷 한국어 시세 페이지 — 전 세트 원화 시세·재판·개봉 지수 →")}>🇰🇷 한국어 시세 페이지 (원화) →</a></p>
      <section aria-label="Key facts"><ul class="keyFacts">${keyFacts.map((f) => `<li ${da(f.ko)}>${f.en}</li>`).join("")}</ul></section>

      <div class="ixHero"><span class="big">${idx.value.toFixed(1)}</span><span class="ixChg ${up ? "up" : "down"}" ${da(`${up ? "▲ +" : "▼ "}${idx.weekChangePct}% 이번 주`)}>${up ? "▲ +" : "▼ "}${idx.weekChangePct}% this week</span><span style="color:#9aa4b6;font-size:14px;" ${da(`2026-01-07 대비 ${idx.sinceBasePct >= 0 ? "+" : ""}${idx.sinceBasePct}%`)}>${idx.sinceBasePct >= 0 ? "+" : ""}${idx.sinceBasePct}% since Jan 7, 2026</span></div>
      ${lineChart(idx.series, 720, 220, 26)}
      <p class="mNote" ${da(`일본판 부스터박스 ${mi.constituents.length}개 등가중 지수. 2026-01-07 = 100. ${idx.asOf} 기준. 그 이후 추적 시작 세트는 개별 표시하되 지수 제외. 결측일은 직전값 유지. 투자 조언 아님.`)}>${esc(mi.method)} Jan 7, 2026 = 100. As of ${esc(idx.asOf)}. Not investment advice.</p>

      <h2 id="opening" ${da("개봉 미터 — 박스가 뜯기는 속도")}>Opening Meter — how fast product is being ripped</h2>
      <p ${da(m.latestWeek ? `등급받은 카드는 모두 봉인 팩에서 나왔으므로, 주간 PSA 등급 물량은 원피스 박스가 얼마나 빨리 개봉되는지를 실시간으로 보여줍니다. <strong>${esc(m.latestWeek.d)}</strong> 주간에 <strong>${m.latestWeek.v.toLocaleString()}</strong>장이 등급받았습니다${m.wowPct != null ? ` — 전주 대비 ${Math.abs(m.wowPct)}% ${m.wowPct >= 0 ? "증가" : "감소"}` : ""}. 누적으로 우리가 추적하는 세트에서 <strong>${m.allTimeGraded.toLocaleString()}</strong>장이 PSA 등급을 받았습니다.` : "")}>Every graded card came out of a sealed pack, so weekly PSA grading volume is a live read on how fast One Piece product is being opened. ${m.latestWeek ? `In the week of <strong>${esc(m.latestWeek.d)}</strong>, <strong>${m.latestWeek.v.toLocaleString()}</strong> cards were graded${m.wowPct != null ? ` — ${m.wowPct >= 0 ? "up" : "down"} ${Math.abs(m.wowPct)}% from the week before` : ""}. All-time, <strong>${m.allTimeGraded.toLocaleString()}</strong> One Piece cards have been PSA-graded across the sets we track.` : ""}</p>
      <div class="owMeter">${meterBars}</div>
      <p class="mNote" ${da("전 세트 합산 주간 신규 PSA 등급 수. 등급에는 처리 시차가 있어 최근 주는 이후 상향 조정될 수 있습니다.")}>Weekly new PSA grades, summed across all tracked sets. Grading has a turnaround lag, so recent weeks may revise up.</p>

      <h2 ${da("2026년 1월 이후 전 세트")}>Every set since January 2026</h2>
      <p ${da("추적 시작(2026-01-07) 이후 가격 변동순 정렬 — 구세트는 발매 시점을 추적하지 못했으므로 발매 대비가 아닙니다. 세트를 누르면 전체 페이지로.")}>Ranked by price change since our tracking began (Jan 7, 2026 — not since each set's launch, which we did not track for older sets). Tap a set for its full page.</p>
      <div style="overflow-x:auto;"><table class="mBoard"><thead><tr><th class="num">#</th><th ${da("세트")}>Set</th><th class="num" ${da("시작가")}>Start price</th><th class="num" ${da("현재")}>Now</th><th class="num" ${da("변동")}>Change</th><th class="num" title="current market price ÷ Japanese launch MSRP" ${da("정가 대비")}>vs MSRP</th><th class="num" title="dated reprint records found" ${da("재판")}>Reprints</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="mNote" ${da(`시작가는 각 세트의 2026-01-07 값이며, "from [월]" 표시가 있으면 더 늦은 날짜입니다. "launch" 태그는 실제 발매부터 추적했다는 뜻. <strong>정가 대비(vs MSRP)</strong>는 현재 시장가를 공식 일본 발매 정가(OP-01–03 박스 ¥4,752, OP-04–EB ¥5,280, PRB ¥5,500)로 나눈 값 — 정직한 발매 대비 배수지만 현재 값은 국제/eBay 시장가, 정가는 일본 소매가입니다. <strong>재판(Reprints)</strong>은 우리가 찾은 날짜 있는 재판 기록 수입니다. 반다이는 세트별 재판을 공식 발표하지 않아 리테일러/유통사 기록에서 온 것입니다(각 세트 페이지 참고). 대시는 기록 없음이지 "재판된 적 없음"이 아닙니다.`)}>Start price is each set's value on Jan 7, 2026 unless a "from [month]" note shows a later date. "launch" tag = tracked from actual release. <strong>vs MSRP</strong> = current market price divided by the official Japanese launch MSRP (¥4,752 box for OP-01–03, ¥5,280 for OP-04–EB, ¥5,500 for PRB) — an honest since-launch multiple, though the current figure is the international/eBay market price while MSRP is Japanese retail. <strong>Reprints</strong> = count of dated reprint records we found; Bandai does not publish per-set reprint announcements, so these come from retailer/distributor listings (see each set page). A dash means none on record, not "never reprinted."</p>

      <h2 ${da("자주 묻는 질문")}>FAQ</h2>
      ${faq.map((f) => `<h3 ${da(f.qKo)}>${esc(f.q)}</h3><p ${da(f.aKo)}>${esc(f.a)}</p>`).join("")}
    </main>
    <footer class="articleFooter">
      <p class="affNote" ${da("OP Box Index는 무료 데이터 리서치 사이트로, 투자 조언이 아닙니다. 가격은 참고용이며 제안이 아닙니다. 매일 갱신.")}>OP Box Index is a free, data-driven research site — not investment advice. Prices are references, not offers. Updated daily.</p>
    </footer>
    <script>
      (function () {
        var p = new URLSearchParams(location.search);
        var browserKo = (navigator.language || "").toLowerCase().indexOf("ko") === 0 || (navigator.languages || []).some(function (l) { return (l || "").toLowerCase().indexOf("ko") === 0; });
        function apply(hl) {
          document.documentElement.lang = hl;
          document.querySelectorAll("[data-ko]").forEach(function (el) {
            if (el.dataset.en == null) el.dataset.en = el.innerHTML;
            el.innerHTML = hl === "ko" ? el.dataset.ko : el.dataset.en;
          });
        }
        var stored; try { stored = localStorage.getItem("ktcg_hl"); } catch (e) {}
        var cur = (p.get("hl") === "ko" || stored === "ko") && browserKo ? "ko" : "en";
        var nav = document.querySelector(".topbar .nav");
        if (nav) {
          var b = document.createElement("button");
          b.type = "button";
          b.style.cssText = "border:1px solid rgba(255,255,255,.16);background:#14171c;color:#eef2ff;border-radius:8px;padding:8px 10px;font-weight:800;cursor:pointer;margin-left:6px";
          b.textContent = cur === "ko" ? "EN" : "한국어";
          b.onclick = function () { cur = cur === "ko" ? "en" : "ko"; try { localStorage.setItem("ktcg_hl", cur); } catch (e) {} apply(cur); b.textContent = cur === "ko" ? "EN" : "한국어"; };
          nav.appendChild(b);
        }
        apply(cur);
      })();
    </script>
  </body>
</html>`;
fs.writeFileSync(path.join(ROOT, "market.html"), html);
console.log(JSON.stringify({ wrote: "market.html", index: idx.value, rows: board.length, keyFacts: keyFacts.length }));
