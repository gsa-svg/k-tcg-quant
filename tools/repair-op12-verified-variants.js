#!/usr/bin/env node
/**
 * Replaces OP-12 cards confirmed against the official Japanese card list and
 * TCG Quant reference. Old card-specific market fields are deliberately not
 * carried across to a different card variant.
 */
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
const cards = data.sets["OP-12"]?.cards;

if (!Array.isArray(cards) || cards.length !== 10) {
  throw new Error("Expected exactly 10 OP-12 cards.");
}

const sanji = cards.find((card) => card.rank === 9);
if (!sanji || sanji.number !== "OP10-063" || sanji.name !== "Vinsmoke Sanji TR") {
  throw new Error("Unexpected OP-12 rank 9 card.");
}

// The inherited Yuyu-tei row is for a different variant, so do not display it.
sanji.priceUsd = 80.51;
for (const key of ["nmJpy", "nmVenue", "nmSourceUrl", "nmStock", "psa10Active", "psa10Ebay", "englishNmEbay", "series"]) {
  delete sanji[key];
}

const zoroIndex = cards.findIndex((card) => card.rank === 10);
if (zoroIndex < 0 || cards[zoroIndex].number !== "OP12-020") {
  throw new Error("Unexpected OP-12 rank 10 card.");
}

cards[zoroIndex] = {
  rank: 10,
  name: "Perona Alternate Art",
  number: "OP12-034",
  rarity: "SR",
  priceUsd: 70.99,
  image: "https://opboxindex.com/img/jp/OP12-034_p1.webp",
  _imgSuffix: "_p1",
  imageJpSrc: "https://www.onepiece-cardgame.com/images/cardlist/card/OP12-034_p1.png"
};

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 2)}\n`);
console.log("OP-12 verified variants repaired: OP10-063, OP12-034");
