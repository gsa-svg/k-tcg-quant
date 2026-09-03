#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { previousDayAssessment } = require("./collection-continuity");
const { buildHealPlan, hasThreeConsecutiveFailures } = require("./self-heal-policy");
const { createGitHubWorkflowClient, ensureWorkflowDispatch } = require("./workflow-dispatch");
const { nextReset } = require("./ebay-budget");

const ROOT = path.resolve(__dirname, "..");
const DAY = 86400000;
const iso = (time) => new Date(time).toISOString().slice(0, 10);
const readJson = (relativePath) => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")); }
  catch { return null; }
};

/** Reads at most today's and yesterday's append-only archives to find the latest processed row. */
function newestSettlementTime(days) {
  let newest = 0;
  for (const day of days) {
    for (const row of readJson(`data/auction-archive/${day}.json`)?.sales || []) {
      const time = Date.parse(row.settledAt || row.endedAt || 0);
      if (time > newest) newest = time;
    }
    if (newest) break;
  }
  return newest;
}

/** Summarizes due and source-expiry-risk items without mutating the watch ledger. */
function backlogSummary(pending, nowMs) {
  let due = 0;
  let urgent = 0;
  let oldestHours = 0;
  for (const row of pending || []) {
    const ended = Date.parse(row.endsAt || row.end || 0);
    if (!ended || ended >= nowMs) continue;
    const ageHours = (nowMs - ended) / 3600000;
    due += 1;
    oldestHours = Math.max(oldestHours, ageHours);
    if (ageHours > 20) urgent += 1;
  }
  return { due, urgent, oldestHours: Math.round(oldestHours) };
}

/** Builds the filesystem-only health input consumed by the pure policy. */
function inspectArtifacts(now = new Date()) {
  const nowMs = now.getTime();
  const today = iso(nowMs);
  const previousDay = iso(nowMs - DAY);
  const auctionSeries = readJson("data/auction-series.json");
  const tcgSnapshot = readJson("data/tcg-snapshot.json");
  const tcgSeries = readJson("data/tcg-series.json");
  const newest = newestSettlementTime([today, previousDay]);
  const auctionWatch = readJson("data/auction-watch.json");
  const auctionBacklog = backlogSummary(auctionWatch?.pending, nowMs);
  // 감시목록에 "아직 진행 중"인 원피스 경매가 없으면 검색이 안 돌고 있다는 뜻이다 — 2026-09-03.
  // 그 사이 끝나는 경매는 영구히 못 읽는다(9/2·9/3 사고). 정산 backlog 와 별개로 본다.
  let newestEnd = 0;
  let liveWatched = 0;
  for (const row of auctionWatch?.pending || []) {
    const ended = Date.parse(row.endsAt || 0);
    if (!ended) continue;
    if (ended > nowMs) liveWatched += 1;
    if (ended > newestEnd) newestEnd = ended;
  }
  const search = { liveWatched, newestEndMinutes: newestEnd ? Math.round((nowMs - newestEnd) / 60000) : 9999 };
  const tcgWatch = readJson("data/tcg-watch.json");
  const tcgBacklog = backlogSummary(tcgWatch?.pending, nowMs);
  // eBay 쿼터 창(07:00 UTC 리셋) 기준으로 "이번 창의 첫 실행이 있었나"를 산출물 도장으로 본다 — 2026-09-03.
  // GitHub 이 창 첫 크론(07:20 전수 검색·07:30 TCG)을 통째로 건너뛰었는데, 종전 기준(오늘 스냅샷 있음·backlog 800)
  // 으로는 정상으로 보여 4,800콜이 놀았다. 크론 실행 이력이 아니라 파일의 도장(sweptAt·checkedAt)을 믿는다.
  const windowStart = nextReset(nowMs) - DAY;
  const window = {
    minutesOpen: Math.round((nowMs - windowStart) / 60000),
    opSwept: Date.parse(readJson("data/auction-market.json")?.sweptAt || 0) >= windowStart,
    tcgChecked: Date.parse(tcgWatch?.checkedAt || 0) >= windowStart,
  };
  // known-gaps.json 에 등록된 영구 공백은 previous.known 으로 빠진다 — 재실행해도 돌아오지 않으므로 경고·dispatch 대상이 아니다.
  const previous = previousDayAssessment({ auctionSeries, tcgSnapshot, tcgSeries, day: previousDay, requirePresence: true, root: ROOT });
  return {
    now: now.toISOString(),
    today,
    previousDay,
    search,
    window,
    auction: { staleMinutes: newest ? Math.round((nowMs - newest) / 60000) : 9999, ...auctionBacklog },
    tcg: { snapshotToday: (tcgSnapshot?.points || []).some((point) => point?.d === today), ...tcgBacklog },
    activeListingsFresh: String(readJson("data/active-listing-audit.json")?.updated || "").slice(0, 10) === today,
    fxFresh: String(readJson("data/fx.json")?.date || "").slice(0, 10) === today,
    previousDayProblems: previous.problems,
    previousDayKnown: previous.known,
    previousDayRecovery: previous.recovery,
  };
}

/** Records a secret-free execution summary for the Actions run page. */
function recordSummary(plan, results, alerts) {
  const lines = ["### Self-heal result", "", `- Requests: ${plan.requests.length}`, `- Alerts: ${alerts.length}`];
  for (const result of results) lines.push(`- ${result.workflow}: ${result.status}`);
  for (const alert of alerts) lines.push(`- ALERT: ${alert}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const health = inspectArtifacts();
  const plan = buildHealPlan(health);
  const alerts = [...plan.alerts];
  const results = [];

  console.log(JSON.stringify({ health, plan }, null, 2));
  if (process.argv.includes("--dry-run")) return;

  if (plan.requests.length) {
    const client = createGitHubWorkflowClient({ token: process.env.GH_TOKEN, repository: process.env.GITHUB_REPOSITORY });
    for (const request of plan.requests) {
      try {
        const result = await ensureWorkflowDispatch({
          workflow: request.workflow,
          listRuns: () => client.listRuns(request.workflow),
          send: () => client.dispatch(request.workflow, request.inputs),
        });
        results.push({ workflow: request.workflow, status: result.status });
        if (hasThreeConsecutiveFailures(result.runs)) {
          alerts.push(`${request.workflow} 최근 완료 실행 3회가 연속 실패했습니다`);
        }
      } catch (error) {
        results.push({ workflow: request.workflow, status: "failed" });
        alerts.push(`${request.workflow} 재실행 요청이 3회 모두 실패했습니다: ${error.message}`);
      }
    }
  }

  const uniqueAlerts = [...new Set(alerts)];
  for (const alert of uniqueAlerts) console.error(`::error::${alert}`);
  recordSummary(plan, results, uniqueAlerts);
  console.log(JSON.stringify({ selfHeal: uniqueAlerts.length ? "ALERT" : "OK", results, alerts: uniqueAlerts }));
  if (uniqueAlerts.length) process.exitCode = 1;
}

if (require.main === module) main().catch((error) => {
  console.error(`::error::self-heal crashed: ${error.stack || error.message}`);
  process.exit(1);
});

module.exports = { backlogSummary, inspectArtifacts, newestSettlementTime, recordSummary };
