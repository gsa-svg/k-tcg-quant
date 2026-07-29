// auction-fields.js 검증 — "애매하면 null" 규칙이 지켜지는지 본다.
// 등급을 잘못 붙이면 카드 가격 통계가 통째로 오염된다(변형 오매칭과 같은 종류의 사고).
// Run: node tools/test-auction-fields.js
const { parseGrade, parseCardNo, parseEdition, sellerTier, extraFields } = require("./auction-fields");

let fail = 0;
const eq = (got, want, msg) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g !== w) { console.error(`FAIL ${msg}\n  got  ${g}\n  want ${w}`); fail++; }
};

// ── 등급: 확신할 때만
eq(parseGrade("PSA 10 Luffy OP01-120"), { co: "PSA", g: "10" }, "PSA 10");
eq(parseGrade("CGC9.5 Shanks"), { co: "CGC", g: "9.5" }, "CGC9.5 붙여쓰기");
eq(parseGrade("CGC Pristine 10 Ace"), { co: "CGC", g: "10", qual: "Pristine" }, "CGC Pristine 10");
// 실측 제목(2026-07-29): 수식어가 등급 숫자 뒤에 온다. 뭉개면 Pristine 10 / Gem Mint 10 구분이 사라진다.
eq(parseGrade("OP16-116 ALTERNATE ART CGC 10 PRISTINE JP"), { co: "CGC", g: "10", qual: "Pristine" }, "수식어 후치");
eq(parseGrade("CGC Gem Mint 10 Shanks"), { co: "CGC", g: "10", qual: "Gem Mint" }, "CGC Gem Mint 10");
eq(parseGrade("CGC 10 Luffy"), { co: "CGC", g: "10" }, "수식어 없으면 붙이지 않는다");
eq(parseGrade("TAG 10P Zoro"), { co: "TAG", g: "10P" }, "TAG 10P");
eq(parseGrade("Raw NM Luffy OP01-120"), null, "등급 없음");
eq(parseGrade("Lot PSA 10 and CGC 9.5 cards"), null, "등급 두 개면 단정 금지");
eq(parseGrade("PSA 10 PSA10 same card"), { co: "PSA", g: "10" }, "같은 등급 중복은 하나로");

// ── 카드번호: aspects 값이 여럿이면 버린다
eq(parseCardNo({ "Card Number": "OP13-118" }), "OP13-118", "카드번호 단일");
eq(parseCardNo({ "Card Number": "OP09-119 ST15-005 OP07-118" }), null, "카드번호 복수 → 버림");
eq(parseCardNo({}), null, "카드번호 없음");

// ── 판: aspects 가 제목보다 우선
eq(parseEdition({ title: "Japanese OP-05 box" }, { Language: "Japanese" }), { ed: "jp", edSrc: "agree" }, "둘 다 일치");
eq(parseEdition({ title: "OP-05 box" }, { Language: "English" }), { ed: "en", edSrc: "aspect" }, "aspect 만 있음");
eq(parseEdition({ title: "Japanese OP-05 box" }, {}), { ed: "jp", edSrc: "title" }, "제목 폴백");
eq(parseEdition({ title: "OP-05 box" }, {}), { ed: null, edSrc: null }, "판 불명");
// 실측 사고(2026-07-29): 제목은 Japanese, aspects 는 English. 한쪽을 고르면 판별 시세가 오염된다.
eq(parseEdition({ title: "Katakuri SP OP11-067 Japanese CGC 10" }, { Language: "English" }),
   { ed: null, edSrc: null, edConflict: true }, "판 불일치 → 둘 다 버림");

// ── 카드번호 불일치: 판매자가 항목을 복사해 올린 실측 사례
const conflict = extraFields({ title: "Charlotte Katakuri SP OP11-067 One Piece Card CGC 10", localizedAspects: [{ name: "Card Number", value: "OP10-045" }] });
eq(conflict.aspectCardId, undefined, "번호 불일치면 aspects 번호를 쓰지 않는다");
eq(conflict.cardIdConflict, true, "불일치는 표시로 남긴다");

// ── 판매자: 개인 식별값을 남기지 않는다
const tier = sellerTier({ seller: { username: "popo-20-84", feedbackScore: 15153, feedbackPercentage: "97.8" } });
eq(tier, { band: "10k+", rep: "95-98" }, "판매자 구간화");
eq(JSON.stringify(tier).includes("popo"), false, "username 미저장");

// ── 통합: 값 없는 키는 아예 넣지 않는다
const out = extraFields({ title: "One Piece OP-05 box", itemLocation: { country: "JP" }, itemEndDate: "2026-07-29T04:08:01.000Z" });
eq("grade" in out, false, "등급 없으면 키 자체를 안 만든다");
eq(out.loc, "JP", "판매국가");
eq(out.endedAt, "2026-07-29T04:08:01.000Z", "종료 시각 원본 보존");

if (fail) { console.error(`${fail} test(s) failed`); process.exit(1); }
console.log(JSON.stringify({ test: "auction-fields", ok: true }));
