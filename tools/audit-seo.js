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

function requiredPageChecks(file) {
  const content = read(file);
  requireMatch(content, /<title>[^<]{20,}<\/title>/i, "descriptive title", file);
  requireMatch(content, /<meta\s+name="description"\s+content="[^"]{70,}"/i, "descriptive meta description", file);
  requireMatch(content, /<meta\s+name="robots"\s+content="(?=[^"]*index)(?=[^"]*follow)[^"]+"/i, "index,follow robots", file);
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
  ["index.html", "packs.html"].forEach(requiredPageChecks);
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
    requiredPageChecks(file);
    requireMatch(read(file), /"@type"\s*:\s*"Article"/i, "Article schema", file);
  }
  for (const file of setPages) {
    requiredPageChecks(file);
    requireMatch(read(file), /"@type"\s*:\s*"FAQPage"/i, "FAQ schema", file);
  }
}

checkHome();
checkSitemap();
checkStaticContent();

console.log(JSON.stringify({
  homePages: 2,
  articlePages: readHtmlFiles("articles").length - 1,
  setPages: readHtmlFiles("sets").length - 1,
  errors,
  warnings,
}, null, 2));

if (errors.length) process.exitCode = 1;
