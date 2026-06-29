#!/usr/bin/env node

const assert = require("node:assert/strict");
const { median, percentile, removePriceOutliers } = require("./price-outliers");

function sorted(values) {
  return [...values].sort((a, b) => a - b);
}

assert.equal(percentile(sorted([100, 200, 300]), 0.5), 200);
assert.equal(percentile(sorted([5350, 5390.8, 6700, 7949.99]), 0.5), 6045.4);
assert.equal(median(sorted([100, 200, 300, 400])), 250);

assert.deepEqual(removePriceOutliers(sorted([309.99, 3299.95])), {
  values: [309.99],
  outlierCount: 1,
});

assert.deepEqual(removePriceOutliers(sorted([387.4, 1349.9, 3299.95])), {
  values: [387.4, 1349.9],
  outlierCount: 1,
});

assert.deepEqual(removePriceOutliers(sorted([250, 265.4, 558])), {
  values: [250, 265.4, 558],
  outlierCount: 0,
});

assert.deepEqual(removePriceOutliers(sorted([89.95, 469.7, 469.75, 469.8, 469.85])), {
  values: [469.7, 469.75, 469.8, 469.85],
  outlierCount: 1,
});

console.log("price outlier tests passed");
