// auction.html (영어, 루트) — 원피스 이베이 경매 "실낙찰" 데이터 페이지.
// 소유자 우선순위(2026-08-01): 해외(영어) 유저 유입이 1순위. 경매 데이터셋은 우리만 가진 자산인데
// 영어 지면이 없었다 — "one piece card auction results / ebay sold prices / sell-through" 검색 정조준.
// 원칙: 값은 전부 auction-sold.json / auction-card-stats.json 에서 파생. 추정 금지, 없으면 비움.
// 기존 페이지의 노출 상태(canonical/robots/사이트맵 항목)는 건드리지 않는다 — 추가만 한다.
// Run: node tools/generate-auction-page.js
const fs = require("fs");
const { navHtml } = require("./site-nav");
const { readRecent } = require("./auction-archive");
const { summarizeKinds } = require("./auction-aggregate");
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
// 합산(헤드라인 통계·유형별·FAQ·Dataset)은 **전 기간의 완전 수집일**을 쓴다 — 2026-09-01.
// 종전에는 최근 10일 중 완전일만 썼는데, 밀봉 박스가 하루 1~2건이라 표본이 45건까지 얇아졌고
// 그 값(71.1%)이 전 기간 245건의 81.2% 와 10%p 어긋났다. 며칠 치우치면 대표값이 통째로 흔들린다.
// 부분수집일은 여전히 뺀다 — 실측이지만 덜 센 날이라 섞으면 건수는 줄고 비율은 치우친다.
// 일별 표(최근 10일)와 시계열 그래프(전 기간)는 추이를 보는 것이라 창이 다르다. 각 섹션에 기간을 적는다.
const allDays = (auc.daily || []).filter((x) => x.d < TODAY_ISO);
const fullAll = allDays.filter((x) => !PARTIAL_DAYS.has(x.d));
const aggDays = fullAll.length >= 3 ? fullAll : allDays;   // 완전일이 너무 적으면 전체로 폴백(라벨은 그대로 정직하게)
const aggNote = fullAll.length >= 3 && fullAll.length < allDays.length ? ` (${allDays.length - fullAll.length} partial day${allDays.length - fullAll.length > 1 ? "s" : ""} excluded)` : "";
const aggFrom = aggDays.length ? aggDays[0].d : null;
const aggTo = aggDays.length ? aggDays[aggDays.length - 1].d : null;
const totN = aggDays.reduce((t, x) => t + x.n, 0);
const totSold = aggDays.reduce((t, x) => t + x.sold, 0);
const st = totN ? Math.round((totSold / totN) * 100) : 0;

// ── 그래프용 데이터 ─────────────────────────────────────────────
// 표는 최근 10일이지만 그래프는 전 기간을 그린다. 추이는 길게 봐야 보인다.
// partial 일자는 값을 지우지 않고 흐리게 그린다 — 덜 센 날이지 틀린 날이 아니다.
// 거래액만 auction-series.json 에 있어 날짜로 붙인다(같은 원장에서 나온 두 파생파일).
const amtByDay = {};
for (const r of aucSeries.daily || []) if (r && r.d) amtByDay[r.d] = Math.round(r.amount || 0);
const chartDays = (auc.daily || []).filter((x) => x.d < TODAY_ISO).map((x) => ({
  d: x.d,
  p: PARTIAL_DAYS.has(x.d) ? 1 : 0,
  ended: x.n || 0,
  sold: x.sold || 0,
  rate: x.sellThrough == null ? null : x.sellThrough,
  gmv: amtByDay[x.d] == null ? null : amtByDay[x.d],
  med: x.medPrice == null ? null : x.medPrice,
}));
const chartJson = JSON.stringify(chartDays);

// 유형별 — 원피스 페이지에만 있는 축이다(TCG 페이지는 게임별로 넓게 본다).
//
// 값은 원장(data/auction-archive/)에서 직접 낸다. 일별 집계의 중앙값을 다시 중앙값 내면
// 안 되기 때문이다 — 박스는 하루 1~2건이라 '그날의 중앙값'이 사실상 한 건이고, 그것들을
// 다시 중앙값 내면 분포와 상관없는 수가 나온다. 2026-09-01 실측으로 팩 $5.58(실제 $6.00),
// 박스 $399(실제 $445)가 그렇게 만들어져 있었다. 41일치 원장 읽기는 150ms 라 부담이 없다.
const kindSummary = summarizeKinds(readRecent(400), aggDays.map((x) => x.d));

const KIND_MIN = 25;        // 낙찰률을 말하려면 이만큼은 확인했어야 한다
const KIND_PRICE_MIN = 12;  // 중앙 낙찰가를 말하려면 낙찰 건수가 이만큼
const KIND_LABEL = { box: "Sealed box", carton: "Sealed case", pack: "Booster pack", card: "Single card" };
const kindRows = Object.entries(kindSummary)
  .map(([k, v]) => ({
    key: k,
    name: KIND_LABEL[k] || k,
    n: v.n,
    sold: v.sold,
    rate: v.n >= KIND_MIN ? v.sellThrough : null,
    med: v.priceN >= KIND_PRICE_MIN ? v.med : null,
    medN: v.priceN,
    // 판별 중앙가 — 박스는 일본판과 영문판이 4배 가까이 차이나서, 하나로 합치면 어느 쪽도 아닌 수가 된다.
    jp: v.byEd.jp.priceN >= KIND_PRICE_MIN ? v.byEd.jp.med : null,
    en: v.byEd.en.priceN >= KIND_PRICE_MIN ? v.byEd.en.med : null,
    jpN: v.byEd.jp.priceN,
    enN: v.byEd.en.priceN,
  }))
  .filter((r) => r.n > 0)
  .sort((a, b) => b.n - a.n);
const kindJson = JSON.stringify(kindRows);
// 표와 그래프는 같은 원본(kindSummary)을 쓴다 — 갈라지면 같은 페이지에서 숫자가 어긋난다.
const kinds = ["card", "box", "pack"].map((k) => {
  const v = kindSummary[k] || { n: 0, sold: 0, sellThrough: null };
  return { k, n: v.n, sold: v.sold, st: v.n >= KIND_MIN ? Math.round(v.sellThrough) : null };
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
// 이 페이지는 원피스 전용이다. TCG 집계는 tcg-auction.html 이 한다.
// 여기서 필요한 건 "같은 수집으로 몇 개 게임을 보는가" 하나뿐이라, 그 숫자만 읽는다.
let tcgGameCount = 0;
try {
  const tSeries = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-series.json"), "utf8"));
  tcgGameCount = Object.keys(tSeries.games || {}).length;
} catch { tcgGameCount = 0; }


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
      .chartHead { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; justify-content: space-between; }
      .chartHead h2 { margin: 0 0 2px; }
      .chartHead .sub { margin: 0; color: var(--muted); font-size: 12.5px; }
      .metricTabs { display: flex; flex-wrap: wrap; gap: 4px; }
      .metricTabs button { font: inherit; font-size: 12px; padding: 5px 10px; border-radius: 999px; cursor: pointer;
        border: 1px solid var(--line); background: transparent; color: var(--muted); }
      .metricTabs button[aria-pressed="true"] { background: rgba(80,218,217,.14); border-color: rgba(80,218,217,.5); color: #bff3f2; }
      .metricTabs button:focus-visible { outline: 2px solid #50dad9; outline-offset: 2px; }
      /* 일별 막대 — 한 번에 한 지표만 그린다. 축이 둘인 그래프는 만들지 않는다. */
      .opChart { position: relative; margin-top: 14px; }
      .opBars { display: flex; align-items: flex-end; gap: 2px; height: 190px; padding: 0 0 2px; }
      .opCol { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
      .opCol i { display: block; background: #50dad9; border-radius: 4px 4px 0 0; min-height: 2px; transition: background .12s; }
      .opCol.pt i { background: rgba(80,218,217,.34); }
      .opCol.nul i { background: repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 3px, transparent 3px 6px); border-radius: 4px; }
      .opCol:hover i, .opCol:focus-visible i { background: #8af3f2; }
      .opAxis { display: flex; justify-content: space-between; margin-top: 6px; color: var(--muted); font-size: 11px; }
      .opTip { position: absolute; z-index: 5; pointer-events: none; background: #10141b; border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px; padding: 7px 10px; font-size: 12px; line-height: 1.5; white-space: nowrap; box-shadow: 0 6px 20px rgba(0,0,0,.5); opacity: 0; transition: opacity .1s; }
      .opTip b { color: #eef2ff; }
      .opTip em { color: #ffca6e; font-style: normal; }
      /* 유형별 가로 막대 — 이름표를 항상 붙여 색만으로 구분하지 않는다. */
      .kindList { margin-top: 12px; display: grid; gap: 9px; }
      .kindRow { display: grid; grid-template-columns: 116px 1fr 104px; gap: 10px; align-items: center; font-size: 13px; }
      .kindRow .kName { color: #eef2ff; font-weight: 600; }
      .kindRow .kTrack { position: relative; height: 20px; border-radius: 5px; background: rgba(255,255,255,.05); overflow: hidden; }
      .kindRow .kFill { position: absolute; inset: 0 auto 0 0; border-radius: 5px; background: #50dad9; }
      .kindRow .kVal { position: absolute; left: 8px; top: 0; line-height: 20px; font-size: 11.5px; color: #04222a; font-weight: 700; }
      .kindRow .kVal.out { color: var(--muted); }
      .kindRow .kMed { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; }
      .kindRow .kMed b { color: #eef2ff; }
      .kindRow .kEd { display: block; font-size: 12px; line-height: 1.45; }
      .kindRow .kEdTag { color: #7d8698; font-size: 10px; letter-spacing: .06em; margin-right: 5px; }
      @media (max-width: 560px) { .kindRow { grid-template-columns: 88px 1fr 92px; font-size: 12px; } .opBars { height: 150px; } }
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
      ${navHtml("", "auction.html")}
    </header>
    <main id="main-content" class="aucWrap">
      <p class="eyebrow">Auction Data</p>
      <h1>One Piece card auction results — real winning bids</h1>
      <p class="lead">Every auction is read again <strong>after it closes</strong>, so these are settled outcomes — not asking prices. Unsold auctions stay in the denominator.</p>
      <p class="priceNote">Totals and product-type rates below cover <strong>${esc(aggFrom)} to ${esc(aggTo)}</strong> — ${aggDays.length} days when collection ran start to finish${aggNote ? ", with partial days left out of the totals" : ""}.</p>
      <div class="statRow">
        <div class="stat hi"><b>${totN ? Math.round((totSold / totN) * 100) : "—"}%</b><span>sold${aggNote}</span></div>
        <div class="stat"><b>${num(totN)}</b><span>One Piece auctions settled</span></div>
        <div class="stat"><b>${num(totSold)}</b><span>found a buyer</span></div>
        <div class="stat"><b>${num(totN - totSold)}</b><span>passed unsold</span></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2>One Piece auctions, day by day</h2>
            <p class="sub">${chartDays.length ? esc(chartDays[0].d) + "–" + esc(chartDays[chartDays.length - 1].d) : ""} · faded bars are days when collection was interrupted</p>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-m="rate" aria-pressed="true">Sell-through</button>
            <button type="button" data-m="ended" aria-pressed="false">Auctions ended</button>
            <button type="button" data-m="sold" aria-pressed="false">Sold</button>
            <button type="button" data-m="gmv" aria-pressed="false">Hammer value</button>
            <button type="button" data-m="med" aria-pressed="false">Median winning bid</button>
          </div>
        </div>
        <div class="opChart" id="opDailyChart"></div>
      </div>

${kindRows.length >= 2 ? `      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2>What sells, by what it is</h2>
            <p class="sub">Same window as the totals above: ${esc(aggFrom)}–${esc(aggTo)}. Bars show the share that sold. Median winning bids are split by edition — Japanese and English boxes trade four times apart, so a combined figure would be neither. Types under ${KIND_MIN} auctions get a count instead of a rate; prices need ${KIND_PRICE_MIN} sales.</p>
          </div>
        </div>
        <div class="kindList" id="opKindChart"></div>
      </div>` : ""}

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

${tcgGameCount >= 5 ? `
      <p class="priceNote">This page is One Piece only. The same settlement run covers ${tcgGameCount} card games — see <a href="tcg-auction.html">TCG auction data</a> for the cross-game table.</p>
` : ""}
      <h2>Highest auction medians by card</h2>
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

      <p class="srcNoteA" style="font-size:11px;color:var(--muted);margin-top:16px">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this site, at no extra cost to you. Data is research reference, not investment advice.</p>
    </main>
    <script>
      // 일별 막대 — 지표 탭으로 한 번에 하나만 그린다.
      // 축이 둘인 그래프(낙찰률과 건수를 한 판에)는 만들지 않는다. 눈금이 서로를 속인다.
      (function () {
        var days = ${chartJson};
        var host = document.getElementById("opDailyChart");
        if (!host || !days.length) return;
        var M = {
          rate: { label: "Sell-through", fmt: function (v) { return v.toFixed(1) + "%"; }, floor10: true },
          ended: { label: "Auctions ended", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); } },
          sold: { label: "Sold", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); } },
          gmv: { label: "Hammer value", fmt: function (v) { return "$" + Math.round(v).toLocaleString("en-US"); } },
          med: { label: "Median winning bid", fmt: function (v) { return "$" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")); } }
        };
        var bars = document.createElement("div"); bars.className = "opBars";
        var axis = document.createElement("div"); axis.className = "opAxis";
        var tip = document.createElement("div"); tip.className = "opTip";
        host.appendChild(bars); host.appendChild(axis); host.appendChild(tip);
        var cols = days.map(function (r) {
          var c = document.createElement("div");
          c.className = "opCol" + (r.p ? " pt" : "");
          c.tabIndex = 0;
          c.appendChild(document.createElement("i"));
          bars.appendChild(c);
          return c;
        });
        var short = function (d) { return d.slice(5).replace("-", "/"); };
        axis.innerHTML = "<span>" + short(days[0].d) + "</span><span>" + short(days[days.length - 1].d) + "</span>";
        var metric = "rate";
        function draw() {
          var m = M[metric];
          var vals = days.map(function (r) { return r[metric]; }).filter(function (v) { return v != null && isFinite(v); });
          var top = vals.length ? Math.max.apply(null, vals) : 0;
          if (m.floor10) top = Math.max(top, 10);
          days.forEach(function (r, i) {
            var v = r[metric];
            var c = cols[i];
            var bar = c.firstChild;
            if (v == null || !isFinite(v)) {
              c.classList.add("nul");
              bar.style.height = "100%";
              c.setAttribute("aria-label", r.d + " — not measured");
            } else {
              c.classList.remove("nul");
              bar.style.height = Math.max(2, Math.round((v / (top || 1)) * 100)) + "%";
              c.setAttribute("aria-label", r.d + " — " + m.label + " " + m.fmt(v) + (r.p ? " (partial day)" : ""));
            }
          });
        }
        function showTip(i) {
          var r = days[i];
          var lines = ["<b>" + r.d + "</b>"];
          if (r.p) lines.push("<em>collection interrupted</em>");
          lines.push(r.rate == null ? "Sell-through — not measured" : "Sell-through <b>" + r.rate.toFixed(1) + "%</b>");
          lines.push("Ended <b>" + r.ended.toLocaleString("en-US") + "</b> · sold <b>" + r.sold.toLocaleString("en-US") + "</b>");
          if (r.gmv != null) lines.push("Hammer <b>$" + r.gmv.toLocaleString("en-US") + "</b>");
          if (r.med != null) lines.push("Median bid <b>$" + (r.med < 100 ? r.med.toFixed(2) : Math.round(r.med).toLocaleString("en-US")) + "</b>");
          tip.innerHTML = lines.join("<br>");
          tip.style.opacity = "1";
          var hb = host.getBoundingClientRect();
          var cb = cols[i].getBoundingClientRect();
          var x = cb.left - hb.left + cb.width / 2 - tip.offsetWidth / 2;
          tip.style.left = Math.max(0, Math.min(x, hb.width - tip.offsetWidth)) + "px";
          tip.style.top = Math.max(0, cb.top - hb.top - tip.offsetHeight - 8) + "px";
        }
        cols.forEach(function (c, i) {
          c.addEventListener("mouseenter", function () { showTip(i); });
          c.addEventListener("focus", function () { showTip(i); });
          c.addEventListener("blur", function () { tip.style.opacity = "0"; });
        });
        bars.addEventListener("mouseleave", function () { tip.style.opacity = "0"; });
        var tabs = document.querySelectorAll(".metricTabs button[data-m]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            metric = b.getAttribute("data-m");
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            draw();
          });
        });
        draw();
      })();

      // 유형별 가로 막대. 표본이 얇아 비율이 없는 유형은 막대 대신 건수만 적는다.
      // 중앙 낙찰가는 판(JP/EN)을 나눠 적는다 — 박스는 일본판 $104 / 영문판 $430 로 4배 넘게
      // 차이나서, 하나로 합친 값은 어느 쪽 시세도 아니다.
      // 문자열로 innerHTML 을 조립하지 않는다 — 따옴표가 템플릿 리터럴을 거치며 풀려 깨진다.
      (function () {
        var rows = ${kindJson};
        var host = document.getElementById("opKindChart");
        if (!host || !rows.length) return;
        var money = function (v) { return "$" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")); };
        var cell = function (cls, text) {
          var el = document.createElement("span");
          el.className = cls;
          if (text != null) el.textContent = text;
          return el;
        };
        rows.forEach(function (r) {
          var pct = r.rate == null ? 0 : r.rate;
          var wide = pct >= 22;
          var val = r.rate == null ? "too few (" + r.n.toLocaleString("en-US") + ")" : r.rate.toFixed(1) + "%";

          var row = document.createElement("div"); row.className = "kindRow";
          row.appendChild(cell("kName", r.name));

          var track = cell("kTrack", null);
          track.setAttribute("role", "img");
          track.setAttribute("aria-label", r.name + ": " + val + " of " + r.n.toLocaleString("en-US") + " auctions sold");
          if (r.rate != null) {
            var fill = cell("kFill", null);
            fill.style.width = pct + "%";
            track.appendChild(fill);
          }
          var label = cell("kVal" + (wide ? "" : " out"), val);
          if (!wide) label.style.left = (pct + 2) + "%";
          track.appendChild(label);
          row.appendChild(track);

          // 중앙 낙찰가 — 판이 갈리면 둘 다, 한쪽만 표본이 되면 그쪽만, 둘 다 얇으면 전체값.
          var med = cell("kMed", null);
          if (r.jp != null || r.en != null) {
            if (r.jp != null) {
              var a = cell("kEd", null);
              a.appendChild(cell("kEdTag", "JP"));
              var ab = document.createElement("b"); ab.textContent = money(r.jp); a.appendChild(ab);
              med.appendChild(a);
            }
            if (r.en != null) {
              var b = cell("kEd", null);
              b.appendChild(cell("kEdTag", "EN"));
              var bb = document.createElement("b"); bb.textContent = money(r.en); b.appendChild(bb);
              med.appendChild(b);
            }
          } else if (r.med != null) {
            var c = document.createElement("b"); c.textContent = money(r.med);
            med.appendChild(c);
          } else {
            med.textContent = "\u2014";
          }
          row.appendChild(med);
          host.appendChild(row);
        });
      })();
    </script>

    <footer class="footer">
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
