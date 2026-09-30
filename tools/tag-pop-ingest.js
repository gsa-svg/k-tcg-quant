// TAG 그레이딩 주간 이력 적재 — PSA(gemrate-psa-history)와 같은 성격의 "박스별 총 그레이딩 + 최고등급 확률" 시계열.
//
// 입력: 박스 집계 스냅샷 { grader:"tag", collectedAt:"YYYY-MM-DD", boxes:{ "OP-01":{jp:{total,gem,g10,g10p},en:{...}}, ... } }
//   (브라우저 __tagAgg = tag-classify.aggregateBoxes 로 만든 값. total=그 박스 총 TAG그레이딩수, gem=TAG 10+10P 수,
//    g10·g10p = 두 만점을 따로 센 수.)
// 출력: data/tag-grading-history.json — 박스·판별 주간 점 [{d,total,gem,g10,g10p}] append-only.
//   gemRate(고등급 확률)는 표시할 때 gem/total 로 계산(원본은 원자료만 보존).
//
// 원칙(정확도 최우선):
//  - append-only. 같은 날짜면 스킵(과거 점 절대 덮어쓰기/삭제 금지).
//  - total>0, 0<=gem<=total 인 값만 담는다. 이상값은 그 박스/판 스킵(지어내지 않음).
//  - TAG pop 은 누적값이라 재조회로 복구 가능하지만, 시계열(주차별 증가분)은 소급 불가 → 매주 쌓는다.
//  - **커버리지 축소 거부**(2026-08-03 신설): 이번 (세트|판) 수가 직전 수집일보다 적으면 적재를 멈춘다.
//    연도 페이지가 한 장 늘었는데 못 넘긴 경우가 딱 이렇게 보인다(CGC 에서 실제로 2주간 당했다).
//    정말 사라진 세트라면 --allow-shrink 로 사람이 명시한다.
//  - **10 / 10P 분리값 필수**(2026-09-30): 분리값은 따로 돌리는 적재기(옛 tag-pop-split-ingest.js)가 맡았는데
//    월요일 절차에 없어서 8/3 뒤로 한 번도 안 돌았고, 화면 TAG 10/10P 열이 전 세트 '—' 였다. 이제 한 점에 같이 담고,
//    분리값이 없는 스냅샷(옛 __tagAgg 출력)은 통째로 거부한다 — 받아 주면 같은 구멍이 조용히 다시 생긴다.
//    gem 은 반드시 g10 + g10p 여야 한다(7/28·8/3 분리 점과 같은 정의).
// Run: node tools/tag-pop-ingest.js <snapshot.json> [--allow-shrink]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const histPath = path.join(ROOT, "data", "tag-grading-history.json");
const isCount = (v) => Number.isInteger(v) && v >= 0;

// 직전 수집일의 (세트|판) 커버리지. 오늘 것이 이보다 적으면 뭔가를 못 읽은 것이다.
function priorCoverage(store, today) {
  const byDate = {};
  for (const [code, eds] of Object.entries(store.sets || {})) {
    for (const ed of ["jp", "en"]) for (const p of eds[ed] || []) (byDate[p.d] = byDate[p.d] || new Set()).add(`${code}|${ed}`);
  }
  const prior = Object.keys(byDate).filter((d) => d < today).sort().at(-1);
  return prior ? { d: prior, keys: byDate[prior] } : null;
}

// 순수 함수 — 원장 객체를 받아 고친다. 파일은 안 건드린다(시험용).
function apply(store, snapshot, opts = {}) {
  const d = snapshot.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("snapshot.collectedAt 필요 (YYYY-MM-DD)");
  if (snapshot.grader !== "tag") throw new Error("grader 가 tag 가 아님");
  store.sets = store.sets || {};

  const nowKeys = new Set();
  const noSplit = [];
  for (const [code, eds] of Object.entries(snapshot.boxes || {})) {
    for (const ed of ["jp", "en"]) {
      const s = eds && eds[ed];
      if (!s) continue;
      nowKeys.add(`${code}|${ed}`);
      if (!isCount(s.g10) || !isCount(s.g10p)) noSplit.push(`${code}|${ed}`);
    }
  }
  if (noSplit.length) {
    throw new Error(`10/10P 분리값이 없다: ${noSplit.slice(0, 8).join(", ")}${noSplit.length > 8 ? " …" : ""} — ` +
      "옛 __tagAgg 출력이다. node tools/tag-pop.js --setup 을 새로 받아 다시 뽑을 것.");
  }
  const prior = priorCoverage(store, d);
  if (prior && nowKeys.size < prior.keys.size && !opts.allowShrink) {
    const missing = [...prior.keys].filter((k) => !nowKeys.has(k));
    throw new Error(
      `커버리지 축소: 이번 ${nowKeys.size}개 < 직전(${prior.d}) ${prior.keys.size}개. 빠진 것: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}\n` +
      `연도 페이지를 끝까지 읽었는지(__tagYear 의 complete) 먼저 확인할 것. 정말 사라진 세트라면 --allow-shrink 로 명시한다.`
    );
  }

  let appended = 0, skipped = 0, rejected = 0;
  for (const [code, eds] of Object.entries(snapshot.boxes || {})) {
    for (const ed of ["jp", "en"]) {
      const s = eds && eds[ed];
      if (!s) continue;
      const total = Number(s.total), gem = Number(s.gem), g10 = s.g10, g10p = s.g10p;
      if (!(Number.isInteger(total) && total > 0 && Number.isInteger(gem) && gem >= 0 && gem <= total && gem === g10 + g10p)) { rejected++; continue; }
      store.sets[code] = store.sets[code] || { jp: [], en: [] };
      const arr = store.sets[code][ed] = store.sets[code][ed] || [];
      if (arr.some((p) => p.d === d)) { skipped++; continue; }   // 같은 날짜 있음 → 절대 덮어쓰지 않음
      arr.push({ d, total, gem, g10, g10p });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
    }
  }

  const points = Object.values(store.sets).flatMap((e) => [...(e.jp || []), ...(e.en || [])]);
  store.note = "Weekly TAG (taggrading.com) grading population per One Piece booster box and edition (JP/EN). total = cumulative cards TAG-graded for that box; gem = count at TAG 10 + 10P (top grade), with g10 and g10p keeping the two top grades apart. High-grade probability = gem/total. Collected from the public TAG pop report via browser and aggregated by set. Append-only: past weekly points are never overwritten or deleted.";
  store.grader = "tag";
  store.updated = d;
  store.weeklyThrough = points.map((p) => p.d).sort().at(-1) || d;
  store.splitThrough = points.filter((p) => isCount(p.g10) && isCount(p.g10p)).map((p) => p.d).sort().at(-1);
  return { appended, skipped, rejected, sets: Object.keys(store.sets).length, coverage: nowKeys.size, weeklyThrough: store.weeklyThrough, splitThrough: store.splitThrough };
}

function ingest(snapshot, opts = {}) {
  let store;
  try { store = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { store = { grader: "tag", sets: {} }; }
  const res = apply(store, snapshot, opts);
  fs.writeFileSync(histPath, JSON.stringify(store) + "\n", "utf8");
  return res;
}

module.exports = { ingest, apply };
if (require.main === module) {
  const f = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!f) { console.error("usage: node tools/tag-pop-ingest.js <snapshot.json> [--allow-shrink]"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")), { allowShrink: process.argv.includes("--allow-shrink") })));
}
