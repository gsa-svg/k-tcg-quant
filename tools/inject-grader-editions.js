#!/usr/bin/env node
// CGC·TAG 등급 수를 판별로 세트 데이터에 주입 — 2026-07-27.
//
// PSA 판별표와 같은 이야기를 다른 등급사로도 보여준다. 세 곳 다 일본판/영문판을 따로
// 집계하므로 합산하지 않고 나란히 싣는다.
//
// 등급사마다 공개 수준이 달라 그대로 반영한다(없는 값을 만들지 않는다):
//  - TAG: 총량 + 최고등급(10·10P) 수 → 비율 계산 가능
//  - CGC: 세트 단위는 총량만 공개 → 비율 없음
// 변동 구간도 등급사마다 관측일이 달라 from/to 를 각각 기록한다(PSA 는 수요일 주간,
// CGC·TAG 는 우리가 수집한 날짜). "주간"이라고 뭉개지 않는다.
// Run: node tools/inject-grader-editions.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const SRC = [
  ["tag", "tag-grading-history.json", true],
  ["cgc", "cgc-grading-history.json", false],
];

const loaded = {};
for (const [key, file, hasGem] of SRC) {
  const p = path.join(ROOT, "data", file);
  if (!fs.existsSync(p)) { console.log(`skip ${key}: ${file} 없음`); continue; }
  loaded[key] = { store: JSON.parse(fs.readFileSync(p, "utf8")), hasGem };
}

let touched = 0;
for (const [code, set] of Object.entries(data.sets)) {
  const out = {};
  for (const [key, { store, hasGem }] of Object.entries(loaded)) {
    const s = store.sets?.[code];
    if (!s) continue;
    const side = {};
    // ⚠️ 변동 구간(from/to)은 반드시 판별로 따로 둔다. 예전엔 블록 하나에 공유했는데,
    //    일본판과 영문판의 관측일이 다르면(실제로 다르다) 나중에 처리되는 영문판 날짜가
    //    일본판 라벨까지 덮어써서 "+86 (7/27→7/28)" 처럼 5일치 증가를 하루치로 표기했다.
    //    2026-07-29 발견·수정.
    for (const ed of ["jp", "en"]) {
      const arr = (s[ed] || []).slice().sort((a, b) => a.d.localeCompare(b.d));
      const last = arr.at(-1);
      if (!last || !Number.isInteger(last.total) || last.total <= 0) continue;
      const prev = arr.length > 1 ? arr.at(-2) : null;
      const e = { total: last.total };
      if (hasGem && Number.isInteger(last.gem) && last.gem <= last.total) {
        e.gem = last.gem;
        e.gemRate = Math.round((last.gem / last.total) * 1000) / 10;
      }
      // TAG 도 만점이 둘이다 — 10 과 10P(퍼펙트)를 따로 매긴다. 합쳐 놓으면 CGC 의
      // Gem Mint/Pristine 구분과 나란히 못 놓는다. 있는 점만 싣는다.
      if (Number.isInteger(last.g10)) e.g10 = last.g10;
      if (Number.isInteger(last.g10p)) e.g10p = last.g10p;
      // CGC 는 만점을 둘로 나눈다 — 뭉치지 않고 각각 싣는다. 열 이름은 CGC 표기 그대로.
      if (last.grades) {
        if (Number.isInteger(last.grades["Pristine 10"])) e.pristine10 = last.grades["Pristine 10"];
        if (Number.isInteger(last.grades["Gem Mint 10"])) e.gemMint10 = last.grades["Gem Mint 10"];
        if (Number.isInteger(last.grades["Perfect 10"])) e.perfect10 = last.grades["Perfect 10"];
      }
      // 누적이 줄어든 관측(재집계·재등급 등)은 증감을 만들지 않는다 — 음수 증감은 표시하지 않고 비운다.
      if (prev && last.total >= prev.total) { e.add = last.total - prev.total; e.from = prev.d; e.to = last.d; }
      side[ed] = e;
    }
    if (!Object.keys(side).length) continue;
    out[key] = side;
  }
  if (Object.keys(out).length) { set.graders = out; touched += 1; } else delete set.graders;
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", sets: touched, graders: Object.keys(loaded) }));
