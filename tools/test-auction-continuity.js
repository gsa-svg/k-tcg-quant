#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const audit = path.join(__dirname, "audit-series-gaps.js");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opbox-continuity-"));
const dataDir = path.join(root, "data");
fs.mkdirSync(dataDir);

const write = (name, value) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(value), "utf8");
const activeGames = ["pokemonjp", "pokemon", "magic", "yugioh", "onepiece", "lorcana", "weiss", "digimon", "riftbound", "unionarena", "gundam", "dragonball", "palworld"];
const tcgDay = (d, missingKey = null) => ({
  d,
  games: activeGames.map((k) => ({
    k,
    live: k === missingKey ? null : 100,
    endingToday: 20,
  })),
});
const tcgSeriesDay = (d, thinKey = null) => ({
  d,
  games: Object.fromEntries(activeGames.map((key) => [key, { ended: key === thinKey ? 1 : 100 }])),
});

function runAudit() {
  const result = spawnSync(process.execPath, [audit, "--root", root, "--today", "2026-09-03", "--days", "2", "--daily-only", "--json"], {
    encoding: "utf8",
  });
  return { result, report: JSON.parse(result.stdout) };
}

try {
  write("known-gaps.json", { gaps: [] });
  write("auction-series.json", { daily: [
    { d: "2026-09-01", partial: false, hourGapHours: 0, ended: 900 },
    { d: "2026-09-02", partial: true, hourGapHours: 6, ended: 979 },
  ] });
  write("tcg-snapshot.json", { points: [tcgDay("2026-09-01"), tcgDay("2026-09-02")] });
  write("tcg-series.json", { daily: [tcgSeriesDay("2026-09-01"), tcgSeriesDay("2026-09-02")] });
  write("palworld-auction-market.json", { points: [{ d: "2026-09-01" }, { d: "2026-09-02" }] });
  write("palworld-auction-sold.json", { daily: [{ d: "2026-09-01" }, { d: "2026-09-02" }] });

  let out = runAudit();
  assert.equal(out.result.status, 1, "the exact previous-day partial collection must fail the audit");
  assert.ok(out.report.problems.some((p) => /원피스 경매 일별.*2026-09-02.*부분수집.*6시간/.test(p)), out.result.stdout);

  write("auction-series.json", { daily: [
    { d: "2026-09-01", partial: false, hourGapHours: 0, ended: 900 },
    { d: "2026-09-02", partial: false, hourGapHours: 0, ended: 950 },
  ] });
  write("tcg-snapshot.json", { points: [tcgDay("2026-09-01"), tcgDay("2026-09-02", "onepiece")] });
  out = runAudit();
  assert.equal(out.result.status, 1, "a missing required TCG field on the previous day must fail the audit");
  assert.ok(out.report.problems.some((p) => /TCG 시장 스냅샷.*2026-09-02.*onepiece.*live/.test(p)), out.result.stdout);

  write("tcg-snapshot.json", { points: [tcgDay("2026-09-01"), tcgDay("2026-09-02")] });
  write("tcg-series.json", { daily: [tcgSeriesDay("2026-09-01"), tcgSeriesDay("2026-09-02", "onepiece")] });
  out = runAudit();
  assert.equal(out.result.status, 1, "abnormally thin previous-day settlement must fail even when the workflow reported success");
  assert.ok(out.report.problems.some((p) => /TCG 정산 일별.*2026-09-02.*onepiece.*1\/10/.test(p)), out.result.stdout);

  write("tcg-series.json", { daily: [tcgSeriesDay("2026-09-01"), tcgSeriesDay("2026-09-02")] });
  out = runAudit();
  assert.equal(out.result.status, 0, out.result.stdout);
  assert.deepEqual(out.report.problems, []);
  console.log("auction continuity tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
