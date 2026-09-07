#!/usr/bin/env node
// 실브라우저 GemRate 세트 추이 덤프 → 일본판 주간 원장(gemrate-psa-history.json) + 영문판 총량(gemrate-psa-en-totals.json).
// GemRate 가 헤드리스를 봇으로 막아(2026-09-02·09-07 실측 "잠시만 기다리십시오") collect-gemrate-psa-history.js /
// collect-gemrate-en-totals.js 의 수집부만 실브라우저 덤프로 대체한다. 검증 규칙은 그 두 파일 것을 그대로 쓴다.
// 덤프 형식: {collectedAt, jp:{"OP-01":[{date,total_grades,total_gems},…]}, en:{…}} — 세트 페이지 RowData 그대로.
// Run: node tools/psa-trend-ingest.js <덤프.json>   → 이어서 node tools/psa-edition-weekly-ingest.js <같은 덤프>
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "..");
const { appendVerifiedWeeks } = require("./collect-gemrate-psa-history.js");
const dump = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));

// JP — 주간 원장
const jpPath = path.join(ROOT, "data/gemrate-psa-history.json");
const jp = JSON.parse(fs.readFileSync(jpPath, "utf8"));
const jpMissing = Object.keys(jp.sets).filter((c) => !dump.jp[c]);
if (jpMissing.length) throw new Error("JP 덤프에 없는 세트: " + jpMissing.join(","));
const before = jp.weeklyThrough;
const r = appendVerifiedWeeks(jp, dump.jp);
if (r.changed) fs.writeFileSync(jpPath, `${JSON.stringify(jp, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ jp: r.changed ? "updated" : "current", before, ...r, corrections: Object.fromEntries(Object.entries(jp.corrections || {}).map(([c, l]) => [c, l.filter((x) => r.added.includes(x.date)).length]).filter(([, n]) => n)) }));

// EN — 현재 총량 (collect-gemrate-en-totals.js 와 동일 규칙: 누적 감소면 중단)
const enPath = path.join(ROOT, "data/gemrate-psa-en-totals.json");
const en = JSON.parse(fs.readFileSync(enPath, "utf8"));
const dates = []; let updated = 0; const regressed = [];
for (const [code, rows] of Object.entries(dump.en)) {
  const cur = en.sets[code];
  if (!cur || !cur.url) throw new Error("EN 원장에 없는 세트: " + code);
  const last = rows.at(-1);
  if (!last || !Number.isInteger(last.total_grades) || last.total_grades <= 0) continue;
  if (last.total_grades < cur.totalGrades) { regressed.push(`${code} ${cur.totalGrades} → ${last.total_grades}`); continue; }
  cur.totalGrades = last.total_grades; cur.totalGems = last.total_gems;
  cur.gemRate = Math.round((last.total_gems / last.total_grades) * 1000) / 10;
  dates.push(last.date); updated += 1;
}
const enExpected = Object.entries(en.sets).filter(([, s]) => s?.url).map(([c]) => c).filter((c) => !dump.en[c]);
if (regressed.length) { console.error(JSON.stringify({ status: "regression", regressed })); process.exit(1); }
if (enExpected.length) throw new Error("EN 덤프에 없는 세트: " + enExpected.join(","));
en.collectedAt = dates.sort().at(-1);
fs.writeFileSync(enPath, `${JSON.stringify(en, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ en: "ok", updated, collectedAt: en.collectedAt }));
