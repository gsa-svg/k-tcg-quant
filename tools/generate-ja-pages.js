#!/usr/bin/env node
"use strict";
// 일본어 발매일 표 — ja/release-dates.html. 2026-10-14 신설(W8).
//
// 왜: "ワンピースカード 発売日 一覧" 류 일본어 질의(AI 인용 점유 48.7%)에 우리 일본어 페이지가 아예 없었다.
//     영문 발매일 글(articles/one-piece-set-list-release-dates.html)과 같은 사실을 일본어 라벨로 한 장에 싣는다.
// 원칙(공개 문구 규칙): 표와 라벨만, 문장 없음. 값은 data/set-facts.json(반다이 공식 상품 페이지에서 확인한 일본판 발매일·정가)과
//     data/official-cardlist.json(공식 상품명)·data/upcoming-set-pages.json(발매 전 세트의 공식 상품명)에서만. 없으면 "—".
//     "あとN日" 은 일본 시간 기준으로 구운 뒤, 방문자 날짜로 스크립트가 다시 센다(발매 예정 세트 페이지와 같은 방식).
// 노출: 새 URL 추가만 — 사이트맵 추가, hreflang 은 이 페이지와 영문 발매일 글에 서로 추가만 한다(기존 태그는 건드리지 않는다).
// ko/ 정적판처럼 생성기가 HTML 전체를 쓰고, 메뉴·푸터 가이드 줄·GA 로더는 inject-nav 가 맞춘다.
// Run: node tools/generate-ja-pages.js   (generate-ko-topic-pages.js 다음)
const fs = require("fs");
const path = require("path");
const { navHtml } = require("./site-nav");
const CL = require("./card-list-shared");
const { addUrls } = require("./sitemap-detail-urls");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const FILE = "ja/release-dates.html";
const URL_JA = `${SITE}/${FILE}`;
const EN_REL = "articles/one-piece-set-list-release-dates.html";
const URL_EN = `${SITE}/${EN_REL}`;
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v || "");

const FACTS = (readJson("data/set-facts.json") || {}).sets || {};
const UPCOMING = (readJson("data/upcoming-set-pages.json") || {}).pages || [];
const LISTS = Object.fromEntries(CL.products().map((p) => [p.code, p]));
// 일본 시간 오늘 — 발매일은 일본 날짜다.
const TODAY_JST = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

// 공식 상품명: 카드리스트 상품명 → 없으면(발매 전) 예정 세트 페이지의 "Product" 사실 칸 앞쪽(일본어 공식명, 【코드】 제외).
function jpName(code) {
  const p = LISTS[code];
  if (p && p.name) return p.name;
  const up = UPCOMING.find((x) => x.code === code);
  const prod = up && (up.facts || []).find((f) => f[0] === "Product");
  if (!prod) return "";
  return String(prod[1]).split(" · ")[0].replace(/【[^】]*】/g, "").trim();
}
// 상품 종류(ブースターパック 등)와 이름을 나눈다 — 좁은 화면에서 이름을 크게, 종류는 작게.
const KINDS = ["ブースターパック", "エクストラブースター", "プレミアムブースター"];
function splitName(name) {
  const k = KINDS.find((x) => name.startsWith(x + " "));
  return k ? { kind: k, title: name.slice(k.length + 1) } : { kind: "", title: name };
}

const codes = [...new Set([...Object.keys(FACTS), ...Object.keys(LISTS)])];
const rows = codes.map((code) => {
  const f = FACTS[code] || {};
  const rel = isDate(f.jpRelease && f.jpRelease.date) ? f.jpRelease.date : null;
  const box = Number.isFinite(f.jpMsrpYen) ? f.jpMsrpYen : null;
  const pack = Number.isFinite(f.jpMsrpYenPerPack) ? f.jpMsrpYenPerPack : box && f.packsPerBox ? Math.round(box / f.packsPerBox) : null;
  const src = (f.jpSpecSource && f.jpSpecSource.source) || (f.jpRelease && f.jpRelease.source) || null;
  const checked = [f.jpRelease && f.jpRelease.verifiedOn, f.jpSpecSource && f.jpSpecSource.verifiedOn].filter(isDate).sort().pop() || null;
  // 박스 구성이 공식 페이지에 없는 세트(OP-17)의 BOX定価 는 "24×팩 가격" 라벨 — 2026-10-14 QA: 'バンダイ公式' 캡션 아래 공식에 없는 값이 있었다.
  const boxCalc = !!(f.boxConfig && f.boxConfig.stated === false);
  return { code, rel, box, pack, boxCalc, packs: f.packsPerBox || null, name: jpName(code), src, checked };
}).sort((a, b) => (a.rel && b.rel ? (a.rel < b.rel ? 1 : a.rel > b.rel ? -1 : CL.naturalCode(a.code, b.code)) : a.rel ? -1 : b.rel ? 1 : CL.naturalCode(a.code, b.code)));

const WD = ["日", "月", "火", "水", "木", "金", "土"];
const mdWd = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${m}/${d}(${WD[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`; };
const yen = (v) => `${v.toLocaleString("ja-JP")}円`;
function daysLeft(iso) {
  const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${TODAY_JST}T00:00:00Z`)) / 864e5);
  return d > 0 ? `あと${d}日` : d === 0 ? "本日発売" : "発売済み";
}
// 정적 글자는 매일 바뀌지 않는 값으로 — "あとN日" 을 구워 두면 생성기가 돌 때마다 본문·lastmod·IndexNow 가 바뀐다(2026-10-14 QA).
// 남은 날수는 스크립트가 일본 시간 기준으로 채운다. 스크립트가 없으면 "発売前"(발매일은 첫 칸에 있다).
function staticLeft(iso) {
  return iso > TODAY_JST ? "発売前" : iso === TODAY_JST ? "本日発売" : "発売済み";
}

// 연도 묶음 행 + 행
let lastYear = null;
const trs = [];
for (const r of rows) {
  const y = r.rel ? r.rel.slice(0, 4) : "—";
  if (y !== lastYear) { trs.push(`<tr class="yr"><th colspan="5" scope="colgroup">${y === "—" ? "発売日 —" : `${y}年`}</th></tr>`); lastYear = y; }
  const nm = splitName(r.name);
  trs.push(`<tr>`
    + `<td>${r.rel ? `<time datetime="${r.rel}">${mdWd(r.rel)}</time>` : "—"}</td>`
    + `<td>${esc(nm.title || "—")}${nm.kind ? `<small>${esc(nm.kind)}</small>` : ""}</td>`
    + `<td class="num">${esc(r.code)}</td>`
    + `<td class="num">${r.box ? yen(r.box) : "—"}${r.box && r.boxCalc && r.pack ? `<small>${r.packs || 24}×${yen(r.pack)} 公式未記載</small>` : ""}${!r.box && r.pack ? `<small>1パック ${yen(r.pack)}</small>` : ""}</td>`
    + `<td class="num">${r.rel ? `<span data-release="${r.rel}">${staticLeft(r.rel)}</span>` : "—"}</td>`
    + `</tr>`);
}

const checkedDates = rows.map((r) => r.checked).filter(Boolean).sort();
function jaDate(iso) { const [y, m, d] = iso.split("-").map(Number); return `${y}年${m}月${d}日`; }
const checkedLabel = checkedDates.length ? (checkedDates[0] === checkedDates.at(-1) ? checkedDates[0] : `${checkedDates[0]}〜${checkedDates.at(-1)}`) : "—";
const modified = checkedDates.at(-1) || TODAY_JST;
const upcoming = rows.filter((r) => r.rel && r.rel > TODAY_JST).sort((a, b) => (a.rel < b.rel ? -1 : 1));

const title = "ワンピースカード 発売日一覧 — 弾番号・BOX定価(日本版)";
const desc = `ワンピースカードゲーム日本版の発売日一覧。${upcoming.map((r) => `${r.code} ${splitName(r.name).title} ${jaDate(r.rel)}`).join("、")}${upcoming.length ? "ほか" : ""}全${rows.filter((r) => r.rel).length}弾の発売日・弾番号・BOX定価(税込)。バンダイ公式商品ページで確認。`;

// 출처·각 세트 페이지 링크 — 표 안이 아니라 표 아래 라벨 줄에 둔다(좁은 화면에서 표 끝 열 링크가 화면 밖으로 밀리지 않게).
const srcLinks = rows.filter((r) => r.src).map((r) => `<a href="${esc(r.src)}" rel="noopener noreferrer" target="_blank">${esc(r.code)}</a>`).join(" · ");
const pageLinks = rows.map((r) => {
  const own = fs.existsSync(path.join(ROOT, "sets", `${r.code.toLowerCase()}.html`)) ? `../sets/${r.code.toLowerCase()}.html` : LISTS[r.code] ? `../${CL.pagePath(r.code)}` : null;
  return own ? `<a href="${own}" hreflang="en">${esc(r.code)}</a>` : null;
}).filter(Boolean).join(" · ");

const itemLd = {
  "@context": "https://schema.org", "@type": "ItemList",
  name: "ワンピースカードゲーム 発売日一覧(日本版)",
  numberOfItems: rows.filter((r) => r.rel).length,
  // ListItem(이름·주소)만 — offers 없는 Product 는 GSC 무효 항목이 된다(2026-10-14 QA). 발매일은 이름과 화면 표에.
  itemListElement: rows.filter((r) => r.rel).map((r, i) => {
    const own = fs.existsSync(path.join(ROOT, "sets", `${r.code.toLowerCase()}.html`)) ? `${SITE}/sets/${r.code.toLowerCase()}.html` : LISTS[r.code] ? `${SITE}/${CL.pagePath(r.code)}` : null;
    return { "@type": "ListItem", position: i + 1, name: `ONE PIECEカードゲーム ${r.name}【${r.code}】 ${jaDate(r.rel)}発売`, ...(own ? { url: own } : {}) };
  }),
};
const crumbLd = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
  { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
  { "@type": "ListItem", position: 2, name: "発売日一覧", item: URL_JA },
] };
const pageLd = { "@context": "https://schema.org", "@type": "WebPage", name: title, url: URL_JA, inLanguage: "ja", dateModified: modified, isPartOf: { "@type": "WebSite", name: "OP Box Index", url: `${SITE}/` } };

const html = `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${URL_JA}" />
    <link rel="alternate" hreflang="ja" href="${URL_JA}" />
    <link rel="alternate" hreflang="en" href="${URL_EN}" />
    <link rel="alternate" hreflang="x-default" href="${URL_EN}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="ja_JP" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${URL_JA}" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(crumbLd)}</script>
    <script type="application/ld+json">${JSON.stringify(pageLd)}</script>
    <script type="application/ld+json">${JSON.stringify(itemLd)}</script>
    <link rel="stylesheet" href="../styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="manifest" href="/site.webmanifest" />
    <style>
      .jaRel { min-width: 0; width: 100%; max-width: 760px; }
      .jaRel td small { display: block; color: var(--muted); font-size: 11.5px; }
      .jaRel td { line-break: strict; word-break: normal; overflow-wrap: normal; }   /* 장음 부호(ー)·닫는 괄호만 다음 줄로 떨어지지 않게 */
      .jaRel td:first-child, .jaRel td:first-child time { white-space: nowrap; }
      .jaRel td.num small { word-break: keep-all; }   /* "1パック 240円" 은 띄어쓰기에서만 접는다 */
      .jaRel td.num { text-align: right; white-space: nowrap; }
      .jaRel thead th.num { text-align: right; }
      .jaRel tr.yr th { color: var(--muted); font-size: 12.5px; font-weight: 700; padding-top: 16px; }
      .jaLinks { color: var(--muted); font-size: 13px; line-height: 1.9; max-width: 760px; margin: 6px 0; }
      .jaLinks a { color: var(--accent); white-space: nowrap; }
      /* 좁은 화면: 공용 표 규칙(.bodyPage table → block + 가로 스크롤 + 오른쪽 흐림)이 마지막 열(あとN日)을 가렸다(390px 실측).
         다섯 열이 한 화면에 들어가게 표로 되돌리고 칸 여백을 줄인다 — 상품명 칸만 줄바꿈. */
      @media (max-width: 720px) {
        .bodyPage table.jaRel { display: table; width: 100%; min-width: 0; mask-image: none; -webkit-mask-image: none; font-size: 12.5px; }
        .bodyPage table.jaRel th, .bodyPage table.jaRel td { padding: 7px 4px; }
        .bodyPage table.jaRel thead th { font-size: 11.5px; }
        .jaRel td.num small { white-space: normal; }
      }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">本文へスキップ</a>
    <header class="topbar" lang="en">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("../", FILE)}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">発売日 · 日本版 · 更新 ${esc(modified)}</p>
      <h1>ワンピースカードゲーム 発売日一覧</h1>
      <table class="dataTable text jaRel">
        <caption>日本版 · 発売日・定価(税込)はバンダイ公式商品ページ(「公式未記載」はパック価格×24) · 確認日 ${esc(checkedLabel)} · あとN日は日本時間</caption>
        <thead><tr><th scope="col">発売日</th><th scope="col">商品名</th><th scope="col" class="num">弾番号</th><th scope="col" class="num">BOX定価</th><th scope="col" class="num">あとN日</th></tr></thead>
        <tbody>
          ${trs.join("\n          ")}
        </tbody>
      </table>
      <p class="jaLinks">出典(バンダイ公式): ${srcLinks}</p>
      <p class="jaLinks">各弾のページ(英語): ${pageLinks}</p>
      <p class="jaLinks">English: <a href="../${EN_REL}" hreflang="en">One Piece Card Game set list &amp; release dates</a></p>
    </main>
    <footer class="footer" lang="en">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation">
        <a href="../about.html">About</a>
        <a href="../methodology.html">Methodology</a>
        <a href="../privacy.html">Privacy</a>
        <a href="../disclaimer.html">Disclaimer</a>
      </nav>
    </footer>
    <script>
      (function () {
        var j = new Date(Date.now() + 9 * 3600000), today = Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate());   // 일본 시간 오늘(캡션 "日本時間")
        document.querySelectorAll("[data-release]").forEach(function (el) {
          var p = el.getAttribute("data-release").split("-"), d = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - today) / 86400000);
          el.textContent = d > 0 ? "あと" + d + "日" : d === 0 ? "本日発売" : "発売済み";
        });
      })();
    </script>
  </body>
</html>
`;

fs.mkdirSync(path.join(ROOT, "ja"), { recursive: true });
const out = path.join(ROOT, FILE);
const before = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : null;
if (before !== html) fs.writeFileSync(out, html, "utf8");

// 영문 발매일 글에 짝 hreflang 을 추가만 한다(canonical 바로 뒤, 이미 있으면 그대로). 상호 선언이 없으면 구글이 무시한다(가드 H1).
const enAbs = path.join(ROOT, EN_REL);
let pairAdded = false;
if (fs.existsSync(enAbs)) {
  let en = fs.readFileSync(enAbs, "utf8");
  if (!en.includes(`hreflang="ja" href="${URL_JA}"`)) {
    const nl = en.includes("\r\n") ? "\r\n" : "\n";
    const canon = en.match(/<link rel="canonical" href="[^"]+" \/>/);
    if (canon) {
      const tags = [
        ...(/hreflang="en"/.test(en) ? [] : [`<link rel="alternate" hreflang="en" href="${URL_EN}" />`]),
        `<link rel="alternate" hreflang="ja" href="${URL_JA}" />`,
        ...(/hreflang="x-default"/.test(en) ? [] : [`<link rel="alternate" hreflang="x-default" href="${URL_EN}" />`]),
      ];
      en = en.replace(canon[0], () => canon[0] + tags.map((t) => `${nl}    ${t}`).join(""));
      fs.writeFileSync(enAbs, en, "utf8");
      pairAdded = true;
    }
  }
}

// 사이트맵 — 추가만(이미 있으면 날짜는 sync-sitemap-lastmod.js 가 본문 기준으로 정한다).
const sm = addUrls(path.join(ROOT, "sitemap.xml"), [{ loc: URL_JA, changed: false }], { priority: "0.6", changefreq: "weekly" });
console.log(JSON.stringify({ wrote: FILE, changed: before !== html, rows: rows.length, upcoming: upcoming.map((r) => `${r.code} ${r.rel} ${daysLeft(r.rel)}`), hreflangPairAdded: pairAdded, sitemapAdded: sm.added }));
