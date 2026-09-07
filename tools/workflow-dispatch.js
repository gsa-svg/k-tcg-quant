const MAX_ATTEMPTS = 3;

/** Bounded retry with increasing backoff and one exhaustion notification hook. */
async function retry(operation, options = {}) {
  const attempts = Math.min(Math.max(1, options.attempts || MAX_ATTEMPTS), MAX_ATTEMPTS);
  const baseDelayMs = options.baseDelayMs ?? 10000;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      if (attempt === attempts) {
        options.onExhausted?.(error, attempt);
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      options.onRetry?.(error, attempt, delayMs);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

/** Checks for an active run before sending one idempotent workflow dispatch request. */
async function ensureWorkflowDispatch(options) {
  const logger = options.logger || console;
  logger.log(`[self-heal] ${options.workflow} dispatch check start`);
  const runs = await retry(options.listRuns, {
    attempts: 3,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    onRetry: (error, attempt, delay) => logger.warn(`[self-heal] run lookup retry ${attempt}/3 in ${delay}ms: ${error.message}`),
    onExhausted: (error) => logger.error(`::error::${options.workflow} run lookup failed after 3 attempts: ${error.message}`),
  });
  if (runs.some((run) => run?.status === "queued" || run?.status === "in_progress")) {
    logger.log(`[self-heal] ${options.workflow} already queued/running; duplicate skipped`);
    return { status: "already_running", runs };
  }
  // 쿨다운: 최근 실행(크론이든 dispatch 든)이 cooldownMinutes 안에 있으면 다시 쏘지 않는다 — 2026-09-07.
  // 30분 하트비트가 같은 결손을 보고 하루 56번 재실행을 요청했다(9/6 실측). 결손이 그 사이에 사라질 리 없는데
  // 매번 쐈다. 상태 파일 없이 GitHub 실행 이력만으로 판단하므로 PC·클라우드 어느 쪽이 불러도 같은 답이 나온다.
  const cooldownMs = (options.cooldownMinutes || 0) * 60000;
  const newest = runs.map((run) => Date.parse(run?.created_at || 0)).filter(Number.isFinite).sort((a, b) => b - a)[0];
  const nowMs = options.now ? Date.parse(options.now) : Date.now();
  if (cooldownMs > 0 && newest && nowMs - newest < cooldownMs) {
    logger.log(`[self-heal] ${options.workflow} ran ${Math.round((nowMs - newest) / 60000)} min ago; within ${options.cooldownMinutes} min cooldown, skipped`);
    return { status: "cooldown", runs };
  }
  await retry(options.send, {
    attempts: 3,
    baseDelayMs: options.baseDelayMs,
    sleep: options.sleep,
    onRetry: (error, attempt, delay) => logger.warn(`[self-heal] dispatch retry ${attempt}/3 in ${delay}ms: ${error.message}`),
    onExhausted: (error) => logger.error(`::error::${options.workflow} dispatch failed after 3 attempts: ${error.message}`),
  });
  logger.log(`[self-heal] ${options.workflow} dispatch success`);
  return { status: "dispatched", runs };
}

/** Minimal GitHub Actions client; credentials remain in request headers and are never logged. */
function createGitHubWorkflowClient({ token, repository, fetchImpl = fetch }) {
  if (!token || !repository) throw new Error("GH_TOKEN and GITHUB_REPOSITORY are required");
  const base = `https://api.github.com/repos/${repository}/actions/workflows`;
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  return {
    async listRuns(workflow) {
      const response = await fetchImpl(`${base}/${workflow}/runs?per_page=10`, { headers });
      if (!response.ok) throw new Error(`GitHub runs ${workflow}: HTTP ${response.status}`);
      return (await response.json()).workflow_runs || [];
    },
    // inputs: workflow_dispatch 입력(예: collect-auction-market 의 mode=full). 없으면 워크플로 기본값이 쓰인다.
    async dispatch(workflow, inputs) {
      const response = await fetchImpl(`${base}/${workflow}/dispatches`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(inputs ? { ref: "main", inputs } : { ref: "main" }),
      });
      if (!response.ok) throw new Error(`GitHub dispatch ${workflow}: HTTP ${response.status}`);
    },
  };
}

module.exports = { MAX_ATTEMPTS, retry, ensureWorkflowDispatch, createGitHubWorkflowClient };
