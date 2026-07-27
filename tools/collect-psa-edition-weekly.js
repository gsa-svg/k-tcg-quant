#!/usr/bin/env node
// 판별(일본판/영문판) PSA 누적 주간 적재 — 2026-07-27 신설.
//
// 무엇을 쌓나: 세트마다 수요일 기준 "그 시점까지의 누적 등급 수/젬 수"를 판별로 한 점씩.
// 화면에는 최근 두 점의 차이(주간 증감)만 쓰지만, 점을 계속 쌓아두면 몇 달 뒤에는
// 주차별 증가량을 우리 손으로 만든 시계열로 말할 수 있게 된다. 시계열은 소급이 안 되므로
// 쓸지 말지 정해지기 전에도 일단 쌓는다.
//
// 원칙:
//  - append-only. 같은 날짜가 이미 있으면 값이 같은지 확인만 하고 넘어간다.
//    값이 다르면 상류 정정이므로 **중단**한다(조용히 덮어쓰지 않는다).
//  - 누적은 줄어들 수 없다. 역행하면 그 세트/판은 그 주를 건너뛰고 사유를 남긴다.
//  - 영문판 미발매 세트는 항목을 만들지 않는다(0 이 아니라 '없음').
// Run: node tools/collect-psa-edition-weekly.js [--date YYYY-MM-DD]
const fs = require("node:fs");
const path = require("node:path");
const { collectRows } = require("./collect-gemrate-psa-history.js");

const ROOT = path.resolve(__dirname, "..");
const JP_HIST = path.join(ROOT, "data", "gemrate-psa-history.json");
const EN_TOTALS = path.join(ROOT, "data", "gemrate-psa-en-totals.json");
const LEDGER = path.join(ROOT, "data", "psa-edition-weekly.json");

const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const isWed = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3;
const lastWed = (rows) => [...rows].reverse().find((r) => isWed(r.date))?.date || null;

function appendPoint(store, code, ed, point, problems) {
  const arr = ((store.sets[code] ||= {})[ed] ||= []);
  const existing = arr.find((p) => p.d === point.d);
  if (existing) {
    if (existing.g !== point.g || existing.m !== point.m) {
      problems.push(`${code}/${ed} ${point.d}: 보관 ${existing.g}/${existing.m} → 현재 ${point.g}/${point.m}`);
    }
    return "dup";
  }
  const prev = arr.filter((p) => p.d < point.d).at(-1);
  if (prev && point.g < prev.g) { problems.push(`${code}/${ed} ${point.d}: 누적 역행 ${prev.g} → ${point.g}`); return "reject"; }
  arr.push(point);
  arr.sort((a, b) => a.d.localeCompare(b.d));
  return "added";
}

(async () => {
  const jpHist = JSON.parse(fs.readFileSync(JP_HIST, "utf8"));
  const enTotals = JSON.parse(fs.readFileSync(EN_TOTALS, "utf8"));

  const targets = {};   // key -> {code, ed, url}
  for (const [code, s] of Object.entries(jpHist.sets)) targets[`${code}|jp`] = { code, ed: "jp", url: s.url };
  for (const [code, s] of Object.entries(enTotals.sets)) if (s) targets[`${code}|en`] = { code, ed: "en", url: s.url };

  const sets = Object.fromEntries(Object.entries(targets).map(([k, v]) => [k, { url: v.url }]));
  let rows;
  try { rows = await collectRows({ sets }); }
  catch (e) { console.error(`수집 실패 — 파일 미변경: ${e.message}`); process.exit(1); }

  const store = fs.existsSync(LEDGER)
    ? JSON.parse(fs.readFileSync(LEDGER, "utf8"))
    : { version: 1, basis: "GemRate full-set PSA cumulative population by edition, Wednesday snapshots",
        note: "append-only. 화면에는 최근 두 점의 차이만 쓰지만 점은 계속 보존한다. 판별 합산 금지.",
        sets: {}, weeks: [], problems: [] };

  // 기준 수요일: 모든 세트가 공통으로 가진 가장 최근 수요일(강제 지정 가능)
  const forced = argOf("--date");
  const wed = forced || Object.values(rows).map((r) => lastWed(r)).filter(Boolean).sort()[0];
  if (!wed || !isWed(wed)) { console.error(`기준 수요일을 못 정함(${wed}) — 파일 미변경`); process.exit(1); }

  const problems = [];
  const tally = { added: 0, dup: 0, reject: 0, missing: 0 };
  for (const [key, meta] of Object.entries(targets)) {
    const r = rows[key];
    const row = Array.isArray(r) ? r.find((x) => x.date === wed) : null;
    if (!row) { tally.missing += 1; problems.push(`${meta.code}/${meta.ed} ${wed}: 상류에 해당일 행 없음`); continue; }
    tally[appendPoint(store, meta.code, meta.ed, { d: wed, g: row.total_grades, m: row.total_gems }, problems)] += 1;
  }

  const conflicts = problems.filter((p) => /보관 .* → 현재/.test(p));
  if (conflicts.length) {
    console.error(JSON.stringify({ status: "conflict", wed, conflicts: conflicts.slice(0, 15) }, null, 2));
    process.exit(1);   // 상류 정정은 사람이 봐야 한다
  }
  if (!tally.added && !tally.dup) { console.error(`${wed}: 적재된 점이 하나도 없음 — 파일 미변경`); process.exit(1); }

  if (!store.weeks.includes(wed)) store.weeks.push(wed);
  store.weeks.sort();
  store.updated = wed;
  if (problems.length) store.problems = [...(store.problems || []), ...problems.map((p) => ({ at: wed, note: p }))];
  fs.writeFileSync(LEDGER, `${JSON.stringify(store, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", wed, ...tally, weeks: store.weeks.length }));
})();
