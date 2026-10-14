// 카드 번호 → 이름표 — data/card-names.json 을 굽는다. 2026-10-13 신설.
//
// 왜: 경매 카드 순위에 번호만 있고 이름이 없는 카드가 많았다. 카탈로그(onepiece-packs.json)는 세트당
//   10장(top10)만 담아 220건뿐인데, 경매 원장에는 번호가 2,000개 넘게 나온다. 사람이 보고 판단하려면
//   "OP05-119" 가 아니라 "Monkey D. Luffy" 가 보여야 한다.
//
// 우선순위: data/card-name-overrides.json(수동) > 반다이 공식 영문 카드리스트 이름(data/official-cardlist.json, 2026-10-14 W7)
//   > 카탈로그 name(변형 수식어를 벗긴 것) > 원장 제목에서 추정.
//   공식 이름은 표기 그대로 쓴다("Monkey.D.Luffy", "Edward.Newgate" — 반다이 영문판 표기). 조사 때 제목 추정 이름 289건이 공식과 달랐다
//   (예: OP17-052 "Marlon" → 공식 "Don Marlon", OP17-068 "Nami" → 공식 "Sasaki").
// 추정: 번호별 제목(data/auction-archive/ 전체)에서 노이즈(상품·언어·등급·희귀도·변형·세트명·호객 단어)를
//   걷어낸 뒤, 노이즈로 끊기지 않은 연속 1~4단어 구 가운데 "가장 긴 것 중 최다 제목에 나온 것"을 고른다
//   (최다 구의 절반 이상 나온 구만 후보). 4단어까지 보는 이유: 기술명 카드("Gum Gum Jet Gatling", "Mr. 2 Bon Kurei")가
//   3단어에서 잘렸다 — 카탈로그 167장과 대조해 164장 일치(2026-10-13).
//   표본(제목) 3개 미만이거나 최다 구가 제목의 1/4 에도 못 미치면 null — 빈 값이 틀린 값보다 낫다.
// 결정적: 같은 입력이면 같은 출력(시각 대신 원장 마지막 날짜를 updated 로 적는다).
//
// 산출: { note, updated, names: { "OP01-120": { name, source: "override"|"catalog"|"title"|null, samples } } }
//   (제목 수는 저장하지 않는다 — 정산마다 바뀌어 커밋만 늘린다)
// Run: node tools/build-card-names.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { listDays, readDay } = require("./auction-archive");
const { reclassify } = require("./auction-aggregate");

const CATALOG_FILE = path.join(ROOT, "data", "onepiece-packs.json");
const OVERRIDES_FILE = path.join(ROOT, "data", "card-name-overrides.json");
const OFFICIAL_FILE = path.join(ROOT, "data", "official-cardlist.json");
const outPath = path.join(ROOT, "data", "card-names.json");

const CARD_ID = /^[A-Z]{1,4}\d{2}-\d{3}$/;
const MIN_SAMPLES = 3;      // 제목이 이보다 적으면 추정하지 않는다
const MIN_SHARE = 0.25;     // 최다 구가 제목의 이 비율 미만이면 추정하지 않는다
const MAX_WORDS = 4;

// 제목에서 이름이 아닌 단어. 빈도표(2026-10-13, 7.5만 제목)에서 뽑았다 — 상품·언어·등급·상태·희귀도·변형·
// 카드 종류·호객·수량 단어. 캐릭터 이름에 쓰이는 단어(captain, big, mom, straw, hat, crew 등)는 넣지 않는다.
const NOISE_WORDS = `
one piece card cards game tcg ccg opcg optcg bandai namco trading anime film movie magazine vol
japanese english japan jp jpn jap en eng english chinese korean asia asian thai us usa
psa cgc bgs tag sgc beckett gem pristine graded grade grading slab slabbed pop cert
nm mint near lp mp hp played lightly moderately heavily condition cond pack fresh pulled pull unplayed sleeved toploader
sr sec r uc c l p tr sp rare secret super uncommon common leader character event stage don promo promos promotion
foil holo holographic parallel alt alternate alternative art artwork aa manga comic full illustration textured
gold silver red black blue green purple yellow stamped stamp signature signed wanted poster box topper treasure
special edition version ver reprint errata base regular extra ex standard
booster starter deck set collection premium anniversary release pre prerelease exclusive gift
flagship fest selection tournament championship winner prize campaign shop store event limited
offline online regionals regional netflix season ep episode
new sealed free shipping ship ships shipped fast lot bundle playset x set
best hot rare hard find chase hit hits grail top value investment ready worthy candidate potential
nice beautiful stunning amazing perfect clean centered centering sharp
see pics pictures photos pic read description please only with and the of for in from to a an at by or on
seller tracked day days same next hours mail pwe auction reserve bid bids start cheap wow look sale price
cost power counter blocker trigger rush
op eb st prb mt vg
s b m o i v q
`.split(/\s+/).filter(Boolean);

// 세트명 단어 — 세트명은 구 단위로 먼저 지우지만 제목이 세트명을 조각내 쓰는 일이 흔해 단어도 막는다.
// 카드 이름에 쓰일 수 있는 단어(two, war, time, battle, world, era, new, master, seven, captain, divine, fist)는 뺐다.
const SET_WORDS = `
romance dawn paramount pillars strength kingdoms intrigue awakening wings legends emperors royal blood
speed legacy carrying azure seas heroines adventure kamis island strongest warriors worlds memorial years future
`.split(/\s+/).filter(Boolean);
// 호칭은 이름의 일부다: "Mr. 3 (Galdino)" → Mr. 3 Galdino.
const HONORIFIC = { mr: "Mr.", ms: "Ms.", jr: "Jr.", d: "D." };

const NOISE = new Set([...NOISE_WORDS, ...SET_WORDS]);

function loadJson(file) { return JSON.parse(fs.readFileSync(file, "utf8")); }

// 제목 정규화: 소문자, 아포스트로피 제거(world's→worlds), 나머지 기호는 공백.
function norm(s) {
  return String(s || "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

// 세트명 구(packs.json nameEn)와 흔한 변형(앞의 the/a 뺀 것)을 제목에서 지운다.
function setPhrases(catalog) {
  const out = new Set();
  for (const s of Object.values(catalog.sets || {})) {
    const n = norm(s.nameEn);
    if (!n) continue;
    out.add(n);
    out.add(n.replace(/^(the|a) /, ""));
  }
  return [...out].filter(Boolean).sort((a, b) => b.length - a.length);
}

// 카탈로그 이름에서 변형 수식어·번호를 벗긴다: "Monkey D. Luffy 003 Parallel" → "Monkey D. Luffy".
function cleanCatalogName(name) {
  let s = String(name || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b[A-Z]{1,4}\d{2}[-\s]?\d{3}\b/g, " ")
    .replace(/\b\d{3}\b/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b(parallel|alternate|alt|art|manga|super|red|sp|gold|silver|stamped|signature|wanted|poster|box|topper|tr|treasure|rare)\b/gi, " ")
    .replace(/\s+/g, " ").trim();
  return s || null;
}

function titleCase(tokens) {
  return tokens.map((t) => HONORIFIC[t] || t.charAt(0).toUpperCase() + t.slice(1)).join(" ");
}

// 제목 묶음에서 이름 구를 고른다. 반환 { name, df } 또는 null.
function guessName(titles, phrases) {
  if (titles.length < MIN_SAMPLES) return null;
  const df = new Map();   // 구 → 그 구가 나온 제목 수
  for (const raw of titles) {
    let t = " " + norm(raw) + " ";
    for (const p of phrases) t = t.split(" " + p + " ").join(" ");
    t = t.replace(/\b[a-z]{1,4}\d{2} ?\d{3}\b/g, " ");          // 카드 번호(op01-120 / op01 120)
    const tokens = t.split(" ").map((w) => (NOISE.has(w) || !(/^[a-z]+$/.test(w) || /^\d$/.test(w)) ? null : w));
    const seen = new Set();
    for (let i = 0; i < tokens.length; i++) {
      if (!tokens[i] || /^\d$/.test(tokens[i])) continue;          // 숫자로 시작하는 구는 이름이 아니다("5 Luffy")
      for (let len = 1; len <= MAX_WORDS && i + len <= tokens.length; len++) {
        if (!tokens[i + len - 1]) break;                           // 노이즈로 끊긴 구는 만들지 않는다
        seen.add(tokens.slice(i, i + len).join(" "));
      }
    }
    for (const g of seen) df.set(g, (df.get(g) || 0) + 1);
  }
  if (!df.size) return null;
  // 기준 단어 = 가장 많은 제목에 나온 한 단어(동률이면 전부). 이름 구는 기준 단어 하나를 품고
  // 기준의 절반 이상 나온 것 중 가장 긴 것. "품는다" 조건이 없으면 소수파 두 단어 구가 다수파 한 단어를
  // 이긴다(OP10-105: Cavendish 13 vs Jewelry Bonney 7). 동률을 전부 보는 이유: "Color of the Supreme King Haki" 처럼
  // 노이즈(of/the)로 끊긴 이름은 color·supreme·king·haki 가 같은 수라, 하나만 잡으면 "Color" 에서 끝난다.
  const ones = [...df.entries()].filter(([g]) => !g.includes(" "));
  const maxDf = Math.max(...ones.map(([, c]) => c));
  if (maxDf < Math.max(MIN_SAMPLES, Math.ceil(titles.length * MIN_SHARE))) return null;
  const tops = new Set(ones.filter(([, c]) => c === maxDf).map(([g]) => g));
  const best = [...df.entries()]
    .filter(([g, c]) => c >= maxDf * 0.5 && g.split(" ").some((w) => tops.has(w)))
    .map(([g, c]) => ({ g, c, len: g.split(" ").length }))
    .sort((a, b) => b.len - a.len || b.c - a.c || a.g.localeCompare(b.g))[0];
  return { name: titleCase(best.g.split(" ")), df: best.c };
}

function main() {
  const catalog = loadJson(CATALOG_FILE);
  const overrides = loadJson(OVERRIDES_FILE).names || {};
  // 공식 영문 이름 — 번호 단위(같은 번호는 같은 카드라 패러렐·SP 도 같은 이름). 파일이 없으면 이 단계만 건너뛴다.
  const officialNames = {};
  try {
    for (const c of Object.values(loadJson(OFFICIAL_FILE).en.cards || {})) {
      const id = String((c && c.num) || "").toUpperCase();
      if (CARD_ID.test(id) && c.name && !officialNames[id]) officialNames[id] = String(c.name);
    }
  } catch { /* 공식 목록 없음 — 종전 순위 그대로 */ }
  const phrases = setPhrases(catalog);

  // 카탈로그: 번호별 첫 세트(packs.json 순서)의 이름.
  const catalogNames = {};
  for (const s of Object.values(catalog.sets || {})) {
    for (const c of s.cards || []) {
      const id = String(c.number || "").toUpperCase();
      if (!CARD_ID.test(id) || catalogNames[id]) continue;
      const name = cleanCatalogName(c.name);
      if (name) catalogNames[id] = name;
    }
  }

  // 원장 전체(모든 날)의 카드 제목을 번호별로 모은다. 다수량 로트(qty>1)는 여러 카드 이름이 섞이므로
  // 단품 제목이 3개 이상이면 단품만 쓴다.
  const days = listDays();
  const titles = {};
  for (const d of days) {
    for (const r of reclassify(readDay(d))) {
      if (!r || r.kind !== "card" || !r.cardId || !r.title) continue;
      const id = String(r.cardId).toUpperCase();
      if (!CARD_ID.test(id)) continue;
      (titles[id] = titles[id] || []).push({ title: r.title, multi: Number.isFinite(r.qty) && r.qty > 1 });
    }
  }

  const ids = [...new Set([...Object.keys(overrides), ...Object.keys(catalogNames), ...Object.keys(titles)])].sort();
  const names = {};
  const count = { override: 0, official: 0, catalog: 0, title: 0, none: 0 };
  for (const id of ids) {
    const all = titles[id] || [];
    const samples = all.length;
    let name = null, source = null;
    if (overrides[id]) { name = String(overrides[id]); source = "override"; }
    else if (officialNames[id]) { name = officialNames[id]; source = "official"; }
    else if (catalogNames[id]) { name = catalogNames[id]; source = "catalog"; }
    else {
      const single = all.filter((t) => !t.multi);
      const g = guessName((single.length >= MIN_SAMPLES ? single : all).map((t) => t.title), phrases);
      if (g) { name = g.name; source = "title"; }
    }
    count[source || "none"]++;
    names[id] = { name, source };   // samples(제목 수)는 정산 회차마다 바뀌어 파일을 매번 다시 커밋하게 만들어 뺐다(2026-10-13)
  }

  const out = {
    note: "Card number → display name for One Piece Card Game singles. source: override (data/card-name-overrides.json) > official (Bandai English card list name, data/official-cardlist.json) > catalog (data/onepiece-packs.json top-10 lists, variant words stripped) > title (most frequent 1–3 word phrase in eBay auction titles from data/auction-archive/, noise words removed, at least 3 titles). name is null where no source resolves it. Deterministic: same inputs → same file.",
    updated: days.length ? days[days.length - 1] : null,
    archiveDays: days.length,
    counts: count,
    names,
  };
  fs.writeFileSync(outPath, JSON.stringify(out) + "\n", "utf8");
  console.log(JSON.stringify({ ids: ids.length, ...count, updated: out.updated }));
}

module.exports = { main, guessName, cleanCatalogName };
if (require.main === module) main();
