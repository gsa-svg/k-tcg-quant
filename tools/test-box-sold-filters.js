#!/usr/bin/env node
// 박스 sold 적재 판정 회귀 테스트 — 2026-09-30. 가드(guard-invariants.js Q1)가 이 파일을 실행한다.
//
// 1) "case" 가 붙은 단품 박스는 살리고, 진짜 케이스(12박스)·불명·액세서리는 계속 버린다(box-case-words.js).
// 2) PRB-02 이름 속 권 번호("Vol. 2", "The Best 2")를 수량 2로 읽지 않는다(lot-quantity.js VOLUME_STRIP).
// 3) 팰월드 원장 중복 키는 id + 판매일이다(palworld-sold-ingest.js mergeDump).
//
// 제목·가격·날짜는 C:/Users/kimtt/opbox-heartbeat/box-sold-cdp/box-2026-09-18~30.json 덤프 원문이다.
// "(합성)" 표시가 붙은 것만 위험 경계를 막으려고 만든 제목이다.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { judgeItem } = require("./box-sold-ingest");
const { boxQuantity } = require("./box-case-words");
const { parseLotQuantity } = require("./lot-quantity");
const { mergeDump } = require("./palworld-sold-ingest");

const R = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "onepiece-packs.json"), "utf8")).fx.usdKrw;
const item = (t, k, d) => ({ id: "1", t, k, cur: "KRW", d: d || "Sold  Sep 21, 2026" });

// ── 1-a. 살려야 하는 단품 박스 [세트, 신고 판본, 제목, 원화]
const KEEP = [
  ["EB-01", "en", "One Piece Memorial Collection Booster Box EB-01 English w/ Acrylic Case", 1145829],
  ["EB-01", "en", "One Piece Card Game🏴‍☠️EB-01 BOOSTER BOX (MEMORIAL COLLECTION) F-SEALED W/CASE", 1101120],
  ["OP-02", "en", "Bandai One Piece TCG Paramount War OP-02 English Booster Box Sealed with case", 851874],
  ["OP-02", "en", "One Piece TCG: OP-02 Paramount War Booster Box, Sealed,English.FROM A FRESH CASE", 865087],
  ["OP-09", "en", "ONE PIECE EMPERORS IN THE NEW WORLD ENGLISH BOOSTER BOX OP-09 SEALED w/ Case!!", 915453],
  ["OP-09", "en", "One Piece OP-09 Booster Box English Sealed OP09 w/ Acrylic Protective Case", 1035870],
  ["OP-10", "en", "One Piece TCG OP10 Royal Blood Eng Booster Box | 1 Sealed Box From Fresh Case🔥", 386770],
  ["OP-11", "en", "One Piece Card Game OP-11 A Fist of Divine Speed English Booster Box Fresh Case", 825840],
  ["OP-12", "en", "ONE PIECE ENGLISH  LEGACY OF THE MASTER BOOSTER BOX OP12 fresh from open case", 340281],
  ["OP-13", "en", "One Piece TCG OP13 Booster Box MINT English - New & Sealed CASE FRESH 🚀✅", 594499],
  ["OP-13", "en", "One Piece TCG: Carrying On His Will Booster Box (OP-13) SEALED comes with case!", 665969],
  ["OP-13", "en", "NEW One Piece Card Game OP13 (Carrying on His Will) Booster Box in Acrylic Case", 720515],
  ["OP-14", "en", "One Piece Card Game OP-14 The Azure Sea's Seven Booster Box English Sealed +Case", 439017],
  ["OP-16", "en", "One Piece - The Time of Battle Booster Box - English - OP16 - FRESH CASE OPENING", 378636],
  ["OP-16", "en", "One Piece Booster Box OP16 The Time of Battle English Pulled From Sealed Case!!!", 305802],
  ["OP-17", "en", "One Piece - OP17 The World's Strongest Warriors Booster Box SEALED! - Case Fresh", 499638],
  ["OP-01", "jp", "One Piece OP-01 Romance Dawn Booster Box  w/ Hard Acrylic Case - Japanese Sealed", 475692],
  ["OP-01", "en", "OP-01 Romance Dawn Blue Bottom Booster Box Sealed w/Acrylic Case (Slight damage)", 5365758],
  ["PRB-02", "en", "One Piece The Best Vol 2 Premium Booster Box PRB-02 English Sealed Case Fresh", 573794],
];
for (const [code, ed, t, k] of KEEP) {
  const r = judgeItem(item(t, k), code, R, null, ed, "bin");
  assert.ok(r.rec, `살려야 할 단품이 버려짐(${r.drop}): ${t}`);
  assert.equal(r.ed, ed, t);
  assert.equal(r.rec.qty, 1, t);
  assert.ok(Math.abs(r.rec.unit - k / R) < 0.01, `개당가가 총액과 달라짐: ${t}`);
  assert.equal(r.rec.title, t.slice(0, 140), "원장에는 원 제목을 남긴다");
}

// ── 1-b. 계속 버려야 하는 것 [세트, 신고 판본, 제목, 원화, 기대 drop]
const DROP = [
  // 12박스 케이스 — 원장 중앙값의 10~28배. 1박스로 들어가면 시세가 무너진다.
  ["OP-16", "en", "One Piece TCG OP-16 The Time Of Battle Booster Box Case SEALED ENGLISH", 3125962, "bad-word"],
  ["OP-17", "en", "ONE PIECE CARD GAME - OP17 STRONGEST WARRIORS BOOSTER BOX CASE (ENGLISH, SEALED)", 5044238, "bad-word"],
  ["OP-17", "en", "One Piece OP-17 Sealed Case of 12 Booster Boxes Brand New Factory Sealed English", 5101292, "bad-word"],
  ["OP-17", "en", "ONE PIECE OP-17 BOOSTER BOX SEALED CASE of 12.  In Hand.", 5728291, "bad-word"],
  ["OP-17", "en", "One Piece OP-17 Worlds Strongest Warriors Sealed Case 12x Booster Box ENGLISH 📦", 6221059, "bad-word"],
  ["OP-17", "en", "NEW! ONE PIECE OP-17 BOOSTER BOX SEALED CASE - WAVE 2 (OCT 26) PRE ORDER", 6305279, "bad-word"],
  ["OP-11", "jp", "One Piece TCG OP-11 A Fist Of Divine Speed Booster Box Case Japanese Sealed", 1697541, "bad-word"],
  ["OP-11", "en", "One Piece OP-11 A Fist of Divine Speed – English Booster Box Sealed Case", 9814247, "bad-word"],
  ["OP-16", "en", "One Piece OP-16 The Time of Battle Sealed Booster Box Case (12) English", 3245568, "bad-word"],
  ["PRB-02", "en", "One Piece PRB-02 Premium The Best Sealed Case (10 Booster Boxes)", 5404523, "bad-word"],
  ["PRB-02", "jp", "Japanese The Best Vol. 2 PRB-02 Booster Box Case Sealed One Piece US SELLER", 2990050, "bad-word"],
  ["OP-14", "jp", "One Piece CARD GAME OP-14 BOOSTER BOX OP-14 japanese SEALED CASE US SELLER", 2242534, "bad-word"],
  // 불명 — 1박스 가격대($107~122)지만 "factory sealed case + promo pack" 이 무엇인지 모른다. 추측하지 않는다.
  ["OP-17", "jp", "ONE PIECE OP-17 Card Game Booster box (JP VER) factory sealed case + promo pack", 144685, "bad-word"],
  // 케이스(액세서리)만 판 것
  ["OP-07", "en", "One Piece TCG 500 Years in the Future OP-07 Booster Box Acrylic Case Only No BB*", 30214, "accessory-only"],
  ["OP-09", "en", "One Piece Emperors In The New World Booster Box *Acrylic Case Only NO Booster", 30200, "accessory-only"],
  ["OP-13", "en", "One Piece Booster Box Acrylic Display Case OP04-17 Magnetic Lid 99% UVR", 18788, "bad-word"],
  // 다른 게임은 case 문구와 무관하게 버린다
  ["EB-01", "en", "Eternal Nexus Booster Box EB01 Gundam Card Game New Sealed English Case Fresh", 189778, "other-game"],
];
for (const [code, ed, t, k, want] of DROP) {
  const r = judgeItem(item(t, k), code, R, null, ed, "bin");
  assert.equal(r.drop, want, `버려야 할 것이 ${r.drop ? r.drop : "통과"}: ${t}`);
}

// ── 1-c. 경계: case 문구를 지운 뒤 다수량이 보이면 모름(null). 케이스를 개당가로 나눠 넣지 않는다.
assert.equal(boxQuantity("One Piece OP-13 Booster Box English Fresh Case 12x Booster Boxes"), null);      // (합성)
for (const [t, want] of [
  ["One Piece OP-13 Booster Box English Fresh Case 12x Booster Boxes", "uncountable-lot"],                // (합성)
  ["One Piece OP-13 Booster Box English Sealed with case of 12 boxes", "bad-word"],                       // (합성) with case 뒤 of
  ["One Piece OP-13 Booster Box Case Fresh English", "bad-word"],                                         // (합성) box case fresh 는 케이스로도 읽힌다
]) assert.equal(judgeItem(item(t, 3000000), "OP-13", R, null, "en", "bin").drop, want, t);
assert.equal(boxQuantity("One Piece Memorial Collection Booster Box EB-01 English w/ Acrylic Case"), 1); // 수리 도구도 같은 판정
assert.equal(boxQuantity("One Piece OP-13 Booster Box Japanese Sealed"), 1);

// ── 2. PRB-02 권 번호는 수량이 아니다
for (const t of [
  "Sealed Japanese The Best Vol. 2 PRB-02 Booster Box US SELLER One Piece Card Game",
  "One Piece Card Game - PRB-02 Premium Booster The Best 2 - Booster Box (English)",
  "One Piece TCG PRB-02 Premium Booster 2 Booster Box (FREE SHIPPING✔️)",
  "Sealed Premium Booster Vol 2 Booster Box PRB-02 One Piece Card Game",
  "One Piece The Best Vol 2 PRB-02 Booster Box Japanese",
  "One Piece TCG: The Best 2 Premium Booster Box [PRB-02] - 20 Packs (FACTORY SEAL)",
]) assert.equal(parseLotQuantity(t, "box"), 1, t);
assert.equal(parseLotQuantity("PRB-02 Premium Booster 2 Booster Box 20 Packs English", "box"), 1);          // (합성) 20팩=프리미엄 1박스
assert.equal(parseLotQuantity("One Piece TCG - PRB-02 The Best Vol. 2 - Booster Box Packs - Lots Of 5 - English", "box"), null);
assert.equal(parseLotQuantity("3 Booster Boxes One Piece OP-08 Sealed", "box"), 3);                      // 진짜 수량은 그대로
// 반값이 9만원 하한에 걸려 버려지던 일본판 낱박스(168561495720, Sold Sep 16, 2026, 144,522원)
{
  const t = "Japanese The Best Vol. 2 PRB-02 Booster Box US SELLER One Piece Card Game";
  const r = judgeItem(item(t, 144522, "Sold  Sep 16, 2026"), "PRB-02", R, null, "jp", "bin");
  assert.ok(r.rec, `PRB-02 일본판 낱박스가 버려짐(${r.drop})`);
  assert.equal(r.rec.qty, 1);
}

// ── 3. 팰월드: 같은 매물 id 의 다른 날 판매는 새 판매, 같은 날은 중복
{
  const old = { id: "336712363425", d: "2026-08-11", unit: 102.52, total: 102.52, qty: 1, title: "Palworld TCG Dawn of Palpagos Booster Box JP New Sealed" };
  const ledger = { sets: { "BP-01": { jp: [{ ...old }], en: [] } } };
  const dump = { pages: [{ query: "jp", items: [{ id: "336712363425", t: "Palworld TCG Dawn of Palpagos Booster Box JP New Sealed", d: "Sold  Sep 11, 2026", k: 118315.34, cur: "KRW" }] }] };
  const a = mergeDump(ledger, dump, 1353.36);
  assert.equal(a.added, 1, "다른 날 판매를 중복으로 버림");
  assert.deepEqual(ledger.sets["BP-01"].jp[0], old, "기존 레코드가 바뀜");
  assert.deepEqual(ledger.sets["BP-01"].jp.map((r) => r.d), ["2026-08-11", "2026-09-11"]);
  const b = mergeDump(ledger, dump, 1353.36);
  assert.equal(b.added, 0);
  assert.equal(b.dup, 1, "같은 날 같은 매물은 한 건");
}

// ── 4. 합본 제품코드 OP14-EB04·OP15-EB04 — 영문 OP-14·OP-15 박스다. 짝 코드(EB-04) 때문에 cross-set 으로 버리지 않는다(2026-09-30, 141건 누락).
// [세트, 신고 판본, 제목, 원화, 기대: "en" 이면 통과·그 판본, 아니면 drop 이유]
const COMBINED_CASES = [
  ["OP-14", "en", "One Piece TCG - OP14-EB04 OP14 The Azure Sea's Seven Booster Box English SEALED", 344106, "en"],
  ["OP-14", "en", "One Piece - Azure Sea's Seven Booster Box English OP14-EB04", 380555, "en"],
  ["OP-15", "en", "One Piece: Adventure on Kami's Island (OP15-EB04) Booster Box", 344092, "en"],
  ["OP-15", "en", "One Piece OP15/EB04 Adventure on KAMI'S Island Booster Box ENGLISH Sealed", 344106, "en"],
  ["OP-15", "en", "One Piece TCG OP-15 EB-04 Adventure On Kami's Island Booster Box - NEW - SEALED", 387294, "en"],
  // (합성) 합본은 영문판에만 있다 — 일본판 칸으로 들어오면 버린다.
  ["OP-15", "jp", "One Piece OP15-EB04 Adventure on Kami's Island Booster Box Japanese", 150000, "combined-code-not-en"],
  // (합성) 짝이 아닌 다른 세트가 같이 적히면 종전대로 cross-set.
  ["OP-15", "en", "One Piece OP14 OP15 EB04 Booster Box English Sealed", 700000, "cross-set"],
  // (합성) EB-04 는 합본 짝이지 추적 세트가 아니다 — OP-13 페이지에 EB04 가 붙으면 cross-set.
  ["OP-13", "en", "One Piece OP13 EB04 Booster Box English", 600000, "cross-set"],
];
for (const [code, ed, t, k, want] of COMBINED_CASES) {
  const r = judgeItem(item(t, k), code, R, null, ed, "bin");
  if (want === "en") { assert.ok(r.rec, `합본 영문 박스가 버려짐(${r.drop}): ${t}`); assert.equal(r.ed, "en", t); }
  else assert.equal(r.drop, want, t);
}

console.log(JSON.stringify({ ok: true, keep: KEEP.length, drop: DROP.length, combined: COMBINED_CASES.length }));
