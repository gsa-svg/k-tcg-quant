/**
 * AdSense approval preflight for the final, generated HTML.
 *
 * This is deliberately stricter than the generic SEO audit: it verifies that
 * Google ad tags are limited to substantial editorial pages, while eBay EPN
 * links remain available on the data pages that generate the site's income.
 * Run: node tools/audit-adsense-readiness.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ADSENSE_RE = /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/i;
const NOINDEX_RE = /<meta\s+name=["']robots["'][^>]*content=["'][^"']*noindex/i;
const ROBOTS_META_RE = /<meta\s+name=["']robots["'][^>]*>/gi;
const EPN_CAMPAIGN_ID = "5339163744";
const DEVELOPMENT_COPY_RE = /\(\s*MVP\s*\)|display ad placeholder|Google AdSense 광고 자리|Google AdSense slot/i;
const AD_SHELL_RE = /<aside\b[^>]*class=(["'])[^"']*\badsenseSlot\b[^"']*\1[^>]*>[\s\S]*?<\/aside>/gi;
const EXCLUDED_DIRS = new Set([".git", ".planning", "docs", "node_modules", "scratchpad", "social"]);
const errors = [];
const warnings = [];

function walkHtml(dir = ROOT, prefix = "") {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && EXCLUDED_DIRS.has(entry.name)) continue;
    const absolute = path.join(dir, entry.name);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...walkHtml(absolute, relative));
    else if (entry.isFile() && entry.name.endsWith(".html")) files.push(relative);
  }
  return files;
}

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function decodeEntities(text) {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function visibleMainText(html) {
  const main = (html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i) || [])[1]
    || (html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i) || [])[1]
    || html;
  return decodeEntities(main)
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function words(text) {
  return text.match(/[A-Za-z0-9\u3131-\uD79D][A-Za-z0-9\u3131-\uD79D'’-]*/g) || [];
}

function normalizedSentence(sentence) {
  return sentence
    .toLowerCase()
    .replace(/\b(?:op|eb|prb)[- ]?\d+\b/gi, "SET")
    .replace(/\b\d+(?:[.,]\d+)?%?\b/g, "#")
    .replace(/\s+/g, " ")
    .trim();
}

function repeatedWordShare(pages, minimumPageCount = 5) {
  const frequency = new Map();
  const analyzed = pages.map(({ file, text }) => {
    const sentences = text
      .split(/[.!?](?:\s+|$)/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => words(sentence).length >= 8);
    for (const sentence of new Set(sentences.map(normalizedSentence))) {
      frequency.set(sentence, (frequency.get(sentence) || 0) + 1);
    }
    return { file, text, sentences };
  });

  return analyzed.map(({ file, text, sentences }) => {
    const totalWords = words(text).length;
    const repeatedWords = sentences
      .filter((sentence) => (frequency.get(normalizedSentence(sentence)) || 0) >= minimumPageCount)
      .reduce((sum, sentence) => sum + words(sentence).length, 0);
    return {
      file,
      totalWords,
      repeatedWordShare: Math.round((repeatedWords / Math.max(totalWords, 1)) * 100),
    };
  });
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function isApprovalExcludedPage(file) {
  return file === "packs.html"
    || file === "articles/index.html"
    || /^articles\/weekly-market-report-\d{4}-\d{2}-\d{2}\.html$/.test(file)
    || ["about.html", "privacy.html", "disclaimer.html"].includes(file)
    || file.startsWith("cards/")
    || file.startsWith("ko/")
    || file.startsWith("sets/");
}

function isAllowedMonetizedPage(file) {
  return [
    "index.html",
    "amazon-lottery.html",
    "auction.html",
    "compare.html",
    "free-data.html",
    "methodology.html",
    "psa-grading.html",
    "psa10-ranking.html",
  ].includes(file)
    || (file.startsWith("articles/")
      && file !== "articles/index.html"
      && !/^articles\/weekly-market-report-\d{4}-\d{2}-\d{2}\.html$/.test(file));
}

const pages = walkHtml().map((file) => {
  const html = read(file);
  const text = visibleMainText(html);
  return {
    file,
    html,
    text,
    wordCount: words(text).length,
    hasAdsense: ADSENSE_RE.test(html),
    noindex: NOINDEX_RE.test(html),
    robotsMetaCount: (html.match(ROBOTS_META_RE) || []).length,
  };
});

const emptyAdShells = [];
const cardImagesWithoutDimensions = [];
const pagesWithoutSkipLink = [];

for (const page of pages) {
  if (page.robotsMetaCount > 1) {
    errors.push(`${page.file}: conflicting duplicate robots meta tags (${page.robotsMetaCount})`);
  }
  if (page.noindex && page.hasAdsense) {
    errors.push(`${page.file}: noindex page still loads AdSense`);
  }
  if (page.hasAdsense && !isAllowedMonetizedPage(page.file)) {
    errors.push(`${page.file}: page is outside the explicit AdSense allowlist`);
  }
  if (isApprovalExcludedPage(page.file) && page.hasAdsense) {
    errors.push(`${page.file}: approval-excluded generated/navigation page loads AdSense`);
  }
  // 350 is an internal safety floor, not a claimed Google word-count rule.
  if (page.hasAdsense && page.wordCount < 350) {
    errors.push(`${page.file}: AdSense page has only ${page.wordCount} visible words`);
  }
  if (/확인됩니다\(\)|\(\s*·|\b(?:undefined|NaN|TBD|TODO)\b/i.test(page.text)) {
    errors.push(`${page.file}: visible placeholder or malformed content`);
  }
  for (const match of page.html.matchAll(AD_SHELL_RE)) {
    if (!/class=(["'])[^"']*\badsbygoogle\b/i.test(match[0])) emptyAdShells.push(page.file);
  }
  if (page.file.startsWith("cards/")) {
    for (const match of page.html.matchAll(/<img\b[^>]*>/gi)) {
      if (!/\bwidth=["']\d+["']/i.test(match[0]) || !/\bheight=["']\d+["']/i.test(match[0])) {
        cardImagesWithoutDimensions.push(page.file);
      }
    }
  }
  const mainTag = page.html.match(/<main\b[^>]*>/i)?.[0];
  if (mainTag) {
    const hasMainTarget = /\bid=["']main-content["']/i.test(mainTag);
    const hasSkipLink = [...page.html.matchAll(/<a\b[^>]*>/gi)].some((match) => (
      /\bclass=["'][^"']*\bskipLink\b[^"']*["']/i.test(match[0])
      && /\bhref=["']#main-content["']/i.test(match[0])
    ));
    if (!hasMainTarget || !hasSkipLink) pagesWithoutSkipLink.push(page.file);
  }
}

if (emptyAdShells.length) {
  errors.push(`${emptyAdShells.length} empty manual ad shells remain without an adsbygoogle unit`);
}
if (cardImagesWithoutDimensions.length) {
  errors.push(`${cardImagesWithoutDimensions.length} card images lack explicit width/height and can cause layout shift`);
}
if (!/:focus-visible\b/.test(read("styles.css"))) {
  errors.push("styles.css: interactive elements lack a shared keyboard focus-visible treatment");
}
if (pagesWithoutSkipLink.length) {
  errors.push(`${pagesWithoutSkipLink.length} pages with main content lack a working keyboard skip link`);
}

const monetizedPages = pages.filter((page) => page.hasAdsense);
if (!pages.find((page) => page.file === "index.html" && page.hasAdsense)) {
  errors.push("index.html: approval page must retain the AdSense loader");
}
if (monetizedPages.length < 5) {
  errors.push(`only ${monetizedPages.length} substantial pages retain AdSense; expected at least 5`);
}

let ebayAffiliateAnchors = 0;
for (const page of pages) {
  for (const match of page.html.matchAll(/<a\b[^>]*href=(["'])(https?:\/\/(?:www\.)?ebay\.[\s\S]*?)\1[^>]*>/gi)) {
    ebayAffiliateAnchors += 1;
    if (!match[2].includes(`campid=${EPN_CAMPAIGN_ID}`)) {
      errors.push(`${page.file}: eBay link is missing the EPN campaign id`);
    }
    if (!/rel=(["'])[^"']*sponsored/i.test(match[0])) {
      errors.push(`${page.file}: eBay paid link is missing rel=sponsored`);
    }
  }
}
if (ebayAffiliateAnchors < 70) {
  errors.push(`only ${ebayAffiliateAnchors} static eBay affiliate links remain; expected at least 70`);
}
if (!new RegExp(`EPN_CAMPID\\s*=\\s*["']${EPN_CAMPAIGN_ID}["']`).test(read("packs.js"))) {
  errors.push("packs.js: dynamic eBay EPN campaign id was removed or changed");
}

const commentary = JSON.parse(read("data/set-commentary.json"));
for (const code of Object.keys(commentary.sets || {})) {
  const file = `sets/${code.toLowerCase()}.html`;
  const page = pages.find((candidate) => candidate.file === file);
  if (!page) {
    errors.push(`${file}: missing generated set page`);
    continue;
  }
  if (!page.html.includes(`campid=${EPN_CAMPAIGN_ID}`)) {
    errors.push(`${file}: eBay EPN campaign id was removed`);
  }
  if (!/rel=["'][^"']*sponsored/i.test(page.html)) {
    errors.push(`${file}: eBay paid link is missing rel=sponsored`);
  }
}

const setPages = pages
  .filter((page) => /^sets\/(?:op|eb|prb)-\d+\.html$/.test(page.file))
  .map(({ file, text }) => ({ file, text }));
const setRepetition = repeatedWordShare(setPages);
const medianSetRepetition = median(setRepetition.map((item) => item.repeatedWordShare));
const maxSetRepetition = Math.max(0, ...setRepetition.map((item) => item.repeatedWordShare));
if (medianSetRepetition > 30) {
  errors.push(`set pages repeat ${medianSetRepetition}% of sentence words at the median; maximum is 30%`);
}
if (maxSetRepetition > 40) {
  errors.push(`one or more set pages repeat up to ${maxSetRepetition}% of sentence words; maximum is 40%`);
}

// Google can assess the whole site during approval, including noindex/ad-free
// generated pages. Keep those pages data-specific instead of allowing a large
// family of nearly identical prose pages to accumulate unnoticed.
const cardPages = pages
  .filter((page) => /^cards\/(?!index\.html$).+\.html$/.test(page.file))
  .map(({ file, text }) => ({ file, text }));
const cardRepetition = repeatedWordShare(cardPages);
const medianCardRepetition = median(cardRepetition.map((item) => item.repeatedWordShare));
const maxCardRepetition = Math.max(0, ...cardRepetition.map((item) => item.repeatedWordShare));
if (medianCardRepetition > 35) {
  errors.push(`card pages repeat ${medianCardRepetition}% of sentence words at the median; maximum is 35%`);
}
if (maxCardRepetition > 45) {
  errors.push(`one or more card pages repeat up to ${maxCardRepetition}% of sentence words; maximum is 45%`);
}

const koSetPages = pages
  .filter((page) => /^ko\/(?:op|eb|prb)-\d+\.html$/.test(page.file))
  .map(({ file, text }) => ({ file, text }));
const koSetRepetition = repeatedWordShare(koSetPages);
const medianKoSetRepetition = median(koSetRepetition.map((item) => item.repeatedWordShare));
const maxKoSetRepetition = Math.max(0, ...koSetRepetition.map((item) => item.repeatedWordShare));
if (medianKoSetRepetition > 35) {
  errors.push(`Korean set pages repeat ${medianKoSetRepetition}% of sentence words at the median; maximum is 35%`);
}
if (maxKoSetRepetition > 45) {
  errors.push(`one or more Korean set pages repeat up to ${maxKoSetRepetition}% of sentence words; maximum is 45%`);
}

for (const file of ["index.html", "packs.html"]) {
  if (DEVELOPMENT_COPY_RE.test(read(file))) {
    errors.push(`${file}: visible development-stage or ad-placeholder copy remains`);
  }
}
if (DEVELOPMENT_COPY_RE.test(read("packs.js"))) {
  errors.push("packs.js: dynamic development-stage or ad-placeholder copy remains");
}

const packs = pages.find((page) => page.file === "packs.html");
if (packs && !packs.noindex) errors.push("packs.html: duplicate home variant must be noindex");
const packsDeepLinks = pages.filter((page) => /href=["'][^"']*packs\.html\?set=/i.test(page.html));
if (packsDeepLinks.length) {
  errors.push(`${packsDeepLinks.length} HTML pages still link internally to duplicate packs.html routes`);
}
if (/packs\.html\?set=/i.test(read("packs.js"))) {
  errors.push("packs.js: client navigation still targets the duplicate packs.html route");
}

const adsTxt = read("ads.txt").trim();
if (!adsTxt.includes("pub-1520891018658006")) errors.push("ads.txt: AdSense publisher id missing");

const report = {
  publicHtml: pages.length,
  monetizedPages: monetizedPages.length,
  noindexWithAdsense: pages.filter((page) => page.noindex && page.hasAdsense).length,
  excludedPagesWithAdsense: pages.filter((page) => isApprovalExcludedPage(page.file) && page.hasAdsense).length,
  thinMonetizedPages: pages.filter((page) => page.hasAdsense && page.wordCount < 350).length,
  emptyAdShells: emptyAdShells.length,
  cardImagesWithoutDimensions: cardImagesWithoutDimensions.length,
  pagesWithoutSkipLink: pagesWithoutSkipLink.length,
  minimumMonetizedWordCount: monetizedPages.length
    ? Math.min(...monetizedPages.map((page) => page.wordCount))
    : 0,
  setPages: setPages.length,
  medianSetRepeatedWordShare: medianSetRepetition,
  maxSetRepeatedWordShare: maxSetRepetition,
  cardPages: cardPages.length,
  medianCardRepeatedWordShare: medianCardRepetition,
  maxCardRepeatedWordShare: maxCardRepetition,
  koSetPages: koSetPages.length,
  medianKoSetRepeatedWordShare: medianKoSetRepetition,
  maxKoSetRepeatedWordShare: maxKoSetRepetition,
  epnCheckedSets: Object.keys(commentary.sets || {}).length,
  ebayAffiliateAnchors,
  errors,
  warnings,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exitCode = 1;
