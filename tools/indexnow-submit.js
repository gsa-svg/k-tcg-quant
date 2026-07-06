// IndexNow 일괄 제출 — sitemap.xml의 모든 URL을 Bing/Naver/Yandex 등에 통지
// Run: node tools/indexnow-submit.js  (키 파일이 라이브에 배포된 후 실행할 것)
const fs = require("fs");
const path = require("path");
const KEY = "3d439f302e46fc08f76ddba4eee3726f";
const HOST = "opboxindex.com";
const sm = fs.readFileSync(path.join(__dirname, "..", "sitemap.xml"), "utf8");
const urls = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
console.log("URLs:", urls.length);
fetch("https://api.indexnow.org/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `https://${HOST}/${KEY}.txt`, urlList: urls }),
}).then(async (r) => {
  console.log("IndexNow status:", r.status, r.statusText);
  const t = await r.text();
  if (t) console.log(t.slice(0, 300));
}).catch((e) => console.error("failed:", e.message));
