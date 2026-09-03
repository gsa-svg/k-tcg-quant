#!/usr/bin/env node
const assert = require("node:assert/strict");
const { ensureWorkflowDispatch, retry } = require("./workflow-dispatch");

(async () => {
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
  console.log("workflow dispatch tests passed");
})().catch((error) => {
  console.error(error.stack);
  process.exit(1);
});
