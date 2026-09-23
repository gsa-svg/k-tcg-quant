// 다른 카드게임 상품을 걸러내는 단어 목록 — 적재(box-sold-ingest)·수리(repair-box-ledger)·가드(guard-invariants)가
// 전부 이 한 곳을 쓴다. 세 곳이 따로 목록을 들고 있으면 언젠가 갈라진다.
//
// 2026-09-24 실사고: 건담 카드게임 "Eternal Nexus EB01" 박스($100~140)가 EB-01 영문판 원장에 8건 들어가
// 영문 EB-01 실거래 중앙값이 $903 → $140 으로 무너진 채 세트 페이지·설명문·AI 파일에 나갔다.
// "EB01" 이라는 세트코드가 두 게임에 다 있어서 코드만으로는 못 거른다 — 게임 이름으로 거른다.
// One Piece 제목에 절대 안 나오는 이름만 넣는다("bandai" 는 원피스에도 붙으므로 넣지 않는다).
const OTHER_GAME = /\bgundam\b|eternal\s*nexus|dragon\s*ball|union\s*arena|digimon|pok[eé]mon|battle\s*spirits|weiss|wei[sß]\s*schwarz|riftbound|lorcana|yu-?gi-?oh|magic:?\s*the\s*gathering|\bmtg\b|cardfight|vanguard|flesh\s*and\s*blood|star\s*wars\s*unlimited|metazoo|\bnaruto\b|jujutsu|hunter\s*x\s*hunter|bleach\b|my\s*hero\s*academia|\bsorcery\b/i;
module.exports = { OTHER_GAME };
