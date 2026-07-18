// Generate static SEO landing pages per set: sets/<code>.html + sets/index.html
// - Static text contains only stable facts (set name, release, chase-card list).
// - Volatile prices are loaded client-side from /data/onepiece-packs.json (always fresh).
// - Idempotently inserts new URLs into sitemap.xml.
// Run: node tools/generate-set-pages.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";
// One Piece cards use standard-size sleeves. This listing has verified high sales,
// but the copy intentionally avoids a permanent "best-selling" claim.
const SLEEVE_EBAY = `https://www.ebay.com/itm/136768331994?${EPN}`;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));

const ORDER = [...data.jp.list, ...data.extra.list].filter((c) => (data.sets[c]?.cards || []).length > 0);
const slug = (code) => code.toLowerCase();

// 개별 카드 페이지 슬러그 맵(있을 때만 링크) — tools/generate-card-pages.js 산출물
let CARD_MAP = {};
try { CARD_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "cards", "card-map.json"), "utf8")); } catch (e) {}
// 검증된 세트 팩트(정가·재판) — data/set-facts.json (연구 워크플로 산출, 나이틀리 불변)
let SET_FACTS = { sets: {} };
try { SET_FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-facts.json"), "utf8")); } catch (e) {}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- 실데이터 구워넣기용 헬퍼 (가격은 항상 "as of 날짜"로 정직하게, 매일 재생성으로 최신 유지)
const FX = data.fx || {};
const DATA_DATE = data.updated || new Date().toISOString().slice(0, 10);
const jpyUsd = (jpy) => (Number.isFinite(jpy) && FX.jpyKrw && FX.usdKrw ? (jpy * FX.jpyKrw) / FX.usdKrw : null);
const krwUsd = (krw) => (Number.isFinite(krw) && FX.usdKrw ? krw / FX.usdKrw : null);
const toUsd = (val, cur) => (val == null ? null : cur === "USD" ? val : krwUsd(val));
const usd = (n) => (n == null ? null : "$" + Math.round(n).toLocaleString("en-US"));
const intl = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));
const RARITY = { L: "Leader", SEC: "Secret Rare", SR: "Super Rare", R: "Rare", UC: "Uncommon", C: "Common", SP: "Special", P: "Promo" };
const rarityLabel = (r) => RARITY[r] || r || "";
const monthYear = (iso) => {
  if (!iso) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${m[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};
// 카드별 표시가: NM(생) + PSA10(sold 우선, 없으면 ask). 불확실하면 null → 표에 "—"
function cardPrices(c) {
  let nm = jpyUsd(c.nmJpy);
  let nmSrc = c.nmJpy != null ? "jp" : null;
  if (nm == null && typeof c.priceUsd === "number") { nm = c.priceUsd; nmSrc = "tcg"; } // 일본 NM 리서치 전(예: OP-16): TCGplayer USD 시세 폴백, 라벨은 TCG로 정직 표기
  let psa = null, psaKind = "";
  const sold = c.psa10Ebay;
  if (sold && sold.soldBased && sold.middle != null && (sold.sampleSize || 0) >= 3) {
    const v = toUsd(sold.middle, sold.currency);
    if (v != null) { psa = v; psaKind = "sold"; }
  }
  if (psa == null && c.psa10Active && c.psa10Active.bestListing && c.psa10Active.bestListing.total != null) {
    const bl = c.psa10Active.bestListing;
    const v = toUsd(bl.total, bl.currency);
    if (v != null) { psa = v; psaKind = "ask"; }
  }
  return { nm, nmSrc, psa, psaKind };
}

function head({ title, desc, canonical, ogType = "article", extraLd = "" }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <!-- Google Analytics 4 (gtag.js) -->
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>
      window.dataLayer = window.dataLayer || [];
      function gtag(){dataLayer.push(arguments);}
      gtag('js', new Date());
      gtag('config', 'G-P73SE1WVD0');
    </script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="${ogType}" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://opboxindex.com/og-image.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    ${extraLd}
    <link rel="stylesheet" href="../styles.css?v=20260718b" />
    <style>
      .setHero { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
      .setHero img { width: 132px; border-radius: 10px; border: 1px solid var(--line); }
      .liveBox { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: rgba(16,215,160,.05); }
      .liveBox b { font-size: 22px; color: var(--accent); }
      .liveBox small { color: var(--muted); display: block; margin-top: 4px; }
      .chaseList li { margin: 6px 0; }
      .ctaRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .ctaRow a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); font-weight: 800; }
      .ctaRow a.primary { background: rgba(16,215,160,.14); border-color: rgba(16,215,160,.5); color: var(--accent); }
      .setNavLinks { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; color: var(--muted); font-size: 13px; }
      .affNote { margin-top: 16px; color: var(--muted); font-size: 11px; opacity: .8; }
      .dataSummary { margin: 10px 0 0; color: var(--muted); font-size: 13px; }
      .dataSummary b { color: var(--accent); font-weight: 800; }
      .keyFacts { margin: 14px 0 4px; padding: 12px 16px 12px 32px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 680px; font-size: 13.5px; line-height: 1.65; }
      .keyFacts li { margin: 3px 0; }
      .keyFacts strong { color: var(--accent); }
      .chaseTableWrap { overflow-x: auto; margin: 14px 0 6px; }
      .chaseTable { width: 100%; border-collapse: collapse; font-size: 14px; }
      .chaseTable th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .chaseTable td { padding: 9px 10px; border-bottom: 1px solid rgba(255,255,255,.05); vertical-align: top; }
      .chaseTable td:first-child { color: var(--muted); font-variant-numeric: tabular-nums; }
      .chaseTable .cNum { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
      .chaseTable .psaKind { color: var(--muted); font-size: 10px; text-transform: uppercase; }
      .chaseTable td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .priceNote { color: var(--muted); font-size: 12px; margin: 2px 0 0; }
      .gearRec { margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: rgba(16,215,160,.05); font-size: 13px; line-height: 1.55; color: var(--muted); }
      .gearRec strong { color: #eef2ff; }
      .gearRec a { color: var(--accent); font-weight: 800; white-space: nowrap; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../market.html" data-ko="마켓 지수">Market Index</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="index.html" aria-current="page" data-ko="세트 가이드">Set Guides</a></nav>
    </header>
    <main class="bodyPage">`;
}

const FOOT = `
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this page — at no extra cost to you. Prices and availability change; always confirm details on eBay before buying.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="../about.html">About</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

// 라이브 가격 위젯: 데이터 fetch 실패/부재 시 위젯 자체를 숨김(불확실하면 숨김 원칙)
function liveWidget(code) {
  return `
      <div class="liveBox" id="livePrice" hidden>
        <span id="lpLabel">Current eBay listing price (mid)</span><br />
        <b id="lpMid">–</b>
        <small id="lpMeta"></small>
      </div>
      <script>
        (function () {
          fetch("../data/onepiece-packs.json?v=" + new Date().toISOString().slice(0, 10))
            .then(function (r) { return r.json(); })
            .then(function (d) {
              var s = d.sets && d.sets["${code}"];
              var m = s && s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
              if (!m || m.middle == null) return;
              var usd = m.currency === "USD" ? m.middle : m.middle / ((d.fx && d.fx.usdKrw) || 1388.2);
              var lo = m.low != null ? (m.currency === "USD" ? m.low : m.low / ((d.fx && d.fx.usdKrw) || 1388.2)) : null;
              var hi = m.high != null ? (m.currency === "USD" ? m.high : m.high / ((d.fx && d.fx.usdKrw) || 1388.2)) : null;
              document.getElementById("lpMid").textContent = "$" + Math.round(usd).toLocaleString("en-US");
              var meta = [];
              if (lo != null && hi != null) meta.push("Range $" + Math.round(lo).toLocaleString("en-US") + " – $" + Math.round(hi).toLocaleString("en-US"));
              if (m.sampleSize) meta.push(m.sampleSize + " listings");
              meta.push("Updated " + (m.updated || d.updated || ""));
              if (s.psaGem != null) meta.push("Set PSA10 rate " + s.psaGem + "%");
              document.getElementById("lpMeta").textContent = meta.join(" · ");
              document.getElementById("livePrice").hidden = false;
            })
            .catch(function () {});
        })();
      </script>`;
}

function faqLd(code, nameEn) {
  const q = [
    {
      q: `What is the current ${code} ${nameEn} booster box price?`,
      a: `OP Box Index tracks ${code} ${nameEn} Japanese sealed booster box prices daily from eBay active listings and sold history, shown in USD with KRW and JPY conversions. Check the live tracker for today's price band.`,
    },
    {
      q: `What are the top chase cards in ${code} ${nameEn}?`,
      a: `The most valuable ${code} pulls are ranked on this page by market price, including parallel, manga rare and special art cards, with PSA 10 population data where available.`,
    },
    {
      q: `Is a Japanese ${code} booster box a good buy?`,
      a: `That depends on price versus recent sold data, chase-card strength, supply and reseal risk. OP Box Index shows the data signals but does not give investment advice.`,
    },
  ];
  return `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: q.map((x) => ({ "@type": "Question", name: x.q, acceptedAnswer: { "@type": "Answer", text: x.a } })),
  })}</script>
    <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "Set Guides", item: `${SITE}/sets/index.html` },
      { "@type": "ListItem", position: 3, name: `${code} Guide`, item: `${SITE}/sets/${slug(code)}.html` },
    ],
  })}</script>`;
}

// 박스 Product 스키마 (리치결과용). 유효한 가격 있을 때만 방출 — 불완전 Product로 서치콘솔 경고 안 나게.
function productLd(code, nameEn, s) {
  const bm = s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
  if (!bm) return "";
  const lo = bm.low != null ? toUsd(bm.low, bm.currency) : null;
  const hi = bm.high != null ? toUsd(bm.high, bm.currency) : null;
  const mid = bm.middle != null ? toUsd(bm.middle, bm.currency) : null;
  if (mid == null) return "";
  const img = s.box ? (String(s.box).startsWith("http") ? s.box : SITE + s.box) : `${SITE}/og-image.png`;
  const offers =
    lo != null && hi != null && hi >= lo
      ? { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: Math.round(lo), highPrice: Math.round(hi), offerCount: bm.sampleSize || 1, availability: "https://schema.org/InStock", url: `${SITE}/sets/${slug(code)}.html` }
      : { "@type": "Offer", priceCurrency: "USD", price: Math.round(mid), availability: "https://schema.org/InStock", url: `${SITE}/sets/${slug(code)}.html` };
  const prod = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: `One Piece Card Game ${code} ${nameEn} Booster Box (Japanese)`,
    image: [img],
    description: `Japanese sealed ${code} ${nameEn} One Piece Card Game booster box — live market price from eBay listings and sold history, top chase cards and PSA 10 population data.`,
    brand: { "@type": "Brand", name: "Bandai" },
    category: "Trading Card Games",
    ...(s.release ? { releaseDate: s.release } : {}),
    offers,
  };
  return `<script type="application/ld+json">${JSON.stringify(prod)}</script>`;
}

function setPage(code, prev, next) {
  const s = data.sets[code];
  const nameEn = s.nameEn || code;
  const cards = (s.cards || []).slice(0, 10);
  const top3 = cards.slice(0, 3).map((c) => c.name).join(", ");
  const canonical = `${SITE}/sets/${slug(code)}.html`;
  const title = `${code} ${nameEn} Booster Box Price (Japanese) — Top Chase Cards & PSA Data | OP Box Index`;
  const desc = `Live ${code} ${nameEn} Japanese booster box price from eBay listings and sold data, top 10 chase cards (${top3}), PSA 10 population stats and a pre-purchase checklist.`;
  const ebaySearch = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece Card Game ${code} ${nameEn} Booster Box Japanese sealed`)}&LH_BIN=1&_sop=15&${EPN}`;
  // s.release = 영문(NA)판 발매일. "일본판 페이지인데 Released=EN날짜"로 읽히던 오표기 수정
  const release = s.release ? `<p class="eyebrow">Japanese edition · EN release ${esc(s.release)}</p>` : `<p class="eyebrow">Japanese edition</p>`;

  const enc = encodeURIComponent(code);

  // 실데이터 표(구워넣기): 순위·카드·NM(생)·PSA10(sold 우선). 값 없으면 "—"
  // 개별 카드 페이지가 있으면 이름에 링크 (cards/card-map.json — generate-card-pages.js 산출물)
  const rows = cards.map((c, i) => {
    const p = cardPrices(c);
    const cardHref = CARD_MAP[(c.number || "") + "|" + String(c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")];
    const nameCell = cardHref ? `<a href="../cards/${cardHref}"><strong>${esc(c.name)}</strong></a>` : `<strong>${esc(c.name)}</strong>`;
    return `<tr><td>${i + 1}</td><td>${nameCell}<span class="cNum">${esc(c.number || "")}${c.rarity ? ` · ${esc(rarityLabel(c.rarity))}` : ""}</span></td><td class="num">${p.nm != null ? `${usd(p.nm)}${p.nmSrc === "tcg" ? ` <span class="psaKind">TCG</span>` : ""}` : "—"}</td><td class="num">${p.psa != null ? `${usd(p.psa)} <span class="psaKind">${p.psaKind === "sold" ? "sold" : "ask"}</span>` : "—"}</td></tr>`;
  }).join("\n            ");

  // 세트 요약 라인 (안정 데이터)
  const summaryBits = [];
  if (s.release) summaryBits.push(`EN release <b>${esc(monthYear(s.release))}</b>`);
  if (s.cardCount) summaryBits.push(`<b>${esc(String(s.cardCount))}</b> cards`);
  if (s.psaGem != null) summaryBits.push(`PSA 10 gem rate <b>${esc(String(s.psaGem))}%</b>${s.psaTotal ? ` (${intl(s.psaTotal)} graded)` : ""}`);
  const summaryLine = summaryBits.length ? `<p class="dataSummary">${summaryBits.join(" · ")}</p>` : "";

  // 박스 시세 구워넣기 (날짜 명시 · 매일 재생성으로 최신 유지)
  const bm = s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
  let boxLine = "";
  if (bm && bm.middle != null) {
    const mid = toUsd(bm.middle, bm.currency), lo = bm.low != null ? toUsd(bm.low, bm.currency) : null, hi = bm.high != null ? toUsd(bm.high, bm.currency) : null;
    if (mid != null) boxLine = `<p>As of <strong>${esc(bm.updated || DATA_DATE)}</strong>, a sealed ${code} Japanese booster box lists around <strong>${usd(mid)}</strong>${lo != null && hi != null ? ` (typical range ${usd(lo)}–${usd(hi)})` : ""} on eBay${bm.sampleSize ? `, from ${bm.sampleSize} active listings` : ""}. This updates daily — see the <a href="../packs.html?set=${enc}&hl=en">live ${code} tracker</a> for today's number and recent sold prices.</p>`;
  }

  // 데이터 기반 분석 문단 (세트마다 고유)
  const top = cards[0], tp = top ? cardPrices(top) : {};
  const allTcg = cards.length > 0 && cards.every((c) => cardPrices(c).nmSrc === "tcg"); // OP-16 등 TCGplayer 시세만 있는 세트: NM 설명 문구를 정직하게 교체
  const soldCount = cards.filter((c) => c.psa10Ebay && c.psa10Ebay.soldBased).length;
  const analysis = top ? `The chase in ${code} is led by <strong>${esc(top.name)}</strong>${top.rarity ? ` (${esc(rarityLabel(top.rarity))})` : ""}${tp.nm != null ? `, ${tp.nmSrc === "tcg" ? `with a TCGplayer market price around ${usd(tp.nm)}` : `whose raw Japanese NM copy runs about ${usd(tp.nm)}`}` : ""}${tp.psa != null ? ` and ${tp.psaKind === "sold" ? "whose PSA 10 examples have sold" : "whose PSA 10 copies list"} near ${usd(tp.psa)}` : ""}. ${soldCount > 1 ? `${soldCount} of the top 10 cards have verified PSA 10 sold history, so the graded premiums here reflect real transactions, not asking prices. ` : ""}${s.psaGem != null ? `Across ${code}, cards grade PSA 10 (gem mint) about <strong>${s.psaGem}%</strong> of the time${s.psaTotal ? ` out of ${intl(s.psaTotal)} graded` : ""} — ${s.psaGem >= 85 ? "a high gem rate, which tends to keep the graded-vs-raw premium modest" : "a moderate gem rate, which keeps clean PSA 10 copies scarce and their premium wide"}.` : ""}` : "";

  // PSA 섹션
  const psaSection = s.psaGem != null ? `
      <h2>${code} PSA 10 grading data</h2>
      <p>${code} ${esc(nameEn)} cards achieve <strong>PSA 10 (gem mint) roughly ${s.psaGem}%</strong> of the time${s.psaTotal ? `, across ${intl(s.psaTotal)} PSA-graded cards` : ""}. A higher gem rate means more PSA 10 supply, which usually compresses the premium a graded card holds over a raw NM copy; a lower rate keeps gem examples scarce and the premium wide. That is why chase-card value tracks <a href="../articles/psa-population-and-prices.html">PSA population and gem rate</a>, not just character popularity. Read the <a href="../articles/one-piece-card-price-guide.html">One Piece card price guide</a>, then see the <a href="../psa10-ranking.html">most valuable One Piece PSA 10 cards</a> across all sets.</p>` : "";

  // 6개월 박스 시세 궤적 (세트별 고유 수치 — boxSeries 주간 시리즈 기반)
  let trajectory = "";
  const bs = s.boxSeries && Array.isArray(s.boxSeries.points) ? s.boxSeries.points : [];
  if (bs.length >= 8) {
    const toU = (krw) => Math.round(krw / 1548.63);
    const first = bs[0], last = bs[bs.length - 1];
    const peak = bs.reduce((a, b) => (b.p > a.p ? b : a), bs[0]);
    const chg = Math.round((last.p / first.p - 1) * 100);
    const dir = chg >= 3 ? `gained <strong>${chg}%</strong>` : chg <= -3 ? `fell <strong>${Math.abs(chg)}%</strong>` : `held roughly flat (<strong>${chg >= 0 ? "+" : ""}${chg}%</strong>)`;
    const en = s.boxSeriesEn && Array.isArray(s.boxSeriesEn.points) ? s.boxSeriesEn.points : [];
    let enBit = "";
    if (en.length >= 8) {
      const enLast = en[en.length - 1], enChg = Math.round((enLast.p / en[0].p - 1) * 100);
      const ratio = (enLast.p / last.p).toFixed(1);
      enBit = ` The English-language ${code} box trades near <strong>${usd(toU(enLast.p))}</strong> over the same period (${enChg >= 0 ? "+" : ""}${enChg}% since January) — about <strong>${ratio}x</strong> the Japanese box, a gap driven by print volume and Western demand rather than card content.`;
    }
    trajectory = `
      <h2>${code} box price: the six-month trajectory</h2>
      <p>Weekly market data tells the ${code} story precisely. The Japanese sealed box entered ${monthYear(first.d) || "January 2026"} around <strong>${usd(toU(first.p))}</strong> and stands near <strong>${usd(toU(last.p))}</strong> as of ${esc(last.d)} — it ${dir} over the window, peaking at <strong>${usd(toU(peak.p))}</strong> in the week of ${esc(peak.d)}.${enBit} The interactive chart on the <a href="../packs.html?set=${enc}&hl=en">live tracker</a> lets you hover any week for the exact price of both editions.</p>`;
  }

  // 주간 등급(개봉) 모멘텀 — psaWeekly 기반, 세트별 고유
  let momentum = "";
  const wk = s.psaWeekly && Array.isArray(s.psaWeekly.points) ? s.psaWeekly.points : [];
  if (wk.length >= 3) {
    const sum = wk.reduce((a, b) => a + b.v, 0);
    const pk = wk.reduce((a, b) => (b.v > a.v ? b : a), wk[0]);
    const lastW = wk[wk.length - 1];
    const trend = lastW.v >= pk.v * 0.85 ? "still running near its peak" : lastW.v <= pk.v * 0.55 ? "cooling off from its peak" : "steady";
    momentum = `
      <h2>How fast is ${code} being opened right now?</h2>
      <p>PSA's population report acts as a destruction meter for sealed supply: every graded card came out of an opened pack. Between ${esc(wk[0].d)} and ${esc(lastW.d)}, collectors added <strong>${intl(sum)}</strong> new ${code} grades — peaking at <strong>${intl(pk.v)}</strong> cards in the week of ${esc(pk.d)}, with the latest week at ${intl(lastW.v)} (${trend}). ${s.psaFull && s.psaFull.total ? `All-time, the set counts <strong>${intl(s.psaFull.total)}</strong> graded cards.` : ""} Sustained grading volume while the box price holds is the pattern sealed collectors look for: supply burning while demand stays. The weekly bar chart on the <a href="../packs.html?set=${enc}&hl=en">tracker page</a> extends every week, and our <a href="../articles/psa-grading-vs-sealed-supply-2026.html">grading-vs-supply report</a> compares all 21 sets.</p>`;
  }

  // 구매의도 verdict — 전부 실데이터 파생 분기, 매일 재생성으로 월 표기 자동 갱신
  let verdict = "";
  {
    const pts = (s.boxSeries && s.boxSeries.points) || [];
    if (pts.length >= 8) {
      const vFirst = krwUsd(pts[0].p), vLast = krwUsd(pts[pts.length - 1].p);
      const vPeak = Math.max(...pts.map((p) => krwUsd(p.p)));
      const dd = vPeak > 0 ? Math.round(((vPeak - vLast) / vPeak) * 100) : 0;
      const chg = vFirst > 0 ? Math.round(((vLast - vFirst) / vFirst) * 100) : 0;
      const tp0 = cards.length ? cardPrices(cards[0]) : {};
      const topNm = tp0.nm != null ? tp0.nm : null;
      const mult = topNm && vLast ? topNm / vLast : null;
      const nowLabel = monthYear(DATA_DATE) || "today";
      let priceRead;
      if (dd >= 20) priceRead = `Today's buyer pays about <strong>${dd}% below the tracked peak</strong> (${usd(vPeak)} → ${usd(vLast)}) — the market has already corrected, which removes the worst-case of buying the top.`;
      else if (chg >= 15 && dd < 10) priceRead = `The box sits near its tracked high (${usd(vLast)} vs peak ${usd(vPeak)}, ${chg >= 0 ? "+" : ""}${chg}% over our window) — the market has rewarded holders, and a buyer today is paying for that momentum to continue.`;
      else priceRead = `The box trades at ${usd(vLast)}, ${dd}% under its tracked peak of ${usd(vPeak)} and ${chg >= 0 ? "up " + chg + "%" : "down " + Math.abs(chg) + "%"} over our tracking window — neither crashed nor running.`;
      const chaseRead = mult != null
        ? (mult >= 3
          ? ` The chase math is lottery-shaped: the top card alone (${esc(cards[0].name)}) is worth about <strong>${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}x the box</strong>, so a box's expected value concentrates in a few low-odds hits.`
          : ` The top chase (${esc(cards[0].name)}) runs about ${mult.toFixed(1)}x the box price — value here is spread across the top-10 table rather than one jackpot card.`)
        : "";
      const gemRead = s.psaGem != null
        ? ` On the grading side, the set's ${s.psaGem}% PSA 10 gem rate ${s.psaGem >= 85 ? "keeps graded supply plentiful — raw chase copies, not slabs, carry the scarcity" : "keeps true gem copies scarce, supporting graded premiums"}.`
        : "";
      verdict = `
      <h2>Is ${/^[OE]/.test(code) ? "an" : "a"} ${code} booster box worth buying? (${esc(nowLabel)})</h2>
      <p>${priceRead}${chaseRead}${gemRead}</p>
      <p>What the data cannot tell you: future reprints, banlist shifts, or your own luck. We publish the signals — price trajectory, opening rate, PSA population — and leave the decision to you. This is research, not investment advice; before paying up for any sealed box, run the <a href="../articles/reseal-checklist.html">reseal checklist</a>.</p>`;
    }
  }

  // 재판 이력 + 정가 대비 배수 — 검증된 팩트(data/set-facts.json). 반다이는 세트별 재판 미발표.
  let reprintBlock = "";
  {
    const sf = (SET_FACTS.sets && SET_FACTS.sets[code]) || null;
    if (sf && sf.jpMsrpYen) {
      const msrpUsd = FX.jpyKrw && FX.usdKrw ? Math.round((sf.jpMsrpYen * FX.jpyKrw) / FX.usdKrw) : null;
      const pts2 = (s.boxSeries && s.boxSeries.points) || [];
      const nowU = pts2.length ? krwUsd(pts2[pts2.length - 1].p) : null;
      const mult = msrpUsd && nowU ? (nowU / msrpUsd).toFixed(1) : null;
      const recs = sf.reprintRecords || [];
      const rpLine = recs.length
        ? `We found <strong>${recs.length}</strong> dated reprint record${recs.length > 1 ? "s" : ""} for ${code} from Japanese retailers/distributors: ${recs.map((r) => `${r.date ? esc(r.date) : "date n/a"} (<a href="${esc(r.source)}" target="_blank" rel="noopener nofollow">${esc(r.kind)}</a>)`).join(", ")}.`
        : `We found no dated reprint record for ${code} in our sources — which means none surfaced, not that it was never reprinted.`;
      reprintBlock = `
      <h2>Reprints &amp; original price</h2>
      <p>${code} launched at a Japanese MSRP of <strong>¥${sf.jpMsrpYen.toLocaleString()}</strong> per ${sf.packsPerBox}-pack box (about $${msrpUsd})${mult ? `. At today's market price that is roughly <strong>${mult}x its original retail</strong>` : ""}. <strong>On reprints:</strong> Bandai does not publish per-set reprint announcements for the One Piece Card Game, so there is no official count. ${rpLine} See the full board on the <a href="../market.html">market index page</a>.</p>`;
    }
  }

  const compareLink =
    code === "OP-05" || code === "OP-06"
      ? `<li>Comparing this to a nearby set? See <a href="../articles/op-05-vs-op-06.html">OP-05 vs OP-06</a>.</li>`
      : "";

  const cardsLd = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${code} ${nameEn} top chase cards`,
    itemListElement: cards.map((c, i) => ({ "@type": "ListItem", position: i + 1, name: `${c.name}${c.number ? ` (${c.number})` : ""}` })),
  })}</script>`;

  // Key facts — AI 답변엔진(ChatGPT/Gemini/Claude/Perplexity)이 그대로 인용할 수 있는
  // 날짜 박힌 선언문. 전부 실데이터, 야간 재생성으로 매일 갱신(신선도 신호).
  let keyFacts = "";
  {
    const facts = [];
    // 주 팩트는 주간 시장가(boxSeries) 기준 — 페이지 내 다른 수치(궤적·verdict)와 일치해야 함.
    const serPts = (s.boxSeries && s.boxSeries.points) || [];
    const serLast = serPts.length ? serPts[serPts.length - 1] : null;
    const jpVal = serLast ? krwUsd(serLast.p) : null;
    if (jpVal != null) facts.push(`As of ${esc(serLast.d)}, a sealed ${code} Japanese booster box has a market value of about <strong>${usd(jpVal)}</strong>.`);
    const bmA = s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
    const midA = bmA && bmA.middle != null ? toUsd(bmA.middle, bmA.currency) : null;
    if (midA != null && (bmA.sampleSize || 0) >= 5) facts.push(`Current eBay asking prices run around <strong>${usd(midA)}</strong> (${bmA.sampleSize} active listings).`);
    const enPts = (s.boxSeriesEn && s.boxSeriesEn.points) || [];
    const enLastP = enPts.length ? krwUsd(enPts[enPts.length - 1].p) : null;
    if (enLastP != null && jpVal != null) facts.push(`The English ${code} box runs about <strong>${usd(enLastP)}</strong> — ${(enLastP / jpVal).toFixed(1)}x the Japanese box.`);
    if (cards.length) {
      const tf = cardPrices(cards[0]);
      if (tf.nm != null) facts.push(`The most valuable ${code} card is <strong>${esc(cards[0].name)}</strong>${cards[0].number ? ` (${esc(cards[0].number)})` : ""} at about <strong>${usd(tf.nm)}</strong> raw NM${tf.psa != null ? `, with PSA 10 copies ${tf.psaKind === "sold" ? "selling" : "listed"} near ${usd(tf.psa)}` : ""}.`);
    }
    if (s.psaGem != null && s.psaTotal) facts.push(`${code} cards grade PSA 10 about <strong>${s.psaGem}%</strong> of the time, across ${intl(s.psaTotal)} PSA-graded cards.`);
    if (s.release) facts.push(`The English edition of ${code} released ${esc(monthYear(s.release))}.`);
    if (facts.length >= 2) keyFacts = `
      <section id="key-facts" aria-label="Key facts">
        <ul class="keyFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
      </section>`;
  }

  return `${head({ title, desc, canonical, extraLd: faqLd(code, nameEn) + cardsLd + productLd(code, nameEn, s) })}
      <p class="eyebrow">Set Guide</p>
      <div class="setHero">
        ${s.box ? `<img src="${esc(s.box)}" alt="${esc(`${code} ${nameEn} Japanese booster box`)}" loading="lazy" decoding="async" />` : ""}
        <div>
          <h1>${code} ${esc(nameEn)} — Japanese booster box price &amp; chase cards</h1>
          ${release}
          ${summaryLine}
        </div>
      </div>
      ${keyFacts}
      <p><strong>${code} ${esc(nameEn)}</strong> is tracked daily on OP Box Index using eBay active listings and sold history for the Japanese sealed booster box, plus per-card data for its most valuable pulls. The strongest chase cards in this set include ${esc(top3)} — the cards that effectively set the floor for what a sealed box is worth.</p>
      ${boxLine}
      ${liveWidget(code)}
      <div class="ctaRow">
        <a class="primary" href="../packs.html?set=${enc}&hl=en">Open live ${code} tracker</a>
        <a href="${ebaySearch}" target="_blank" rel="noopener noreferrer sponsored">Browse ${code} boxes on eBay</a>
      </div>
      <h2>Top 10 chase cards in ${code}</h2>
      <p>${analysis}</p>
      <div class="chaseTableWrap">
        <table class="chaseTable">
          <thead><tr><th>#</th><th>Card</th><th>NM (raw)</th><th>PSA 10</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <p class="priceNote">${allTcg ? `NM (raw) = raw ungraded card market price (TCGplayer market, <span title="TCGplayer">TCG</span>). Japanese NM and PSA 10 sold data for this set is still being collected.` : `NM = raw near-mint Japanese single (asking). PSA 10 = recent eBay <em>sold</em> median where marked "sold", otherwise lowest verified listing ("ask").`} Figures as of ${esc(DATA_DATE)}; live per-card prices on the <a href="../packs.html?set=${enc}&hl=en">tracker</a>.</p>
      <p class="gearRec">💎 <strong>Protect your chase cards.</strong> One Piece cards are standard size (63×88 mm), and Dragon Shield Matte 100 is a widely used premium sleeve. <a href="${SLEEVE_EBAY}" target="_blank" rel="noopener noreferrer sponsored">Shop popular sleeves on eBay ↗</a></p>
      ${trajectory}
      ${verdict}
      ${reprintBlock}
      ${momentum}
      ${psaSection}
      <h2>Before you buy a sealed ${code} box</h2>
      <ul>
        <li>Compare the asking price against recent <strong>sold</strong> prices, not just listings — active prices are often above what boxes actually sell for.</li>
        <li>Check the seller's history, photos of the actual box and shrink-wrap condition to reduce <a href="../articles/reseal-checklist.html">reseal risk</a>.</li>
        <li>Japanese and English boxes price very differently — see <a href="../articles/japan-vs-english.html">Japanese vs English boxes</a>.</li>
        <li>Understand <a href="../articles/sealed-box-rules.html">what actually moves sealed box prices</a> before treating any box as an investment.</li>
        <li>Chase-card value often tracks <a href="../articles/psa-population-and-prices.html">PSA population and gem rate</a>, not just character popularity.</li>
        ${compareLink}
      </ul>
      <div class="setNavLinks">
        ${prev ? `<a href="${slug(prev)}.html">← ${prev} guide</a>` : ""}
        <a href="index.html">All set guides</a>
        ${next ? `<a href="${slug(next)}.html">${next} guide →</a>` : ""}
      </div>${FOOT}`;
}

function hubPage() {
  const canonical = `${SITE}/sets/index.html`;
  const title = `One Piece Booster Box Price Guides by Set (Japanese) | OP Box Index`;
  const desc = `Japanese One Piece booster box price guides for every set: OP-01 through OP-15, EB and PRB — live eBay prices, top chase cards and PSA 10 data.`;
  const items = ORDER.map((code) => {
    const s = data.sets[code];
    return `<li><a href="${slug(code)}.html"><strong>${code}</strong> ${esc(s.nameEn || "")}</a> — box price, top chase cards &amp; PSA data</li>`;
  }).join("\n        ");
  const ld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "One Piece booster box price guides",
    itemListElement: ORDER.map((code, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: `${code} ${data.sets[code].nameEn || ""} guide`,
      url: `${SITE}/sets/${slug(code)}.html`,
    })),
  })}</script>`;
  return `${head({ title, desc, canonical, ogType: "website", extraLd: ld })}
      <p class="eyebrow">Set Guides</p>
      <h1>One Piece booster box price guides — every Japanese set</h1>
      <p>Pick a set to see its live Japanese sealed booster box price, top 10 chase cards, PSA 10 population data and buying checklist. All prices update daily from eBay listings and sold history.</p>
      <ul class="chaseList">
        ${items}
      </ul>
      <h2>Upcoming sets</h2>
      <ul class="chaseList">
        <li><a href="op-17.html"><strong>OP-17 The World's Strongest Warriors</strong></a> — JP Aug 22 / EN Aug 28, 2026. Release facts + pre-order data from the last three launches.</li>
        <li><a href="eb-05.html"><strong>EB-05 Heroines Edition vol.2</strong></a> — October 2026. What EB-03's tracked +50% climb predicts.</li>
      </ul>
      <div class="setNavLinks">
        <a href="../">Open the live price tracker</a>
        <a href="../cards/">Individual card price pages</a>
        <a href="../psa10-ranking.html">Most valuable PSA 10 cards</a>
        <a href="../articles/sealed-box-rules.html">What moves box prices</a>
        <a href="../articles/reseal-checklist.html">Reseal checklist</a>
        <a href="../articles/psa-population-and-prices.html">PSA population &amp; prices</a>
        <a href="../articles/op-05-vs-op-06.html">OP-05 vs OP-06</a>
        <a href="../articles/one-piece-card-price-guide.html">Card price guide</a>
      </div>${FOOT}`;
}

// ---- PSA10 가치 랭킹(루트 페이지) — 실거래 sold 값 기준(신뢰 최우선; 나눗셈 멀티플은 NM 부실로 미사용)
function rankingRows() {
  const rows = [];
  for (const code of ORDER) {
    for (const c of (data.sets[code].cards || [])) {
      const sold = c.psa10Ebay;
      if (!(sold && sold.soldBased && sold.middle != null)) continue;
      const psa = toUsd(sold.middle, sold.currency);
      const n = sold.sampleSize || 0;
      if (psa == null || n < 3) continue;
      rows.push({ code, name: c.name, number: c.number, rarity: c.rarity, psa, n, low: toUsd(sold.low, sold.currency), high: toUsd(sold.high, sold.currency), updated: sold.updated });
    }
  }
  rows.sort((a, b) => b.psa - a.psa);
  return rows.slice(0, 30);
}

function rankingPage() {
  const rows = rankingRows();
  const asOf = (rows[0] && rows[0].updated) || DATA_DATE;
  const canonical = `${SITE}/psa10-ranking.html`;
  const title = `Most Valuable One Piece PSA 10 Cards — Sold Price Ranking | OP Box Index`;
  const desc = `The most valuable Japanese One Piece TCG cards in PSA 10, ranked by recent eBay sold prices. Real graded-card completed-sale data across every set — no asking-price hype.`;
  const trs = rows.map((r, i) => `<tr data-code="${esc(r.code)}"><td class="rk">${i + 1}</td><td class="cd"><strong>${esc(r.name)}</strong><span class="sub">${esc(r.code)}${r.number ? ` · ${esc(r.number)}` : ""}${r.rarity ? ` · ${esc(rarityLabel(r.rarity))}` : ""}</span></td><td class="pv">${usd(r.psa)}</td><td class="rg">${r.low != null && r.high != null ? `${usd(r.low)}–${usd(r.high)}` : "—"}</td><td class="ns">${r.n}</td></tr>`).join("\n            ");
  const ld = `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "ItemList",
    name: "Most valuable One Piece PSA 10 cards",
    itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${r.name} (${r.code}${r.number ? " " + r.number : ""}) PSA 10` })),
  })}</script>
    <script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
      { "@type": "ListItem", position: 2, name: "PSA 10 Value Ranking", item: canonical },
    ],
  })}</script>`;
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />
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
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta property="og:image:width" content="1200" /><meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    ${ld}
    <link rel="stylesheet" href="styles.css?v=20260718b" />
    <style>
      .rankWrap { max-width: 900px; margin: 0 auto; padding: 20px clamp(16px,3vw,28px) 44px; }
      .rankWrap h1 { margin: 6px 0 6px; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .rankWrap .lead { color: var(--muted); font-size: 15px; line-height: 1.6; max-width: 680px; }
      .rankTableWrap { overflow-x: auto; margin: 18px 0 8px; }
      .rankTable { width: 100%; border-collapse: collapse; font-size: 14px; }
      .rankTable th { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .3px; white-space: nowrap; }
      .rankTable td { padding: 10px; border-bottom: 1px solid rgba(255,255,255,.05); vertical-align: top; }
      .rankTable tr[data-code] { cursor: pointer; }
      .rankTable tr[data-code]:hover td { background: rgba(16,215,160,.06); }
      .rankTable .rk { color: var(--muted); font-variant-numeric: tabular-nums; }
      .rankTable .cd .sub { display: block; color: var(--muted); font-size: 11px; margin-top: 1px; }
      .rankTable .pv { font-weight: 800; color: var(--accent); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .rankTable .rg, .rankTable .ns { color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
      .methodNote { margin: 12px 0 0; color: var(--muted); font-size: 12px; line-height: 1.55; }
      .rankWrap .affNote { margin-top: 16px; color: var(--muted); font-size: 11px; opacity: .8; }
    </style>
  </head>
  <body>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="market.html" data-ko="마켓 지수">Market Index</a><a href="psa10-ranking.html" aria-current="page" data-ko="PSA10 랭킹">Top PSA 10</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a></nav>
    </header>
    <main class="rankWrap">
      <p class="eyebrow">PSA 10 Value Ranking</p>
      <h1>Most valuable One Piece PSA 10 cards</h1>
      <p class="lead">The highest-value Japanese One Piece TCG cards in PSA 10 gem mint, ranked by recent eBay <strong>sold</strong> prices across every set. Real completed-sale data, minimum 3 sales per card — no asking-price hype.</p>
      <div class="rankTableWrap">
        <table class="rankTable">
          <thead><tr><th>#</th><th>Card</th><th>PSA 10 sold</th><th>Sold range</th><th>Sales</th></tr></thead>
          <tbody>
            ${trs}
          </tbody>
        </table>
      </div>
      <p class="methodNote">Method: PSA 10 median of recent eBay <em>sold</em> listings (Japanese cards), minimum 3 completed sales, as of ${esc(asOf)}. Values in USD. Tap any row for that card's full live tracker. Reflects graded-card sold prices, not raw singles.</p>
      <div class="setNavLinks"><a href="./">Live price tracker</a><a href="cards/">Individual card price pages</a><a href="sets/index.html">Set guides</a><a href="compare.html">Compare boxes</a><a href="articles/psa-population-and-prices.html">PSA population &amp; prices</a></div>
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this site — at no extra cost to you. Prices change; always confirm on eBay before buying. Not investment advice.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
    <script>
      document.querySelectorAll('.rankTable tr[data-code]').forEach(function (tr) {
        tr.addEventListener('click', function () { location.href = 'packs.html?set=' + encodeURIComponent(tr.getAttribute('data-code')) + '&hl=en'; });
      });
    </script>
  </body>
</html>
`;
}

// ---- write files
const outDir = path.join(ROOT, "sets");
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir);
let written = 0;
ORDER.forEach((code, i) => {
  const html = setPage(code, ORDER[i - 1], ORDER[i + 1]);
  fs.writeFileSync(path.join(outDir, `${slug(code)}.html`), html, "utf8");
  written++;
});
fs.writeFileSync(path.join(outDir, "index.html"), hubPage(), "utf8");
written++;
fs.writeFileSync(path.join(ROOT, "psa10-ranking.html"), rankingPage(), "utf8");
written++;

// ---- sitemap: idempotent insert
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
const today = new Date().toISOString().slice(0, 10);
const urls = [`${SITE}/psa10-ranking.html`, `${SITE}/sets/index.html`, ...ORDER.map((c) => `${SITE}/sets/${slug(c)}.html`)];
let added = 0;
const bumpLastmod = (u) => {
  const esc = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(<loc>${esc}</loc>[\\s\\S]*?<lastmod>)[^<]*(</lastmod>)`);
  if (re.test(sm)) { sm = sm.replace(re, `$1${today}$2`); return true; }
  return false;
};
for (const u of urls) {
  if (bumpLastmod(u)) continue; // refresh existing entry's lastmod to today
  const entry = `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  sm = sm.replace("</urlset>", entry + "</urlset>");
  added++;
}
bumpLastmod(`${SITE}/`); // home is data-driven — keep it fresh too
fs.writeFileSync(smPath, sm, "utf8");
console.log(JSON.stringify({ pagesWritten: written, sitemapAdded: added }));
