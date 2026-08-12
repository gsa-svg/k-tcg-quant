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

// ── 등급사 3사 비교 — 2026-08-12 신설.
// 우리는 PSA·CGC·TAG 카드별 인구를 각각 쌓고 있는데, 정작 "같은 카드를 세 곳이 어떻게 매기나"를
// 아무 데서도 안 보여주고 있었다. 세 곳 다 일정 수 이상 등급이 있는 카드만 골라 나란히 둔다.
//
// ⚠️ 최상위 등급의 정의가 회사마다 다르다. 하나로 뭉뚱그리면 안 된다.
//    PSA = 10 하나 · CGC = Pristine 10 + Gem Mint 10 · TAG = 10 + 10P
// ⚠️ 이건 "누가 후하게 준다"의 증명이 아니다. 물리적으로 다른 카드고, 어디에 보낼지도
//    제출자가 고른다. 우리가 말할 수 있는 건 "기록된 결과가 이렇게 다르다"까지다.
const GRADER_MIN = 20;   // 세 곳 모두 이 장수 이상일 때만 비교에 올린다
const graderCmp = (() => {
  const load = (file, gem) => {
    const p = path.join(ROOT, "data", file);
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const out = {};
    const walk = (code, cards) => {
      for (const [key, pts] of Object.entries(cards)) {
        if (!Array.isArray(pts) || !pts.length) continue;
        const last = pts[pts.length - 1];
        const g = gem(last);
        if (last.total == null || g == null) continue;
        out[`${code}|${key}`] = { total: last.total, gem: g, d: last.d, label: last.label || last.par || "" };
      }
    };
    for (const [code, v] of Object.entries(j.sets || {})) {
      if (v.jp || v.en) { if (v.jp) walk(code, v.jp); if (v.en) walk(code, v.en); }
      else walk(code, v);   // TAG 는 판별 구분이 없다
    }
    return out;
  };
  const P = load("psa-card-pop.json", (p) => p.g10 ?? null);
  const C = load("cgc-card-pop.json", (p) => (p.g ? (p.g["Pristine 10"] || 0) + (p.g["Gem Mint 10"] || 0) : null));
  const T = load("tag-card-pop.json", (p) => (p.g ? (p.g["10"] || 0) + (p.g["10P"] || 0) : null));
  if (!P || !C || !T) return null;
  const rows = [];
  for (const [k, p] of Object.entries(P)) {
    const c = C[k], t = T[k];
    if (!c || !t) continue;
    if (p.total < GRADER_MIN || c.total < GRADER_MIN || t.total < GRADER_MIN) continue;
    const rate = (x) => +((x.gem / x.total) * 100).toFixed(1);
    rows.push({
      key: k, card: k.split("|").slice(1).join(" "), label: p.label || t.label || "",
      psa: rate(p), psaN: p.total, cgc: rate(c), cgcN: c.total, tag: rate(t), tagN: t.total,
    });
  }
  if (rows.length < 8) return null;   // 표본이 얇으면 표를 만들지 않는다
  rows.sort((a, b) => b.psaN - a.psaN);
  const avg = (f) => +(rows.reduce((a, r) => a + r[f], 0) / rows.length).toFixed(1);
  return { rows, avgPsa: avg("psa"), avgCgc: avg("cgc"), avgTag: avg("tag"), asOf: Object.values(P)[0].d };
})();

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
  : `<td class="pgAdd">&mdash;</td><td class="pgPct"><span class="pgNa">collecting</span></td>`);
const tr = (r) => `        <tr data-code="${r.code}">
          <th scope="row"><a href="sets/${r.code.toLowerCase()}.html"><b>${r.code}</b><span>${esc(r.name)}</span></a></th>
          <td class="pgNum">${n(r.jp?.total)}</td><td class="pgGem">${r.jp ? r.jp.gem + "%" : "&mdash;"}</td>${cell(r.jpD, "jp")}
          <td class="pgNum pgSplit">${n(r.en?.total)}</td><td class="pgGem">${r.en ? r.en.gem + "%" : "&mdash;"}</td>${cell(r.enD, "en")}
        </tr>`;

// ── 해설용 파생 수치 — 표 데이터에서만 계산. 숫자가 바뀌면 문장도 바뀐다(2026-07-30 애드센스 대응).
const biggest = rows[0];
const jpGems = rows.filter((r) => r.jp && r.jp.gem != null);
const hiGem = [...jpGems].sort((a, b) => b.jp.gem - a.jp.gem)[0];
const loGem = [...jpGems].sort((a, b) => a.jp.gem - b.jp.gem)[0];
const grew = rows.filter((r) => r.jpD && r.jpD.pct != null).sort((a, b) => b.jpD.pct - a.jpD.pct);
const fast1 = grew[0], fast2 = grew[1];
const enBigger = rows.filter((r) => r.jp && r.en && r.en.total > r.jp.total);

const analysis = `
      <section aria-label="What the numbers show">
        <h2>What the population data shows right now</h2>
        <p class="pgNotes"><b>${esc(biggest.code)} ${esc(biggest.name)}</b> carries the largest graded population of any tracked set${biggest.jp ? ` — ${n(biggest.jp.total)} Japanese cards in PSA holders` : ""}${biggest.en ? `, plus ${n(biggest.en.total)} English` : ""}. This is submission volume, not a release-date or sealed-print-run estimate. A large base can reflect collector demand, opening volume, cards held raw before submission, or a mix of all three.</p>
        ${fast1 && fast1.jpD ? `<p class="pgNotes">The largest Japanese percentage increase this week is <b>${esc(fast1.code)}</b> at ${pc(fast1.jpD.pct)} (+${n(fast1.jpD.add)} cards)${fast2 && fast2.jpD ? `, followed by <b>${esc(fast2.code)}</b> at ${pc(fast2.jpD.pct)}` : ""}. Percentage growth is sensitive to the starting population, so compare the raw additions and the percentage instead of ranking sets by either figure alone.</p>` : ""}
        ${hiGem && loGem && hiGem !== loGem ? `<p class="pgNotes">Gem rates are not uniform. Among Japanese printings, <b>${esc(hiGem.code)}</b> currently gems at ${hiGem.jp.gem}% while <b>${esc(loGem.code)}</b> sits at ${loGem.jp.gem}%. The difference can reflect print quality, the cards collectors choose to submit, and sample size. It does not by itself prove that one print run is better.</p>` : ""}
        ${enBigger.length ? `<p class="pgNotes">For ${enBigger.length} set${enBigger.length === 1 ? "" : "s"} (${enBigger.map((r) => esc(r.code)).join(", ")}) the <b>English</b> graded population is actually larger than the Japanese one — a reminder that the two markets have different collector bases, and another reason we never merge the columns.</p>` : ""}
        <p class="pgNotes">PSA is one of three graders we track. CGC and TAG populations — including CGC's split between Pristine 10 and Gem Mint 10, and TAG's 10 versus 10P — are shown per set on each <a href="sets/index.html">set guide</a>, always kept separate from PSA because the standards do not map onto each other.</p>
      </section>
      <section aria-label="Frequently asked questions">
        <h2>PSA population — common questions</h2>
        <details class="faqItem" style="max-width:760px"><summary>Which One Piece set has the most PSA-graded cards?</summary><p class="pgNotes">${esc(biggest.code)} ${esc(biggest.name)}${biggest.jp ? `, with ${n(biggest.jp.total)} Japanese cards graded` : ""}${biggest.en ? ` and ${n(biggest.en.total)} English` : ""} as of ${updated}. See the table above for every tracked set.</p></details>
        <details class="faqItem" style="max-width:760px"><summary>Why does grading volume matter for sealed box prices?</summary><p class="pgNotes">Weekly population growth records newly posted grades, but those cards may come from recent openings or previously held raw copies. We treat it as an indirect collector-activity signal and read it with release timing, box listings and sold data.</p></details>
        <details class="faqItem" style="max-width:760px"><summary>Why don't you add Japanese and English together?</summary><p class="pgNotes">They are different print runs with different card stock, pull rates and buyers. A combined total, or worse a combined gem rate, would describe neither market. Every figure on this site is labelled by printing.</p></details>
        <details class="faqItem" style="max-width:760px"><summary>Where does this data come from?</summary><p class="pgNotes">Public PSA population reporting, collected by us weekly and appended to a ledger we never rewrite. Weekly change is only shown for the period we recorded ourselves — we do not backfill history we did not observe.</p></details>
      </section>`;

const FAQ_LD = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: [
    { "@type": "Question", name: "Which One Piece set has the most PSA-graded cards?", acceptedAnswer: { "@type": "Answer", text: `${biggest.code} ${biggest.name}${biggest.jp ? `, with ${biggest.jp.total.toLocaleString("en-US")} Japanese cards graded` : ""} as of ${updated}.` } },
    { "@type": "Question", name: "Why does grading volume matter for sealed box prices?", answerCount: 1, acceptedAnswer: { "@type": "Answer", text: "Weekly population growth records newly posted grades, but those cards may come from recent openings or previously held raw copies. We treat it as an indirect collector-activity signal alongside release timing, box listings and sold data." } },
    { "@type": "Question", name: "Why don't you add Japanese and English together?", acceptedAnswer: { "@type": "Answer", text: "They are different print runs with different card stock, pull rates and buyers; a combined figure would describe neither market." } },
  ],
});

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
    <script type="application/ld+json">${FAQ_LD}</script>
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
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" aria-current="page" data-ko="PSA 인구">PSA Population</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="pgWrap">
      <p class="eyebrow">PSA Population</p>
      <h1>One Piece PSA population by set</h1>
      <p class="lead">How many cards from each booster set have been submitted to PSA, kept separate for the Japanese and English printings. Weekly additions are an indirect collector-activity signal, not a count of boxes opened in that week: submitted cards may come from recent pulls or older raw holdings. Cumulative totals are as of ${updated}; the weekly change compares ${wNow} against ${wPrev}.</p>
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
      <p class="pgNotes">A high weekly number is not automatically bullish and does not prove that the cards were pulled that week. It does show more graded copies entering the recorded population. Read it next to release timing and the box price on each <a href="sets/index.html">set guide</a>, and against completed sales on the <a href="psa10-ranking.html">PSA 10 value ranking</a>.</p>
      <p class="pgNotes">Population figures are compiled from public PSA population reporting. We publish weekly change only from the point we began recording it ourselves; we do not republish historical series compiled by others.</p>
${graderCmp ? `
      <h2>The same cards, judged by three graders</h2>
      <p class="pgNotes">We track per-card population at PSA, CGC and TAG separately. These are the ${graderCmp.rows.length} cards where all three have graded at least ${GRADER_MIN} copies, so a top-grade share is worth stating for each. Population as of ${esc(graderCmp.asOf)}.</p>
      <div class="pgTot">
        <div class="pgCard jp"><span class="k">PSA &mdash; top-grade share</span><span class="v">${graderCmp.avgPsa}%</span><span class="d">PSA 10</span></div>
        <div class="pgCard"><span class="k">CGC &mdash; top-grade share</span><span class="v">${graderCmp.avgCgc}%</span><span class="d">Pristine 10 + Gem Mint 10</span></div>
        <div class="pgCard en"><span class="k">TAG &mdash; top-grade share</span><span class="v">${graderCmp.avgTag}%</span><span class="d">10 + 10P</span></div>
      </div>
      <div class="pgTableWrap">
      <table class="pgTable">
        <caption class="sr-only">Top-grade share at PSA, CGC and TAG for cards all three have graded</caption>
        <thead><tr>
          <th scope="col">Card</th>
          <th scope="col" class="hjp">PSA</th><th scope="col" class="hjp">graded</th>
          <th scope="col">CGC</th><th scope="col">graded</th>
          <th scope="col" class="hen">TAG</th><th scope="col" class="hen">graded</th>
        </tr></thead>
        <tbody>
${graderCmp.rows.map((r) => `          <tr><th scope="row"><b>${esc(r.card)}</b><span>${esc(String(r.label).slice(0, 44))}</span></th>` +
  `<td class="pgPct jp">${r.psa}%</td><td class="pgNum">${n(r.psaN)}</td>` +
  `<td class="pgPct">${r.cgc}%</td><td class="pgNum">${n(r.cgcN)}</td>` +
  `<td class="pgPct en">${r.tag}%</td><td class="pgNum">${n(r.tagN)}</td></tr>`).join("\n")}
        </tbody>
      </table>
      </div>
      <p class="pgNotes"><b>Each grader's top grade means something different.</b> PSA has a single 10. CGC splits its top into Pristine 10 and Gem Mint 10, and we count both. TAG has 10 and a stricter 10P above it, and we count both. A share is therefore comparable only as "how often the highest available grade was awarded", not as a like-for-like quality score.</p>
      <p class="pgNotes"><b>This does not prove one grader is stricter.</b> These are different physical copies, and submitters choose where to send a card &mdash; a collector who expects a gem may favour one company, which moves the recorded share without anyone grading differently. PSA populations are also far larger, so its share rests on a much heavier sample than CGC's or TAG's. What the table shows is that <b>the recorded outcomes differ by grader</b>, which is worth knowing before reading any single company's population as the market's quality level.</p>
` : ""}
${analysis}
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Data terms</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(OUT, html, "utf8");
console.log(JSON.stringify({ page: "psa-grading.html", sets: rows.length, enSets: enCount, weeks: [wPrev, wNow], jpTotal: tj, enTotal: te, bytes: html.length }));
