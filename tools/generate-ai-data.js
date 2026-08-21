#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { buildAiData } = require("./ai-data-model");

const ROOT = path.resolve(__dirname, "..");
const sourcePath = path.join(ROOT, "data", "onepiece-packs.json");
const outputPath = path.join(ROOT, "opbox-ai-data.json");

/** Generate the stable public AI dataset from the verified local snapshot. */
function main() {
  const source = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const output = buildAiData(source);
  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ wrote: path.basename(outputPath), sets: output.sets.length, datasetUpdatedOn: output.datasetUpdatedOn }));
}

if (require.main === module) main();

module.exports = { main };
