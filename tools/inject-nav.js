#!/usr/bin/env node
// 사이트 전체의 상단 메뉴를 site-nav.js 정의로 맞춘다 — 2026-09-01 신설.
//
// 생성기가 만드는 페이지는 생성기가 알아서 최신 메뉴를 쓰지만, 손으로 쓴 HTML 14개
// (index, auction, compare, about, privacy ...) 는 아무도 갱신하지 않는다.
// 그래서 메뉴가 바뀔 때마다 그 페이지들만 옛 메뉴를 달고 배포된다.
// 이 스크립트가 <nav class="nav">...</nav> 를 통째로 교체한다.
//
// 경로 접두어는 파일 위치로 정한다 — 루트는 "", 한 단계 아래(sets/ cards/ articles/)는 "../".
// ko/ 는 메뉴 구성이 달라 navHtmlKo() 를 쓴다.
//
// Run: node tools/inject-nav.js [--check]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { navHtml, navHtmlKo } = require("./site-nav");

const checkOnly = process.argv.includes("--check");
const NAV_RE = /<nav class="nav"[^>]*>[\s\S]*?<\/nav>/;

function listHtml() {
  const out = [];
  const walk = (dir, depth) => {
    for (const f of fs.readdirSync(path.join(ROOT, dir || "."))) {
      const rel = dir ? `${dir}/${f}` : f;
      const abs = path.join(ROOT, rel);
      if (fs.statSync(abs).isDirectory()) {
        if (["node_modules", ".git", "data", "tools", "logs", "img", "card-img", "social", "docs"].includes(f)) continue;
        if (depth >= 1) continue;                 // 두 단계까지만
        walk(rel, depth + 1);
        continue;
      }
      if (!f.endsWith(".html") || f.startsWith("_")) continue;
      out.push(rel);
    }
  };
  walk("", 0);
  return out;
}

const changed = [], skipped = [], mismatch = [];
for (const rel of listHtml()) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, "utf8");
  if (!NAV_RE.test(html)) { skipped.push(rel); continue; }

  const inKo = rel.startsWith("ko/");
  const depth = rel.includes("/") ? 1 : 0;
  const want = inKo ? navHtmlKo() : navHtml(depth ? "../" : "", depth ? null : rel);

  const cur = html.match(NAV_RE)[0];
  if (cur === want) continue;
  if (checkOnly) { mismatch.push(rel); continue; }
  html = html.replace(NAV_RE, want);
  fs.writeFileSync(abs, html, "utf8");
  changed.push(rel);
}

console.log(JSON.stringify({
  mode: checkOnly ? "check" : "write",
  changed: changed.length,
  mismatch: mismatch.length,
  navLess: skipped.length,
  files: (checkOnly ? mismatch : changed).slice(0, 40),
}, null, 1));
if (checkOnly && mismatch.length) process.exit(1);
