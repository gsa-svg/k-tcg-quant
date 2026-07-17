// RSS 2.0 피드 생성 — articles/*.html의 title/description/datePublished(JSON-LD)에서 추출
// Run: node tools/generate-feed.js  → feed.xml (아티클 추가 시 재실행)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";

const dir = path.join(ROOT, "articles");
const items = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".html") || f === "index.html") continue;
  const html = fs.readFileSync(path.join(dir, f), "utf8");
  const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || f;
  const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "";
  const pub = (html.match(/"datePublished":\s*"([\d-]+)"/) || [])[1] || "2026-06-22";
  const mod = (html.match(/"dateModified":\s*"([\d-]+)"/) || [])[1] || pub;
  items.push({ url: `${SITE}/articles/${f}`, title: title.replace(/\s*\|\s*OP Box Index\s*$/, ""), desc, pub, mod });
}
items.sort((a, b) => (a.pub < b.pub ? 1 : -1));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rfc822 = (iso) => new Date(iso + "T09:00:00Z").toUTCString();

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>OP Box Index — One Piece Booster Box Research</title>
  <link>${SITE}/</link>
  <description>Data reports and guides on One Piece Card Game sealed booster boxes: prices, PSA grading data and market analysis.</description>
  <language>en-us</language>
  <lastBuildDate>${rfc822(items[0].pub)}</lastBuildDate>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${items.map((it) => `  <item>
    <title>${esc(it.title)}</title>
    <link>${it.url}</link>
    <guid isPermaLink="true">${it.url}</guid>
    <pubDate>${rfc822(it.pub)}</pubDate>
    <description>${esc(it.desc)}</description>
  </item>`).join("\n")}
</channel>
</rss>
`;
fs.writeFileSync(path.join(ROOT, "feed.xml"), xml);
console.log("feed.xml written:", items.length, "items; newest:", items[0].pub, items[0].title.slice(0, 50));
