#!/usr/bin/env node
// 모든 HTML 에 lang-toggle.js 를 실어 준다 — 2026-09-01 신설.
//
// 소유자 지시: "한국어 누르면 모든 페이지가 한글로, 다시 English 누르면 영문으로."
// 종전에는 한국어로 가는 길이 세 갈래였다(packs.js 자체 버튼 / ?hl=ko URL / ko/ 별도 페이지).
// 경매·TCG·랭킹처럼 어디에도 속하지 않는 페이지는 한국어로 갈 방법이 아예 없었다.
//
// 이 스크립트는 <link rel="stylesheet" href="styles.css..."> 바로 뒤에 한 줄을 넣는다.
// 생성기가 만드는 페이지는 생성기 쪽에 이미 들어 있으므로 여기서는 손대지 않는다(중복 방지).
//
// ⚠️ ko/ 아래 페이지는 제외한다. 그쪽은 처음부터 한국어로 구운 정적 페이지라 전환할 대상이 없다.
// Run: node tools/inject-lang-toggle.js [--check]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const checkOnly = process.argv.includes("--check");

// 캐시 버전은 packs.js 의 DATA_VERSION 을 따른다 — 다른 자산과 같은 기준으로 무효화된다.
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

function listHtml(dir, out = [], depth = 0) {
  for (const f of fs.readdirSync(path.join(ROOT, dir || "."), { withFileTypes: true })) {
    const rel = dir ? `${dir}/${f.name}` : f.name;
    if (f.isDirectory()) {
      if (["node_modules", ".git", "data", "tools", "ko", "img"].includes(f.name)) continue;
      if (depth < 1) listHtml(rel, out, depth + 1);
      continue;
    }
    if (!f.name.endsWith(".html") || f.name.startsWith("_")) continue;
    // 검색엔진 소유권 확인 파일은 콘텐츠가 아니다.
    if (/^(google|naver|BingSiteAuth)/i.test(f.name)) continue;
    out.push(rel);
  }
  return out;
}

const added = [], already = [], noStyles = [];
for (const rel of listHtml("")) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, "utf8");
  if (/lang-toggle\.js/.test(html)) { already.push(rel); continue; }
  // styles.css 링크 뒤에 넣는다. 그 줄의 상대경로(../ 여부)를 그대로 물려받는다.
  const m = html.match(/<link rel="stylesheet" href="((?:\.\.\/)?)styles\.css[^"]*"\s*\/?>/);
  if (!m) { noStyles.push(rel); continue; }
  if (checkOnly) { added.push(rel); continue; }
  const tag = `\n    <script defer src="${m[1]}lang-toggle.js?v=${CACHE}"></script>`;
  html = html.replace(m[0], m[0] + tag);
  fs.writeFileSync(abs, html, "utf8");
  added.push(rel);
}

console.log(JSON.stringify({
  mode: checkOnly ? "check" : "write",
  넣음: added.length,
  이미있음: already.length,
  styles링크없음: noStyles,
}, null, 1));
if (checkOnly && added.length) process.exit(1);
