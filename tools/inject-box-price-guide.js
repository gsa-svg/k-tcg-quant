#!/usr/bin/env node
// articles/one-piece-booster-box-price-guide.html 의 JP/EN 시세표와 그 아래 해설 두 문단을
// box-sold-series 에서 매일 다시 쓴다.
//
// 왜: 이 글은 AI 인용 77건(사이트 5위)인데 표가 손으로 박혀 있어 2026-07 값에서 멈춰 있었다.
//     섹션 제목은 "What boxes actually sell for right now" 인데 캡션은 2026-07 이었다.
//     실측 차이 예: OP-04 글 $115 → 실제 $175, OP-16 배수 글 1.7x → 실제 2.4x.
//
// 규칙
//  · 값은 각 시계열의 마지막 관측 중앙값(USD). 마지막 판매가 STALE_DAYS 를 넘으면 그 칸은 "—".
//  · 배수는 JP·EN 둘 다 신선할 때만 낸다. 한쪽이라도 비면 "—".
//  · 세트 이름은 기존 표에서 읽어 그대로 유지한다(데이터에 없는 정보라 새로 만들지 않는다).
//  · 해설 문단의 숫자(최저·최고 배수, 일본판 가격대, 표본 얇은 세트)도 전부 데이터에서 계산한다.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/one-piece-booster-box-price-guide.html");
const SERIES = path.join(ROOT, "data/box-sold-series.json");
const STALE_DAYS = 28;
const THIN_N = 6; // 표본이 이보다 적으면 "얇다"고 밝힌다
const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => { const [y, m, d] = iso.split("-").map(Number); return `${MONTH[m - 1]} ${d}, ${y}`; };
const usd = (v) => "$" + Math.round(v).toLocaleString("en-US");

if (!fs.existsSync(ART) || !fs.existsSync(SERIES)) {
  console.log(JSON.stringify({ status: "skip", reason: "file missing" }));
  process.exit(0);
}
const S = JSON.parse(fs.readFileSync(SERIES, "utf8")).sets || {};
let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

// 기존 표에서 코드 → 표시 이름
const names = {};
const order = [];
for (const m of html.matchAll(/<tr><td>((?:OP|EB|PRB)-\d{2})([^<]*)<\/td>/g)) {
  names[m[1]] = (m[1] + m[2]).replace(/\s+$/, "");
  order.push(m[1]);
}
if (!order.length) { console.log(JSON.stringify({ status: "skip", reason: "표 행을 못 찾음" })); process.exit(0); }

// 새 세트가 나오면 표에 자동으로 들어오게 한다(2026-09-29: OP-17 이 8월 출시인데 표가 7월에 멈춰 빠져 있었다).
// 이름은 packs.json 의 nameEn 을 쓰고, 없으면 코드만 쓴다 — 지어내지 않는다.
const ord = (c) => { const [m, n] = c.split("-"); return ({ OP: 1, EB: 2, PRB: 3 }[m] || 9) * 100 + Number(n); };
let PACKS = {};
try { const p = JSON.parse(fs.readFileSync(path.join(ROOT, "data/onepiece-packs.json"), "utf8")); PACKS = p.sets || p; } catch {}
for (const code of Object.keys(S)) {
  if (names[code]) continue;
  const a = (S[code] && (S[code].jp || [])).concat((S[code] && S[code].en) || []);
  if (!a.length) continue;                        // 관측이 아예 없으면 넣지 않는다
  const en = PACKS[code] && PACKS[code].nameEn;
  names[code] = en ? `${code} ${en}` : code;
  order.push(code);
}
order.sort((a, b) => ord(a) - ord(b));

let dataDate = "";
for (const c of Object.keys(S)) for (const ed of ["jp", "en"]) {
  const a = (S[c] && S[c][ed]) || [];
  if (a.length && a[a.length - 1].d > dataDate) dataDate = a[a.length - 1].d;
}
if (!dataDate) { console.log(JSON.stringify({ status: "skip", reason: "no series dates" })); process.exit(0); }
const now = Date.parse(dataDate);
const fresh = (c, ed) => {
  const a = (S[c] && S[c][ed]) || [];
  const l = a.length ? a[a.length - 1] : null;
  return l && Date.parse(l.d) >= now - STALE_DAYS * 86400000 ? l : null;
};

const rows = [];
const ratios = [];
const jpVals = [];
const thin = [];
let enNmin = Infinity, enNmax = 0;
for (const code of order) {
  const j = fresh(code, "jp"), e = fresh(code, "en");
  const r = j && e ? e.median / j.median : null;
  if (r) ratios.push({ code, r });
  if (j) { jpVals.push(j.median); if (j.n && j.n < THIN_N) thin.push(`${code} (${j.n})`); }
  if (e && e.n) { enNmin = Math.min(enNmin, e.n); enNmax = Math.max(enNmax, e.n); }
  rows.push(
    `          <tr><td>${names[code]}</td><td>${j ? usd(j.median) : "—"}</td><td>${e ? usd(e.median) : "—"}</td><td>${r ? r.toFixed(1) + "&times;" : "—"}</td></tr>`
  );
}
if (!ratios.length) { console.log(JSON.stringify({ status: "skip", reason: "신선한 쌍이 없다" })); process.exit(0); }

ratios.sort((a, b) => a.r - b.r);
const lo = ratios[0], hi = ratios[ratios.length - 1];
jpVals.sort((a, b) => a - b);
const jpLo = jpVals[0], jpHi = jpVals[jpVals.length - 1];
const band = jpVals.filter((v) => v <= 150).length;

// 표
const before = html;
html = html.replace(/<caption>[\s\S]*?<\/caption>/, () =>
  `<caption>Median sold price per sealed booster box, USD (completed eBay sales, as of ${longDate(dataDate)})</caption>`
);
html = html.replace(/(<tbody>)[\s\S]*?(<\/tbody>)/, () => nl(`<tbody>\n${rows.join("\n")}\n        </tbody>`));

// 해설 문단 1 — 배수와 일본판 가격대
const P1 = nl(
  `<p>Two patterns come out of this table. First, <strong>every English box with a recent sale trades above its Japanese counterpart</strong> — the premium runs from ${lo.r.toFixed(1)}&times; on ${lo.code} up to ${hi.r.toFixed(1)}&times; on ${hi.code}. The premium is smallest on sets still in print and widens as English stock dries up. Second, the Japanese side is cheaper and flatter than most buyers expect: of the ${jpVals.length} sets with a Japanese sale in the last ${STALE_DAYS} days, ${band} sit at ${usd(150)} or below, and the whole range is ${usd(jpLo)} to ${usd(jpHi)}. Sets with no completed sale in that window are left blank rather than carried forward.</p>`
);
html = html.replace(/<p>Two patterns[\s\S]*?<\/p>/, () => P1);

// 해설 문단 2 — 표본 깊이
const thinTxt = thin.length
  ? `A few Japanese medians are thin — ${thin.join(", ")} sales — and we would not anchor a purchase to those without checking the live tracker first.`
  : `No Japanese median in this table rests on fewer than ${THIN_N} sales.`;
const P2 = nl(
  `<p>Sample depth matters when you read this table. English medians rest on ${Number.isFinite(enNmin) ? `${enNmin}–${enNmax}` : "several"} sales per set in the latest week. ${thinTxt} Every figure here is a median of completed sales, not an asking price.</p>`
);
html = html.replace(/<p>Sample depth matters[\s\S]*?<\/p>/, () => P2);

html = html.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + dataDate + b);
// 화면 바이라인의 "Updated" 날짜도 dataDate 로 맞춘다 — JSON-LD dateModified 만 바꾸면 구글이 보는 두 날짜가 어긋난다(감사 SD2, 2026-09-29).
// 바이라인에 Updated 가 아예 없으면 Published 뒤에 한 번 넣는다.
if (/Updated <time datetime="/.test(html)) {
  html = html.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + dataDate + b + longDate(dataDate) + c);
} else {
  html = html.replace(/(Published <time datetime="[^"]*">[^<]*<\/time>)/, (_m, a) => `${a} · Updated <time datetime="${dataDate}">${longDate(dataDate)}</time>`);
}

if (html === before) { console.log(JSON.stringify({ status: "skip", reason: "바뀐 것 없음" })); process.exit(0); }
fs.writeFileSync(ART, html);
console.log(JSON.stringify({
  status: "ok", dataDate, rows: rows.length, pairs: ratios.length,
  lowest: `${lo.code} ${lo.r.toFixed(1)}x`, highest: `${hi.code} ${hi.r.toFixed(1)}x`, thin: thin.length,
}));
