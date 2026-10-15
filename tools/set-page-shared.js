"use strict";
// 세트 페이지 생성기들이 함께 쓰는 "페이지 껍데기" — 2026-09-08 신설.
//
//   generate-set-pages.js         → 일본판 세트 페이지(sets/op-13.html …) + 허브 + PSA10 랭킹
//   generate-english-set-pages.js → 영문판 박스 페이지(sets/op-13-english.html …)
//
// 두 생성기가 <head>·푸터·제휴 고지·사이트맵 갱신을 각자 복사해 갖고 있으면 한쪽만 고쳐지는
// 사고가 난다(캐시 버전, EPN 고지 문구, 푸터 링크가 어긋난다). 그래서 겉껍데기는 여기 한 곳에만 둔다.
// 본문(표·차트·문장)은 각 생성기가 만든다.
//
// 읽는 순서: 상수 → 짧은 포맷 함수 → pageHead / FOOT → upsertSitemap.
const fs = require("fs");
const path = require("path");
const { navHtml } = require("./site-nav");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";

// eBay 파트너 네트워크(EPN) 추적 파라미터. 모든 eBay 링크 끝에 붙는다 — 빠지면 수수료가 잡히지 않는다.
const EPN = "mkcid=1&mkrid=711-53200-19255-0&siteid=0&campid=5339163744&toolid=10001&mkevt=1";

// 정적 자산(styles.css 등)의 캐시 버전. packs.js 의 DATA_VERSION 과 같아야 한다(가드 V1).
// 값을 하드코딩하면 범프할 때마다 어긋난다(2026-07-27 실사고: 가드 V1 21건).
const CSS_VER = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

// 박스 시세 차트 — 그림과 CSS 는 box-chart.js 한 곳에서만 나온다(홈·세트·영문판 페이지 공통).
const BoxChart = require(path.join(ROOT, "box-chart.js"));

// ── 짧은 포맷 함수
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const usd = (n) => (n == null ? null : "$" + Math.round(n).toLocaleString("en-US"));
const intl = (n) => (n == null ? "" : Number(n).toLocaleString("en-US"));
const monthYear = (iso) => {
  if (!iso) return "";
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${m[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

// 재판 기록 분류 — 2026-10-15(4차). 영문 세트 페이지·한국어 세트 페이지·한국어 허브·홈 배지(build-market-index → marketIndex.board)가 이 함수 하나를 쓴다.
// 기준은 반다이 측 문구 하나: "再販"이라 적힌 추첨(kind official-reprint-lottery — OP-09 반다이남코샵 2024-10)은 재판으로 세고,
// 그 말이 없는 발매 후 추첨(official-lottery — OP-13 2025-12·OP-16 2026-06)은 재판 횟수에 넣지 않는다. 발매 전 추첨(pre-release-lottery)은 초판 배정이라 싣지 않는다.
// 3차는 반다이 추첨을 전부 재판에서 빼서, 원장 메모가 "Bandai Namco shop 再販 pre-order lottery" 인 OP-09 가 "재판 기록 없음"이 됐다.
//   reprint = 리테일러·유통사 재입고 + 再販 추첨(= 재판 횟수) · lottery = 再販 표기 없는 발매 후 추첨 · unverified = 발매 전후 미확인 추첨
function splitReprints(records) {
  const kind = (r) => String((r && r.kind) || "");
  const recs = (records || []).filter((r) => r && !/pre-release/i.test(kind(r)));
  const unverified = recs.filter((r) => /unverified-timing/i.test(kind(r)));
  const lottery = recs.filter((r) => kind(r) === "official-lottery");
  const reprint = recs.filter((r) => !unverified.includes(r) && !lottery.includes(r));
  return { reprint, lottery, unverified };
}

// 영문판 값이 재판(White) 위주인가 — 그래프 배지(box-chart.js badgeFor)와 같은 기준(reprintPct.en ≥ 60).
// 2026-09-30: OP-01 영문판 $1,487 은 재판만의 값인데 배지는 그래프에만 있고 지표칸·Key facts·FAQ·설명에는 없었다.
const enIsReprint = (series) => (((series && series.reprintPct) || {}).en || 0) >= 60;

// EPN 규정(Participation Requirements I.G.) — 제휴 고지는 "명확하고 눈에 띄게" 있어야 한다.
// 2026-08-10 EPN 위반 통지: 문구는 적절하나 푸터에 있어 잘 보이지 않는다. 그래서 본문 상단에도 넣는다.
// 푸터의 affNote 는 그대로 두고 이걸 추가하는 것이다 — 둘 중 하나를 지우지 말 것(가드 E1 이 순서를 검사한다).
const AFF_TOP = `<p class="affTop"><b>Paid Link:</b> As an eBay Partner Network affiliate, we earn from qualifying purchases.</p>`;

// 페이지 머리. sets/ 아래 한 단계 깊이의 페이지 전용이라 자산 경로가 "../" 로 고정돼 있다.
//   title / desc / canonical : 필수
//   ogType   : "article"(기본) 또는 "website"(허브)
//   extraLd  : 구조화데이터 <script type="application/ld+json"> 문자열들
//   koHref   : 한국어 짝 페이지 URL. 있을 때만 hreflang 을 낸다.
//   extraCss : 그 페이지에만 쓰는 스타일(선택). <style> 안에 그대로 들어간다.
//   chart    : false 면 머리에 박스 차트 CSS(7.8KB)를 싣지 않는다 — 차트가 없는 페이지(카드리스트·허브, 2026-10-14),
//              또는 차트 바로 앞에 withChartCss() 로 CSS 를 두는 세트 페이지(2026-10-14, W5a: 머리가 25KB 라 H1 아래 Key facts 표가
//              HTML 의 25% 지점을 넘었다. 차트 CSS 는 .opbc* 전용이라 차트 앞에만 있으면 된다 — box-chart.js 는 id 로 찾는다).
function pageHead({ title, desc, canonical, ogType = "article", extraLd = "", koHref = "", extraCss = "", chart = true }) {
  // hreflang 은 반드시 양방향이어야 구글이 인정한다. ko 짝이 있을 때만, en(자기)·ko·x-default 를 함께 선언.
  // (ko 페이지는 이미 en 을 가리키는데 en 쪽이 침묵해서 단방향으로 무시되던 문제 — 2026-07-21 감사)
  const hreflang = koHref
    ? `\n    <link rel="alternate" hreflang="en" href="${canonical}" />\n    <link rel="alternate" hreflang="ko" href="${koHref}" />\n    <link rel="alternate" hreflang="x-default" href="${canonical}" />`
    : "";
  const style = extraCss ? `    <style>\n${extraCss}\n    </style>\n` : "";
  // 한국어판이 있으면 언어 버튼이 그 페이지로 보낸다(lang-toggle.js data-ko-page) — 2026-10-13 QA: 제자리 번역은 메뉴·칩만
  // 바뀌고 본문 약 190곳이 영어로 남았다. 주소는 hreflang ko 와 같은 곳(사이트 절대경로).
  const koPage = koHref ? ` data-ko-page="${esc(koHref.replace(SITE, ""))}"` : "";
  return `<!doctype html>
<html lang="en"${koPage}>
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
    <script defer src="/track.js"></script>
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
    <script defer src="../lang-toggle.js?v=${CSS_VER}"></script>
${style}${chart ? `    <style id="opBoxChartCss">${BoxChart.CSS}</style>\n` : ""}  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("../")}
    </header>
    <main id="main-content" class="bodyPage">`;
}

// 페이지 꼬리. 푸터 고지(affNote)와 About/Methodology 링크는 애드센스·EPN 심사 항목이라 빼면 안 된다.
// foot({ chart:false, affiliate:false }) — 차트도 eBay 링크도 없는 페이지(카드리스트)용. 푸터 메뉴는 같은 글자다.
const foot = ({ chart = true, affiliate = true } = {}) => `${chart ? `
      <script src="../box-chart.js?v=${CSS_VER}" defer></script>` : ""}${affiliate ? `
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this page — at no extra cost to you.</p>` : ""}
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../free-data.html">Free data (CSV)</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
const FOOT = foot();

// 차트 블록 앞에 차트 CSS 를 붙인다(차트가 없으면 둘 다 없다). pageHead({ chart: false }) 와 짝으로 쓴다.
const withChartCss = (chartHtml) => (chartHtml ? `<style id="opBoxChartCss">${BoxChart.CSS}</style>\n      ${chartHtml}` : "");

// 사이트맵 갱신 — 같은 URL 은 lastmod 만 오늘로 바꾸고, 없는 URL 만 새로 넣는다(몇 번 돌려도 결과가 같다).
// 홈(/)은 매일 데이터가 바뀌므로 함께 lastmod 를 올린다. 반환값: { added: 새로 넣은 개수 }.
function upsertSitemap(urls, { priority = "0.8", changefreq = "weekly" } = {}) {
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const today = new Date().toISOString().slice(0, 10);
  const bumpLastmod = (u) => {
    const quoted = u.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(<loc>${quoted}</loc>[\\s\\S]*?<lastmod>)[^<]*(</lastmod>)`);
    if (re.test(sm)) { sm = sm.replace(re, `$1${today}$2`); return true; }
    return false;
  };
  let added = 0;
  for (const u of urls) {
    if (bumpLastmod(u)) continue;
    const entry = `  <url><loc>${u}</loc><lastmod>${today}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>\n`;
    sm = sm.replace("</urlset>", entry + "</urlset>");
    added++;
  }
  bumpLastmod(`${SITE}/`);
  fs.writeFileSync(smPath, sm, "utf8");
  return { added };
}

// ── 최저 실매물 버튼(buyCta) ─────────────────────────────────────────────
// 값이 찍힌 버튼이 값 없는 글자 링크보다 훨씬 많이 눌린다. 2026-09-16 실측: 이베이 클릭 53건 중
// 47건이 값이 찍힌 홈 버튼에서 났고, 나머지 영어 페이지(세트 22·카드 223)는 값 없는 회색 링크뿐이었다.
// 값이나 URL 이 없으면 빈 문자열을 돌려준다 — 호출부는 기존 검색 링크만 남기면 된다(빈 값 > 틀린 값).

// eBay 호스트·https 를 검증하고 EPN 추적 파라미터를 붙인다. 하나라도 어긋나면 null(링크를 만들지 않는다).
function epnUrl(raw) {
  if (!raw) return null;
  let u;
  try { u = new URL(String(raw)); } catch { return null; }
  if (u.protocol !== "https:") return null;
  if (!/(^|[.])ebay[.][a-z.]+$/i.test(u.hostname)) return null;
  if (u.searchParams.get("campid")) return u.href; // 이미 붙어 있음
  for (const kv of EPN.split("&")) {
    const i = kv.indexOf("=");
    u.searchParams.set(kv.slice(0, i), kv.slice(i + 1));
  }
  return u.href;
}

// label   : 무엇의 최저가인지 (예: "sealed OP-01 box", "PSA 10 copy")
// price   : 배송비 포함 총액(USD)
// mid     : 같은 물건의 중간 호가(USD). 있으면 몇 % 싼지 배지를 붙인다(3% 미만 차이는 생략).
// updated : 매물 수집일. 싼 매물은 빨리 나가므로 기준일을 반드시 같이 보여준다.
function buyCta({ url, price, mid, updated, label }) {
  const href = epnUrl(url);
  if (!href || price == null) return "";
  const off = mid != null && mid > 0 && price < mid * 0.97 ? Math.round((1 - price / mid) * 100) : null;
  const chip = off ? `<em class="buyOff">${off}% under mid ask</em>` : "";
  const asOf = updated ? `<em class="buyAsOf">as of ${esc(updated)}</em>` : "";
  return `<a class="buyNow" href="${esc(href)}" target="_blank" rel="noopener noreferrer sponsored">`
    + `<span class="buyLine">Cheapest ${esc(label)} <b>${usd(price)}</b><span class="buyArrow">&#8599;</span></span>`
    + `${chip}${asOf}</a>`;
}

// ── 상단 Key facts 표 — 2026-10-14(W5a) ─────────────────────────────────────────
// ChatGPT 가 보내던 세트 페이지에서 발매일·정가·팩 수 같은 핵심 사실이 HTML 97% 지점(접힌 재판 이력 안)에 있었고,
// 머리의 카드 수는 낡은 값(OP-01 "106 cards" — 공식 목록 121종·154장)이었다. 일본판·영문판·한국어 페이지가
// **같은 함수**에서 사실을 읽어 H1 바로 아래 라벨:값 표로 낸다(각자 세면 한쪽만 어긋난다). 값이 없으면 "—".
//   가격  : box-sold-series 의 그 판 current(마지막 중앙값 점이 asOf 로부터 28일 이내일 때만, 아니면 "—" — 모든 표와 같은 규칙, 가드 D17)
//           · 최저 실매물(구매 버튼과 같은 값, 매물 수 표시)
//   사실  : data/set-facts.json(반다이 공식 — 발매일·정가·팩 수·카드 종류, 확인일 포함) · data/official-cardlist.json(공식 카드 리스트)
// 문장·해설 없이 라벨과 값만 쓴다. 표 안의 링크는 첫 칸(카드 리스트)뿐이다 — 출처 링크는 표 아래 한 줄로.
const readData = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return fallback; } };
let KF_SRC = null;
const kfSrc = () => (KF_SRC || (KF_SRC = {
  packs: readData("data/onepiece-packs.json", { sets: {} }),
  sold: readData("data/box-sold-series.json", { sets: {} }),
  facts: readData("data/set-facts.json", { sets: {} }),
  auction: readData("data/set-auction-stats.json", {}),
}));

// ── 페이지 수정일 — 2026-10-15(감사 #4) ─────────────────────────────────────────
// 세트·영문판 페이지의 JSON-LD dateModified 와 화면 "Data updated" 가 packs.updated(10-14)만 따라가, 같은 페이지에
// 박스 판매 원장의 "as of 2026-10-15" 값(박스 판매 원장은 10-15 아침 수집)이 있는데도 하루 이른 날짜를 냈다. 수정일이 화면 숫자의
// 가장 늦은 날짜보다 이르면 검색엔진이 받는 신선도가 내용·사이트맵 lastmod 보다 낡는다(글·비교표는 가드 U1 이 같은 규칙을 지킨다).
// 그래서 이 페이지가 읽는 원장 기준일 중 가장 늦은 날: packs.updated · box-sold-series.asOf · 경매 집계 창 끝 ·
// 그 세트의 호가 수집일(일본판·영문판) · Key facts 출처 확인일. 미래 날짜인 발매일은 데이터 날짜가 아니라 넣지 않는다.
const latestDate = (...ds) => ds.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort().pop() || null;
function setPageDate(code) {
  const { packs, sold, auction } = kfSrc();
  const bm = ((packs.sets || {})[code] || {}).boxMarket || {};
  const checked = keyFactsModel(code, "jp").sources.map((x) => x.checked);
  return latestDate(packs.updated, sold.asOf, (auction.window || {}).to, bm.jp && bm.jp.ebayActive && bm.jp.ebayActive.updated, bm.en && bm.en.ebayActive && bm.en.ebayActive.updated, ...checked)
    || new Date().toISOString().slice(0, 10);
}

// 최저 실매물 — 미개봉 새 제품이고 제목이 개봉·빈 박스·재밀봉·손상을 말하지 않는 검증된 최저 총액(가격+배송).
// 세트 페이지 구매 버튼(buyCta)과 Key facts 표가 이 함수 하나를 쓴다 — 표의 값과 버튼의 값이 늘 같다.
function lowestAsk(set, ed) {
  const a = set && set.boxMarket && set.boxMarket[ed] && set.boxMarket[ed].ebayActive;
  const bl = a && a.bestListing;
  if (!bl || bl.total == null || !epnUrl(bl.url)) return null;
  if (!/new/i.test(bl.condition || "")) return null;
  if (/unseal|open|empty|no packs|reseal|damaged/i.test(bl.title || "")) return null;
  const fx = (kfSrc().packs.fx || {}).usdKrw;
  const toU = (v, cur) => (v == null ? null : cur === "USD" ? v : cur === "KRW" && fx ? v / fx : null);
  const total = toU(bl.total, bl.currency || a.currency);
  if (total == null) return null;
  return { total, url: bl.url, updated: a.updated || null, mid: a.middle != null ? toU(a.middle, a.currency) : null, listings: Number.isInteger(a.sampleSize) ? a.sampleSize : null };
}

// 세트·판 하나의 사실 묶음. ed = "jp" | "en" — 가격 두 줄만 판을 따르고 나머지는 세트 단위 사실이다.
function keyFactsModel(code, ed) {
  const { packs, sold, facts } = kfSrc();
  const s = (packs.sets || {})[code] || {};
  const sf = (facts.sets || {})[code] || {};
  const ser = (sold.sets || {})[code] || {};
  // 현재가 = current[ed] — 2026-10-14 QA: 마지막 점(98일 전 값 포함)을 그대로 써서 표("—")와 Key facts($147, 07-07)가 같은 사실을 두 방식으로 냈다.
  const last = (ser.current && ser.current[ed]) || null;
  const CL = require("./card-list-shared");
  const cl = CL.productOf(code);
  const jpPack = sf.jpMsrpYenPerPack || (sf.jpMsrpYen && sf.packsPerBox && Number.isInteger(sf.jpMsrpYen / sf.packsPerBox) ? sf.jpMsrpYen / sf.packsPerBox : null);
  const en = sf.enRelease || {};
  const sources = [];
  if (sf.jpRelease && sf.jpRelease.source) sources.push({ key: "jpRelease", en: "JP release", ko: "일본판 발매일", url: sf.jpRelease.source, checked: sf.jpRelease.verifiedOn || null, archived: /web\.archive\.org/.test(sf.jpRelease.source) });
  if (sf.jpSpecSource && sf.jpSpecSource.source) sources.push({ key: "jpSpec", en: "JP MSRP & card types", ko: "일본판 정가·카드 종류", url: sf.jpSpecSource.source, checked: sf.jpSpecSource.verifiedOn || null });
  if (en.source) sources.push({ key: "en", en: "EN release & MSRP", ko: "영문판 발매일·정가", url: en.source, checked: en.verifiedOn || null });
  if (cl) sources.push({ key: "cardList", en: "card list", ko: "카드 리스트", url: cl.url, checked: cl.checked || null });
  return {
    code, ed,
    sold: last ? { median: last.median, n: last.n ?? null, d: last.d, windowDays: (ser.windowDays || {})[ed] || null, reprint: ed === "en" && enIsReprint(ser) } : null,
    soldReleased: !!(ser.release && ser.release[ed] && (!sold.asOf || ser.release[ed] <= sold.asOf)),
    boxConfigStated: sf.boxConfig ? sf.boxConfig.stated !== false : null,
    ask: lowestAsk(s, ed),
    jpRelease: (sf.jpRelease && sf.jpRelease.date) || null,
    enRelease: en.date || s.release || null,
    msrp: { jpBox: sf.jpMsrpYen || null, jpPack, enPack: en.msrpUsdPerPack ?? null },
    packsPerBox: sf.packsPerBox || null,
    cardsPerPack: sf.cardsPerPack || null,
    cardTypes: sf.cardTypes ? { official: true, value: String(sf.cardTypes) } : cl ? { official: false, numbers: cl.counts.numbers } : null,
    cardList: cl ? { href: `${CL.slugOf(code)}-card-list.html`, cards: cl.counts.cards, numbers: cl.counts.numbers, checked: cl.checked || null } : null,
    sources,
  };
}

// ── 검색 설명(meta description · og:description) — 2026-10-15 소유자 결정: 데이터 페이지엔 숫자·표·라벨만.
// 종전 일본판 설명은 수기 해설(set-commentary desc · priority-set-seo description)이나 "…and a buy-or-skip verdict" 같은 사이트 소개 문장,
// 영문판은 "Weekly price history and auction results, updated daily" 꼬리였다. 이제 Key facts 표(keyFactsModel)와 같은 값·같은 표기(usd)만 잇는다.
// 판매 중앙값은 current(28일 규칙)일 때만 — 없으면 조각을 빼고 최저 매물가가 앞에 선다(묵은 중앙값을 현재가로 내지 않는다).
// 조각은 우선순위 순서: 판매 중앙값 · 최저 매물가 · 그 판 발매일 · 팩 수(일본판) → 들어가는 만큼 extras(페이지 지표 칸에 있는 값)·정가.
// max 를 넘으면 뒤 조각부터 뺀다. 세트 코드가 들어가므로 페이지마다 다르다.
function dataDesc(m, nameEn, extras = [], max = 155) {
  const head = `${m.code} ${nameEn} ${m.ed === "en" ? "English" : "Japanese"} booster box: `;
  const core = [];
  if (m.sold) core.push(`${m.sold.reprint ? "reprint (White) " : ""}sold median ${usd(m.sold.median)} (${m.sold.d}${m.sold.n != null ? `, n=${m.sold.n}` : ""})`);
  if (m.ask) core.push(`lowest live ask ${usd(m.ask.total)}`);
  const rel = m.ed === "en" ? m.enRelease : m.jpRelease;
  if (rel) core.push(`${m.ed === "en" ? "EN" : "JP"} release ${rel}`);
  if (m.ed !== "en" && m.packsPerBox) core.push(`${m.packsPerBox} packs`);   // 팩 수는 일본판 박스 값(Key facts "JP box")이라 영문판 설명엔 싣지 않는다
  const more = [...extras.filter(Boolean)];
  if (m.ed !== "en" && m.msrp && m.msrp.jpBox) more.push(`MSRP ¥${Number(m.msrp.jpBox).toLocaleString("en-US")}`);
  const text = (parts) => `${head}${parts.join(" · ")}.`;
  const parts = core.slice();
  while (parts.length > 1 && text(parts).length > max) parts.pop();
  for (const x of more) if (text([...parts, x]).length <= max) parts.push(x);
  return text(parts);
}

// 최신 세트 — 계열(OP·EB·PRB)마다 일본판 발매일이 가장 늦은 추적 세트 중, 발매 후 120일 이내이고 공식 카드 리스트가 있는 것.
// "op 17 release date"·"op 17 set list" 질의는 발매 전후 몇 달에 몰린다(2026-10-14 Bing 실측). 그 세트의 제목·H1 에
// Release Date·Card List 를 넣는다. 손목록이 아니라 데이터로 정하므로 EB-05·OP-18 이 추적 세트가 되는 날 자동으로 넘어간다.
function latestSets(codes, asOf) {
  const { facts } = kfSrc();
  const CL = require("./card-list-shared");
  const best = {};
  for (const c of codes) {
    const d = (((facts.sets || {})[c] || {}).jpRelease || {}).date;
    if (!d || d > asOf) continue;
    const fam = c.split("-")[0];
    if (!best[fam] || d > best[fam].d) best[fam] = { c, d };
  }
  return new Set(Object.values(best).filter(({ c, d }) => (Date.parse(asOf) - Date.parse(d)) / 864e5 <= 120 && CL.has(c)).map(({ c }) => c));
}

// 표 그리기. lang = "en"(영어 페이지 — data-ko 로 제자리 번역) | "ko"(정적 한국어 페이지).
// 행마다 data-k 를 단다 — 가드 KF1 이 행을 집어 원천과 대조한다.
function keyFactsHtml(m, { lang = "en", usdKrw = null } = {}) {
  const ko = lang === "ko";
  const t = (enText, koText) => (ko ? esc(koText) : `<span data-ko="${esc(koText)}">${esc(enText)}</span>`);
  const time = (iso) => `<time datetime="${esc(iso)}">${esc(iso)}</time>`;
  const yen = (n) => "¥" + Number(n).toLocaleString("en-US");
  const edEn = m.ed === "en" ? "English" : "Japanese", edKo = m.ed === "en" ? "영문판" : "일본판";
  const dash = "—";
  const rows = [];
  const row = (k, labelEn, labelKo, value, labelHtml) => rows.push(`<tr data-k="${k}"><th scope="row">${labelHtml || t(labelEn, labelKo)}</th><td>${value}</td></tr>`);

  const sd = m.sold;
  row("sold", `Sold median (${edEn} box)`, `판매 중앙값 (${edKo} 박스)`, sd
    ? `<b>${usd(sd.median)}</b> <small>${ko && usdKrw ? `${esc(Math.round(sd.median * usdKrw).toLocaleString("ko-KR"))}원 · ` : ""}${sd.reprint ? t("reprint (White)", "재판(화이트)") + " · " : ""}${sd.n != null ? `${t(`${sd.n} sales`, `${sd.n}건`)} · ` : ""}${t(sd.windowDays ? `${sd.windowDays} days to` : "to", sd.windowDays ? `${sd.windowDays}일 · 기준일` : "기준일")} ${time(sd.d)}</small>`
    : m.soldReleased ? `${dash} <small>${t("no median dated within 28 days", "28일 안에 날짜가 찍힌 중앙값 없음")}</small>` : dash);
  row("ask", `Lowest live ask (${edEn} box)`, `최저 매물가 (${edKo} 박스)`, m.ask
    ? `<b>${usd(m.ask.total)}</b> <small>${t("eBay, incl. shipping", "이베이 · 배송비 포함")}${m.ask.listings != null ? ` · ${t(`${m.ask.listings} listings`, `매물 ${m.ask.listings}건`)}` : ""}${m.ask.updated ? ` · ${time(m.ask.updated)}` : ""}</small>`
    : dash);
  row("release", "Release date", "발매일", m.jpRelease || m.enRelease
    ? [m.jpRelease ? `${t("JP", "일본판")} ${time(m.jpRelease)}` : `${t("JP", "일본판")} ${dash}`, m.enRelease ? `${t("EN", "영문판")} ${time(m.enRelease)}` : `${t("EN", "영문판")} ${dash}`].join(" · ")
    : dash);
  const ms = m.msrp;
  // 박스 구성이 공식 페이지에 없는 세트(OP-17: 팩 가격만 있음)는 박스 값에 "24 × 팩 가격" 라벨을 붙인다 — 2026-10-14 QA.
  const boxBasis = m.boxConfigStated === false && ms.jpPack && m.packsPerBox ? ` <small>(${m.packsPerBox} × ${yen(ms.jpPack)} · ${t("box size not stated by Bandai", "박스 구성 공식 미기재")})</small>` : "";
  row("msrp", "MSRP", "정가", ms.jpBox || ms.jpPack || ms.enPack != null
    ? [`${t("JP", "일본판")} ${ms.jpBox ? `${yen(ms.jpBox)} ${t("/ box", "/ 박스")}${boxBasis}` : dash}${ms.jpPack ? ` · ${yen(ms.jpPack)} ${t("/ pack", "/ 팩")}` : ""}`,
       `${t("EN", "영문판")} ${ms.enPack != null ? `$${Number(ms.enPack).toFixed(2)} ${t("/ pack", "/ 팩")}` : dash}`].join(" · ")
    : dash);
  row("packs", "Packs per box", "박스당 팩 수", m.packsPerBox
    ? `<b>${m.packsPerBox}</b> <small>${t("JP box", "일본판 박스")}${m.boxConfigStated === false ? ` · ${t("standard box, not stated by Bandai", "표준 구성 · 공식 미기재")}` : ""}${m.cardsPerPack ? ` · ${t(`${m.cardsPerPack} cards per pack`, `팩당 ${m.cardsPerPack}장`)}` : ""}</small>`
    : dash);
  // 카드 수 두 줄은 출처가 다르다 — "Card types" = 반다이 상품 페이지의 종류 수(예: 131+4), "Card list" = 반다이 카드 리스트의 장·번호 수.
  // 둘 다 "(official)" 로 쓰면 131 과 130 이 같은 사실의 다른 값처럼 보였다(2026-10-14 QA). 상품 페이지 값이 없으면 카드 리스트 줄 하나만.
  const ct = m.cardTypes;
  if (ct && ct.official) row("types", "Card types", "카드 종류", `<b>${esc(ct.value)}</b> <small>${t("types (Bandai product page)", "종 (반다이 상품 페이지)")}</small>`);
  else if (!m.cardList) row("types", "Card types", "카드 종류", dash);
  const cl = m.cardList;
  row("cardlist", "Card list", "카드 리스트", cl
    ? `<b>${cl.cards}</b> <small>${t(`cards · ${cl.numbers} card numbers (Bandai card list)`, `장 · 카드 번호 ${cl.numbers}종 (반다이 카드 리스트)`)}</small>`
    : dash, cl ? `<a href="${esc(cl.href)}">${t("Card list", "카드 리스트")}</a>` : "");

  const src = m.sources.map((x) => `<a href="${esc(x.url)}" target="_blank" rel="noopener nofollow">${t(x.en + (x.archived ? " (archived)" : ""), x.ko + (x.archived ? " (보관본)" : ""))}</a>${x.checked ? ` ${t("checked", "확인")} ${time(x.checked)}` : ""}`);
  const srcLine = src.length ? `<p class="kfSrc">${t("Bandai official", "반다이 공식")}: ${src.join(" · ")}</p>` : "";
  return `<table class="kfTable text" id="key-facts-table" aria-label="${esc(ko ? `${m.code} 핵심 정보` : `${m.code} key facts`)}"><tbody>
            ${rows.join("\n            ")}
          </tbody></table>
          ${srcLine}`;
}

// 세트·영문세트·한국어 생성기가 각자 인라인 <style> 에 넣는다. 색은 styles.css 토큰만.
// styles.css 의 기사 표 규칙(≤720px 가로 스크롤+오른쪽 흐림, 2열부터 오른쪽 정렬)을 이 표에서만 되돌린다 — 2열이라 폭 안에 들어온다.
const KF_CSS = `      .bodyPage table.kfTable { width: 100%; max-width: 640px; min-width: 0; margin: 12px 0 4px; font-size: 14px; }
      .bodyPage .kfTable th, .bodyPage .kfTable td { padding: 6px 10px 6px 0; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; line-height: 1.45; word-break: keep-all; overflow-wrap: break-word; }
      .kfTable time, .kfSrc time { white-space: nowrap; }
      .bodyPage .kfTable th { width: 40%; color: var(--muted); font-size: 13px; font-weight: 600; }
      .bodyPage .kfTable th a { color: var(--accent); font-weight: 700; }
      .bodyPage .kfTable td b { color: var(--ink); font-weight: 700; }
      .bodyPage .kfTable td small { color: var(--muted); font-size: 12px; }
      .kfSrc { margin: 4px 0 0; max-width: 640px; color: var(--muted); font-size: 12px; line-height: 1.55; }
      .kfSrc a { color: var(--muted); text-decoration: underline; text-underline-offset: 2px; }
      @media (max-width: 720px) { .bodyPage table.kfTable { display: table; overflow: visible; -webkit-mask-image: none; mask-image: none; } }
      @media (max-width: 640px) { .bodyPage .kfTable th { width: 36%; } .bodyPage .kfTable td small { display: block; } }`;

// 세트·영문세트·카드 생성기가 각자 인라인 <style> 에 넣는다(세 곳 모두 styles.css 를 따로 안 쓴다).
const BUY_CTA_CSS = `      .ctaRow a.buyNow { flex-direction: column; align-items: flex-start; gap: 2px; min-height: 52px; padding: 7px 16px;
        background: rgba(16,215,160,.16); border-color: rgba(16,215,160,.55); color: #10d7a0; }
      .ctaRow a.buyNow .buyLine { display: inline-flex; align-items: center; gap: 7px; font-weight: 650; }
      .ctaRow a.buyNow b { font-size: 16px; letter-spacing: .01em; }
      .ctaRow a.buyNow .buyArrow { opacity: .75; font-size: 12px; }
      .ctaRow a.buyNow .buyOff { font-style: normal; font-size: 11.5px; font-weight: 600; color: #ffd166; }
      .ctaRow a.buyNow .buyAsOf { font-style: normal; font-size: 11.5px; color: rgba(255,255,255,.55); }
      .ctaRow a.buyNow .buyOff + .buyAsOf { margin-left: 8px; }`;

module.exports = { ROOT, SITE, EPN, CSS_VER, BoxChart, esc, usd, intl, monthYear, splitReprints, enIsReprint, AFF_TOP, FOOT, foot, pageHead, upsertSitemap, epnUrl, buyCta, BUY_CTA_CSS, lowestAsk, keyFactsModel, keyFactsHtml, KF_CSS, latestSets, withChartCss, latestDate, setPageDate, dataDesc };
