#!/usr/bin/env node
// 영문판 PSA 총량 수집 — 2026-07-27. 시계열이 아니라 "현재 총량" 한 점만 가져온다.
//
// 왜 총량만인가: 세트별 누적 등급 수는 "이 세트가 지금까지 몇 장 채점됐나"를 답하는 값이라
// 과거를 소급할 필요가 없다. 주간 추이는 일본판만 우리가 직접 쌓는다(게시 범위 2025-12-03~).
//
// GemRate 세트명 규칙(실측 확인): 일본판 "One Piece Japanese OP01-Romance Dawn"
//   → 영문판은 " Japanese" 만 빠지고 연도는 동일. OP-01/OP-13 두 건으로 검증함.
// 규칙이 안 맞는 세트는 지어내지 않고 null 로 남긴다(표에서 "-" 로 표시).
// Run: node tools/collect-gemrate-en-totals.js
const fs = require("node:fs");
const path = require("node:path");
const { collectRows } = require("./collect-gemrate-psa-history.js");

const ROOT = path.resolve(__dirname, "..");
const JP = path.join(ROOT, "data", "gemrate-psa-history.json");
const OUT = path.join(ROOT, "data", "gemrate-psa-en-totals.json");

const jp = JSON.parse(fs.readFileSync(JP, "utf8"));
// collectRows(source) 는 source.sets[*].url 을 순회한다 — 영문판 URL 로 바꾼 사본을 넘긴다.
const enSets = {};
for (const [code, s] of Object.entries(jp.sets)) {
  const enName = (s.setName || "").replace(/^One Piece Japanese /, "One Piece ");
  if (enName === s.setName) { console.log(`skip ${code}: 일본판 세트명 규칙 불일치`); continue; }
  enSets[code] = { setName: enName, url: s.url.replace(/set_name=[^&]+/, `set_name=${encodeURIComponent(enName)}`) };
}

(async () => {
  let rows;
  try { rows = await collectRows({ sets: enSets }); }
  catch (e) { console.error(`영문판 수집 실패 — 파일 미변경: ${e.message}`); process.exit(1); }

  const out = { grader: "psa", basis: "GemRate full-set PSA population, English printings", edition: "en", collectedAt: null, sets: {} };
  const dates = [];
  for (const [code, r] of Object.entries(rows)) {
    const last = Array.isArray(r) ? r.at(-1) : null;
    if (!last || !Number.isInteger(last.total_grades) || last.total_grades <= 0) { out.sets[code] = null; continue; }
    dates.push(last.date);
    out.sets[code] = {
      setName: enSets[code].setName,
      url: enSets[code].url,
      date: last.date,
      totalGrades: last.total_grades,
      totalGems: last.total_gems,
      gemRate: Math.round((last.total_gems / last.total_grades) * 1000) / 10,
    };
  }
  const ok = Object.values(out.sets).filter(Boolean).length;
  if (!ok) { console.error("영문판 세트를 하나도 못 읽음 — 파일 미변경"); process.exit(1); }
  out.collectedAt = dates.sort().at(-1);
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ sets: Object.keys(out.sets).length, ok, missing: Object.keys(out.sets).length - ok, collectedAt: out.collectedAt }));
})();
