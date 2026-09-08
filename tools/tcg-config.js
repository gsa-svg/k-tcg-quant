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
// 06(06:45) 은 창 마지막 회차 — 남은 쿼터를 남김 없이 쓴다(전 게임 여유분).
const TCG_SCHEDULE_UTC = Object.freeze([1, 4, 6, 7, 10, 13, 16, 19, 22]);
// 게임당 감시(정산 대상) 표본. 스냅샷은 남은 쿼터에 맞춰 MIN~MAX 사이에서 고른다(collect-tcg-snapshot.js).
// 연속성 점검(collection-continuity.js)의 "보수적 최소"는 반드시 MIN 을 기준으로 잡는다 — MAX(250)를
// 기준으로 하면 표본이 하한(125)인 날 1건만 못 읽어도 빨간불이 난다(2026-09-07 실제: 124/125 로 FAIL).
const TCG_WATCH_PER_GAME = 250;       // 상한
const TCG_WATCH_PER_GAME_MIN = 125;   // 하한

module.exports = { TCGS, TCG_KEYS, EXCLUDED_TCG_KEYS, TCG_SCHEDULE_UTC, TCG_WATCH_PER_GAME, TCG_WATCH_PER_GAME_MIN };
