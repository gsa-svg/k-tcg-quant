#!/usr/bin/env node
// articles/one-piece-set-list-release-dates.html 의 "JP box" 열과 기준일을 box-sold-series 에서 다시 쓴다.
// 이 글은 AI 인용 1위 페이지(전체 인용의 56%)인데 가격이 손으로 적혀 있어 매주 낡았다.
// 2026-09-28: 열 머리글은 "Sep 2026", 주석은 "July 14" 로 서로 달랐고 실제 값은 3주 전 값이었다(OP-16 −12%).
//
// 규칙
//  · 값은 JP 시계열의 마지막 관측 중앙값(USD, 반올림).
//  · 마지막 실제 판매가 STALE_DAYS 를 넘으면 값 대신 "—" 를 쓴다(홈·세트 페이지와 같은 기준).
//  · 미발매 세트는 원래대로 "—" 를 유지한다(시계열이 없으면 건드리지 않는다).
//  · 아무 값도 만들어내지 않는다. 시계열에 없는 세트는 그대로 둔다.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/one-piece-set-list-release-dates.html");
const SERIES = path.join(ROOT, "data/box-sold-series.json");
const STALE_DAYS = 28;
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function longDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${d}, ${y}`;
}

if (!fs.existsSync(ART) || !fs.existsSync(SERIES)) {
  console.log(JSON.stringify({ status: "skip", reason: "file missing" }));
  process.exit(0);
}

const series = JSON.parse(fs.readFileSync(SERIES, "utf8")).sets || {};
let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");

// 데이터 기준일 = 시계열에 들어 있는 가장 최근 관측일
let dataDate = "";
for (const code of Object.keys(series)) {
  const jp = (series[code] && series[code].jp) || [];
  if (jp.length && jp[jp.length - 1].d > dataDate) dataDate = jp[jp.length - 1].d;
}
if (!dataDate) {
  console.log(JSON.stringify({ status: "skip", reason: "no series dates" }));
  process.exit(0);
}
const now = Date.parse(dataDate);

let updated = 0, staled = 0, untouched = 0;
const trRe = /<tr><td>((?:OP|EB|PRB)-\d+)<\/td>([\s\S]*?)<\/tr>/g;
html = html.replace(trRe, (whole, code, rest) => {
  const jp = (series[code] && series[code].jp) || [];
  if (!jp.length) { untouched++; return whole; }
  const last = jp[jp.length - 1];
  const stale = Date.parse(last.d) < now - STALE_DAYS * 86400000;
  const cell = stale ? "—" : "$" + Math.round(last.median).toLocaleString("en-US");
  // 치환 문자열이 아니라 함수로 쓴다 — cell 이 "$" 로 시작해서 $1·$& 같은 치환 패턴으로 오인된다.
  const next = rest.replace(
    /(<td class="num">)(?:<td class="num">)?(?:\$?[\d,]+|—)(<\/td>)/,
    (_m, open, close) => open + cell + close
  );
  if (next === rest) { untouched++; return whole; }
  if (stale) staled++; else updated++;
  return `<tr><td>${code}</td>${next}</tr>`;
});

// 본문 안의 최신 세트 박스값 (data-op17-box 표시 구간 — 상단 안내와 "Which sets" 목록 두 곳, 표와 같은 원천)
// 2026-09-30: 목록 쪽은 손으로 쓴 "$144 on September 7" 이 표($130, 9/28)와 어긋나 있었다 → 같은 구간으로 묶었다.
const newest = Object.keys(series)
  .filter((c) => /^OP-\d+$/.test(c) && (series[c].jp || []).length)
  .sort((a, b) => +a.slice(3) - +b.slice(3))
  .pop();
if (newest) {
  const jp = series[newest].jp;
  const last = jp[jp.length - 1];
  const txt = `$${Math.round(last.median).toLocaleString("en-US")} on ${longDate(last.d)}`;
  html = html.replace(
    /(<span data-op17-box>)[^<]*(<\/span>)/g,
    (_m, open, close) => open + txt + close
  );
}

// 열 머리글 · 주석 · 갱신일
const short = `${MON[+dataDate.slice(5, 7) - 1]} ${dataDate.slice(0, 4)}`;
html = html.replace(/<th class="num">JP box \([^)]*\)<\/th>/g, `<th class="num">JP box (${short})</th>`);
// 2026-09-30: 종전 정규식은 옛 문구("weekly market values as of")를 찾아, 문구가 바뀐 뒤 기준일이 9/27 에 멈춰 있었다.
html = html.replace(
  /Box prices are Japanese sealed box medians from completed eBay sales, as of [^—]*—/,
  () => `Box prices are Japanese sealed box medians from completed eBay sales, as of ${longDate(dataDate)} —`
);
html = html.replace(/Reference · Updated [A-Z][a-z]+ \d{1,2}, \d{4}/, `Reference · Updated ${longDate(dataDate)}`);
html = html.replace(/("dateModified": ")[^"]*(")/, `$1${dataDate}$2`);

if (crlf) html = html.replace(/\r?\n/g, "\r\n");
fs.writeFileSync(ART, html);
console.log(JSON.stringify({ status: "ok", dataDate, updated, staled, untouched }));
