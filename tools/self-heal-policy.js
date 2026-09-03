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
  const search = input.search || {};
  const window = input.window || {};
  const windowOpen = Number.isFinite(window.minutesOpen) ? window.minutesOpen : null;

  // 쿼터 창(07:00 UTC 리셋)이 열리고 45분이 지났는데 전수 검색이 없으면 돌린다 — 2026-09-03 GitHub 이 창 첫 크론
  // (07:20)을 건너뛰었다. 전수는 시장 관측점 + 24시간 감시 지평이라 보충으로 대신할 수 없다.
  const needSweep = windowOpen != null && windowOpen > 45 && window.opSwept === false;
  if (needSweep) {
    requests.push({ key: "sweep", workflow: "collect-auction-market.yml", inputs: { mode: "full" }, reason: `창 열린 지 ${windowOpen}분 · 이번 창 전수 검색 없음` });
    if (windowOpen > 180) alerts.push("쿼터 창이 열린 지 3시간이 지났는데 원피스 전수 검색이 돌지 않았습니다");
  }

  // 검색이 맨 앞이다. 감시목록에 진행 중 경매가 없으면 지금 끝나는 경매를 영구히 놓치는 중이다 —
  // 정산·스냅샷은 뒤에 다시 할 수 있지만 이건 못 한다. 보충(--topup)은 ~50콜이라 부담이 없다.
  // 전수를 이미 요청했으면 같은 워크플로라 보충은 겹친다(전수가 감시목록도 채운다).
  if (!needSweep && Number.isFinite(search.liveWatched) && search.liveWatched < 20) {
    requests.push({
      key: "search",
      workflow: "collect-auction-market.yml",
      reason: `원피스 감시목록 진행중 ${search.liveWatched}건 · 마지막 종료 ${search.newestEndMinutes}분 전`,
    });
    if (search.liveWatched === 0 && search.newestEndMinutes > 180) {
      alerts.push("원피스 감시목록이 3시간 넘게 비어 있습니다 — 검색이 돌지 않아 그 사이 종료 경매를 영구히 놓치는 중입니다");
    }
  }

  if (recovery.auction || auction.staleMinutes > 150 || auction.due > 200 || auction.urgent > 0) {
    requests.push({
      key: "auction",
      workflow: "settle-auctions.yml",
      reason: `${recovery.auction ? "직전 완료일 불완전 · " : ""}정산 공백 ${auction.staleMinutes}분 · 대기 ${auction.due}건 · 임박 ${auction.urgent}건 · 최고령 ${auction.oldestHours}시간`,
    });
    if (auction.staleMinutes >= 390) alerts.push("경매 정산 복구 기회가 3회 이상 지났는데도 실제 원장이 갱신되지 않았습니다");
  }

  // 이번 창에 TCG 정산이 한 번도 안 돌았는데 대기가 있으면 돌린다 — backlog 800 기준만으로는 창 첫 크론 누락을 못 잡는다.
  const tcgUnchecked = windowOpen != null && windowOpen > 60 && window.tcgChecked === false && tcg.due > 0;
  if (recovery.tcg || !tcg.snapshotToday || tcg.due > 800 || tcg.urgent > 0 || tcgUnchecked) {
    requests.push({
      key: "tcg",
      workflow: "collect-tcg.yml",
      reason: `${recovery.tcg ? "직전 완료일 정산 부족 · " : ""}${tcgUnchecked ? `창 열린 지 ${windowOpen}분 정산 없음 · ` : ""}오늘 스냅샷 ${tcg.snapshotToday ? 1 : 0} · 대기 ${tcg.due}건 · 임박 ${tcg.urgent}건`,
    });
    if (tcgUnchecked && windowOpen > 240) alerts.push("쿼터 창이 열린 지 4시간이 지났는데 TCG 정산이 한 번도 돌지 않았습니다");
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
