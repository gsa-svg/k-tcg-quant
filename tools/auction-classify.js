// 경매 매물 종류 분류 — box(단일/다수 부스터박스) · carton(케이스/카톤) · pack(부스터팩·더블팩) · card.
// ⚠️ 박스 통계는 "무조건 부스터박스"만. 더블팩·팩이 box 로 새거나, 카톤(박스 여러개)이 box 1건으로
//    잡히면 거래량이 왜곡된다. 순서 중요: 더블팩 → 카톤 → 박스 → 팩. 규칙 변경 시 가드 Q2가 검증.
function categorize(title) {
  const t = String(title || "");
  if (/double\s*pack|\btriple\s*pack\b/i.test(t)) return "pack";                       // 더블/트리플팩 = 팩
  if (/\bcarton\b|sealed\s*case|case\s*of\s*\d+|\d+\s*box\s*case|\bfull\s*case\b/i.test(t)) return "carton";
  if (/booster\s*box|display\s*box/i.test(t)) return "box";
  if (/booster\s*pack|\d+\s*packs?\b|sealed\s*pack|\bpack\b/i.test(t)) return "pack";
  return "card";
}

module.exports = { categorize };
