#!/usr/bin/env node

const assert = require("node:assert/strict");
const { appendVerifiedWeeks, correctionReason, latestWednesday } = require("./collect-gemrate-psa-history");

const rows = [
  { date: "2026-07-15", total_grades: 100, total_gems: 90 },
  { date: "2026-07-22", total_grades: 125, total_gems: 110 },
  { date: "2026-07-23", total_grades: 130, total_gems: 114 },
];
assert.equal(latestWednesday(rows), "2026-07-22");
assert.equal(correctionReason("OP-01", "2026-07-22", 25, 20, [10, 12, 14]), null);
assert.match(correctionReason("OP-01", "2026-07-22", 25000, 20000, [10, 12, 14]), /implausible/);

const source = {
  collectedAt: "2026-07-20",
  weeklyThrough: "2026-07-15",
  retainedWeeklyDates: ["2026-07-15"],
  corrections: {},
  sets: {
    "OP-01": { weekly: [{ d: "2026-07-15", grades: 10, gems: 9 }], latest: {} },
    "OP-02": { weekly: [{ d: "2026-07-15", grades: 12, gems: 10 }], latest: {} },
  },
};
const result = appendVerifiedWeeks(source, { "OP-01": rows, "OP-02": rows });
assert.deepEqual(result.added, ["2026-07-22"]);
assert.equal(source.sets["OP-01"].weekly.at(-1).grades, 25);
assert.deepEqual(source.retainedWeeklyDates, ["2026-07-15", "2026-07-22"]);
assert.equal(appendVerifiedWeeks(source, { "OP-01": rows, "OP-02": rows }).changed, false);

console.log("GemRate PSA collector tests passed");
