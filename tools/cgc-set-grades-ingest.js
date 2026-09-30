#!/usr/bin/env node
// CGC 세트별 총량 + 만점 분리(Pristine 10 / Gem Mint 10) 적재 — 2026-07-27 신설, 2026-09-30 공개 API 덤프로 전환.
//
// 왜 바꿨나: 세트 분리값은 브라우저로 세트 상세를 긁어(옛 cgc-set-grades.js) 담았는데, 그 수집이 8/3 뒤로
// 한 번도 안 돌아 원장 gradesThrough 가 8/3 에 멈췄고 화면 CGC 만점 열은 전 세트 '—' 였다. 그런데 자동 수집
// (collect-grading)이 매주 공개 API 로 세트 **전 카드**의 Pristine 10·Gem Mint 10 을 이미 받고 있었다 —
// 카드별만 적재하고 덤프를 버렸다. 같은 덤프의 세트 합을 여기서 담는다. 694e5543(8/3)이 41세트를 채운 방식과 같다.
//
// 정의가 옛 점과 같다는 근거(2026-09-30 오프라인 대조, 저장된 9/16·9/28 덤프):
//   · 카드 행 total 합 = 같은 시점 그룹 populationCount — 42/42. 카드 목록이 세트 전체를 덮는다.
//   · 9/28 덤프 합 = 목록 페이지로 받은 9/29 세트 총량 — 40/42 일치, 나머지 2건은 하루 뒤 +1.
//   · 8/3 점의 Pristine 10·Gem Mint 10 → 9/16·9/28 덤프 합 84/84 가 줄지 않고, 늘어난 만점 ≤ 늘어난 총량.
//   그래서 세트 총량도 이 합으로 담는다. 목록 페이지 브라우저 수집(옛 cgc-pop.js)은 같은 숫자를 사람 손으로
//   다른 날 한 번 더 받는 일이라 없앴다 — 남겨 두면 분리값 없는 점이 마지막 점이 돼 화면이 다시 '—' 가 된다.
//
// 입력: collect-cgc-card-pop.js 덤프 { grader:"cgc", collectedAt, sets:{ "OP-13|en":[{num,name,variant,total,pristine,gem}] } }
// 출력: data/cgc-grading-history.json 에 {d, total, grades:{"Pristine 10","Gem Mint 10"}} 점.
//   API 행에는 이 두 등급만 있다. 7/27~8/3 점의 나머지 등급 열(9·Mint+ 9.5·Perfect 10 …)은 만들지 않는다(빈 값이 낫다).
//
// 원칙:
//  - append-only. 같은 날짜 점이 있으면 total 이 같을 때만 비어 있는 grades 를 채운다. 다르면 손대지 않고 사유만 남긴다.
//  - 커버리지 축소 거부: 직전 관측일에 있던 (세트|판)이 덤프에 없으면 아무것도 쓰지 않고 멈춘다(가드 G8 과 같은 기준).
//  - 합이 말이 안 되면(총량 0, 정수 아님, 만점 합 > 총량) 그 덤프를 통째로 거부한다 — 반쪽만 담지 않는다.
// Run: node tools/cgc-set-grades-ingest.js <dump.json>
const fs = require("node:fs");
const path = require("node:path");

const HIST = path.join(__dirname, "..", "data", "cgc-grading-history.json");
const NOTE = "Weekly CGC grading population per One Piece booster box and edition (JP/EN). total = cumulative cards CGC-graded in that box's set, taken as the sum of every card row in CGC's public population data for the set (the same figure as the set total on CGC's pop report). grades = count at Pristine 10 and Gem Mint 10 in the same observation; the 2026-07-27 to 2026-08-03 points also carry the other grade columns. CGC exposes only a current snapshot with no history, so past weeks cannot be backfilled; each Monday's observation is appended. Append-only: past points are never overwritten or deleted.";

const isCount = (v) => Number.isInteger(v) && v >= 0;

// 덤프 → (세트|판)별 합. 하나라도 말이 안 되면 예외.
function setSums(dump) {
  const out = {};
  for (const [key, rows] of Object.entries(dump.sets || {})) {
    const [code, ed] = key.split("|");
    if (!code || !["jp", "en"].includes(ed)) throw new Error(`${key}: 키 형식이 "코드|jp|en" 이 아니다`);
    if (!Array.isArray(rows) || !rows.length) throw new Error(`${key}: 카드 행이 없다`);
    let total = 0, pristine = 0, gem = 0;
    for (const r of rows) {
      if (!isCount(r.total) || !isCount(r.pristine) || !isCount(r.gem)) throw new Error(`${key}: 정수가 아닌 행 ${JSON.stringify(r)}`);
      total += r.total; pristine += r.pristine; gem += r.gem;
    }
    if (total <= 0) throw new Error(`${key}: 총량 0`);
    if (pristine + gem > total) throw new Error(`${key}: 만점 합 ${pristine + gem} > 총량 ${total}`);
    out[key] = { code, ed, total, grades: { "Pristine 10": pristine, "Gem Mint 10": gem } };
  }
  return out;
}

// 순수 함수 — 원장 객체를 받아 고친다. 파일은 안 건드린다(시험용).
function apply(hist, dump) {
  const d = dump.collectedAt;
  if (dump.grader !== "cgc") throw new Error("grader 가 cgc 가 아님");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("collectedAt 필요 (YYYY-MM-DD)");
  const sums = setSums(dump);

  const byDate = {};
  for (const [code, eds] of Object.entries(hist.sets || {})) {
    for (const ed of ["jp", "en"]) for (const p of eds[ed] || []) (byDate[p.d] ||= new Set()).add(`${code}|${ed}`);
  }
  const prior = Object.keys(byDate).filter((x) => x < d).sort().at(-1);
  const missing = prior ? [...byDate[prior]].filter((k) => !sums[k]) : [];
  if (missing.length) {
    throw new Error(`커버리지 축소: 직전(${prior})에 있던 ${missing.length}개가 덤프에 없다 — ${missing.slice(0, 8).join(", ")}. ` +
      "그룹 매칭(collect-cgc-card-pop.js)이 그 세트를 놓쳤는지 먼저 볼 것.");
  }

  hist.sets ||= {};
  let appended = 0, filled = 0;
  const kept = [];
  for (const [key, v] of Object.entries(sums)) {
    const arr = ((hist.sets[v.code] ||= { jp: [], en: [] })[v.ed] ||= []);
    const pt = arr.find((p) => p.d === d);
    if (!pt) {
      arr.push({ d, total: v.total, grades: v.grades });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended += 1;
    } else if (pt.total !== v.total) {
      kept.push(`${key} ${d}: 보관 total ${pt.total} ≠ 덤프 ${v.total} — 먼저 담긴 관측을 둔다`);
    } else if (!pt.grades) {
      pt.grades = v.grades;
      filled += 1;
    } else if (["Pristine 10", "Gem Mint 10"].some((g) => pt.grades[g] !== v.grades[g])) {
      kept.push(`${key} ${d}: 보관 grades 와 덤프가 다르다 — 먼저 담긴 관측을 둔다`);
    }
  }

  const points = Object.values(hist.sets).flatMap((e) => [...(e.jp || []), ...(e.en || [])]);
  hist.grader = "cgc";
  hist.note = NOTE;
  hist.weeklyThrough = points.map((p) => p.d).sort().at(-1);
  hist.updated = hist.weeklyThrough;
  hist.gradesThrough = points.filter((p) => p.grades).map((p) => p.d).sort().at(-1);
  return { appended, filled, kept, coverage: Object.keys(sums).length, prior: prior || null };
}

module.exports = { apply, setSums };
if (require.main === module) {
  const file = process.argv[2];
  if (!file) { console.error("사용: node tools/cgc-set-grades-ingest.js <dump.json>"); process.exit(1); }
  const dump = JSON.parse(fs.readFileSync(file, "utf8"));
  const hist = JSON.parse(fs.readFileSync(HIST, "utf8"));
  const res = apply(hist, dump);
  fs.writeFileSync(HIST, `${JSON.stringify(hist)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", ...res, gradesThrough: hist.gradesThrough, weeklyThrough: hist.weeklyThrough }));
}
