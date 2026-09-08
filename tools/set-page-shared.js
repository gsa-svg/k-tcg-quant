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
function pageHead({ title, desc, canonical, ogType = "article", extraLd = "", koHref = "", extraCss = "" }) {
  // hreflang 은 반드시 양방향이어야 구글이 인정한다. ko 짝이 있을 때만, en(자기)·ko·x-default 를 함께 선언.
  // (ko 페이지는 이미 en 을 가리키는데 en 쪽이 침묵해서 단방향으로 무시되던 문제 — 2026-07-21 감사)
  const hreflang = koHref
    ? `\n    <link rel="alternate" hreflang="en" href="${canonical}" />\n    <link rel="alternate" hreflang="ko" href="${koHref}" />\n    <link rel="alternate" hreflang="x-default" href="${canonical}" />`
    : "";
  const style = extraCss ? `    <style>\n${extraCss}\n    </style>\n` : "";
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
${style}    <style id="opBoxChartCss">${BoxChart.CSS}</style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("../")}
    </header>
    <main id="main-content" class="bodyPage">`;
}

// 페이지 꼬리. 푸터 고지(affNote)와 About/Methodology 링크는 애드센스·EPN 심사 항목이라 빼면 안 된다.
const FOOT = `
      <script src="../box-chart.js?v=${CSS_VER}" defer></script>
      <p class="affNote">As an eBay Partner, we may earn a commission from qualifying purchases made through eBay links on this page — at no extra cost to you.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../free-data.html">Free data (CSV)</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

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

module.exports = { ROOT, SITE, EPN, CSS_VER, BoxChart, esc, usd, intl, monthYear, AFF_TOP, FOOT, pageHead, upsertSitemap };
