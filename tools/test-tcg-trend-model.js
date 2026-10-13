#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { TREND_METRICS, TREND_PERIODS, visibleTrendRows } = require("./tcg-trend-model");

assert.equal(TREND_METRICS.length * TREND_PERIODS.length, 18, "all six metrics × three periods must be covered");
for (const period of TREND_PERIODS) {
  for (const metric of TREND_METRICS) {
    const rows = [0, 1, 2, 3, 4].map((index) => ({ d: `${period}-${index}`, [metric]: index === 1 || index === 3 ? index : null }));
    const visible = visibleTrendRows(rows, metric);
    assert.deepEqual(visible.map((row) => row.d), [`${period}-1`, `${period}-2`, `${period}-3`], `${period}/${metric} must trim empty edges and preserve the internal missing date`);
    assert.equal(visible[1][metric], null, `${period}/${metric} must not fabricate the internal observation`);
  }
}

// 2026-10-13: 지표·기간 토글을 없앤 재설계(경매 페이지 단순화)로 button[data-tm]/[data-tp] 계약은 사라졌다 — visibleTrendRows 만 검사한다.
const generator = fs.readFileSync(path.join(__dirname, "generate-tcg-auction-page.js"), "utf8");
assert.match(generator, /visibleTrendRows\(/, "generated UI must use the tested trend visibility seam");
console.log("TCG trend model tests passed (18 combinations)");
