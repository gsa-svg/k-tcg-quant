// 경매 매물 종류 분류 — box(단일/다수 부스터박스) · carton(케이스/카톤) · pack(부스터팩·더블팩) · card.
// ⚠️ 박스 통계는 "무조건 부스터박스"만. 더블팩·팩이 box 로 새거나, 카톤(박스 여러개)이 box 1건으로
//    잡히면 거래량이 왜곡된다. 순서 중요: 더블팩 → 개봉벌크 → 카톤 → 박스 → 팩. 규칙 변경 시 가드 Q2가 검증.
//
// 2026-09-01 두 구멍을 막았다 — 실측 원장에서 발견.
//  (1) "Booster Box Case" 가 카톤 규칙에 없어 12박스 케이스가 box 로 샜다. 31일 낙찰 199건 중 10건이
//      그것이었고 $2,325~$11,602 짜리가 섞여 박스 중앙값을 밀어올렸다.
//      단 "acrylic case"(보관용 아크릴)·"case fresh"(케이스에서 갓 꺼낸 낱박스)는 박스 1개다 — 먼저 걸러낸다.
//  (2) "Opened! ... Booster Box Bulk" 같은 개봉 카드뭉치가 box 로 잡혔다. 밀봉이 아니므로 card 다.

// 케이스라는 말이 붙었지만 케이스가 아닌 것. 카톤 판정보다 먼저 본다.
const NOT_CASE = /acrylic\s*case|case\s*fresh|display\s*case|storage\s*case|carrying\s*case/i;
// 박스 여러 개가 든 원래 포장. "booster box case" 는 영어권 리스팅에서 카톤을 가리키는 가장 흔한 말이다.
const BOX_CASE = /\bcarton\b|sealed\s*case|case\s*of\s*\d+|\d+\s*box\s*case|\bfull\s*case\b|booster\s*box\s*case|\bbox\s*case\b/i;
// 개봉해서 카드만 파는 것 — 밀봉 상품이 아니다.
const OPENED = /\bbulk\b|\bopened\b|\bloose\b|\bno\s*box\b/i;

function categorize(title) {
  const t = String(title || "");
  if (/double\s*pack|\btriple\s*pack\b/i.test(t)) return "pack";                       // 더블/트리플팩 = 팩
  if (OPENED.test(t)) return "card";                                                   // 개봉 벌크 = 밀봉 아님
  if (!NOT_CASE.test(t) && BOX_CASE.test(t)) return "carton";                          // 케이스/카톤 = box 아님
  if (/booster\s*box|display\s*box/i.test(t)) return "box";
  if (/booster\s*pack|\d+\s*packs?\b|sealed\s*pack|\bpack\b/i.test(t)) return "pack";
  return "card";
}

module.exports = { categorize };
