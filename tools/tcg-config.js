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
// eBay 쿼터 창은 07:00 UTC 에 리셋된다(실측 2026-09-03). 07 회차가 창의 첫 실행 = 스냅샷 + 정산.
// 06(06:45) 은 창 마지막 회차 — 남은 쿼터를 남김 없이 쓴다(포켓몬 여유분).
const TCG_SCHEDULE_UTC = Object.freeze([1, 4, 6, 7, 10, 13, 16, 19, 22]);
const TCG_WATCH_PER_GAME = 250;

module.exports = { TCGS, TCG_KEYS, EXCLUDED_TCG_KEYS, TCG_SCHEDULE_UTC, TCG_WATCH_PER_GAME };
