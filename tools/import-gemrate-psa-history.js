#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const sourcePath = path.join(projectRoot, "data", "gemrate-psa-history.json");
const snapshotPath = path.join(projectRoot, "data", "psa-population-snapshots.json");
const requiredWeeklyDates = ["2026-06-24", "2026-07-01", "2026-07-08", "2026-07-15"];

function round1(value) {
  return Math.round(value * 10) / 10;
}

function validateSet(code, source) {
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
  if (JSON.stringify(dates) !== JSON.stringify(requiredWeeklyDates)) {
    throw new Error(`${code}: expected verified weekly dates ${requiredWeeklyDates.join(", ")}, got ${dates.join(", ")}`);
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

  for (const code of codes) validateSet(code, source.sets[code]);

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
  const archive = {
    version: 2,
    basis: "gemrate-full-set-psa-population",
    note: "Verified full-set cumulative PSA population snapshots. A new snapshot may be added only after the same GemRate set pages are refreshed and validated.",
    snapshots: [snapshot],
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
