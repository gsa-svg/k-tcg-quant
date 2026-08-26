// Generate static SEO landing pages per set: sets/<code>.html + sets/index.html
// - Static text contains only stable facts (set name, release, chase-card list).
// - Volatile prices are loaded client-side from /data/onepiece-packs.json (always fresh).
// - Idempotently inserts new URLs into sitemap.xml.
// Run: node tools/generate-set-pages.js
const fs = require("fs");
const path = require("path");
// styles.css 버전을 하드코딩하면 범프할 때마다 어긋난다(2026-07-27 실사고: 가드 V1 21건).
const CSS_VER = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";
// One Piece cards use standard-size sleeves. This listing has verified high sales,
// but the copy intentionally avoids a permanent "best-selling" claim.
const SLEEVE_EBAY = `https://www.ebay.com/itm/136768331994?${EPN}`;
const data = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
// 박스 실거래 시세 그래프 — 그림은 box-chart.js 한 곳에서만 그린다(홈 화면과 같은 파일).
const BoxChart = require(path.join(ROOT, "box-chart.js"));
let SOLD_SERIES = { sets: {} };
try { SOLD_SERIES = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8")); } catch (e) {}
// 서버에서 SVG 를 다 그려 보낸다 — JS 가 없어도 그래프와 숫자가 그대로 읽힌다.
// 페이지의 box-chart.js 는 마우스로 훑을 때 값을 띄우는 향상 기능만 얹는다.
function boxChartBlock(code) {
  const series = SOLD_SERIES.sets && SOLD_SERIES.sets[code];
  if (!BoxChart.hasChart(series)) return "";
  return BoxChart.chartHTML(series, { lang: "en", title: `${code} sealed booster box — median completed eBay sale` });
}

// 카드 목록이 없어도 **박스 실거래 시세가 있으면** 페이지를 만든다 — 2026-08-26.
// 갓 나온 세트는 top10 카드를 확정하기 전이지만 박스는 이미 팔리고 있다.
// OP-17 은 발매 4일 만에 일본판 25건·영문판 213건이 원장에 쌓였는데, 종전 조건(cards>0)이면
// 카드 목록을 만들 때까지 시세를 아예 못 보여줬다.
const hasBoxSold = (c) => {
  const bm = data.sets[c]?.boxMarket || {};
  return ["jp", "en"].some((ed) => bm[ed]?.ebaySold?.median != null);
};
const ORDER = [...data.jp.list, ...data.extra.list]
  .filter((c) => (data.sets[c]?.cards || []).length > 0 || hasBoxSold(c));
const slug = (code) => code.toLowerCase();

// 개별 카드 페이지 슬러그 맵(있을 때만 링크) — tools/generate-card-pages.js 산출물
let CARD_MAP = {};
try { CARD_MAP = JSON.parse(fs.readFileSync(path.join(ROOT, "cards", "card-map.json"), "utf8")); } catch (e) {}
// 검증된 세트 팩트(정가·재판) — data/set-facts.json (연구 워크플로 산출, 나이틀리 불변)
let SET_FACTS = { sets: {} };
try { SET_FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-facts.json"), "utf8")); } catch (e) {}
// 세트별 수기 해설 — data/set-commentary.json (사람이 쓴 문장, 기계 생성 금지).
// 왜: 2026-08-07 애드센스가 "가치가 별로 없는 콘텐츠"로 거절했다. 실측하니 세트 페이지 21장이
// 문장 기준 63% 동일(숫자만 교체된 템플릿)이었다 — 정확히 그 정책이 가리키는 형태다.
// 페이지마다 "그 세트에만 참인 이야기"가 있어야 하고, 그 원문은 이 파일 하나에서 온다(가드 S3).
let COMMENTARY = { sets: {} };
try { COMMENTARY = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-commentary.json"), "utf8")); } catch (e) {}
// 자연검색 핵심 랜딩의 검색 의도 원문. 가격은 아래 생성기가 검증 데이터에서 매번 채우고,
// 이 파일은 세트별 맥락·재판 해석·실링 체크처럼 자동으로 지어내면 안 되는 문장만 보관한다.
let PRIORITY_SET_SEO = { sets: {} };
try { PRIORITY_SET_SEO = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "priority-set-seo.json"), "utf8")); } catch (e) {}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---- 실데이터 구워넣기용 헬퍼 (가격은 항상 "as of 날짜"로 정직하게, 매일 재생성으로 최신 유지)
const FX = data.fx || {};
const DATA_DATE = data.updated || new Date().toISOString().slice(0, 10);
const jpyUsd = (jpy) => (Number.isFinite(jpy) && FX.jpyKrw && FX.usdKrw ? (jpy * FX.jpyKrw) / FX.usdKrw : null);
const krwUsd = (krw) => (Number.isFinite(krw) && FX.usdKrw ? krw / FX.usdKrw : null);
// 서술 블록(궤적·verdict·keyFacts)의 가격 소스 = 차트와 같은 sold 시리즈(USD, 판매일 기준) — 2026-08-21.
// 종전 boxSeries(외부 KRW 주간시세)는 20/21 세트가 07-11~13 에 멈춰 "as of 2026-07-12" 가
// 오늘 날짜 페이지에 그대로 나갔고, 환율도 1548.63 하드코딩이었다. 한 페이지에 서로 다른
// 박스 가격이 3개 공존하는 문제의 근원. 시리즈가 곧 차트이므로 이제 문장과 그림이 같은 숫자를 말한다.
const soldPts = (code, ed) => (((SOLD_SERIES.sets || {})[code] || {})[ed] || []).filter((pt) => pt && pt.median != null).map((pt) => ({ d: pt.d, p: pt.median }));
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
// TCGplayer 단일 리스팅 폴백가(priceUsd)의 이상치 표시.
// 왜: priceUsd 는 변형매칭 미확정(variantOK undefined) 단일 호가라 트롤/오매칭 값이 섞인다.
// 실제 라이브 사고(2026-07-21 감사): EB-02 Boa Hancock $6,969.69(69 밈), OP-09 Gol D. Roger $6,720.
// 세트 안에서 혼자 튀는 스파이크(2등의 2배 초과 & $3,000 초과)만 억제한다 — 정상 체이스카드는 보존.
// 원칙: "빈 칸이 틀린 숫자보다 낫다". 억제된 카드는 NM 열이 "—" 로 나간다.
function markTcgOutliers(cards) {
  const vals = cards
    .filter((c) => c.nmJpy == null && typeof c.priceUsd === "number")
    .map((c) => c.priceUsd)
    .sort((a, b) => b - a);
  const bad = new Set();
  // 위에서부터: 현재 최고가가 (다음 서로 다른 값의 2배 & $3,000) 을 넘으면 고립 스파이크로 판정하고 계속.
  for (let i = 0; i < vals.length; i++) {
    const next = vals.find((v) => v < vals[i]);
    if (next != null && vals[i] > 3000 && vals[i] > next * 2) bad.add(vals[i]);
    else break;
  }
  for (const c of cards) {
    if (c.nmJpy == null && typeof c.priceUsd === "number" && bad.has(c.priceUsd)) c._tcgOutlier = true;
  }
}

// 카드별 표시가: NM(생) + PSA10(sold 우선, 없으면 ask). 불확실하면 null → 표에 "—"
function cardPrices(c) {
  let nm = jpyUsd(c.nmJpy);
  let nmSrc = c.nmJpy != null ? "jp" : null;
  // priceUsd 폴백은 이상치(트롤/오매칭)면 버린다 — markTcgOutliers 가 세트 단위로 표시해 둔다.
  if (nm == null && typeof c.priceUsd === "number" && !c._tcgOutlier) { nm = c.priceUsd; nmSrc = "tcg"; } // 일본 NM 리서치 전(예: OP-16): TCGplayer USD 시세 폴백, 라벨은 TCG로 정직 표기
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

function head({ title, desc, canonical, ogType = "article", extraLd = "", koHref = "" }) {
  // hreflang 은 반드시 양방향이어야 구글이 인정한다. ko 짝이 있을 때만, en(자기)·ko·x-default 를 함께 선언.
  // (ko 페이지는 이미 en 을 가리키는데 en 쪽이 침묵해서 단방향으로 무시되던 문제 — 2026-07-21 감사)
  const hreflang = koHref
    ? `\n    <link rel="alternate" hreflang="en" href="${canonical}" />\n    <link rel="alternate" hreflang="ko" href="${koHref}" />\n    <link rel="alternate" hreflang="x-default" href="${canonical}" />`
    : "";
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
    <!-- AdSense is intentionally limited to substantial editorial/core pages during site approval.
         Set guides keep eBay EPN links but do not request Google ads. -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />${hreflang}
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
    <link rel="stylesheet" href="../styles.css?v=${CSS_VER}" />
    <style>
      .setHero { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
      .setHero img { width: 132px; border-radius: 10px; border: 1px solid var(--line); }
      .liveBox { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--line); border-radius: 12px; background: rgba(16,215,160,.05); }
      .liveBox b { font-size: 20px; color: var(--accent); }
      .liveBox small { color: var(--muted); display: block; margin-top: 4px; }
      .chaseList li { margin: 6px 0; }
      .ctaRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .ctaRow a { display: inline-flex; align-items: center; min-height: 42px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); font-weight: 800; }
      .ctaRow a.primary { background: rgba(16,215,160,.14); border-color: rgba(16,215,160,.5); color: var(--accent); }
      .setNavLinks { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; color: var(--muted); font-size: 14px; }
      .affNote { margin-top: 16px; color: var(--muted); font-size: 11px; opacity: .8; }
      /* 접어둔 설명 묶음 — 눌러야 펴진다. 화면 기본값은 숫자만 보이는 상태다. */
      .setMore { margin: 22px 0 0; border-top: 1px solid var(--line); }
      .setMore > summary { cursor: pointer; padding: 12px 0; font-size: 14px; font-weight: 700; color: var(--muted); list-style: none; }
      .setMore > summary::-webkit-details-marker { display: none; }
      .setMore > summary::before { content: "▸ "; color: var(--accent); }
      .setMore[open] > summary::before { content: "▾ "; }
      .setMore > summary:hover { color: var(--ink); }
      .setMore > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .setMore .searchIntent, .setMore .setStory { margin-top: 4px; }
      /* EPN 제휴 고지 — 접힘선 위. 푸터 고지(11px)만으로는 눈에 안 띈다는 지적을 받았다(2026-08-10).
         작게 줄이거나 opacity 를 낮추지 말 것. */
      .affTop { display: block; margin: 12px 0 0; padding: 0 0 0 10px; border-left: 2px solid var(--line); color: var(--muted); font-size: 14px; line-height: 1.55; max-width: 760px; }
      .affTop b { color: inherit; font-weight: 600; }
      .dataSummary { margin: 10px 0 0; color: var(--muted); font-size: 14px; }
      .dataSummary b { color: var(--accent); font-weight: 800; }
      /* 세트 지표 격자 — 2026-08-20. 숫자 하나만 주면 그게 높은지 낮은지 알 수 없다.
         모든 값 아래에 21세트 중앙값을 기준선으로 붙이고, 그 대비 방향을 화살표로 준다. */
      .statHint { margin-top: 6px; font-size: 11px; color: var(--muted, #8090b0); line-height: 1.45; }
      .gradeTrio { font-size: 12px; white-space: nowrap; }
      .statGrid { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); gap: 10px; margin: 16px 0 6px; max-width: 760px; }
      .statCard { padding: 12px 14px; border: 1px solid rgba(255,255,255,.10); border-radius: 12px; background: rgba(255,255,255,.02); }
      .statLabel { font-size: 11px; letter-spacing: .09em; text-transform: uppercase; color: var(--muted, #9aa4b6); font-weight: 700; }
      /* 숫자가 주인공이다 — 28px/700. 라벨은 10.5px 대문자로 물러난다(TCG 퀀트 실측 규칙).
         tabular-nums 로 자릿수를 고정해야 카드끼리 세로로 줄이 맞는다. */
      .statValue { margin-top: 5px; font-size: 28px; font-weight: 700; line-height: 1.12; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
      .statBase { margin-top: 5px; font-size: 12px; color: var(--muted, #9aa4b6); line-height: 1.45; }
      .statUp { color: #00e5a0; font-weight: 700; }
      .statDown { color: #ff5f6e; font-weight: 700; }
      .statFlat { color: #8090b0; font-weight: 700; }
      .keyFacts { margin: 14px 0 4px; padding: 12px 16px 12px 32px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 680px; font-size: 14px; line-height: 1.65; }
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
      .gearRec { margin: 12px 0 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 10px; background: rgba(16,215,160,.05); font-size: 14px; line-height: 1.55; color: var(--muted); }
      .gearRec strong { color: #eef2ff; }
      .gearRec a { color: var(--accent); font-weight: 800; white-space: nowrap; }
    </style>
    <style id="opBoxChartCss">${BoxChart.CSS}</style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="index.html" aria-current="page" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="bodyPage">`;
}

// EPN 규정(Participation Requirements I.G.) — 제휴 고지는 "명확하고 눈에 띄게" 있어야 한다.
// 2026-08-10 EPN 위반 통지: 문구는 적절하나 푸터에 있어 잘 보이지 않는다. 그래서 본문 상단에도 넣는다.
// 푸터의 affNote 는 그대로 두고 이걸 추가하는 것이다 — 둘 중 하나를 지우지 말 것.
const AFF_TOP = `<p class="affTop"><b>Paid Link:</b> As an eBay Partner Network affiliate, we earn from qualifying purchases.</p>`;

const FOOT = `
      <script src="../box-chart.js?v=${CSS_VER}" defer></script>
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this page — at no extra cost to you.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../free-data.html">Data terms</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
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
              var fullRate = s.psaFull && s.psaFull.gemRate;
              if (fullRate != null) meta.push("Full-set PSA10 rate " + fullRate + "%");
              document.getElementById("lpMeta").textContent = meta.join(" · ");
              document.getElementById("livePrice").hidden = false;
            })
            .catch(function () {});
        })();
      </script>`;
}

// FAQ Q&A — JSON-LD 와 화면 렌더가 반드시 같은 텍스트를 써야 한다.
// 구글은 본문에 없는 FAQPage 구조화데이터를 스팸으로 취급하고(리치결과는 2023년 폐지),
// 숨긴 FAQ 는 이득 0·리스크만 있다. 그래서 한 소스에서 뽑아 양쪽에 쓴다 — 2026-07-21 감사.
function faqItems(code, nameEn) {
  // FAQ도 세트별 해설에서만 만든다. 가격·체이스·매수 판단의 공통 3문답을 21페이지에
  // 복제하던 구조가 최종 HTML 반복률을 크게 높였기 때문에 공통 문답은 방법론 페이지로 통합했다.
  const story = COMMENTARY.sets?.[code];
  return story ? [{
      q: `What makes ${code} ${nameEn} stand out from other One Piece sets?`,
      a: story.desc,
    }] : [{
      q: `Where is the current ${code} ${nameEn} market data?`,
      a: `The price table and tracker links on this page show the currently available ${code} market observations.`,
    }];
}

// 화면에 보이는 FAQ 섹션 — faqLd 와 동일 Q&A. 구조화데이터와 본문 일치를 보장.
function faqHtml(code, nameEn) {
  return `
      <section class="setFaq" aria-label="${esc(`${code} ${nameEn} frequently asked questions`)}">
        <h2>${code} ${esc(nameEn)} — frequently asked questions</h2>
        ${faqItems(code, nameEn).map((x) => `<details><summary>${esc(x.q)}</summary><p>${esc(x.a)}</p></details>`).join("\n        ")}
      </section>`;
}

function faqLd(code, nameEn) {
  const q = faqItems(code, nameEn);
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

// ── top10 카드의 등급사별 감정 현황 — 2026-08-20.
// TCG 퀀트에는 없는 우리 데이터다. 그쪽은 카드 시세만 주지, "그 카드가 어디에 몇 장 맡겨졌고
// 10 이 몇 %인가"는 없다. 우리는 PSA·CGC·TAG 를 각각 카드 단위로 쌓고 있으므로 그걸 보여준다.
//
// 10 의 정의가 회사마다 달라(CGC 는 Pristine 10 과 Gem Mint 10 이 따로, TAG 는 10 과 10P)
// 회사별로 따로 적고 합계를 만들지 않는다. 합치면 서로 다른 기준을 한 숫자로 뭉개는 셈이다.
const CARD_GRADES = (() => {
  const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8")); } catch { return null; } };
  const psa = read("psa-card-pop.json"), cgc = read("cgc-card-pop.json"), tag = read("tag-card-pop.json");
  let ourTier;
  try { ({ ourTier } = require("./cgc-card-pop-ingest.js")); } catch { return {}; }
  const pick = (src, code, key) => {
    const st = src?.sets?.[code];
    if (!st) return null;
    const node = st[key] || st.jp?.[key];
    return Array.isArray(node) && node.length ? node[node.length - 1] : null;
  };
  const out = {};
  for (const [code, set] of Object.entries(data.sets || {})) {
    for (const c of set.cards || []) {
      if (!c.number) continue;
      const key = c.number + "|" + ourTier(c.name);
      const p = pick(psa, code, key), g = pick(cgc, code, key), t = pick(tag, code, key);
      const row = {};
      if (p?.total) row.psa = { n: p.total, gem: p.g10 != null ? Math.round((p.g10 / p.total) * 100) : null };
      if (g?.total) row.cgc = { n: g.total, gem: g.g ? Math.round((((g.g["Gem Mint 10"] || 0) + (g.g["Pristine 10"] || 0)) / g.total) * 100) : null };
      if (t?.total) row.tag = { n: t.total, gem: t.g ? Math.round((((t.g["10"] || 0) + (t.g["10P"] || 0)) / t.total) * 100) : null };
      if (Object.keys(row).length) out[code + "|" + c.number] = row;
    }
  }
  return out;
})();

// ── 세트 지표와 그 기준선 — 2026-08-20.
// 값 하나만 보여주면 읽는 쪽이 그게 높은지 낮은지 알 수 없다. 전 세트를 한 번 훑어 중앙값을 구해 두고
// 각 페이지에서 "21-set median 대비 ±%"를 같이 낸다.
//
// 중앙값을 쓰는 이유: OP-01(PSA 57,143 · 박스 $305)이 평균을 통째로 끌어올린다. 평균 대비로 보면
// 대부분의 세트가 "평균 이하"로 나와 정보가 안 된다.
//
// 재고일수 = 지금 걸린 매물 ÷ 하루 판매 속도(주간 거래건수 ÷ 7). 물건이 며칠 만에 빠지는가를 뜻한다.
// 매물 수만으로는 큰 세트와 작은 세트를 비교할 수 없어서 속도로 나눈다.
const SET_METRICS = (() => {
  let series;
  try { series = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8")); } catch { return {}; }
  const out = {};
  for (const [code, v] of Object.entries(series.sets || {})) {
    const jp = v.jp;
    if (!Array.isArray(jp) || jp.length < 5) continue;
    const last = jp[jp.length - 1];
    const prior = jp[Math.max(0, jp.length - 5)];   // 4주 전
    const sup = (v.supply || []).slice(-1)[0];
    const set = data.sets[code] || {};
    const weekN = last.n || 0;
    const stock = sup ? sup.jp : null;
    out[code] = {
      price: last.median != null ? Math.round(last.median) : null,
      chg: prior && prior.median ? Number(((last.median / prior.median - 1) * 100).toFixed(1)) : null,
      stock,
      days: stock != null && weekN ? Number((stock / (weekN / 7)).toFixed(1)) : null,
      psa: set.psaFull?.total ?? null,
      gem: set.psaFull?.gemRate ?? null,
    };
  }
  return out;
})();

const SET_BASELINE = (() => {
  const med = (key) => {
    const a = Object.values(SET_METRICS).map((m) => m[key]).filter((x) => x != null).sort((x, y) => x - y);
    return a.length ? a[Math.floor(a.length / 2)] : null;
  };
  return { price: med("price"), chg: med("chg"), days: med("days"), psa: med("psa"), gem: med("gem") };
})();

function setPage(code, prev, next) {
  const s = data.sets[code];
  // psaFull 이 세트 단위 PSA 수치의 유일한 출처다 — 2026-08-19.
  // 종전에는 psaGem/psaTotal 로 폴백했는데 그 둘은 2026-07-15 수동 기입 후 갱신하는 코드가 없었다.
  // 폴백이 있으면 psaFull 이 빈 세트에서 한 달 묵은 값이 아무 표시 없이 화면에 나간다.
  // 값이 없으면 비워 두는 편이 낫다 — 빈칸은 눈에 띄지만 낡은 숫자는 안 띈다.
  const fullPsaRate = s.psaFull?.gemRate;
  const fullPsaTotal = s.psaFull?.total;
  const nameEn = s.nameEn || code;
  const cards = (s.cards || []).slice(0, 10);
  markTcgOutliers(cards);   // 트롤/오매칭 TCGplayer 폴백가 억제 (cardPrices 호출 전에 표시해 둔다)
  const canonical = `${SITE}/sets/${slug(code)}.html`;
  const prioritySeo = PRIORITY_SET_SEO.sets?.[code];
  const title = `${prioritySeo?.title || `${code} ${nameEn} Booster Box Price (Japanese)`} | OP Box Index`;
  // 해설의 desc 를 우선 사용 — 57개 페이지가 같은 문장 골격의 description 을 나눠 쓰면
  // 그것부터 템플릿 신호다. 해설이 없는 세트만 기존 골격으로 떨어진다.
  const story = COMMENTARY.sets?.[code];
  if (!story) console.warn(`[set-commentary] ${code} 해설 없음 — 템플릿 문구로 대체됨 (S3 가드가 잡는다)`);
  const desc = prioritySeo?.description || story?.desc || `${code} ${nameEn} Japanese booster box price from eBay sold + listing data, top chase cards, PSA 10 population, and a buy-or-skip verdict.`;
  const ebaySearch = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece Card Game ${code} ${nameEn} Booster Box Japanese sealed`)}&LH_BIN=1&_sop=15&${EPN}`;
  // s.release = 영문(NA)판 발매일. "일본판 페이지인데 Released=EN날짜"로 읽히던 오표기 수정
  const release = s.release ? `<p class="eyebrow">Japanese edition · EN release ${esc(s.release)}</p>` : `<p class="eyebrow">Japanese edition</p>`;

  const enc = encodeURIComponent(code);

  // 실데이터 표(구워넣기): 순위·카드·NM(생)·PSA10(sold 우선). 값 없으면 "—"
  // 개별 카드 페이지가 있으면 이름에 링크 (cards/card-map.json — generate-card-pages.js 산출물)
  // 등급사별 감정 수와 10 비율. 회사마다 10 의 정의가 달라 합치지 않고 나란히 적는다.
  const gradeCell = (setCode, num) => {
    const g = CARD_GRADES[setCode + "|" + (num || "")];
    if (!g) return "—";
    const bit = (o) => (o ? `${intl(o.n)}${o.gem != null ? ` <span class="psaKind">${o.gem}%</span>` : ""}` : "—");
    return `<span class="gradeTrio">${bit(g.psa)} / ${bit(g.cgc)} / ${bit(g.tag)}</span>`;
  };

  const rows = cards.map((c, i) => {
    const p = cardPrices(c);
    const cardHref = CARD_MAP[(c.number || "") + "|" + String(c.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")];
    const nameCell = cardHref ? `<a href="../cards/${cardHref}"><strong>${esc(c.name)}</strong></a>` : `<strong>${esc(c.name)}</strong>`;
    return `<tr><td>${i + 1}</td><td>${nameCell}<span class="cNum">${esc(c.number || "")}${c.rarity ? ` · ${esc(rarityLabel(c.rarity))}` : ""}</span></td><td class="num">${p.nm != null ? `${usd(p.nm)}${p.nmSrc === "tcg" ? ` <span class="psaKind">TCG</span>` : ""}` : "—"}</td><td class="num">${p.psa != null ? `${usd(p.psa)} <span class="psaKind">${p.psaKind === "sold" ? "sold" : "ask"}</span>` : "—"}</td><td class="num">${gradeCell(code, c.number)}</td></tr>`;
  }).join("\n            ");

  // 세트 요약 라인 (안정 데이터)
  const summaryBits = [];
  if (s.release) summaryBits.push(`EN release <b>${esc(monthYear(s.release))}</b>`);
  if (s.cardCount) summaryBits.push(`<b>${esc(String(s.cardCount))}</b> cards`);
  if (fullPsaRate != null) summaryBits.push(`Full-set PSA 10 gem rate <b>${esc(String(fullPsaRate))}%</b>${fullPsaTotal ? ` (${intl(fullPsaTotal)} graded)` : ""}`);
  const summaryLine = summaryBits.length ? `<p class="dataSummary">${summaryBits.join(" · ")}</p>` : "";

  // 데이터 기반 분석 문단 (세트마다 고유)
  const top = cards[0], tp = top ? cardPrices(top) : {};
  const allTcg = cards.length > 0 && cards.every((c) => cardPrices(c).nmSrc === "tcg"); // OP-16 등 TCGplayer 시세만 있는 세트: NM 설명 문구를 정직하게 교체
  const analysis = top ? `The chase in ${code} is led by <strong>${esc(top.name)}</strong>${top.rarity ? ` (${esc(rarityLabel(top.rarity))})` : ""}${tp.nm != null ? `, ${tp.nmSrc === "tcg" ? `with a TCGplayer market price around ${usd(tp.nm)}` : `whose raw Japanese NM copy runs about ${usd(tp.nm)}`}` : ""}${tp.psa != null ? ` and ${tp.psaKind === "sold" ? "whose PSA 10 examples have sold" : "whose PSA 10 copies list"} near ${usd(tp.psa)}` : ""}.` : "";

  // 박스 시세 궤적 (세트별 고유 수치 — 차트와 같은 sold 시리즈 기반)
  let trajectory = "";
  const bs = soldPts(code, "jp");
  if (bs.length >= 8) {
    const toU = (v) => Math.round(v);
    const first = bs[0], last = bs[bs.length - 1];
    const peak = bs.reduce((a, b) => (b.p > a.p ? b : a), bs[0]);
    const chg = Math.round((last.p / first.p - 1) * 100);
    const dir = chg >= 3 ? `gained <strong>${chg}%</strong>` : chg <= -3 ? `fell <strong>${Math.abs(chg)}%</strong>` : `held roughly flat (<strong>${chg >= 0 ? "+" : ""}${chg}%</strong>)`;
    const en = soldPts(code, "en");
    let enBit = "";
    if (en.length >= 8) {
      const enLast = en[en.length - 1], enChg = Math.round((enLast.p / en[0].p - 1) * 100);
      const ratio = (enLast.p / last.p).toFixed(1);
      enBit = ` The English-language ${esc(s.nameEn || code)} box trades near <strong>${usd(toU(enLast.p))}</strong> over the same period (${enChg >= 0 ? "+" : ""}${enChg}% over its tracked window) — about <strong>${ratio}x</strong> the Japanese box. This ratio does not explain why.`;
    }
    trajectory = `
      <h2>${code} box price: the tracked trajectory</h2>
      <p>The Japanese ${esc(s.nameEn || code)} sealed box entered our tracking in ${monthYear(first.d) || esc(first.d)} around <strong>${usd(toU(first.p))}</strong> and stands near <strong>${usd(toU(last.p))}</strong> as of ${esc(last.d)} — it ${dir} over the window, peaking at <strong>${usd(toU(peak.p))}</strong> in the week of ${esc(peak.d)}.${enBit}</p>`;
  }

  // 주간 PSA 인구 증가 — psaWeekly 기반, 세트별 고유. 실제 개봉량으로 표현하지 않는다.
  let momentum = "";
  const wk = s.psaWeekly && Array.isArray(s.psaWeekly.points) ? s.psaWeekly.points : [];
  if (wk.length >= 3) {
    const sum = wk.reduce((a, b) => a + b.v, 0);
    const pk = wk.reduce((a, b) => (b.v > a.v ? b : a), wk[0]);
    const lastW = wk[wk.length - 1];
    const trend = lastW.v >= pk.v * 0.85 ? "still running near its peak" : lastW.v <= pk.v * 0.55 ? "cooling off from its peak" : "steady";
    momentum = `
      <h2>How fast is the ${code} PSA population growing?</h2>
      <p>For ${esc(s.nameEn || code)}, between ${esc(wk[0].d)} and ${esc(lastW.d)}, the recorded PSA population increased by <strong>${intl(sum)}</strong> grades — peaking at <strong>${intl(pk.v)}</strong> in the week of ${esc(pk.d)}, with the latest week at ${intl(lastW.v)} (${trend}). ${s.psaFull && s.psaFull.total ? `The all-time set total is <strong>${intl(s.psaFull.total)}</strong>.` : ""} Grades are not a box-opening count.</p>`;
  }

  // 현재 가격 구간 해설 — 실데이터 파생, 미래 가격이나 구매 결론은 만들지 않는다.
  let verdict = "";
  {
    const pts = soldPts(code, "jp");
    if (pts.length >= 8) {
      const vFirst = pts[0].p, vLast = pts[pts.length - 1].p;
      const vPeak = Math.max(...pts.map((p) => p.p));
      const dd = vPeak > 0 ? Math.round(((vPeak - vLast) / vPeak) * 100) : 0;
      const chg = vFirst > 0 ? Math.round(((vLast - vFirst) / vFirst) * 100) : 0;
      const tp0 = cards.length ? cardPrices(cards[0]) : {};
      const topNm = tp0.nm != null ? tp0.nm : null;
      const mult = topNm && vLast ? topNm / vLast : null;
      const nowLabel = monthYear(DATA_DATE) || "today";
      let priceRead;
      if (dd >= 20) priceRead = `The current value is about <strong>${dd}% below the tracked peak</strong> (${usd(vPeak)} → ${usd(vLast)}). Past peaks do not set future floors.`;
      else if (chg >= 15 && dd < 10) priceRead = `The box sits near its tracked high (${usd(vLast)} vs peak ${usd(vPeak)}, ${chg >= 0 ? "+" : ""}${chg}% over our window). It is a comparison, not a forecast.`;
      else priceRead = `The box trades at ${usd(vLast)}, ${dd}% under its tracked peak of ${usd(vPeak)} and ${chg >= 0 ? "up " + chg + "%" : "down " + Math.abs(chg) + "%"} over our tracking window.`;
      const chaseRead = mult != null
        ? (mult >= 3
          ? ` The top card alone (${esc(cards[0].name)}) is worth about <strong>${mult >= 10 ? Math.round(mult) : mult.toFixed(1)}x the box</strong>, so the visible chase value is highly concentrated. Official pull rates are unpublished. It is not opening expected value.`
          : ` The top chase (${esc(cards[0].name)}) runs about ${mult.toFixed(1)}x the box price. Check the full top-10 distribution. This ratio is not opening EV.`)
        : "";
      verdict = `
      <h2>How the ${code} box price compares with its tracked range (${esc(nowLabel)})</h2>
      <p>${priceRead}${chaseRead}</p>`;
    }
  }

  // 재판 이력 + 발매 정가 — 검증된 팩트(data/set-facts.json). 반다이는 세트별 재판 미발표.
  // 정가 대비 배수는 2026-07-29 소유자 판단으로 사이트 전체에서 제거했다(쓸모없다고 봄).
  let reprintBlock = "";
  {
    const sf = (SET_FACTS.sets && SET_FACTS.sets[code]) || null;
    if (sf && sf.jpMsrpYen) {
      const msrpUsd = FX.jpyKrw && FX.usdKrw ? Math.round((sf.jpMsrpYen * FX.jpyKrw) / FX.usdKrw) : null;
      const pts2 = soldPts(code, "jp");
      const nowU = pts2.length ? pts2[pts2.length - 1].p : null;
      const mult = msrpUsd && nowU ? (nowU / msrpUsd).toFixed(1) : null;
      const recs = sf.reprintRecords || [];
      // 기록의 성격을 나눈다. 매장 재입고 공지를 "반다이가 재판을 발표했다" 처럼 읽히게 두면 안 된다.
      // 추첨판매는 **발매 전**에도 열린다(초회 물량 선판매). 그건 물량이 다시 풀린 게 아니므로
      // 재공급으로 세면 안 된다 — OP-17 은 발매 2026-08-22 인데 추첨이 7/30·8/7~18 이었다.
      const isPre = (r) => /pre-release/i.test(r.kind || "");
      const isUnverified = (r) => /unverified-timing/i.test(r.kind || "");
      const isOfficial = (r) => /official/i.test(r.kind || "") && !isUnverified(r);
      const isDistributor = (r) => /distributor/i.test(r.kind || "");
      const monthOf = (d) => (d && /^\d{4}-\d{2}$/.test(d) ? monthYear(d + "-01") || d : d || "");
      // 소스 URL 이 살아있는 http 링크일 때만 클릭 링크. 죽은/빈 소스는 텍스트로(죽은 링크 노출 방지 — 2026-07-21 감사).
      const item = (r) => {
        const live = typeof r.source === "string" && /^https?:\/\//.test(r.source) && !r.sourceDead;
        const when = esc(monthOf(r.date));
        return live ? `<a href="${esc(r.source)}" target="_blank" rel="noopener nofollow">${when}</a>` : when;
      };
      const pre = recs.filter(isPre);
      const unver = recs.filter(isUnverified);
      const official = recs.filter(isOfficial), distrib = recs.filter(isDistributor);
      const retail = recs.filter((r) => !isPre(r) && !isUnverified(r) && !isOfficial(r) && !isDistributor(r));
      const lines = [];
      // 사전추첨(발매 전 초회 물량 선배분)은 이 섹션에 싣지 않는다 — 추가 공급이 아니라서
      // "재판·공급" 맥락에 두면 물량이 늘어난 것처럼 읽힌다. 데이터에는 남아 있다(pre-release-lottery).
      if (official.length) lines.push(`<li>Post-release lottery sale: ${official.map(item).join(", ")} — a Premium Bandai / Bandai Namco shop draw held after release. Bandai does not call these reprints, so we do not either.</li>`);
      if (unver.length) lines.push(`<li>Lottery sale: ${unver.map(item).join(", ")} — we could not verify whether this ran before or after the Japanese release, so we do not claim it added supply.</li>`);
      if (distrib.length) lines.push(`<li>Distributor reprint: ${distrib.map(item).join(", ")}.</li>`);
      if (retail.length) {
        lines.push(`<li>Retailer-reported restocks: ${retail.map(item).join(", ")} — store restock notices, not a Bandai reprint announcement.</li>`);
      }
      if (!lines.length) lines.push("<li>No reprint or restock record in our source ledger.</li>");
      // 재판은 "최초 발매 대비" 개념이라 기준일이 있어야 읽힌다. 공식 출처로 확인한 일본판 발매일만 싣는다
      // (페이지 상단의 release 는 영문판 날짜라 여기 기준으로 쓸 수 없다).
      const jpRel = sf.jpRelease && sf.jpRelease.date
        ? `<li>Original Japanese release: <strong>${esc(sf.jpRelease.date)}</strong>${
            sf.jpRelease.source ? ` (<a href="${esc(sf.jpRelease.source)}" target="_blank" rel="noopener nofollow">Bandai official</a>)` : ""
          }.</li>`
        : "";
      reprintBlock = `
      <h2>Reprints &amp; original price</h2>
      <ul class="keyFacts">
        ${jpRel}
        <li>Original Japanese MSRP: <strong>¥${sf.jpMsrpYen.toLocaleString()}</strong> per ${sf.packsPerBox}-pack box (about $${msrpUsd}).</li>
        ${lines.join("\n        ")}
      </ul>`;
    }
  }

  // 핵심 자연검색 랜딩: 현재 가격, 재판 근거, factory-seal 판별을 첫 화면 가까이에서 직접 답한다.
  // 수동 문장과 검증된 가격 데이터를 분리해 야간 재생성 때도 최신값과 고유 해설을 함께 유지한다.
  let searchIntentBlock = "";
  if (prioritySeo) {
    const seriesPoints = soldPts(code, "jp");
    const latestPoint = seriesPoints.length ? seriesPoints[seriesPoints.length - 1] : null;
    const latestValue = latestPoint ? latestPoint.p : null;
    const active = s.boxMarket?.jp?.ebayActive;
    const activeMiddle = active?.middle != null ? toUsd(active.middle, active.currency) : null;
    const priceParts = [];
    if (activeMiddle != null && (active.sampleSize || 0) >= 3) {
      priceParts.push(`As of ${esc(active.updated || DATA_DATE)}, current eBay asks center near <strong>${usd(activeMiddle)}</strong> across ${active.sampleSize} verified listings.`);
    }
    if (latestValue != null) priceParts.push(`Completed eBay sales last put the box near <strong>${usd(latestValue)}</strong> on ${esc(latestPoint.d)}.`);
    searchIntentBlock = `
      <section class="searchIntent" aria-label="${esc(`${code} price, reprint and factory-seal summary`)}">
        <h2>${esc(prioritySeo.heading)}</h2>
        <p>${priceParts.join(" ")} ${esc(prioritySeo.marketContext)}</p>
        <p><strong>Reprint record:</strong> ${esc(prioritySeo.reprintContext)}</p>
        <p><strong>Factory-seal check:</strong> ${esc(prioritySeo.sealContext)}</p>
      </section>`;
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
  // ── 세트 지표 격자 — 2026-08-20.
  // TCG 퀀트가 하는 방식: 값 하나를 던지지 않고 항상 "전체 대비 어디쯤인가"를 같이 준다.
  // 기준선은 21세트 중앙값이다(평균이 아니라 중앙값 — OP-01 같은 극단값이 기준을 끌어올린다).
  let statGrid = "";
  {
    const base = SET_BASELINE;   // 아래에서 전 세트를 한 번 훑어 만들어 둔 값
    const cells = [];
    const cmp = (v, b, higherIsBetter = true, unit = "") => {
      if (v == null || b == null || !b) return "";
      const pct = Math.round((v / b - 1) * 100);
      if (pct === 0) return `<span class="statFlat">= median</span>`;
      const cls = (pct > 0) === higherIsBetter ? "statUp" : "statDown";
      return `<span class="${cls}">${pct > 0 ? "▲" : "▼"} ${pct > 0 ? "+" : ""}${pct}%</span>`;
    };
    const cell = (label, value, baseText) => cells.push(
      `<div class="statCard"><div class="statLabel">${label}</div><div class="statValue">${value}</div><div class="statBase">${baseText}</div></div>`);

    const m = SET_METRICS[code] || {};
    if (m.price != null) cell("Box price (JP)", usd(m.price), `21-set median ${usd(base.price)} ${cmp(m.price, base.price)}`);
    if (m.chg != null) {
      const cls = m.chg > 0 ? "statUp" : m.chg < 0 ? "statDown" : "statFlat";
      cell("4-week change", `<span class="${cls}">${m.chg > 0 ? "+" : ""}${m.chg}%</span>`, `21-set median ${base.chg > 0 ? "+" : ""}${base.chg}%`);
    }
    // 재고일수 = 지금 걸린 매물 ÷ 하루 판매 속도. 낮을수록 물건이 빨리 빠진다는 뜻이라 higherIsBetter=false.
    if (m.days != null) cells.push(`<div class="statCard"><div class="statLabel">Days of inventory</div><div class="statValue">${m.days}d</div><div class="statBase">${m.stock} listed · 21-set median ${base.days}d ${cmp(m.days, base.days, false)}</div><div class="statHint">How long the listings on sale would last at the current selling pace. Fewer days means stock is clearing.</div></div>`);
    if (m.psa != null) cell("PSA graded", intl(m.psa), `21-set median ${intl(base.psa)} ${cmp(m.psa, base.psa)}`);
    if (m.gem != null) cells.push(`<div class="statCard"><div class="statLabel">PSA 10 rate</div><div class="statValue">${m.gem}%</div><div class="statBase">21-set median ${base.gem}% ${cmp(m.gem, base.gem)}</div><div class="statHint">Share of PSA submissions from this set that came back a 10.</div></div>`);
    // ── 싱글카드 구성 — 2026-08-20. TCG 퀀트의 SINGLES INTEL 을 우리 데이터로 낸다.
    // 박스를 뜯는 사람이 실제로 묻는 것: "대박 하나에 몰려 있나, 아니면 두루 값이 나가나".
    // 그쪽과 대조해 보니 OP-01 chase concentration 이 53% 로 정확히 일치했다.
    {
      const top = (s.cards || []).slice(0, 10)
        .map((c) => (c.nmJpy != null && FX.jpyKrw && FX.usdKrw ? (c.nmJpy * FX.jpyKrw) / FX.usdKrw : c.priceUsd ?? null))
        .filter((v) => v != null && v > 0)
        .sort((a, b) => b - a);
      if (top.length >= 5) {
        const total = top.reduce((a, v) => a + v, 0);
        const dense = top.filter((v) => v >= 25).length;
        const conc = Math.round((top[0] / total) * 100);
        cells.push(`<div class="statCard"><div class="statLabel">Value density</div><div class="statValue">${dense} / ${top.length}</div><div class="statHint">Cards worth $25+ in the top ${top.length}. More means demand spreads beyond one chase.</div></div>`);
        cells.push(`<div class="statCard"><div class="statLabel">Chase concentration</div><div class="statValue">${conc}%</div><div class="statHint">Share of top-${top.length} value held by the #1 card. The higher this runs, the more the set rides on one pull.</div></div>`);
        cells.push(`<div class="statCard"><div class="statLabel">Floor of the top ${top.length}</div><div class="statValue">${usd(Math.round(top[top.length - 1]))}</div><div class="statHint">What the cheapest tracked chase card is worth — value without hitting the big one.</div></div>`);
      }
    }

    if (cells.length >= 3) statGrid = `<section aria-label="Set metrics"><div class="statGrid">${cells.join("")}</div></section>`;
  }

  let keyFacts = "";
  {
    const facts = [];
    // 주 팩트는 차트와 같은 sold 시리즈 기준 — 페이지 내 다른 수치(궤적·verdict)와 일치해야 함.
    const serPts = soldPts(code, "jp");
    const serLast = serPts.length ? serPts[serPts.length - 1] : null;
    const jpVal = serLast ? serLast.p : null;
    if (jpVal != null) facts.push(`As of ${esc(serLast.d)}, a sealed ${code} Japanese booster box has a market value of about <strong>${usd(jpVal)}</strong>.`);
    const bmA = s.boxMarket && s.boxMarket.jp && s.boxMarket.jp.ebayActive;
    const midA = bmA && bmA.middle != null ? toUsd(bmA.middle, bmA.currency) : null;
    if (midA != null && (bmA.sampleSize || 0) >= 5) facts.push(`Current eBay asking prices run around <strong>${usd(midA)}</strong> (${bmA.sampleSize} active listings).`);
    const enPts = soldPts(code, "en");
    const enLastP = enPts.length ? enPts[enPts.length - 1].p : null;
    if (enLastP != null && jpVal != null) facts.push(`The English ${code} box runs about <strong>${usd(enLastP)}</strong> — ${(enLastP / jpVal).toFixed(1)}x the Japanese box.`);
    if (cards.length) {
      const tf = cardPrices(cards[0]);
      if (tf.nm != null) facts.push(`The most valuable ${code} card is <strong>${esc(cards[0].name)}</strong>${cards[0].number ? ` (${esc(cards[0].number)})` : ""} at about <strong>${usd(tf.nm)}</strong> raw NM${tf.psa != null ? `, with PSA 10 copies ${tf.psaKind === "sold" ? "selling" : "listed"} near ${usd(tf.psa)}` : ""}.`);
    }
    if (fullPsaRate != null && fullPsaTotal) facts.push(`Across the full ${code} set, <strong>${fullPsaRate}%</strong> of PSA-graded cards received PSA 10, across ${intl(fullPsaTotal)} total grades.`);
    if (s.release) facts.push(`The English edition of ${code} released ${esc(monthYear(s.release))}.`);
    if (facts.length >= 2) keyFacts = `
      <section id="key-facts" aria-label="Key facts">
        <ul class="keyFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
      </section>`;
  }

  // ko 짝이 실제로 존재할 때만 hreflang 을 건다(eb-05·op-17 처럼 ko 없는 얼리페이지는 제외).
  const koHref = fs.existsSync(path.join(ROOT, "ko", `${slug(code)}.html`)) ? `${SITE}/ko/${slug(code)}.html` : "";

  return `${head({ title, desc, canonical, koHref, extraLd: faqLd(code, nameEn) + cardsLd + productLd(code, nameEn, s) })}
      <p class="eyebrow">Set Guide</p>
      <div class="setHero">
        ${s.box ? `<img src="${esc(s.box)}" alt="${esc(`${code} ${nameEn} Japanese booster box`)}" width="132" height="184" loading="eager" fetchpriority="high" decoding="async" />` : ""}
        <div>
          <h1>${code} ${esc(nameEn)} — Japanese booster box price${prioritySeo ? ", reprints" : ""} &amp; chase cards</h1>
          ${release}
          ${summaryLine}
        </div>
      </div>
      ${AFF_TOP}
      ${statGrid}
      ${keyFacts}
      ${boxChartBlock(code)}
      ${liveWidget(code)}
      <div class="ctaRow">
        <a class="primary" href="../?set=${enc}&hl=en">Open live ${code} tracker</a>
        <a href="${ebaySearch}" target="_blank" rel="noopener noreferrer sponsored">Browse ${code} boxes on eBay</a>
      </div>
      ${/* 갓 나온 세트는 박스 시세만 있고 체이스 카드 목록이 아직 없다. 헤더만 있는 빈 표를
            내보내면 "데이터가 있는데 비어 있다"로 읽힌다 — 섹션을 아예 그리지 않고,
            왜 없는지 한 줄로 밝힌다. 카드 목록이 생기면 자동으로 다시 나타난다. */""}
      ${cards.length ? `<h2>Top 10 chase cards in ${code}</h2>
      <p>${analysis}</p>
      <div class="chaseTableWrap">
        <table class="chaseTable">
          <thead><tr><th>#</th><th>Card</th><th>NM (raw)</th><th>PSA 10</th><th>Graded (PSA / CGC / TAG)</th></tr></thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
      <p class="priceNote">${allTcg ? `NM (raw) uses TCGplayer market data.` : `NM = Japanese near-mint retail. PSA 10 = sold median where marked, otherwise a verified ask.`} <a href="../methodology.html">Source rules</a> · ${esc(DATA_DATE)}</p>`
      : `<p class="priceNote">Single-card data for ${code} is not published yet. This page tracks the sealed box only; card-level prices and grading counts are added once the set's chase list is verified. <a href="../methodology.html">Source rules</a> · ${esc(DATA_DATE)}</p>`}
      <!-- 산문은 전부 접는다 — 이 페이지에 오는 사람은 숫자를 보러 온다. 2026-08-12.
           지우지는 않는다: 세트 해설·재판 이력·밀봉 확인은 이 페이지를 얇지 않게 만드는 실체이고,
           접어도 HTML 에 그대로 있어 검색·심사에는 똑같이 잡힌다. 화면에서만 물러난다. -->
      <details class="setMore">
        <summary>Set notes — price context, reprints, factory-seal check${story ? ", background" : ""}</summary>
        ${searchIntentBlock}
        ${story ? `<section class="setStory" aria-label="${esc(`${code} editorial`)}">
          <h2>${esc(story.heading)}</h2>
          ${story.body.map((p) => `<p>${esc(p)}</p>`).join("\n          ")}
        </section>` : ""}
        ${trajectory}
        ${verdict}
        ${reprintBlock}
        ${momentum}
        ${compareLink ? `<p class="priceNote">${compareLink.replace(/^<li>|<\/li>$/g, "")}</p>` : ""}
      </details>
      ${faqHtml(code, nameEn)}
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
  // 목록의 꼬리표를 세트별 수기 한 줄로 — "box price, top chase cards & PSA data" 를 21번 반복하면
  // 허브부터 템플릿으로 읽힌다. 해설 없는 세트만 기존 문구로 떨어진다.
  const items = ORDER.map((code) => {
    const s = data.sets[code];
    const tail = COMMENTARY.sets?.[code]?.heading
      ? esc(COMMENTARY.sets[code].heading.toLowerCase())
      : "box price, top chase cards &amp; PSA data";
    return `<li><a href="${slug(code)}.html"><strong>${code}</strong> ${esc(s.nameEn || "")}</a> — ${tail}</li>`;
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

  // ── 해설용 파생 수치 — 전부 rows(실측 sold)에서만 계산한다. 추정 문장 금지.
  //    2026-07-30 애드센스 "가치 낮은 콘텐츠" 대응: 표만 있던 페이지(산문 140단어)에
  //    데이터가 말해주는 만큼의 분석 산문을 붙인다. 숫자가 바뀌면 문장도 같이 바뀐다.
  const bySet = {};
  rows.forEach((r) => { (bySet[r.code] = bySet[r.code] || []).push(r); });
  const setCounts = Object.entries(bySet).sort((a, b) => b[1].length - a[1].length);
  const topSet = setCounts[0];
  const t1 = rows[0], t2 = rows[1], t3 = rows[2];
  const mangaCount = rows.filter((r) => /manga|MAA|GMA|WAA/i.test(`${r.name} ${r.rarity || ""}`)).length;
  const spCount = rows.filter((r) => /\bSP\b/i.test(`${r.name} ${r.rarity || ""}`)).length;
  const medPsa = rows.length ? rows.map((r) => r.psa).sort((a, b) => a - b)[Math.floor(rows.length / 2)] : null;
  const widest = rows.filter((r) => r.low != null && r.high != null && r.low > 0)
    .map((r) => ({ ...r, spread: r.high / r.low })).sort((a, b) => b.spread - a.spread)[0];
  const entryRow = rows[rows.length - 1];

  const analysis = rows.length < 5 ? "" : `
      <section class="rankProse" aria-label="What the ranking shows">
        <h2>What the top of the market looks like right now</h2>
        <p>As of ${esc(asOf)}, the most valuable Japanese One Piece card in PSA 10 is <strong>${esc(t1.name)}</strong> (${esc(t1.code)}${t1.number ? ` ${esc(t1.number)}` : ""}) at a median sold price of <strong>${usd(t1.psa)}</strong> across ${t1.n} completed sales. ${esc(t2.name)} (${esc(t2.code)}) follows at ${usd(t2.psa)}, with ${esc(t3.name)} (${esc(t3.code)}) at ${usd(t3.psa)}. The median across the whole top ${rows.length} is ${usd(medPsa)} — the drop from the very top is steep, which is typical of a chase-card market where one or two printings absorb most collector demand.</p>
        <p>${esc(topSet[0])} contributes the most entries to the top ${rows.length} (${topSet[1].length} cards)${setCounts[1] ? `, ahead of ${esc(setCounts[1][0])} with ${setCounts[1][1].length}` : ""}. By style, <strong>${mangaCount} of the ${rows.length}</strong> are manga-art variants and <strong>${spCount}</strong> are SP printings — manga art dominating the top of the ranking has been the defining pattern of this market since the OP-05/OP-06 era.</p>
        ${widest ? `<p>Ranges matter as much as medians. The widest spread in the current top ${rows.length} belongs to <strong>${esc(widest.name)}</strong> (${esc(widest.code)}): sales from ${usd(widest.low)} to ${usd(widest.high)}, roughly ${widest.spread.toFixed(1)}x between the cheapest and the most expensive completed sale. Spreads that wide usually mean auction-format sales mixed with Buy It Now, or centering-quality differences between individual gems — check recent comps, not just one number, before paying top of range.</p>` : ""}
        <p>The entry ticket for this list is currently about <strong>${usd(entryRow.psa)}</strong> (#${rows.length}, ${esc(entryRow.name)}, ${esc(entryRow.code)}). Cards below that line are tracked on their individual <a href="cards/">card pages</a> and on each <a href="sets/index.html">set guide</a>.</p>
        <h2>How to read PSA 10 sold prices</h2>
        <p>Every number here is a <strong>completed eBay sale of a PSA 10 graded card</strong> — not an asking price, and not a raw NM price. We require at least three sales per card before it can rank, because a single graded sale is an anecdote, not a market. Prices are medians, so one outlier auction cannot drag a card up or down the table on its own. Japanese and English printings are never mixed: the ranking is Japanese-only, since the two print runs have different populations and different buyers.</p>
        <p>A PSA 10 price only means something next to two other numbers: the card's <a href="psa-grading.html">graded population</a> (how many 10s exist) and its raw NM price (what an ungraded copy costs). A high price on a large population signals durable demand; a high price on a population of twenty can evaporate with three new submissions. Those numbers live on each card's tracker page — click any row.</p>
      </section>
      <section class="rankProse" aria-label="Frequently asked questions">
        <h2>PSA 10 ranking — common questions</h2>
        <details class="faqItem"><summary>What is the most expensive One Piece card in PSA 10 right now?</summary><p>${esc(t1.name)} (${esc(t1.code)}${t1.number ? ` ${esc(t1.number)}` : ""}) — median ${usd(t1.psa)} across ${t1.n} recent completed sales as of ${esc(asOf)}. The full top ${rows.length} is in the table above, updated with each data refresh.</p></details>
        <details class="faqItem"><summary>Why Japanese cards only?</summary><p>Japanese and English are different print runs with different scarcity, so mixing them in one ranking would produce numbers that describe neither market. This site tracks the Japanese market as its primary focus; English box prices are tracked separately on set pages.</p></details>
        <details class="faqItem"><summary>Are these asking prices?</summary><p>No. Every figure is a median of completed eBay sales of the PSA 10 graded card, minimum three sales. Active listings often sit far above what buyers actually pay — on this site asking prices are labelled separately wherever they appear.</p></details>
        <details class="faqItem"><summary>Does a PSA 10 always sell for more than a raw copy?</summary><p>The completed-sale median is usually higher for the PSA 10 cards in this table, but the premium varies by card. Gem rate and population add supply context; submission selection, character demand and completed-sale depth also matter. See <a href="articles/psa-10-vs-nm-card-prices.html">PSA 10 vs NM prices</a> for the data and limits.</p></details>
      </section>`;

  const faqLd = rows.length < 5 ? "" : `<script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org", "@type": "FAQPage",
    mainEntity: [
      { "@type": "Question", name: "What is the most expensive One Piece card in PSA 10 right now?", acceptedAnswer: { "@type": "Answer", text: `${t1.name} (${t1.code}${t1.number ? ` ${t1.number}` : ""}) — median $${Math.round(t1.psa).toLocaleString("en-US")} across ${t1.n} recent completed eBay sales as of ${asOf}.` } },
      { "@type": "Question", name: "Are these asking prices?", acceptedAnswer: { "@type": "Answer", text: "No. Every figure is a median of completed eBay sales of the PSA 10 graded card, with a minimum of three sales per card." } },
      { "@type": "Question", name: "Why Japanese cards only?", acceptedAnswer: { "@type": "Answer", text: "Japanese and English are different print runs with different populations and buyers, so they are ranked separately rather than mixed." } },
    ],
  })}</script>`;
  const title = `Most Valuable One Piece PSA 10 Cards — Sold Price Ranking | OP Box Index`;
  const desc = `The most valuable Japanese One Piece TCG cards in PSA 10, ranked by recent eBay completed-sale medians with at least three matched sales per card.`;
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
    ${faqLd}
    <link rel="stylesheet" href="styles.css?v=${CSS_VER}" />
    <style>
      .rankWrap { max-width: 900px; margin: 0 auto; padding: 20px clamp(16px,3vw,28px) 44px; }
      .rankProse { max-width: 720px; margin: 26px 0 0; }
      .rankProse h2 { font-size: 20px; margin: 22px 0 8px; }
      .rankProse p { color: var(--muted); font-size: 14px; line-height: 1.7; margin: 8px 0; }
      .rankProse .faqItem { border-bottom: 1px solid rgba(255,255,255,.08); padding: 2px 0; }
      .rankProse .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14px; color: var(--fg); }
      .rankProse .faqItem p { font-size: 14px; margin: 4px 0 10px; }
      .rankWrap h1 { margin: 6px 0 6px; font-size: clamp(23px,4vw,32px); line-height: 1.2; }
      .rankWrap .lead { color: var(--muted); font-size: 16px; line-height: 1.6; max-width: 680px; }
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
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      <nav class="nav"><a href="./" data-ko="부스터 박스">Booster Boxes</a><a href="compare.html" data-ko="비교">Compare</a><a href="psa10-ranking.html" aria-current="page" data-ko="PSA10 랭킹">Top PSA 10</a><a href="psa-grading.html" data-ko="PSA 인구">PSA Population</a><a href="sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main id="main-content" class="rankWrap">
      <p class="eyebrow">PSA 10 Value Ranking</p>
      <h1>Most valuable One Piece PSA 10 cards</h1>
      <p class="lead">The highest-value Japanese One Piece TCG cards in PSA 10 gem mint, ranked by recent eBay <strong>completed-sale medians</strong> across every set. Each ranked card has at least three matched sales.</p>
      <div class="rankTableWrap">
        <table class="rankTable">
          <thead><tr><th>#</th><th>Card</th><th>PSA 10 sold</th><th>Sold range</th><th>Sales</th></tr></thead>
          <tbody>
            ${trs}
          </tbody>
        </table>
      </div>
      <p class="methodNote">Method: PSA 10 median of recent eBay <em>sold</em> listings (Japanese cards), minimum 3 completed sales, as of ${esc(asOf)}. Values in USD. Tap any row for that card's full live tracker. Reflects graded-card sold prices, not raw singles.</p>
${analysis}
      <div class="setNavLinks"><a href="./">Live price tracker</a><a href="cards/">Individual card price pages</a><a href="sets/index.html">Set guides</a><a href="compare.html">Compare boxes</a><a href="articles/psa-population-and-prices.html">PSA population &amp; prices</a></div>
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this site — at no extra cost to you. Prices change; always confirm on eBay before buying. Not investment advice.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Data terms</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
    <script>
      document.querySelectorAll('.rankTable tr[data-code]').forEach(function (tr) {
        tr.addEventListener('click', function () { location.href = './?set=' + encodeURIComponent(tr.getAttribute('data-code')) + '&hl=en'; });
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
