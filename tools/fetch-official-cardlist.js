#!/usr/bin/env node
"use strict";
// 반다이 공식 카드리스트(일본판·영문판) → data/official-cardlist.json — 2026-10-14 신설(W7).
//
// 왜: "op 17 set list" 같은 질의의 AI 인용 점유가 3.8% 였다. 경쟁 상위 10곳이 전부 세트 전체 카드리스트 페이지인데
//     우리 세트 페이지에는 Top 10 만 있었다. 세트별 카드리스트 페이지(tools/generate-card-list-pages.js)의 유일한 원천이 이 파일이다.
//
// 무엇을 담나(사실 열만 — 소유자 결정 2026-10-14):
//   카드 ID·번호·희귀도·종류·이름·코스트(리더는 라이프)·속성·파워·카운터·색·특징·트리거 유무, 상품별 수록 ID 목록(공식 표시 순서).
//   효과 텍스트와 카드 이미지는 저장하지 않는다(공식 사이트 무단 전재 금지 문구). 파서가 그 칸을 아예 읽지 않는다.
//
// 어떻게:
//   · 언어별 /cardlist/ 한 번 → 상품 선택 상자(select#series)에서 부스터 상품(OP·EB·PRB, 영문판 OP14-EB04 꼴 포함)만 고른다.
//     그래서 OP-18·EB-05 처럼 새 상품이 공식 목록에 올라오는 날 자동으로 수집되고, 그날 페이지가 생긴다.
//   · 상품마다 /cardlist/?series=<id> 한 번. 요청 사이 2초, User-Agent 는 사이트 이름과 주소를 그대로 밝힌다.
//   · 상품 하나가 실패하거나(네트워크·0장·필드 누락·직전보다 절반 미만) 이상하면 그 상품은 직전 값을 그대로 둔다.
//     목록 페이지부터 실패하면 파일을 건드리지 않는다. 어떤 실패도 exit 0 — 일일 수집 전체를 막지 않는다(직전 파일이 그대로 배포된다).
//   · 결정적 출력: 같은 응답이면 같은 파일. 상품 키·카드 ID 정렬, 카드 한 줄 하나(커밋 diff 가 바뀐 카드만 보이게).
//     checked = 그 상품을 마지막으로 성공적으로 받은 날, changed = 그 상품의 내용(ID 목록·카드 필드)이 마지막으로 바뀐 날.
//
// Run: node tools/fetch-official-cardlist.js
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "data", "official-cardlist.json");
const HOSTS = { jp: "https://www.onepiece-cardgame.com", en: "https://en.onepiece-cardgame.com" };
const UA = "Mozilla/5.0 (compatible; OPBoxIndex/1.0; +https://opboxindex.com/)";
const GAP_MS = 2000;
const TIMEOUT_MS = 60000;
// 카드 한 장에 저장하는 필드(이 순서로 쓴다). 가드 CL1 이 이 목록 밖의 키(효과 텍스트 등)를 막는다.
const FIELDS = ["num", "rarity", "type", "name", "costKind", "cost", "attribute", "power", "counter", "color", "feature", "trigger"];

// 상품 선택 상자의 이름 끝 코드 — 일본판 【OP-17】, 영문판 [OP-17] / [OP14-EB04]. 스타트덱(ST)·프로모는 제외.
const CODE_RE = /[【[]((?:OP|EB|PRB)-\d{2}|OP\d{2}-EB\d{2})[】\]]\s*$/;

// ── HTML 조각 → 글자
const NAMED = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
function decode(s) {
  return String(s || "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const cp = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}
const text = (html) => decode(String(html || "").replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
// 상품 이름은 option 안에 이스케이프된 <br> 이 들어 있다 — 한 번 풀고 태그를 걷는다.
const optionText = (raw) => text(decode(raw));

// 목록 페이지 → [{ series, code, name }]
function parseSeries(html) {
  const sel = (String(html).match(/<select[^>]*name="series"[^>]*>([\s\S]*?)<\/select>/) || [])[1] || "";
  const out = [];
  for (const m of sel.matchAll(/<option value="(\d+)"[^>]*>([\s\S]*?)<\/option>/g)) {
    const label = optionText(m[2]);
    const c = label.match(CODE_RE);
    if (!c) continue;
    out.push({ series: m[1], code: c[1], name: label.replace(CODE_RE, "").trim() });
  }
  return out;
}

// 카드 블록 안의 <div class="X"><h3>라벨</h3>값</div> — [라벨, 값]
function field(block, cls) {
  const m = block.match(new RegExp(`<div class="${cls}">\\s*<h3>([\\s\\S]*?)</h3>([\\s\\S]*?)</div>`));
  return m ? [text(m[1]), text(m[2])] : [null, null];
}

// 상품 페이지 → 카드 배열(공식 표시 순서). 효과 텍스트(div.text)·이미지 주소는 읽지 않는다.
function parseCards(html) {
  const out = [];
  for (const m of String(html).matchAll(/<dl class="modalCol" id="([^"]+)">([\s\S]*?)<\/dl>/g)) {
    const id = m[1], b = m[2];
    const info = (b.match(/<div class="infoCol">([\s\S]*?)<\/div>/) || [])[1] || "";
    const spans = [...info.matchAll(/<span>([\s\S]*?)<\/span>/g)].map((x) => text(x[1]));
    const [costLabel, cost] = field(b, "cost");
    const att = b.match(/<div class="attribute">[\s\S]*?alt="([^"]*)"/);
    out.push({
      id,
      num: spans[0] || null,
      rarity: spans[1] || null,
      type: spans[2] || null,
      name: text((b.match(/<div class="cardName">([\s\S]*?)<\/div>/) || [])[1]) || null,
      // 리더의 첫 칸은 라이프다(JP ライフ · EN Life). 숫자는 같은 칸에 들어 있어 종류를 따로 적는다.
      costKind: costLabel == null ? null : /ライフ|life/i.test(costLabel) ? "life" : "cost",
      cost,
      attribute: att ? decode(att[1]) || null : null,
      power: field(b, "power")[1],
      counter: field(b, "counter")[1],
      color: field(b, "color")[1],
      feature: field(b, "feature")[1],
      trigger: /<div class="trigger">/.test(b),
    });
  }
  return out;
}

// 상품 결과 검사 — 빠진 필드가 있으면 그 상품은 이번 회차를 버린다(직전 값 유지).
// 속성은 이벤트·스테이지에 없다(공식 그대로 null). 나머지는 전부 있어야 한다.
function problemsOf(cards) {
  const bad = [];
  if (!cards.length) bad.push("0장");
  for (const c of cards) {
    for (const k of ["num", "rarity", "type", "name", "costKind", "cost", "power", "counter", "color", "feature"]) {
      if (c[k] == null || c[k] === "") { bad.push(`${c.id}.${k}`); break; }
    }
    if (c.type && /CHARACTER|LEADER/.test(c.type) && !c.attribute) bad.push(`${c.id}.attribute`);
  }
  return bad;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastAt = 0;
async function get(url) {
  const wait = lastAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    lastAt = Date.now();
  }
}

// 상품 내용 지문 — changed 날짜를 정하는 데만 쓴다.
const fingerprint = (ids, cards) => JSON.stringify(ids.map((id) => [id, ...FIELDS.map((k) => cards[id] && cards[id][k])]));
const naturalCode = (a, b) => a.localeCompare(b, "en", { numeric: true });

function loadPrev() {
  try { return JSON.parse(fs.readFileSync(OUT, "utf8")); } catch { return null; }
}

// 언어 하나 수집. 반환 { products, cards, log }. 실패한 상품은 prev 에서 그대로 옮긴다.
async function collect(lang, prev, today) {
  const host = HOSTS[lang];
  const prevLang = (prev && prev[lang]) || { products: {}, cards: {} };
  const log = { lang, listed: 0, fetched: 0, kept: [], failed: [] };
  let series;
  try {
    series = parseSeries(await get(`${host}/cardlist/`));
  } catch (e) {
    log.failed.push(`index: ${e.message}`);
    return { products: prevLang.products, cards: prevLang.cards, log, indexFailed: true };
  }
  if (!series.length) {
    log.failed.push("index: 상품 선택 상자를 못 읽었다");
    return { products: prevLang.products, cards: prevLang.cards, log, indexFailed: true };
  }
  log.listed = series.length;

  const products = {}, cards = {};
  const keepPrev = (code) => {
    const p = prevLang.products[code];
    if (!p) return;
    products[code] = p;
    for (const id of p.ids) if (prevLang.cards[id]) cards[id] = prevLang.cards[id];
    log.kept.push(code);
  };
  for (const s of series) {
    const url = `${host}/cardlist/?series=${s.series}`;
    let got;
    try {
      got = parseCards(await get(url));
    } catch (e) {
      log.failed.push(`${s.code}: ${e.message}`);
      keepPrev(s.code);
      continue;
    }
    const bad = problemsOf(got);
    const before = prevLang.products[s.code] ? prevLang.products[s.code].ids.length : 0;
    if (bad.length || (before && got.length < before * 0.5)) {
      log.failed.push(`${s.code}: ${bad.length ? bad.slice(0, 3).join(", ") : `${got.length}장 < 직전 ${before}장의 절반`}`);
      keepPrev(s.code);
      continue;
    }
    const ids = got.map((c) => c.id);
    const mine = {};
    for (const c of got) mine[c.id] = Object.fromEntries(FIELDS.map((k) => [k, c[k] ?? null]));
    const old = prevLang.products[s.code];
    const same = old && fingerprint(old.ids, prevLang.cards) === fingerprint(ids, mine);
    products[s.code] = { series: s.series, name: s.name, url, checked: today, changed: same ? old.changed : today, ids };
    Object.assign(cards, mine);
    log.fetched++;
  }
  // 이번 목록에서 사라진 상품은 지우지 않는다(공식 목록 정리 중일 수 있다) — 직전 값을 남긴다.
  for (const code of Object.keys(prevLang.products)) if (!products[code]) keepPrev(code);
  return { products, cards, log };
}

// 카드 한 줄 하나로 쓴다 — 결정적이고 diff 가 짧다.
function serialize(doc) {
  const lines = ["{"];
  lines.push(`"note": ${JSON.stringify(doc.note)},`);
  lines.push(`"source": ${JSON.stringify(doc.source)},`);
  lines.push(`"fields": ${JSON.stringify(doc.fields)},`);
  for (const [li, lang] of ["jp", "en"].entries()) {
    const L = doc[lang];
    lines.push(`${JSON.stringify(lang)}: {`);
    const pk = Object.keys(L.products).sort(naturalCode);
    lines.push(`"products": {`);
    pk.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(L.products[k])}${i < pk.length - 1 ? "," : ""}`));
    lines.push(`},`);
    const ck = Object.keys(L.cards).sort();
    lines.push(`"cards": {`);
    ck.forEach((k, i) => lines.push(`${JSON.stringify(k)}: ${JSON.stringify(L.cards[k])}${i < ck.length - 1 ? "," : ""}`));
    lines.push(`}`);
    lines.push(`}${li === 0 ? "," : ""}`);
  }
  lines.push("}");
  return lines.join("\n") + "\n";
}

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const prev = loadPrev();
  const jp = await collect("jp", prev, today);
  const en = await collect("en", prev, today);
  const logs = [jp.log, en.log];
  if ((jp.indexFailed && en.indexFailed) || (!Object.keys(jp.products).length && !Object.keys(en.products).length)) {
    console.log(JSON.stringify({ status: "kept", reason: "공식 목록을 못 받았다 — 기존 파일 유지", logs }));
    return;
  }
  const doc = {
    note: "Facts from Bandai's official ONE PIECE CARD GAME card lists (Japanese and English sites), one entry per official card ID (parallels, SP and TR have their own IDs). Effect text and card images are deliberately not stored. products[code].ids keeps the official display order; checked = last successful fetch of that product, changed = last day its IDs or card fields changed. costKind 'life' marks a Leader's life value. Collected by tools/fetch-official-cardlist.js.",
    source: { jp: `${HOSTS.jp}/cardlist/`, en: `${HOSTS.en}/cardlist/` },
    fields: FIELDS,
    jp: { products: jp.products, cards: jp.cards },
    en: { products: en.products, cards: en.cards },
  };
  const out = serialize(doc);
  JSON.parse(out); // 쓰기 전에 형식 확인 — 깨진 파일은 배포하지 않는다
  const before = prev ? fs.readFileSync(OUT, "utf8") : "";
  if (out !== before) fs.writeFileSync(OUT, out, "utf8");
  const count = (L) => Object.fromEntries(Object.entries(L.products).map(([k, p]) => [k, p.ids.length]));
  console.log(JSON.stringify({ status: "ok", wrote: out !== before, jp: count(doc.jp), en: count(doc.en), logs }));
}

module.exports = { parseSeries, parseCards, problemsOf, decode, FIELDS, CODE_RE };
if (require.main === module) {
  main().catch((e) => {
    // 코드 결함은 드러나야 한다 — 단, 기존 파일은 그대로다(쓰기 전에 실패했다).
    console.error(JSON.stringify({ status: "error", error: String(e && e.stack || e) }));
    process.exit(1);
  });
}
