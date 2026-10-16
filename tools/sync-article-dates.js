#!/usr/bin/env node
// articles/*.html 의 날짜를 한 곳에서 맞춘다 — 2026-10-14 신설(W3).
//
// 왜: 글 날짜를 쓰는 곳이 주입기마다 따로였다(inject-set-list-prices·inject-pack-math·inject-box-price-guide·
//     inject-jp-en-6mo·inject-jp-vs-en-buy·inject-op05-op06·inject-sea-prices…). 각자 JSON-LD dateModified 와
//     바이라인 "Updated" 를 그날 데이터일로 덮어써, 본문이 그대로여도 매일 "수정됨"이 됐다. 반대로 주입기가 없는 글은
//     article:modified_time 메타도, 바이라인 Updated 도 없었다. Bing 스니펫은 발매일 글을 'Jul 16, 2026' 으로 찍었다.
//
// 규칙(이 파일만 날짜를 정한다. 주입기가 먼저 무엇을 써 두든 마지막에 이 규칙으로 다시 맞춘다)
//  · dateModified = 본문이 실제로 바뀐 날. 본문 = sync-sitemap-lastmod.js 의 bodyText(제목·설명 + 메뉴·푸터·바이라인·eyebrow·<time>·
//    날짜 표기를 뺀 글자) — 사이트맵 lastmod 와 같은 정의(2026-10-14 QA: 두 도구가 본문을 따로 정의해 바이라인 순서만 바뀐 글 8개의
//    lastmod 만 올랐다).
//    HEAD(마지막 커밋) 본문과 같으면 HEAD 의 dateModified 를 그대로 둔다. 다르면 주입기가 쓴 날짜가 HEAD 보다 늦을 때
//    그 날짜, 아니면 오늘(UTC). HEAD 에 없는 새 글은 파일에 적힌 값을 쓴다.
//  · <meta property="article:published_time"> · article:modified_time = JSON-LD datePublished · dateModified.
//  · 화면 바이라인은 "Updated <날짜> · Published <날짜>" — Updated 가 먼저(검색 스니펫이 첫 날짜를 집는다).
//  · eyebrow 의 "Updated <날짜>" 라벨도 dateModified.
// Run: node tools/sync-article-dates.js [--check]   (--check: 쓰지 않고 어긋난 파일만 알린다, 어긋나면 exit 1)
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const DIR = path.join(ROOT, "articles");
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTHS[m - 1]} ${d}, ${y}`; };
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Article 계열 JSON-LD 블록(문자열 그대로) — 서식(공백 유무)을 보존하려고 파싱 결과가 아니라 원문을 고친다.
function articleLd(html) {
  for (const m of html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)) {
    let j; try { j = JSON.parse(m[1]); } catch { continue; }
    if (j && /^(?:Article|BlogPosting|NewsArticle)$/.test(j["@type"])) return { raw: m[0], body: m[1], json: j };
  }
  return null;
}

// 본문 열쇠 — 날짜만 바뀐 날을 "수정"으로 치지 않는다. 숫자·문장·표가 바뀌면 바뀐 것이다. 정의는 사이트맵과 하나(bodyText).
const { bodyText } = require("./sync-sitemap-lastmod");
function bodyKey(html) {
  return crypto.createHash("sha1").update(bodyText(html)).digest("hex");
}

function headVersion(rel) {
  try {
    return execFileSync("git", ["show", `HEAD:${rel}`], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
  } catch { return null; }
}

// 이 파일이 가져야 할 (datePublished, dateModified) — 파일에 쓰지 않고 계산만.
const MON = Object.fromEntries(["january","february","march","april","may","june","july","august","september","october","november","december"].map((m, i) => [m, i + 1]));
function latestAsOf(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<[^>]+>/g, " ");
  let latest = "";
  for (const m of body.matchAll(/\bas of (\d{4}-\d{2}-\d{2})/gi)) if (m[1] > latest) latest = m[1];
  for (const m of body.matchAll(/\bas of ([A-Z][a-z]+) (\d{1,2}), (\d{4})/gi)) { const mo = MON[m[1].toLowerCase()]; if (mo) { const d = `${m[3]}-${String(mo).padStart(2, "0")}-${m[2].padStart(2, "0")}`; if (d > latest) latest = d; } }
  return latest;
}
function wantedDates(rel, html, today) {
  const ld = articleLd(html);
  if (!ld) return null;
  const pub = ld.json.datePublished, cur = ld.json.dateModified || pub;
  if (!ISO.test(pub || "") || !ISO.test(cur || "")) throw new Error(`${rel}: Article JSON-LD datePublished/dateModified 가 YYYY-MM-DD 가 아니다`);
  const head = headVersion(rel);
  const headLd = head && articleLd(head);
  const headMod = headLd && ISO.test(headLd.json.dateModified || "") ? headLd.json.dateModified : null;
  let mod = cur, reason = "new";
  if (head && headMod) {
    if (bodyKey(head) === bodyKey(html)) { mod = headMod; reason = "body-same"; }
    else { mod = cur > headMod ? cur : (today > headMod ? today : headMod); reason = "body-changed"; }
  }
  if (mod < pub) mod = pub;
  // 본문의 "as of <날짜>" 가 수정일보다 늦으면 그 날짜로 — 가드 U1 과 같은 정의(2026-10-16). 날짜 라벨만 바뀐 날은 body-same 이라
  // 수정일이 멈추는데, as-of 만 앞선 채 수정일이 뒤처지면 크롤러에는 묵은 값으로 읽히고 무인 빌드가 U1 로 멈춘다(10-16 08:57 실제).
  const asOf = latestAsOf(html); if (asOf && asOf > mod) { mod = asOf; reason += "+asof"; }
  return { pub, mod, reason };
}

function applyDates(html, pub, mod) {
  const ld = articleLd(html);
  // 1) JSON-LD dateModified (없으면 datePublished 뒤에 넣는다)
  let raw = ld.raw;
  if (/"dateModified":\s*"[^"]*"/.test(raw)) raw = raw.replace(/("dateModified":\s*")[^"]*(")/, (_m, a, b) => a + mod + b);
  else raw = raw.replace(/("datePublished":\s*"[^"]*")/, (m) => `${m}, "dateModified": "${mod}"`);
  html = html.replace(ld.raw, () => raw);
  // 2) article:published_time · article:modified_time — og:url(없으면 og:type) 바로 뒤
  html = html.replace(/\s*<meta property="article:(?:published|modified)_time"[^>]*>/g, "");
  const anchor = html.match(/^([ \t]*)<meta property="og:url"[^>]*>/m) || html.match(/^([ \t]*)<meta property="og:type"[^>]*>/m) || html.match(/^([ \t]*)<link rel="canonical"[^>]*>/m);
  if (!anchor) throw new Error("og:url/og:type/canonical 이 없어 article 메타를 넣을 자리가 없다");
  const ind = anchor[1];
  const eol = html.includes("\r\n") ? "\r\n" : "\n";
  html = html.replace(anchor[0], () => `${anchor[0]}${eol}${ind}<meta property="article:published_time" content="${pub}" />${eol}${ind}<meta property="article:modified_time" content="${mod}" />`);
  // 3) 바이라인: Updated 먼저, 그다음 Published
  html = html.replace(/(<p class="articleMeta">)([\s\S]*?)(<\/p>)/, (_m, open, inner, close) => {
    let s = inner
      .replace(/\s*·\s*Updated\s*<time\b[^>]*>[^<]*<\/time>/g, "")
      .replace(/\s*·\s*Published\s*<time\b[^>]*>[^<]*<\/time>/g, "")
      .replace(/^\s*Updated\s*<time\b[^>]*>[^<]*<\/time>\s*·\s*/, "")
      .replace(/^\s*Published\s*<time\b[^>]*>[^<]*<\/time>\s*·\s*/, "");
    const stamp = `Updated <time datetime="${mod}">${longDate(mod)}</time> · Published <time datetime="${pub}">${longDate(pub)}</time>`;
    const brand = s.match(/^([\s\S]*?OP Box Index<\/a>)/);
    s = brand ? `${brand[1]} · ${stamp}${s.slice(brand[1].length)}` : `${stamp} · ${s}`;
    return open + s + close;
  });
  // 4) eyebrow 의 "Updated <날짜>" 라벨
  html = html.replace(/(<p class="eyebrow">[^<]*?Updated )[A-Z][a-z]+ \d{1,2}, \d{4}/, (_m, a) => a + longDate(mod));
  return html;
}

function listArticles() {
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".html")).map((f) => `articles/${f}`);
}

module.exports = { bodyKey, articleLd, wantedDates, applyDates, longDate, listArticles, headVersion };

if (require.main === module) {
  const check = process.argv.includes("--check");
  // "오늘" = max(UTC 오늘, 사실 파일 hubDate(데이터 최신일)) — 2026-10-16. 08:57 KST(=23:57Z) 무인 빌드에서 주입기가 "as of 2026-10-16"(시계열 최신 점)을
  // 쓰는데 UTC 오늘은 10-15 라 dateModified 가 본문보다 일러 가드 U1 로 커밋이 막혔다(주간 점이 새로 생기는 날에만 재발).
  const F = require("./build-site-facts").load();
  const today = [new Date().toISOString().slice(0, 10), F.hubDate || ""].sort().pop();
  const changed = [], same = [], skipped = [];
  for (const rel of listArticles()) {
    const abs = path.join(ROOT, rel);
    const html = fs.readFileSync(abs, "utf8");
    const w = wantedDates(rel, html, today);
    if (!w) { skipped.push(rel); continue; }
    const next = applyDates(html, w.pub, w.mod);
    if (next === html) { same.push(rel); continue; }
    changed.push(`${rel} → ${w.mod} (${w.reason})`);
    if (!check) fs.writeFileSync(abs, next, "utf8");
  }
  console.log(JSON.stringify({ mode: check ? "check" : "write", changed, unchanged: same.length, noArticleLd: skipped }, null, 1));
  if (check && changed.length) process.exit(1);
}
