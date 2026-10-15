"use strict";
// 화면 스크립트(packs.js)·캐시 키·CSP·GA 로더 — 사실 파일이 보장할 수 없는 런타임 규칙. 2026-10-15 분할.
//  V1 캐시 버전 일관성 [2026-07-14 DATA_VERSION 미범프: 하루 종일 구데이터] · V2 생성기 캐시버전 하드코딩 금지 [2026-07-27 하루 세 번 배포 막힘]
//  D4 박스 차트는 sold 시계열만 [2026-07-22 혼합소스 가짜 급등] · H3 런타임 canonical/hreflang 재작성 금지 [2026-09-29]
//  J1 호출하는 render*/init* 함수 선언 존재 [2026-07-27 빈 화면] · X1 fetch 주소 = CSP connect-src [2026-07-20 위젯 조용히 차단]
//  GA1/GA2 GA 로더 동작·utm 보존 [2026-10-14 ChatGPT 방문이 (direct)]
const vm = require("node:vm");
const { errors, read, exists, list, PUBLIC_HTML, packs } = require("./lib");

const checks = ["V1", "V2", "D4", "H3", "J1", "X1", "GA1", "GA2"];
let VERSION = null;

function run() {
  const packsJs = read("packs.js");
  VERSION = (packsJs.match(/DATA_VERSION = "([^"]+)"/) || [])[1];
  if (!VERSION) errors.push("V1: packs.js에서 DATA_VERSION을 찾지 못함");
  else for (const f of PUBLIC_HTML) {
    const html = read(f);
    for (const m of html.matchAll(/\?v=([0-9a-z]+)/g)) if (m[1] !== VERSION) { errors.push(`V1: ${f} 의 ?v=${m[1]} ≠ DATA_VERSION ${VERSION} (동시 범프 안 됨)`); break; }
    // 무버전 참조는 캐시버스팅 사각지대(2026-07-21 감사: 48개 페이지)
    for (const m of html.matchAll(/(?:href|src)="[^"]*(styles\.css|packs\.js)"/g)) errors.push(`V1: ${f} 의 ${m[1]} 참조에 ?v= 누락 — 캐시버스팅 사각지대`);
  }
  for (const f of list("tools", /^(generate|inject)-.*\.js$/)) {
    for (const m of read(`tools/${f}`).matchAll(/(?:\?v=|const\s+\w*(?:CACHE|VER|VERSION)\w*\s*=\s*")(\d{8}[a-z0-9]*)/g)) errors.push(`V2: tools/${f} 가 캐시버전 "${m[1]}" 을 하드코딩 — packs.js 의 DATA_VERSION 을 읽게 할 것(범프 때 배포가 막힌다)`);
  }

  // D4 — 차트 함수 두 개만 떼어 본다. 줄끝을 \n 으로 못 박지 말 것(CRLF 체크아웃이라 빈 문자열을 보고 늘 통과했다, 2026-08-13).
  const fnBody = (name) => (packsJs.match(new RegExp("function " + name + "[\\s\\S]*?\\r?\\n\\}\\r?\\n")) || [""])[0];
  const chartZone = fnBody("renderBoxSeries") + fnBody("boxChartFor");
  if (!chartZone.includes("soldSeries")) errors.push("D4: 박스 차트 함수(renderBoxSeries/boxChartFor)를 못 찾았다 — 이 가드가 아무것도 검사하지 못하고 있다");
  if (!/box-sold-series\.json/.test(packsJs)) errors.push("D4: 박스 차트가 우리 sold 시계열(box-sold-series.json)을 더 이상 읽지 않는다");
  if (/\bboxSeriesEn\b|\.boxSeries\b/.test(chartZone)) errors.push("D4: 박스 차트가 혼합소스 주간시리즈(boxSeries/boxSeriesEn)를 다시 읽는다 — 소스 전환 지점에 가짜 급등이 생긴다");
  if (/source transition can appear as a larger move/i.test(packsJs)) errors.push("D4: 혼합소스 트렌드 차트 안내가 되살아남 — active 중간값을 sold 이력으로 오인시킬 수 있음");

  // H3 — 구글은 JS 렌더 뒤의 canonical·hreflang 을 읽는다. 주석 속 설명 문구는 검사하지 않는다.
  const code = packsJs.replace(/\/\/[^\n]*/g, "");
  if (/canonical\.href\s*=\s*[`'"][^`'"]*packs\.html\?/.test(code) || /canonical\.href\s*=\s*`\$\{SITE_BASE\}\/packs\.html/.test(code)) errors.push("H3: packs.js 가 canonical 을 packs.html?… (noindex) 로 재작성한다");
  if (/hreflang[\s\S]{0,400}\?hl=/.test(code) && /createElement\(\s*["']link["']\s*\)[\s\S]{0,300}hreflang/.test(code)) errors.push("H3: packs.js 가 hreflang 을 ?hl= 파라미터 URL 로 만들어 넣는다");
  if (/querySelectorAll\(\s*['"]link\[rel="alternate"\]\[hreflang\]['"]\s*\)\s*\.forEach\([\s\S]{0,60}?remove\(\)/.test(code)) errors.push("H3: packs.js 가 정적 hreflang 태그를 지운다");

  // J1 — 문법은 통과하고 가드도 통과했지만 세트 상세가 통째로 빈 화면이 됐다. 이름만 대조한다.
  const declared = new Set([...packsJs.matchAll(/(?:^|\n)\s*(?:async\s+)?function\s+(\w+)/g)].map((m) => m[1]));
  for (const m of packsJs.matchAll(/\b((?:render|init|build)[A-Z]\w*)\s*\(/g)) {
    const name = m[1];
    if (declared.has(name) || /[.\w$]$/.test(packsJs.slice(Math.max(0, m.index - 1), m.index)) || new RegExp(`(?:const|let|var)\\s+${name}\\s*=`).test(packsJs)) continue;
    errors.push(`J1: packs.js 가 ${name}() 를 호출하는데 선언이 없음 — 렌더가 런타임에 통째로 죽는다`);
  }

  // X1 — 외부 fetch 주소·eBay 썸네일(aucThumb)·일본판 카드 이미지 도메인이 홈 CSP 에 있어야 한다.
  const csp = (page, dir) => { const h = read(page); return /Content-Security-Policy/i.test(h) ? ((h.match(new RegExp(`${dir} ([^;"]+)`)) || [])[1] || "") : null; };
  for (const page of ["index.html", "packs.html"].filter(exists)) {
    for (const m of packsJs.matchAll(/const\s+\w*RELAY\w*\s*=\s*"(https:\/\/[^"]+)"/g)) {
      let origin; try { origin = new URL(m[1]).origin; } catch { continue; }
      const c = csp(page, "connect-src");
      if (c != null && !c.includes(origin)) errors.push(`X1: ${page} 의 CSP connect-src 에 ${origin} 없음 — 브라우저가 조용히 차단함`);
    }
    const img = csp(page, "img-src");
    if (img != null && /aucThumb/.test(packsJs) && !img.includes("i.ebayimg.com")) errors.push(`X1: ${page} 의 CSP img-src 에 i.ebayimg.com 없음 — 경매 썸네일이 조용히 안 뜸`);
    if (img != null && JSON.stringify(packs()).includes("onepiece-cardgame.com") && !img.includes("onepiece-cardgame.com")) errors.push(`X1: ${page} 의 CSP img-src 에 onepiece-cardgame.com 없음 — 일본판 카드 이미지가 조용히 차단됨`);
  }

  ga1();
  ga2(packsJs);
}

// GA1 — 모든 페이지가 inject-nav.js 의 같은 로더 한 줄을 갖고, 가짜 문서에서 실제로 돌려 본다:
//  자동화·/__v/ → 안 붙음 · utm·AI/검색 리퍼러 → DOMContentLoaded 직후 · 그 밖 → load+1.5초 / 첫 입력·문서 scroll / 탭 숨김 중 먼저 오는 때 1번
function ga1() {
  const loaders = new Map();
  for (const f of PUBLIC_HTML) {
    const html = read(f);
    if (/<script async src="https:\/\/www\.googletagmanager\.com\/gtag\/js/.test(html)) errors.push(`GA1: ${f} 에 gtag.js 를 바로 받는 async 태그가 남았다 — node tools/inject-nav.js 로 로더로 바꿀 것`);
    const found = [...html.matchAll(/<script data-gtag-deferred="([A-Z0-9-]+)">([\s\S]*?)<\/script>/g)];
    if (found.length > 1) errors.push(`GA1: ${f} 에 GA 로더가 ${found.length}개`);
    if (!found.length) { if (/gtag\(\s*['"]config['"]/.test(html)) errors.push(`GA1: ${f} 는 gtag config 가 있는데 로더가 없다 — 방문이 집계되지 않는다`); continue; }
    if (!loaders.has(found[0][2])) loaders.set(found[0][2], []);
    loaders.get(found[0][2]).push(f);
  }
  if (loaders.size > 1) errors.push(`GA1: GA 로더 글자가 페이지마다 다르다(${loaders.size}종: ${[...loaders.values()].map((v) => v[0]).join(", ")}) — node tools/inject-nav.js 를 다시 돌릴 것`);
  const run = (src, { search = "", pathname = "/", referrer = "", webdriver = false } = {}) => {
    const added = [], listeners = [], timers = [];
    const on = (target) => (type, fn, opts) => listeners.push({ target, type, fn, capture: opts === true || !!(opts && opts.capture) });
    const document = { referrer, readyState: "loading", visibilityState: "visible", head: { appendChild: (s) => added.push(s.src) }, createElement: () => ({}), addEventListener: on("document") };
    vm.runInNewContext(src, { document, window: { addEventListener: on("window") }, location: { search, pathname }, navigator: { webdriver }, setTimeout: (fn, ms) => timers.push({ fn, ms }) });
    const fire = (target, type) => listeners.filter((x) => x.target === target && x.type === type).forEach((x) => x.fn());
    return { added, listeners, timers, fire, flush: () => timers.splice(0).forEach((t) => t.fn()), document };
  };
  for (const src of loaders.keys()) {
    const bad = (msg) => errors.push(`GA1: 로더 동작 위반 — ${msg}`);
    try {
      for (const opt of [{ webdriver: true, search: "?utm_source=chatgpt.com" }, { pathname: "/__v/sets/op-01.html", referrer: "https://chatgpt.com/" }]) {
        const r = run(src, opt);
        ["DOMContentLoaded", "visibilitychange"].forEach((t) => r.fire("document", t));
        ["load", "pointerdown", "keydown", "scroll"].forEach((t) => r.fire("window", t));
        r.flush();
        if (r.added.length) bad(`${JSON.stringify(opt)} 에서 gtag.js 를 붙였다(자동화·/__v/ 는 0이어야 한다)`);
      }
      for (const opt of [{ search: "?set=OP-13&hl=en&utm_source=chatgpt.com" }, { referrer: "https://chatgpt.com/" }, { referrer: "https://www.perplexity.ai/search/x" }, { referrer: "https://copilot.microsoft.com/" }, { referrer: "https://www.bing.com/" }, { referrer: "https://www.google.co.kr/" }, { referrer: "https://m.search.naver.com/search.naver?q=x" }, { referrer: "https://duckduckgo.com/" }]) {
        const r = run(src, opt);
        if (r.added.length) bad(`${JSON.stringify(opt)} 에서 DOMContentLoaded 전에 붙였다`);
        r.fire("document", "DOMContentLoaded");
        if (r.added.length !== 1 || !/googletagmanager\.com\/gtag\/js\?id=G-/.test(r.added[0] || "")) bad(`${JSON.stringify(opt)} 에서 DOMContentLoaded 직후 gtag.js 1번이 아니다(${r.added.length})`);
      }
      const plain = { referrer: "https://opboxindex.com/sets/op-01.html" };
      {
        const r = run(src, plain);
        r.fire("document", "DOMContentLoaded");
        if (r.added.length) bad("일반 진입에서 load 전에 gtag.js 를 붙였다");
        r.fire("window", "load");
        if (r.added.length || r.timers.length !== 1 || r.timers[0].ms !== 1500) bad("일반 진입이 load+1500ms 예약 1개가 아니다");
        r.flush(); r.fire("window", "pointerdown");
        if (r.added.length !== 1) bad(`일반 진입 load+1.5초 뒤 gtag.js ${r.added.length}번(1이어야 한다)`);
        const scroll = r.listeners.filter((x) => x.target === "window" && x.type === "scroll");
        if (scroll.length !== 1 || scroll[0].capture) bad("문서 scroll 리스너가 window 에 capture 없이 1개가 아니다");
      }
      for (const [target, type] of [["window", "pointerdown"], ["window", "keydown"], ["window", "scroll"], ["document", "visibilitychange"]]) {
        const r = run(src, plain);
        if (type === "visibilitychange") { r.fire(target, type); if (r.added.length) bad("탭이 보이는 상태의 visibilitychange 에서 붙였다"); r.document.visibilityState = "hidden"; }
        r.fire(target, type);
        if (r.added.length !== 1) bad(`${type} 가 load 전에 gtag.js 를 1번 붙이지 않았다(${r.added.length})`);
        r.fire("window", "load"); r.flush(); r.fire("window", "keydown");
        if (r.added.length !== 1) bad(`${type} 뒤 load·keydown 에서 gtag.js 를 또 붙였다(${r.added.length})`);
      }
    } catch (e) { bad(`가짜 문서에서 실행 실패 ${e.message}`); }
  }
}

// GA2 — updateUrl(true) 가 set·hl 만 남겨 utm 이 사라졌다(2026-10-14 실측). 화면 상태 밖 파라미터는 보존해야 한다.
function ga2(packsJs) {
  const fnAt = packsJs.indexOf("function updateUrl(");
  const close = fnAt < 0 ? null : /\r?\n\}\r?\n/.exec(packsJs.slice(fnAt));
  if (fnAt < 0 || !close) { errors.push("GA2: packs.js 에서 updateUrl 을 찾지 못함"); return; }
  const constAt = packsJs.indexOf("const ROUTE_PARAMS");
  const code = (constAt >= 0 && constAt < fnAt ? packsJs.slice(constAt, fnAt) : "") + packsJs.slice(fnAt, fnAt + close.index + close[0].length);
  for (const [st, search, want] of [
    [{ selected: "OP-13", hasExplicitSet: true, lang: "jp", view: "hits", hl: "en" }, "?set=OP-13&hl=en&utm_source=chatgpt.com&utm_medium=referral", "/?set=OP-13&hl=en&utm_source=chatgpt.com&utm_medium=referral"],
    [{ selected: "OP-05", hasExplicitSet: false, lang: "extra", view: "hits", hl: "ko" }, "?set=OP-01&view=psa&hl=en&gclid=x1", "/?lang=extra&gclid=x1"],
  ]) {
    let got = null;
    try { vm.runInNewContext(code + "\nupdateUrl(true);", { state: st, location: { pathname: "/", search }, URLSearchParams, history: { replaceState: (a, b, u) => { got = u; }, pushState: (a, b, u) => { got = u; } } }); } catch (e) { got = "실행 실패 " + e.message; }
    if (got !== want) errors.push(`GA2: updateUrl(${search}) → ${got} (기대 ${want}) — 화면 상태 밖 파라미터(utm 등)를 보존해야 한다`);
  }
}

module.exports = { checks, run, version: () => VERSION };
