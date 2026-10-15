#!/usr/bin/env node
"use strict";
// 가드 구조 검사 자체검증 — 2026-10-15 신설. 검사 안 하고 통과했다고 말하는 그물(R4 사고)을 막는다.
//  ① FACTS-SOURCE: 생성기에 순수 함수 반입·원장 필드·시계열 사실 읽기를 심으면 잡고, 깨끗한 소스는 통과한다.
//  ② PAGES-VS-FACTS: 사실 파일의 세트 하나 판매 중앙값을 바꾸면 그 세트 페이지가 어긋난다고 잡는다(생성물은 그대로).
// Run: node tools/test-guard-structural.js  (tools/check.js 가 test-*.js 로 자동 실행)
const fsrc = require("./guard/facts-source");

const fails = [];
const expect = (cond, msg) => { if (!cond) fails.push(msg); };

// ① 가짜 생성기 소스 — require 글자는 실행 때 잇는다(audit-workflows 가 이 파일의 require 문자열을 읽어 집계 소비자로 오인하지 않게)
const REQ = (m) => 'require("./' + m + '")';
const clean = `const F = ${REQ("build-site-facts")}.load();\nconst { SITE, isDate } = ${REQ("market-data-normalizers")};\n// priciest 는 주석일 뿐\nconst s = F.sets[code]; const pc = s.top10.priciest; const html = \`\${s.current.jp ? "x" : "y"}\`;\n`;
expect(fsrc.scan("clean.js", clean).length === 0, `깨끗한 소스를 잡았다: ${fsrc.scan("clean.js", clean).join(" / ")}`);
const bad1 = clean + `const { priciest } = ${REQ("market-data-normalizers")};\nconst top = priciest(s.cards, F.fx);\n`;
expect(fsrc.scan("bad1.js", bad1).some((p) => /priciest/.test(p)), "순수 함수 호출(priciest)을 못 잡았다");
const bad1b = clean + `const { priciest: top1 } = ${REQ("market-data-normalizers")};\nconst top = top1(s.cards, F.fx);\n`;
expect(fsrc.scan("bad1b.js", bad1b).some((p) => /priciest/.test(p)), "별칭 반입({ priciest: top1 }) 호출을 못 잡았다");
expect(fsrc.scan("reexport.js", clean + `const { priciest } = ${REQ("market-data-normalizers")};\nmodule.exports = { priciest };\n`).length === 0, "부르지 않는 재수출을 잡았다");
const bad2 = clean + `const N = ${REQ("market-data-normalizers")};\nconst ch = N.boxChange28(pts, cur);\n`;
expect(fsrc.scan("bad2.js", bad2).some((p) => /boxChange28/.test(p)), "별칭 호출(N.boxChange28)을 못 잡았다");
const bad3 = clean + `const v = card.nmJpy > 0 ? card.psa10Ebay.middle : null;\n`;
expect(fsrc.scan("bad3.js", bad3).some((p) => /nmJpy|psa10Ebay/.test(p)), "원장 필드(nmJpy·psa10Ebay)를 못 잡았다");
const bad4 = clean + `const SOLD = readJson("data/box-sold-series.json", { sets: {} });\nconst ser = SOLD.sets[code];\nconst cur = ser.current.jp;\n`;
expect(fsrc.scan("bad4.js", bad4).some((p) => /current/.test(p)), "시계열 변수에서 current 읽기를 못 잡았다");
const ok4 = clean + `const SOLD = readJson("data/box-sold-series.json", { sets: {} });\nconst pts = (SOLD.sets[code].jp || []).map((p) => p.median);\n`;
expect(fsrc.scan("ok4.js", ok4).length === 0, "그래프 점(SOLD.sets[code].jp)을 잘못 잡았다");
expect(fsrc.targets().length >= 20, `실제 검사 대상 생성기가 ${fsrc.targets().length}개 — tools/build.js STEPS 를 못 읽었나`);

// ② 사실 변조 — 한 세트의 판매 중앙값을 바꾼 사실을 가드 공용(lib.useFacts)으로 준다. 생성물은 그대로.
const lib = require("./guard/lib");
const mutated = JSON.parse(JSON.stringify(lib.facts()));
const code = mutated.order.setPages.find((c) => mutated.sets[c].current.jp && mutated.sets[c].keyFacts.jp.sold);
if (!code) fails.push("current.jp 가 있는 세트가 없어 변조 시험을 못 했다");
else {
  const s = mutated.sets[code];
  s.current.jp.median += 7; s.keyFacts.jp.sold.median += 7; s.lastPoint.jp.median += 7;
  lib.useFacts(mutated);
  require("./guard/pages-vs-facts").run();
  const hits = [...lib.errors, ...lib.warnings].filter((m) => m.startsWith("PAGES-VS-FACTS") && m.includes(`${s.slug}.html`));
  expect(hits.length >= 2, `사실 파일의 ${code} 판매 중앙값을 바꿨는데 PAGES-VS-FACTS 가 세트 페이지(${s.slug}.html)에서 잡지 않았다`);
  const other = [...lib.errors, ...lib.warnings].filter((m) => m.startsWith("PAGES-VS-FACTS/KF1") && !m.includes(`${s.slug}`) && / Key facts sold:/.test(m));
  expect(other.length === 0, `바꾸지 않은 세트의 Key facts sold 가 어긋났다: ${other[0]}`);
}

if (fails.length) { console.log(JSON.stringify({ test: "FAIL", fails }, null, 2)); process.exit(1); }
console.log(JSON.stringify({ test: "OK", targets: fsrc.targets().length, mutatedSet: code }));
