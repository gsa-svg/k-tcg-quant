#!/usr/bin/env node
// articles/how-many-packs-one-piece-booster-box.html 의 세트별 "정가 대 시세" 표를 데이터에서 매일 다시 쓴다.
//
// 왜: 이 글은 빙 평균 2.19위 · AI 인용 466건으로 사이트 최고 순위인데 노출이 16건뿐이다.
//     다루는 질문이 "박스에 팩이 몇 개" 하나뿐이라서다. 빙 검색어에는 세트별 정가·팩당 가격을
//     묻는 질의가 여럿 있다(one piece booster box msrp · op-16 japanese booster box msrp yen ·
//     op11/op09 japanese pack price per pack 등). 팩당 실거래가는 박스 실낙찰가와 팩 수를
//     둘 다 가진 곳만 낼 수 있다.
//
// 규칙
//  · 박스 시세는 JP 시계열의 마지막 관측 중앙값(USD). 마지막 판매가 28일을 넘으면 시장 열은 "—".
//  · 정가는 set-facts.json 의 jpMsrpYen / packsPerBox. 둘 중 하나라도 없으면 그 행의 정가 열은 "—".
//  · 엔 → USD 는 data/fx.json 의 jpyKrw / usdKrw (사이트 공통 방식), 환율과 날짜를 표에 적는다.
//  · 값을 만들어내지 않는다. 데이터가 없으면 비운다.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/how-many-packs-one-piece-booster-box.html");
const STALE_DAYS = 28;
const MONTH_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const longDate = (iso) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTH_LONG[m - 1]} ${d}, ${y}`;
};
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));

if (!fs.existsSync(ART)) {
  console.log(JSON.stringify({ status: "skip", reason: "article missing" }));
  process.exit(0);
}

let FX, FACTS, SERIES;
try {
  FX = readJson("data/fx.json");
  const f = readJson("data/set-facts.json");
  FACTS = f.sets || f;
  SERIES = readJson("data/box-sold-series.json").sets || {};
} catch (e) {
  console.log(JSON.stringify({ status: "skip", reason: "data missing: " + e.message }));
  process.exit(0);
}
if (!FX.jpyKrw || !FX.usdKrw) {
  console.log(JSON.stringify({ status: "skip", reason: "fx incomplete" }));
  process.exit(0);
}
const jpyUsd = (yen) => (yen * FX.jpyKrw) / FX.usdKrw;
const rate = jpyUsd(1);

const ord = (c) => {
  const [m, n] = c.split("-");
  return ({ OP: 1, EB: 2, PRB: 3 }[m] || 9) * 1000 + Number(n);
};

// 데이터 기준일
let dataDate = "";
for (const code of Object.keys(SERIES)) {
  const jp = (SERIES[code] && SERIES[code].jp) || [];
  if (jp.length && jp[jp.length - 1].d > dataDate) dataDate = jp[jp.length - 1].d;
}
if (!dataDate) {
  console.log(JSON.stringify({ status: "skip", reason: "no series dates" }));
  process.exit(0);
}
const now = Date.parse(dataDate);

const rows = [];
let liveCount = 0, cheapest = null, dearest = null;
for (const code of Object.keys(FACTS).sort((a, b) => ord(a) - ord(b))) {
  const f = FACTS[code];
  const packs = f.packsPerBox;
  const msrpBox = f.jpMsrpYen;
  const jp = (SERIES[code] && SERIES[code].jp) || [];
  const last = jp.length ? jp[jp.length - 1] : null;
  const fresh = last && Date.parse(last.d) >= now - STALE_DAYS * 86400000;

  const msrpPack = msrpBox && packs ? msrpBox / packs : null;
  const boxUsd = fresh ? last.median : null;
  const packUsd = boxUsd && packs ? boxUsd / packs : null;
  const mult = packUsd && msrpPack ? packUsd / jpyUsd(msrpPack) : null;

  if (mult) {
    liveCount++;
    if (!cheapest || mult < cheapest.mult) cheapest = { code, mult, packUsd };
    if (!dearest || mult > dearest.mult) dearest = { code, mult, packUsd };
  }

  rows.push(
    `          <tr><td>${esc(code)}</td>` +
      `<td class="num">${packs || "—"}</td>` +
      `<td class="num">${msrpPack ? "¥" + Math.round(msrpPack) : "—"}</td>` +
      `<td class="num">${msrpBox ? "¥" + msrpBox.toLocaleString("en-US") : "—"}</td>` +
      `<td class="num">${boxUsd ? "$" + Math.round(boxUsd).toLocaleString("en-US") : "—"}</td>` +
      `<td class="num">${packUsd ? "$" + packUsd.toFixed(2) : "—"}</td>` +
      `<td class="num">${mult ? mult.toFixed(1) + "×" : "—"}</td></tr>`
  );
}

const lead =
  `Japanese retail is fixed per pack, so every box has a printed baseline you can measure the market against. ` +
  `The table below puts Bandai's Japanese MSRP next to what a sealed box actually sold for, per set and per pack. ` +
  (liveCount
    ? `Across the ${liveCount} sets with a completed sale in the last ${STALE_DAYS} days, the widest gap is ` +
      `<strong>${esc(dearest.code)}</strong> at ${dearest.mult.toFixed(1)}× Japanese retail per pack ($${dearest.packUsd.toFixed(2)}), ` +
      `and the narrowest is <strong>${esc(cheapest.code)}</strong> at ${cheapest.mult.toFixed(1)}× ($${cheapest.packUsd.toFixed(2)}). `
    : "") +
  `Sets with no completed sale in the last ${STALE_DAYS} days are left blank rather than carried forward.`;

const table =
  `<div class="tblWrap" data-pack-math><table class="dataTable">\n` +
  `        <thead><tr><th>Set</th><th class="num">Packs</th><th class="num">MSRP / pack</th><th class="num">MSRP / box</th><th class="num">Box sold</th><th class="num">Per pack</th><th class="num">vs MSRP</th></tr></thead>\n` +
  `        <tbody>\n${rows.join("\n")}\n        </tbody>\n` +
  `      </table></div>\n` +
  `      <p class="srcNoteA" data-pack-math-note>MSRP is Bandai's Japanese manufacturer price, tax included. “Box sold” is the median of completed eBay sales for the sealed Japanese box, as of ${longDate(dataDate)}; “per pack” divides that by the pack count in the same row. Yen converted at ¥1 = $${rate.toFixed(5)} (${longDate(FX.date)}). A multiple above 1× is what an overseas buyer pays over Japanese shelf price, including the seller's shipping and margin — it is not a measure of card value.</p>`;

let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

const leadRe = /<p data-pack-math-lead>[\s\S]*?<\/p>/;
const tableRe = /<div class="tblWrap" data-pack-math>[\s\S]*?<p class="srcNoteA" data-pack-math-note>[\s\S]*?<\/p>/;

let wrote = [];
if (leadRe.test(html)) {
  html = html.replace(leadRe, () => nl(`<p data-pack-math-lead>${lead}</p>`));
  wrote.push("lead");
}
if (tableRe.test(html)) {
  html = html.replace(tableRe, () => nl(table));
  wrote.push("table");
}
if (!wrote.length) {
  console.log(JSON.stringify({ status: "skip", reason: "markers not found" }));
  process.exit(0);
}
html = html.replace(/("dateModified": ")[^"]*(")/, (_m, a, b) => a + dataDate + b);
// 화면 바이라인의 "Updated" 날짜도 dataDate 로 맞춘다 — JSON-LD dateModified 만 바꾸면 구글이 보는 두 날짜가 어긋난다(감사 SD2, 2026-09-29).
// 바이라인에 Updated 가 아예 없으면 Published 뒤에 한 번 넣는다.
if (/Updated <time datetime="/.test(html)) {
  html = html.replace(/(Updated <time datetime=")[^"]*(">)[^<]*(<\/time>)/, (_m, a, b, c) => a + dataDate + b + longDate(dataDate) + c);
} else {
  html = html.replace(/(Published <time datetime="[^"]*">[^<]*<\/time>)/, (_m, a) => `${a} · Updated <time datetime="${dataDate}">${longDate(dataDate)}</time>`);
}
fs.writeFileSync(ART, html);
console.log(JSON.stringify({ status: "ok", dataDate, rows: rows.length, live: liveCount, wrote }));
