#!/usr/bin/env node
"use strict";
// tools/card-list-cell-check.js 역테스트 — 2026-10-14 신설. 규칙을 어긴 칸을 일부러 만들어 잡히는지 본다.
// Run: node tools/test-card-list-cells.js
const assert = require("assert");
const { checkCells } = require("./card-list-cell-check");

const auction = { variants: {
  "OP17-001|jp|base": { sold: 5, medPrice: 12.5 },
  "OP17-002|jp|base": { sold: 7, medPrice: 30, suspect: true },
  "OP17-003|jp|alt": { sold: 4, medPrice: 99.99 },
  "OP17-001|en|base": { sold: 9, medPrice: 3 },
} };
const card = (id, number, extra) => ({ id, number, auction: null, auctionEnglishPrint: null, psa10: null, ...extra });
const doc = (cards) => [{ set: "OP-17", cards }];
const jp = (usd, sold) => ({ print: "Japanese", medianUsd: usd, sold });
const en = (usd, sold) => ({ print: "English", medianUsd: usd, sold });

// 1) 정상 — 원천 변형과 같은 값·건수, suspect 아님, 표본 충분
assert.deepStrictEqual(checkCells(doc([card("OP17-001", "OP17-001", { auction: jp(12.5, 5), auctionEnglishPrint: en(3, 9) })]), auction), []);
// 2) suspect 변형 값을 실으면 잡힌다
assert.ok(checkCells(doc([card("OP17-002", "OP17-002", { auction: jp(30, 7) })]), auction).some((p) => /suspect/.test(p)));
// 3) 표본 3건 미만이면 잡힌다
assert.ok(checkCells(doc([card("OP17-001", "OP17-001", { auction: jp(12.5, 2) })]), auction).some((p) => /< 3/.test(p)));
// 4) 원천에 없는 값(지어낸 값)이면 잡힌다
assert.ok(checkCells(doc([card("OP17-001", "OP17-001", { auction: jp(13, 5) })]), auction).some((p) => /원천에 같은 값/.test(p)));
// 5) 같은 키를 두 ID 가 나눠 가지면 잡힌다(병행 인쇄 _p1·_p2 가 같은 alt 키를 단 경우)
assert.ok(checkCells(doc([card("OP17-003_p1", "OP17-003", { auction: jp(99.99, 4) }), card("OP17-003_p2", "OP17-003", { auction: jp(99.99, 4) })]), auction).some((p) => /나눠 단다/.test(p)));
// 6) 같은 ID 가 두 상품 목록에 실리는 것은 겹침이 아니다(EB04-061_p3 가 EB-04·OP-17 목록에 모두 있음)
assert.deepStrictEqual(checkCells([{ set: "EB-04", cards: [card("OP17-003_p1", "OP17-003", { auction: jp(99.99, 4) })] }, { set: "OP-17", cards: [card("OP17-003_p1", "OP17-003", { auction: jp(99.99, 4) })] }], auction), []);
// 7) PSA 10 표본 미만
assert.ok(checkCells(doc([card("OP17-001", "OP17-001", { psa10: { usd: 100, n: 2 } })]), auction).some((p) => /psa10/.test(p)));
console.log(JSON.stringify({ test: "card-list-cells", ok: true, cases: 7 }));
