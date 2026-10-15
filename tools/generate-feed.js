// RSS 2.0 피드 생성 — articles/*.html의 title/description/datePublished(JSON-LD)에서 추출
//   + ko/ 한국어 정적 페이지(허브·세트 상세). 채널 language 는 en-us 그대로, 항목만 추가.
// Run: node tools/generate-feed.js  → feed.xml (아티클·한국어 페이지 추가 시 재실행)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";

// 2026-10-14(W6b) 정리:
//  · 제목·설명은 HTML 에서 이미 이스케이프된 글자(&amp;)라, 한 번 풀고 다시 이스케이프한다 — 종전엔 "&amp;amp;" 로 두 번 나갔다.
//  · noindex 페이지는 넣지 않는다(검색에서 뺀 주소를 피드로 다시 알릴 이유가 없다).
//  · 항목 날짜는 본문이 마지막으로 바뀐 날(dateModified, 없으면 datePublished), 정렬도 그 날짜 최신순 — "새 글과 갱신된 글" 피드다.
//  · 글 외에 발매 예정 세트 페이지(upcoming-set-pages.json)·주간 표(weekly.html)·세트별 공식 카드리스트(card-list-shared)를 싣는다.
const decode = (s) => String(s).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
const isNoindex = (html) => /<meta name="robots" content="[^"]*noindex/i.test(html);
function pageItem(rel, url) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return null;
  const html = fs.readFileSync(file, "utf8");
  if (isNoindex(html)) return null;
  const title = decode((html.match(/<title>([^<]+)<\/title>/) || [])[1] || rel).replace(/\s*\|\s*OP Box Index\s*$/, "");
  const desc = decode((html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "");
  const pub = (html.match(/"datePublished":\s*"(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
  const mod = (html.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})/) || [])[1] || pub;
  return { url, title, desc, pub: mod || pub };
}

const dir = path.join(ROOT, "articles");
const items = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith(".html") || f === "index.html") continue;
  const it = pageItem(`articles/${f}`, `${SITE}/articles/${f}`);
  if (it) items.push(it);
}
try {
  for (const p of JSON.parse(fs.readFileSync(path.join(ROOT, "data", "upcoming-set-pages.json"), "utf8")).pages || []) {
    const it = p.slug && pageItem(`sets/${p.slug}.html`, `${SITE}/sets/${p.slug}.html`);
    if (it) items.push(it);
  }
} catch {}
{ const it = pageItem("weekly.html", `${SITE}/weekly.html`); if (it) items.push(it); }
for (const p of require("./card-list-shared").products()) {
  const rel = require("./card-list-shared").pagePath(p.code);
  const it = pageItem(rel, `${SITE}/${rel}`);
  if (it) items.push(it);
}
items.sort((a, b) => (a.pub < b.pub ? 1 : a.pub > b.pub ? -1 : a.url < b.url ? -1 : 1));

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
    if (isNoindex(html)) continue;
    const url = f === "index.html" ? `${SITE}/ko/` : `${SITE}/ko/${f}`;
    const title = decode((html.match(/<title>([^<]+)<\/title>/) || [])[1] || f);
    const desc = decode((html.match(/<meta name="description" content="([^"]+)"/) || [])[1] || "");
    const pub =
      smLastmod[url] ||
      (html.match(/"dateModified":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1] ||
      (html.match(/"datePublished":\s*"(\d{4}-\d{2}-\d{2})"/) || [])[1] ||
      "";
    koItems.push({ url, title, desc, pub });
  }
}
// 한국어 피드도 수정일 최신순 — 영문 피드와 같은 기준(2026-10-14 QA: 10-13 항목이 10-14 항목들 앞에 있었다, 가드 FD1).
koItems.sort((a, b) => (a.pub < b.pub ? 1 : a.pub > b.pub ? -1 : a.url < b.url ? -1 : 1));

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// 항목 시각은 그날 09:00Z, 단 빌드 시각을 넘지 않는다 — 2026-10-15(3차). 오늘 날짜 항목이 "Thu, 15 Oct 2026 09:00:00 GMT" 인데
// lastBuildDate 는 02:26 GMT 라 발행 시각이 빌드보다 미래였다. 지난 날짜 항목은 09:00Z 그대로(옛 항목 값이 바뀌지 않게).
const BUILT = new Date();
const rfc822 = (iso) => new Date(Math.min(Date.parse(iso + "T09:00:00Z"), BUILT.getTime())).toUTCString();
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
  <lastBuildDate>${BUILT.toUTCString()}</lastBuildDate>
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
  <lastBuildDate>${BUILT.toUTCString()}</lastBuildDate>
  <atom:link href="${SITE}/ko/feed.xml" rel="self" type="application/rss+xml" />
${koItems.map(renderItem).join("\n")}
</channel>
</rss>
`;
fs.writeFileSync(path.join(ROOT, "ko", "feed.xml"), koXml);
console.log("feed.xml:", items.length, "en · ko/feed.xml:", koItems.length, "ko; newest article:", items[0].pub, items[0].title.slice(0, 50));
