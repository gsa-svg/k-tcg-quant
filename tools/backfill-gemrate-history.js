#!/usr/bin/env node
// GemRate 주간 PSA 이력 소급 채우기 — 2026-07-27.
//
// 왜: 우리 주간 막대는 2026-06-03부터라 7주뿐이었다. 그런데 같은 출처(GemRate 세트
// 인구추이) 페이지의 RowData 에는 세트별로 2025년치 누적행이 이미 다 들어 있다.
// 즉 과거는 "수집 못 한" 게 아니라 "안 읽은" 것이었다. 한 번만 읽어서 앞쪽을 채운다.
//
// 안전장치 (기존 append-only 계약을 깨지 않는다):
//  - historyStart 이후 구간은 손대지 않는다. 재계산값이 보관된 값과 다르면 **중단**하고
//    아무 파일도 쓰지 않는다(상류 정정이 일어난 것이므로 사람이 봐야 한다).
//  - 앞쪽에 새로 붙는 주도 기존과 같은 correctionReason() 검사를 통과해야 한다.
//    실패하면 추정치로 메우지 않고 구멍(correction)으로 남긴다.
//  - 세트마다 상장 시점이 달라 시작 주가 다르다. 전 세트 공통 날짜를 요구하지 않는다.
//
// Run: node tools/backfill-gemrate-history.js [--floor YYYY-MM-DD] [--dry]
const fs = require("node:fs");
const path = require("node:path");
const { correctionReason, latestWednesday, collectRows } = require("./collect-gemrate-psa-history.js");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "data", "gemrate-psa-history.json");
const DAY = 864e5;

const argOf = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
const ms = (d) => Date.parse(`${d}T00:00:00Z`);
const isWed = (d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 3;

// RowData(일별 누적) → 수요일-수요일 주간 델타. 양끝 수요일 행이 다 있어야만 만든다.
function weeklyFromRows(rows) {
  const byDate = new Map(rows.map((r) => [r.date, r]));
  const weds = rows.map((r) => r.date).filter(isWed).sort();
  const out = [];
  for (const d of weds) {
    const prev = ymd(ms(d) - 7 * DAY);
    const cur = byDate.get(d), before = byDate.get(prev);
    if (!cur || !before) continue;   // 한쪽이라도 없으면 만들지 않는다
    out.push({
      d,
      grades: cur.total_grades - before.total_grades,
      gems: cur.total_gems - before.total_gems,
      totalGrades: cur.total_grades,
      totalGems: cur.total_gems,
    });
  }
  return out;
}

function backfill(source, rowsByCode, floor) {
  const start = source.historyStart;
  const conflicts = [];
  const perSet = {};
  const addedDates = new Set();

  for (const [code, set] of Object.entries(source.sets)) {
    const rows = rowsByCode[code];
    if (!Array.isArray(rows) || rows.length < 10) throw new Error(`${code}: RowData 없음 — 아무것도 쓰지 않음`);
    const recomputed = weeklyFromRows(rows);
    const byDate = new Map(recomputed.map((p) => [p.d, p]));

    // 1) 기존 보관 구간 대조 — 하나라도 어긋나면 전체 중단.
    for (const kept of set.weekly || []) {
      const now = byDate.get(kept.d);
      if (!now) { conflicts.push(`${code} ${kept.d}: 상류에서 사라짐`); continue; }
      if (now.grades !== kept.grades || now.gems !== kept.gems || now.totalGrades !== kept.totalGrades) {
        conflicts.push(`${code} ${kept.d}: 보관 ${kept.grades}/${kept.gems} → 현재 ${now.grades}/${now.gems}`);
      }
    }

    // 2) historyStart 이전만 새로 채운다.
    const priorGrades = (set.weekly || []).map((p) => p.grades);
    const fresh = [];
    for (const p of recomputed) {
      if (p.d >= start) break;
      if (floor && p.d < floor) continue;
      const reason = correctionReason(code, p.d, p.grades, p.gems, priorGrades);
      if (reason) { (source.corrections ||= {})[code] = [...(source.corrections?.[code] || []), { date: p.d, reason }]; continue; }
      fresh.push(p);
      addedDates.add(p.d);
    }
    perSet[code] = { fresh, first: fresh[0]?.d || (set.weekly || [])[0]?.d || null };
  }

  if (conflicts.length) return { ok: false, conflicts };

  for (const [code, { fresh }] of Object.entries(perSet)) {
    source.sets[code].weekly = [...fresh, ...(source.sets[code].weekly || [])].sort((a, b) => a.d.localeCompare(b.d));
  }
  const allDates = [...new Set([...(source.retainedWeeklyDates || []), ...addedDates])].sort();
  source.retainedWeeklyDates = allDates;
  source.historyStart = allDates[0];
  source.backfilledAt = "2026-07-27";
  source.note = `${source.note} 2026-07-27: 같은 GemRate 페이지의 과거 누적행에서 ${allDates[0]}까지 소급 산출(추정 없음).`;
  return {
    ok: true,
    historyStart: source.historyStart,
    weeks: allDates.length,
    addedWeeks: addedDates.size,
    perSetFirst: Object.fromEntries(Object.entries(perSet).map(([c, v]) => [c, v.first])),
  };
}

async function main() {
  const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const rows = await collectRows(source);
  // 상류 최신 수요일이 우리 weeklyThrough 보다 앞서면 정기 수집이 밀린 것 — 여기서는 앞쪽만 다룬다.
  const upstreamWed = latestWednesday(Object.values(rows)[0] || []);
  const result = backfill(source, rows, argOf("--floor"));
  if (!result.ok) {
    console.error(JSON.stringify({ status: "conflict", upstreamWed, conflicts: result.conflicts.slice(0, 20) }, null, 2));
    process.exitCode = 1;
    return;
  }
  if (!process.argv.includes("--dry")) fs.writeFileSync(SOURCE, `${JSON.stringify(source, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ status: process.argv.includes("--dry") ? "dry" : "written", upstreamWed, ...result }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e.stack); process.exitCode = 1; });

module.exports = { weeklyFromRows, backfill };
