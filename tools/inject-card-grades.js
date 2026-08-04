#!/usr/bin/env node
// 카드별 CGC·TAG 등급분포를 카드 데이터에 주입 — 2026-08-03.
//
// 왜: TOP10 카드를 누르면 뜨는 확대창이 `japaneseNmEbay`(일본판 NM eBay 실거래) 하나만 보는데
// 그 값은 매칭이 0건이라 **모든 카드에서 늘 비어 있었다**("표본이 아직 없습니다"만 뜨는 죽은 패널).
// 우리는 이미 카드별 CGC·TAG 등급분포를 주간으로 쌓고 있으므로 그걸 붙여 창을 채운다.
//
// 매칭 규칙은 새로 만들지 않고 적재기의 것을 그대로 쓴다 — 번호+변형(tier) 이중매칭.
// 변형을 번호만으로 맞추면 패러렐/망가/SP 가 뒤섞인다(반복된 사고, 가드 Q4 가 검증).
//
// 붙이는 값(있는 것만, 없으면 항목 자체를 만들지 않는다 — 빈 값이 틀린 값보다 낫다):
//   card.graderPop = {
//     cgc: { total, pristine10, gemMint10, d },   // d = 그 관측일
//     tag: { total, g10, g10p, d },
//   }
// PSA 는 카드별 인구를 우리가 갖고 있지 않다(GemRate 수집은 세트 단위). 그래서 넣지 않는다.
// Run: node tools/inject-card-grades.js
const fs = require("node:fs");
const path = require("node:path");
const { ourTier } = require("./cgc-card-pop-ingest.js");

const ROOT = path.resolve(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));

const load = (f) => {
  const p = path.join(ROOT, "data", f);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
};
const cgc = load("cgc-card-pop.json");
const tag = load("tag-card-pop.json");

// 마지막 관측점만 쓴다(시계열은 원장에 그대로 남는다).
const lastPoint = (store, code, key) => {
  const arr = store?.sets?.[code]?.[key];
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
};

const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

let cards = 0, withCgc = 0, withTag = 0, cleared = 0;
for (const [code, set] of Object.entries(data.sets)) {
  for (const card of set.cards || []) {
    cards += 1;
    const num = (card.number || "").toUpperCase();
    if (!num) { if (card.graderPop) { delete card.graderPop; cleared += 1; } continue; }
    const key = `${num}|${ourTier(card.name || "")}`;

    const out = {};
    const c = lastPoint(cgc, code, key);
    if (c && int(c.total)) {
      const pristine = int(c.g?.["Pristine 10"]) ?? 0;
      const gemMint = int(c.g?.["Gem Mint 10"]) ?? 0;
      // 만점이 총량을 넘으면 매칭이 어긋난 것이다 — 그런 값은 싣지 않는다.
      if (pristine + gemMint <= c.total) { out.cgc = { total: c.total, pristine10: pristine, gemMint10: gemMint, d: c.d }; withCgc += 1; }
    }
    const g = lastPoint(tag, code, key);
    if (g && int(g.total)) {
      const g10 = int(g.g?.["10"]) ?? 0;
      const g10p = int(g.g?.["10P"]) ?? 0;
      if (g10 + g10p <= g.total) { out.tag = { total: g.total, g10, g10p, d: g.d }; withTag += 1; }
    }

    if (Object.keys(out).length) card.graderPop = out;
    else if (card.graderPop) { delete card.graderPop; cleared += 1; }
  }
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", cards, withCgc, withTag, cleared }));
