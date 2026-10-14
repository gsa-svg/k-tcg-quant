// 사이트맵에서 상세 페이지 URL 을 빼거나 되돌린다 — 2026-08-31 신설.
//
// 왜 따로 두나: 종전에는 카드·ko 생성기가 각자 "사이트맵에서 제거"만 하고 있었다.
// 그래서 noindex 를 풀어도 사이트맵은 59개에 머물렀다(2026-08-31 예행연습에서 확인).
// 빼는 쪽과 되돌리는 쪽을 같은 파일에 두면 한쪽만 고쳐서 어긋나는 일이 없다.
//
// 상태는 adsense-review-gate.js 의 REVIEW_ACTIVE 하나가 정한다.
const fs = require("fs");

const { dropDetailFromSitemap } = require("./adsense-review-gate");

// locs: 이 그룹이 관리하는 전체 URL 목록(절대 URL). 게이트 상태에 따라 빼거나 넣는다.
// 반환: { removed, added }
function syncDetailUrls(sitemapPath, locs, opts = {}) {
  const priority = opts.priority || "0.6";
  const changefreq = opts.changefreq || "weekly";
  const today = opts.today || new Date().toISOString().slice(0, 10);

  let sm = fs.readFileSync(sitemapPath, "utf8");
  let removed = 0;
  let added = 0;

  if (dropDetailFromSitemap()) {
    // 심사 중: noindex 페이지를 사이트맵에 두면 GSC 가 "제출됨 + 색인 안 됨" 모순으로 계속 잡는다.
    const drop = new Set(locs.map((loc) => `<loc>${loc}</loc>`));
    sm = sm.replace(/[ \t]*<url>[\s\S]*?<\/url>\r?\n?/g, (block) => {
      for (const d of drop) if (block.includes(d)) { removed++; return ""; }
      return block;
    });
  } else {
    // 심사 종료: 빠져 있던 URL 을 되돌린다. 이미 있으면 건드리지 않는다(중복 방지).
    const entries = [];
    for (const loc of locs) {
      if (sm.includes(`<loc>${loc}</loc>`)) continue;
      entries.push(
        `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n` +
        `    <changefreq>${changefreq}</changefreq>\n    <priority>${priority}</priority>\n  </url>`
      );
      added++;
    }
    if (entries.length) sm = sm.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
  }

  fs.writeFileSync(sitemapPath, sm, "utf8");
  return { removed, added };
}

// 새 URL 을 사이트맵에 "추가만" 한다 — 2026-10-14(W7 카드리스트 페이지). 심사 게이트와 무관하다(빼는 길이 없다).
// entries: [{ loc, changed }] — 없는 loc 은 오늘 날짜로 넣고, 이미 있는 loc 은 changed(이번에 본문이 바뀜)일 때만 lastmod 를 올린다.
// 기존 항목을 지우거나 다른 URL 의 값을 바꾸지 않는다([[opbox-never-deindex]]). 반환: { added, bumped }
function addUrls(sitemapPath, entries, opts = {}) {
  const priority = opts.priority || "0.6";
  const changefreq = opts.changefreq || "weekly";
  const today = opts.today || new Date().toISOString().slice(0, 10);
  let sm = fs.readFileSync(sitemapPath, "utf8");
  let added = 0, bumped = 0;
  const fresh = [];
  for (const { loc, changed } of entries) {
    const tag = `<loc>${loc}</loc>`;
    if (!sm.includes(tag)) {
      fresh.push(`  <url><loc>${loc}</loc><lastmod>${today}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`);
      added++;
      continue;
    }
    if (!changed) continue;
    const quoted = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(${quoted}(?:(?!</url>)[\\s\\S])*?<lastmod>)[^<]*(</lastmod>)`);   // 같은 <url> 안에서만
    const next = sm.replace(re, `$1${today}$2`);
    if (next !== sm) { sm = next; bumped++; }
  }
  if (fresh.length) sm = sm.replace("</urlset>", `${fresh.join("\n")}\n</urlset>`);
  if (added || bumped) fs.writeFileSync(sitemapPath, sm, "utf8");
  return { added, bumped };
}

module.exports = { syncDetailUrls, addUrls };
