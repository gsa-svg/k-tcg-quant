/**
 * Builds the two editorial pages for announced sets that do not yet have a
 * complete market-data record. Edit data/upcoming-set-pages.json, not sets/.
 * Run: node tools/generate-upcoming-set-pages.js
 */
const fs = require("fs");
const { navHtml } = require("./site-nav");
const { AFF_TOP, epnUrl } = require("./set-page-shared");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SOURCE_FILE = path.join(ROOT, "data", "upcoming-set-pages.json");
const OUTPUT_DIR = path.join(ROOT, "sets");
const source = JSON.parse(fs.readFileSync(SOURCE_FILE, "utf8"));
const CSS_VERSION = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8")
  .match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function displayDate(isoDate) {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${isoDate}T00:00:00Z`));
}

function validatePage(page) {
  const requiredStrings = ["slug", "code", "title", "description", "headline", "published", "modified"];
  for (const key of requiredStrings) {
    if (!page[key] || typeof page[key] !== "string") throw new Error(`${page.slug || "page"}: missing ${key}`);
  }
  if (!/^(?:op|eb)-\d{2}$/.test(page.slug)) throw new Error(`${page.slug}: invalid upcoming set slug`);
  for (const key of ["facts", "sections", "faq", "related"]) {
    if (!Array.isArray(page[key]) || page[key].length === 0) throw new Error(`${page.slug}: missing ${key}`);
  }
  if (!page.sourceHtml.includes("en.onepiece-cardgame.com/products/")) {
    throw new Error(`${page.slug}: official Bandai product source is required`);
  }
  // 상단 발매일 상자의 ISO 날짜는 공식 사실 표와 반드시 같아야 한다 — 한쪽만 고치면 같은 페이지에 날짜가 둘이 된다.
  for (const [key, label] of [["releaseEn", "English release"], ["releaseJp", "Japanese release"]]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(page[key] || "")) throw new Error(`${page.slug}: ${key} (YYYY-MM-DD) is required`);
    const row = page.facts.find(([l]) => l === label);
    if (!row || !row[1].startsWith(displayDate(page[key]))) throw new Error(`${page.slug}: ${key} ${page[key]} ≠ facts "${label}"`);
  }
}

// 발매일 검색(2026-10-02): "one piece op 18 release date" 는 노출 1위인데 순위 7~9위·클릭 0 이었다(Bing 70일).
// 답(날짜)을 제목·첫 화면에 바로 보이게 한다 — 경쟁 상위 페이지는 전부 제목에 날짜나 카운트다운이 있다.
const shortDate = (iso) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
function releaseRange(page) {
  const [a, b] = [page.releaseEn, page.releaseJp].sort();
  const year = b.slice(0, 4);
  if (a === b) return `${shortDate(a)}, ${year}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${shortDate(a)}–${b.slice(8).replace(/^0/, "")}, ${year}`;
  return `${shortDate(a)}–${shortDate(b)}, ${year}`;
}
const weekday = (iso) => new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: "UTC" }).format(new Date(`${iso}T00:00:00Z`));
const TODAY = new Date().toISOString().slice(0, 10);
function daysLeftText(iso) {
  const d = Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${TODAY}T00:00:00Z`)) / 86400000);
  return d > 1 ? `in ${d} days` : d === 1 ? "tomorrow" : d === 0 ? "today" : "released";
}
// 상단 발매일 상자: 이른 날짜가 위. 남은 날수는 생성 시각 기준으로 굽고, 방문자 날짜로 스크립트가 다시 센다.
function releaseBox(page) {
  const rows = [["English", page.releaseEn], ["Japan", page.releaseJp]].sort((x, y) => x[1].localeCompare(y[1]));
  const rowHtml = rows.map(([where, iso]) => `<div class="relRow"><span class="relWhere">${where}</span><b><time datetime="${iso}">${displayDate(iso)}</time> <small>${weekday(iso)}</small></b><span class="relLeft" data-release="${iso}">${daysLeftText(iso)}</span></div>`).join("\n        ");
  const ebay = epnUrl(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`One Piece ${page.code} booster box`)}&_sop=10&customid=rel-${page.slug}`);
  return `<section class="relBox" aria-label="${escapeHtml(page.code)} release dates">
        ${rowHtml}
        ${AFF_TOP}
        <p class="relBuy"><a class="relBtn" href="${escapeHtml(ebay)}" target="_blank" rel="noopener noreferrer sponsored">${escapeHtml(page.code)} pre-orders on eBay</a></p>
      </section>`;
}

// 예약판매 가격 표 — 2026-10-08. 발매 전에 실제로 검색되는 질문("EB-05 box pre-order price")에 우리 데이터로 답한다.
// 호가는 collect-preorder-prices.js(일별, 배송비 포함 매물 백분위), 실거래는 box-sold 러너(주별 중앙값). 둘 다 없으면 표를 그리지 않는다.
// 라벨만 두고 설명문은 한 줄 — 추정·예측 문구 금지(공개 문구 규칙).
const PREORDER = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "preorder-series.json"), "utf8")); } catch { return null; } })();
const SOLD_SERIES = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8")); } catch { return null; } })();
const usd = (n) => (n == null ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);
function preorderTable(page) {
  const ask = PREORDER?.sets?.[page.code];
  const sold = SOLD_SERIES?.sets?.[page.code];
  const rows = [["Japanese", "jp"], ["English", "en"]].map(([label, ed]) => {
    const a = (ask?.[ed] || []).slice(-1)[0] || null;
    const s = (sold?.[ed] || []).filter((p) => p && p.median != null).slice(-1)[0] || null;
    if (!a && !s) return null;
    // 모바일 390px 에서 4열은 마지막 열이 잘린다(실측) — 3열로 두고 보조 수치는 셀 안 둘째 줄(small)에.
    const bestHtml = a?.best ? `<a href="${escapeHtml(epnUrl(a.best.url + (a.best.url.includes("?") ? "&" : "?") + `customid=preorder-${page.slug}-${ed}`))}" target="_blank" rel="noopener noreferrer sponsored">${usd(a.best.total)}</a>` : "—";
    const askHtml = a && a.n ? `${bestHtml}<small>median ${usd(a.median)} · ${a.n} listing${a.n === 1 ? "" : "s"}</small>` : "—";
    const soldHtml = s ? `${usd(s.median)}<small>${s.n} sold · wk of ${escapeHtml(s.d.slice(5))}</small>` : "—";
    return `<tr><td>${label} box</td><td>${askHtml}</td><td>${soldHtml}</td></tr>`;
  }).filter(Boolean);
  if (!rows.length) return "";
  const asOf = ask?.jp?.slice(-1)[0]?.d || ask?.en?.slice(-1)[0]?.d || PREORDER?.updated || "";
  return `
      <h2>${escapeHtml(page.code)} pre-order box prices on eBay</h2>
      <table class="factTable preTbl"><thead><tr><th>Edition</th><th>Cheapest ask</th><th>Sold median</th></tr></thead><tbody>
          ${rows.join("\n          ")}
      </tbody></table>
      <p class="sourceNoteA">Asking prices: eBay fixed-price listings for sealed boxes, shipping included${asOf ? `, as of ${escapeHtml(asOf)}` : ""}; collected daily before release. Sold median: completed eBay sales we track weekly. Same filters as the <a href="index.html">released-set guides</a>.</p>`;
}

function renderSections(sections) {
  return sections.map((section) => `
      <section${section.searchIntent ? ' class="searchIntent"' : ""}>
        <h2>${escapeHtml(section.heading)}</h2>
        ${section.paragraphsHtml.map((paragraph) => `<p>${paragraph}</p>`).join("\n        ")}
      </section>`).join("\n");
}

// 검색 제목·설명(2026-09-17): 구글은 제목 60자·설명 155자를 넘기면 잘라내거나 다시 쓴다(OP-18 은 82자/185자였다).
// JSON 의 title·description 은 편집용 긴 문장이라 그대로 못 쓴다 — <title> 은 코드 + 세트명(title 에서 " (" / " — " 앞까지)
// + "Booster Box Release Date", 설명은 코드 + 세트명 + 발매일 FAQ(faq[0]) 답의 앞 문장들로 만든다. 넘치면 생성을 멈춘다.
const TITLE_MAX = 60, DESC_MAX = 155;
const fit = (cands, max, what) => {
  const hit = cands.find((c) => c.length <= max);
  if (!hit) throw new Error(`SEO 길이 초과: ${what} — ${cands[cands.length - 1].length}자 > ${max}자 "${cands[cands.length - 1]}"`);
  return hit;
};
const seenTitles = new Set();
function seoName(page) {
  if (!page.title.startsWith(`${page.code} `)) throw new Error(`${page.slug}: title 은 "${page.code} <세트명>" 으로 시작해야 한다`);
  const name = page.title.slice(page.code.length + 1).split(/\s+(?:\(|—)/)[0].trim();
  if (!name) throw new Error(`${page.slug}: title 에서 세트명을 못 뽑았다`);
  return name;
}
function seoTitle(page) {
  // 2026-09-29: 실검색어는 "one piece op 18 release date" 다(GSC). 종전 제목엔 'One Piece' 가 없고
  // 'Release Date' 가 맨 뒤라 구글 75위였다. 검색어 순서대로 앞에 둔다.
  // 2026-10-02: 날짜를 제목에 넣는다(답이 제목에 보여야 클릭·인용이 붙는다). 60자를 넘으면 세트명부터 뺀다.
  const dated = `One Piece ${page.code} Release Date: ${releaseRange(page)}`;
  const title = fit([`${dated} — ${seoName(page)}`, dated], TITLE_MAX, page.slug);
  if (seenTitles.has(title)) throw new Error(`타이틀 중복: ${title}`);
  seenTitles.add(title);
  return title;
}
function seoDescription(page) {
  const [question, answer] = page.faq[0];
  if (!/release/i.test(question)) throw new Error(`${page.slug}: faq[0] 은 발매일 질문이어야 한다(검색 설명의 원문)`);
  const lead = `${page.code} ${seoName(page)}: `;
  const sentences = answer.split(/(?<=\.)\s+/);
  return fit(sentences.map((_, i) => lead + sentences.slice(0, sentences.length - i).join(" ")), DESC_MAX, page.slug);
}

function renderPage(page) {
  validatePage(page);
  const canonical = `https://opboxindex.com/sets/${page.slug}.html`;
  const title = seoTitle(page);
  const description = seoDescription(page);
  const articleSchema = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.headline,
    description,
    datePublished: page.published,
    dateModified: page.modified,
    inLanguage: "en-US",
    mainEntityOfPage: { "@type": "WebPage", "@id": canonical },
    author: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/about.html" },
    publisher: { "@type": "Organization", name: "OP Box Index", url: "https://opboxindex.com/" },
    isAccessibleForFree: true,
  };
  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "OP Box Index", item: "https://opboxindex.com/" },
      { "@type": "ListItem", position: 2, name: "Set guides", item: "https://opboxindex.com/sets/index.html" },
      { "@type": "ListItem", position: 3, name: page.code, item: canonical },
    ],
  };
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faq.map(([question, answer]) => ({
      "@type": "Question",
      name: question,
      acceptedAnswer: { "@type": "Answer", text: answer },
    })),
  };
  const factRows = page.facts
    .map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${escapeHtml(value)}</td></tr>`)
    .join("\n          ");
  const faqHtml = page.faq
    .map(([question, answer]) => `<details><summary>${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`)
    .join("\n        ");
  const relatedHtml = page.related
    .map(([label, href]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("\n        ");

  return `<!doctype html>
<!-- Generated by tools/generate-upcoming-set-pages.js; edit data/upcoming-set-pages.json. -->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="https://opboxindex.com/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(articleSchema)}</script>
    <script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
    <script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
    <link rel="stylesheet" href="../styles.css?v=${CSS_VERSION}" />
    <script defer src="../lang-toggle.js?v=${CSS_VERSION}"></script>
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .factTable{width:100%;max-width:720px;border-collapse:collapse;margin:16px 0}.preTbl td small{display:block;color:var(--muted);font-size:11.5px;margin-top:2px}.preTbl td:first-child{white-space:nowrap}.factTable th,.factTable td{padding:9px 10px;border-bottom:1px solid rgba(255,255,255,.08);text-align:left;vertical-align:top}.factTable th{width:36%;color:#9aa4b6;font-weight:600}.sourceNoteA{max-width:760px;color:#9aa4b6;font-size:13px;line-height:1.65}.setFaq{max-width:760px}.setFaq details{border-bottom:1px solid rgba(255,255,255,.08);padding:8px 0}.setFaq summary{cursor:pointer;font-weight:700}
      .relBox{max-width:720px;margin:14px 0 18px;padding:12px 16px 14px;border:1px solid var(--accent-line);border-radius:12px;background:var(--accent-dim)}
      .relRow{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 12px;padding:7px 0;border-bottom:1px solid rgba(255,255,255,.08)}
      .relWhere{flex:0 0 64px;color:var(--muted);font-size:13px;font-weight:600}
      .relRow b{flex:1 1 auto;font-family:var(--font-display);font-size:19px;line-height:1.25;color:var(--ink)}
      .relRow b small{font-family:inherit;font-size:13px;font-weight:600;color:var(--muted);margin-left:4px}
      .relLeft{color:var(--accent);font-size:14px;font-weight:700;white-space:nowrap}
      .relBox .affTop{margin:10px 0 0}
      .relBuy{margin:10px 0 0}
      .relBtn{display:inline-block;padding:9px 14px;border-radius:9px;background:var(--accent);color:#06222a;font-weight:700;font-size:14px;text-decoration:none}
      .relBtn:hover,.relBtn:focus-visible{filter:brightness(1.08);text-decoration:underline}
      @media (max-width:420px){.relWhere{flex-basis:100%}.relRow b{font-size:18px}}
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("../")}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">${escapeHtml(page.eyebrow)}</p>
      <h1>${escapeHtml(page.headline)}</h1>
      ${releaseBox(page)}
      ${preorderTable(page)}
      <p class="articleMeta">Research and data: <a href="../about.html">OP Box Index</a> · Published <time datetime="${page.published}">${displayDate(page.published)}</time> · Updated <time datetime="${page.modified}">${displayDate(page.modified)}</time> · <a href="../methodology.html">Data sources &amp; methodology</a></p>
      <p>${page.introHtml}</p>
      <h2>Product facts</h2>
      <table class="factTable"><tbody>
          ${factRows}
      </tbody></table>
      <p class="sourceNoteA">${page.sourceHtml}</p>
${renderSections(page.sections)}
      <section class="setFaq" aria-label="${escapeHtml(page.code)} frequently asked questions">
        <h2>Frequently asked questions</h2>
        ${faqHtml}
      </section>
    </main>
    <footer class="articleFooter">
      <p class="relatedHead">Related</p>
      <nav class="relatedLinks" aria-label="Related research">
        ${relatedHtml}
        <a href="../about.html">About OP Box Index</a>
      </nav>
      <p class="affNote">OP Box Index is a data research site, not investment advice. Prices are references, not offers.</p>
    </footer>
    <script>
      // 남은 날수를 방문자 날짜로 다시 센다(생성 시각 기준 값이 구워져 있다).
      (function () {
        var now = new Date(), today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
        document.querySelectorAll(".relLeft[data-release]").forEach(function (el) {
          var p = el.getAttribute("data-release").split("-"), d = Math.round((Date.UTC(+p[0], +p[1] - 1, +p[2]) - today) / 86400000);
          el.textContent = d > 1 ? "in " + d + " days" : d === 1 ? "tomorrow" : d === 0 ? "today" : "released";
        });
      })();
    </script>
  </body>
</html>
`;
}

fs.mkdirSync(OUTPUT_DIR, { recursive: true });
for (const page of source.pages) {
  fs.writeFileSync(path.join(OUTPUT_DIR, `${page.slug}.html`), renderPage(page), "utf8");
}
console.log(JSON.stringify({ pagesWritten: source.pages.length, sourceUpdated: source.updated }));
