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
// eBay 쿼터 창은 07:00 UTC 에 리셋된다(실측 2026-09-03). 07 회차는 창의 첫 정산이다.
// 스냅샷은 UTC 날짜가 바뀐 뒤 첫 실행이 찍는다 — 자가치유가 00:15 UTC 이후 오늘 점이 없으면 바로 쏜다(하트비트 00:17 → 00:18, 2026-10-14).
// 06(06:45) 은 창 마지막 회차 — 남은 쿼터를 남김 없이 쓴다(전 게임 여유분).
const TCG_SCHEDULE_UTC = Object.freeze([1, 4, 6, 7, 10, 13, 16, 19, 22]);
// 게임당 감시(정산 대상) 표본. 스냅샷은 남은 쿼터에 맞춰 MIN~MAX 사이에서 고른다(collect-tcg-snapshot.js).
// 연속성 점검(collection-continuity.js)의 "보수적 최소"는 반드시 MIN 을 기준으로 잡는다 — MAX(250)를
// 기준으로 하면 표본이 하한(125)인 날 1건만 못 읽어도 빨간불이 난다(2026-09-07 실제: 124/125 로 FAIL).
const TCG_WATCH_PER_GAME = 250;       // 상한
const TCG_WATCH_PER_GAME_MIN = 125;   // 하한

// 스냅샷 한 번의 실제 eBay 호출 수 — 게임당 진행 총계 1 + 즉시구매 1 + 24시간 종료 1 + 표본 페이지 5(200건씩).
// 쿼터 몫(ebay-budget reserveFor "tcgSnapshot")과 스냅샷 자신의 잔여 확인(collect-tcg-snapshot)이 같은 값을 쓴다 — 2026-10-14.
// 종전 스냅샷은 잔여 400 미만이면 건너뛰었는데(실제 필요 104) 아무도 그 몫을 남기지 않아, 9/5~9/8·10/8~10/10 의
// 00~07 UTC 실행이 전부 건너뛰고 쿼터 리셋 뒤 07:18 에 찍혔다(표준 시각 밖 — 그날 표본 낙찰률이 낮게 나온다).
const TCG_SNAPSHOT_PAGES = 5;
const TCG_SNAPSHOT_CALLS = TCGS.length * (TCG_SNAPSHOT_PAGES + 3);
const TCG_SNAPSHOT_RESERVE = TCG_SNAPSHOT_CALLS + 20;   // 여유 20(재시도·검색어 겹침 없음 — 계산 오차 몫)

// 표준 스냅샷 시각(UTC 시, from 포함 · to 미포함) — 2026-10-13 신설.
// 스냅샷은 그 UTC 날짜의 첫 실행에서 "종료 임박 순" 표본(게임당 최대 250)을 감시 목록에 넣는다(seen = 그날).
// 그래서 몇 시에 찍었느냐가 곧 "미국 하루 중 언제 끝나는 경매를 골랐느냐"다. 다만 그 표본이 모두 그날 안에 끝나지는
// 않는다 — 작은 게임은 표본이 하루 넘게 걸쳐 있어, 원장(종료일 기준)에서는 일부가 다음 날 파일로 넘어간다
// (10/8·10/9·10/10 표본 중 263·272·322건, 18~22%. 반대로 10/8 원장에는 10/7 표준 표본 159건이 섞였다).
// 원장 행의 seen(표본일)은 2026-10-14 부터 적힌다(settle-tcg). 화면은 seen 이 있으면 그 날짜로, 없으면 원장 날짜로 뺀다.
// 남는 쿼터로 더 읽는 여유분(extra, topup-tcg-watch)은 다른 UTC 회차에 고른 표본이라 화면 비교값에서 아예 뺀다.
// 실측 62일(시각 = 그 점을 마지막으로 쓴 수집기의 updated, git 이력에서 복원):
//   00:10~03:08 UTC 50일 — 일 낙찰률 평균 36.8%(최저 25.6%) · 표본 입찰 비율 평균 28.0%
//   06:16~08:58 UTC 12일 — 일 낙찰률 평균 24.0% · 입찰 비율 20.9% (07 회차 = 쿼터 리셋 뒤 첫 실행, 미국 새벽 종료분)
//   10/8·10/9·10/10(07:18~07:19) 은 12.3·20.7·22.9% — 표준일 최저보다 낮다. 8/20(00:54·02:06·04:50·06:16)·8/28(01:23·08:34)
//   은 같은 날 다시 찍어 표본이 섞였다 — 남은 점의 시각은 마지막 것이라 offHour 로 잡힌다.
// 이 창 밖에서 찍힌 날은 tcg-series daily 에 offHour:true 로 표시하고(build-tcg-series), 그날 고른 표본을 화면의
// 주간 비교·추이에서 뺀다(generate-tcg-auction-page). 원장(tcg-archive)과 기간 합계는 그대로다. 가드 A5 가 표시와 at 의 일치를 본다.
const TCG_SNAPSHOT_STD_HOURS = Object.freeze({ from: 0, to: 4 });
// 스냅샷 시각(ISO) → 표준 시각 밖이면 true, 안이면 false, 시각이 없거나 못 읽으면 null(표시하지 않는다).
function tcgOffHour(at) {
  const t = Date.parse(at || "");
  if (!Number.isFinite(t)) return null;
  const h = new Date(t).getUTCHours();
  return h < TCG_SNAPSHOT_STD_HOURS.from || h >= TCG_SNAPSHOT_STD_HOURS.to;
}

module.exports = { TCGS, TCG_KEYS, EXCLUDED_TCG_KEYS, TCG_SCHEDULE_UTC, TCG_WATCH_PER_GAME, TCG_WATCH_PER_GAME_MIN, TCG_SNAPSHOT_PAGES, TCG_SNAPSHOT_CALLS, TCG_SNAPSHOT_RESERVE, TCG_SNAPSHOT_STD_HOURS, tcgOffHour };
