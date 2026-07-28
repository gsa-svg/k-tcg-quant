#!/usr/bin/env node
// TAG 만점 세분화 적재 (10 / 10P 분리) — 2026-07-28.
//
// 왜: 기존 tag-pop-ingest 는 10 과 10P 를 gem 하나로 합쳐 담았다. 그런데 TAG 는 둘을
// 다른 등급으로 매긴다 — 10P(퍼펙트)는 전체의 2.7% 뿐이다. 합쳐 놓으면 CGC 의
// Pristine/Gem Mint 구분과 나란히 놓을 수가 없다.
//
// 입력: { grader:"tag", collectedAt, boxes:{ "OP-13":{jp:{total,g10,g10p}, en:{...} } } }
// 출력: data/tag-grading-history.json 의 각 점에 g10 / g10p 를 덧붙인다.
//
// 원칙:
//  - append-only. 같은 날짜 점이 있으면 total 이 일치할 때만 세분값을 채운다.
//    total 이 다르면 상류가 움직인 것이므로 손대지 않고 사유를 남긴다.
//  - g10 + g10p 가 total 을 넘으면 그 항목은 버린다(있을 수 없는 값).
//  - 기존 gem 필드는 건드리지 않는다(과거 값 보존).
// Run: node tools/tag-pop-split-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HIST = path.join(ROOT, "data", "tag-grading-history.json");

const file = process.argv[2];
if (!file) { console.error("사용: node tools/tag-pop-split-ingest.js <dump.json>"); process.exit(1); }
const dump = JSON.parse(fs.readFileSync(file, "utf8"));
if (dump.grader !== "tag") { console.error("grader 가 tag 가 아님"); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(dump.collectedAt || "")) { console.error("collectedAt 필요"); process.exit(1); }

const hist = JSON.parse(fs.readFileSync(HIST, "utf8"));
const skipped = [];
let filled = 0, added = 0;

for (const [code, eds] of Object.entries(dump.boxes || {})) {
  for (const ed of ["jp", "en"]) {
    const v = eds?.[ed];
    if (!v) continue;
    const { total, g10, g10p } = v;
    if (!Number.isInteger(total) || total <= 0) { skipped.push(`${code}/${ed}: total 이상`); continue; }
    if (!Number.isInteger(g10) || !Number.isInteger(g10p) || g10 < 0 || g10p < 0 || g10 + g10p > total) {
      skipped.push(`${code}/${ed}: 10(${g10})+10P(${g10p}) 가 total(${total}) 을 넘음`); continue;
    }
    const set = (hist.sets[code] ||= { jp: [], en: [] });
    const arr = (set[ed] ||= []);
    const pt = arr.find((p) => p.d === dump.collectedAt);
    if (pt) {
      if (pt.total !== total) { skipped.push(`${code}/${ed}: 보관 total ${pt.total} ≠ 현재 ${total}`); continue; }
      pt.g10 = g10; pt.g10p = g10p;
      filled += 1;
    } else {
      arr.push({ d: dump.collectedAt, total, gem: g10 + g10p, g10, g10p });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      added += 1;
    }
  }
}

if (!filled && !added) { console.error(JSON.stringify({ status: "nothing", skipped: skipped.slice(0, 20) }, null, 2)); process.exit(1); }
hist.splitThrough = dump.collectedAt;
hist.note = `${hist.note || ""} 2026-07-28: 만점을 10 / 10P 로 분리 보관(합산값 gem 은 그대로 유지).`.trim();
fs.writeFileSync(HIST, `${JSON.stringify(hist, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", filled, added, skipped: skipped.length, skippedSample: skipped.slice(0, 6) }));
