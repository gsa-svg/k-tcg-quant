#!/usr/bin/env node
// articles/japanese-vs-english-box-price-data-2026.html 의 표에 최신 열 3개(JP now · EN now · EN/JP now)를
// box-sold-series 에서 매일 다시 쓴다.
//
// 왜: 이 글은 2026-01~07 기간을 명시한 과거 연구다. 기존 열(JP Jan · JP Jul · JP 6mo · EN Jul · EN/JP ratio)과
//     문단은 그 기간의 기록이라 손대지 않는다. 대신 지금 값을 옆에 붙여 표가 7월에서 멈춰 보이지 않게 한다.
//
// 규칙 (tools/inject-box-price-guide.js 와 같다)
//  · 값은 각 시계열의 마지막 관측 중앙값(USD). 마지막 판매가 STALE_DAYS 를 넘으면 그 칸은 "—".
//  · 배수는 JP·EN 둘 다 신선할 때만 낸다. 한쪽이라도 비면 "—".
//  · 과거 열 셀은 글에 있던 그대로 옮긴다. 표에 없던 세트는 행을 추가하고 과거 열은 "—".
//  · 새 행의 세트 이름은 data/onepiece-packs.json 의 nameEn, 없으면 코드만 — 지어내지 않는다.
//  · dateModified 와 화면 바이라인 "Updated" 는 데이터 날짜로 맞춘다.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/japanese-vs-english-box-price-data-2026.html");
const SERIES = path.join(ROOT, "data/box-sold-series.json");
const STALE_DAYS = 28;
const NOW_TH = ["JP now", "EN now", "EN/JP now"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const skip = (reason) => { console.log(JSON.stringify({ status: "skip", reason })); process.exit(0); };

if (!fs.existsSync(ART) || !fs.existsSync(SERIES)) skip("file missing");
const S = JSON.parse(fs.readFileSync(SERIES, "utf8")).sets || {};
let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

const tm = html.match(/<table class="dataTable">[\s\S]*?<\/table>/);
if (!tm) skip("표를 못 찾음");
const table = tm[0];

// 머리행 — "now" 열을 뺀 나머지가 과거 열이다(두 번째 실행부터는 now 열이 이미 붙어 있다).
const thead = table.match(/<thead>[\s\S]*?<\/thead>/);
if (!thead) skip("thead 를 못 찾음");
// <th[^>]*> 로 쓰면 <thead> 까지 잡혀 두 번째 실행에서 머리행이 겹쳐 쌓인다 — 태그 이름 뒤는 공백이나 > 만.
const histTh = [...thead[0].matchAll(/<th(?:\s[^>]*)?>[\s\S]*?<\/th>/g)].map((m) => m[0])
  .filter((th) => !NOW_TH.includes(th.replace(/<[^>]+>/g, "").trim()));
const H = histTh.length;
if (H < 2) skip("과거 열을 못 찾음");

// 본문 — 코드별 과거 열 셀을 그대로 보관
const hist = {};
const tbody = table.match(/<tbody>[\s\S]*?<\/tbody>/);
if (!tbody) skip("tbody 를 못 찾음");
for (const tr of tbody[0].matchAll(/<tr>([\s\S]*?)<\/tr>/g)) {
  const cells = [...tr[1].matchAll(/<td(?:\s[^>]*)?>[\s\S]*?<\/td>/g)].map((m) => m[0]);
  const code = (cells[0] || "").replace(/<[^>]+>/g, "").match(/^((?:OP|EB|PRB)-\d{2})/);
  if (code) hist[code[1]] = cells.slice(0, H);
}
if (!Object.keys(hist).length) skip("표 행을 못 찾음");

// 표에 없던 세트(관측이 하나라도 있는 것)는 행을 추가한다. 과거 열은 "—".
let PACKS = {};
try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, "data/onepiece-packs.json"), "utf8")); PACKS = p.sets || p; } catch {}
const added = [];
for (const code of Object.keys(S)) {
  if (hist[code]) continue;
  if (!((S[code].jp || []).length || (S[code].en || []).length)) continue;
  const en = PACKS[code] && PACKS[code].nameEn;
  hist[code] = [`<td>${esc(en ? `${code} ${en}` : code)}</td>`].concat(Array(H - 1).fill("<td>—</td>"));
  added.push(code);
}
const ord = (c) => { const [m, n] = c.split("-"); return ({ OP: 1, EB: 2, PRB: 3 }[m] || 9) * 100 + Number(n); };
const order = Object.keys(hist).sort((a, b) => ord(a) - ord(b));

let dataDate = "";
for (const c of Object.keys(S)) for (const ed of ["jp", "en"]) {
  const a = (S[c] && S[c][ed]) || [];
  if (a.length && a[a.length - 1].d > dataDate) dataDate = a[a.length - 1].d;
}
if (!dataDate) skip("no series dates");
const now = Date.parse(dataDate);
const fresh = (c, ed) => {
  const a = (S[c] && S[c][ed]) || [];
  const l = a.length ? a[a.length - 1] : null;
  return l && Date.parse(l.d) >= now - STALE_DAYS * 86400000 ? l : null;
};

const rows = [];
let jpN = 0, enN = 0, pairs = 0;
for (const code of order) {
  const j = fresh(code, "jp"), e = fresh(code, "en");
  const r = j && e ? e.median / j.median : null;
  if (j) jpN++;
  if (e) enN++;
  if (r) pairs++;
  rows.push(`          <tr>${hist[code].join("")}<td>${j ? usd(j.median) : "—"}</td><td>${e ? usd(e.median) : "—"}</td><td>${r ? r.toFixed(1) + "x" : "—"}</td></tr>`);
}
if (!pairs) skip("신선한 쌍이 없다");

const newTable = nl(
  `<table class="dataTable">\n        <caption>Now = median completed sale as of ${longDate(dataDate)}</caption>\n` +
  `        <thead><tr>${histTh.join("")}${NOW_TH.map((t) => `<th>${t}</th>`).join("")}</tr></thead>\n` +
  `        <tbody>\n${rows.join("\n")}\n        </tbody>\n      </table>`
);

const before = html;
html = html.replace(table, () => newTable);
html = html.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + dataDate + b);
if (/Updated <time datetime="/.test(html)) {
  html = html.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + dataDate + b + longDate(dataDate) + c);
} else {
  html = html.replace(/(Published <time datetime="[^"]*">[^<]*<\/time>)/, (_m, a) => `${a} · Updated <time datetime="${dataDate}">${longDate(dataDate)}</time>`);
}

if (html === before) skip("바뀐 것 없음");
fs.writeFileSync(ART, html);
console.log(JSON.stringify({ status: "ok", dataDate, rows: rows.length, added, jpFresh: jpN, enFresh: enN, pairs }));
