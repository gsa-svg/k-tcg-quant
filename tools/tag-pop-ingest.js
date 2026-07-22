// TAG 그레이딩 주간 이력 적재 — PSA(gemrate-psa-history)와 같은 성격의 "박스별 총 그레이딩 + 최고등급 확률" 시계열.
//
// 입력: 박스 집계 스냅샷 { grader:"tag", collectedAt:"YYYY-MM-DD", boxes:{ "OP-01":{jp:{total,gem},en:{...}}, ... } }
//   (브라우저에서 tag-classify.aggregateBoxes 로 만든 값. total=그 박스 총 TAG그레이딩수, gem=TAG 10+10P 수.)
// 출력: data/tag-grading-history.json — 박스·판별 주간 점 [{d,total,gem}] append-only.
//   gemRate(고등급 확률)는 표시할 때 gem/total 로 계산(원본은 원자료만 보존).
//
// 원칙(정확도 최우선):
//  - append-only. 같은 날짜면 스킵(과거 점 절대 덮어쓰기/삭제 금지).
//  - total>0, 0<=gem<=total 인 값만 담는다. 이상값은 그 박스/판 스킵(지어내지 않음).
//  - TAG pop 은 누적값이라 재조회로 복구 가능하지만, 시계열(주차별 증가분)은 소급 불가 → 매주 쌓는다.
// Run: node tools/tag-pop-ingest.js <snapshot.json>
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const histPath = path.join(ROOT, "data", "tag-grading-history.json");

function ingest(snapshot) {
  const d = snapshot.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("snapshot.collectedAt 필요 (YYYY-MM-DD)");
  if (snapshot.grader !== "tag") throw new Error("grader 가 tag 가 아님");

  let store;
  try { store = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { store = { grader: "tag", sets: {} }; }
  store.sets = store.sets || {};

  let appended = 0, skipped = 0, rejected = 0;
  for (const [code, eds] of Object.entries(snapshot.boxes || {})) {
    for (const ed of ["jp", "en"]) {
      const s = eds && eds[ed];
      if (!s) continue;
      const total = Number(s.total), gem = Number(s.gem);
      if (!(Number.isInteger(total) && total > 0 && Number.isInteger(gem) && gem >= 0 && gem <= total)) { rejected++; continue; }
      store.sets[code] = store.sets[code] || { jp: [], en: [] };
      const arr = store.sets[code][ed] = store.sets[code][ed] || [];
      if (arr.some((p) => p.d === d)) { skipped++; continue; }   // 같은 날짜 있음 → 절대 덮어쓰지 않음
      arr.push({ d, total, gem });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
    }
  }

  store.note = "Weekly TAG (taggrading.com) grading population per One Piece booster box and edition (JP/EN). total = cumulative cards TAG-graded for that box; gem = count at TAG 10 + 10P (top grade). High-grade probability = gem/total. Collected from the public TAG pop report via browser and aggregated by set. Append-only: past weekly points are never overwritten or deleted.";
  store.grader = "tag";
  store.updated = d;
  store.weeklyThrough = Object.values(store.sets).flatMap((e) => [...(e.jp || []), ...(e.en || [])]).map((p) => p.d).sort().at(-1) || d;
  fs.writeFileSync(histPath, JSON.stringify(store) + "\n", "utf8");
  return { appended, skipped, rejected, sets: Object.keys(store.sets).length, weeklyThrough: store.weeklyThrough };
}

module.exports = { ingest };
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node tools/tag-pop-ingest.js <snapshot.json>"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")))));
}
