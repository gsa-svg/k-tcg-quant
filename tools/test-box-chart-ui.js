// Pure, offline checks: responsive presentation must not fabricate data.
const assert = require("node:assert/strict");
const { chartHTML, clean, CSS } = require("../box-chart");

const points = [
  { d: "2026-08-01", median: 100, n: 8 },
  { d: "2026-08-08", median: 120, n: 8 },
  { d: "2026-08-15", median: 90, n: 8 },
];
const before = JSON.stringify(points);
const html = chartHTML({ jp: points, today: "2026-08-30" }, { lang: "en" });
assert.equal(JSON.stringify(points), before, "rendering never mutates source data");
assert.match(html, /data-v="\$100"/);
assert.match(html, /data-v="\$120"/);
assert.match(html, /data-v="\$90"/);
assert.match(html, /opbcFlag/);
assert.match(html, /role="img"/);
assert.equal(chartHTML({ jp: [] }), "", "empty series is not zero-filled");
assert.equal(clean([...points, { d: "2026-08-22", median: 110, n: 1 }]).length, 3, "thin samples stay excluded");
assert.match(CSS, /container:boxplot \/ inline-size/);
assert.match(CSS, /@container boxplot/);
assert.match(CSS, /prefers-reduced-motion:no-preference/);
assert.match(CSS, /\.opbcReadout\{[^}]*font-size:13px/);
console.log("Box chart UI tests passed: values, empty/thin series, container typography, motion and readout");
