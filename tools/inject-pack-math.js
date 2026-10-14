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
//  · 박스 시세는 box-sold-series 의 current.jp(USD) — 발매됐고 마지막 점이 asOf 로부터 28일 이내일 때만 값, 아니면 "—".
//    미발매 세트(OP-18·EB-05)의 예약판매는 시계열에 없다 — 2026-10-14 전엔 여기 "Box sold" 칸에 $110·$132 로 섞여 있었다.
//  · 정가는 set-facts.json 의 jpMsrpYen / packsPerBox. 둘 중 하나라도 없으면 그 행의 정가 열은 "—".
//    단 팩당 정가(jpMsrpYenPerPack)가 공식 페이지로 확인된 세트는 박스 구성이 미공개여도 팩당 칸만 채운다
//    (OP-18·EB-05: 반다이 JP 페이지에 240円·6장은 있고 박스당 팩 수는 없다 — 2026-09-30).
//  · 세트 코드는 sets/<code>.html 이 있을 때만 링크한다.
//  · 엔 → USD 는 data/fx.json 의 jpyKrw / usdKrw (사이트 공통 방식), 환율과 날짜를 표에 적는다.
//  · 값을 만들어내지 않는다. 데이터가 없으면 비운다.
"use strict";
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const ART = path.join(ROOT, "articles/how-many-packs-one-piece-booster-box.html");
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

let FX, FACTS, SERIES, STORE;
try {
  FX = readJson("data/fx.json");
  const f = readJson("data/set-facts.json");
  FACTS = f.sets || f;
  STORE = readJson("data/box-sold-series.json");
  SERIES = STORE.sets || {};
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

// 데이터 기준일 — 시계열 전체의 마지막 관측일(build-box-sold-series.js asOf, 다른 표들과 같은 기준)
const dataDate = STORE.asOf || "";
const STALE_DAYS = STORE.staleDays || 28;
if (!dataDate) {
  console.log(JSON.stringify({ status: "skip", reason: "no series dates" }));
  process.exit(0);
}

const rows = [];
const starSets = Object.keys(FACTS).filter((c) => FACTS[c].boxConfig && FACTS[c].boxConfig.stated === false && FACTS[c].jpMsrpYen);
let liveCount = 0, cheapest = null, dearest = null;
for (const code of Object.keys(FACTS).sort((a, b) => ord(a) - ord(b))) {
  const f = FACTS[code];
  const packs = f.packsPerBox;
  const msrpBox = f.jpMsrpYen;
  const cur = (SERIES[code] && SERIES[code].current && SERIES[code].current.jp) || null;

  const msrpPack = f.jpMsrpYenPerPack || (msrpBox && packs ? msrpBox / packs : null);
  const boxUsd = cur ? cur.median : null;
  const packUsd = boxUsd && packs ? boxUsd / packs : null;
  const mult = packUsd && msrpPack ? packUsd / jpyUsd(msrpPack) : null;

  if (mult) {
    liveCount++;
    if (!cheapest || mult < cheapest.mult) cheapest = { code, mult, packUsd };
    if (!dearest || mult > dearest.mult) dearest = { code, mult, packUsd };
  }

  const slug = code.toLowerCase();
  const setCell = fs.existsSync(path.join(ROOT, "sets", slug + ".html"))
    ? `<a href="/sets/${slug}.html">${esc(code)}</a>`
    : esc(code);
  rows.push(
    `          <tr><td>${setCell}</td>` +
      `<td class="num">${packs || "—"}</td>` +
      `<td class="num">${msrpPack ? "¥" + Math.round(msrpPack) : "—"}</td>` +
      `<td class="num">${msrpBox ? "¥" + msrpBox.toLocaleString("en-US") + (f.boxConfig && f.boxConfig.stated === false ? "*" : "") : "—"}</td>` +
      `<td class="num">${boxUsd ? "$" + Math.round(boxUsd).toLocaleString("en-US") : "—"}</td>` +
      `<td class="num">${packUsd ? "$" + packUsd.toFixed(2) : "—"}</td>` +
      `<td class="num">${mult ? mult.toFixed(1) + "×" : "—"}</td></tr>`
  );
}

const lead =
  `Japanese retail is fixed per pack, so every box has a printed baseline you can measure the market against. ` +
  `The table below puts Bandai's Japanese MSRP next to what a sealed box actually sold for, per set and per pack. ` +
  (liveCount
    ? `Across the ${liveCount} sets with a sold median dated within the last ${STALE_DAYS} days, the widest gap is ` +
      `<strong>${esc(dearest.code)}</strong> at ${dearest.mult.toFixed(1)}× Japanese retail per pack ($${dearest.packUsd.toFixed(2)}), ` +
      `and the narrowest is <strong>${esc(cheapest.code)}</strong> at ${cheapest.mult.toFixed(1)}× ($${cheapest.packUsd.toFixed(2)}). `
    : "") +
  // 2026-10-14 QA: "no completed sale in the last 28 days" 는 사실과 달랐다(발매된 세트는 전부 28일 안에 판매가 있다). "—" 의 실제 규칙을 쓴다.
  `Sets without a sold median dated within ${STALE_DAYS} days (a median needs at least 6 sales in its 28–56-day window) are left blank rather than carried forward.`;

const table =
  `<div class="tblWrap" data-pack-math><table class="dataTable">\n` +
  `        <thead><tr><th>Set</th><th class="num">Packs</th><th class="num">MSRP / pack</th><th class="num">MSRP / box</th><th class="num">Box sold</th><th class="num">Per pack</th><th class="num">vs MSRP</th></tr></thead>\n` +
  `        <tbody>\n${rows.join("\n")}\n        </tbody>\n` +
  `      </table></div>\n` +
  `      <p class="srcNoteA" data-pack-math-note>MSRP is Bandai's Japanese manufacturer price, tax included${starSets.length ? ` (* ${starSets.join(", ")}: Bandai's page gives the pack price only — the box figure is ${starSets.length > 1 ? "their" : "its"} pack price × 24, the standard box)` : ""}. “Box sold” is the latest rolling median of completed eBay sales for the sealed Japanese box (data as of ${longDate(dataDate)}; each median is dated within ${STALE_DAYS} days); “per pack” divides that by the pack count in the same row. Yen converted at ¥1 = $${rate.toFixed(5)} (${longDate(FX.date)}). A multiple above 1× is what an overseas buyer pays over Japanese shelf price, including the seller's shipping and margin — it is not a measure of card value.</p>`;

let html = fs.readFileSync(ART, "utf8");
const crlf = html.includes("\r\n");
const nl = (s) => (crlf ? s.replace(/\n/g, "\r\n") : s);

const leadRe = /<p data-pack-math-lead>[\s\S]*?<\/p>/;
const tableRe = /<div class="tblWrap" data-pack-math>[\s\S]*?<p class="srcNoteA" data-pack-math-note>[\s\S]*?<\/p>/;

let wrote = [];
{
  const newest = Object.keys(FACTS).filter((c) => /^OP-\d+$/.test(c) && FACTS[c].jpRelease && FACTS[c].jpRelease.date && FACTS[c].jpRelease.date <= dataDate)
    .sort((a, b) => FACTS[a].jpRelease.date.localeCompare(FACTS[b].jpRelease.date)).pop();
  const nf = newest ? FACTS[newest] : null;
  const nameEn = (() => { try { return (JSON.parse(fs.readFileSync(path.join(ROOT, "data/onepiece-packs.json"), "utf8")).sets[newest] || {}).nameEn || ""; } catch { return ""; } })();
  const yen = (v) => "¥" + Number(v).toLocaleString("en-US");
  let jpLi = "";
  if (nf && nf.jpMsrpYenPerPack) {
    const packs = nf.packsPerBox || 24;
    const boxYen = nf.jpMsrpYen || nf.jpMsrpYenPerPack * packs;
    const stated = !(nf.boxConfig && nf.boxConfig.stated === false) && nf.jpMsrpYen;
    const src = (nf.jpSpecSource && nf.jpSpecSource.source) || (nf.jpRelease && nf.jpRelease.source);
    jpLi = `<li><strong>Japanese booster pack:</strong> 6 cards per pack (Bandai official). A 24-pack box holds <strong>144 cards</strong>. For the newest set, ${esc(newest)}${nameEn ? ` ${esc(nameEn)}` : ""}, <a href="${esc(src)}" rel="noopener noreferrer" target="_blank">Bandai lists</a> an MSRP of <strong>${yen(nf.jpMsrpYenPerPack)} per pack</strong> (tax included)${stated ? ` — <strong>${yen(boxYen)} per box</strong>` : `; its page states no box configuration — at the standard ${packs} packs that is <strong>${yen(boxYen)}</strong>`}, about <strong>$${jpyUsd(boxYen).toFixed(2)}</strong> at ¥1 = $${rate.toFixed(5)} (${longDate(FX.date)}). Earlier sets launched at lower pack prices, so check the official product page for a specific set's original MSRP.</li>`;
  }
  const enFacts = Object.keys(FACTS).filter((c) => FACTS[c].enPackContents).sort((a, b) => ord(a) - ord(b));
  const enBits = enFacts.map((c) => { const e = FACTS[c].enPackContents; return e.cardsPerPack ? `the <a href="${esc(e.source)}" rel="noopener noreferrer" target="_blank">${esc(c)}</a> page lists <strong>${e.cardsPerPack} cards per pack</strong>` : `the <a href="${esc(e.source)}" rel="noopener noreferrer" target="_blank">${esc(c)}</a> page states no per-pack card count`; });
  const enOn = enFacts.map((c) => FACTS[c].enPackContents.verifiedOn).filter(Boolean).sort().pop();
  const enLi = `<li><strong>English booster pack:</strong> Bandai's US site lists current English boosters at <strong>USD $4.99 MSRP per pack</strong> — about <strong>$119.76 per 24-pack box</strong>.${enBits.length ? ` On Bandai's English product pages, ${enBits.join("; ")}${enOn ? ` (checked ${longDate(enOn)})` : ""}; the English main-set pages give no per-pack card count.` : ""}</li>`;
  const block = `<!-- PACK-FACTS:START -->\n        ${jpLi}\n        ${enLi}\n        <!-- PACK-FACTS:END -->`;
  const reBlock = /<!-- PACK-FACTS:START -->[\s\S]*?<!-- PACK-FACTS:END -->/;
  const reOld = /<li><strong>Japanese booster pack:<\/strong>[\s\S]*?<\/li>\s*<li><strong>English booster pack:<\/strong>[\s\S]*?<\/li>/;
  if (jpLi && reBlock.test(html)) { html = html.replace(reBlock, () => nl(block)); wrote.push("pack-facts"); }
  else if (jpLi && reOld.test(html)) { html = html.replace(reOld, () => nl(block)); wrote.push("pack-facts"); }
}
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
// 제목·표 머리 — 2026-10-14(W6a). "one piece booster box msrp" 질의(AI 점유 33%)는 일반검색 10위 밖이었다. 1위 질의
// "how many packs …" 문구는 제목 앞에 그대로 두고 뒤에 "MSRP by Set" 을 붙인다(60자 이하). 표 바로 위 H2 에 질의 문구를 그대로.
// 손 HTML 이라 여기서 매번 맞춘다(몇 번 돌려도 같다).
const TITLE = "How Many Packs in a One Piece Booster Box? MSRP by Set";
const H2 = `<h2 id="msrp-by-set">One Piece Booster Box MSRP by Set — retail vs market price</h2>`;
html = html.replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`);
html = html.replace(/(<meta property="og:title" content=")[^"]*(")/, (_m, a, b) => a + TITLE + b);
html = html.replace(/<h2[^>]*>[^<]*<\/h2>(\s*<p data-pack-math-lead>)/, (_m, rest) => H2 + rest);
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
