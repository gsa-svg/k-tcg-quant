// Shared TCG collection contract. Collector, quota reservation, audits, and page generation
// must all agree on these keys and run hours.
const TCGS = Object.freeze([
  { k: "pokemonjp", nm: "Pokemon (Japanese)", q: "Pokemon Card Japanese" },
  { k: "pokemon", nm: "Pokemon", q: "Pokemon TCG" },
  { k: "magic", nm: "Magic: The Gathering", q: "Magic The Gathering" },
  { k: "yugioh", nm: "Yu-Gi-Oh!", q: "Yu-Gi-Oh" },
  { k: "onepiece", nm: "One Piece", q: "One Piece TCG" },
  { k: "lorcana", nm: "Disney Lorcana", q: "Disney Lorcana" },
  { k: "weiss", nm: "Weiss Schwarz", q: "Weiss Schwarz" },
  { k: "digimon", nm: "Digimon", q: "Digimon Card Game" },
  { k: "riftbound", nm: "Riftbound (LoL)", q: "Riftbound League of Legends" },
  { k: "unionarena", nm: "Union Arena", q: "Union Arena" },
  { k: "gundam", nm: "Gundam Card Game", q: "Gundam Card Game" },
  { k: "dragonball", nm: "Dragon Ball Fusion World", q: "Dragon Ball Fusion World" },
  { k: "palworld", nm: "Palworld TCG", q: "Palworld TCG" },
]);

const TCG_KEYS = Object.freeze(TCGS.map((game) => game.k));
const EXCLUDED_TCG_KEYS = Object.freeze(["swu", "vanguard", "metazoo", "fab"]);
const TCG_SCHEDULE_UTC = Object.freeze([0, 3, 6, 9, 12, 15, 18, 21]);
const TCG_WATCH_PER_GAME = 250;

module.exports = { TCGS, TCG_KEYS, EXCLUDED_TCG_KEYS, TCG_SCHEDULE_UTC, TCG_WATCH_PER_GAME };
