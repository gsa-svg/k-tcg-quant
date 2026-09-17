#!/usr/bin/env node
// 등급 인구 페이지 생성 — 2026-07-27 신설, 2026-09-15 재설계(소유자 지시).
//
// 무엇: 추적 22개 세트가 PSA·CGC·TAG 홀더에 몇 장 들어가 있는지, 일본판/영문판을 나눠 한 페이지에 모은다.
//   경매 페이지 문법(숫자 카드 · 세트별 누적 막대 · 박스 이미지 표), 설명문·FAQ 없음, 모바일은 표 4열.
//   9/15 이전엔 PSA 한 회사 + 보고서식 산문 + 카드별 3사 표였다 — 소유자: "이미지 없이 카드명만 있으면 못 읽는다, 다른 그레이딩도 같이 보여줘라".
//
// 데이터: data/grading-series.json (세트×판×회사 누적 시계열 — build-grading-series.js)
//        data/onepiece-packs.json (psaFull / psaFullEn 최신 PSA 총량·젬 수 — 시계열보다 새롭다)
//        data/psa-edition-weekly.json (PSA 주간 증감)
// 합산 금지: 일본판+영문판을 더하면 어느 쪽도 설명하지 못하는 값이 된다. 같은 판 안에서 회사별 합계는 낸다(누적 막대).
// 이미지: 세트 박스(/card-img/box/*.webp) 자체 호스팅만.
// Run: node tools/generate-psa-grading-page.js
const fs = require("node:fs");
const path = require("node:path");
const { navHtml } = require("./site-nav");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "psa-grading.html");
const pk = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const gs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "grading-series.json"), "utf8"));
const led = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "psa-edition-weekly.json"), "utf8"));
const ver = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1];

const weeks = led.weeks.slice(-2);
if (weeks.length < 2) { console.error("주간 비교에 두 점이 필요 — 페이지 미생성"); process.exit(1); }
const [wPrev, wNow] = weeks;
const n = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
const sn = (v) => (v == null ? "—" : (v >= 0 ? "+" : "−") + Math.abs(Math.round(v)).toLocaleString("en-US"));
const pct = (a, b) => (a != null && b ? (a / b * 100).toFixed(1) + "%" : "—");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const GR = ["psa", "cgc", "tag"];
const GRN = { psa: "PSA", cgc: "CGC", tag: "TAG" };
// 최상위 등급의 정의가 회사마다 다르다 — 하나로 뭉뚱그리지 않는다. CGC 는 세트 단위 등급 분포를 수집하지 않아 비율이 없다.
const TOP = { psa: "PSA 10", cgc: "Pristine 10 + Gem Mint 10", tag: "10 + 10P" };

const codes = [...(pk.jp?.list || []), ...(pk.extra?.list || [])];
const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
const prev = (arr) => (Array.isArray(arr) && arr.length > 1 ? arr[arr.length - 2] : null);
const rows = codes.map((code) => {
  const set = pk.sets[code];
  const box = set.box && fs.existsSync(path.join(ROOT, set.box.replace(/^\//, ""))) ? set.box.replace(/^\//, "") : null;
  const ed = (e) => {
    const g = (gs.sets[code] || {})[e] || {};
    const out = {};
    for (const k of GR) {
      const l = last(g[k]), p = prev(g[k]);
      let total = l ? l.total : (g.latestTotal && g.latestTotal.by ? g.latestTotal.by[k] : null);
      let gem = l && l.gem != null ? l.gem : null;
      let add = l && l.add != null ? l.add : null, from = p ? p.d : null, to = l ? l.d : null;
      if (k === "psa") {
        // PSA 는 최신 전체 스냅샷(psaFull·psaFullEn)이 시계열보다 새롭고, 주간 증감은 판별 원장(psa-edition-weekly)에서 온다.
        const ps = e === "jp" ? set.psaFull : set.psaFullEn;
        if (ps) { total = ps.total; gem = ps.gems; }
        const arr = (led.sets[code] || {})[e] || [];
        const a = arr.find((x) => x.d === wPrev), b = arr.find((x) => x.d === wNow);
        if (a && b) { add = b.g - a.g; from = wPrev; to = wNow; } else if (e === "en") { add = null; }
      }
      out[k] = total == null ? null : { total, gem, add, from, to };
    }
    return out;
  };
  return { code, name: set.nameEn || code, box, jp: ed("jp"), en: ed("en") };
});
const tot = (r, e) => GR.reduce((t, k) => t + ((r[e][k] && r[e][k].total) || 0), 0);
rows.sort((a, b) => (tot(b, "jp") + tot(b, "en")) - (tot(a, "jp") + tot(a, "en")));
const sumBy = (e, k, f) => rows.reduce((t, r) => t + ((r[e][k] && r[e][k][f]) || 0), 0);
const K = {};
for (const e of ["jp", "en"]) for (const k of GR) K[e + k] = { total: sumBy(e, k, "total"), add: sumBy(e, k, "add"), gem: sumBy(e, k, "gem") };
const win = (k, e) => { const r = rows.find((x) => x[e][k] && x[e][k].from); return r ? `${r[e][k].from.slice(5)} → ${r[e][k].to.slice(5)}` : ""; };
const updated = rows.flatMap((r) => ["jp", "en"].flatMap((e) => GR.map((k) => (r[e][k] && r[e][k].to) || ""))).sort().pop() || wNow;

// ── 세트별 누적 막대(회사별 색), 일본판·영문판 두 줄, 같은 눈금
const maxTot = Math.max(...rows.flatMap((r) => [tot(r, "jp"), tot(r, "en")]), 1);
const stack = (r, e) => {
  const T = tot(r, e);
  if (!T) return `<span class="sLine"><i class="edTag">${e.toUpperCase()}</i><span class="sTrack"><span class="sNa">no data yet</span></span></span>`;
  const segs = GR.map((k) => { const v = (r[e][k] && r[e][k].total) || 0; return v ? `<span class="seg ${k}" style="width:${(v / maxTot * 100).toFixed(2)}%" title="${GRN[k]} ${n(v)}"></span>` : ""; }).join("");
  return `<span class="sLine"><i class="edTag">${e.toUpperCase()}</i><span class="sTrack">${segs}</span><span class="sVal">${n(T)}</span></span>`;
};
const setName = (r) => `<span class="tName">${r.box ? `<img src="${esc(r.box)}" alt="" width="36" height="36" loading="lazy" decoding="async" />` : ""}<span><b>${esc(r.code)}</b> <small>${esc(r.name)}</small></span></span>`;
const stackRows = rows.slice(0, 12).map((r) => `<div class="sRow">${setName(r)}<span class="sBars">${stack(r, "jp")}${stack(r, "en")}</span></div>`).join("\n");

// ── 표: 세트 × (PSA·CGC·TAG) × (JP·EN). 모바일은 EN 열을 숨기고 JP 셀 밑에 EN 값을 작게 둔다.
const cellG = (r, k) => {
  const j = r.jp[k], e = r.en[k];
  const gemLine = (x) => (x && x.gem != null && x.total ? `<small class="gem">${pct(x.gem, x.total)} top</small>` : "");
  return `<td class="num ${k}">${j ? n(j.total) : "—"}${j && j.add != null ? `<small>${sn(j.add)}</small>` : ""}${gemLine(j)}<small class="mOnly">EN ${e ? n(e.total) : "—"}</small></td>` +
    `<td class="num ${k} hideM en">${e ? n(e.total) : "—"}${e && e.add != null ? `<small>${sn(e.add)}</small>` : ""}${gemLine(e)}</td>`;
};
const setCell = (r, size) => `<td class="l setCell"><a href="sets/${r.code.toLowerCase()}.html">${r.box ? `<img src="${esc(r.box)}" alt="" width="${size}" height="${size}" loading="lazy" decoding="async" />` : `<span class="noImg" aria-hidden="true"></span>`}<span><b>${esc(r.code)}</b><small>${esc(r.name)}</small></span></a></td>`;
const tr = (r) => `<tr>${setCell(r, 44)}${GR.map((k) => cellG(r, k)).join("")}</tr>`;
const foot = `<tr><td class="l"><b>All ${rows.length} sets</b></td>${GR.map((k) => `<td class="num ${k}">${n(K["jp" + k].total)}<small>${sn(K["jp" + k].add)}</small>${K["jp" + k].gem ? `<small class="gem">${pct(K["jp" + k].gem, K["jp" + k].total)} top</small>` : ""}<small class="mOnly">EN ${n(K["en" + k].total)}</small></td><td class="num ${k} hideM en">${n(K["en" + k].total)}<small>${sn(K["en" + k].add)}</small>${K["en" + k].gem ? `<small class="gem">${pct(K["en" + k].gem, K["en" + k].total)} top</small>` : ""}</td>`).join("")}</tr>`;

// ── 최근 증가 상위 10(일본판, PSA 주간 증가 기준 정렬)
const byAdd = [...rows].filter((r) => r.jp.psa && r.jp.psa.add != null).sort((a, b) => b.jp.psa.add - a.jp.psa.add).slice(0, 10);
const addTr = (r) => `<tr>${setCell(r, 36)}${GR.map((k) => `<td class="num ${k}">${r.jp[k] && r.jp[k].add != null ? sn(r.jp[k].add) : "—"}</td>`).join("")}</tr>`;

const TITLE = "One Piece Grading Population by Set — PSA, CGC, TAG"; // 60자 이내(2026-09-17)
const DESC = `One Piece cards per booster set in PSA, CGC and TAG holders, Japanese and English separate, with change since each report. ${rows.length} sets, updated ${updated}.`; // 155자 이내(2026-09-17)
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="https://opboxindex.com/psa-grading.html" />
    <link rel="alternate" hreflang="en" href="https://opboxindex.com/psa-grading.html" />
    <link rel="alternate" hreflang="ko" href="https://opboxindex.com/ko/grading.html" />
    <link rel="alternate" hreflang="x-default" href="https://opboxindex.com/psa-grading.html" />
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
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Dataset", name: "One Piece grading population by set (PSA, CGC, TAG; Japanese and English)", description: DESC, isAccessibleForFree: true, creator: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" }, temporalCoverage: `${wPrev}/${updated}`, dateModified: updated, variableMeasured: ["Cards graded by PSA", "Cards graded by CGC", "Cards graded by TAG", "PSA 10 share", "TAG 10 and 10P share", "Change since previous report"] })}</script>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "OP Box Index", item: "https://opboxindex.com/" }, { "@type": "ListItem", position: 2, name: "Grading population", item: "https://opboxindex.com/psa-grading.html" }] })}</script>
    <link rel="stylesheet" href="styles.css?v=${ver}" />
    <script defer src="lang-toggle.js?v=${ver}"></script>
    <style>
      .pgWrap { max-width: 980px; margin: 0 auto; padding: 20px clamp(14px,3vw,28px) 44px; }
      .pgWrap h1 { margin: 6px 0; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .pgWrap .lead { color: var(--muted); font-size: 15px; line-height: 1.6; margin: 6px 0 0; }
      .pgWrap h2 { font-size: 19px; margin: 0 0 2px; }
      .psa { --g: #55d8ea; } .cgc { --g: #f5c451; } .tag { --g: #4ad9a4; }
      .statRow { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin: 18px 0 6px; }
      .stat { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: rgba(255,255,255,.02); }
      .stat .k { display: block; font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--g); }
      .stat b { display: block; font-size: clamp(22px,4vw,30px); font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; margin-top: 4px; }
      .stat span.s { display: block; font-size: 11.5px; color: var(--muted); margin-top: 4px; line-height: 1.45; font-variant-numeric: tabular-nums; }
      .stat span.s em { font-style: normal; color: var(--g); font-weight: 700; }
      .chartCard { border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 12px; margin: 18px 0; background: rgba(255,255,255,.015); }
      .chartHead { margin-bottom: 8px; }
      .chartHead .sub { margin: 2px 0 0; color: var(--muted); font-size: 12.5px; }
      .legend { display: flex; flex-wrap: wrap; gap: 14px; margin: 8px 0 4px; font-size: 12px; color: var(--muted); }
      .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 2px; background: var(--g); margin-right: 6px; vertical-align: -1px; }
      .sList { margin: 6px 0 2px; }
      .sRow { display: grid; grid-template-columns: minmax(170px, 1fr) 3fr; gap: 12px; align-items: center; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,.04); }
      .tName { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .tName img { width: 36px; height: 36px; border-radius: 6px; object-fit: cover; flex: 0 0 36px; background: rgba(255,255,255,.06); }
      .tName b { font-weight: 700; } .tName small { color: var(--muted); display: block; font-size: 11px; }
      .sBars { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
      .sLine { display: flex; align-items: center; gap: 8px; min-width: 0; }
      .edTag { font-style: normal; font-size: 10px; font-weight: 800; letter-spacing: .04em; color: var(--muted); width: 22px; flex: 0 0 22px; }
      .sTrack { flex: 1 1 auto; position: relative; height: 16px; border-radius: 4px; background: rgba(255,255,255,.05); overflow: hidden; display: flex; }
      .seg { display: block; height: 100%; background: var(--g); }
      .sNa { position: absolute; left: 6px; top: 0; line-height: 16px; font-size: 11px; color: var(--muted); }
      .sVal { flex: 0 0 auto; min-width: 64px; text-align: right; font-variant-numeric: tabular-nums; font-weight: 700; font-size: 12.5px; }
      .tblWrap { overflow-x: auto; }
      .aTable { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 6px 0; }
      .aTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-weight: 600; font-size: 11.5px; letter-spacing: .04em; text-transform: uppercase; white-space: nowrap; }
      .aTable th.l, .aTable td.l { text-align: left; }
      .aTable th.psa, .aTable th.cgc, .aTable th.tag { color: var(--g); }
      .aTable th.en, .aTable td.en { border-left: 1px solid rgba(255,255,255,.06); }
      .aTable th.en { font-weight: 500; }
      .aTable td { padding: 7px 10px; border-bottom: 1px solid rgba(255,255,255,.05); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; vertical-align: middle; }
      .aTable td.num { font-weight: 800; font-size: 14px; color: var(--g); }
      .aTable td.num.en { color: var(--ink); opacity: .9; }
      .aTable td small { display: block; color: var(--muted); font-weight: 400; font-size: 11px; }
      .aTable td .mOnly { display: none; }
      .aTable tfoot td { border-top: 1px solid var(--line); border-bottom: 0; }
      .setCell a { display: flex; align-items: center; gap: 10px; color: inherit; text-decoration: none; min-width: 180px; }
      .setCell a:hover b { color: var(--accent); }
      .setCell img, .setCell .noImg { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; background: rgba(255,255,255,.06); flex: 0 0 44px; }
      .setCell b { display: block; font-size: 13.5px; line-height: 1.2; }
      .setCell small { display: block; color: var(--muted); font-size: 11px; margin: 2px 0 0; white-space: normal; }
      @media (max-width: 640px) {
        .statRow { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
        .stat { padding: 10px 8px; } .stat b { font-size: 17px; } .stat .k { font-size: 10px; } .stat span.s { font-size: 10.5px; }
        .chartCard { padding: 12px 12px 8px; border-radius: 12px; }
        .sRow { grid-template-columns: 1fr; gap: 4px; padding: 8px 0; }
        .sVal { min-width: 56px; }
        .aTable { font-size: 12.5px; table-layout: fixed; }
        .aTable th, .aTable td { padding: 6px 4px; }
        .aTable th { font-size: 10.5px; letter-spacing: 0; white-space: normal; overflow-wrap: anywhere; }
        .aTable .hideM { display: none; }
        .aTable th.numH { width: 66px; }
        .aTable td.num { font-size: 12.5px; white-space: normal; }
        .aTable td .mOnly { display: block; color: var(--muted); font-weight: 400; font-size: 10.5px; }
        .aTable td small.gem { display: none; }
        .aTable td.l { white-space: normal; overflow-wrap: anywhere; }
        .setCell a { min-width: 0; gap: 8px; }
        .setCell img, .setCell .noImg { width: 34px; height: 34px; flex-basis: 34px; }
        .setCell span:not(.noImg) { min-width: 0; }
      }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("", "psa-grading.html")}
    </header>
    <main id="main-content" class="pgWrap">
      <p class="eyebrow">Grading population · PSA · CGC · TAG · updated ${esc(updated)}</p>
      <h1>One Piece grading population by set</h1>
      <p class="lead">Cards in PSA, CGC and TAG holders per booster set · Japanese and English printings kept separate · change = new grades since each company's previous report</p>

      <div class="statRow">
${GR.map((k) => `        <div class="stat ${k}"><span class="k">${GRN[k]} · Japanese</span><b>${n(K["jp" + k].total)}</b><span class="s"><em>${sn(K["jp" + k].add)}</em> ${esc(win(k, "jp"))}${K["jp" + k].gem ? ` · ${pct(K["jp" + k].gem, K["jp" + k].total)} ${TOP[k]}` : ""}</span></div>`).join("\n")}
${GR.map((k) => `        <div class="stat ${k}"><span class="k">${GRN[k]} · English</span><b>${n(K["en" + k].total)}</b><span class="s"><em>${sn(K["en" + k].add)}</em> ${esc(win(k, "en"))}${K["en" + k].gem ? ` · ${pct(K["en" + k].gem, K["en" + k].total)} ${TOP[k]}` : ""}</span></div>`).join("\n")}
      </div>

      <div class="chartCard">
        <div class="chartHead"><h2>Most graded sets</h2><p class="sub">Cards in holders · top 12 sets · one bar per printing, same scale · colour = grading company</p></div>
        <div class="legend">${GR.map((k) => `<span class="${k}"><i></i>${GRN[k]}</span>`).join("")}</div>
        <div class="sList">
${stackRows}
        </div>
      </div>

      <div class="chartCard">
        <div class="chartHead"><h2>New grades since last report · Japanese printing</h2><p class="sub">PSA ${esc(win("psa", "jp"))} · CGC ${esc(win("cgc", "jp"))} · TAG ${esc(win("tag", "jp"))} · top 10 sets by PSA</p></div>
        <div class="tblWrap"><table class="aTable">
          <caption class="sr-only">New grades since each company's previous report, Japanese printing, top 10 sets</caption>
          <thead><tr><th class="l">Set</th><th class="psa numH">PSA</th><th class="cgc numH">CGC</th><th class="tag numH">TAG</th></tr></thead>
          <tbody>
${byAdd.map(addTr).join("\n")}
          </tbody>
        </table></div>
      </div>

      <div class="chartCard">
        <div class="chartHead"><h2>All ${rows.length} sets · PSA · CGC · TAG</h2><p class="sub">Cards in holders · change since last report · top-grade share (PSA 10 · TAG 10 + 10P) · JP and EN side by side</p></div>
        <div class="tblWrap"><table class="aTable">
          <caption class="sr-only">Graded population per set at PSA, CGC and TAG, Japanese and English printings</caption>
          <thead><tr><th class="l">Set</th><th class="psa numH">PSA JP</th><th class="psa en">PSA EN</th><th class="cgc numH">CGC JP</th><th class="cgc en">CGC EN</th><th class="tag numH">TAG JP</th><th class="tag en">TAG EN</th></tr></thead>
          <tbody>
${rows.map(tr).join("\n")}
          </tbody>
          <tfoot>${foot}</tfoot>
        </table></div>
      </div>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Free data (CSV)</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(OUT, html, "utf8");
console.log(JSON.stringify({ page: "psa-grading.html", sets: rows.length, updated, jpPsa: K.jppsa.total, jpCgc: K.jpcgc.total, jpTag: K.jptag.total, enPsa: K.enpsa.total, enCgc: K.encgc.total, enTag: K.entag.total, bytes: html.length }));
