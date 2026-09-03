const TREND_METRICS = Object.freeze(["live", "ending", "ended", "rate", "gmv", "med"]);
const TREND_PERIODS = Object.freeze(["daily", "weekly", "monthly"]);

/** Trims unmeasured edges while preserving internal missing dates on the time axis. */
function visibleTrendRows(rows, metric) {
  let first = -1;
  let last = -1;
  for (let index = 0; index < rows.length; index += 1) {
    if (Number.isFinite(rows[index]?.[metric])) {
      if (first < 0) first = index;
      last = index;
    }
  }
  return first < 0 ? [] : rows.slice(first, last + 1);
}

module.exports = { TREND_METRICS, TREND_PERIODS, visibleTrendRows };
