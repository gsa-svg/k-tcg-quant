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

// 2026-10-13: 표준 스냅샷 시각(00~04 UTC, 끝 미포함) 밖에서 뽑은 표본일은 비교값에서 뺀다.
const { tcgOffHour } = require("./tcg-config");
assert.equal(tcgOffHour("2026-10-12T00:00:00Z"), false, "00:00 UTC is inside the standard window");
assert.equal(tcgOffHour("2026-10-13T03:59:59.999Z"), false, "03:59 UTC is inside the standard window");
assert.equal(tcgOffHour("2026-10-13T04:00:00Z"), true, "04:00 UTC is outside (end is exclusive)");
assert.equal(tcgOffHour("2026-10-08T07:18:24.304Z"), true, "07:18 UTC (10/8) is outside");
assert.equal(tcgOffHour("2026-10-13T23:59:00Z"), true, "late evening UTC is outside");
assert.equal(tcgOffHour(undefined), null, "a day without at must not be marked either way");
assert.equal(tcgOffHour("not a date"), null, "an unreadable at must not be marked either way");
assert.match(generator, /offHour === true/, "generated UI must leave offHour days out of the comparisons");
console.log("TCG trend model tests passed (18 combinations + offHour window)");
