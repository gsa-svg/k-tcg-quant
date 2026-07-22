// CGC 그레이딩 주간 이력 적재 — 부스터박스별 "총 CGC 그레이딩수"만 주차별로 쌓는다(개별 카드/등급분포 제외).
//
// 입력: { grader:"cgc", collectedAt:"YYYY-MM-DD", boxes:{ "OP-01":{jp?,en?}, ... } }  (값 = 그 박스·판의 총 CGC 그레이딩수)
// 출력: data/cgc-grading-history.json — 박스·판 주간 점 [{d,total}] append-only.
//
// ⚠️ CGC pop 리포트는 "현재 스냅샷"만 있고 과거 이력이 없다 → 소급 불가. 지금부터 매주 쌓는다.
// 원칙: append-only(같은 날짜 스킵), total>0 정수만, 조작 금지.
// Run: node tools/cgc-pop-ingest.js <snapshot.json>
const fs = require("fs");
const path = require("path");
const histPath = path.join(__dirname, "..", "data", "cgc-grading-history.json");

function ingest(snapshot) {
  const d = snapshot.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("snapshot.collectedAt 필요 (YYYY-MM-DD)");
  if (snapshot.grader !== "cgc") throw new Error("grader 가 cgc 가 아님");

  let store;
  try { store = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { store = { grader: "cgc", sets: {} }; }
  store.sets = store.sets || {};

  let appended = 0, skipped = 0, rejected = 0;
  for (const [code, eds] of Object.entries(snapshot.boxes || {})) {
    for (const ed of ["jp", "en"]) {
      const v = eds && eds[ed];
      if (v == null) continue;
      const total = Number(v);
      if (!(Number.isInteger(total) && total > 0)) { rejected++; continue; }
      store.sets[code] = store.sets[code] || { jp: [], en: [] };
      const arr = store.sets[code][ed] = store.sets[code][ed] || [];
      if (arr.some((p) => p.d === d)) { skipped++; continue; }
      arr.push({ d, total });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
    }
  }

  store.note = "Weekly CGC (cgccards.com) grading population per One Piece booster box and edition (JP/EN). total = cumulative cards CGC-graded for that box's Base Expansion set (individual cards and grade breakdown are not stored — box totals only). CGC exposes only a current snapshot with no history, so past weeks cannot be backfilled; each Monday's total is appended. Append-only: past points are never overwritten or deleted.";
  store.grader = "cgc";
  store.updated = d;
  store.weeklyThrough = Object.values(store.sets).flatMap((e) => [...(e.jp || []), ...(e.en || [])]).map((p) => p.d).sort().at(-1) || d;
  fs.writeFileSync(histPath, JSON.stringify(store) + "\n", "utf8");
  return { appended, skipped, rejected, sets: Object.keys(store.sets).length, weeklyThrough: store.weeklyThrough };
}

module.exports = { ingest };
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node tools/cgc-pop-ingest.js <snapshot.json>"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")))));
}
