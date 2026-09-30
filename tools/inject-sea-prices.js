#!/usr/bin/env node
// articles/one-piece-booster-box-prices-sea.html 의 "일본판 박스를 현지 통화로" 표와 그 위아래 문장
// (환율·기준일), 제목 줄의 월을 box-sold-series 와 data/fx.json 에서 매일 다시 쓴다.
//
// 왜: 표가 2026-07-14 시세·07-15 환율에 손으로 박혀 있었다. 9월 말 실측으로 OP-16 은 글 $150 → 실제 $95,
//     OP-01 은 $313 → $300 인데 제목 줄은 "(July 2026)" 였다.
//
// 규칙 (tools/inject-box-price-guide.js 와 같다)
//  · 행은 표에 이미 있는 세트만 다시 쓴다. 이름은 표에서 읽어 유지하고, 비어 있으면 packs.json 의 nameEn,
//    그것도 없으면 코드만 — 지어내지 않는다.
//  · USD 는 JP 시계열의 마지막 관측 중앙값. 마지막 판매가 STALE_DAYS 를 넘으면 그 행은 USD·현지 통화 모두 "—".
//  · 현지 통화 = USD × data/fx.json 의 sea 환율(1 USD 당 현지 통화, ECB 기준환율).
//  · 정가 행은 USD 칸("~$36")을 그대로 두고, 현지 통화만 각주의 "N packs × ¥M" 을 사이트 공통 방식
//    (jpyKrw / usdKrw, inject-pack-math.js 와 같다)으로 USD 로 바꾼 뒤 환산한다.
//  · 표기는 기존 표 형식 그대로: ₱·฿ 10단위, S$·RM 1단위, Rp 는 100만 이상 x.xxM / 미만 xxxK.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/one-piece-booster-box-prices-sea.html");
const STALE_DAYS = 28;
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
const monthYear = (iso) => { const [y, m] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${y}`; };
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
const r1 = (v) => Math.round(v).toLocaleString("en-US");
const r10 = (v) => (Math.round(v / 10) * 10).toLocaleString("en-US");
const idr = (v) => { const k = Math.round(v / 1e3); return k >= 1000 ? "Rp" + (v / 1e6).toFixed(2) + "M" : "Rp" + k + "K"; };
// 표 열 순서(PHP·SGD·MYR·IDR·THB)와 같다. cell = 표 칸, rate = 표 위 문장의 "1 USD 당" 표기.
const CUR = [
  { code: "PHP", cell: (v) => "₱" + r10(v), rate: (r) => "₱" + r.toFixed(1) },
  { code: "SGD", cell: (v) => "S$" + r1(v), rate: (r) => "S$" + r.toFixed(2) },
  { code: "MYR", cell: (v) => "RM" + r1(v), rate: (r) => "RM" + r.toFixed(2) },
  { code: "IDR", cell: idr, rate: (r) => "Rp" + r10(r) },
  { code: "THB", cell: (v) => "฿" + r10(v), rate: (r) => "฿" + r.toFixed(1) },
];

const skip = (reason) => { console.log(JSON.stringify({ status: "skip", reason })); process.exit(0); };
if (!fs.existsSync(ART)) skip("article missing");
let S, FX, PACKS = {};
try {
  S = JSON.parse(fs.readFileSync(path.join(ROOT, "data/box-sold-series.json"), "utf8")).sets || {};
  FX = JSON.parse(fs.readFileSync(path.join(ROOT, "data/fx.json"), "utf8"));
} catch (e) { skip("data missing: " + e.message); }
try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, "data/onepiece-packs.json"), "utf8")); PACKS = p.sets || p; } catch {}
const SEA = FX.sea || {};
if (!FX.date || !CUR.every((c) => Number.isFinite(SEA[c.code]))) skip("fx.json sea 환율 없음");

let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

// 고칠 자리가 하나라도 없으면 글 구조가 바뀐 것이다 — 반쯤 고친 글을 내보내지 않는다.
const RE = {
  tbody: /(<tbody>)[\s\S]*?(<\/tbody>)/,
  rates: /converted from USD at [A-Z][a-z]+ \d{1,2}, \d{4} exchange rates \([^)]*\)/,
  market: /Market values as of [A-Z][a-z]+ \d{1,2}, \d{4}/,
  fx: /FX as of [A-Z][a-z]+ \d{1,2}, \d{4}/,
  heading: /(What Japanese boxes cost in your currency \()[A-Z][a-z]+ \d{4}(\))/,
};
const missing = Object.keys(RE).filter((k) => !RE[k].test(html));
if (missing.length) skip("자리 못 찾음: " + missing.join(","));

const tbody = html.match(RE.tbody)[0];
const names = {};
const order = [];
for (const m of tbody.matchAll(/<tr><td>((?:OP|EB|PRB)-\d{2})([^<]*)<\/td>/g)) {
  const en = PACKS[m[1]] && PACKS[m[1]].nameEn;
  names[m[1]] = m[2].trim() ? m[1] + " " + m[2].trim() : en ? `${m[1]} ${en}` : m[1];
  order.push(m[1]);
}
if (!order.length) skip("표 행을 못 찾음");
const msrp = tbody.match(/<tr><td>(<em>[^<]*MSRP[^<]*<\/em>)<\/td><td>([^<]*)<\/td>/);
const msrpYen = html.match(/(\d+) packs (?:×|&times;) ¥([\d,]+)/);

let dataDate = "";
for (const c of Object.keys(S)) for (const ed of ["jp", "en"]) {
  const a = (S[c] && S[c][ed]) || [];
  if (a.length && a[a.length - 1].d > dataDate) dataDate = a[a.length - 1].d;
}
if (!dataDate) skip("no series dates");
const now = Date.parse(dataDate);
const fresh = (c) => {
  const a = (S[c] && S[c].jp) || [];
  const l = a.length ? a[a.length - 1] : null;
  return l && Date.parse(l.d) >= now - STALE_DAYS * 86400000 ? l : null;
};
const local = (u) => CUR.map((c) => `<td>${u == null ? "—" : c.cell(u * SEA[c.code])}</td>`).join("");

const rows = [];
let freshRows = 0;
for (const code of order) {
  const j = fresh(code);
  if (j) freshRows++;
  rows.push(`          <tr><td>${names[code]}</td><td>${j ? usd(j.median) : "—"}</td>${local(j ? j.median : null)}</tr>`);
}
if (!freshRows) skip("신선한 JP 관측이 없다");
let msrpUsd = null;
if (msrp) {
  if (msrpYen && FX.jpyKrw && FX.usdKrw) msrpUsd = (Number(msrpYen[1]) * Number(msrpYen[2].replace(/,/g, "")) * FX.jpyKrw) / FX.usdKrw;
  rows.push(`          <tr><td>${msrp[1]}</td><td>${msrp[2]}</td>${local(msrpUsd)}</tr>`);
}

const before = html;
html = html.replace(RE.tbody, () => nl(`<tbody>\n${rows.join("\n")}\n        </tbody>`));
html = html.replace(RE.rates, () =>
  `converted from USD at ${longDate(FX.date)} exchange rates (${CUR.map((c) => c.rate(SEA[c.code])).join(", ")} per USD)`
);
html = html.replace(RE.market, () => `Market values as of ${longDate(dataDate)}`);
html = html.replace(RE.fx, () => `FX as of ${longDate(FX.date)}`);
html = html.replace(RE.heading, (_m, a, b) => a + monthYear(dataDate) + b);
// FAQ 가 가리키는 "the <월> table above" 도 제목 줄과 같은 달로 — 제목만 바뀌면 둘이 어긋난다.
html = html.replace(/(Use the )[A-Z][a-z]+ \d{4}( table above)/, (_m, a, b) => a + monthYear(dataDate) + b);

// 수정일은 이 글이 쓰는 두 데이터(시세·환율) 중 늦은 날짜. JSON-LD 와 화면 바이라인을 같이 맞춘다.
const modDate = FX.date > dataDate ? FX.date : dataDate;
html = html.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + modDate + b);
if (/Updated <time datetime="/.test(html)) {
  html = html.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + modDate + b + longDate(modDate) + c);
} else {
  html = html.replace(/(Published <time datetime="[^"]*">[^<]*<\/time>)/, (_m, a) => `${a} · Updated <time datetime="${modDate}">${longDate(modDate)}</time>`);
}

if (html === before) skip("바뀐 것 없음");
fs.writeFileSync(ART, html);
console.log(JSON.stringify({
  status: "ok", dataDate, fxDate: FX.date, rows: order.length, fresh: freshRows, msrp: msrpUsd != null,
}));
