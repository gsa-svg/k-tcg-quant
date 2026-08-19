#!/usr/bin/env node
// 세트 × 등급사 × 주차 누적 감정 시계열 — 2026-08-19 신설.
//
// 왜 만드나: PSA·CGC·TAG 를 이미 주간으로 쌓고 있는데 파일 셋이 구조가 제각각이다.
//   PSA  gemrate-psa-history.json   sets[코드].weekly[]  { d, totalGrades, totalGems }   (일본판)
//        gemrate-psa-en-totals.json sets[코드]           { totalGrades, ... }            (영문판, 점 하나)
//   CGC  cgc-grading-history.json   sets[코드].jp|en[]   { d, total, grades{} }
//   TAG  tag-grading-history.json   sets[코드].jp|en[]   { d, total, gem }
//   이대로면 그래프를 그릴 때마다 세 형식을 다시 맞춰야 한다. 한 번만 맞춰 두고 파생으로 쓴다.
//
// 무엇을 담나: "그 세트에 여태 들어온 감정 누적"을 주차별로. 증감(add)도 같이 계산해 둔다 —
//   화면에서 매번 빼기를 하면 어느 점과 뺐는지가 화면 코드에 숨는다.
//
// ⚠️ 등급사별 10 의 정의가 다르다(CGC 는 Pristine 10 과 Gem Mint 10 을 나누고, TAG 는 10 과 10P 가 따로다).
//    그래서 여기서는 **총 감정 수만** 합친다. 젬 수는 등급사별로 따로 두고 합계를 만들지 않는다.
//
// Run: node tools/build-grading-series.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const R = (p) => path.join(ROOT, "data", p);
const read = (p) => { try { return JSON.parse(fs.readFileSync(R(p), "utf8")); } catch { return null; } };

const PSA = read("gemrate-psa-history.json");
const PSA_EN = read("gemrate-psa-en-totals.json");
const CGC = read("cgc-grading-history.json");
const TAG = read("tag-grading-history.json");
const PACKS = read("onepiece-packs.json");

// 세트 순서는 packs.json 을 따른다 — 화면과 같은 순서로 나와야 대조가 쉽다.
const ORDER = [...(PACKS?.jp?.list || []), ...(PACKS?.extra?.list || [])];
const codes = [...new Set([
  ...ORDER,
  ...Object.keys(PSA?.sets || {}), ...Object.keys(CGC?.sets || {}), ...Object.keys(TAG?.sets || {}),
])];

// 누적값 배열을 {d, total, gem, add} 로 정규화한다. add 는 직전 점 대비 증가분.
// 누적이 줄어드는 경우가 있다(재등급·정정). 그때 add 는 음수로 그대로 둔다 — 0 으로 뭉개면 사실이 사라진다.
function normalize(rows, pick) {
  const out = [];
  let prev = null;
  for (const r of rows || []) {
    const total = pick.total(r);
    if (!Number.isFinite(total)) continue;
    const gem = pick.gem ? pick.gem(r) : null;
    const point = { d: r.d, total };
    if (Number.isFinite(gem)) point.gem = gem;
    if (prev != null) point.add = total - prev;
    prev = total;
    out.push(point);
  }
  return out;
}

const sets = {};
for (const code of codes) {
  const jp = {}, en = {};

  const psaJp = PSA?.sets?.[code]?.weekly;
  if (psaJp?.length) jp.psa = normalize(psaJp, { total: (r) => r.totalGrades, gem: (r) => r.totalGems });
  // 영문 PSA 는 아직 점 하나짜리 스냅샷이라(주간 이력 없음) 시계열로 만들지 않는다.
  // 값이 있으면 latest 로만 싣는다 — 없는 이력을 지어내지 않는다.
  const psaEn = PSA_EN?.sets?.[code];
  if (Number.isFinite(psaEn?.totalGrades)) en.psaLatest = { total: psaEn.totalGrades, gem: psaEn.totalGems ?? null };

  for (const [key, src] of [["cgc", CGC], ["tag", TAG]]) {
    for (const [ed, bucket] of [["jp", jp], ["en", en]]) {
      const rows = src?.sets?.[code]?.[ed];
      if (rows?.length) bucket[key] = normalize(rows, { total: (r) => r.total, gem: (r) => r.gem });
    }
  }
  if (Object.keys(jp).length || Object.keys(en).length) sets[code] = { jp, en };
}

// 최신 시점의 3사 합계. 등급사마다 관측일이 달라 "같은 날 합계"는 만들 수 없다 —
// 각자의 최신 점을 더하고, 어느 날짜들을 더했는지 함께 적는다.
for (const [code, s] of Object.entries(sets)) {
  for (const ed of ["jp", "en"]) {
    const parts = [];
    for (const g of ["psa", "cgc", "tag"]) {
      const arr = s[ed][g];
      if (arr?.length) parts.push({ g, d: arr[arr.length - 1].d, total: arr[arr.length - 1].total });
    }
    if (ed === "en" && s.en.psaLatest) parts.push({ g: "psa", d: null, total: s.en.psaLatest.total });
    if (!parts.length) continue;
    s[ed].latestTotal = {
      total: parts.reduce((a, p) => a + p.total, 0),
      by: Object.fromEntries(parts.map((p) => [p.g, p.total])),
      asOf: Object.fromEntries(parts.map((p) => [p.g, p.d])),
    };
  }
}

const out = {
  note: "Weekly cumulative grading population per booster-box set, per grading company. 'total' is the running cumulative count of cards from that set graded by that company; 'add' is the change from the previous observation (negative values are real — re-grades and corrections do reduce published populations). Japanese and English printings are kept separate. Gem counts are per company and are NOT summed across companies: CGC splits Pristine 10 from Gem Mint 10 and TAG scores 10 apart from 10P, so a combined 'number of 10s' would merge three different standards. latestTotal sums each company's most recent observation and records which date each figure came from, because the companies are not observed on the same day.",
  builtFrom: { psa: PSA?.updated ?? null, cgc: CGC?.updated ?? null, tag: TAG?.updated ?? null },
  updated: new Date().toISOString().slice(0, 10),
  sets,
};
fs.writeFileSync(R("grading-series.json"), JSON.stringify(out) + "\n", "utf8");

const n = Object.keys(sets).length;
const pts = Object.values(sets).reduce((a, s) => a + ["jp", "en"].reduce((b, ed) =>
  b + ["psa", "cgc", "tag"].reduce((c, g) => c + (s[ed][g]?.length || 0), 0), 0), 0);
console.log(JSON.stringify({ sets: n, points: pts, out: "data/grading-series.json" }));
