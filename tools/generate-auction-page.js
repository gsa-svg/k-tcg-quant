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
const aggNoteKo = fullAll.length >= 3 && fullAll.length < allDays.length ? ` (부분수집 ${allDays.length - fullAll.length}일 제외)` : "";
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

// ── 주별·월별 — 2026-09-02 소유자 제안("일자가 쌓이면 많아질 텐데 일봉·주봉·월봉").
// 일별 42개 막대가 석 달이면 90개가 된다. 기간을 접어 보는 축을 추가한다.
// 값은 **원장에서 직접** 만든다 — 일별 값을 다시 평균/중앙값 내면 안 된다는 원칙 그대로.
// (중앙값은 그 기간의 낙찰 건 전체를 한 줄로 세워 자른 값. 낙찰률 분모는 확정 건만.)
const chartLedger = readRecent(400);
function bucketRows(keyOf, labelOf, axOf) {
  const buckets = new Map();
  for (const r of chartLedger) {
    if (!r || !r.d || r.d >= TODAY_ISO) continue;
    const k = keyOf(r.d);
    if (!buckets.has(k)) buckets.set(k, { rows: [], hasPartial: false, lastDay: r.d });
    const b = buckets.get(k);
    b.rows.push(r);
    if (PARTIAL_DAYS.has(r.d)) b.hasPartial = true;
    if (r.d > b.lastDay) b.lastDay = r.d;
  }
  const perUnit = (r) => ("qty" in r ? r.unitPrice : r.price);
  const q = (arr) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };
  const lastKey = [...buckets.keys()].sort().pop();
  return [...buckets.entries()].sort((x, y) => x[0].localeCompare(y[0])).map(([k, b]) => {
    const decided = b.rows.filter((r) => r.sold !== null);
    const soldRows = b.rows.filter((r) => r.sold === true);
    const prices = soldRows.map(perUnit).filter((v) => Number.isFinite(v));
    return {
      d: labelOf(k), ax: axOf(k),
      // 흐림 처리: 부분수집일이 끼었거나, 아직 다 차지 않은 마지막 기간.
      p: b.hasPartial || k === lastKey ? 1 : 0,
      ended: b.rows.length,
      sold: soldRows.length,
      rate: decided.length ? Number(((decided.filter((r) => r.sold).length / decided.length) * 100).toFixed(1)) : null,
      gmv: Math.round(soldRows.reduce((t, r) => t + (Number.isFinite(r.price) ? r.price : 0), 0)),
      med: prices.length >= 5 ? q(prices) : null,
    };
  });
}
const weekKey = (d) => { const t = new Date(d + "T00:00:00Z"); const dow = (t.getUTCDay() + 6) % 7; t.setUTCDate(t.getUTCDate() - dow); return t.toISOString().slice(0, 10); };
const weeklyRows = bucketRows(weekKey, (k) => "Week of " + k.slice(5).replace("-", "/"), (k) => k.slice(5).replace("-", "/"));
const monthlyRows = bucketRows((d) => d.slice(0, 7), (k) => k, (k) => k.slice(2));
// 일별에도 축 라벨을 같은 형태로 붙인다.
for (const r of chartDays) r.ax = r.d.slice(5).replace("-", "/");
const chartSeriesJson = JSON.stringify({ daily: chartDays, weekly: weeklyRows, monthly: monthlyRows });

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
const KIND_LABEL_KO = { box: "밀봉 박스", carton: "밀봉 케이스", pack: "부스터 팩", card: "싱글 카드" };
const kindRows = Object.entries(kindSummary)
  .map(([k, v]) => ({
    key: k,
    name: KIND_LABEL[k] || k,
    nameKo: KIND_LABEL_KO[k] || k,
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
// 카드 순위는 두 축으로 본다 — 2026-09-02 소유자 제안("판매건수 순위로도").
// 중앙 낙찰가 상위 = 비싼 카드, 판매 건수 상위 = 많이 도는 카드. 서로 다른 목록이다.
const allCards = Object.entries(cardStats.cards || {})
  .map(([id, c]) => ({ id, ...c, name: nameOf(c.set, id) }));
const topCards = allCards.slice().sort((a, b) => b.medPrice - a.medPrice).slice(0, 12);
const cardsBySales = allCards.slice().sort((a, b) => b.sold - a.sold || b.medPrice - a.medPrice).slice(0, 12);
const cardRow = (c) => ({ id: c.id, set: c.set, name: c.name || c.id, med: c.medPrice ?? null, low: c.low ?? null, high: c.high ?? null, st: c.sellThrough ?? null, sold: c.sold });
const cardRankJson = JSON.stringify({ med: topCards.map(cardRow), sales: cardsBySales.map(cardRow) });

const dTr = daily.map((x) => `<tr${PARTIAL_DAYS.has(x.d) ? ' class="partialRow"' : ""}><td class="l">${esc(x.d)}${PARTIAL_DAYS.has(x.d) ? ' <span class="pFlag" data-ko="부분수집" title="Collection was interrupted that day — treat this row as incomplete">partial</span>' : ""}</td><td>${num(x.n)}</td><td>${num(x.sold)}</td><td>${x.sellThrough != null ? x.sellThrough + "%" : "—"}</td><td>${x.medPrice != null ? usd(x.medPrice) : "—"}</td><td>${x.medBids != null ? num(x.medBids) : "—"}</td></tr>`).join("\n");
const cTr = topCards.map((c, i) => `<tr><td>${i + 1}</td><td class="l">${esc(c.name || c.id)}<small>${esc(c.id)} · ${esc(c.set)}</small></td><td>${usd(c.medPrice)}</td><td>${c.low != null && c.high != null ? `${usd(c.low)}–${usd(c.high)}` : "—"}</td><td>${c.sellThrough != null ? c.sellThrough + "%" : "—"}</td><td>${num(c.sold)}</td></tr>`).join("\n");
const kTr = kinds.filter((k) => k.n).map((k) => `<tr><td class="l" data-ko="${k.k === "card" ? "싱글 카드" : k.k === "box" ? "밀봉 부스터 박스" : "밀봉 부스터 팩"}">${k.k === "card" ? "Single cards" : k.k === "box" ? "Sealed booster boxes" : "Sealed packs"}</td><td>${num(k.n)}</td><td>${num(k.sold)}</td><td>${k.st}%</td></tr>`).join("\n");

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

const title = "One Piece Card Auction Data — Real eBay Winning Bids and How Often Cards Sell | OP Box Index";
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
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
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
      /* 그래프 위 한 줄 — 눈금 없이 막대만 보면 높이가 얼마인지 알 수 없다. */
      /* 한 문장 요약 — 그래프를 못 읽어도 이것만 읽으면 뜻이 통해야 한다.
         본문보다 크게 잡는다(17px). 2026-09-02 소유자 지시로 가독성이 이 페이지의 1순위다. */
      .opPlain { margin: 14px 0 2px; font-size: 17px; line-height: 1.55; color: #eef2ff; }
      .opPlain strong { color: #8af3f2; font-weight: 650; }
      .opPlain .opHelp { display: block; margin-top: 4px; font-size: 13.5px; color: var(--muted); }
      @media (max-width: 560px) { .opPlain { font-size: 15.5px; } .opPlain .opHelp { font-size: 12.5px; } }
      .opReadout { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 14px 0 8px; font-size: 12.5px; color: var(--muted); }
      .opReadout b { color: #eef2ff; font-variant-numeric: tabular-nums; }
      .opReadout .hi b { color: #50dad9; }
      .opChart { position: relative; margin-top: 6px; }
      /* 최고값 기준선 — 막대가 어디까지 차면 최고인지 눈으로 잡아준다. */
      .opBars { position: relative; }
      /* 눈금선 3줄(0·절반·최고) — 막대 높이를 값으로 읽으려면 기준선이 있어야 한다. */
      .opGuide { position: absolute; inset: 0; pointer-events: none; }
      .opGuide .gLine { position: absolute; left: 0; right: 0; display: block; border-top: 1px dashed rgba(255,255,255,.16); }
      .opGuide .gLine span { position: absolute; right: 0; top: -15px; font-size: 11px; color: #8d95a7;
        background: #0a0c10; padding: 0 4px; font-variant-numeric: tabular-nums; }
      .opBars { display: flex; align-items: flex-end; gap: 2px; height: 190px; padding: 0 0 2px; }
      .opCol { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; justify-content: flex-end; height: 100%; }
      .opCol i { display: block; background: #50dad9; border-radius: 4px 4px 0 0; min-height: 2px; transition: background .12s; }
      .opCol.pt i { background: rgba(80,218,217,.34); }
      .opCol.nul i { background: repeating-linear-gradient(45deg, rgba(255,255,255,.10) 0 3px, transparent 3px 6px); border-radius: 4px; }
      .opCol:hover i, .opCol:focus-visible i, .opCol.on i { background: #8af3f2; }
      .opAxis { display: flex; justify-content: space-between; margin-top: 6px; color: var(--muted); font-size: 11px; }
      .opTip { position: absolute; z-index: 5; pointer-events: none; background: #10141b; border: 1px solid rgba(255,255,255,.16);
        border-radius: 9px; padding: 7px 10px; font-size: 12px; line-height: 1.5; box-shadow: 0 6px 20px rgba(0,0,0,.5); opacity: 0; transition: opacity .1s; max-width: min(240px, 88vw); }
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
      /* narrow screens: 툴팁이 차트를 덮으므로 숨기고, 위 읽는 줄이 그 역할을 한다. */
      @media (max-width: 560px) { .opTip { display: none; } .opReadout { font-size: 12px; gap: 4px 12px; min-height: 34px; } }
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
      <p class="eyebrow" data-ko="경매 데이터">Auction Data</p>
      <h1 data-ko="원피스 카드 경매 결과 — 실제 낙찰가">One Piece card auction results — real winning bids</h1>
      <div class="statRow">
        <div class="stat hi"><b>${totN ? Math.round((totSold / totN) * 100) : "—"}%</b><span data-ko="낙찰${aggNoteKo}">sold${aggNote}</span></div>
        <div class="stat"><b>${num(totN)}</b><span data-ko="확인한 경매">auctions checked</span></div>
        <div class="stat"><b>${num(totSold)}</b><span data-ko="낙찰">sold</span></div>
        <div class="stat"><b>${num(totN - totSold)}</b><span data-ko="유찰">unsold</span></div>
      </div>

      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2 data-ko="원피스 경매, 날짜별">One Piece auctions, day by day</h2>
            <p class="sub" data-ko="${chartDays.length ? esc(chartDays[0].d) + " ~ " + esc(chartDays[chartDays.length - 1].d) : ""} · 흐린 막대는 그날 경매를 다 확인하지 못했다는 뜻입니다.">${chartDays.length ? esc(chartDays[0].d) + "–" + esc(chartDays[chartDays.length - 1].d) : ""} · A faded bar means we could not check every auction that day.</p>
          </div>
          <div class="metricTabs periodTabs" role="group" aria-label="Period">
            <button type="button" data-p="daily" aria-pressed="true" data-ko="일별">Daily</button>
            <button type="button" data-p="weekly" aria-pressed="false" data-ko="주별">Weekly</button>
            <button type="button" data-p="monthly" aria-pressed="false" data-ko="월별">Monthly</button>
          </div>
          <div class="metricTabs" role="group" aria-label="Metric">
            <button type="button" data-m="rate" aria-pressed="true" data-ko="낙찰률">Sold %</button>
            <button type="button" data-m="ended" aria-pressed="false" data-ko="종료 수">Ended</button>
            <button type="button" data-m="sold" aria-pressed="false" data-ko="낙찰 수">Sold</button>
            <button type="button" data-m="gmv" aria-pressed="false" data-ko="거래액">Total spent</button>
            <button type="button" data-m="med" aria-pressed="false" data-ko="낙찰가">Price</button>
          </div>
        </div>
        <div class="opPlain" id="opPlain" aria-live="polite"></div>
        <div class="opReadout" id="opReadout" aria-live="polite"></div>
        <div class="opChart" id="opDailyChart"></div>
      </div>

${kindRows.length >= 2 ? `      <div class="chartCard">
        <div class="chartHead">
          <div>
            <h2 data-ko="무엇이 팔리는가 — 상품 종류별">What sells, by what it is</h2>
            <p class="sub" data-ko="${esc(aggFrom)} ~ ${esc(aggTo)}">${esc(aggFrom)}–${esc(aggTo)}</p>
          </div>
        </div>
        <div class="kindList" id="opKindChart"></div>
      </div>` : ""}

      <h2 data-ko="일별 결과 — 최근 ${daily.length}일">Daily results — last ${daily.length} days</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l" data-ko="날짜">Date</th><th data-ko="경매 수">Auctions</th><th data-ko="낙찰 수">Sold</th><th data-ko="낙찰률">Sold %</th><th data-ko="낙찰가">Price</th><th data-ko="입찰수">Bids</th></tr></thead>
        <tbody>
${dTr}
        </tbody>
      </table>
      </div>

      <h2 data-ko="밀봉 박스는 팔린다. 싱글은 대개 안 팔린다.">Sealed boxes sell. Singles mostly don't.</h2>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th class="l" data-ko="상품종류">Type</th><th data-ko="경매 수">Auctions</th><th data-ko="낙찰 수">Sold</th><th data-ko="낙찰률">Sold %</th></tr></thead>
        <tbody>
${kTr}
        </tbody>
      </table>
      </div>

${tcgGameCount >= 5 ? `
      <p class="priceNote"><span data-ko="이 페이지는 원피스 전용입니다. 같은 수집으로 ${tcgGameCount}개 카드게임을 함께 봅니다 — 게임별 비교표는">This page is One Piece only. We check ${tcgGameCount} card games the same way — see</span> <a href="tcg-auction.html" data-ko="TCG 경매 데이터">TCG auction data</a> <span data-ko="에서 볼 수 있습니다.">for the cross-game table.</span></p>
` : ""}
      <h2 data-ko="카드별 경매 순위" id="cardRankTitle">Card auction leaders</h2>
      <div class="metricTabs" role="group" aria-label="Rank by" style="margin:2px 0 10px">
        <button type="button" data-rank="med" aria-pressed="true" data-ko="낙찰가순">By price</button>
        <button type="button" data-rank="sales" aria-pressed="false" data-ko="판매수순">By sales</button>
      </div>
      <div style="overflow-x:auto">
      <table class="aTable">
        <thead><tr><th>#</th><th class="l" data-ko="카드">Card</th><th data-ko="낙찰가">Price</th><th data-ko="가격 범위">Range</th><th data-ko="낙찰률">Sold %</th><th data-ko="낙찰 수">Sold</th></tr></thead>
        <tbody id="cardRankBody">
${cTr}
        </tbody>
      </table>
      </div>
      <!-- 설명 문단은 전부 뺐다 — 2026-09-02 소유자 지시("글자도 걍 날려, 기간 정도만 냅두고").
           이베이 파트너 고지도 뺐다: 이 페이지에는 이베이 링크가 0개라 고지 의무가 없다(실측 확인).
           ⚠️ 나중에 이 페이지에 제휴 링크를 넣으면 고지를 반드시 되살려야 한다. -->
      <p style="margin-top:16px;font-size:12.5px;color:var(--muted)"><a href="free-data.html">Free CSV</a> · <a href="methodology.html">How we count</a> · <a href="cards/">Card prices</a> · <a href="sets/index.html">Set guides</a></p>
    </main>
    <script>
      // 일별 막대 — 지표 탭으로 한 번에 하나만 그린다.
      // 축이 둘인 그래프(낙찰률과 건수를 한 판에)는 만들지 않는다. 눈금이 서로를 속인다.
      (function () {
        var SERIES = ${chartSeriesJson};
        var period = "daily";
        var days = SERIES[period];
        var host = document.getElementById("opDailyChart");
        if (!host || !days.length) return;
        // 이름은 업계용어가 아니라 **일상어**로 쓴다 — 2026-09-02 소유자 지시:
        // "누가 봐도 쉽게 이해할 수 있게. 뇌성마비 환자가 봐도 이해할 수 있는 데이터가 핵심이다."
        // say() 는 그 지표가 무슨 뜻인지 한 문장으로 말한다. 숫자만 보여주면 높은 건지 낮은 건지 모른다.
        var M = {
          rate: { label: "Sold %", ko: "낙찰률", fmt: function (v) { return v.toFixed(1) + "%"; }, floor10: true,
            say: function (v) { return v >= 50 ? ["Most sell.", "대부분 팔립니다."]
              : v >= 30 ? ["About a third sell.", "3건 중 1건 팔립니다."]
              : ["Most go unsold.", "대부분 유찰됩니다."]; },
            help: ["Share of ended auctions that sold.", "종료 경매 중 낙찰 비율"] },
          ended: { label: "Ended", ko: "종료 수", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); },
            help: ["Auctions that closed.", "그날 종료된 경매 수"] },
          sold: { label: "Sold", ko: "낙찰 수", fmt: function (v) { return Math.round(v).toLocaleString("en-US"); },
            help: ["Of those, how many sold.", "그중 낙찰된 수"] },
          gmv: { label: "Total spent", ko: "거래액", fmt: function (v) { return "$" + Math.round(v).toLocaleString("en-US"); },
            help: ["Winning bids added up.", "낙찰가 합계"] },
          med: { label: "Price", ko: "낙찰가", fmt: function (v) { return "$" + (v < 100 ? v.toFixed(2) : Math.round(v).toLocaleString("en-US")); },
            help: ["Middle price of sold items.", "낙찰가 중앙값"] }
        };
        var bars = document.createElement("div"); bars.className = "opBars";
        var axis = document.createElement("div"); axis.className = "opAxis";
        var tip = document.createElement("div"); tip.className = "opTip";
        var guide = document.createElement("div"); guide.className = "opGuide";
        host.appendChild(bars); host.appendChild(axis); host.appendChild(tip);
        bars.appendChild(guide);
        var readout = document.getElementById("opReadout");
        var plain = document.getElementById("opPlain");
        // 언어는 <html lang> 을 본다 — lang-toggle.js 가 전환할 때 함께 바꾼다.
        var KO = document.documentElement.lang === "ko";
        document.addEventListener("opboxlang", function (ev) { KO = (ev.detail || {}).lang === "ko"; draw(); });
        var cols = [];
        function buildBars() {
          bars.querySelectorAll(".opCol").forEach(function (c) { c.remove(); });
          cols = days.map(function (r) {
            var c = document.createElement("div");
            c.className = "opCol" + (r.p ? " pt" : "");
            c.tabIndex = 0;
            c.appendChild(document.createElement("i"));
            bars.appendChild(c);
            c.addEventListener("focus", function () { select(cols.indexOf(c)); });
            c.addEventListener("blur", clear);
            return c;
          });
          // 날짜 라벨 — 종전엔 시작·끝 둘뿐이라 가운데 막대가 언제인지 알 수 없었다.
          // 폭에 맞춰 4~5개를 고르게 뿌린다(좁으면 3개).
          axis.innerHTML = "";
          var want = bars.getBoundingClientRect().width < 420 ? 3 : 5;
          var step = Math.max(1, Math.round((days.length - 1) / (want - 1)));
          var picked = [];
          for (var t = 0; t < days.length; t += step) picked.push(t);
          if (picked[picked.length - 1] !== days.length - 1) picked.push(days.length - 1);
          picked.forEach(function (idx) {
            var sp = document.createElement("span");
            sp.textContent = days[idx].ax;
            axis.appendChild(sp);
          });
        }

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
          // 눈금선 — 2026-09-02 가독성 작업. 종전엔 최고값 한 줄뿐이라 막대 높이를 보고도
          // "이게 30%인가 50%인가"를 알 수 없었다. 마우스를 못 올리면 값을 영영 못 읽는다.
          // 0 · 절반 · 최고 세 줄을 긋고 각각 값을 적는다.
          if (guide) {
            guide.innerHTML = "";
            if (vals.length) {
              [1, 0.5, 0].forEach(function (f) {
                var ln = document.createElement("i");
                ln.className = "gLine";
                ln.style.bottom = (f * 100) + "%";
                var tg = document.createElement("span");
                tg.textContent = m.fmt(top * f);
                ln.appendChild(tg);
                guide.appendChild(ln);
              });
            }
          }
          // 읽는 줄 — 지금 보는 지표의 최신·최고·최저를 글로 적는다.
          if (readout) {
            var withV = days.filter(function (r) { return r[metric] != null && isFinite(r[metric]); });
            var lastR = withV[withV.length - 1];
            var hi = withV.slice().sort(function (a, b) { return b[metric] - a[metric]; })[0];
            var lo = withV.slice().sort(function (a, b) { return a[metric] - b[metric]; })[0];
            readout.innerHTML = "";
            var put = function (label, val, day, cls) {
              var el = document.createElement("span");
              if (cls) el.className = cls;
              el.appendChild(document.createTextNode(label + " "));
              var b = document.createElement("b"); b.textContent = val; el.appendChild(b);
              if (day) el.appendChild(document.createTextNode(" · " + day));
              readout.appendChild(el);
            };
            if (lastR) {
              // 라벨은 "latest/highest/lowest" 대신 일상어로 — 2026-09-02 소유자 확인 중 지적.
              // 날짜는 괄호에 넣어 숫자와 섞이지 않게 한다(빽빽하면 못 읽는다).
              put(KO ? "최근" : "Latest", m.fmt(lastR[metric]), lastR.ax || lastR.d.slice(5), "hi");
              put(KO ? "최고" : "High", m.fmt(hi[metric]), hi.ax || hi.d.slice(5));
              put(KO ? "최저" : "Low", m.fmt(lo[metric]), lo.ax || lo.d.slice(5));
            }
          }
          // 한 문장 요약 — 마우스를 못 올려도, 숫자를 몰라도 뜻이 통해야 한다.
          // 2026-09-02 소유자 지시("뇌성마비 환자가 봐도 이해할 수 있는 데이터가 핵심").
          // ① 이 지표가 뭔지 ② 지금 값이 무슨 뜻인지 ③ 지난주보다 오르는지 내리는지.
          if (plain) {
            var vals = days.filter(function (r) { return r[metric] != null && isFinite(r[metric]); });
            plain.innerHTML = "";
            if (vals.length) {
              var cur = vals[vals.length - 1][metric];
              var say = document.createElement("strong");
              var txt = m.say ? m.say(cur)[KO ? 1 : 0] : (KO ? m.ko + " " + m.fmt(cur) : m.label + ": " + m.fmt(cur));
              say.textContent = txt;
              plain.appendChild(say);
              // 방향: 최근값 vs 그 앞 같은 개수 구간의 중앙값. 하루치 요동에 휘둘리지 않게 구간으로 본다.
              var half = Math.max(1, Math.min(7, Math.floor(vals.length / 2)));
              var recent = vals.slice(-half).map(function (r) { return r[metric]; });
              var older = vals.slice(-half * 2, -half).map(function (r) { return r[metric]; });
              var mid = function (a) { var s = a.slice().sort(function (x, y) { return x - y; }); return s[Math.floor((s.length - 1) / 2)]; };
              if (older.length) {
                var d = mid(recent) - mid(older);
                var pct = mid(older) ? Math.abs(d / mid(older)) * 100 : 0;
                var dir = pct < 5 ? (KO ? " 최근 흐름은 비슷합니다." : " Holding steady lately.")
                  : d > 0 ? (KO ? " 최근 올라가는 중입니다." : " Trending up lately.")
                  : (KO ? " 최근 내려가는 중입니다." : " Trending down lately.");
                plain.appendChild(document.createTextNode(dir));
              }
              if (m.help) {
                var hp = document.createElement("span");
                hp.className = "opHelp";
                hp.textContent = m.help[KO ? 1 : 0];
                plain.appendChild(hp);
              }
            }
          }
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
          // 휴대폰에서는 손가락이 툴팁을 가린다. 위쪽 읽는 줄에도 같은 값을 적어 둔다.
          if (readout) {
            var mm = M[metric];
            readout.innerHTML = "";
            var add = function (label, val, cls) {
              var el = document.createElement("span");
              if (cls) el.className = cls;
              el.appendChild(document.createTextNode(label + " "));
              var b = document.createElement("b"); b.textContent = val; el.appendChild(b);
              readout.appendChild(el);
            };
            add(r.d + (r.p ? (KO ? " (부분수집)" : " (partial)") : ""), r[metric] == null ? (KO ? "측정 안 됨" : "not measured") : mm.fmt(r[metric]), "hi");
            // 좁은 화면에서는 툴팁이 없으므로 그날 수치를 여기에 다 적는다.
            add(KO ? "종료" : "ended", r.ended.toLocaleString("en-US"));
            add(KO ? "낙찰" : "sold", r.sold.toLocaleString("en-US"));
            if (r.gmv != null) add(KO ? "거래액" : "hammer", "$" + r.gmv.toLocaleString("en-US"));
            if (r.med != null) add(KO ? "중앙 낙찰가" : "median bid", "$" + (r.med < 100 ? r.med.toFixed(2) : Math.round(r.med).toLocaleString("en-US")));
          }
        }
        // 막대 하나하나에 이벤트를 걸면 휴대폰에서 못 쓴다 — 41일치면 막대 폭이 5.5px 라
        // 손가락으로 짚을 수 없고, 터치 기기에는 hover 가 아예 없다.
        // 그래서 그래프 전체에서 x 좌표로 가장 가까운 날을 골라 띄운다. 마우스도 같은 방식이
        // 낫다 — 막대 사이 빈틈에서도 반응한다.
        var picked = -1;
        function pickAt(clientX) {
          var r = bars.getBoundingClientRect();
          var i = Math.round(((clientX - r.left) / r.width) * (days.length - 1));
          return Math.max(0, Math.min(days.length - 1, i));
        }
        function select(i) {
          if (i === picked) return;
          if (cols[picked]) cols[picked].classList.remove("on");
          picked = i;
          if (cols[i]) cols[i].classList.add("on");
          showTip(i);
        }
        function clear() {
          if (cols[picked]) cols[picked].classList.remove("on");
          picked = -1;
          tip.style.opacity = "0";
          draw();   // 읽는 줄을 기간 요약으로 되돌린다
        }
        bars.addEventListener("pointermove", function (ev) { select(pickAt(ev.clientX)); });
        bars.addEventListener("pointerdown", function (ev) { select(pickAt(ev.clientX)); });
        bars.addEventListener("pointerleave", clear);

        var tabs = document.querySelectorAll(".metricTabs button[data-m]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            metric = b.getAttribute("data-m");
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            draw();
          });
        });
        var ptabs = document.querySelectorAll(".periodTabs button[data-p]");
        Array.prototype.forEach.call(ptabs, function (b) {
          b.addEventListener("click", function () {
            period = b.getAttribute("data-p");
            days = SERIES[period];
            Array.prototype.forEach.call(ptabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            picked = -1;
            buildBars();
            draw();
          });
        });
        buildBars();
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
          var nm = cell("kName", r.name);
          nm.dataset.ko = r.nameKo;   // lang-toggle 이 전환한다
          row.appendChild(nm);

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

    <script>
      // 카드 순위 정렬 전환. 초기 표는 서버가 중앙가순으로 렌더해 두고(JS 없이도 보임),
      // 버튼을 누르면 같은 데이터로 tbody 만 다시 그린다.
      (function () {
        var DATA = ${cardRankJson};
        var body = document.getElementById("cardRankBody");
        if (!body) return;
        var KO = function () { return document.documentElement.lang === "ko"; };
        var usd = function (v) { return v == null ? "\u2014" : "$" + Math.round(v).toLocaleString("en-US"); };
        function render(kind) {
          var rows = DATA[kind] || [];
          body.innerHTML = "";
          rows.forEach(function (c, i) {
            var tr = document.createElement("tr");
            var add = function (txt, cls) {
              var td = document.createElement("td");
              if (cls) td.className = cls;
              if (txt instanceof Node) td.appendChild(txt); else td.textContent = txt;
              tr.appendChild(td); return td;
            };
            add(String(i + 1));
            var nameWrap = document.createDocumentFragment();
            nameWrap.appendChild(document.createTextNode(c.name));
            var small = document.createElement("small");
            small.textContent = c.id + " \u00b7 " + c.set;
            nameWrap.appendChild(small);
            add(nameWrap, "l");
            add(usd(c.med));
            add(c.low != null && c.high != null ? usd(c.low) + "\u2013" + usd(c.high) : "\u2014");
            add(c.st != null ? c.st + "%" : "\u2014");
            add(c.sold.toLocaleString("en-US"));
            body.appendChild(tr);
          });
        }
        var tabs = document.querySelectorAll("button[data-rank]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            render(b.getAttribute("data-rank"));
          });
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
