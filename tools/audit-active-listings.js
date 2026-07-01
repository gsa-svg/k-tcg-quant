#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const failures = [];

  for (const code of [...data.jp.list, ...data.extra.list]) {
    const bestListing = data.sets[code]?.boxMarket?.jp?.ebayActive?.bestListing;
    if (!bestListing) continue;
    if (!isJapaneseSealedBoosterBoxTitle(bestListing.title, code)) {
      failures.push({
        code,
        title: bestListing.title,
        total: bestListing.total,
        currency: bestListing.currency,
      });
    }
  }

  if (failures.length) {
    console.error(JSON.stringify({ activeBoxListingFailures: failures }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify({ activeBoxListingFailures: 0 }, null, 2));
}

main();
