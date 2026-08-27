// auction.html (영어, 루트) — 원피스 이베이 경매 "실낙찰" 데이터 페이지.
// 소유자 우선순위(2026-08-01): 해외(영어) 유저 유입이 1순위. 경매 데이터셋은 우리만 가진 자산인데
// 영어 지면이 없었다 — "one piece card auction results / ebay sold prices / sell-through" 검색 정조준.
// 원칙: 값은 전부 auction-sold.json / auction-card-stats.json 에서 파생. 추정 금지, 없으면 비움.
// 기존 페이지의 노출 상태(canonical/robots/사이트맵 항목)는 건드리지 않는다 — 추가만 한다.
// Run: node tools/generate-auction-page.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const auc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-sold.json"), "utf8"));
// partial 판정은 auction-series.json 만 들고 있다. 표에 표시해 반쪽 하루를 정상일처럼 읽지 않게 한다.
let aucSeries = { daily: [] };
try { aucSeries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-series.json"), "utf8")); } catch (e) {}
const PARTIAL_DAYS = new Set((aucSeries.daily || []).filter((r) => r.partial).map((r) => r.d));
const cardStats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-card-stats.json"), "utf8"));
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null || !isFinite(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"));
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("en-US"));

// 진행 중인 오늘은 **여기서** 잘라낸다 — 2026-08-25.
// 종전엔 아래에서 fullDays 를 따로 만들어 "최신 완결일" 문장에만 썼고, 표·헤드라인·FAQ·
// schema.org 는 필터 없는 daily 를 그대로 썼다. 그래서 같은 페이지에
// "On the latest full day (2026-08-23)" 문장과 08-24 부분치 행(591건·52.1%)이 함께 실렸다.
// 실제 08-24 는 1,045건·39.6% 였다 — 건수 -43%, 낙찰률 +12.5%p 로 어긋난다.
// 공개 CSV 는 이미 당일을 빼고 있어서 페이지 숫자를 CSV 로 재현할 수 없는 상태이기도 했다.
const TODAY_ISO = new Date().toISOString().slice(0, 10);
const daily = (auc.daily || []).filter((x) => x.d < TODAY_ISO).slice(-10);
if (daily.length < 3) { console.error("일별 집계가 3일 미만 — 페이지 미생성"); process.exit(1); }
// 헤드라인·FAQ·Dataset 의 합산은 **완전 수집일만** 쓴다 — 2026-08-26 감사.
// 부분수집일(partial)은 실측이지만 덜 센 날이라, 섞으면 건수는 줄고 비율은 치우친다.
// 표에는 partial 배지와 함께 전부 남긴다 — 숨기는 게 아니라 합산에서만 뺀다.
const fullDaily = daily.filter((x) => !PARTIAL_DAYS.has(x.d));
const aggDays = fullDaily.length >= 3 ? fullDaily : daily;   // 완전일이 너무 적으면 전체로 폴백(라벨은 그대로 정직하게)
const aggNote = fullDaily.length >= 3 && fullDaily.length < daily.length ? ` (${daily.length - fullDaily.length} partial day${daily.length - fullDaily.length > 1 ? "s" : ""} excluded)` : "";
const totN = aggDays.reduce((t, x) => t + x.n, 0);
const totSold = aggDays.reduce((t, x) => t + x.sold, 0);
const st = totN ? Math.round((totSold / totN) * 100) : 0;
const kinds = ["card", "box", "pack"].map((k) => {
  const rows = aggDays.map((x) => x.byKind && x.byKind[k]).filter(Boolean);
  const n = rows.reduce((t, b) => t + b.n, 0), sold = rows.reduce((t, b) => t + b.sold, 0);
  return { k, n, sold, st: n ? Math.round((sold / n) * 100) : null };
});
const cardK = kinds[0], boxK = kinds[1];
// daily 가 이미 완결일만 담는다(위 TODAY_ISO 필터).
const last = daily[daily.length - 1];

const nameOf = (set, id) => {
  const cs = (d.sets[set] || {}).cards || [];
  const hit = cs.find((c) => String(c.number || "").toUpperCase() === id.toUpperCase());
  return hit ? hit.name : null;
};
const topCards = Object.entries(cardStats.cards || {})
  .map(([id, c]) => ({ id, ...c, name: nameOf(c.set, id) }))
  .sort((a, b) => b.medPrice - a.medPrice).slice(0, 12);

const dTr = daily.map((x) => `<tr${PARTIAL_DAYS.has(x.d) ? ' class="partialRow"' : ""}><td class="l">${esc(x.d)}${PARTIAL_DAYS.has(x.d) ? ' <span class="pFlag" title="Collection was interrupted that day — treat this row as incomplete">partial</span>' : ""}</td><td>${num(x.n)}</td><td>${num(x.sold)}</td><td>${x.sellThrough != null ? x.sellThrough + "%" : "—"}</td><td>${x.medPrice != null ? usd(x.medPrice) : "—"}</td><td>${x.medBids != null ? num(x.medBids) : "—"}</td></tr>`).join("\n");
const cTr = topCards.map((c, i) => `<tr><td>${i + 1}</td><td class="l">${esc(c.name || c.id)}<small>${esc(c.id)} · ${esc(c.set)}</small></td><td>${usd(c.medPrice)}</td><td>${c.low != null && c.high != null ? `${usd(c.low)}–${usd(c.high)}` : "—"}</td><td>${c.sellThrough != null ? c.sellThrough + "%" : "—"}</td><td>${num(c.sold)}</td></tr>`).join("\n");
const kTr = kinds.filter((k) => k.n).map((k) => `<tr><td class="l">${k.k === "card" ? "Single cards" : k.k === "box" ? "Sealed booster boxes" : "Sealed packs"}</td><td>${num(k.n)}</td><td>${num(k.sold)}</td><td>${k.st}%</td></tr>`).join("\n");

// ── 다른 TCG 교차 비교 ─────────────────────────────────────────────────────
// 원피스 낙찰률만 보면 그게 높은지 낮은지 알 수 없다. 같은 방식·같은 기간으로 모은
// 다른 TCG 가 있어야 비교가 성립한다. 이 표가 우리만 가진 자산이다.
// 원칙: 표본 미달 게임은 숨긴다. 비율에는 윌슨 95% 구간을 붙인다. 추정하지 않는다.
const TCG_MIN_N = 100;      // 낙찰률을 말하기 위한 최소 종료 건수
const TCG_MIN_PRICE_N = 20; // 중앙 낙찰가를 말하기 위한 최소 낙찰 건수
const wilson = (s, n) => {
  if (!n) return null;
  const z = 1.96, p = s / n;
  return +((z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)) / (1 + (z * z) / n)) * 100).toFixed(1);
};
let tcgRows = [], tcgDays = 0, tcgTotal = 0, tcgFrom = "", tcgTo = "";
try {
  const tSeries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-series.json"), "utf8"));
  const names = Object.fromEntries(Object.entries(tSeries.games || {}).map(([k, v]) => [k, v.name]));
  const arcDir = path.join(ROOT, "data", "tcg-archive");
  const files = fs.readdirSync(arcDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  tcgDays = files.length; tcgFrom = (files[0] || "").slice(0, 10); tcgTo = (files[files.length - 1] || "").slice(0, 10);
  const agg = {};
  for (const f of files) {
    for (const s of JSON.parse(fs.readFileSync(path.join(arcDir, f), "utf8")).sales || []) {
      const g = s.g; if (!g) continue;
      agg[g] = agg[g] || { n: 0, sold: 0, gmv: 0, prices: [] };
      agg[g].n++; tcgTotal++;
      if (s.sold) { agg[g].sold++; const p = Number(s.price); if (p > 0) { agg[g].prices.push(p); agg[g].gmv += p; } }
    }
  }
  // 진행 중 매물 수는 표본이 아니라 실측 카운트라 신뢰구간이 필요 없다.
  const lastDay = (tSeries.daily || [])[(tSeries.daily || []).length - 1] || { games: {} };
  tcgRows = Object.entries(agg)
    .filter(([, v]) => v.n >= TCG_MIN_N)
    .map(([k, v]) => {
      const sorted = v.prices.slice().sort((a, b) => a - b);
      const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
      const g = lastDay.games[k] || {};
      return {
        key: k,
        name: names[k] || k,
        isOp: k === "onepiece",
        n: v.n, sold: v.sold,
        rate: +((v.sold / v.n) * 100).toFixed(1),
        ci: wilson(v.sold, v.n),
        // 1센트 시작 벌크 매물이 섞이면 중앙값이 $0.01 로 무너진다. 그런 값은 쓰지 않는다.
        med: sorted.length >= TCG_MIN_PRICE_N && med >= 1 ? med : null,
        gmv: Math.round(v.gmv || 0),
        // 그날 eBay 에서 실제로 끝난 경매 수. 우리가 확인한 n/sold 와는 다른 값이다(그쪽이 훨씬 작다).
        ending: Math.round(g.endingToday || 0),
      };
    })
    .sort((a, b) => b.rate - a.rate);
} catch { tcgRows = []; }
// 상단 스탯은 반드시 차트와 같은 표본에서 뽑는다. 전용 원피스 수집기(auction-sold.json)와
// 섞으면 같은 페이지에 원피스 낙찰률이 두 개 나와 오류처럼 보인다 — 2026-08-12 실제로 그랬다.
const tcgEndedAll = tcgRows.reduce((a, r) => a + r.n, 0);
const tcgSoldAll = tcgRows.reduce((a, r) => a + r.sold, 0);
const tcgGmvAll = tcgRows.reduce((a, r) => a + r.gmv, 0);
const tcgJson = JSON.stringify(tcgRows);

const tcgTr = tcgRows.map((r) => `<tr${r.isOp ? ' style="background:rgba(16,215,160,.06)"' : ""}><td class="l">${esc(r.name)}${r.isOp ? " <small>this site's subject</small>" : ""}</td><td>${num(r.n)}</td><td>${num(r.sold)}</td><td>${r.rate}% <small style="color:var(--muted)">±${r.ci}</small></td><td>${r.med != null ? usd(r.med) : "—"}</td></tr>`).join("\n");

const faqs = [
  { q: "Where do these auction prices come from?", a: "Every auction is read again after it closed, so the price recorded is the final winning bid — not a mid-auction bid and not an asking price. Auctions that ended without a sale stay in the data as the denominator of sell-through. Where eBay does not report a sold state we store null rather than guessing." },
  { q: "What share of One Piece card auctions actually sell?", a: `Across the last ${aggDays.length} full days${aggNote} we tracked ${num(totN)} One Piece auctions to close and ${num(totSold)} of them sold — about ${st}%. Sealed boxes clear at a far higher rate than single cards${boxK.st != null && cardK.st != null ? ` (${boxK.st}% vs ${cardK.st}% in this window)` : ""}.` },
  { q: "Why can auction prices differ from Buy It Now prices?", a: "An auction records the highest bid reached at a specific closing time, while a fixed-price listing records a seller's ask. Use the auction median as one completed-sale reference, then add shipping and import fees and match the exact card variant before comparing." },
  { q: "Can I download this data?", a: "Yes — the daily aggregates (auctions tracked, sold count, sell-through, median winning bid) are published as a free CSV under CC BY 4.0 on the free data page. Attribution with a link is the only requirement." },
];
const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
const dsLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "One Piece Card Game completed eBay auction results",
  description: `Daily completed-auction outcomes for One Piece Card Game items: auctions tracked to close, how many sold, sell-through rate, median final winning bid and bid counts, split by sealed box, single card and pack. ${num(totN)} auctions tracked in the latest ${aggDays.length} full-day window${aggNote}.`,
  url: `${SITE}/auction.html`, license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-auction-daily.csv` }],
});
const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
  { "@type": "ListItem", position: 2, name: "Auction Data", item: `${SITE}/auction.html` },
] });

const title = "One Piece Card Auction Data — Real eBay Winning Bids & Sell-Through | OP Box Index";
const desc = `Completed eBay auction results for One Piece cards and sealed boxes: ${num(totN)} auctions tracked over ${aggDays.length} full days, ${st}% sell-through, median winning bids per day and per card. Read after close — real sold prices, not asking prices (${DATA_DATE}).`;

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
    <link rel="canonical" href="${SITE}/auction.html" />
    <link rel="alternate" hreflang="en" href="${SITE}/auction.html" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/auction.html" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/auction.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${SITE}/auction.html" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${faqLd}</script>
    <script type="application/ld+json">${dsLd}</script>
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <style>
      /* 수집이 중단된 날은 눈에 띄게 둔다 — 정상일과 같아 보이면 반쪽 하루를 그대로 읽는다. */
      .partialRow { opacity: .62; }
      /* 신선도·불완전 경고는 사이트 전체가 #f5c842 하나를 쓴다(박스차트 stale 배지, 가격 관측일).
         여기만 #f0b84b 였다 — 같은 뜻엔 같은 색(2026-08-26 감사). */
      .pFlag { font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase;
        color: #f5c842; border: 1px solid rgba(245,200,66,.45); border-radius: 5px; padding: 1px 5px; margin-left: 6px; }
      .aucWrap { max-width: 900px; margin: 0 auto; padding: 20px clamp(16px,3vw,28px) 44px; }
      .aucWrap h1 { margin: 6px 0; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .aucWrap .lead { color: var(--muted); font-size: 15px; line-height: 1.65; max-width: 700px; }
      .aucWrap h2 { font-size: 19px; margin: 26px 0 8px; }
      .aucWrap p { color: var(--muted); font-size: 14px; line-height: 1.7; max-width: 720px; margin: 8px 0; }
      .aucWrap p strong { color: var(--ink); }
      .aTable { width: 100%; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .aTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 10.5px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .aTable th.l, .aTable td.l { text-align: left; }
      .aTable td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .aTable td.l small { color: var(--muted); display: block; font-size: 11px; }
      .faqItem { max-width: 720px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 2px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14px; }
      .faqItem p { font-size: 13.5px; margin: 4px 0 10px; }

      /* ── 3초 안에 읽히는 대시보드 ────────────────────────────────
         원칙: 숫자 먼저, 차트 하나만 크게, 설명은 접는다.
         색은 dataviz 검증 통과 6종(+중립). 이름표를 항상 같이 두어
         색만으로 구분하게 하지 않는다. */
      .statRow { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 18px 0 6px; }
      .stat { border: 1px solid var(--line); border-radius: 12px; padding: 14px 16px; background: rgba(255,255,255,.02); }
      .stat b { display: block; font-size: clamp(24px,4.4vw,32px); font-weight: 800; letter-spacing: -.02em; font-variant-numeric: tabular-nums; line-height: 1.1; }
      .stat span { display: block; font-size: 11.5px; color: var(--muted); margin-top: 5px; letter-spacing: .02em; }
      .stat.hi b { color: #14A882; }

      .chartCard { border: 1px solid var(--line); border-radius: 14px; padding: 16px 18px 12px; margin: 18px 0 8px; background: rgba(255,255,255,.015); }
      .chartHead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 4px; }
      .chartHead h2 { margin: 0; font-size: 17px; }
      .chartHead .sub { font-size: 12px; color: var(--muted); margin: 0; }
      /* wrap 필수 — 버튼 5개가 한 줄이면 375px 에서 42px 가로로 넘친다(2026-08-26 모바일 실측) */
      .metricTabs { display: flex; gap: 6px; flex-wrap: wrap; }
      /* min-height 44px — 34px 는 모바일 권장 터치 타겟에 못 미쳐 두 줄로 감긴 버튼 사이 오터치가 났다(2026-08-26 감사) */
      .metricTabs button { border: 1px solid var(--line); background: transparent; color: var(--muted); border-radius: 8px; padding: 6px 12px; font: inherit; font-size: 12.5px; font-weight: 700; cursor: pointer; min-height: 44px; }
      .metricTabs button[aria-pressed="true"] { border-color: #14A882; color: #14A882; background: rgba(20,168,130,.1); }
      .metricTabs button:focus-visible { outline: 2px solid #14A882; outline-offset: 2px; }

      .barList { display: flex; flex-direction: column; gap: 6px; margin: 12px 0 4px; }
      .barRow { display: grid; grid-template-columns: minmax(88px,132px) 1fr minmax(62px,78px); align-items: center; gap: 10px; }
      .barName { font-size: 12.5px; color: var(--muted); text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .barRow.me .barName { color: var(--ink); font-weight: 800; }
      .barTrack { height: 16px; background: rgba(255,255,255,.045); border-radius: 4px; overflow: hidden; }
      .barFill { height: 100%; border-radius: 0 4px 4px 0; transition: width .45s cubic-bezier(.22,.61,.36,1); }
      .barVal { font-size: 12.5px; font-variant-numeric: tabular-nums; color: var(--ink); font-weight: 700; }
      .barRow .ci { color: var(--muted); font-weight: 400; font-size: 11px; }
      .barRow:hover .barName, .barRow:focus-within .barName { color: var(--ink); }

      .legend { display: flex; flex-wrap: wrap; gap: 10px 16px; margin: 10px 0 2px; font-size: 11.5px; color: var(--muted); }
      .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }

      .noteFold { max-width: 760px; margin: 10px 0 0; }
      .noteFold summary { cursor: pointer; font-size: 12.5px; color: var(--muted); padding: 6px 0; }
      .noteFold p { font-size: 12.5px; margin: 4px 0 8px; }
      @media (prefers-reduced-motion: reduce) { .barFill { transition: none; } }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav" aria-label="Primary navigation"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="/cards/" data-ko="카드">Cards</a><a href="auction.html" data-ko="경매">Auctions</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="aucWrap">
      <p class="eyebrow">Auction Data</p>
      <h1>One Piece card auction results — real winning bids</h1>
      <p class="lead">Every auction is read again <strong>after it closes</strong>, so these are settled outcomes — not asking prices. Unsold auctions stay in the denominator.</p>
${tcgRows.length >= 5 ? `
      <div class="statRow">
        <div class="stat hi"><b>${tcgSoldAll ? Math.round((tcgSoldAll / tcgEndedAll) * 100) : "—"}%</b><span>sold across all games</span></div>
        <div class="stat"><b>${num(tcgEndedAll)}</b><span>auctions read after close</span></div>
        <div class="stat"><b>${tcgRows.length}</b><span>card games tracked</span></div>
        <div class="stat"><b>${usd(tcgGmvAll)}</b><span>hammer value · ${tcgDays}d</span></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2>How many card auctions end each day</h2>
            <p class="sub">${tcgFrom}–${tcgTo}</p>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-metric="ending" aria-pressed="true">Auctions ending today</button>
            <button type="button" data-metric="ended" aria-pressed="false">Checked after close</button>
            <button type="button" data-metric="sold" aria-pressed="false">Of those, sold</button>
            <button type="button" data-metric="rate" aria-pressed="false">Sell-through</button>
            <button type="button" data-metric="gmv" aria-pressed="false">Hammer value</button>
          </div>
        </div>
        <div class="barList" id="tcgBars"></div>
        <div class="legend" id="tcgLegend"></div>
        <details class="noteFold">
          <summary>How this is measured</summary>
          <p>Same collector, same window, every game: each auction is re-read after it closes, and auctions that ended unsold stay in the denominator. Sell-through carries a Wilson 95% interval — two games differ only where their intervals do not overlap, so neighbours within a few points are not ranked against each other. Games with fewer than ${TCG_MIN_N} tracked auctions are omitted rather than shown on a thin sample. Hammer value is the sum of winning bids in our tracked sample, not total eBay volume. Colour marks the six most-searched games so they are easy to find; every bar is labelled, so colour is never the only identifier.</p>
          <p>One note on the One Piece bar: this cross-game sampler reads about ${Math.round(tcgEndedAll / tcgRows.length / tcgDays)} auctions per game per day so every game is measured the same way. The dedicated One Piece tracker further down this page reads the whole One Piece board — many times more listings, weighted far more heavily toward cheap singles — so its sell-through is lower. Neither is wrong; they are different samples, and only the bars above are comparable to each other.</p>
        </details>
      </div>
` : ""}
      <h2>Daily results — last ${daily.length} days</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l">Ended</th><th>Auctions tracked</th><th>Sold</th><th>Sell-through</th><th>Median winning bid</th><th>Median bids</th></tr></thead>
        <tbody>
${dTr}
        </tbody>
      </table>
      </div>
      <p class="srcNoteA" style="font-size:12px;color:var(--muted)">Our tracked sample, not an exhaustive census of eBay. Sell-through counts only auctions whose sold/unsold state is confirmed. Prices are final winning bids in USD, per item for multi-item lots.</p>

      <h2>Sealed boxes sell. Singles mostly don't.</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l">Product type</th><th>Auctions</th><th>Sold</th><th>Sell-through</th></tr></thead>
        <tbody>
${kTr}
        </tbody>
      </table>
      </div>
      <p>${boxK.st != null && cardK.st != null ? `Sealed boxes clear at <strong>${boxK.st}%</strong>, single cards at <strong>${cardK.st}%</strong>.` : `Sell-through differs sharply by item type.`} Tracked sample only, ${aggDays.length} full-day window${aggNote}.</p>

${tcgRows.length >= 5 ? `
      <details class="noteFold" style="max-width:none">
        <summary>All ${tcgRows.length} games as a table (median winning bid, sold counts)</summary>
        <div style="overflow-x:auto">
        <table class="aTable">
          <thead><tr><th class="l">Trading card game</th><th>Auctions tracked</th><th>Sold</th><th>Sell-through</th><th>Median winning bid</th></tr></thead>
          <tbody>
${tcgTr}
          </tbody>
        </table>
        </div>
        <p class="srcNoteA" style="font-size:12px;color:var(--muted)">A median winning bid is shown only where at least ${TCG_MIN_PRICE_N} sales cleared $1 — penny-start bulk lots otherwise drag a median to a meaningless figure.</p>
      </details>

      <h2>Highest auction medians by card</h2>`
: `      <h2>Highest auction medians by card</h2>`}
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th>#</th><th class="l">Card</th><th>Median winning bid</th><th>Range</th><th>Sell-through</th><th>Sales</th></tr></thead>
        <tbody>
${cTr}
        </tbody>
      </table>
      </div>
      <p class="srcNoteA" style="font-size:12px;color:var(--muted)">Rolling window, minimum 3 confirmed sales per card. Cards below that bar are omitted rather than shown on thin samples. Ranges are 25th–75th percentile of confirmed sales.</p>

      <details class="noteFold">
        <summary>How to use this data · where the rest of the site is</summary>
        <p>Compare an auction median with recent fixed-price sales and current asking prices; none is a complete market on its own. A large gap is a reason to check sample size, exact variant, condition, shipping and closing time before drawing a conclusion.${last ? ` On the latest full day (${esc(last.d)}) we tracked ${num(last.n)} auctions ending, of which ${num(last.sold)} sold.` : ""}</p>
        <p>Card NM and PSA 10 prices: <a href="cards/">card price pages</a> · <a href="psa10-ranking.html">PSA 10 value ranking</a>. Sealed-box context: <a href="sets/index.html">set guides</a>. Grading supply: <a href="psa-grading.html">population page</a>. Daily aggregates: <a href="free-data.html">free CSV (CC BY 4.0)</a>.</p>
      </details>

      <h2>Auction data — common questions</h2>
      ${faqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n      ")}
      <p class="srcNoteA" style="font-size:11px;color:var(--muted);margin-top:16px">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this site, at no extra cost to you. Data is research reference, not investment advice.</p>
    </main>
${tcgRows.length >= 5 ? `    <script>
      // 게임별 낙찰률/거래액/물량 막대. dataviz 검증 통과 6색(+중립) — 색은 익숙한 게임을
      // 눈으로 찾게 하는 보조수단이고, 모든 막대에 이름표가 붙어 색만으로 구분하지 않는다.
      (function () {
        var rows = ${tcgJson};
        var el = document.getElementById("tcgBars");
        var lg = document.getElementById("tcgLegend");
        if (!el || !rows.length) return;
        var HUE = { onepiece: "#14A882", pokemon: "#3987e5", pokemonjp: "#d95926", magic: "#9085e9", yugioh: "#c98500", lorcana: "#d55181" };
        var GREY = "#5A6273";
        var M = {
          ending: { get: function (r) { return r.ending; }, fmt: function (r) { return r.ending.toLocaleString("en-US") + " ending today"; } },
          sold: { get: function (r) { return r.sold; }, fmt: function (r) { return r.sold.toLocaleString("en-US") + " won"; } },
          ended: { get: function (r) { return r.n; }, fmt: function (r) { return r.n.toLocaleString("en-US") + " checked"; } },
          rate: { get: function (r) { return r.rate; }, fmt: function (r) { return r.rate + "%"; }, ci: true },
          gmv: { get: function (r) { return r.gmv; }, fmt: function (r) { return "$" + r.gmv.toLocaleString("en-US"); } }
        };
        function draw(key) {
          var m = M[key];
          var list = rows.slice().sort(function (a, b) { return m.get(b) - m.get(a); });
          var max = m.get(list[0]) || 1;
          el.innerHTML = list.map(function (r) {
            var c = HUE[r.key] || GREY;
            var w = Math.max(1.5, (m.get(r) / max) * 100);
            var ci = m.ci && r.ci != null ? ' <span class="ci">±' + r.ci + "</span>" : "";
            return '<div class="barRow' + (r.isOp ? " me" : "") + '">' +
              '<div class="barName" title="' + r.name + '">' + r.name + "</div>" +
              '<div class="barTrack"><div class="barFill" style="width:0;background:' + c + '" data-w="' + w.toFixed(1) + '"></div></div>' +
              '<div class="barVal">' + m.fmt(r) + ci + "</div></div>";
          }).join("");
          // 강제 리플로우로 0 → 최종값 전이를 만든다. requestAnimationFrame 을 쓰면
          // 화면에 안 뜬 탭(백그라운드/비합성)에서 콜백이 영영 안 돌아 막대가 0 인 채로 남는다.
          // 동기 처리라 애니메이션이 없어도 너비는 항상 맞다.
          void el.offsetWidth;
          Array.prototype.forEach.call(el.querySelectorAll(".barFill"), function (b) { b.style.width = b.getAttribute("data-w") + "%"; });
        }
        if (lg) {
          lg.innerHTML = Object.keys(HUE).map(function (k) {
            var r = rows.filter(function (x) { return x.key === k; })[0];
            return r ? '<span><i style="background:' + HUE[k] + '"></i>' + r.name + "</span>" : "";
          }).join("") + '<span><i style="background:' + GREY + '"></i>All other games</span>';
        }
        var tabs = document.querySelectorAll(".metricTabs button");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            draw(b.getAttribute("data-metric"));
          });
        });
        draw("ending");
      })();
    </script>
` : ""}    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Free data (CSV)</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

fs.writeFileSync(path.join(ROOT, "auction.html"), html, "utf8");

// 사이트맵: 추가만(제거 금지 — 소유자 절대 지시)
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/auction.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    fs.writeFileSync(smPath, sm, "utf8");
    added = 1;
  }
  console.log(JSON.stringify({ wrote: "auction.html", days: daily.length, tracked: totN, sellThrough: st + "%", topCards: topCards.length, sitemapAdded: added }));
}
