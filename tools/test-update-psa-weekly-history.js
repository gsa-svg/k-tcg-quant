#!/usr/bin/env node

const assert = require("node:assert/strict");
const { applySnapshot, dayDiff } = require("./update-psa-weekly-history");

function dataFixture() {
  return {
    sets: {
      "OP-01": { psaWeekly: { points: [{ d: "2026-07-08", v: 10 }] } },
      "OP-02": { psaWeekly: { points: [{ d: "2026-07-08", v: 20 }] } },
    },
  };
}

const first = { date: "2026-07-15", total: 300, sets: { "OP-01": 100, "OP-02": 200 } };
const second = { date: "2026-07-22", total: 330, sets: { "OP-01": 112, "OP-02": 218 } };

assert.equal(dayDiff(first.date, second.date), 7);
assert.equal(dayDiff("2026-07-15", "2026-07-21"), 6);

const seeded = applySnapshot(dataFixture(), { snapshots: [] }, first);
assert.equal(seeded.status, "baseline");
assert.equal(seeded.archive.snapshots.length, 1);

const duplicate = applySnapshot(dataFixture(), seeded.archive, first);
assert.equal(duplicate.status, "duplicate");
assert.equal(duplicate.changed, false);

const data = dataFixture();
const appended = applySnapshot(data, seeded.archive, second);
assert.equal(appended.status, "appended");
assert.equal(appended.delta, 30);
assert.deepEqual(data.sets["OP-01"].psaWeekly.points.at(-1), { d: "2026-07-22", v: 12 });
assert.deepEqual(data.sets["OP-02"].psaWeekly.points.at(-1), { d: "2026-07-22", v: 18 });
assert.equal(data.sets["OP-01"].psaWeekly.allTimeTotal, 112);

assert.throws(
  () => applySnapshot(dataFixture(), seeded.archive, { ...second, date: "2026-07-30" }),
  /expected a 7-day PSA snapshot interval/,
);
assert.throws(
  () => applySnapshot(dataFixture(), seeded.archive, { date: "2026-07-22", total: 290, sets: { "OP-01": 90, "OP-02": 200 } }),
  /regressed/,
);

const withNewSet = dataFixture();
withNewSet.sets["OP-03"] = {};
const newSetResult = applySnapshot(withNewSet, seeded.archive, {
  date: "2026-07-22",
  total: 335,
  sets: { "OP-01": 112, "OP-02": 218, "OP-03": 5 },
});
assert.deepEqual(newSetResult.newSets, ["OP-03"]);
assert.equal(newSetResult.delta, 30);
assert.deepEqual(withNewSet.sets["OP-03"].psaWeekly.points, []);
assert.equal(withNewSet.sets["OP-03"].psaWeekly.allTimeTotal, 5);

console.log("PSA weekly history tests passed");
