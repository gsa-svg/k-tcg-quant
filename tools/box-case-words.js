// 제목의 "case" 가 12박스 케이스(카톤)인지, 박스 1개에 붙은 말인지 — 2026-09-30.
// 적재(box-sold-ingest)·수리(repair-box-ledger)·가드(guard-invariants)가 전부 이 한 곳을 쓴다.
// 세 곳이 따로 규칙을 들고 있으면 언젠가 갈라진다(other-game-words.js 와 같은 이유).
//
// 2026-09-30 실측: box-sold-ingest 의 BAD /\bcases?\b/ 와 lot-quantity 의 UNCOUNTABLE /\bcase\b/ 가
// 단품 박스 판매까지 버리고 있었다. 9/18~9/30 덤프 11개를 다시 적재하면 원장에 없던 고유 (id, 판매일) 109건(9/1 이후 41건)이 들어온다.
//   · "One Piece Memorial Collection Booster Box EB-01 English w/ Acrylic Case" 9/21 1,121,260원
//     — 원장의 EB-01 영문 마지막 기록이 9/12 인데 그 뒤에도 팔리고 있었다.
//   · "Bandai One Piece TCG Paramount War OP-02 English Booster Box Sealed with case" 842,654원
//   · "One Piece TCG OP13 Booster Box MINT English - New & Sealed CASE FRESH" 594,499원
// 경매 분류(auction-classify.js NOT_CASE)는 9/1 에 같은 구멍을 막았는데 sold 적재로 옮겨지지 않았었다.
//
// 규칙: 아래 "단품 문구"만 지운다. 지운 뒤에도 case 가 남으면 종전대로 케이스로 보고 버린다.
//   계속 버리는 것(실제 덤프 원문):
//     "One Piece TCG OP-16 The Time Of Battle Booster Box Case SEALED ENGLISH" 3,125,962원
//     "One Piece OP-17 Sealed Case of 12 Booster Boxes Brand New Factory Sealed English" 5,101,292원
//     "ONE PIECE OP-17 Card Game Booster box (JP VER) factory sealed case + promo pack" 144,685원 — 불명
//   "Booster Box Case Fresh" 처럼 case 바로 앞이 box 이면 "박스 케이스(12개)"로도 읽혀 지우지 않는다(추측 금지).
//   "with case of 12" 처럼 뒤에 of 가 오면 지우지 않는다.
const { parseLotQuantity } = require("./lot-quantity");

const SINGLE_BOX_CASE = [
  // 보관용 아크릴 케이스를 끼워 파는 낱박스. "Acrylic Display Case" 는 지우지 않는다 — display 는 BAD 가 거른다.
  /\b(?:hard\s+)?acrylic(?:\s+(?:protective|magnet(?:ic)?))?\s+case\b/gi,
  /\bprotective\s+case\b/gi,
  // 케이스에서 갓 꺼낸 낱박스. "Booster Box Case Fresh" 는 제외(위 설명).
  /(?<!\bbox\s+)\bcase[\s-]*fresh\b/gi,
  /\bfresh\s+case(?:\s+opening)?\b(?!\s*of\b)/gi,
  /\bfrom\s+(?:an?\s+)?(?:(?:fresh|freshly|sealed|factory|new|open(?:ed)?)\s+)*case\b(?!\s*of\b)/gi,
  // "w/ case" "with case" "+ case" "comes with case"
  /(?:\bw\/\s*|\bwith\s+|\+\s*)(?:an?\s+)?case\b(?!\s*of\b)/gi,
];

// 케이스(액세서리)만 파는 매물. 지금은 가격 하한에만 걸려 있어 따로 막는다.
//   "One Piece TCG 500 Years in the Future OP-07 Booster Box Acrylic Case Only No BB*" 30,214원
const ACCESSORY_ONLY = /\bcase\s*only\b|\bno\s*bb\b/i;

function stripSingleBoxCase(title) {
  let t = String(title || "");
  for (const re of SINGLE_BOX_CASE) t = t.replace(re, " ");
  return t;
}

// 박스 매물 수량. null = 모름(통계 제외).
// case 문구를 지운 제목에 다수량 신호가 있으면 모름으로 둔다 — "fresh case 12x booster boxes" 같은
// 케이스 판매를 개당가로 나눠 넣지 않는다(종전처럼 케이스는 통째로 뺀다).
function boxQuantity(title) {
  const t = String(title || "");
  const tq = stripSingleBoxCase(t);
  const q = parseLotQuantity(tq, "box");
  if (q == null) return null;
  if (tq !== t && q !== 1) return null;
  return q;
}

module.exports = { stripSingleBoxCase, boxQuantity, ACCESSORY_ONLY };
