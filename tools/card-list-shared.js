"use strict";
// 세트별 공식 카드리스트 — 여러 생성기가 함께 쓰는 읽기 전용 모델. 2026-10-14 신설(W7).
//
// 원천은 data/official-cardlist.json 하나다(tools/fetch-official-cardlist.js 가 매일 받는다).
// 카드리스트 페이지 생성기, 세트·허브·발매일 글·예정 세트 페이지·한국어 세트 페이지의 링크, llms·무료 데이터가
// 모두 여기서 "어느 세트에 카드리스트가 있나 / 몇 장인가" 를 읽는다 — 각자 세면 한쪽만 어긋난다.
// 링크는 파일 존재가 아니라 이 데이터로 정한다: 공식 목록이 뜬 날(OP-18·EB-05) 생성 순서와 상관없이 같은 회차에 링크가 걸린다.
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const FILE = path.join(ROOT, "data", "official-cardlist.json");

let DOC = null;
function doc() {
  if (DOC) return DOC;
  try { DOC = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch { DOC = { jp: { products: {}, cards: {} }, en: { products: {}, cards: {} } }; }
  return DOC;
}

const slugOf = (code) => String(code).toLowerCase();
const SITE = "https://opboxindex.com";
const pagePath = (code) => `sets/${slugOf(code)}-card-list.html`;
const koPath = (code) => `ko/${slugOf(code)}-card-list.html`;
const csvPath = (code) => `sets/${slugOf(code)}-card-list.csv`;
const jsonPath = (code) => `sets/${slugOf(code)}-card-list.json`;
const naturalCode = (a, b) => {
  const fam = (c) => ({ OP: 0, EB: 1, PRB: 2 }[String(c).split("-")[0]] ?? 9);
  return fam(a) - fam(b) || a.localeCompare(b, "en", { numeric: true });
};

// 카드 한 장의 인쇄 구분 — 공식 ID 접미어와 공식 희귀도에서만 정한다(우리 해석 없음).
//   sp: 희귀도 SPカード / SP CARD · tr: 희귀도 TR · base: 접미어 없음 · parallel: _pN · reprint: _rN(프리미엄 부스터의 재수록 ID)
function kindOf(id, card) {
  const r = String((card && card.rarity) || "");
  if (/^SP/i.test(r)) return "sp";
  if (r === "TR") return "tr";
  if (card && id === card.num) return "base";
  if (/_r\d+$/.test(id)) return "reprint";
  if (/_p\d+$/.test(id)) return "parallel";
  return "other";
}

// 상품의 요약 숫자 — 페이지 머리 라벨·llms·무료 데이터가 같은 값을 쓴다.
// leaders = 기본 인쇄(접미어 없음) 리더 수. 반다이 상품 페이지의 "リーダー N種" 와 같은 기준이다
// (재수록 패러렐까지 세면 EB-02 가 1 이 아니라 27 이 된다).
function countsOf(product, cards) {
  const c = { cards: product.ids.length, numbers: 0, base: 0, parallel: 0, reprint: 0, sp: 0, tr: 0, other: 0, leaders: 0 };
  const nums = new Set();
  for (const id of product.ids) {
    const card = cards[id] || {};
    nums.add(card.num);
    const k = kindOf(id, card);
    if (k === "base" && card.type === "LEADER") c.leaders++;
    c[k]++;
  }
  c.numbers = nums.size;
  return c;
}

// 일본판 상품 = 우리 세트 코드(OP-17 …). 페이지는 일본판 공식 목록 기준이다.
function products() {
  const d = doc();
  return Object.entries((d.jp && d.jp.products) || {})
    .filter(([code]) => /^(OP|EB|PRB)-\d{2}$/.test(code))
    .sort(([a], [b]) => naturalCode(a, b))
    .map(([code, p]) => ({ code, slug: slugOf(code), ...p, counts: countsOf(p, d.jp.cards || {}) }));
}
const has = (code) => products().some((p) => p.code === code);
const productOf = (code) => products().find((p) => p.code === code) || null;

// 일본판 세트 코드에 대응하는 영문판 상품(이름 출처 링크용). 영문판은 OP-14·OP-15 와 EB-04 를 OP14-EB04·OP15-EB04 로 묶어 낸다.
function enProductsFor(code) {
  const d = doc();
  const compact = String(code).replace("-", "");
  return Object.entries((d.en && d.en.products) || {})
    .filter(([k]) => k === code || k.split("-").includes(compact))
    .sort(([a], [b]) => naturalCode(a, b))
    .map(([k, p]) => ({ code: k, ...p }));
}

// 세트 영문 이름 — 추적 세트(onepiece-packs.json) → 예정 세트(upcoming-set-pages.json 제목의 코드 뒤 이름) →
// 공식 상품명에서 상품 종류 말을 뗀 라틴 문자 이름(EB-04 "EGGHEAD CRISIS"). 일본어만 남으면 "" (페이지는 코드만 쓴다).
let NAMES = null;
function nameEnOf(code) {
  if (!NAMES) {
    const read = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
    NAMES = { packs: (read("data/onepiece-packs.json") || {}).sets || {}, upcoming: (read("data/upcoming-set-pages.json") || {}).pages || [] };
  }
  const s = NAMES.packs[code];
  // PRB-01·PRB-02 는 추적 데이터 이름이 둘 다 "Premium Booster" 라 AI 공급(llms·ai-data)·카드리스트에서 구분이 안 됐다(2026-10-14 QA).
  // 공식 상품명(ONE PIECE CARD THE BEST [vol.N])에서 부제를 붙인다 — 표기는 공식 그대로(vol 소문자).
  if (s && s.nameEn === "Premium Booster") {
    const off = String((((doc().jp || {}).products || {})[code] || {}).name || "");
    const m = off.match(/THE BEST(?:\s+(vol\.\d+))?/i);
    if (m) return `Premium Booster — The Best${m[1] ? ` ${m[1].toLowerCase()}` : ""}`;
  }
  if (s && s.nameEn) return s.nameEn;
  const up = NAMES.upcoming.find((p) => p.code === code);
  if (up && String(up.title || "").startsWith(code + " ")) {
    const n = up.title.slice(code.length + 1).split(/\s+(?:\(|—)/)[0].trim();
    if (n) return n;
  }
  const p = ((doc().jp || {}).products || {})[code];
  const n = String((p && p.name) || "").replace(/^(ブースターパック|エクストラブースター|プレミアムブースター)\s*/, "").trim();
  return /^[\x20-\x7e’]+$/.test(n) ? n : "";
}

// 표 행 순서 — 그 세트 번호(OP-17 → "OP17-")가 먼저, 다른 세트 번호는 뒤(각각 공식 목록 순서). 생성기·가드가 같이 쓴다.
function orderIds(code, ids) {
  const own = String(code).replace("-", "") + "-";
  return [...ids.filter((id) => id.startsWith(own)), ...ids.filter((id) => !id.startsWith(own))];
}

// ── 레어도 — 2026-10-15: 세트 Top 카드의 레어도는 사실 빌더(tools/build-site-facts.js)가 아래 rarityCode 로 한 번 정해 사실 파일
//    (data/derived/site-facts.json sets[code].cards[i].rarity · rarityEn)에 둔다. 세트(영문·한국어)·PSA 10 랭킹·AI 피드는 그 값을 읽는다.
//    카드리스트 페이지(공식 ID 전체)와 카드 상세는 공식 목록 행을 직접 읽으므로 여기 함수를 그대로 쓴다.
// 레어도 코드 — 공식 표기를 줄인 것 하나: SPカード / SP CARD → "SP", 나머지(L·C·UC·R·SR·SEC·TR·P)는 공식 그대로.
const rarityShow = (r) => (/^SP/i.test(String(r || "")) ? "SP" : String(r || ""));

// 세트 Top 카드(onepiece-packs.json 의 카드 한 변형)의 레어도 = 반다이 공식 카드 리스트의 그 인쇄 레어도 — 2026-10-15.
// 왜: 한국어 세트 페이지만 공식 레어도로 바꿔(1차) ST31-004 SP 인쇄가 ko/op-17 은 SP, sets/op-17·카드 상세·AI JSON 은 SR(Super Rare),
//     ST02-007 SP 인쇄는 한국어 SP · 영문 Common 이었다(72행). 세트(영문·한국어)·PSA 10 랭킹·카드 상세·카드리스트·AI 피드가 모두 이 함수를 쓴다.
//   1) 사람이 확인한 변형(_imgSuffix)이 가리키는 공식 ID(번호+접미어, "base" = 접미어 없는 기본 ID)의 레어도
//   2) 없으면 이 세트 상품(code) 안 같은 번호 인쇄들의 공식 레어도가 하나뿐일 때 그 값(OP-11 의 OP05-119 SP 금·은 = _p6·_p7 둘 다 SP)
//   3) 공식 목록에 그 번호 행이 없을 때만 원본(packs) 레어도(TR·DON!! 등). 공식 행이 있는데 갈리면 원본 값 — 지어내지 않는다.
function rarityCode(code, card) {
  if (!card) return "";
  const J = doc().jp || {};
  const cards = J.cards || {};
  const suf = card._imgSuffix === "base" ? "" : card._imgSuffix;
  const byId = typeof suf === "string" && card.number ? cards[card.number + suf] : null;
  if (byId && byId.rarity) return rarityShow(byId.rarity);
  const ids = (((J.products || {})[code] || {}).ids || []).filter((id) => (cards[id] || {}).num === card.number);
  const rs = new Set(ids.map((id) => rarityShow(cards[id].rarity)));
  return rs.size === 1 ? [...rs][0] : rarityShow(card.rarity);
}
// 영문 페이지 표기 — 같은 코드의 낱말(반다이 영문 표기: SP CARD → "SP Card"). 사전에 없는 코드(DON!!)는 코드 그대로.
// TR → "Treasure Rare" — 2026-10-15(4차): 사전에 없어 추적 문단이 "Monkey D. Luffy TR (TR)" 로 나갔다.
const RARITY_EN = { L: "Leader", SEC: "Secret Rare", SR: "Super Rare", R: "Rare", UC: "Uncommon", C: "Common", SP: "SP Card", TR: "Treasure Rare", P: "Promo" };
const rarityEn = (r) => RARITY_EN[r] || r || "";

module.exports = { orderIds, FILE, SITE, doc, products, has, productOf, enProductsFor, countsOf, kindOf, nameEnOf, slugOf, pagePath, koPath, csvPath, jsonPath, naturalCode, rarityShow, rarityCode, RARITY_EN, rarityEn };
