#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildAiData } = require("./ai-data-model");

const ROOT = path.resolve(__dirname, "..");
const outputPath = path.join(ROOT, "opbox-ai-data.json");

/** Generate the stable public AI dataset from the verified local snapshot (data/derived/site-facts.json — 2026-10-15). */
function main() {
  const output = buildAiData();
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ wrote: path.basename(outputPath), sets: output.sets.length, datasetUpdatedOn: output.datasetUpdatedOn }));
}

if (require.main === module) main();

module.exports = { main };
