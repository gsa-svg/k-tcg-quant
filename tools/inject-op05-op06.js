#!/usr/bin/env node
// articles/op-05-vs-op-06.html 의 비교표와 그 아래 숫자 문단 네 개를 데이터에서 매일 다시 쓴다.
//
// 왜: 표가 "(2026-07)" 캡션으로 손으로 박혀 멈춰 있었다.
//     2026-09-30 실측 차이 예: 일본판 OP-05 판매 중앙값 $211 → $174, PSA 모집단 68,854 → 77,969.
//
// 규칙 (tools/inject-box-price-guide.js 와 같다)
//  · 판매 중앙값은 data/box-sold-series.json 각 시계열의 마지막 관측(USD)과 그 n.
//  · 최저 매물은 packs.json boxMarket.<jp|en>.ebayActive.bestListing.total — 표 위 설명이 말하는
//    "cheapest verified active listing including shipping" 그 값이다(세트 페이지 구매 버튼,
//    market-data-normalizers 의 cheapestListing 과 같은 필드). ebayActive.low 는 15분위 값이라 "최저 매물"이 아니다.
//  · PSA 는 packs.json psaFull.total / psaFull.gemRate.
//  · 각 값의 출처 날짜(시계열 d · ebayActive.updated · psaFull.updated)가 기준일보다 STALE_DAYS 넘게 낡았으면 "—".
//    기준일 = 시계열 전체의 마지막 관측일과 위 출처 날짜들 중 가장 늦은 날(캡션·dateModified·바이라인에도 쓴다).
//  · 배수·퍼센트는 양쪽 다 신선할 때만. 값이 비면 그 문장은 숫자 없이 짧게 쓴다. 지어내지 않는다.
//  · 세트 이름은 packs.json nameEn, 없으면 코드만.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/op-05-vs-op-06.html");
const SERIES = path.join(ROOT, "data/box-sold-series.json");
const PACKS_FILE = path.join(ROOT, "data/onepiece-packs.json");
const STALE_DAYS = 28;
const [A, B] = ["OP-05", "OP-06"];
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");
// 매물가는 센트까지(정수면 센트 생략): $381.45, $1,000
const usdL = (v) => "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/\.00$/, "");
const int = (v) => Math.round(v).toLocaleString("en-US");
const sales = (n) => `${n} ${n === 1 ? "sale" : "sales"}`;
const DASH = "—";

const skip = (reason) => { console.log(JSON.stringify({ status: "skip", reason })); process.exit(0); };
if (!fs.existsSync(ART) || !fs.existsSync(SERIES) || !fs.existsSync(PACKS_FILE)) skip("file missing");
const S = JSON.parse(fs.readFileSync(SERIES, "utf8")).sets || {};
const packsRaw = JSON.parse(fs.readFileSync(PACKS_FILE, "utf8"));
const P = packsRaw.sets || packsRaw;
if (!P[A] || !P[B]) skip("packs.json 에 세트 없음");
let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

// 기준일
const lastObs = (c, ed) => { const a = (S[c] && S[c][ed]) || []; return a.length ? a[a.length - 1] : null; };
const active = (c, ed) => (P[c].boxMarket && P[c].boxMarket[ed] && P[c].boxMarket[ed].ebayActive) || null;
let dataDate = "";
const bump = (d) => { if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) && d > dataDate) dataDate = d; };
for (const c of Object.keys(S)) for (const ed of ["jp", "en"]) { const l = lastObs(c, ed); if (l) bump(l.d); }
for (const c of [A, B]) {
  for (const ed of ["jp", "en"]) { const m = active(c, ed); if (m) bump(m.updated); }
  if (P[c].psaFull) bump(P[c].psaFull.updated);
}
if (!dataDate) skip("no data dates");
const now = Date.parse(dataDate);
const isFresh = (d) => typeof d === "string" && Date.parse(d) >= now - STALE_DAYS * 86400000;

// 값 모으기 — 신선하지 않으면 null
const sold = (c, ed) => { const l = lastObs(c, ed); return l && isFresh(l.d) && l.median > 0 ? { v: l.median, n: l.n } : null; };
const listing = (c, ed) => {
  const m = active(c, ed);
  const bl = m && m.bestListing;
  return m && isFresh(m.updated) && bl && bl.currency === "USD" && bl.total > 0 ? bl.total : null;
};
const psa = (c) => {
  const f = P[c].psaFull;
  if (!f || !isFresh(f.updated)) return null;
  return { total: f.total > 0 ? f.total : null, gem: Number.isFinite(f.gemRate) ? f.gemRate : null };
};
const V = {};
for (const c of [A, B]) {
  V[c] = {
    name: P[c].nameEn ? `${c} ${P[c].nameEn}` : c,
    release: typeof P[c].release === "string" && /^\d{4}-\d{2}-\d{2}$/.test(P[c].release) ? P[c].release : null,
    jpSold: sold(c, "jp"), enSold: sold(c, "en"),
    jpList: listing(c, "jp"), enList: listing(c, "en"),
    psa: psa(c),
  };
}
const anyFresh = [A, B].some((c) => V[c].jpSold || V[c].enSold || V[c].jpList || V[c].enList || (V[c].psa && V[c].psa.total));
if (!anyFresh) skip("신선한 값이 하나도 없다");

// 표
const soldCell = (s) => (s ? `${usd(s.v)}${s.n ? ` <small>(${sales(s.n)})</small>` : ""}` : DASH);
const row = (label, f) => `          <tr><td>${label}</td><td>${f(V[A])}</td><td>${f(V[B])}</td></tr>`;
const rows = [
  row("Release", (x) => x.release || DASH),
  row("Japanese box &mdash; sold median", (x) => soldCell(x.jpSold)),
  row("Japanese box &mdash; lowest listing", (x) => (x.jpList != null ? usdL(x.jpList) : DASH)),
  row("English box &mdash; sold median", (x) => soldCell(x.enSold)),
  row("English box &mdash; lowest listing", (x) => (x.enList != null ? usdL(x.enList) : DASH)),
  row("PSA population", (x) => (x.psa && x.psa.total ? int(x.psa.total) : DASH)),
  row("PSA gem rate", (x) => (x.psa && x.psa.gem != null ? `${x.psa.gem.toFixed(1)}%` : DASH)),
];
const TABLE = nl(
  `<table>\n        <caption>${A} vs ${B} booster box, tracked market data (${dataDate})</caption>\n` +
  `        <thead><tr><th>Metric</th><th>${V[A].name}</th><th>${V[B].name}</th></tr></thead>\n` +
  `        <tbody>\n${rows.join("\n")}\n        </tbody>\n      </table>`
);

// 문단 1 — 판매 중앙값 배수
const ratioOf = (a, b) => (Math.max(a, b) / Math.min(a, b)).toFixed(1);
const noMedian = (ed) => (x) => !(ed === "jp" ? V[x].jpSold : V[x].enSold);
const who = (list) => `${list.join(" and ")} ${list.length > 1 ? "have" : "has"}`;
let gap = false;
let p1;
{
  const a = V[A].jpSold, b = V[B].jpSold;
  if (a && b) {
    const r = ratioOf(a.v, b.v);
    if (r === "1.0") p1 = `<strong>${A} and ${B} sell at about the same price on the Japanese side</strong> (${usd(a.v)} vs ${usd(b.v)} sold).`;
    else {
      gap = true;
      const [H, L] = a.v >= b.v ? [[A, a], [B, b]] : [[B, b], [A, a]];
      p1 = `<strong>${H[0]} is roughly ${r}&times; the price of ${L[0]} on the Japanese side</strong> (${usd(H[1].v)} vs ${usd(L[1].v)} sold).`;
    }
  } else p1 = `There is no current Japanese price ratio: ${who([A, B].filter(noMedian("jp")))} no current Japanese sold median.`;
}
{
  const a = V[A].enSold, b = V[B].enSold;
  if (a && b) {
    const r = ratioOf(a.v, b.v);
    if (r !== "1.0") gap = true;
    p1 += ` In the English sample, ${A} is <strong>${usd(a.v)} against ${B}'s ${usd(b.v)}, ${r === "1.0" ? "about the same price" : `a ${r}&times; difference`}</strong>.`;
  } else p1 += ` There is no current English price ratio: ${who([A, B].filter(noMedian("en")))} no current English sold median.`;
}
if (gap) p1 += " The table establishes the gap, but public data does not isolate print volume, reprint timing or buyer demand as its cause.";

// 문단 2 — 일본판 최저 매물 vs 판매 중앙값
const cmp = (list, s) => {
  const pct = Math.round(Math.abs(list / s - 1) * 100);
  return { pct, dir: list < s ? "below" : "above" };
};
let mismatch = false;
let p2;
{
  const l = V[A].jpList, s = V[A].jpSold;
  if (l != null && s) {
    const { pct, dir } = cmp(l, s.v);
    if (pct) mismatch = true;
    p2 = `${A}'s cheapest verified Japanese listing is <strong>${usdL(l)} &mdash; ${pct ? `about ${pct}% ${dir}` : "in line with"} its ${usd(s.v)} sold median</strong>`;
  } else if (l != null) p2 = `${A}'s cheapest verified Japanese listing is <strong>${usdL(l)}</strong>, with no current sold median to compare against`;
  else if (s) p2 = `${A} has no current verified Japanese listing`;
  else p2 = `${A} has neither a current verified Japanese listing nor a sold median`;
}
{
  const l = V[B].jpList, s = V[B].jpSold;
  if (l != null && s) {
    const { pct, dir } = cmp(l, s.v);
    if (pct) mismatch = true;
    p2 += `, while ${B}'s cheapest listing at ${usdL(l)} sits <strong>${pct ? `${pct}% ${dir}` : "in line with"}</strong> its ${usd(s.v)} sold median.`;
  } else if (l != null) p2 += `, while ${B}'s cheapest listing at ${usdL(l)} has no current sold median to compare against.`;
  else if (s) p2 += `, while ${B} has no current verified Japanese listing.`;
  else p2 += `, while ${B} has neither a current verified Japanese listing nor a sold median.`;
}
if (mismatch) p2 += " That mismatch is a reason to inspect listing condition, seller location, shipping and sale dates rather than assume either figure is automatically the current transaction price.";

// 문단 3 — PSA 모집단·10 비율
const METHOD = `See the limits in our <a href="psa-population-and-prices.html">population methodology</a>.`;
let p3;
{
  const ta = V[A].psa && V[A].psa.total, tb = V[B].psa && V[B].psa.total;
  const parts = [];
  if (ta && tb) parts.push(`PSA records <strong>${int(ta)} ${A} grades versus ${int(tb)} ${B} grades</strong>. The difference can reflect time in market, submission selection and collector demand. It does not reveal how many boxes were opened.`);
  else if (ta || tb) {
    const [F, t, M] = ta ? [A, ta, B] : [B, tb, A];
    parts.push(`PSA records <strong>${int(t)} ${F} grades</strong>; ${M} has no current population figure. The count does not reveal how many boxes were opened.`);
  } else parts.push("Neither set has a current PSA population figure.");
  const gems = [A, B].filter((c) => V[c].psa && V[c].psa.gem != null).map((c) => `${V[c].psa.gem.toFixed(1)}% for ${c}`);
  if (gems.length) parts.push(`Gem rate is also sample-specific: ${gems.join(" and ")} among the recorded submissions.`);
  parts.push(METHOD);
  p3 = parts.join(" ");
}

// 문단 4 — 표본 크기
let p4 = "<strong>Sample-size caveat:</strong> ";
{
  const a = V[A].jpSold, b = V[B].jpSold;
  if (a && b && a.n && b.n) {
    if (a.n === b.n) p4 += `both Japanese sold medians rest on <strong>${sales(a.n)}</strong> each.`;
    else {
      const [T, O] = a.n < b.n ? [[A, a], [B, b]] : [[B, b], [A, a]];
      p4 += `${T[0]}'s Japanese sold median rests on only <strong>${T[1].n} completed ${T[1].n === 1 ? "sale" : "sales"}</strong> versus ${O[1].n} for ${O[0]}. One unusual transaction therefore has more influence on ${T[0]}.`;
    }
  } else if ((a && a.n) || (b && b.n)) {
    const [F, x, M] = a && a.n ? [A, a, B] : [B, b, A];
    p4 += `${F}'s Japanese sold median rests on <strong>${x.n} completed ${x.n === 1 ? "sale" : "sales"}</strong>, and ${M} has no current Japanese sold median.`;
  } else p4 += "neither set has a current Japanese sold median.";
  const ea = V[A].enSold, eb = V[B].enSold;
  if (ea && eb && ea.n && eb.n) p4 += ` The English samples contain ${ea.n} and ${eb.n} sales.`;
  else if ((ea && ea.n) || (eb && eb.n)) {
    const [F, x] = ea && ea.n ? [A, ea] : [B, eb];
    p4 += ` The English sample for ${F} contains ${sales(x.n)}.`;
  }
}

const before = html;
if (!/<table>[\s\S]*?<\/table>/.test(html)) skip("표를 못 찾음");
html = html.replace(/<table>[\s\S]*?<\/table>/, () => TABLE);
const SEC = /(<h2>What the dated snapshot shows<\/h2>)[\s\S]*?(<h2>How to compare them properly<\/h2>)/;
if (!SEC.test(html)) skip("해설 구간을 못 찾음");
html = html.replace(SEC, (_m, h, end) =>
  h + nl(`\n      <p>${p1}</p>\n      <p>${p2}</p>\n      <p>${p3}</p>\n      <p>${p4}</p>\n\n      `) + end
);
// 도입 문단의 발매일도 표와 같은 값으로
for (const c of [A, B]) {
  if (!V[c].release) continue;
  const re = new RegExp(`(<strong>${c} [^<]*<\\/strong> \\(released )\\d{4}-\\d{2}-\\d{2}(\\))`);
  html = html.replace(re, (_m, a, b) => a + V[c].release + b);
}
html = html.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + dataDate + b);
if (/Updated <time datetime="/.test(html)) {
  html = html.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + dataDate + b + longDate(dataDate) + c);
} else {
  html = html.replace(/(Published <time datetime="[^"]*">[^<]*<\/time>)/, (_m, a) => `${a} · Updated <time datetime="${dataDate}">${longDate(dataDate)}</time>`);
}

if (html === before) skip("바뀐 것 없음");
fs.writeFileSync(ART, html);
const brief = (s) => (s ? `${s.v}/${s.n}` : null);
console.log(JSON.stringify({
  status: "ok", dataDate,
  jpSold: [brief(V[A].jpSold), brief(V[B].jpSold)], enSold: [brief(V[A].enSold), brief(V[B].enSold)],
  jpList: [V[A].jpList, V[B].jpList], enList: [V[A].enList, V[B].enList],
  psa: [V[A].psa && V[A].psa.total, V[B].psa && V[B].psa.total],
}));
