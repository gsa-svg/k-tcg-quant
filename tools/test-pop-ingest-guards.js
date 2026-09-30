// 그레이더 pop 적재의 "조용한 누락" 방지 장치 테스트 — 2026-08-03 신설, 2026-09-30 개편.
//
// 왜 있나: CGC 목록이 1→2페이지로 늘어난 걸 아무도 몰라 2026-07-22·07-27 수집이 일본판 7세트를
// 빠뜨린 채 적재됐다. 값이 틀린 게 아니라 **없는 것과 안 읽은 것이 구분되지 않는 게** 문제였다.
// 2026-09-30: 같은 부류가 또 났다 — CGC 세트 분리값(Pristine/Gem Mint)과 TAG 10/10P 가 8/3 뒤로 원장에
// 안 쌓였다. CGC 는 자동 수집이 받은 덤프의 세트 합을 버렸고, TAG 는 브라우저 집계가 둘을 합쳐 버렸다.
// 이 테스트는 (1) 세트 합이 옛 점과 같은 모양으로 담기는지 (2) 분리값 없는 입력·커버리지 축소를 막는지 본다.
// 실데이터는 건드리지 않는다(apply 는 원장 객체만 받는 순수 함수). 가드 G9 가 매번 돌린다.
// Run: node tools/test-pop-ingest-guards.js
const cgcSet = require("./cgc-set-grades-ingest.js");
const tagPop = require("./tag-pop-ingest.js");
const { setupScript } = require("./tag-pop.js");

const fails = [];
let cases = 0;
const ok = (name, fn) => { cases += 1; try { fn(); } catch (e) { fails.push(`${name}: ${e.message}`); } };
const throws = (name, re, fn) => {
  cases += 1;
  try { fn(); fails.push(`${name}: 막아야 하는데 통과했다`); }
  catch (e) { if (!re.test(e.message)) fails.push(`${name}: 사유가 다르다 — ${e.message}`); }
};
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };
const clone = (o) => JSON.parse(JSON.stringify(o));

// ── CGC: 카드별 API 덤프 → 세트 점 ───────────────────────────────
const cgcHist = () => ({
  grader: "cgc", note: "", sets: {
    "OP-01": { jp: [{ d: "2026-08-03", total: 10, grades: { "Pristine 10": 3, "Gem Mint 10": 2, "9": 5 } }, { d: "2026-09-29", total: 12 }], en: [{ d: "2026-09-29", total: 4 }] },
    "EB-04": { jp: [{ d: "2026-09-29", total: 7 }], en: [] },
  },
});
const row = (total, pristine, gem) => ({ num: "OP01-001", name: "x", variant: "", total, pristine, gem });
const cgcDump = (d, sets) => ({ grader: "cgc", collectedAt: d, sets });
const full = { "OP-01|jp": [row(8, 3, 2), row(5, 1, 1)], "OP-01|en": [row(4, 1, 1)], "EB-04|jp": [row(7, 2, 3)] };

ok("CGC 세트 합 = 카드 행 합, 옛 점과 같은 키", () => {
  const h = cgcHist();
  const r = cgcSet.apply(h, cgcDump("2026-10-05", full));
  eq(r.appended, 3, "추가 점 수");
  eq(h.sets["OP-01"].jp.at(-1), { d: "2026-10-05", total: 13, grades: { "Pristine 10": 4, "Gem Mint 10": 3 } }, "OP-01 jp 새 점");
  eq([h.gradesThrough, h.weeklyThrough], ["2026-10-05", "2026-10-05"], "gradesThrough·weeklyThrough");
  if (!/cgc/i.test(h.note) || !/append-only/i.test(h.note)) throw new Error("note 에 cgc·append-only 고지가 없다(가드 D8)");
});

ok("CGC 같은 날 다시 돌려도 안 바뀐다", () => {
  const h = cgcHist();
  cgcSet.apply(h, cgcDump("2026-10-05", full));
  const before = JSON.stringify(h);
  cgcSet.apply(h, cgcDump("2026-10-05", full));
  eq(JSON.stringify(h), before, "재실행");
});

ok("CGC 같은 날 총량이 다르면 먼저 담긴 관측을 둔다", () => {
  const h = cgcHist();
  const r = cgcSet.apply(h, cgcDump("2026-09-29", { ...full, "OP-01|jp": [row(99, 1, 1)] }));
  eq(h.sets["OP-01"].jp.at(-1), { d: "2026-09-29", total: 12 }, "보관 점");
  eq(r.kept.length, 1, "사유 1건");
  eq(h.sets["OP-01"].en.at(-1).grades, { "Pristine 10": 1, "Gem Mint 10": 1 }, "총량이 같은 점은 분리값을 채운다");
});

throws("CGC 커버리지 축소 거부(원장에만 있는 EB-04 일본판이 빠짐)", /커버리지 축소/, () => {
  const { "EB-04|jp": _, ...rest } = full;
  cgcSet.apply(cgcHist(), cgcDump("2026-10-05", rest));
});

throws("CGC 만점 합 > 총량 거부", /만점 합/, () => cgcSet.apply(cgcHist(), cgcDump("2026-10-05", { ...full, "OP-01|en": [row(1, 1, 1)] })));

ok("CGC 거부된 덤프는 원장을 한 글자도 안 바꾼다", () => {
  const h = cgcHist();
  const before = JSON.stringify(h);
  try { cgcSet.apply(h, cgcDump("2026-10-05", { ...full, "OP-01|en": [row(1, 1, 1)] })); } catch { /* 기대한 거부 */ }
  eq(JSON.stringify(h), before, "원장");
});

// ── TAG: 브라우저 집계(__tagAgg) → 적재 ─────────────────────────
ok("TAG __tagAgg 가 10·10P 를 따로 낸다", () => {
  global.window = {};
  global.document = { querySelectorAll: () => [], querySelector: () => null };
  global.history = { pushState() {} };
  global.PopStateEvent = class {};
  eq(eval(setupScript()), "tag-ready", "셋업");
  window.__tagAll = {
    2022: [
      { name: "One Piece Romance Dawn Japanese Alternate Art", total: 100, g10: 60, g10p: 3 },
      { name: "One Piece Romance Dawn Japanese", total: 50, g10: 20, g10p: 1 },
      { name: "One Piece Premium Card Collection 25th Edition Japanese", total: 9, g10: 9, g10p: 0 },   // 박스 아님
    ],
    2023: [{ name: "One Piece Adventure on KAMI’s Island", total: 5, g10: 1, g10p: 1 }],
  };
  const snap = JSON.parse(window.__tagAgg());
  eq(snap.boxes["OP-01"].jp, { total: 150, gem: 84, g10: 80, g10p: 4 }, "OP-01 jp");
  eq(snap.boxes["OP-15"].en, { total: 5, gem: 2, g10: 1, g10p: 1 }, "OP-15 en(굽은 따옴표)");
  eq(Object.keys(snap.boxes).sort(), ["OP-01", "OP-15"], "박스 목록");
});

const tagStore = () => ({ grader: "tag", sets: { "OP-01": { jp: [{ d: "2026-08-03", total: 254, gem: 180, g10: 176, g10p: 4 }, { d: "2026-09-29", total: 275, gem: 198 }], en: [] } } });
const tagSnap = (box) => ({ grader: "tag", collectedAt: "2026-10-05", boxes: { "OP-01": { jp: box, en: null } } });

ok("TAG 분리값이 총량과 한 점에 담긴다(8/3 분리 점과 같은 모양)", () => {
  const s = tagStore();
  const r = tagPop.apply(s, tagSnap({ total: 280, gem: 201, g10: 196, g10p: 5 }));
  eq(r.appended, 1, "추가 점 수");
  eq(s.sets["OP-01"].jp.at(-1), { d: "2026-10-05", total: 280, gem: 201, g10: 196, g10p: 5 }, "새 점");
  eq(s.splitThrough, "2026-10-05", "splitThrough");
});

throws("TAG 분리값 없는 스냅샷(옛 __tagAgg) 거부", /분리값이 없다/, () => tagPop.apply(tagStore(), tagSnap({ total: 280, gem: 201 })));

ok("TAG gem ≠ 10+10P 인 점은 담지 않는다", () => {
  const s = tagStore();
  const r = tagPop.apply(s, tagSnap({ total: 280, gem: 201, g10: 190, g10p: 5 }));
  eq([r.appended, r.rejected], [0, 1], "추가·거부");
});

throws("TAG 커버리지 축소 거부", /커버리지 축소/, () => {
  const s = tagStore();
  s.sets["OP-02"] = { jp: [{ d: "2026-09-29", total: 10, gem: 5 }], en: [] };
  tagPop.apply(s, tagSnap({ total: 280, gem: 201, g10: 196, g10p: 5 }));
});

if (fails.length) { console.error(JSON.stringify({ test: "FAIL", fails }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ test: "OK", cases }));
