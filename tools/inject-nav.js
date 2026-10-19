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
const NEXT_SKIP = new Set(["index.html", "404.html", "packs.html", "sets/index.html", "amazon-lottery.html", "privacy.html", "disclaimer.html", "changelog.html", "ko/index.html", "ko/amazon-lottery.html", "ja/release-dates.html"]);   // ja: 영문 칩을 일본어 표 위에 얹지 않는다(2026-10-14 W8)
// 자리(2026-10-19): H1 바로 뒤에 Key facts 표가 있으면 그 표(뒤따르는 출처 줄 p.kfSrc·주입 마커 END 까지) 다음, 없으면 </h1> 다음.
//   ChatGPT 스니펫(labrador)은 제목 + 본문 앞 ~200자를 저장하는데, H1 직후 칩 줄(~75자)이 그 몫을 먹고 첫 $·날짜가 202자 밖으로 밀렸다(lit/08).
//   링크는 그대로 둔다(두 장째 클릭용) — 위치만 표 아래.
const KF_AFTER_H1 = 4000;   // H1 끝에서 이 글자 수 안에 Key facts 표가 시작할 때만(본문 아래쪽 표를 잡지 않게)
function nextLinksAt(html) {
  const h1 = html.indexOf("</h1>");
  if (h1 < 0) return -1;
  const end = h1 + "</h1>".length;
  const m = /<table class="kfTable[^"]*"[^>]*\bid="(?:key-facts-table|home-key-facts)"/.exec(html.slice(end, end + KF_AFTER_H1));
  if (!m) return end;
  let at = html.indexOf("</table>", end + m.index);
  if (at < 0) return end;
  at += "</table>".length;
  const tail = /^\s*<p class="kfSrc">[\s\S]*?<\/p>/.exec(html.slice(at));
  if (tail) at += tail[0].length;
  const mark = /^\s*<!-- [A-Z_]+:END -->/.exec(html.slice(at));
  if (mark) at += mark[0].length;
  return at;
}
function withNextLinks(html, rel, inKo) {
  if (NEXT_SKIP.has(rel)) return html;
  const want = nextLinksHtml(inKo, rel);
  // 있으면 지우고 정해진 자리에 다시 — 같은 입력이면 같은 결과(몇 번 돌려도 같다).
  const base = html.replace(new RegExp("\\n?[ \\t]*" + NEXT_RE.source), "");
  const at = nextLinksAt(base);
  if (at < 0) return html;
  return base.slice(0, at) + "\n      " + want + base.slice(at);
}

// 공개 HTML 의 작업 메모 주석 제거 — 2026-10-19(과정 비공개 규칙). 한글·'소유자'·AdSense 가 든 HTML 주석은 배포본에서 뺀다.
//   주입 마커(<!-- HOME_SUMMARY:START --> 등 ASCII 식별자)·영문 일반 주석은 그대로. <script>·<style> 안은 건드리지 않는다. 가드 CM1(copy-rules)이 0 을 본다.
const MEMO_RE = /[ㄱ-ㆎ가-힣]|소유자|adsense|애드센스/i;
function withoutMemoComments(html) {
  const parts = html.split(/(<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>)/i);
  return parts.map((p, i) => (i % 2 ? p : p.replace(/\n?[ \t]*<!--([\s\S]*?)-->/g, (all, body) => (MEMO_RE.test(body) ? "" : all)))).join("");
}

// 영문 페이지 푸터·브랜드 부제의 한국어 토글 라벨 — 2026-10-13 QA: 한국어로 바꿔도 푸터 문구·푸터 메뉴·상단 부제가 영어로 남았다.
// 각 페이지(생성기·손 HTML)가 같은 글자를 따로 갖고 있어 여기서 data-ko 만 덧붙인다(글자는 그대로). 몇 번 돌려도 결과가 같다.
// 홈·packs(packs.js 가 토글을 맡는 페이지)의 푸터 문단은 packs.js 가 setText 로 직접 바꾼다 — 거기에 data-ko 를 또 달면
// 첫 전환 때 한국어가 원문(data-en)으로 저장돼 영어로 못 돌아온다. 그래서 그 페이지들의 문단만 건너뛴다.
const FOOT_NOTE_EN = "OP Box Index is a data-driven research site, not investment advice.";
const FOOT_NOTE_KO = "OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.";
const FOOT_LINK_KO = {
  About: "소개", Methodology: "집계 방법", "Free data (CSV)": "무료 데이터(CSV)", Privacy: "개인정보처리방침", Disclaimer: "면책 고지",
  "Card Prices": "카드 시세", "Compare Sets": "세트 비교", "PSA Population": "PSA 인구", "Set Guides": "세트 가이드", "Top PSA 10": "PSA10 랭킹",
};
const BRAND_SUB_EN = "Booster box research", BRAND_SUB_KO = "부스터박스 리서치";
const SKIP_RE = /<a class="skipLink" href="#main-content"(?: data-ko="[^"]*")?>Skip to main content<\/a>/;
const FOOT_NAV_RE = /<nav aria-label="Footer navigation">([\s\S]*?)<\/nav>/;
const FOOT_NOTE_RE = /<p(?: data-ko="[^"]*")?>OP Box Index is a data-driven research site, not investment advice\.<\/p>/;
const BRAND_SUB_RE = /<small(?: data-ko="[^"]*")?>Booster box research<\/small>/;
function withFooterKo(html) {
  const packsOwns = /<script[^>]*(?:src="[^"]*packs\.js|data-home-js)/.test(html);
  const labelLink = (a, attrs, text) => {
    const ko = FOOT_LINK_KO[text];
    return ko ? "<a " + attrs.replace(/\s*data-ko="[^"]*"/, "") + ' data-ko="' + ko + '">' + text + "</a>" : a;
  };
  let out = html.replace(FOOT_NAV_RE, (m, inner) => '<nav aria-label="Footer navigation">' + inner.replace(/<a ([^>]*?)>([^<]+)<\/a>/g, labelLink) + "</nav>");
  if (!packsOwns) out = out.replace(FOOT_NOTE_RE, () => '<p data-ko="' + FOOT_NOTE_KO + '">' + FOOT_NOTE_EN + "</p>");
  out = out.replace(BRAND_SUB_RE, () => '<small data-ko="' + BRAND_SUB_KO + '">' + BRAND_SUB_EN + "</small>");
  out = out.replace(SKIP_RE, () => '<a class="skipLink" href="#main-content" data-ko="본문 바로가기">Skip to main content</a>');
  return out;
}
// ko/ 페이지의 영문판 — 그 페이지가 선언한 hreflang en(사이트 절대경로로). 없으면 영문 홈.
function enHrefOf(html) {
  const m = html.match(/<link rel="alternate" hreflang="en" href="https:\/\/opboxindex\.com(\/[^"]*)"/);
  return m ? m[1] : "../";
}

const checkOnly = process.argv.includes("--check");
// 메뉴 + (ko/ 페이지) 바로 뒤의 영문 전환 링크(data-lang-link)를 한 덩어리로 갈아끼운다 — 따로 두면 돌 때마다 링크가 하나씩 는다.
const NAV_RE = /<nav class="nav"[^>]*>[\s\S]*?<\/nav>(?:<a [^>]*data-lang-link[^>]*>[^<]*<\/a>)?/;

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
  // 2026-10-13: 파일명이 -750 으로 바뀐 뒤 옛 정규식(latin\.woff2)이 못 찾아 돌 때마다 preload 줄을 또 넣었다(index.html 18줄).
  // 어떤 bricolage preload 든 전부 지우고 한 줄만 남긴다(중복 제거 포함).
  const anyPreload = /[ \t]*<link rel="preload" href="[^"]*bricolage-grotesque-latin[^"]*\.woff2"[^>]*>\r?\n?/g;
  const found = html.match(anyPreload);
  if (found) {
    const indent = (found[0].match(/^[ \t]*/) || [""])[0];
    const nl = found[0].includes("\r\n") ? "\r\n" : "\n";
    let first = true;
    return html.replace(anyPreload, () => { if (first) { first = false; return `${indent}${FONT_PRELOAD(prefix)}${nl}`; } return ""; });
  }
  const re = new RegExp(`[ \\t]*<link rel="stylesheet" href="${prefix.replace(/\./g, "\\.")}styles\\.css[^"]*"[^>]*>`);
  const m = html.match(re);
  if (!m) return html;
  const indent = (m[0].match(/^[ \t]*/) || [""])[0];
  return html.replace(re, () => `${indent}${FONT_PRELOAD(prefix)}\n${m[0]}`);
}

// GA(gtag.js 175KB) 로더 — 리퍼러와 무관하게 window load 직후 한 번 붙인다(문서가 이미 complete 면 즉시). 2026-10-16 11:10 KST.
// DOMContentLoaded 즉시 부착(10:33 편집)은 실사이트 홈 모바일 라이트하우스 94→86~87(TBT 30→65~73ms)이었다 — 소유자 목표 90+ 와 충돌.
// load 직후는 LCP·TBT 측정 창 밖이고, 10/08 로더가 깎던 조건(load 뒤 1.5초 더·첫 입력·scroll·탭 숨김)은 없어 사람 세션은 거의 그대로 잡힌다.
// 이력(측정 방식이 창마다 달라 7일 비교가 오염됐다 — 2026-10-16 급락 분해):
//  · ~10-08 17:24 KST: <script async> 즉시 → 즉시 이탈도 집계.
//  · 10-08 17:24 ~ 10-14 22:25: window load+1.5초 단일 조건(라이트하우스 '사용하지 않는 JS' 대응). 그 전에 나가는 방문은 GA 에 없었다.
//  · 10-14 22:25 ~ 10-16: utm·AI/검색 리퍼러만 DOMContentLoaded, 직접 유입은 load+1.5초 / 첫 pointerdown·keydown·scroll / 탭 숨김 중 먼저 오는 때.
//    10/01–07 → 10/08–14 session_start 326→326 인데 page_view 581→480, 직접 page_view/세션 1.93→1.38(검색 1.66→1.63), scroll 58→35,
//    10/15 미귀속 19세션·빈 방문페이지 11·Unassigned user_engagement 12 — 숨김 시점에 늦게 붙어 session_start 없이 참여 이벤트만 간 흔적.
//  · 2026-10-16: 직접 유입 분기(load+1.5초·pointerdown·keydown·scroll·visibilitychange hidden)를 지우고 전원 window load 직후(complete 면 즉시).
//    되돌리려면 이 한 줄과 가드 GA1 의 기대 동작을 함께 바꾼다.
// 유지:
//  · navigator.webdriver(자동화)·/__v/(성능 측정 경로)는 GA 를 붙이지 않는다 — 측정 트래픽이 방문으로 쌓이지 않게.
//  · dataLayer 큐는 그대로라 page_view 는 gtag.js 가 붙을 때 전송된다. 문서 없는 수집 프로토콜을 직접 쏘는 비콘은 쓰지 않는다(gtag.js 한 경로).
// 가드 GA1 이 이 로더를 모든 페이지에서 같은 글자로, 위 동작대로 도는지 실행해 본다.
const GTAG_ASYNC = /<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=([A-Z0-9-]+)"><\/script>/;
const GTAG_DEFERRED = /<script data-gtag-deferred="([A-Z0-9-]+)">[\s\S]*?<\/script>/;
const gtagLoader = (id) => String.raw`<script data-gtag-deferred="${id}">(function(){var d=document;if(navigator.webdriver||/^\/__v\//.test(location.pathname))return;function go(){var s=d.createElement("script");s.async=true;s.src="https://www.googletagmanager.com/gtag/js?id=${id}";d.head.appendChild(s);}if(d.readyState==="complete")go();else window.addEventListener("load",go);})();</script>`;
function withDeferredGtag(html) {
  // 생성기가 막 쓴 async 태그든, 이미 바꿔 둔 옛 로더든 같은 최신 로더 한 줄로 맞춘다(몇 번 돌려도 결과가 같다).
  const m = html.match(GTAG_ASYNC) || html.match(GTAG_DEFERRED);
  if (!m) return html;
  return html.replace(m[0], () => gtagLoader(m[1]));
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
  const withFoot = inKo ? html : withFooterKo(html);
  if (withFoot !== html) {
    if (checkOnly) mismatch.push(rel + " (footer ko labels)");
    else { fs.writeFileSync(abs, withFoot, "utf8"); html = withFoot; if (!changed.includes(rel)) changed.push(rel); }
  }
  const withoutMemo = withoutMemoComments(html);
  if (withoutMemo !== html) {
    if (checkOnly) mismatch.push(rel + " (memo comments)");
    else { fs.writeFileSync(abs, withoutMemo, "utf8"); html = withoutMemo; if (!changed.includes(rel)) changed.push(rel); }
  }
  if (!NAV_RE.test(html)) { skipped.push(rel); continue; }

  const depth = rel.includes("/") ? 1 : 0;
  // current 는 항상 루트 기준 전체 경로를 넘긴다("sets/op-01.html"). 종전에는 하위 폴더면 null 을
  // 넘겼는데, site-nav 가 그 값으로 한국어 링크를 붙일지 판단하게 되면서 구분이 필요해졌다.
  // (세트 페이지에는 packs.js 토글이 이미 있어 링크를 붙이면 버튼이 둘이 된다)
  const want = inKo ? navHtmlKo(rel, enHrefOf(html)) : navHtml(depth ? "../" : "", rel);

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
