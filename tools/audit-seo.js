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
    requireMatch(content, /"@type":"WebSite","name":"OP Box Index","alternateName":"OPBoxIndex","url":"https:\/\/opboxindex\.com\/"/i, "WebSite name schema", file);
    requireMatch(content, /"@type":"Organization","name":"OP Box Index"/i, "Organization schema", file);
    if (/"@type":"SearchAction"/i.test(content)) errors.push(`${file}: SearchAction is declared without a working site search`);
  }
}

function checkSitemap() {
  const sitemap = read("sitemap.xml");
  requireMatch(sitemap, /<loc>https:\/\/opboxindex\.com\/<\/loc>/, "root canonical URL", "sitemap.xml");
  if (sitemap.includes("<loc>https://opboxindex.com/packs.html?hl=en</loc>")) errors.push("sitemap.xml: old duplicate homepage URL remains");
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
