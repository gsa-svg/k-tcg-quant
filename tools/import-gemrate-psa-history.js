#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const sourcePath = path.join(projectRoot, "data", "gemrate-psa-history.json");
const snapshotPath = path.join(projectRoot, "data", "psa-population-snapshots.json");
const minimumWeeklyPoints = 4;

function parseDate(value) {
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) throw new Error(`Invalid date: ${value}`);
  return time;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

function validateSet(code, source, history) {
  if (!source || !/^https:\/\/www\.gemrate\.com\/set-population-trend\?/.test(source.url || "")) {
    throw new Error(`${code}: GemRate source URL is missing`);
  }

  const latest = source.latest || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(latest.date || "")) throw new Error(`${code}: latest date is invalid`);
  if (!Number.isInteger(latest.totalGrades) || latest.totalGrades <= 0) throw new Error(`${code}: totalGrades is invalid`);
  if (!Number.isInteger(latest.totalGems) || latest.totalGems <= 0 || latest.totalGems > latest.totalGrades) {
    throw new Error(`${code}: totalGems is invalid`);
  }

  const weekly = Array.isArray(source.weekly) ? source.weekly : [];
  const dates = weekly.map((point) => point.d);
  const correctionDates = new Set((history.corrections?.[code] || []).map((entry) => entry.date));
  if (weekly.length < minimumWeeklyPoints) throw new Error(`${code}: fewer than ${minimumWeeklyPoints} verified weekly points`);
  if (new Set(dates).size !== dates.length) throw new Error(`${code}: duplicate weekly dates`);
  for (let index = 1; index < dates.length; index += 1) {
    const intervalWeeks = (parseDate(dates[index]) - parseDate(dates[index - 1])) / (7 * 864e5);
    const skippedDates = (history.retainedWeeklyDates || []).filter((date) => date > dates[index - 1] && date < dates[index]);
    if (!Number.isInteger(intervalWeeks) || intervalWeeks < 1 || skippedDates.some((date) => !correctionDates.has(date))) {
      throw new Error(`${code}: weekly dates are not consecutive at ${dates[index]}`);
    }
  }
  const lastDate = dates.at(-1);
  const trailingDates = (history.retainedWeeklyDates || []).filter((date) => date > lastDate && date <= history.weeklyThrough);
  if (lastDate !== history.weeklyThrough && trailingDates.some((date) => !correctionDates.has(date))) {
    throw new Error(`${code}: weekly graph does not reach ${history.weeklyThrough} and missing dates are not declared corrections`);
  }
  if (history.historyStart && dates[0] < history.historyStart) throw new Error(`${code}: weekly history predates verified start`);

  const firstDate = dates[0];
  for (const retainedDate of history.retainedWeeklyDates || []) {
    if (retainedDate >= firstDate && !dates.includes(retainedDate) && !correctionDates.has(retainedDate)) {
      throw new Error(`${code}: retained weekly date ${retainedDate} was deleted without a correction`);
    }
  }
  for (const point of weekly) {
    if (!Number.isInteger(point.grades) || point.grades < 0) throw new Error(`${code} ${point.d}: weekly grades are invalid`);
    if (!Number.isInteger(point.gems) || point.gems < 0 || point.gems > point.grades) {
      throw new Error(`${code} ${point.d}: weekly gems are invalid`);
    }
  }
}

function applyGemRateHistory(data, source) {
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  const missing = codes.filter((code) => !source.sets?.[code]);
  const extra = Object.keys(source.sets || {}).filter((code) => !codes.includes(code));
  if (missing.length || extra.length) {
    throw new Error(`GemRate set coverage mismatch; missing=${missing.join(",") || "none"}, extra=${extra.join(",") || "none"}`);
  }

  for (const code of codes) validateSet(code, source.sets[code], source);

  const totalGrades = codes.reduce((sum, code) => sum + source.sets[code].latest.totalGrades, 0);
  const totalGems = codes.reduce((sum, code) => sum + source.sets[code].latest.totalGems, 0);
  const opAverage = round1((totalGems / totalGrades) * 100);

  for (const code of codes) {
    const set = data.sets[code];
    const imported = source.sets[code];
    const latest = imported.latest;
    const gemRate = round1((latest.totalGems / latest.totalGrades) * 100);

    set.psaFull = {
      total: latest.totalGrades,
      gems: latest.totalGems,
      gem10: latest.totalGems,
      gemRate,
      opAvg: opAverage,
      opDiff: round1(gemRate - opAverage),
      updated: latest.date,
      source: "GemRate full-set PSA population trend",
      sourceUrl: imported.url,
    };
    set.psaWeekly = {
      source: "GemRate full-set weekly PSA population deltas",
      sourceUrl: imported.url,
      updated: source.weeklyThrough,
      allTimeTotal: latest.totalGrades,
      corrections: source.corrections?.[code] || [],
      points: imported.weekly.map((point) => ({ d: point.d, v: point.grades })),
    };
  }

  return {
    date: source.collectedAt,
    source: "GemRate public full-set PSA population trend",
    total: totalGrades,
    sets: Object.fromEntries(codes.map((code) => [code, source.sets[code].latest.totalGrades])),
  };
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const snapshot = applyGemRateHistory(data, source);
  const previousArchive = fs.existsSync(snapshotPath)
    ? JSON.parse(fs.readFileSync(snapshotPath, "utf8"))
    : { snapshots: [] };
  const snapshots = (previousArchive.snapshots || []).filter((entry) => entry.date !== snapshot.date);
  const archive = {
    version: 2,
    basis: "gemrate-full-set-psa-population",
    note: "Verified full-set cumulative PSA population snapshots. A new snapshot may be added only after the same GemRate set pages are refreshed and validated.",
    snapshots: [...snapshots, snapshot].sort((a, b) => a.date.localeCompare(b.date)).slice(-52),
  };

  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  fs.writeFileSync(snapshotPath, `${JSON.stringify(archive, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({
    status: "imported",
    sets: Object.keys(source.sets).length,
    latest: source.collectedAt,
    weeklyThrough: source.weeklyThrough,
    cumulativeTotal: snapshot.total,
  }, null, 2));
}

if (require.main === module) main();

module.exports = { applyGemRateHistory, validateSet };
