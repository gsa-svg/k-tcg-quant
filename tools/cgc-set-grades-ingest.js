#!/usr/bin/env node
// CGC 세트별 등급분포 적재 — 2026-07-27.
//
// 입력: { grader:"cgc", collectedAt:"YYYY-MM-DD", sets:{ "OP-13|en":{total, grades:{...}, pages}, ... } }
//   grades 는 CGC 등급표 열 이름 그대로("Pristine 10","Gem Mint 10","Mint+ 9.5","9",...).
// 출력: data/cgc-grading-history.json 의 각 점에 grades 를 덧붙인다(기존 total 은 그대로).
//
// 원칙:
//  - append-only. 같은 날짜 점이 있으면 total 이 일치할 때만 grades 를 채워 넣는다.
//    total 이 다르면 상류가 바뀐 것이므로 건드리지 않고 사유를 남긴다.
//  - grades 합이 total 과 다르면 페이지 일부만 읽힌 것 → 그 세트는 버린다(추정 금지).
// Run: node tools/cgc-set-grades-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const HIST = path.join(ROOT, "data", "cgc-grading-history.json");

const file = process.argv[2];
if (!file) { console.error("사용: node tools/cgc-set-grades-ingest.js <dump.json>"); process.exit(1); }
const dump = JSON.parse(fs.readFileSync(file, "utf8"));
if (dump.grader !== "cgc") { console.error("grader 가 cgc 가 아님"); process.exit(1); }
if (!/^\d{4}-\d{2}-\d{2}$/.test(dump.collectedAt || "")) { console.error("collectedAt 필요"); process.exit(1); }

const hist = JSON.parse(fs.readFileSync(HIST, "utf8"));
const skipped = [];
let filled = 0, added = 0;

for (const [key, v] of Object.entries(dump.sets || {})) {
  const [code, ed] = key.split("|");
  if (!code || !["jp", "en"].includes(ed)) { skipped.push(`${key}: 키 형식`); continue; }
  const grades = v?.grades || {};
  const sum = Object.values(grades).reduce((a, b) => a + b, 0);
  if (!Number.isInteger(v?.total) || v.total <= 0) { skipped.push(`${key}: total 이상`); continue; }
  if (sum !== v.total) { skipped.push(`${key}: 등급합 ${sum} ≠ total ${v.total} (페이지 누락)`); continue; }

  const set = (hist.sets[code] ||= { jp: [], en: [] });
  const arr = (set[ed] ||= []);
  const pt = arr.find((p) => p.d === dump.collectedAt);
  if (pt) {
    if (pt.total !== v.total) { skipped.push(`${key}: 보관 total ${pt.total} ≠ 현재 ${v.total}`); continue; }
    pt.grades = grades;
    filled += 1;
  } else {
    arr.push({ d: dump.collectedAt, total: v.total, grades });
    arr.sort((a, b) => a.d.localeCompare(b.d));
    added += 1;
  }
}

if (!filled && !added) { console.error(JSON.stringify({ status: "nothing", skipped: skipped.slice(0, 20) }, null, 2)); process.exit(1); }
hist.gradesThrough = dump.collectedAt;
hist.note = `${hist.note || ""} 2026-07-27: 세트별 등급분포(Pristine 10 / Gem Mint 10 구분) 추가. 등급합이 세트 총량과 일치하는 경우만 담는다.`.trim();
fs.writeFileSync(HIST, `${JSON.stringify(hist, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", filled, added, skipped: skipped.length, skippedSample: skipped.slice(0, 8) }));
