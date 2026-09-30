// 합본 세트 — 영문판 OP-14·OP-15 박스는 EB-04 를 함께 담아 한 상품으로 나왔다(EB-04 영문 단독판은 없다).
// 제품코드가 "OP14-EB04"·"OP15-EB04" 라 제목·CGC 항목에 두 코드가 같이 적힌다.
// 화면(inject-grader-editions)·박스 sold 적재(box-sold-ingest)가 이 한 곳을 쓴다. 따로 들고 있으면 언젠가 갈라진다.
//
// 2026-09-30 실사고: 적재기는 이 표를 몰라서 "OP14-EB04 ... Booster Box English" 를 다른 세트가 같이 적힌 제목(cross-set)으로
// 버렸다. 9/18~9/30 덤프에서만 영문 단품 141건(OP-14 34 · OP-15 107)이 빠졌고 원장에는 EB04 제목이 0건이었다.
const COMBINED = { "OP-14": { en: "EB-04" }, "OP-15": { en: "EB-04" } };
module.exports = { COMBINED };
