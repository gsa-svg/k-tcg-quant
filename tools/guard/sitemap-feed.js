"use strict";
// 사이트맵·피드 — 2026-10-15 분할.
//  C3 사이트맵에 홈 변형 금지·모든 URL 실파일 [2026-07-08 canonical 스왑] · SM1 lastmod = 본문이 바뀐 날 [2026-10-14 W9: 205/222 가 매일 오늘]
//  FD1 피드 위생(이중 이스케이프·noindex·최신순·발행 ≤ 빌드·필수 항목) [2026-10-14 W6b·3차] · CL1(목록) 카드리스트 페이지가 사이트맵·llms.txt 에 [2026-10-14 W7]
//  SM1·FD1 은 이번 실행이 페이지·사이트맵·피드를 바꿨을 때만 FAIL(아니면 경고 — 수집 워크플로의 커밋을 묵은 어긋남으로 막지 않는다).
const { errors, read, exists, sink, facts } = require("./lib");

const checks = ["C3", "SM1", "FD1"];

function run() {
  const sitemap = read("sitemap.xml");
  if (/<loc>https:\/\/opboxindex\.com\/(index\.html|packs\.html)/.test(sitemap)) errors.push("C3: sitemap에 홈 변형(/index.html·/packs.html) 등재됨");
  for (const m of sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const p = new URL(m[1].replace(/&amp;/g, "&")).pathname;
    const rel = p === "/" ? "index.html" : decodeURIComponent(p.slice(1)) + (p.endsWith("/") ? "index.html" : "");
    if (!exists(rel)) errors.push(`C3: sitemap URL의 실파일 없음: ${m[1]}`);
  }
  const sm = sink("SM1");
  try {
    const problems = require("../sync-sitemap-lastmod").verify();
    for (const p of problems.slice(0, 15)) sm(`${p} — node tools/sync-sitemap-lastmod.js 를 생성기 뒤에서 돌릴 것`);
    if (problems.length > 15) sm(`그 밖에 ${problems.length - 15}건`);
  } catch (e) { sm("사이트맵 날짜 검사 실패 — " + e.message); }

  const fd = sink("FD1");
  const items = (x) => [...x.matchAll(/<item>[\s\S]*?<\/item>/g)].map((m) => ({ link: (m[0].match(/<link>([^<]+)<\/link>/) || [])[1] || "", date: Date.parse((m[0].match(/<pubDate>([^<]+)<\/pubDate>/) || [])[1] || "") || 0 }));
  for (const f of ["feed.xml", "ko/feed.xml"].filter(exists)) {
    const x = read(f), it = items(x);
    if (/&amp;(?:amp|lt|gt|quot|#\d+);/.test(x)) fd(`${f} 에 이중 이스케이프(&amp;amp; 등)가 있다`);
    for (let i = 1; i < it.length; i++) if (it[i].date > it[i - 1].date) { fd(`${f} 항목이 날짜 최신순이 아니다(${it[i].link})`); break; }
    const built = Date.parse((x.match(/<lastBuildDate>([^<]+)<\/lastBuildDate>/) || [])[1] || "");
    if (!built) fd(`${f} lastBuildDate 를 못 읽었다`);
    else { const late = it.filter((i) => i.date > built); if (late.length) fd(`${f} pubDate ${late.length}건이 lastBuildDate 보다 늦다(${late[0].link})`); }
  }
  if (exists("feed.xml")) {
    const it = items(read("feed.xml"));
    for (const i of it) {
      const rel = i.link.replace(/^https:\/\/opboxindex\.com\//, "").replace(/\/$/, "/index.html");
      if (!exists(rel)) fd(`feed.xml 링크의 실파일 없음 ${i.link}`);
      else if (/<meta name="robots" content="[^"]*noindex/i.test(read(rel))) fd(`feed.xml 에 noindex 페이지 ${rel}`);
    }
    const links = new Set(it.map((i) => i.link));
    const F = facts();
    const must = ["https://opboxindex.com/weekly.html", ...Object.values(F.upcoming).map((u) => `https://opboxindex.com/sets/${u.slug}.html`), ...F.cardLists.map((c) => `https://opboxindex.com/sets/${c.slug}-card-list.html`)];
    for (const u of must) if (exists(u.replace("https://opboxindex.com/", "")) && !links.has(u)) fd(`feed.xml 에 ${u} 가 없다`);
    // 카드리스트 두 페이지는 사이트맵에, 영문 페이지는 llms.txt 에(CL1 e)
    const llms = exists("llms.txt") ? read("llms.txt") : "";
    for (const c of F.cardLists) {
      for (const u of [`https://opboxindex.com/sets/${c.slug}-card-list.html`, `https://opboxindex.com/ko/${c.slug}-card-list.html`]) if (!sitemap.includes(`<loc>${u}</loc>`)) errors.push(`C3: sitemap.xml 에 ${u} 가 없다(공식 카드리스트 페이지)`);
      if (!llms.includes(`https://opboxindex.com/sets/${c.slug}-card-list.html`)) errors.push(`C3: llms.txt 에 ${c.slug} 카드리스트 페이지가 없다`);
    }
  }
}

module.exports = { checks, run };
