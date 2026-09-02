#!/usr/bin/env node
// collect-status 의 "빠짐 그물" 회귀검사 — 2026-09-02 신설.
//
// 왜 필요한가: 그물은 조용히 죽는다. 실제로 그날 정규식의 `\d` 가 `d` 로 깨져서
// (셸을 거치며 백슬래시가 먹혔다) 날짜를 하나도 못 찾는 상태가 됐는데,
// 출력은 "UNTRACKED 0" 으로 멀쩡해 보였다. **검사하지 않으면서 통과했다고 말하는** 상태였다.
// 가짜 필드를 심어봐야 그물이 살아있는지 알 수 있다.
//
// 2026-09-02 소유자 절대지시: "여태 수집하던 것 하나도 빼먹지 마라. 그래프 틀리면 안 된다."
// 이 검사는 그 약속을 코드로 지키는 장치다. 실패하면 exit 1 — 가드가 잡는다.
//
// Run: node tools/test-collect-status.js
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const ROOT = path.resolve(__dirname, "..");
const TOOL = path.join(__dirname, "collect-status.js");
const PACKS = path.join(ROOT, "data", "onepiece-packs.json");
const FAKE_FILE = path.join(ROOT, "data", "__test-fake-series.json");

const run = () => JSON.parse(execFileSync(process.execPath, [TOOL, "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }));
const fail = (m) => { console.error("FAIL: " + m); process.exitCode = 1; };

const original = fs.readFileSync(PACKS, "utf8");
let ok = true;

try {
  // ── 1) 평시엔 조용해야 한다 ──────────────────────────────────
  const base = run();
  if (base.untracked.length) { fail("평시에 파일 UNTRACKED 가 있다: " + base.untracked.join(",")); ok = false; }
  if (base.packsUntracked.length) { fail("평시에 packs UNTRACKED 가 있다: " + base.packsUntracked.slice(0, 5).join(",")); ok = false; }

  // ── 2) 새 시계열 파일을 심으면 잡아야 한다 ────────────────────
  fs.writeFileSync(FAKE_FILE, JSON.stringify({
    points: ["2026-09-01", "2026-09-02", "2026-08-30", "2026-08-29", "2026-08-28", "2026-08-27"].map((d) => ({ d })),
  }), "utf8");
  const withFile = run();
  if (!withFile.untracked.includes("__test-fake-series.json")) {
    fail("새 시계열 파일을 못 잡는다 — 파일 그물이 죽었다"); ok = false;
  }
  fs.unlinkSync(FAKE_FILE);

  // ── 3) packs.json 에 새 수집 필드를 심으면 잡아야 한다 ────────
  const j = JSON.parse(original);
  const setKey = Object.keys(j.sets)[0];
  j.sets[setKey].__testFakeCollector = { updated: "2026-09-02" };
  fs.writeFileSync(PACKS, JSON.stringify(j), "utf8");
  const withField = run();
  if (!withField.packsUntracked.some((p) => p.includes("__testFakeCollector"))) {
    fail("packs.json 의 새 수집 필드를 못 잡는다 — packs 그물이 죽었다(정규식의 \\d·\\. 이스케이프 확인)"); ok = false;
  }
} finally {
  // 원장은 무슨 일이 있어도 되돌린다. 시험 흔적이 데이터에 남으면 그게 더 큰 사고다.
  fs.writeFileSync(PACKS, original, "utf8");
  if (fs.existsSync(FAKE_FILE)) fs.unlinkSync(FAKE_FILE);
}

// ── 4) 등록된 수집원이 전부 날짜를 읽어내는가 ────────────────
// get() 이 null 을 주면 "기록 없음"으로 뜨는데, 그게 진짜 미수집인지 내가 필드명을 틀린 건지
// 구분이 안 된다. 그 상태를 방치하면 늙은 수집을 영영 못 본다.
const now = run();
const blind = now.rows.filter((r) => r.last == null);
if (blind.length) {
  fail("최신일을 못 읽는 수집원: " + blind.map((r) => r.key).join(",") + " (필드명이 틀렸을 수 있다)");
  ok = false;
}

console.log(JSON.stringify({
  test: ok && !process.exitCode ? "OK" : "FAIL",
  sources: now.rows.length,
  auto: now.rows.filter((r) => r.mode === "auto").length,
  manual: now.rows.filter((r) => r.mode === "manual").length,
}));
