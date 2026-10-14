const FAILED_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);
// 오늘 TCG 스냅샷을 요청·경고하는 UTC 시각(자정 뒤 분) — 2026-10-14.
const SNAPSHOT_DUE_MINUTE = 15;
const SNAPSHOT_ALERT_MINUTE = 60;
const SNAPSHOT_QUOTA_ALERT_UNTIL = 180;   // 쿼터 부족 건너뜀 경고는 이 시각(자정 뒤 분) 전까지만 — 하루 한 번

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

  // 검색(전수·보충)과 정산은 같은 원장(auction-watch.json)을 통째로 다시 쓴다. 한 회차에 둘을 같이 쏘면 2초 차이로 동시에 돌아
  // 정산 커밋이 리베이스 충돌로 버려진다(2026-09-07 07:47 UTC 실측 — concurrency 그룹이 같은데도 막지 못했다).
  // 검색을 쏜 회차엔 정산을 미룬다. 정산은 다음 하트비트(30분 뒤)나 크론이 잡는다 — 30시간 시한 안이라 잃는 건 없다.
  const ledgerBusy = requests.some((r) => r.workflow === "collect-auction-market.yml");
  if (!ledgerBusy && (recovery.auction || auction.staleMinutes > 150 || auction.due > 200 || auction.urgent > 0)) {
    requests.push({
      key: "auction",
      workflow: "settle-auctions.yml",
      reason: `${recovery.auction ? "직전 완료일 불완전 · " : ""}정산 공백 ${auction.staleMinutes}분 · 대기 ${auction.due}건 · 임박 ${auction.urgent}건 · 최고령 ${auction.oldestHours}시간`,
    });
    if (auction.staleMinutes >= 390) alerts.push("경매 정산 복구 기회가 3회 이상 지났는데도 실제 원장이 갱신되지 않았습니다");
  }

  // 이번 창에 TCG 정산이 한 번도 안 돌았는데 대기가 있으면 돌린다 — backlog 800 기준만으로는 창 첫 크론 누락을 못 잡는다.
  const tcgUnchecked = windowOpen != null && windowOpen > 60 && window.tcgChecked === false && tcg.due > 0;
  // 창 마감 소진 — 2026-09-08. TCG 는 원피스 몫을 다 남기고 나머지만 쓰므로 실제 몫은 창 끝(06:45 UTC 드레인)에 생긴다.
  // 그 크론이 안 오면 남은 콜이 리셋에 사라지고 그날 TCG 표본은 굶는다(9/7: 38건). 마감 60분 전부터 대기가 있으면 요청한다.
  const drainDue = windowOpen != null && windowOpen >= 1380 && windowOpen < 1440 && tcg.due > 0;
  // 오늘(UTC 날짜) 스냅샷 — 2026-10-14. 00:15 UTC 가 지나도 오늘 점이 없으면 바로 쏜다(쿨다운 0 — self-heal-daily cooldownFor).
  // 하트비트(로컬 30분, :17·:47)가 00:17 에 이 요청을 내면 00:18 에 찍힌다(실측 10일 모두). 표본은 "그 순간 종료 임박 순"
  // 이라 찍는 시각이 곧 표본이다 — 크론 지연·백로그 재실행에 맡기면 01~03시·07시로 흩어졌다(60일 중 11일 표준 밖).
  const utcMinutes = Number.isFinite(Date.parse(input.now)) ? new Date(input.now).getUTCHours() * 60 + new Date(input.now).getUTCMinutes() : null;
  // 쿼터 부족으로 건너뛴 날(tcg.snapshotQuotaSkip — 감시 파일 snapshotSkip, 리셋 전)은 스냅샷을 이유로 다시 쏘지 않는다 — 2026-10-14 QA.
  // 리셋(07:00 UTC)까지 잔여가 늘지 않아 하트비트마다 빈 실행만 ~14회 돌았다. 리셋이 지나면 도장이 풀려 바로 쏜다.
  const snapshotDue = !tcg.snapshotToday && !tcg.snapshotQuotaSkip && utcMinutes != null && utcMinutes >= SNAPSHOT_DUE_MINUTE;
  if (recovery.tcg || snapshotDue || tcg.due > 800 || tcg.urgent > 0 || tcgUnchecked || drainDue) {
    requests.push({
      key: "tcg",
      workflow: "collect-tcg.yml",
      reason: `${drainDue ? `창 마감 ${1440 - windowOpen}분 전 남은 쿼터 소진 · ` : ""}${recovery.tcg ? "직전 완료일 정산 부족 · " : ""}${tcgUnchecked ? `창 열린 지 ${windowOpen}분 정산 없음 · ` : ""}오늘 스냅샷 ${tcg.snapshotToday ? 1 : 0} · 대기 ${tcg.due}건 · 임박 ${tcg.urgent}건`,
    });
    if (tcgUnchecked && windowOpen > 240) alerts.push("쿼터 창이 열린 지 4시간이 지났는데 TCG 정산이 한 번도 돌지 않았습니다");
  }
  // 01:00 UTC 가 지나도 오늘 점이 없으면 경고 — 00:18 실행이 실패로 건너뛴 것이다(표준 시각 00~04 UTC 안에 다시 쏘는 중).
  // 쿼터 부족으로 건너뛴 날은 하루 한 번만 — 01:00~02:59 UTC(크론 자가치유 01:50 회차). 03:50·05:50 은 같은 사실의 반복이다.
  if (!tcg.snapshotToday && utcMinutes != null && utcMinutes >= SNAPSHOT_ALERT_MINUTE) {
    if (!tcg.snapshotQuotaSkip) alerts.push("UTC 01:00 이 지났는데 오늘 TCG 스냅샷이 없습니다");
    else if (utcMinutes < SNAPSHOT_QUOTA_ALERT_UNTIL) alerts.push("오늘 TCG 스냅샷이 eBay 쿼터 부족으로 건너뛰었습니다 — 쿼터 리셋(07:00 UTC) 뒤에 찍힙니다");
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

module.exports = { buildHealPlan, hasThreeConsecutiveFailures, SNAPSHOT_DUE_MINUTE, SNAPSHOT_ALERT_MINUTE, SNAPSHOT_QUOTA_ALERT_UNTIL };
