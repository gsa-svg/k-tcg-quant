"use strict";
// 카드리스트(sets/<code>-card-list.json)의 우리 숫자 칸 검사 — 2026-10-14 QA 신설. 가드 CL1 과 tools/test-card-list-cells.js 가 쓴다.
//
// 왜: 카드리스트의 경매·PSA 10 칸은 "규칙으로 확정되는 경우에만" 붙인다(유일 키·suspect 제외·표본 3건 이상, 아니면 빈칸).
//     그런데 그 규칙을 지키는지 보는 검사가 없었다(CL1 은 박스 값 줄만, test-official-cardlist 는 파서만 봤다).
//     생성기(generate-card-list-pages.js)의 함수를 부르지 않고, 산출 JSON 과 원천(data/auction-card-stats.json)만으로 다시 대조한다.
//
// 규칙
//  · 경매 칸(일본판 인쇄 auction · 영문판 인쇄 auctionEnglishPrint) = 원천 변형 하나와 정확히 같아야 한다:
//    키 "<번호>|jp|…" / "<번호>|en|…" 중 suspect 가 아니고 sold ≥ MIN_N 이며 중앙값·건수가 같은 것.
//  · 같은 원천 변형(키)을 두 ID 가 나눠 가지면 안 된다(전 세트 통틀어) — 키가 겹치면 둘 다 빈칸이 규칙이다.
//  · PSA 10 칸은 n ≥ MIN_N.
const MIN_N = 3;
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);

function checkCells(docs, auction, { minN = MIN_N } = {}) {
  const problems = [];
  const variants = (auction && auction.variants) || {};
  const byNumEd = {};
  for (const [key, v] of Object.entries(variants)) {
    const [num, ed] = key.split("|");
    (byNumEd[`${num}|${ed}`] = byNumEd[`${num}|${ed}`] || []).push({ key, v });
  }
  const claimed = {};   // 원천 키 → 그 키를 단 ID 들
  for (const doc of docs) {
    for (const c of doc.cards || []) {
      for (const [field, ed] of [["auction", "jp"], ["auctionEnglishPrint", "en"]]) {
        const a = c[field];
        if (!a) continue;
        if (!(a.sold >= minN)) { problems.push(`${doc.set} ${c.id} ${field} n=${a.sold} < ${minN} — 표본이 모자라면 빈칸`); continue; }
        const cands = (byNumEd[`${c.number}|${ed}`] || []).filter(({ v }) => (v.sold || 0) === a.sold && r2(v.medPrice) === a.medianUsd);
        const ok = cands.filter(({ v }) => !v.suspect && (v.sold || 0) >= minN);
        if (!cands.length) { problems.push(`${doc.set} ${c.id} ${field} ${a.medianUsd}(n=${a.sold}) — 원천에 같은 값의 ${c.number}|${ed} 변형이 없다`); continue; }
        if (!ok.length) { problems.push(`${doc.set} ${c.id} ${field} — 원천 변형이 suspect 다(${cands[0].key})`); continue; }
        if (ok.length === 1) (claimed[ok[0].key] = claimed[ok[0].key] || new Set()).add(c.id);   // 같은 ID 가 두 상품 목록에 실리는 것은 겹침이 아니다
      }
      if (c.psa10 && !(c.psa10.n >= minN)) problems.push(`${doc.set} ${c.id} psa10 n=${c.psa10.n} < ${minN}`);
    }
  }
  for (const [key, ids] of Object.entries(claimed)) {
    if (ids.size > 1) problems.push(`원천 변형 ${key} 를 ${ids.size}개 ID 가 나눠 단다(${[...ids].slice(0, 3).join(", ")}) — 키가 겹치면 빈칸이 규칙`);
  }
  return problems;
}

module.exports = { checkCells, MIN_N };
