/*
 * Static SEO guardrail. It checks crawlable markup only and never reads or
 * changes market prices. Run locally with: node tools/audit-seo.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const errors = [];
const warnings = [];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function requireMatch(content, pattern, label, file) {
  if (!pattern.test(content)) errors.push(`${file}: missing ${label}`);
}

function requiredPageChecks(file, { robots = "index" } = {}) {
  const content = read(file);
  requireMatch(content, /<title>[^<]{20,}<\/title>/i, "descriptive title", file);
  requireMatch(content, /<meta\s+name="description"\s+content="[^"]{70,}"/i, "descriptive meta description", file);
  const robotsTags = content.match(/<meta\s+name="robots"\s+content="[^"]+"\s*\/?>/gi) || [];
  if (robotsTags.length !== 1) errors.push(`${file}: expected exactly one robots meta tag, found ${robotsTags.length}`);
  const robotsPattern = robots === "noindex"
    ? /<meta\s+name="robots"\s+content="noindex,follow(?:,[^"]*)?"\s*\/?>/i
    : /<meta\s+name="robots"\s+content="index,follow(?:,[^"]*)?"\s*\/?>/i;
  requireMatch(content, robotsPattern, `${robots},follow robots`, file);
  requireMatch(content, new RegExp(`<link\\s+rel="canonical"\\s+href="${SITE.replace(/[./]/g, "\\$&")}`), "absolute canonical", file);
  requireMatch(content, /<meta\s+property="og:title"\s+content="[^"]+"/i, "Open Graph title", file);
  requireMatch(content, /<meta\s+property="og:description"\s+content="[^"]+"/i, "Open Graph description", file);
  requireMatch(content, /<meta\s+property="og:image"\s+content="https:\/\/opboxindex\.com\//i, "Open Graph image", file);
  requireMatch(content, /<h1(?:\s[^>]*)?>[\s\S]*?<\/h1>/i, "visible H1", file);
  if (/http-equiv="refresh"|location\.replace\(/i.test(content)) errors.push(`${file}: redirect-only page is not crawlable content`);
}

function readHtmlFiles(relativeDir) {
  return fs.readdirSync(path.join(ROOT, relativeDir))
    .filter((file) => file.endsWith(".html"))
    .map((file) => path.posix.join(relativeDir, file));
}

function checkHome() {
  const home = read("index.html");
  const packs = read("packs.html");
  requiredPageChecks("index.html");
  requiredPageChecks("packs.html", { robots: "noindex" });
  for (const [file, content] of [["index.html", home], ["packs.html", packs]]) {
    requireMatch(content, /<link\s+rel="canonical"\s+href="https:\/\/opboxindex\.com\/"\s*\/>/i, "root canonical", file);
    // 키 순서에 의존하지 않게 타입·필수필드를 각각 확인(브랜드 엔티티 스키마는 @id/sameAs/knowsAbout 등으로 확장됨)
    requireMatch(content, /"@type":"WebSite"/i, "WebSite schema", file);
    requireMatch(content, /"@type":"Organization"/i, "Organization schema", file);
    requireMatch(content, /"name":"OP Box Index"/i, "brand name in schema", file);
    requireMatch(content, /"alternateName":\s*(?:\[[^\]]*"OPBoxIndex"|"OPBoxIndex")/i, "brand alternateName", file);
    if (/"@type":"SearchAction"/i.test(content)) errors.push(`${file}: SearchAction is declared without a working site search`);
  }
}

function checkSitemap() {
  const sitemap = read("sitemap.xml");
  requireMatch(sitemap, /<loc>https:\/\/opboxindex\.com\/<\/loc>/, "root canonical URL", "sitemap.xml");
  // 홈 중복 변형(sitemap 등재)은 canonical 클러스터 오염 원인(2026-07 홈 노출 0 사고) — 재발 방지
  if (/<loc>https:\/\/opboxindex\.com\/(index\.html|packs\.html)/.test(sitemap)) errors.push("sitemap.xml: duplicate homepage variant (/index.html or /packs.html) must not be listed");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1].replace(/&amp;/g, "&"));
  for (const url of urls) {
    const pathname = new URL(url).pathname;
    const relativeFile = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    if (!fs.existsSync(path.join(ROOT, relativeFile))) errors.push(`sitemap.xml: missing local target ${url}`);
  }
  if (urls.length < 70) warnings.push(`sitemap.xml: only ${urls.length} URLs`);
}

function checkStaticContent() {
  const pages = ["compare.html", "psa10-ranking.html", "about.html", "amazon-lottery.html", "articles/index.html"];
  pages.forEach(requiredPageChecks);
  const articlePages = readHtmlFiles("articles").filter((file) => file !== "articles/index.html");
  const setPages = readHtmlFiles("sets").filter((file) => file !== "sets/index.html");
  for (const file of articlePages) {
    requiredPageChecks(file, {
      robots: /^articles\/weekly-market-report-\d{4}-\d{2}-\d{2}\.html$/.test(file) ? "noindex" : "index",
    });
    requireMatch(read(file), /"@type"\s*:\s*"Article"/i, "Article schema", file);
  }
  for (const file of setPages) {
    requiredPageChecks(file);
    // 세트별 공식 카드리스트(2026-10-14, W7)는 FAQ 를 새로 넣지 않는 규칙이라 대신 목록 구조화데이터를 요구한다.
    if (/-card-list\.html$/.test(file)) {
      const content = read(file);
      requireMatch(content, /"@type"\s*:\s*"CollectionPage"/i, "CollectionPage schema", file);
      requireMatch(content, /"@type"\s*:\s*"ItemList"/i, "ItemList schema", file);
      requireMatch(content, /"@type"\s*:\s*"BreadcrumbList"/i, "BreadcrumbList schema", file);
      continue;
    }
    requireMatch(read(file), /"@type"\s*:\s*"FAQPage"/i, "FAQ schema", file);
  }

  // 재판 랜딩(priority-set-seo.json 의 세트) — 2026-10-15 소유자 결정(데이터 페이지엔 숫자·표·라벨만)으로 수기 검색 의도 블록
  // (searchIntent·factory-seal 안내)을 없앴다. 계약 = 데이터 섹션: "<CODE> reprint records" 제목 + 라벨 목록(generate-set-pages.js).
  // 생성 산출물을 직접 고치지 않고 생성기를 통해 이 계약을 만족시킨다.
  const prioritySetPages = Object.keys(JSON.parse(read("data/priority-set-seo.json")).sets || {}).map((c) => c.toLowerCase());
  for (const need of ["op-01", "op-05", "prb-01", "eb-03", "op-13", "op-17"]) {
    if (!prioritySetPages.includes(need)) errors.push(`data/priority-set-seo.json: 재판 랜딩 ${need} 이 빠졌다`);
  }
  for (const setSlug of prioritySetPages) {
    const file = `sets/${setSlug}.html`;
    requireMatch(read(file), /<h2>(?:OP|EB|PRB)-\d+ reprint records<\/h2>\s*<ul class="keyFacts">/, "priority-set reprint records section", file);
  }
}

// Product 는 어디에 있든(최상위·ItemList 안·@graph 안) offers / review / aggregateRating 중 하나가 있어야 한다.
// 2026-10-14 QA: 발매일 글·ja 발매일 표의 ItemList 안 Product 73개에 셋 다 없어 Search Console Product snippets 무효 항목이 된다.
function checkNestedProducts() {
  const files = [...readHtmlFiles("articles"), ...readHtmlFiles("sets"), ...readHtmlFiles("ja"), ...readHtmlFiles("ko"), "index.html", "box-prices.html", "compare.html"]
    .filter((f) => fs.existsSync(path.join(ROOT, f)));
  const walk = (node, file, where) => {
    if (Array.isArray(node)) { node.forEach((n, i) => walk(n, file, `${where}[${i}]`)); return; }
    if (!node || typeof node !== "object") return;
    const t = [].concat(node["@type"] || []);
    if (t.includes("Product") && !node.offers && !node.review && !node.aggregateRating) errors.push(`${file}: Product without offers/review/aggregateRating at ${where} (${String(node.name || "").slice(0, 60)})`);
    for (const [k, v] of Object.entries(node)) if (v && typeof v === "object") walk(v, file, `${where}.${k}`);
  };
  for (const file of files) {
    for (const m of read(file).matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
      let j; try { j = JSON.parse(m[1]); } catch { continue; }
      walk(j, file, "$");
    }
  }
}

checkHome();
checkSitemap();
checkStaticContent();
checkNestedProducts();

console.log(JSON.stringify({
  homePages: 2,
  articlePages: readHtmlFiles("articles").length - 1,
  setPages: readHtmlFiles("sets").length - 1,
  errors,
  warnings,
}, null, 2));

if (errors.length) process.exitCode = 1;
