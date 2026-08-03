// CGC 그레이딩 주간 이력 적재 — 부스터박스별 "총 CGC 그레이딩수"만 주차별로 쌓는다(개별 카드/등급분포 제외).
//
// 입력: 페이지별 스냅샷 파일 1개 이상. { grader:"cgc", collectedAt:"YYYY-MM-DD", page, hasNext, boxes:{ "OP-01":{jp?,en?} } }
//   (값 = 그 박스·판의 총 CGC 그레이딩수. 목록이 여러 페이지면 페이지마다 한 파일씩 넘긴다.)
// 출력: data/cgc-grading-history.json — 박스·판 주간 점 [{d,total}] append-only.
//
// ⚠️ CGC pop 리포트는 "현재 스냅샷"만 있고 과거 이력이 없다 → 소급 불가. 지금부터 매주 쌓는다.
// 원칙: append-only(같은 날짜 스킵), total>0 정수만, 조작 금지.
//
// 조용한 누락 방지 (2026-08-03 신설 — 실제로 2주간 당했다):
//  1) **미완 페이지 거부**: 넘긴 스냅샷 중 마지막 페이지가 hasNext=true 면 목록을 끝까지 안 읽은 것이므로 적재 거부.
//  2) **커버리지 축소 거부**: 이번 수집의 (세트|판) 수가 직전 수집일보다 적으면 거부.
//     세트가 실제로 사라진 게 맞다면 --allow-shrink 로 사람이 명시해야 한다.
//  둘 다 "빠진 걸 빠졌다고 말하지 못하는" 상황을 없애기 위한 것이다. 빈 값이 틀린 값보다 낫고,
//  멈추는 게 조용히 반쪽만 담는 것보다 낫다.
// Run: node tools/cgc-pop-ingest.js <page1.json> [page2.json ...] [--allow-shrink]
const fs = require("fs");
const path = require("path");
const histPath = path.join(__dirname, "..", "data", "cgc-grading-history.json");

// 페이지 스냅샷들을 하나로 합친다. 같은 (코드,판)이 두 페이지에 나오면 합계가 아니라 오류로 본다
// (한 세트는 목록에 한 번만 나온다 — 두 번 나왔다면 페이지 경계에서 같은 페이지를 두 번 읽은 것이다).
function mergePages(snapshots) {
  if (!snapshots.length) throw new Error("스냅샷이 없다");
  const dates = [...new Set(snapshots.map((s) => s.collectedAt))];
  if (dates.length !== 1) throw new Error(`수집일이 섞여 있다: ${dates.join(", ")}`);
  for (const s of snapshots) if (s.grader !== "cgc") throw new Error("grader 가 cgc 가 아님");

  const last = snapshots[snapshots.length - 1];
  if (last.hasNext === true) {
    throw new Error(`마지막 페이지(page=${last.page ?? "?"})가 hasNext=true — 목록을 끝까지 안 읽었다. 다음 페이지를 읽어 함께 넘길 것`);
  }

  const boxes = {};
  for (const s of snapshots) {
    for (const [code, eds] of Object.entries(s.boxes || {})) {
      for (const ed of ["jp", "en"]) {
        const v = eds && eds[ed];
        if (v == null) continue;
        boxes[code] = boxes[code] || { jp: null, en: null };
        if (boxes[code][ed] != null && boxes[code][ed] !== v) {
          throw new Error(`${code}.${ed} 이 여러 페이지에 다른 값으로 나온다 (${boxes[code][ed]} vs ${v}) — 같은 페이지를 중복으로 읽었는지 확인할 것`);
        }
        boxes[code][ed] = v;
      }
    }
  }
  return { grader: "cgc", collectedAt: dates[0], boxes, pages: snapshots.length };
}

// 직전 수집일의 (세트|판) 커버리지. 오늘 것이 이보다 적으면 뭔가를 못 읽은 것이다.
function priorCoverage(store, today) {
  const byDate = {};
  for (const [code, eds] of Object.entries(store.sets || {})) {
    for (const ed of ["jp", "en"]) for (const p of eds[ed] || []) (byDate[p.d] = byDate[p.d] || new Set()).add(`${code}|${ed}`);
  }
  const prior = Object.keys(byDate).filter((d) => d < today).sort().at(-1);
  return prior ? { d: prior, keys: byDate[prior] } : null;
}

function ingest(input, opts = {}) {
  const snapshot = Array.isArray(input) ? mergePages(input) : input;
  const d = snapshot.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("snapshot.collectedAt 필요 (YYYY-MM-DD)");
  if (snapshot.grader !== "cgc") throw new Error("grader 가 cgc 가 아님");

  let store;
  try { store = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { store = { grader: "cgc", sets: {} }; }
  store.sets = store.sets || {};

  const nowKeys = new Set();
  for (const [code, eds] of Object.entries(snapshot.boxes || {})) {
    for (const ed of ["jp", "en"]) if (eds && eds[ed] != null) nowKeys.add(`${code}|${ed}`);
  }
  const prior = priorCoverage(store, d);
  if (prior && nowKeys.size < prior.keys.size && !opts.allowShrink) {
    const missing = [...prior.keys].filter((k) => !nowKeys.has(k));
    throw new Error(
      `커버리지 축소: 이번 ${nowKeys.size}개 < 직전(${prior.d}) ${prior.keys.size}개. 빠진 것: ${missing.slice(0, 8).join(", ")}${missing.length > 8 ? " …" : ""}\n` +
      `목록 페이지를 끝까지 읽었는지 먼저 확인할 것. 정말 사라진 세트라면 --allow-shrink 로 명시한다.`
    );
  }

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
  return { appended, skipped, rejected, sets: Object.keys(store.sets).length, coverage: nowKeys.size, pages: snapshot.pages || 1, weeklyThrough: store.weeklyThrough };
}

module.exports = { ingest, mergePages };
if (require.main === module) {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const allowShrink = process.argv.includes("--allow-shrink");
  if (!files.length) { console.error("usage: node tools/cgc-pop-ingest.js <page1.json> [page2.json ...] [--allow-shrink]"); process.exit(1); }
  const snaps = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  console.log(JSON.stringify(ingest(snaps, { allowShrink })));
}
