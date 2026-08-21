#!/usr/bin/env node
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { buildAiData } = require("./ai-data-model");

const ROOT = path.resolve(__dirname, "..");
const source = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const actual = JSON.parse(fs.readFileSync(path.join(ROOT, "opbox-ai-data.json"), "utf8"));
const expected = buildAiData(source);

function parseCsv(file) {
  const text = fs.readFileSync(path.join(ROOT, file), "utf8");
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted && char === '"' && text[i + 1] === '"') { value += '"'; i++; continue; }
    if (char === '"') { quoted = !quoted; continue; }
    if (!quoted && char === ",") { row.push(value); value = ""; continue; }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(value); value = "";
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      continue;
    }
    value += char;
  }
  const [header, ...lines] = rows;
  for (const line of lines) assert.equal(line.length, header.length, `${file} row width must match its header`);
  return lines.map((line) => Object.fromEntries(header.map((key, index) => [key, line[index]])));
}

function latest(src, code, edition, predicate = () => true) {
  return [...(src.sets?.[code]?.[edition] || [])].reverse().find(predicate) || null;
}

assert.deepEqual(actual, expected, "generated AI data must exactly match the verified source snapshot");
assert.equal(actual.schemaVersion, "1.0.0");
assert.equal(actual.datasetUpdatedOn, source.updated);
assert.equal(actual.sets.length, [...source.jp.list, ...source.extra.list].length);
assert.equal(new Set(actual.sets.map((set) => set.setCode)).size, actual.sets.length, "set codes must be unique");

for (const set of actual.sets) {
  assert.match(set.canonicalUrl, /^https:\/\/opboxindex\.com\/sets\/[a-z0-9-]+\.html$/);
  assert.equal(set.topHits.length, 7, `${set.setCode} must publish exactly seven ranked hits`);
  assert.deepEqual(set.topHits.map((card) => card.rank), [1, 2, 3, 4, 5, 6, 7]);
  for (const edition of Object.values(set.boxMarket)) {
    if (edition.sold) {
      assert.equal(edition.sold.basis, "completed_sales");
      assert.ok(edition.sold.sampleSize >= 3);
      assert.ok(edition.sold.p25Usd <= edition.sold.medianUsd && edition.sold.medianUsd <= edition.sold.p75Usd);
    }
    if (edition.activeAsk) {
      assert.equal(edition.activeAsk.basis, "active_asking_prices");
      assert.ok(edition.activeAsk.listingCount >= 3);
      assert.ok(edition.activeAsk.p15Usd <= edition.activeAsk.medianUsd && edition.activeAsk.medianUsd <= edition.activeAsk.p85Usd);
    }
  }
}

const boxRows = parseCsv("opbox-set-prices.csv");
assert.equal(boxRows.length, actual.sets.length);
for (const row of boxRows) {
  const set = actual.sets.find((item) => item.setCode === row.set_code);
  assert.ok(set, `box CSV has unknown set ${row.set_code}`);
  assert.equal(row.canonical_url, set.canonicalUrl);
  assert.equal(row.jp_sold_median_usd, String(set.boxMarket.japanese.sold?.medianUsd ?? ""));
  assert.equal(row.jp_sold_sample_collected_on, set.boxMarket.japanese.sold?.sampleCollectedOn ?? "");
  assert.equal(row.jp_active_ask_median_usd, String(set.boxMarket.japanese.activeAsk?.medianUsd ?? ""));
  assert.equal(row.jp_active_observed_on, set.boxMarket.japanese.activeAsk?.observedOn ?? "");
  assert.equal(row.en_sold_median_usd, String(set.boxMarket.english.sold?.medianUsd ?? ""));
  assert.equal(row.en_active_ask_median_usd, String(set.boxMarket.english.activeAsk?.medianUsd ?? ""));
}

const cgc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "cgc-grading-history.json"), "utf8"));
const tag = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tag-grading-history.json"), "utf8"));
const gradeRows = parseCsv("opbox-grading-population.csv");
assert.equal(new Set(gradeRows.map((row) => `${row.set_code}|${row.edition}`)).size, gradeRows.length);
for (const row of gradeRows) {
  const edition = row.edition === "japanese" ? "jp" : "en";
  const set = source.sets[row.set_code];
  const psa = edition === "jp" ? set.psaFull : set.psaFullEn;
  const cgcTotal = latest(cgc, row.set_code, edition);
  const cgcSplit = latest(cgc, row.set_code, edition, (point) => point.grades && Object.keys(point.grades).length);
  const tagTotal = latest(tag, row.set_code, edition);
  const tagSplit = latest(tag, row.set_code, edition, (point) => Number.isFinite(point.g10) && Number.isFinite(point.g10p));
  assert.equal(row.psa_total, String(psa?.total ?? ""));
  assert.equal(row.psa_total_as_of, psa?.updated ?? "");
  assert.equal(row.psa_weekly_add_as_of, psa?.wowAdd == null ? "" : (edition === "jp" ? set.psaWeekly?.points?.at(-1)?.d : psa?.updated) ?? "");
  assert.equal(row.cgc_total, String(cgcTotal?.total ?? ""));
  assert.equal(row.cgc_total_as_of, cgcTotal?.d ?? "");
  assert.equal(row.cgc_pristine10, String(cgcSplit?.grades?.["Pristine 10"] ?? ""));
  assert.equal(row.cgc_gem_mint10, String(cgcSplit?.grades?.["Gem Mint 10"] ?? ""));
  assert.equal(row.cgc_grade_split_as_of, cgcSplit?.d ?? "");
  assert.equal(row.tag_total, String(tagTotal?.total ?? ""));
  assert.equal(row.tag_total_as_of, tagTotal?.d ?? "");
  assert.equal(row.tag_10, String(tagSplit?.g10 ?? ""));
  assert.equal(row.tag_10p, String(tagSplit?.g10p ?? ""));
  assert.equal(row.tag_grade_split_as_of, tagSplit?.d ?? "");
  if (row.cgc_grade_split_as_of && row.cgc_total_as_of) assert.ok(row.cgc_grade_split_as_of <= row.cgc_total_as_of);
  if (row.tag_grade_split_as_of && row.tag_total_as_of) assert.ok(row.tag_grade_split_as_of <= row.tag_total_as_of);
}

const serialized = JSON.stringify(actual);
for (const forbidden of ["bestListing", "itemPrices", "seller", "query", "marketplaceId", "campid", "client_secret", "ebay.com/itm/"]) {
  assert.ok(!serialized.includes(forbidden), `public AI data must omit ${forbidden}`);
}
assert.ok(Buffer.byteLength(serialized) < 200_000, "AI data must remain compact enough for answer-engine retrieval");

const freeData = fs.readFileSync(path.join(ROOT, "free-data.html"), "utf8");
const ldBlocks = [...freeData.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => JSON.parse(match[1]));
const graph = ldBlocks.find((block) => Array.isArray(block["@graph"]))?.["@graph"] || [];
const downloads = graph.flatMap((item) => item.distribution ? [item.distribution.contentUrl] : []);
for (const name of ["opbox-ai-data.json", "opbox-set-prices.csv", "opbox-grading-population.csv", "opbox-auction-daily.csv"]) {
  assert.ok(downloads.some((url) => url?.endsWith(`/${name}`)), `Dataset JSON-LD must list ${name}`);
}

const factDates = [actual.fx.observedOn];
for (const set of actual.sets) {
  for (const market of Object.values(set.boxMarket)) factDates.push(market.sold?.sampleCollectedOn, market.activeAsk?.observedOn);
  for (const hit of set.topHits) {
    factDates.push(hit.rawNmAsk?.observedOn, hit.rawNmAsk?.fxObservedOn, hit.psa10Sold?.sampleCollectedOn, hit.psaPopulation?.observedOn);
    if (hit.psaPopulation?.grade10 != null) assert.ok(hit.psaPopulation.grade10 <= hit.psaPopulation.total);
    if (hit.psaPopulation?.grade9 != null) assert.ok(hit.psaPopulation.grade9 <= hit.psaPopulation.total);
    if (hit.psaPopulation?.grade10 != null && hit.psaPopulation?.grade9 != null) assert.ok(hit.psaPopulation.grade10 + hit.psaPopulation.grade9 <= hit.psaPopulation.total);
  }
}
const validFactDates = factDates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")).sort();
const aiDataset = graph.find((item) => item["@id"]?.endsWith("#ai-json"));
assert.equal(aiDataset?.temporalCoverage, `${validFactDates[0]}/${validFactDates.at(-1)}`, "AI Dataset temporal coverage must include every published fact date");

console.log(JSON.stringify({ test: "AI_DATA_OK", sets: actual.sets.length, cards: actual.sets.reduce((sum, set) => sum + set.topHits.length, 0), bytes: Buffer.byteLength(serialized) }));
