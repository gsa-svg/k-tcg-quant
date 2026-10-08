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
const { navHtml, navHtmlKo, guideLinksHtml, nextLinksHtml } = require("./site-nav");
// 푸터 가격 가이드 줄 — 첫 <footer …> 바로 뒤. 있으면 교체, 없으면 삽입. 푸터가 없는 페이지는 건드리지 않는다.
const GUIDE_RE = /<nav class="guideLinks"[^>]*>[\s\S]*?<\/nav>/;
const FOOTER_OPEN_RE = /<footer\b[^>]*>/;
function withGuideLinks(html, inKo) {
  const want = guideLinksHtml(inKo);
  if (GUIDE_RE.test(html)) return html.replace(GUIDE_RE, () => want);
  const m = html.match(FOOTER_OPEN_RE);
  if (!m) return html;
  const at = m.index + m[0].length;
  return html.slice(0, at) + "\n      " + want + html.slice(at);
}

// 착지 페이지 "다음 클릭" 줄 — 첫 </h1> 바로 뒤. 있으면 교체, 없으면 삽입. 목적지 자체(홈·응모)와 안내 페이지는 뺀다.
const NEXT_RE = /<nav class="nextLinks"[^>]*>[\s\S]*?<\/nav>/;
const NEXT_SKIP = new Set(["index.html", "404.html", "packs.html", "sets/index.html", "amazon-lottery.html", "privacy.html", "disclaimer.html", "changelog.html", "ko/index.html", "ko/amazon-lottery.html"]);
function withNextLinks(html, rel, inKo) {
  if (NEXT_SKIP.has(rel)) return html;
  const want = nextLinksHtml(inKo, rel);
  if (NEXT_RE.test(html)) return html.replace(NEXT_RE, () => want);
  const at = html.indexOf("</h1>");
  if (at < 0) return html;
  const end = at + "</h1>".length;
  return html.slice(0, end) + "\n      " + want + html.slice(end);
}

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

// 제목 글꼴 preload — 2026-10-08. styles.css 의 @font-face 는 font-display: optional 이라 첫 그리기 전에 글꼴이
// 안 와 있으면 그 방문 내내 시스템 글꼴로 남는다(홈만 preload 가 있어 홈과 내부 페이지의 제목 글꼴이 달랐다).
// 스타일시트 링크 바로 앞에 한 줄 넣는다. 이미 있으면 건드리지 않는다. 경로 접두어는 메뉴와 같은 규칙.
const FONT_FILE = "fonts/bricolage-grotesque-latin-750.woff2";   // 2026-10-08: 22KB 고정 인스턴스(styles.css @font-face 와 같은 파일)
// 22KB 라 모바일도 미리 받는다(77KB 때는 CSS·LCP 이미지와 대역폭을 다퉈 media 로 데스크톱만 받게 했었다).
const FONT_PRELOAD = (prefix) => `<link rel="preload" href="${prefix}${FONT_FILE}" as="font" type="font/woff2" crossorigin />`;
function withFontPreload(html, prefix) {
  const existing = html.match(/[ \t]*<link rel="preload" href="[^"]*bricolage-grotesque-latin\.woff2"[^>]*>/);
  if (existing) {
    const indent = (existing[0].match(/^[ \t]*/) || [""])[0];
    return existing[0].trim() === FONT_PRELOAD(prefix) ? html : html.replace(existing[0], `${indent}${FONT_PRELOAD(prefix)}`);
  }
  const re = new RegExp(`[ \\t]*<link rel="stylesheet" href="${prefix.replace(/\./g, "\\.")}styles\\.css[^"]*"[^>]*>`);
  const m = html.match(re);
  if (!m) return html;
  const indent = (m[0].match(/^[ \t]*/) || [""])[0];
  return html.replace(re, () => `${indent}${FONT_PRELOAD(prefix)}\n${m[0]}`);
}

// GA(gtag.js 175KB)는 첫 그리기 뒤에 받는다 — 2026-10-08. async 라도 모바일에선 CSS·이미지와 대역폭을 나눠 썼다
// (라이트하우스 '사용하지 않는 JS' 1위). load 뒤 1.5초에 끼워 넣는다; dataLayer 큐는 그대로라 page_view 는 그때 전송된다.
const GTAG_ASYNC = /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)"><\/script>/;
function withDeferredGtag(html) {
  const m = html.match(GTAG_ASYNC);
  if (!m) return html;
  const loader = `<script data-gtag-deferred="${m[1]}">window.addEventListener("load",function(){setTimeout(function(){var s=document.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${m[1]}";document.head.appendChild(s);},1500);});</script>`;
  return html.replace(GTAG_ASYNC, () => loader);
}

const changed = [], skipped = [], mismatch = [];
for (const rel of listHtml()) {
  const abs = path.join(ROOT, rel);
  let html = fs.readFileSync(abs, "utf8");
  const inKo = rel.startsWith("ko/");
  const withFont = withDeferredGtag(withFontPreload(html, rel.includes("/") ? "../" : ""));
  if (withFont !== html) {
    if (checkOnly) mismatch.push(rel + " (head: fontPreload/gtag)");
    else { fs.writeFileSync(abs, withFont, "utf8"); html = withFont; if (!changed.includes(rel)) changed.push(rel); }
  }
  // 가격 가이드 줄은 상단 메뉴가 없는 페이지에도 넣는다(푸터만 있으면 된다).
  const withGuide = withGuideLinks(html, inKo);
  if (withGuide !== html) {
    if (checkOnly) mismatch.push(rel + " (guideLinks)");
    else { fs.writeFileSync(abs, withGuide, "utf8"); html = withGuide; if (!changed.includes(rel)) changed.push(rel); }
  }
  const withNext = withNextLinks(html, rel, inKo);
  if (withNext !== html) {
    if (checkOnly) mismatch.push(rel + " (nextLinks)");
    else { fs.writeFileSync(abs, withNext, "utf8"); html = withNext; if (!changed.includes(rel)) changed.push(rel); }
  }
  if (!NAV_RE.test(html)) { skipped.push(rel); continue; }

  const depth = rel.includes("/") ? 1 : 0;
  // current 는 항상 루트 기준 전체 경로를 넘긴다("sets/op-01.html"). 종전에는 하위 폴더면 null 을
  // 넘겼는데, site-nav 가 그 값으로 한국어 링크를 붙일지 판단하게 되면서 구분이 필요해졌다.
  // (세트 페이지에는 packs.js 토글이 이미 있어 링크를 붙이면 버튼이 둘이 된다)
  const want = inKo ? navHtmlKo() : navHtml(depth ? "../" : "", rel);

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
