// RSS 2.0 피드 생성 — articles/*.html의 title/description/datePublished(JSON-LD)에서 추출
//   + ko/ 한국어 정적 페이지(허브·세트 상세). 채널 language 는 en-us 그대로, 항목만 추가.
// Run: node tools/generate-feed.js  → feed.xml (아티클·한국어 페이지 추가 시 재실행)
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

// ── 한국어 정적 페이지(ko/). 날짜는 sitemap.xml 의 lastmod → 파일의 dateModified → datePublished 순으로
//    있는 것만 쓴다. 셋 다 없으면 pubDate 자체를 생략한다(날짜를 지어내지 않는다).
const smLastmod = {};
{
  const sm = path.join(ROOT, "sitemap.xml");
  if (fs.existsSync(sm)) {
    for (const u of fs.readFileSync(sm, "utf8").matchAll(/<url>[\s\S]*?<\/url>/g)) {
      const loc = (u[0].match(/<loc>([^<]+)<\/loc>/) || [])[1];
      const lm = (u[0].match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1];
      if (loc && lm) smLastmod[loc] = lm;
    }
  }
}

const KO_HUB = ["index.html", "cards.html", "grading.html", "auction.html", "amazon-lottery.html"];
const koDir = path.join(ROOT, "ko");
const koItems = [];
if (fs.existsSync(koDir)) {
  const present = new Set(fs.readdirSync(koDir));
  const koFiles = KO_HUB.filter((f) => present.has(f))
    .concat([...present].filter((f) => /^(?:op|eb|prb)-[\w-]+\.html$/.test(f)).sort());
  for (const f of koFiles) {
    const html = fs.readFileSync(path.join(koDir, f), "utf8");
    const url = f === "index.html" ? `${SITE}/ko/` : `${SITE}/ko/${f}`;
    const title = (html.match(/<title>([^<]+)<\/title>/) || [])[1] || f;
    const desc = (html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "";
    const pub =
      smLastmod[url] ||
      (html.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1] ||
      (html.match(/"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1] ||
      "";
    koItems.push({ url, title, desc, pub });
  }
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const rfc822 = (iso) => new Date(iso + "T09:00:00Z").toUTCString();
const renderItem = (it) =>
  [
    "  <item>",
    `    <title>${esc(it.title)}</title>`,
    `    <link>${it.url}</link>`,
    `    <guid isPermaLink="true">${it.url}</guid>`,
    ...(it.pub ? [`    <pubDate>${rfc822(it.pub)}</pubDate>`] : []),
    `    <description>${esc(it.desc)}</description>`,
    "  </item>",
  ].join("\n");

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>OP Box Index — One Piece Booster Box Research</title>
  <link>${SITE}/</link>
  <description>Data reports and guides on One Piece Card Game sealed booster boxes: prices, PSA grading data and market analysis.</description>
  <language>en-us</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${SITE}/feed.xml" rel="self" type="application/rss+xml" />
${items.map(renderItem).join("\n")}
</channel>
</rss>
`;
fs.writeFileSync(path.join(ROOT, "feed.xml"), xml);

// 한국어는 별도 피드로 뺀다 — 한 피드에 섞으면 language=en-us 인데 최신 항목이 전부 한국어가 되어
// 영문 구독 경로가 죽는다(2026-09-16 실측: 44건 중 최신 20건이 전부 한국어). 네이버에는 이 주소를 제출한다.
const koXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>OP Box Index — 원피스 카드·박스 시세</title>
  <link>${SITE}/ko/</link>
  <description>원피스 카드게임 부스터박스·카드 시세, 이베이 경매 낙찰 데이터, PSA·CGC·TAG 그레이딩 통계.</description>
  <language>ko-kr</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <atom:link href="${SITE}/ko/feed.xml" rel="self" type="application/rss+xml" />
${koItems.map(renderItem).join("\n")}
</channel>
</rss>
`;
fs.writeFileSync(path.join(ROOT, "ko", "feed.xml"), koXml);
console.log("feed.xml:", items.length, "en · ko/feed.xml:", koItems.length, "ko; newest article:", items[0].pub, items[0].title.slice(0, 50));
