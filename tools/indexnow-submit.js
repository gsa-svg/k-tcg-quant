// IndexNow 제출 — 그날 본문이 바뀐 URL 만 Bing/Naver/Yandex 등에 통지한다.
//
// 2026-10-14 개정(W9): 종전엔 사이트맵 전체(268개)를 매일 보냈다. lastmod 는 이제 sync-sitemap-lastmod.js 가 "본문이 바뀐 날"로만
// 올리므로(메뉴·캐시 키 변경 제외), lastmod 가 오늘(UTC)인 URL 이 곧 오늘 바뀐 페이지다. 바뀌지 않은 URL 을 매일 다시 보내면
// 통지가 신호가 아니라 잡음이 된다. 바뀐 게 없으면 아무것도 보내지 않는다.
// Run: node tools/indexnow-submit.js [--date YYYY-MM-DD] [--dry-run]   (키 파일이 라이브에 배포된 뒤, 워크플로는 커밋·푸시 뒤에)
const fs = require("fs");
const path = require("path");
const KEY = "3d439f302e46fc08f76ddba4eee3726f";
const HOST = "opboxindex.com";
const argAt = process.argv.indexOf("--date");
const DAY = argAt > 0 && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[argAt + 1] || "") ? process.argv[argAt + 1] : new Date().toISOString().slice(0, 10);
const dry = process.argv.includes("--dry-run");

const sm = fs.readFileSync(path.join(__dirname, "..", "sitemap.xml"), "utf8");
const all = [...sm.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => ({
  loc: ((m[0].match(/<loc>([^<]+)<\/loc>/) || [])[1] || "").replace(/&amp;/g, "&"),
  lastmod: (m[0].match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1] || null,
})).filter((u) => u.loc);
const urls = all.filter((u) => u.lastmod === DAY).map((u) => u.loc);
console.log(JSON.stringify({ day: DAY, sitemapUrls: all.length, changed: urls.length, sample: urls.slice(0, 5), dryRun: dry }));
if (!urls.length || dry) process.exit(0);
fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
}).then(async (r) => {
  console.log("IndexNow status:", r.status, r.statusText);
  const t = await r.text();
  if (t) console.log(t.slice(0, 300));
}).catch((e) => console.error("failed:", e.message));
