#!/usr/bin/env node
/**
 * Rebuilds the PRB-01 top ten and corrects OP-13 ranks 9-10 from the
 * official Japanese images and the TCG Quant references supplied by the user.
 * No market, grading, or affiliate data is inherited from a different variant.
 */
const fs = require("fs");
const path = require("path");

const dataPath = path.join(__dirname, "..", "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

function officialImage(number, suffix) {
  return {
    image: `https://opboxindex.com/img/jp/${number}${suffix}.webp`,
    _imgSuffix: suffix,
    imageJpSrc: `https://www.onepiece-cardgame.com/images/cardlist/card/${number}${suffix}.png`
  };
}

function card(rank, name, number, rarity, priceUsd, suffix) {
  return {
    rank,
    name,
    number,
    rarity,
    priceUsd,
    ...(suffix ? officialImage(number, suffix) : {})
  };
}

function verifiedManualImage(image) {
  return { image };
}

const prb = data.sets["PRB-01"];
if (!prb || !Array.isArray(prb.cards) || prb.cards.length !== 10) {
  throw new Error("Expected PRB-01 to contain exactly 10 cards before repair.");
}

// Cards were visually matched to the official Japanese list. The gold DON
// card has no official card-number suffix, so it uses the verified product art.
prb.cards = [
  card(1, "Monkey D. Luffy OP05 119 Manga", "OP05-119", "SEC", 4250.0, "_p4"),
  card(2, "Tony TonyChopper EB01 006 Manga", "EB01-006", "SR", 2400.0, "_p3"),
  card(3, "Nami OP01 016 Manga", "OP01-016", "R", 2012.04, "_p1"),
  card(4, "Roronoa Zoro Manga", "OP06-118", "SEC", 1983.33, "_p2"),
  card(5, "Shanks Manga", "OP01-120", "SEC", 1250.0, "_p2"),
  card(6, "Portgas D. Ace Manga", "OP02-013", "SR", 1000.0, "_p2"),
  card(7, "Trafalgar Law OP05 069 Manga", "OP05-069", "SR", 1000.0, "_p3"),
  card(8, "Eustass Captain Kid OP05 074 Manga", "OP05-074", "SR", 748.02, "_p5"),
  { ...card(9, "DON Card Zoro Gold", "DON!!", "DON!!", 729.46), ...verifiedManualImage("https://opboxindex.com/img/jp/PRB01-DON-zoro-gold.webp") },
  card(10, "Sabo OP04 083 Manga", "OP04-083", "SR", 650.99, "_p2")
];

const op13 = data.sets["OP-13"];
if (!op13 || !Array.isArray(op13.cards) || op13.cards.length !== 10) {
  throw new Error("Expected OP-13 to contain exactly 10 cards before repair.");
}

const marsIndex = op13.cards.findIndex((item) => item.rank === 9);
const aceIndex = op13.cards.findIndex((item) => item.rank === 10);
if (marsIndex < 0 || aceIndex < 0) {
  throw new Error("Expected OP-13 ranks 9 and 10 before repair.");
}

op13.cards[marsIndex] = card(9, "St Marcus Mars Parallel", "OP13-091", "R", 494.11, "_p2");
op13.cards[aceIndex] = card(10, "Portgas D. Ace 119 Wanted Poster", "OP13-119", "SEC", 444.75, "_p4");

fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`);
console.log("Rebuilt PRB-01 and corrected OP-13 ranks 9-10 with verified variants.");
