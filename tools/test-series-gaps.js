#!/usr/bin/env node
// 공백 감사(audit-series-gaps.js) 회귀검사 — 2026-09-30 신설. 가드 K2 가 돌린다.
//
// 같은 날 발견된 결함 셋을 되살리면 여기서 FAIL 한다:
//   ① PSA 카드별을 d(GemRate 인구 변동일)로만 세서 9/14 에 관측한 주(seen)를 공백으로 오판 → 그게 known-gaps 에 굳었다.
//   ② 세트 누적 원장(CGC·TAG·PSA 판별)과 진행 매물·시장 스캔 계열의 중간 빈칸을 아무 감사도 안 봤다.
//   ③ known-gaps 에 관측이 있는 주나 틀린 계열 이름을 넣어도 아무도 몰랐다.
// Run: node tools/test-series-gaps.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const audit = path.join(__dirname, "audit-series-gaps.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opbox-series-gaps-"));
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir);
const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value), "utf8");

const DAY = 86400000;
const range = (from, to) => { const out = []; for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) out.push(new Date(t).toISOString().slice(0, 10)); return out; };
const ALL = range("2026-09-01", "2026-09-29");
const GAMES = ["pokemonjp", "pokemon", "magic", "yugioh", "onepiece", "lorcana", "weiss", "digimon", "riftbound", "unionarena", "gundam", "dragonball", "palworld"];

function run(today) {
  const result = spawnSync(process.execPath, [audit, "--root", root, "--today", today, "--json"], { encoding: "utf8" });
  return { result, report: JSON.parse(result.stdout) };
}
const has = (list, re) => list.some((x) => re.test(x));

try {
  // ── 평시: 모든 계열이 온전한 데이터 ──
  write("known-gaps.json", { gaps: [] });
  write("auction-series.json", { daily: ALL.map((d) => ({ d, partial: false, hourGapHours: 0, ended: 900 })) });
  write("tcg-snapshot.json", { points: ALL.map((d) => ({ d, games: GAMES.map((k) => ({ k, live: 100, endingToday: 20 })) })) });
  write("tcg-series.json", { daily: ALL.map((d) => ({ d, games: Object.fromEntries(GAMES.map((k) => [k, { ended: 100 }])) })) });
  write("auction-watch.json", { pending: [] });
  write("tcg-watch.json", { pending: [] });
  write("palworld-auction-market.json", { points: ALL.map((d) => ({ d })) });
  write("palworld-auction-sold.json", { daily: ALL.map((d) => ({ d })) });
  write("auction-market.json", { points: ALL.map((d) => ({ d })) });
  write("supply-series.json", { sets: { "OP-01": { points: ALL.map((d) => ({ d })) } } });
  // 박스 진행매물: JP 는 OP-01 이 Ebay 키, OP-16 이 원래 키(WM 원본 없는 세트) — 둘을 합쳐 본다. 9/20 은 진행매물 점이 없다.
  write("onepiece-packs.json", { sets: {
    "OP-01": { boxSeriesEbay: { points: ALL.filter((d) => d !== "2026-09-20" && d !== "2026-09-21").map((d) => ({ d, basis: "active" })).concat([{ d: "2026-09-20" }]) },
               boxSeriesEnEbay: { points: ALL.map((d) => ({ d, basis: "active" })) } },
    "OP-16": { boxSeries: { points: [{ d: "2026-09-21", basis: "active" }] } },
  } });
  write("box-sold-ledger.json", { collectedDays: ALL, sets: {} });
  write("palworld-sold-ledger.json", { collectedDays: ALL, sets: {} });
  const mondays = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
  // PSA 카드별: 9/14 수집은 값이 안 변해 d 는 9/12(W37) 그대로, seen 만 9/14(W38) — 실제 2026-09-14 모양.
  write("psa-card-pop.json", { sets: { "OP-01": { jp: { "OP01-001|base": [
    { d: "2026-09-07" }, { d: "2026-09-12", seen: "2026-09-14" }, { d: "2026-09-21" }, { d: "2026-09-28" },
  ] } } } });
  write("cgc-card-pop.json", { sets: { "OP-01": { jp: { "OP01-001|base": mondays.map((d) => ({ d })) } } } });
  write("tag-card-pop.json", { sets: { "OP-01": { "OP01-001|base": mondays.map((d) => ({ d })) } } });   // 판 구분 없는 옛 구조
  write("cgc-grading-history.json", { sets: { "OP-01": { jp: mondays.map((d) => ({ d, total: 1 })) } } });
  write("tag-grading-history.json", { sets: { "OP-01": { jp: mondays.map((d) => ({ d, total: 1 })) } } });
  const weds = ["2026-09-02", "2026-09-09", "2026-09-16", "2026-09-23"];
  write("psa-edition-weekly.json", { sets: { "OP-01": { jp: weds.map((d) => ({ d, g: 1, m: 1 })) } } });

  let out = run("2026-09-30");
  // ① seen 이 있으면 그 주는 관측된 주다.
  assert.ok(!has(out.report.problems, /PSA 카드별/), `seen 으로 관측된 W38 을 공백으로 잡으면 안 된다: ${out.result.stdout}`);
  // ② 박스 진행매물 — 두 키 합집합이라 9/21 은 채워져 있고, basis 없는 옛 점은 9/20 을 가리지 못한다.
  // 그 밖엔 아무것도 안 떠야 한다(온전한 데이터에서 오탐 금지).
  assert.deepEqual(out.report.problems, ["박스 진행매물 시계열 JP — 최근 21일 중 1일 비었다: 2026-09-20"], out.result.stdout);
  assert.deepEqual(out.report.knownWrong, []);

  // ③ 등록이 데이터와 맞으면 메모, 어긋나면 knownWrong.
  write("known-gaps.json", { gaps: [
    { series: "박스 진행매물 시계열 JP", dates: ["2026-09-20"], reason: "테스트", confirmed: "2026-09-30" },
    { series: "PSA 카드별", weeks: ["2026-W38"], reason: "테스트 — seen 이 있는 주", confirmed: "2026-09-30" },
    { series: "원피스 경매 시장 스캔", dates: ["2026-09-10"], reason: "테스트 — 점이 있는 날", confirmed: "2026-09-30" },
    { series: "없는 계열", dates: ["2026-09-10"], reason: "테스트 — 이름 오타", confirmed: "2026-09-30" },
  ] });
  out = run("2026-09-30");
  assert.ok(has(out.report.notes, /박스 진행매물 시계열 JP — 확인된 영구 공백 1일\(2026-09-20\)/), out.result.stdout);
  assert.ok(has(out.report.knownWrong, /^PSA 카드별 2026-W38 — 이 계열 기준으로 비어 있지 않다/), out.result.stdout);
  assert.ok(has(out.report.knownWrong, /^원피스 경매 시장 스캔 2026-09-10 — /), out.result.stdout);
  assert.ok(has(out.report.knownWrong, /^없는 계열 — 날 단위로 감사하는 계열 이름이 아니다/), out.result.stdout);
  assert.equal(out.report.knownWrong.length, 3, out.result.stdout);
  assert.ok(has(out.report.problems, /^known-gaps 오기재 — PSA 카드별 2026-W38/), out.result.stdout);

  // ② 세트 누적 — CGC 세트가 9/14 주를 건너뛰면 잡는다(카드별이 그 주에 있어도).
  write("known-gaps.json", { gaps: [] });
  write("cgc-grading-history.json", { sets: { "OP-01": { jp: mondays.filter((d) => d !== "2026-09-14").map((d) => ({ d, total: 1 })) } } });
  out = run("2026-09-30");
  assert.ok(has(out.report.problems, /^CGC 세트 누적 — 관측이 없는 주 2026-W38$/), out.result.stdout);

  // PSA 판별 주간은 수요일 점을 다음 월요일에 받는다 — 월요일(9/28)엔 W39 를 아직 요구하지 않고, 화요일(9/29)부터 요구한다.
  write("psa-edition-weekly.json", { sets: { "OP-01": { jp: weds.filter((d) => d !== "2026-09-23").map((d) => ({ d, g: 1, m: 1 })) } } });
  out = run("2026-09-28");
  assert.ok(!has(out.report.problems, /PSA 판별 주간/), `월요일 수집 전에 그 주를 공백으로 잡으면 오탐이다: ${out.result.stdout}`);
  out = run("2026-09-29");
  assert.ok(has(out.report.problems, /^PSA 판별 주간 — 관측이 없는 주 2026-W39$/), out.result.stdout);

  // 시장 스캔·공급도 빠진 날을 잡는다.
  write("auction-market.json", { points: ALL.filter((d) => d !== "2026-09-26").map((d) => ({ d })) });
  write("supply-series.json", { sets: { "OP-01": { points: ALL.filter((d) => d !== "2026-09-24").map((d) => ({ d })) } } });
  out = run("2026-09-30");
  assert.ok(has(out.report.problems, /^원피스 경매 시장 스캔 — .*: 2026-09-26$/), out.result.stdout);
  assert.ok(has(out.report.problems, /^공급 시계열 — .*: 2026-09-24$/), out.result.stdout);
  console.log("series gaps tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
