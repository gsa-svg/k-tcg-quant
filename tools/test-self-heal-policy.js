#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { buildHealPlan, hasThreeConsecutiveFailures, SNAPSHOT_DUE_MINUTE, SNAPSHOT_ALERT_MINUTE, SNAPSHOT_QUOTA_ALERT_UNTIL } = require("./self-heal-policy");
const { previousDayAssessment } = require("./collection-continuity");
const { recordSummary, backlogSummary, COOLDOWN_MINUTES, snapshotOnDay, snapshotQuotaSkip, cooldownFor } = require("./self-heal-daily");

// 창 첫 실행(스냅샷 없음 / 이번 창 정산 없음)은 쿨다운 0 — 크론 누락을 메우는 일을 이력 때문에 미루지 않는다
{
  const base = { tcg: { snapshotToday: true }, window: { minutesOpen: 100, tcgChecked: true } };
  assert.equal(cooldownFor({ key: "tcg" }, base), COOLDOWN_MINUTES.tcg);
  assert.equal(cooldownFor({ key: "tcg" }, { ...base, tcg: { snapshotToday: false } }), 0, "no snapshot in this window: dispatch now");
  assert.equal(cooldownFor({ key: "tcg" }, { ...base, window: { minutesOpen: 100, tcgChecked: false } }), 0, "no settlement in this window: dispatch now");
  assert.equal(cooldownFor({ key: "tcg" }, { ...base, window: { minutesOpen: 30, tcgChecked: false } }), COOLDOWN_MINUTES.tcg, "30 min in, the cron still has its chance");
  assert.equal(cooldownFor({ key: "auction" }, base), COOLDOWN_MINUTES.auction);
}

// 스냅샷 판정은 UTC 날짜 기준(2026-10-14 정정): 자정을 넘기면 전날 점은 오늘 몫이 아니다 — 00~07 UTC 에 전날 점을
// 오늘 몫으로 쳐서 스냅샷을 이유로 실행을 쏘지 않았고, 찍는 시각이 크론 지연에 좌우됐다(60일 중 11일 표준 시각 밖).
assert.equal(snapshotOnDay([{ d: "2026-09-06" }], "2026-09-07"), false, "자정을 넘기면 전날 점은 오늘 점이 아니다");
assert.equal(snapshotOnDay([{ d: "2026-09-06" }, { d: "2026-09-07" }], "2026-09-07"), true);
assert.equal(snapshotOnDay([], "2026-09-07"), false);

// due 는 아직 읽을 수 있는 것(종료 후 30시간 안)만 — 시한 지난 건은 lost 로 분리(9/6: 만료 6천 건이 due 에 섞여 30분마다 재실행)
{
  const now = Date.parse("2026-09-07T00:00:00.000Z");
  const h = (hours) => new Date(now - hours * 3600000).toISOString();
  const summary = backlogSummary([{ end: h(-2) }, { end: h(1) }, { end: h(25) }, { end: h(31) }, { end: h(100) }], now);
  assert.deepEqual(summary, { due: 2, urgent: 1, lost: 2, oldestHours: 25 });
  assert.ok(COOLDOWN_MINUTES.tcg >= 120 && COOLDOWN_MINUTES.auction >= 30, "재실행 쿨다운은 워크플로 정상 주기에 가깝게");
}

const healthy = {
  now: "2026-09-03T07:50:00.000Z",
  search: { liveWatched: 500, newestEndMinutes: -600 },
  window: { minutesOpen: 50, opSwept: true, tcgChecked: true },
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

// 쿼터 창이 열렸는데 첫 실행(전수 검색·TCG 정산)이 없으면 크론이 빠진 것 — 2026-09-03 실제로 07:20·07:30 이 통째로 빠졌다.
const skippedWindow = buildHealPlan({ ...healthy, search: { liveWatched: 5, newestEndMinutes: -30 }, window: { minutesOpen: 100, opSwept: false, tcgChecked: false } });
assert.deepEqual(skippedWindow.requests.map((r) => r.key), ["sweep", "tcg"], "a fresh window with no sweep and no TCG settlement must dispatch both");
assert.deepEqual(skippedWindow.requests[0].inputs, { mode: "full" }, "the sweep must be a full scan, not a top-up");
assert.deepEqual(skippedWindow.alerts, [], "100 minutes in is a request, not yet an alert");
const lateWindow = buildHealPlan({ ...healthy, window: { minutesOpen: 300, opSwept: false, tcgChecked: false } });
assert.equal(lateWindow.alerts.length, 2, "hours without the window's first runs must alert for both");
const freshWindow = buildHealPlan({ ...healthy, window: { minutesOpen: 20, opSwept: false, tcgChecked: false } });
assert.deepEqual(freshWindow.requests, [], "right after the reset the scheduled runs have not had their chance yet");
const noBacklog = buildHealPlan({ ...healthy, tcg: { ...healthy.tcg, due: 0 }, window: { minutesOpen: 100, opSwept: true, tcgChecked: false } });
assert.deepEqual(noBacklog.requests, [], "nothing due means no TCG settlement to force");

// 창 마감 60분 전부터는 대기가 있으면 TCG 를 요청한다(남은 쿼터 소진) — 06:45 드레인 크론이 안 와도 잃지 않게
const drain = buildHealPlan({ ...healthy, window: { minutesOpen: 1397, opSwept: true, tcgChecked: true } });
assert.deepEqual(drain.requests.map((r) => r.key), ["tcg"], "the last hour of the window must dispatch the TCG drain");
assert.ok(/창 마감/.test(drain.requests[0].reason));
assert.equal(cooldownFor({ key: "tcg" }, { tcg: { snapshotToday: true }, window: { minutesOpen: 1397, tcgChecked: true } }), 15, "the drain is only lightly throttled");
const noDrain = buildHealPlan({ ...healthy, tcg: { ...healthy.tcg, due: 0 }, window: { minutesOpen: 1397, opSwept: true, tcgChecked: true } });
assert.deepEqual(noDrain.requests, [], "nothing due means nothing to drain");

// 오늘 스냅샷: UTC 00:15 이후 오늘 점이 없으면 collect-tcg 를 바로(쿨다운 0) 쏜다. 01:00 이 지나도 없으면 경고 — 2026-10-14.
// 창 정보(minutesOpen)는 자정 무렵 창의 끝(17시간째)이라 판정에 쓰지 않는다.
{
  const at = (hhmm) => ({ ...healthy, now: `2026-10-15T${hhmm}:00.000Z`, window: { minutesOpen: 1000, opSwept: true, tcgChecked: true }, tcg: { ...healthy.tcg, snapshotToday: false } });
  assert.equal(SNAPSHOT_DUE_MINUTE, 15);
  assert.equal(SNAPSHOT_ALERT_MINUTE, 60);
  assert.deepEqual(buildHealPlan(at("00:10")).requests, [], "00:15 전에는 요청하지 않는다");
  const due = buildHealPlan(at("00:17"));
  assert.deepEqual(due.requests.map((r) => r.key), ["tcg"], "00:17 하트비트는 오늘 스냅샷을 요청한다");
  assert.ok(/오늘 스냅샷 0/.test(due.requests[0].reason));
  assert.deepEqual(due.alerts, [], "00:17 은 요청이지 경고가 아니다");
  assert.equal(cooldownFor({ key: "tcg" }, at("00:17")), 0, "오늘 스냅샷 요청은 쿨다운 없이 바로 쏜다");
  const late = buildHealPlan(at("01:05"));
  assert.deepEqual(late.requests.map((r) => r.key), ["tcg"], "01:05 에도 없으면 계속 요청한다");
  assert.ok(late.alerts.some((a) => /UTC 01:00.*스냅샷/.test(a)), "01:00 이 지나도 없으면 경고");
  assert.deepEqual(buildHealPlan({ ...at("01:05"), tcg: { ...healthy.tcg, snapshotToday: true } }), { requests: [], alerts: [] }, "오늘 점이 있으면 아무것도 안 한다");

  // 쿼터 부족으로 건너뛴 날(감시 파일 snapshotSkip, 리셋 전) — 2026-10-14 QA. 리셋까지 잔여가 늘지 않으니 스냅샷을 이유로 다시
  // 쏘지 않고(00:17~07:00 빈 실행 ~14회), 경고는 01:00~02:59 UTC 한 번(크론 01:50)만 낸다.
  const quotaSkip = (hhmm) => ({ ...at(hhmm), tcg: { ...healthy.tcg, snapshotToday: false, snapshotQuotaSkip: true } });
  assert.deepEqual(buildHealPlan(quotaSkip("00:47")).requests, [], "쿼터 부족 건너뜀 뒤에는 스냅샷 요청을 내지 않는다");
  assert.notEqual(cooldownFor({ key: "tcg" }, quotaSkip("00:47")), 0, "다른 이유로 쏠 때도 쿨다운을 그대로 둔다");
  assert.ok(buildHealPlan(quotaSkip("01:50")).alerts.some((a) => /쿼터 부족/.test(a)), "01:50 크론은 한 번 경고한다");
  for (const t of ["03:50", "05:50"]) assert.deepEqual(buildHealPlan(quotaSkip(t)).alerts, [], `${t} 크론은 같은 경고를 반복하지 않는다`);
  assert.equal(SNAPSHOT_QUOTA_ALERT_UNTIL, 180);
  // 도장 판정: 오늘·쿼터 사유·리셋 전일 때만
  const now = Date.parse("2026-10-15T02:00:00Z");
  const skip = { d: "2026-10-15", reason: "quota", reset: "2026-10-15T07:00:00.000Z" };
  assert.equal(snapshotQuotaSkip(skip, "2026-10-15", now), true);
  assert.equal(snapshotQuotaSkip(skip, "2026-10-15", Date.parse("2026-10-15T07:05:00Z")), false, "리셋이 지나면 풀린다 — 바로 다시 쏜다");
  assert.equal(snapshotQuotaSkip({ ...skip, d: "2026-10-14" }, "2026-10-15", now), false, "전날 도장은 오늘 것이 아니다");
  assert.equal(snapshotQuotaSkip(undefined, "2026-10-15", now), false);
}
const missingTcg = buildHealPlan({ ...healthy, tcg: { ...healthy.tcg, snapshotToday: false } });
assert.deepEqual(missingTcg.requests.map((r) => r.key), ["tcg"]);
assert.ok(missingTcg.alerts.some((a) => /UTC 01:00/.test(a)), "07:50 UTC 에 오늘 점이 없으면 경고(00:18 실행이 건너뛰었다)");

// 검색(전수/보충)을 쏜 회차에는 정산을 같이 쏘지 않는다 — 같은 원장을 동시에 쓰면 정산 커밋이 충돌로 버려진다(2026-09-07 07:47 UTC)
const sweepAndStale = buildHealPlan({ ...healthy, window: { minutesOpen: 100, opSwept: false, tcgChecked: true }, auction: { staleMinutes: 450, due: 326, urgent: 2, oldestHours: 22 } });
assert.deepEqual(sweepAndStale.requests.map((r) => r.key), ["sweep"], "the sweep goes first; settlement waits for the next heartbeat");
const searchAndStale = buildHealPlan({ ...healthy, search: { liveWatched: 5, newestEndMinutes: -30 }, auction: { staleMinutes: 450, due: 326, urgent: 2, oldestHours: 22 } });
assert.deepEqual(searchAndStale.requests.map((r) => r.key), ["search"], "a top-up and a settlement never share a round");

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
