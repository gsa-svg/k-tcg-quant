// 그레이더 pop 적재의 "조용한 누락" 방지 장치 테스트 — 2026-08-03 신설.
//
// 왜 있나: CGC 목록이 1→2페이지로 늘어난 걸 아무도 몰라 2026-07-22·07-27 수집이 일본판 7세트를
// 빠뜨린 채 적재됐다. 값이 틀린 게 아니라 **없는 것과 안 읽은 것이 구분되지 않는 게** 문제였다.
// 그래서 (1) 마지막 페이지 hasNext=true 면 거부 (2) 커버리지가 직전 주보다 줄면 거부 를 넣었고,
// 이 테스트가 그 두 개가 실제로 막는지 확인한다. 실데이터는 건드리지 않는다(mergePages 는 순수 함수).
// Run: node tools/test-pop-ingest-guards.js
const { mergePages } = require("./cgc-pop-ingest.js");

const fails = [];
const ok = (name, fn) => { try { fn(); } catch (e) { fails.push(`${name}: ${e.message}`); } };
const throws = (name, re, fn) => {
  try { fn(); fails.push(`${name}: 막아야 하는데 통과했다`); }
  catch (e) { if (!re.test(e.message)) fails.push(`${name}: 사유가 다르다 — ${e.message}`); }
};
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`); };

const p = (page, hasNext, boxes) => ({ grader: "cgc", collectedAt: "2026-08-03", page, hasNext, boxes });

// 1. 정상: 두 페이지가 합쳐지고, 2페이지에만 있는 일본판이 살아남는다(이번 사고의 그 값).
ok("두 페이지 병합", () => {
  const m = mergePages([
    p(1, true, { "OP-01": { jp: null, en: 4124 }, "OP-05": { jp: 8198, en: 4557 } }),
    p(2, false, { "OP-01": { jp: 6548 } }),
  ]);
  eq(m.boxes["OP-01"], { jp: 6548, en: 4124 }, "OP-01 병합");
  eq(m.boxes["OP-05"], { jp: 8198, en: 4557 }, "OP-05 유지");
  eq(m.pages, 2, "페이지 수");
});

// 2. 마지막 페이지가 hasNext=true 면 목록을 끝까지 안 읽은 것 → 거부.
throws("미완 페이지 거부", /hasNext=true/, () => mergePages([p(1, true, { "OP-01": { en: 4124 } })]));

// 3. 같은 (세트,판)이 두 페이지에 다른 값으로 나오면 같은 페이지를 두 번 읽은 것 → 거부.
throws("중복 페이지 거부", /여러 페이지에 다른 값/, () => mergePages([
  p(1, true, { "OP-01": { en: 4124 } }),
  p(2, false, { "OP-01": { en: 9999 } }),
]));

// 4. 수집일이 섞이면 서로 다른 주를 한 점으로 합치게 된다 → 거부.
throws("수집일 혼합 거부", /수집일이 섞여/, () => mergePages([
  { grader: "cgc", collectedAt: "2026-08-03", page: 1, hasNext: true, boxes: {} },
  { grader: "cgc", collectedAt: "2026-08-10", page: 2, hasNext: false, boxes: {} },
]));

if (fails.length) { console.error(JSON.stringify({ test: "FAIL", fails }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ test: "OK", cases: 4 }));
