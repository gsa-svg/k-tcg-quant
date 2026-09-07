#!/usr/bin/env node
const assert = require("node:assert/strict");
const { ensureWorkflowDispatch, retry, createGitHubWorkflowClient } = require("./workflow-dispatch");

(async () => {
  // dispatch 입력이 본문에 실려야 한다 — 전수 검색(mode=full)은 입력 없이는 보충(topup)으로 돈다.
  const bodies = [];
  const client = createGitHubWorkflowClient({ token: "t", repository: "o/r", fetchImpl: async (url, init) => { bodies.push(JSON.parse(init.body)); return { ok: true }; } });
  await client.dispatch("collect-auction-market.yml", { mode: "full" });
  await client.dispatch("collect-tcg.yml");
  assert.deepEqual(bodies, [{ ref: "main", inputs: { mode: "full" } }, { ref: "main" }]);

  const delays = [];
  let calls = 0;
  const value = await retry(async () => {
    calls += 1;
    if (calls < 3) throw new Error("temporary");
    return "ok";
  }, { attempts: 3, baseDelayMs: 100, sleep: async (ms) => delays.push(ms) });
  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(delays, [100, 200], "retry backoff must increase and remain bounded");

  let exhausted = 0;
  await assert.rejects(() => retry(async () => { throw new Error("down"); }, {
    attempts: 3,
    baseDelayMs: 10,
    sleep: async () => {},
    onExhausted: () => { exhausted += 1; },
  }), /down/);
  assert.equal(exhausted, 1, "the third failed attempt must emit exactly one exhaustion alert");

  let sends = 0;
  const skipped = await ensureWorkflowDispatch({
    workflow: "collect-tcg.yml",
    listRuns: async () => [{ status: "in_progress" }],
    send: async () => { sends += 1; },
  });
  assert.equal(skipped.status, "already_running");
  assert.equal(sends, 0, "active-run dedupe must prevent duplicate external dispatch");

  const sent = await ensureWorkflowDispatch({
    workflow: "collect-tcg.yml",
    listRuns: async () => [{ status: "completed", conclusion: "cancelled" }],
    send: async () => { sends += 1; },
    sleep: async () => {},
  });
  assert.equal(sent.status, "dispatched");
  assert.equal(sends, 1, "a cancelled prior run must transition back to a new dispatch");

  // 쿨다운: 최근 실행이 있으면 결손이 남아 있어도 다시 쏘지 않는다(9/6 하루 56회 재실행 방지)
  const recent = await ensureWorkflowDispatch({
    workflow: "collect-tcg.yml",
    cooldownMinutes: 150,
    now: "2026-09-06T10:00:00.000Z",
    listRuns: async () => [{ status: "completed", conclusion: "success", created_at: "2026-09-06T09:20:00.000Z" }],
    send: async () => { sends += 1; },
  });
  assert.equal(recent.status, "cooldown");
  assert.equal(sends, 1, "a run 40 minutes ago must block a re-dispatch inside the 150-minute cooldown");
  const stale = await ensureWorkflowDispatch({
    workflow: "collect-tcg.yml",
    cooldownMinutes: 150,
    now: "2026-09-06T13:00:00.000Z",
    listRuns: async () => [{ status: "completed", conclusion: "success", created_at: "2026-09-06T09:20:00.000Z" }],
    send: async () => { sends += 1; },
    sleep: async () => {},
  });
  assert.equal(stale.status, "dispatched");
  assert.equal(sends, 2, "once the cooldown has passed the request goes out again");
  console.log("workflow dispatch tests passed");
})().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
