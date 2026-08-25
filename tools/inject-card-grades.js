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
//     psa: { jp:{total,g10,g9,d}, en:{...} },     // PSA·CGC·TAG 전부 판별로 나뉜다(합산 금지)
//   }
// PSA 는 GemRate 공개 세트 페이지에 카드·변형별로 있고 일본판/영문판이 따로다(2026-08-03 확인).
// 합산하지 않고 판별로 각각 싣는다. CGC·TAG 는 우리 수집이 일본판 기준이라 판 구분 없이 한 줄이다.
// Run: node tools/inject-card-grades.js
const fs = require("node:fs");
const path = require("node:path");
const { ourTier } = require("./cgc-card-pop-ingest.js");
const { donRef } = require("./psa-card-pop-ingest.js");

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
const psa = load("psa-card-pop.json");

// PSA 원장 적재와 **같은 규칙**으로 찾는다: 담고 있는 박스 목록에서만 본다.
// 각인 세트로 폴백하지 않는다 — 재수록본과 원본은 다른 상품이고 인구도 다르다
// (PRB-01 Shanks Manga 81장 vs OP-01 원본 4,863장 — 60배). 박스에 없으면 비워 둔다.
const psaPoint = (card, key, boxCode) => {
  if (!boxCode) return {};
  const out = {};
  for (const ed of ["jp", "en"]) {
    const arr = psa?.sets?.[boxCode]?.[ed]?.[key];
    const last = Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
    if (last && Number.isInteger(last.total) && last.total > 0 && Number.isInteger(last.g10) && last.g10 <= last.total) {
      out[ed] = { total: last.total, g10: last.g10, g9: Number.isInteger(last.g9) ? last.g9 : null, d: last.d };
    }
  }
  return out;
};

// 마지막 관측점만 쓴다(시계열은 원장에 그대로 남는다).
const lastPoint = (store, code, key) => {
  const arr = store?.sets?.[code]?.[key];
  return Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null;
};

const int = (v) => (Number.isInteger(v) && v >= 0 ? v : null);

let cards = 0, withCgc = 0, withTag = 0, withPsa = 0, cleared = 0;
for (const [code, set] of Object.entries(data.sets)) {
  for (const card of set.cards || []) {
    cards += 1;
    const num = (card.number || "").toUpperCase();
    const don = donRef(card.name);
    if (!num && !don) { if (card.graderPop) { delete card.graderPop; cleared += 1; } continue; }
    const key = don ? don.key : `${num}|${ourTier(card.name || "")}`;

    const out = {};
    // CGC 원장은 2026-08-03 부터 판별로 나뉜다(sets[코드][판][키]). 그 전 기록은 .jp 로 이관돼 있다.
    const cgcEd = {};
    for (const ed of ["jp", "en"]) {
      const c = lastPoint(cgc?.sets?.[code]?.[ed] ? { sets: { [code]: cgc.sets[code][ed] } } : null, code, key);
      if (!c || !int(c.total)) continue;
      const pristine = int(c.g?.["Pristine 10"]) ?? 0;
      const gemMint = int(c.g?.["Gem Mint 10"]) ?? 0;
      // 만점이 총량을 넘으면 매칭이 어긋난 것이다 — 그런 값은 싣지 않는다.
      if (pristine + gemMint <= c.total) cgcEd[ed] = { total: c.total, pristine10: pristine, gemMint10: gemMint, d: c.d };
    }
    if (Object.keys(cgcEd).length) { out.cgc = cgcEd; withCgc += 1; }
    // TAG 원장도 2026-08-25 부터 판별로 나뉜다(sets[코드][판][키]). 그 전 기록은 .jp 로 이관돼 있다.
    // 판을 합치지 않는다 — 일본판과 영문판은 인쇄가 다르고 합친 비율은 어느 쪽도 설명하지 못한다.
    const tagEd = {};
    for (const ed of ["jp", "en"]) {
      const g = lastPoint(tag?.sets?.[code]?.[ed] ? { sets: { [code]: tag.sets[code][ed] } } : null, code, key);
      if (!g || !int(g.total)) continue;
      const g10 = int(g.g?.["10"]) ?? 0;
      const g10p = int(g.g?.["10P"]) ?? 0;
      // 만점이 총량을 넘으면 매칭이 어긋난 것이다 — 그런 값은 싣지 않는다.
      if (g10 + g10p <= g.total) tagEd[ed] = { total: g.total, g10, g10p, d: g.d };
    }
    if (Object.keys(tagEd).length) { out.tag = tagEd; withTag += 1; }

    const p = psaPoint(card, key, code);   // code = 담고 있는 박스
    if (Object.keys(p).length) { out.psa = p; withPsa += 1; }

    if (Object.keys(out).length) card.graderPop = out;
    else if (card.graderPop) { delete card.graderPop; cleared += 1; }
  }
}

fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
console.log(JSON.stringify({ status: "ok", cards, withCgc, withTag, withPsa, cleared }));
