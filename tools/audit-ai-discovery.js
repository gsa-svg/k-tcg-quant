/*
 * Guardrail for AI search and user-requested retrieval crawlers. This does not
 * change market data or Google canonical signals.
 * Run locally with: node tools/audit-ai-discovery.js
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const robots = fs.readFileSync(path.join(ROOT, "robots.txt"), "utf8");
const llms = fs.readFileSync(path.join(ROOT, "llms.txt"), "utf8");
const sitemap = fs.readFileSync(path.join(ROOT, "sitemap.xml"), "utf8");
const errors = [];

function parseGroups(content) {
  const groups = [];
  let agents = [];
  let rules = [];

  function flush() {
    if (agents.length) groups.push({ agents, rules });
    agents = [];
    rules = [];
  }

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line) {
      flush();
      continue;
    }
    const match = line.match(/^([^:]+):\s*(.*)$/);
    if (!match) continue;
    const key = match[1].trim().toLowerCase();
    const value = match[2].trim();
    if (key === "user-agent") {
      if (rules.length) flush();
      agents.push(value.toLowerCase());
    } else if (agents.length && (key === "allow" || key === "disallow")) {
      rules.push({ key, value });
    }
  }
  flush();
  return groups;
}

const groups = parseGroups(robots);

function rulesFor(agent) {
  const normalized = agent.toLowerCase();
  const specific = groups.filter((group) => group.agents.includes(normalized));
  return (specific.length ? specific : groups.filter((group) => group.agents.includes("*")))
    .flatMap((group) => group.rules);
}

function requireAllowed(agent, pathName) {
  const rules = rulesFor(agent);
  const allow = rules.some((rule) => rule.key === "allow" && rule.value === pathName);
  if (!allow) errors.push(`${agent}: ${pathName} must be explicitly allowed`);
}

function requireBlocked(agent, pathName) {
  const rules = rulesFor(agent);
  const blocked = rules.some((rule) => rule.key === "disallow" && rule.value === pathName);
  if (!blocked) errors.push(`${agent}: ${pathName} must be blocked`);
}

for (const agent of ["OAI-SearchBot", "ChatGPT-User", "Claude-User", "Claude-SearchBot", "Google-Extended"]) {
  requireAllowed(agent, "/");
  requireAllowed(agent, "/data/");
  for (const internalPath of ["/docs/", "/tools/", "/HANDOFF.md", "/AGENTS.md", "/SECURITY.md"]) {
    requireBlocked(agent, internalPath);
  }
}

for (const agent of ["GPTBot", "ClaudeBot", "anthropic-ai"]) {
  requireBlocked(agent, "/");
}

if (!/^Sitemap:\s+https:\/\/opboxindex\.com\/sitemap\.xml\s*$/mi.test(robots)) {
  errors.push("robots.txt: missing canonical sitemap declaration");
}

for (const requiredUrl of [
  "https://opboxindex.com/",
  "https://opboxindex.com/market.html",
  "https://opboxindex.com/compare.html",
  "https://opboxindex.com/psa10-ranking.html",
  "https://opboxindex.com/sets/index.html",
  "https://opboxindex.com/sitemap.xml",
  "https://opboxindex.com/data/onepiece-packs.json",
]) {
  if (!llms.includes(requiredUrl)) errors.push(`llms.txt: missing ${requiredUrl}`);
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
  searchRetrievalBots: 5,
  trainingBotsBlocked: 3,
  canonicalRootPreserved: true,
}, null, 2));
