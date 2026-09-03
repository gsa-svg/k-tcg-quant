#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildHealPlan, hasThreeConsecutiveFailures } = require("./self-heal-policy");
const { previousDayAssessment } = require("./collection-continuity");
const { recordSummary } = require("./self-heal-daily");

const healthy = {
  now: "2026-09-03T07:50:00.000Z",
  search: { liveWatched: 500, newestEndMinutes: -600 },
  auction: { staleMinutes: 45, due: 20, urgent: 0, oldestHours: 1 },
  tcg: { snapshotToday: true, due: 100, urgent: 0 },
  activeListingsFresh: true,
  fxFresh: true,
  previousDayProblems: [],
};
assert.deepEqual(buildHealPlan(healthy), { requests: [], alerts: [] });

// 감시목록에 진행 중 경매가 없으면 검색이 안 도는 것 — 지금 끝나는 경매를 영구히 놓치는 중이다(9/2·9/3 사고).
const emptyWatch = buildHealPlan({ ...healthy, search: { liveWatched: 0, newestEndMinutes: 400 } });
assert.deepEqual(emptyWatch.requests.map((r) => r.key), ["search"], "an empty watch list must dispatch a search top-up first");
assert.ok(emptyWatch.alerts.some((a) => /감시목록.*비어/.test(a)), "a watch list empty for hours must alert");
const thinWatch = buildHealPlan({ ...healthy, search: { liveWatched: 5, newestEndMinutes: -30 } });
assert.deepEqual(thinWatch.requests.map((r) => r.key), ["search"]);
assert.deepEqual(thinWatch.alerts, [], "a thin but recently refilled watch list is a request, not an alert");

const missingTcg = buildHealPlan({ ...healthy, tcg: { ...healthy.tcg, snapshotToday: false } });
assert.deepEqual(missingTcg.requests.map((r) => r.key), ["tcg"]);
assert.ok(missingTcg.alerts.some((a) => /3회 이상/.test(a)), "a day still missing after three heal windows must alert");

const staleAuction = buildHealPlan({ ...healthy, auction: { staleMinutes: 450, due: 326, urgent: 2, oldestHours: 22 } });
assert.deepEqual(staleAuction.requests.map((r) => r.key), ["auction"]);
assert.ok(staleAuction.alerts.some((a) => /3회 이상/.test(a)), "prolonged settlement failure must alert");

const previousDay = buildHealPlan({ ...healthy, previousDayProblems: ["원피스 경매 일별 — 2026-09-02 부분수집"] });
assert.equal(previousDay.requests.length, 0, "irrecoverable previous-day observations must not trigger misleading recollection");
assert.equal(previousDay.alerts.length, 1);

const recoverablePreviousDay = buildHealPlan({
  ...healthy,
  previousDayProblems: ["원피스 경매 일별 — 부분수집", "TCG 정산 일별 — 처리량 부족"],
  previousDayRecovery: { auction: true, tcg: true },
});
assert.deepEqual(recoverablePreviousDay.requests.map((request) => request.key), ["auction", "tcg"], "previous-day settlement gaps must be retried before eBay's 30-hour window closes");

const missingSnapshot = previousDayAssessment({ auctionSeries: { daily: [{ d: "2026-09-02" }] }, tcgSnapshot: { points: [] }, tcgSeries: { daily: [] }, day: "2026-09-02", requirePresence: true });
assert.equal(missingSnapshot.recovery.auction, false);
assert.equal(missingSnapshot.recovery.tcg, true, "missing settlement rows may still be recovered from watched auctions");
assert.ok(missingSnapshot.problems.some((problem) => /TCG 시장 스냅샷.*기록 없음/.test(problem)), "missing snapshot must alert without pretending its inventory count can be recreated");

assert.equal(hasThreeConsecutiveFailures([
  { status: "completed", conclusion: "failure" },
  { status: "completed", conclusion: "timed_out" },
  { status: "completed", conclusion: "cancelled" },
]), true);
assert.equal(hasThreeConsecutiveFailures([
  { status: "completed", conclusion: "failure" },
  { status: "completed", conclusion: "success" },
  { status: "completed", conclusion: "failure" },
]), false);

const summaryPath = path.join(os.tmpdir(), `opbox-self-heal-${process.pid}.md`);
const previousSummaryPath = process.env.GITHUB_STEP_SUMMARY;
try {
  process.env.GITHUB_STEP_SUMMARY = summaryPath;
  recordSummary({ requests: [{ key: "tcg" }] }, [{ workflow: "collect-tcg.yml", status: "dispatched" }], ["three failures"]);
  const summary = fs.readFileSync(summaryPath, "utf8");
  assert.match(summary, /collect-tcg\.yml: dispatched/);
  assert.match(summary, /ALERT: three failures/);
} finally {
  if (previousSummaryPath == null) delete process.env.GITHUB_STEP_SUMMARY;
  else process.env.GITHUB_STEP_SUMMARY = previousSummaryPath;
  fs.rmSync(summaryPath, { force: true });
}
console.log("self-heal policy tests passed");
