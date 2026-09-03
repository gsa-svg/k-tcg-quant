#!/usr/bin/env node
// 예산 모듈의 창(window) 규칙이 워크플로 크론과 어긋나지 않는지 — 2026-09-03 리셋 창(07:00 UTC) 기준으로 재작성.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { SCHEDULE, PER_RUN, reserveLeft, isLastRunBeforeReset, nextReset, runsBeforeReset, auctionNeed, RESET_UTC_HOUR } = require("./ebay-budget");

const cronHours = (file) => {
  const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", file), "utf8");
  return [...workflow.matchAll(/cron:\s*["']\d+\s+([\d,]+)\s+\*\s+\*\s+\*["']/g)]
    .flatMap((match) => match[1].split(",").map(Number))
    .sort((a, b) => a - b);
};

assert.equal(RESET_UTC_HOUR, 7, "eBay Browse quota resets at 07:00 UTC (measured 2026-09-03)");
assert.deepEqual([...SCHEDULE.tcg], cronHours("collect-tcg.yml"), "TCG reservation schedule must match every collect-tcg cron hour");
assert.deepEqual([...SCHEDULE.search], cronHours("collect-auction-market.yml"), "search reservation schedule must match every collect-auction-market cron hour");

const at = (iso) => Date.parse(iso);
// 리셋 계산: 07:00 UTC 전이면 오늘, 지났으면 내일.
assert.equal(nextReset(at("2026-09-03T06:30:00Z")), at("2026-09-03T07:00:00Z"));
assert.equal(nextReset(at("2026-09-03T07:00:01Z")), at("2026-09-04T07:00:00Z"));
assert.equal(nextReset(at("2026-09-03T22:10:00Z")), at("2026-09-04T07:00:00Z"));

// 예약은 "리셋 전에 그 워크플로가 더 도는가"로만 결정된다 — 자정 기준이 아니다.
const reset = at("2026-09-04T07:00:00Z");
assert.equal(runsBeforeReset([1, 4, 7], at("2026-09-03T22:10:00Z"), reset), true, "01:30/04:30 UTC runs are still inside the window");
assert.equal(runsBeforeReset([7, 10], at("2026-09-03T22:10:00Z"), reset), false, "the 07:30 run belongs to the next window");
assert.equal(reserveLeft("tcg", at("2026-09-03T22:10:00Z"), reset), PER_RUN.tcg);
assert.equal(reserveLeft("tcg", at("2026-09-04T05:00:00Z"), reset), PER_RUN.tcg, "the 06:45 drain run is still ahead at 05:00");
assert.equal(reserveLeft("tcg", at("2026-09-04T06:50:00Z"), reset), 0, "after the last in-window TCG run nothing is reserved");
assert.equal(reserveLeft("search", at("2026-09-04T03:00:00Z"), reset), PER_RUN.search, "the 04:20 top-up is still ahead");
assert.equal(reserveLeft("search", at("2026-09-04T06:50:00Z"), reset), 0);
assert.equal(reserveLeft("safety", at("2026-09-04T06:50:00Z"), reset), PER_RUN.safety, "safety is never released");
// 창 마지막 회차는 남김 없이 쓴다(소유자: 남으면 포켓몬). 06:45 TCG 회차 뒤엔 리셋까지 TCG 실행이 없다.
assert.equal(isLastRunBeforeReset("tcg", at("2026-09-04T06:46:00Z"), reset), true, "the 06:45 UTC TCG run is the last before the 07:00 reset");
assert.equal(isLastRunBeforeReset("tcg", at("2026-09-04T04:31:00Z"), reset), false, "04:30 still has the 06:45 run ahead");
assert.equal(isLastRunBeforeReset("safety", at("2026-09-04T06:46:00Z"), reset), false, "unscheduled keys never drain");
// 종전 버그 재현 방지: 06:30 UTC 에 "오늘" 남은 실행을 자정 기준으로 세면 예약이 잔여를 넘는다.
assert.equal(reserveLeft("tcg", at("2026-09-03T06:30:00Z")), 0, "06:30 UTC: the next TCG run (07:30) is past the 07:00 reset");

// 원피스가 이 창에서 끝나는 건수 = 감시목록의 실제 개수(추정 아님). 리셋 뒤 종료분은 다음 창 몫.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opbox-budget-"));
fs.mkdirSync(path.join(root, "data"));
fs.writeFileSync(path.join(root, "data", "auction-watch.json"), JSON.stringify({ pending: [
  { id: "a", endsAt: "2026-09-04T03:00:00Z" },
  { id: "b", endsAt: "2026-09-04T06:59:00Z" },
  { id: "c", endsAt: "2026-09-04T07:30:00Z" },
] }));
fs.writeFileSync(path.join(root, "data", "palworld-auction-watch.json"), JSON.stringify({ pending: [{ id: "p", endsAt: "2026-09-04T01:00:00Z" }] }));
try {
  assert.equal(auctionNeed(reset, root), 3);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
console.log("eBay budget schedule tests passed");
