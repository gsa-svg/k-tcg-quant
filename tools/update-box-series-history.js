#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const historyDays = 180;

function marketKrw(value, currency, fx) {
  if (!Number.isFinite(value)) return null;
  if (currency === "KRW") return Math.round(value);
  if (currency === "JPY") return Math.round(value * (fx.jpyKrw || 9.1));
  if (currency === "USD") return Math.round(value * (fx.usdKrw || 1388.2));
  return null;
}

function appendSnapshot(points, snapshot) {
  const cutoff = new Date(snapshot.d);
  cutoff.setDate(cutoff.getDate() - historyDays);
  const existing = Array.isArray(points) ? points : [];
  return [...existing.filter((point) => point?.d && new Date(point.d) >= cutoff && point.d !== snapshot.d), snapshot]
    .sort((a, b) => a.d.localeCompare(b.d));
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  let updated = 0;
  let skipped = 0;

  for (const code of codes) {
    const set = data.sets?.[code];
    const active = set?.boxMarket?.jp?.ebayActive;
    if (!set || !active || active.middle == null || !active.currency) {
      skipped += 1;
      continue;
    }

    const middleKrw = marketKrw(Number(active.middle), active.currency, data.fx || {});
    if (!Number.isFinite(middleKrw)) {
      skipped += 1;
      continue;
    }

    set.boxSeries = set.boxSeries || {};
    set.boxSeries.currency = "KRW";
    set.boxSeries.source = "eBay Sold weekly medians plus eBay Active snapshots";
    set.boxSeries.note = "Sold history is retained when available; current updates append eBay Active middle-price snapshots.";
    set.boxSeries.updated = today;
    set.boxSeries.sampleSize = Math.max(Number(set.boxSeries.sampleSize || 0), Number(active.sampleSize || 0));
    set.boxSeries.points = appendSnapshot(set.boxSeries.points, {
      d: today,
      p: middleKrw,
      n: Number(active.sampleSize || 0),
      basis: "active",
    });
    updated += 1;
  }

  // 영문판 박스 이력 축적 (일판과 동일 구조, boxSeriesEn) — 표본 3건 미만은 신뢰도 낮아 스킵
  for (const code of codes) {
    const set = data.sets?.[code];
    const active = set?.boxMarket?.en?.ebayActive;
    if (!set || !active || active.middle == null || !active.currency || Number(active.sampleSize || 0) < 3) continue;
    const middleKrw = marketKrw(Number(active.middle), active.currency, data.fx || {});
    if (!Number.isFinite(middleKrw)) continue;
    set.boxSeriesEn = set.boxSeriesEn || {};
    set.boxSeriesEn.currency = "KRW";
    set.boxSeriesEn.source = "eBay Active snapshots (English sealed boxes)";
    set.boxSeriesEn.updated = today;
    set.boxSeriesEn.points = appendSnapshot(set.boxSeriesEn.points, {
      d: today,
      p: middleKrw,
      n: Number(active.sampleSize || 0),
      basis: "active",
    });
  }

  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ updated, skipped, historyDays }, null, 2));
}

main();
