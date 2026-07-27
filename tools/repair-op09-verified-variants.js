#!/usr/bin/env node
/**
 * Repairs OP-09 cards whose official Japanese artwork variant was verified
 * against the source card list. Market values are only changed where the
 * matching TCG Quant reference card was manually confirmed.
 */
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const cards = data.sets["OP-09"]?.cards;

if (!Array.isArray(cards) || cards.length !== 10) {
  throw new Error("Expected exactly 10 OP-09 cards.");
}

const changes = [
  {
    number: "OP08-106",
    name: "Nami SP",
    imageSuffix: "_p4",
  },
  {
    number: "OP05-119",
    name: "Monkey D. Luffy Wanted Poster",
    imageSuffix: "_p5",
    priceUsd: 662.96,
  },
  {
    number: "OP05-067",
    name: "Zoro Juurou SP",
    imageSuffix: "_p4",
    priceUsd: 568.65,
  },
  {
    number: "OP09-004",
    name: "Shanks 004 Wanted Poster",
    imageSuffix: "_p3",
    priceUsd: 260.4,
  },
];

for (const change of changes) {
  const matches = cards.filter((card) => card.number === change.number && card.name === change.name);
  if (matches.length !== 1) {
    throw new Error(`Expected one match for ${change.number} ${change.name}; got ${matches.length}.`);
  }

  const card = matches[0];
  const base = `${change.number}${change.imageSuffix}`;
  card.image = `https://opboxindex.com/img/jp/${base}.webp`;
  card._imgSuffix = change.imageSuffix;
  card.imageJpSrc = `https://www.onepiece-cardgame.com/images/cardlist/card/${base}.png`;
  if (change.priceUsd !== undefined) card.priceUsd = change.priceUsd;
}

fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`);
console.log("OP-09 verified variants repaired:", changes.map((change) => change.number).join(", "));
