const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** Counts two-hour self-heal windows that should already have run today. */
function elapsedDailyOpportunities(now) {
  const hour = new Date(now).getUTCHours();
  let count = 0;
  for (let scheduled = 1; scheduled <= hour; scheduled += 2) count += 1;
  return count;
}

/** Pure decision layer: converts artifact health into deduplicated workflow requests and alerts. */
function buildHealPlan(input) {
  const requests = [];
  const alerts = [...(input.previousDayProblems || [])];
  const auction = input.auction || {};
  const tcg = input.tcg || {};
  const recovery = input.previousDayRecovery || {};

  if (recovery.auction || auction.staleMinutes > 150 || auction.due > 200 || auction.urgent > 0) {
    requests.push({
      key: "auction",
      workflow: "settle-auctions.yml",
      reason: `${recovery.auction ? "직전 완료일 불완전 · " : ""}정산 공백 ${auction.staleMinutes}분 · 대기 ${auction.due}건 · 임박 ${auction.urgent}건 · 최고령 ${auction.oldestHours}시간`,
    });
    if (auction.staleMinutes >= 390) alerts.push("경매 정산 복구 기회가 3회 이상 지났는데도 실제 원장이 갱신되지 않았습니다");
  }

  if (recovery.tcg || !tcg.snapshotToday || tcg.due > 800 || tcg.urgent > 0) {
    requests.push({
      key: "tcg",
      workflow: "collect-tcg.yml",
      reason: `${recovery.tcg ? "직전 완료일 정산 부족 · " : ""}오늘 스냅샷 ${tcg.snapshotToday ? 1 : 0} · 대기 ${tcg.due}건 · 임박 ${tcg.urgent}건`,
    });
    if (!tcg.snapshotToday && elapsedDailyOpportunities(input.now) >= 3) {
      alerts.push("TCG 스냅샷 복구 기회가 3회 이상 지났는데도 오늘 관측이 없습니다");
    }
  }

  if (new Date(input.now).getUTCHours() >= 20 && !input.activeListingsFresh) {
    requests.push({ key: "active", workflow: "update-active-listings.yml", reason: "오늘 매물 관측 없음" });
  }
  if (!input.fxFresh) requests.push({ key: "fx", workflow: "update-fx.yml", reason: "오늘 환율 없음" });
  return { requests, alerts };
}

/** Treats cancellation/timeouts as failures and requires three completed failures in a row. */
function hasThreeConsecutiveFailures(runs) {
  const completed = runs.filter((run) => run?.status === "completed").slice(0, 3);
  return completed.length === 3 && completed.every((run) => FAILED_CONCLUSIONS.has(run.conclusion));
}

module.exports = { buildHealPlan, elapsedDailyOpportunities, hasThreeConsecutiveFailures };
