/*
 * Guardrail for AI search and user-requested retrieval crawlers. This does not
 * change market data or Google canonical signals.
 * Run locally with: node tools/audit-ai-discovery.js
 */
const fs = require("fs");
const path = require("path");
const { robotsPolicy } = require("./robots-policy");

const ROOT = path.join(__dirname, "..");
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
const llms = fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const errors = [];
const retrievalBots = [
  "OAI-SearchBot", "ChatGPT-User", "PerplexityBot", "Perplexity-User",
  "Claude-User", "Claude-SearchBot", "Google-Extended", "Googlebot",
  "Bingbot", "Yeti", "NaverBot", "GrokBot", "xAI-Crawler",
  "FacebookBot", "Meta-ExternalAgent",
];
const internalPaths = ["/docs/", "/tools/", "/social/", "/HANDOFF.md", "/CLAUDE.md", "/AGENTS.md", "/SECURITY.md"];
const { isAllowed } = robotsPolicy(robots);

function requireAccess(agent, pathName, expected) {
  const actual = isAllowed(agent, pathName);
  if (actual !== expected) errors.push(`${agent}: ${pathName} must be ${expected ? "allowed" : "blocked"}`);
}

for (const agent of retrievalBots) {
  for (const publicPath of ["/", "/free-data.html", "/opbox-ai-data.json", "/data/onepiece-packs.json"]) {
    requireAccess(agent, publicPath, true);
  }
  for (const internalPath of internalPaths) requireAccess(agent, internalPath, false);
}
requireAccess("FutureAnswerBot", "/opbox-ai-data.json", true);
requireAccess("FutureAnswerBot", "/data/onepiece-packs.json", false);

for (const agent of ["GPTBot", "ClaudeBot", "anthropic-ai"]) {
  requireAccess(agent, "/", false);
}

if (!/^Sitemap:\s+https:\/\/opboxindex\.com\/sitemap\.xml\s*$/mi.test(robots)) {
  errors.push("robots.txt: missing canonical sitemap declaration");
}

for (const requiredUrl of [
  "https://opboxindex.com/",
  "https://opboxindex.com/psa-grading.html",
  "https://opboxindex.com/compare.html",
  "https://opboxindex.com/psa10-ranking.html",
  "https://opboxindex.com/sets/index.html",
  "https://opboxindex.com/free-data.html",
  "https://opboxindex.com/opbox-ai-data.json",
  "https://opboxindex.com/opbox-set-prices.csv",
  "https://opboxindex.com/opbox-grading-population.csv",
  "https://opboxindex.com/opbox-auction-daily.csv",
  "https://opboxindex.com/methodology.html",
  "https://opboxindex.com/sitemap.xml",
  "https://opboxindex.com/data/onepiece-packs.json",
]) {
  if (!llms.includes(requiredUrl)) {
    errors.push(`llms.txt: missing ${requiredUrl}`);
    continue;
  }
  const pathname = new URL(requiredUrl).pathname;
  const local = pathname === "/" ? "index.html" : pathname.endsWith("/") ? `${pathname.slice(1)}index.html` : pathname.slice(1);
  if (!fs.existsSync(path.join(ROOT, local))) errors.push(`llms.txt: local target missing for ${requiredUrl}`);
}

const aiPath = path.join(ROOT, "opbox-ai-data.json");
if (!fs.existsSync(aiPath)) {
  errors.push("opbox-ai-data.json: required public dataset is missing");
} else {
  let aiData;
  try { aiData = JSON.parse(fs.readFileSync(aiPath, "utf8")); } catch { errors.push("opbox-ai-data.json: invalid JSON"); }
  if (aiData) {
    if (aiData.schemaVersion !== "1.0.1") errors.push("opbox-ai-data.json: unsupported schemaVersion");
    if (aiData.license?.url !== "https://creativecommons.org/licenses/by/4.0/") errors.push("opbox-ai-data.json: CC BY 4.0 licence missing");
    if (!Array.isArray(aiData.sets) || aiData.sets.length < 20) errors.push("opbox-ai-data.json: tracked set coverage is incomplete");
    for (const set of aiData.sets || []) {
      if (!/^https:\/\/opboxindex\.com\/sets\/[a-z0-9-]+\.html$/.test(set.canonicalUrl || "")) errors.push(`opbox-ai-data.json: invalid citation URL for ${set.setCode}`);
      // 카드 목록이 아직 없는 신규 세트(예: OP-17 — 박스 시세만 공개)는 topHits 가 비는 게 맞다.
      // 0(정직한 빈 값) 또는 7(완전한 목록)만 허용 — 1~6 은 목록이 반쯤 깨진 것이니 여전히 잡는다.
      if (!Array.isArray(set.topHits) || (set.topHits.length !== 7 && set.topHits.length !== 0)) errors.push(`opbox-ai-data.json: ${set.setCode} must contain Top 7 hits (or none for a new set without a verified card list)`);
    }
    const serialized = JSON.stringify(aiData);
    for (const forbidden of ["bestListing", "itemPrices", "seller", "query", "marketplaceId", "ebay.com/itm/"]) {
      if (serialized.includes(forbidden)) errors.push(`opbox-ai-data.json: raw listing field leaked (${forbidden})`);
    }
  }
}

const freeData = fs.readFileSync(path.join(ROOT, "free-data.html"), "utf8");
for (const requiredUrl of ["opbox-ai-data.json", "opbox-set-prices.csv", "opbox-grading-population.csv", "opbox-auction-daily.csv"]) {
  if (!freeData.includes(requiredUrl)) errors.push(`free-data.html: missing distribution ${requiredUrl}`);
}
const boxHeader = fs.readFileSync(path.join(ROOT, "opbox-set-prices.csv"), "utf8").split(/\r?\n/, 1)[0];
for (const field of ["canonical_url", "jp_sold_sample_collected_on", "jp_active_observed_on", "en_sold_sample_collected_on", "en_active_observed_on"]) {
  if (!boxHeader.split(",").includes(field)) errors.push(`opbox-set-prices.csv: missing provenance field ${field}`);
}

if (!sitemap.includes("<loc>https://opboxindex.com/</loc>")) {
  errors.push("sitemap.xml: root canonical is missing");
}
if (sitemap.includes("https://opboxindex.com/packs.html")) {
  errors.push("sitemap.xml: non-canonical packs.html must not be listed");
}

if (errors.length) {
  console.error(JSON.stringify({ audit: "AI_DISCOVERY_FAIL", errors }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  audit: "AI_DISCOVERY_OK",
  searchRetrievalBots: retrievalBots.length,
  trainingBotsBlocked: 3,
  canonicalRootPreserved: true,
  compactAiData: true,
}, null, 2));
