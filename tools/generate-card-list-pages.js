#!/usr/bin/env node
"use strict";
// 세트별 공식 카드리스트 페이지 — sets/<code>-card-list.html + ko/<code>-card-list.html + 같은 이름의 .csv·.json. 2026-10-14 신설(W7).
//
// 왜: "op 17 set list" 질의는 경쟁 상위 10곳이 전부 세트 전체 카드리스트 페이지였고, 우리 OP-17 페이지는 Top 10 표뿐이라
//     AI 인용 점유가 3.8% 였다. 공식 목록(data/official-cardlist.json)의 사실 열과, 확정 규칙으로 맞춘 우리 숫자만 싣는다.
//
// 원칙
//  · 사실 열만: 번호·이름(영/일)·희귀도·종류·색·코스트(리더는 라이프)·파워. 효과 텍스트·카드 이미지는 쓰지 않는다(소유자 결정).
//  · 행 = 공식 일본판 목록의 카드 ID 하나(패러렐·SP·TR 도 각자 한 행). 가드 CL1 이 행 수 = 공식 수를 본다.
//  · 우리 숫자(NM·경매 낙찰 중앙값·PSA 10)는 공식 ID 에 확정 규칙으로 붙을 때만, 나머지는 "—":
//      base     기본 ID(접미어 없음)이고 그 번호에 프리미엄 부스터 재수록 ID(_r)가 없을 때 → 경매 키 번호|jp|base
//      sp / tr  그 번호의 공식 SP(또는 TR) ID 가 전 상품 통틀어 하나일 때 → 번호|jp|sp / tr
//      parallel 자기 번호 상품(OP17-… ↔ OP-17) 안의 패러렐이 그 ID 하나뿐일 때 → 번호|jp|alt
//      그 밖(망가·슈퍼·레드·금·은·수배서, 패러렐 2개 이상)은 세트 Top 10 의 사람 확인 이미지 접미어(_imgSuffix)가 그 ID 를 가리킬 때만.
//      같은 경매 키를 두 행이 가리키면 둘 다 비운다. 경매 의심 표식(suspect)·3건 미만도 비운다. 일본판 인쇄만(판별 합산 금지).
//  · 박스 값은 box-sold-series 의 current 하나(가드 D17 과 같은 값). 없으면 "—".
//  · 외부 시세 업체명은 쓰지 않는다. 출처 링크는 반다이 공식 카드리스트뿐이고 확인일을 같이 적는다.
// Run: node tools/generate-card-list-pages.js   (generate-card-pages.js 뒤 — cards/card-map.json 을 읽는다)
const fs = require("node:fs");
const path = require("node:path");
const { SITE, CSS_VER, esc, usd, pageHead, foot } = require("./set-page-shared");
const CL = require("./card-list-shared");
const { addUrls } = require("./sitemap-detail-urls");
const { ourTier } = require("./cgc-card-pop-ingest.js");
const { fxAt, nmUsd } = require("./market-data-normalizers");
const { navHtmlKo } = require("./site-nav");

const ROOT = path.join(__dirname, "..");
const readJson = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return fallback; } };
const packs = readJson("data/onepiece-packs.json", { sets: {} });
const SOLD = readJson("data/box-sold-series.json", { sets: {} });
const AUCTION = readJson("data/auction-card-stats.json", { variants: {} });
const CARD_MAP = readJson("cards/card-map.json", {});
const OFFICIAL = CL.doc();
const JP = OFFICIAL.jp || { products: {}, cards: {} };
const EN = OFFICIAL.en || { products: {}, cards: {} };
const DATA_DATE = packs.updated || new Date().toISOString().slice(0, 10);
const FX = packs.fx || {};
const AUCTION_DAY = String(AUCTION.updated || "").slice(0, 10);
const MIN_N = 3;

// ── 이름·라벨
const TYPE_EN = { LEADER: "Leader", CHARACTER: "Character", EVENT: "Event", STAGE: "Stage" };
const TYPE_KO = { LEADER: "리더", CHARACTER: "캐릭터", EVENT: "이벤트", STAGE: "스테이지" };
const COLOR_EN = { 赤: "Red", 緑: "Green", 青: "Blue", 紫: "Purple", 黒: "Black", 黄: "Yellow" };
const COLOR_KO = { Red: "빨강", Green: "초록", Blue: "파랑", Purple: "보라", Black: "검정", Yellow: "노랑" };
const KIND_EN = { base: "", parallel: "Parallel", reprint: "Reprint", sp: "SP", tr: "TR", other: "" };
const KIND_KO = { base: "", parallel: "패러렐", reprint: "재수록", sp: "SP", tr: "TR", other: "" };

// 영문 공식 이름·색·특징은 번호 단위(같은 번호는 같은 카드). 영문판 목록 전체에서 찾는다(EB-04 는 OP14-EB04·OP15-EB04 안에 있다).
const EN_BY_NUM = {};
for (const c of Object.values(EN.cards || {})) if (c && c.num && !EN_BY_NUM[c.num]) EN_BY_NUM[c.num] = c;
// 일본판 번호 → 그 번호의 모든 공식 ID(상품·구분)
const JP_BY_NUM = {};
for (const [code, p] of Object.entries(JP.products || {})) {
  for (const id of p.ids) {
    const c = JP.cards[id];
    if (!c) continue;
    (JP_BY_NUM[c.num] = JP_BY_NUM[c.num] || []).push({ id, product: code, kind: CL.kindOf(id, c) });
  }
}

const setNameEn = (code) => CL.nameEnOf(code);   // 추적 세트 → 예정 세트 → 공식 상품명(라틴 문자) 순 — card-list-shared.js
const setNameKo = (code, nameEn) => (packs.sets && packs.sets[code] && packs.sets[code].nameKo) || nameEn;

// ── 우리 숫자
const toUsdAt = (val, cur, date) => (val == null ? null : cur === "USD" ? val : cur === "KRW" ? val / (fxAt(date) || FX.usdKrw) : null);

// 세트 Top 10 의 사람 확인 변형(이미지 접미어) → 공식 ID. 같은 ID 를 두 카드가 가리키면 쓰지 않는다.
function verifiedById() {
  const out = {}, dup = new Set();
  for (const [code, s] of Object.entries(packs.sets || {})) {
    const ids = new Set(((JP.products || {})[code] || { ids: [] }).ids);
    for (const c of s.cards || []) {
      if (typeof c._imgSuffix !== "string" || !c.number) continue;
      const id = c.number + c._imgSuffix;
      if (!ids.has(id)) continue;
      if (out[id]) dup.add(id); else out[id] = { code, card: c };
    }
  }
  for (const id of dup) delete out[id];
  return out;
}
const VERIFIED = verifiedById();

// 공식 ID → 경매 키(번호|jp|tier). 규칙은 파일 머리 주석.
function ruleKey(id, card) {
  const v = VERIFIED[id];
  if (v) return `${card.num}|jp|${ourTier(v.card.name)}`;
  const es = JP_BY_NUM[card.num] || [];
  const kind = CL.kindOf(id, card);
  if (kind === "base") return es.some((e) => e.kind === "reprint") ? null : `${card.num}|jp|base`;
  if (kind === "sp") return es.filter((e) => e.kind === "sp").length === 1 ? `${card.num}|jp|sp` : null;
  if (kind === "tr") return es.filter((e) => e.kind === "tr").length === 1 ? `${card.num}|jp|tr` : null;
  if (kind === "parallel") {
    const pre = card.num.split("-")[0];
    const own = es.filter((e) => e.kind === "parallel" && e.product.replace("-", "") === pre);
    return own.length === 1 && own[0].id === id ? `${card.num}|jp|alt` : null;
  }
  return null;
}
// 영문판 인쇄 경매 키(번호|en|tier) — 같은 행의 영문판 인쇄. 판별을 합치지 않고 따로 칸을 둔다.
// 공식 ID 는 판마다 접미어가 다를 수 있어(JP _p2 ↔ EN _p1) 번호 + 구분으로 잇는다. 일본판 쪽 규칙(위)과 영문판 목록의 같은 규칙이
// 둘 다 "그 번호의 그 구분은 하나뿐" 일 때만 붙인다. 사람 확인 접미어는 일본판 이미지 기준이라 영문판에는 쓰지 않는다.
const EN_ALL_BY_NUM = {};
for (const [code, p] of Object.entries(EN.products || {})) {
  for (const id of p.ids) {
    const c = EN.cards[id];
    if (!c) continue;
    (EN_ALL_BY_NUM[c.num] = EN_ALL_BY_NUM[c.num] || []).push({ id, parts: code.split("-").length === 2 && /\d/.test(code.split("-")[0]) ? code.split("-") : [code.replace("-", "")], kind: CL.kindOf(id, c) });
  }
}
function ruleKeyEn(id, card) {
  const kind = CL.kindOf(id, card);
  const jp = JP_BY_NUM[card.num] || [], en = EN_ALL_BY_NUM[card.num] || [];
  const pre = card.num.split("-")[0];
  const one = (arr, k) => arr.filter((e) => e.kind === k).length === 1;
  if (kind === "base") return !jp.some((e) => e.kind === "reprint") && en.some((e) => e.kind === "base") && !en.some((e) => e.kind === "reprint") ? `${card.num}|en|base` : null;
  if (kind === "sp") return one(jp, "sp") && one(en, "sp") ? `${card.num}|en|sp` : null;
  if (kind === "tr") return one(jp, "tr") && one(en, "tr") ? `${card.num}|en|tr` : null;
  if (kind === "parallel") {
    const ownJp = jp.filter((e) => e.kind === "parallel" && e.product.replace("-", "") === pre);
    const ownEn = en.filter((e) => e.kind === "parallel" && e.parts.includes(pre));
    return ownJp.length === 1 && ownJp[0].id === id && ownEn.length === 1 ? `${card.num}|en|alt` : null;
  }
  return null;
}

// 전 상품을 한 번에 — 같은 키를 두 ID 가 가리키면 둘 다 버린다.
function claimKeys(fn) {
  const claims = {};
  for (const p of Object.values(JP.products || {})) for (const id of p.ids) {
    const c = JP.cards[id];
    const k = c ? fn(id, c) : null;
    if (k) (claims[k] = claims[k] || new Set()).add(id);
  }
  const out = {};
  for (const [k, ids] of Object.entries(claims)) if (ids.size === 1) out[[...ids][0]] = k;
  return out;
}
const KEY_OF = claimKeys(ruleKey);
const KEY_OF_EN = claimKeys(ruleKeyEn);

const auctionOf = (key) => {
  const v = key ? (AUCTION.variants || {})[key] : null;
  return v && !v.suspect && (v.sold || 0) >= MIN_N && v.medPrice != null ? v : null;
};
function numbersFor(id) {
  const key = KEY_OF[id] || null;
  const v = auctionOf(key);
  const okV = !!v;
  const auction = okV ? { usd: v.medPrice, n: v.sold } : null;
  const vEn = auctionOf(KEY_OF_EN[id] || null);
  const auctionEn = vEn ? { usd: vEn.medPrice, n: vEn.sold } : null;
  const ver = VERIFIED[id] ? VERIFIED[id].card : null;
  let nm = null, psa10 = null, href = null;
  if (ver) {
    // NM = 쓸 수 있는 값만(nmUsable — 값·읽은 날 있음·숨김 표시 없음), 환산은 AI 피드와 같은 함수 — 2026-10-15.
    // 1차 수정은 읽은 날이 없는 값의 날짜만 비워 "$31<small></small>"·JSON nm {usd, observedOn:null} 로 나갔다(피드는 null). 이제 값째 "—".
    const u = nmUsd(ver, FX);
    if (u != null) nm = { usd: u, date: ver.nmUpdated };
    const s = ver.psa10Ebay;
    if (s && s.soldBased && s.middle != null && (s.sampleSize || 0) >= MIN_N) {
      const u10 = toUsdAt(s.middle, s.currency, s.updated);
      if (u10 != null) psa10 = { usd: u10, n: s.sampleSize, basis: "sold", date: s.updated || null };
    }
    const slug = CARD_MAP[ver.number + "|" + String(ver.name || "").toLowerCase().replace(/[^a-z0-9]/g, "")];
    if (slug) href = `../cards/${slug}`;
  }
  if (!psa10 && okV && v.psa10Med != null && (v.psa10Sold || 0) >= MIN_N) psa10 = { usd: v.psa10Med, n: v.psa10Sold, basis: "auction", date: AUCTION_DAY || null };
  return { nm, auction, auctionEn, psa10, href };
}

function boxNow(code) {
  const cur = (SOLD.sets && SOLD.sets[code] && SOLD.sets[code].current) || {};
  const pick = (ed) => (cur[ed] && cur[ed].median != null ? { usd: cur[ed].median, n: cur[ed].n, date: cur[ed].d } : null);
  return { jp: pick("jp"), en: pick("en") };
}
// 가드 D17 과 같은 표기 — "$1,234"
const money = (v) => "$" + Math.round(v).toLocaleString("en-US");
// 경매 낙찰 중앙값은 실제로 치러진 값 하나다 — $100 미만은 센트까지(9.99 를 $10 으로 올려 적지 않는다). NM·PSA 10 은 환산·중앙값이라 달러 단위.
const paid = (v) => (v < 100 ? "$" + v.toFixed(2) : money(v));

// ── 행 순서 — 그 세트 번호(예: OP17-)가 먼저, 다른 세트 번호(재수록·특별 인쇄)는 뒤로. 각 묶음 안은 공식 목록 순서.
// 2026-10-14 QA: OP-17 표 첫 행이 EB04-061_p3 이라 OP17-001 이 둘째 줄로 밀렸다. 가드 CL1 이 같은 규칙으로 대조한다.
function idsOrdered(product) { return CL.orderIds(product.code, product.ids); }
// ── 행 모델
function rowsOf(product) {
  return idsOrdered(product).map((id) => {
    const c = JP.cards[id] || {};
    const en = EN_BY_NUM[c.num] || {};
    const kind = CL.kindOf(id, c);
    const color = en.color || String(c.color || "").split("/").map((x) => COLOR_EN[x] || x).join("/");
    return {
      id, num: c.num, kind, rarity: CL.rarityShow(c.rarity), type: c.type,   // SPカード → SP — 세트·카드 상세·AI 피드와 같은 함수(2026-10-15)
      nameEn: en.name || "", nameJa: c.name || "", color,
      cost: c.cost, costKind: c.costKind, power: c.power, counter: c.counter,
      attribute: en.attribute || c.attribute || null, feature: en.feature || c.feature || "", trigger: !!c.trigger,
      ...numbersFor(id),
    };
  });
}
const anchorOf = (id) => id.toLowerCase().replace(/[^a-z0-9]+/g, "-");
// 공식 목록의 빈 값("-", 이벤트·스테이지의 파워 등)은 화면에 "—" — 사이트 규칙(2026-10-14 QA: "Power -" 로 나갔다).
const shown = (v) => (v == null || v === "" || v === "-" ? null : String(v));
const dashOr = (v) => (shown(v) == null ? "—" : esc(v));

// ── 출처 줄
function sources(code, product) {
  const ens = CL.enProductsFor(code);
  return { jp: { url: product.url, checked: product.checked, changed: product.changed }, en: ens.map((p) => ({ code: p.code, url: p.url, checked: p.checked })) };
}

// 페이지 날짜 = 공식 목록 확인일·변경일과 데이터일 중 늦은 날 — 화면 "Data"·CollectionPage dateModified·JSON updated 가 이 값 하나(2026-10-15, 4차). 2026-10-14 QA: CollectionPage dateModified(데이터일 10-13)와
// 화면 "checked 2026-10-14"·사이트맵(10-14)이 달랐다. 피드(generate-feed)는 이 dateModified 를 읽는다.
// 2026-10-15 감사(#4): 그래도 화면의 경매 "last 45 days to 2026-10-15"·영문판 박스 "(2026-10-15, …)" 보다 이른 10-14 였다 —
// 경매 원장·박스 시리즈는 packs 데이터일(DATA_DATE)보다 늦게 돈다. 그래서 **화면에 찍히는 날짜 전부**(영문 목록 확인일·경매 기준일·
// 박스 관측일·행별 NM/PSA 10 관측일)를 같이 넣고 가장 늦은 날을 쓴다. 수정일이 본문보다 이르면 안 된다(가드 U1 과 같은 규칙).
const pageDate = (src, box, rows) => [
  src.jp.checked, src.jp.changed, DATA_DATE, AUCTION_DAY,
  ...src.en.map((e) => e.checked),
  box.jp && box.jp.date, box.en && box.en.date,
  ...rows.flatMap((r) => [r.nm && r.nm.date, r.psa10 && r.psa10.date]),
].filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d || "")).sort().pop();
// ── 영문 페이지
const TITLE_MAX = 60, DESC_MAX = 155;
const fit = (cands, max, what) => {
  const hit = cands.find((c) => c.length <= max);
  if (!hit) throw new Error(`SEO 길이 초과: ${what} — "${cands[cands.length - 1]}"`);
  return hit;
};
const seen = new Set();
const unique = (t) => { if (seen.has(t)) throw new Error(`타이틀 중복: ${t}`); seen.add(t); return t; };

const CSS = `      .clSummary { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 12px 0 2px; color: var(--muted); font-size: 14px; }
      .clSummary b { color: var(--ink); font-family: var(--font-display); font-size: 17px; font-variant-numeric: tabular-nums; }
      .clMeta { margin: 6px 0 0; max-width: 900px; color: var(--muted); font-size: 13px; line-height: 1.65; }
      .clMeta b { color: var(--ink); font-variant-numeric: tabular-nums; }
      .clLinks { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 10px 0 0; font-size: 14px; }
      .bodyPage table.clTable { width: 100%; min-width: 0; margin: 16px 0 8px; font-size: 13.5px; }
      .clTable th, .clTable td { padding: 7px 8px; }
      .clTable td.num, .clTable th.num { text-align: right; white-space: nowrap; }
      .clTable td small { display: block; color: var(--muted); font-size: 11.5px; }
      .clTable .cNo { display: block; color: var(--muted); font-size: 11.5px; font-variant-numeric: tabular-nums; }
      .clTable .ja { display: block; color: var(--muted); font-size: 12px; }
      .clTable td.cn a { text-decoration: underline; text-decoration-color: rgba(var(--accent-rgb), .55); text-decoration-thickness: 1px; text-underline-offset: 3px; }
      .clTable td.cn a:hover { color: var(--accent); }
      .clTable .sub { display: none; }
      .clTable tbody tr:target { background: var(--accent-dim); }
      @media (max-width: 900px) {
        .bodyPage table.clTable { display: table; overflow: visible; -webkit-mask-image: none; mask-image: none; }
        .clTable .wide { display: none; }
        .clTable .sub { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; }
      }
      .clLegend { margin: 6px 0 0; max-width: 900px; color: var(--muted); font-size: 12px; line-height: 1.65; }`;

const numCell = (o, sub, fmt = money) => (o ? `${fmt(o.usd)}<small>${esc(sub(o))}</small>` : "—");
const nmSub = (o) => (o.date ? o.date.slice(5) : "");
const aucSub = (o) => `n=${o.n}`;
const psaSub = (o) => `${o.basis}${o.date ? " · " + o.date.slice(5) : ""} · n=${o.n}`;
const costShow = (r, life) => (r.costKind === "life" ? `${life} ${esc(r.cost)}` : esc(r.cost));

function pageEn(p, rows, nameEn, src, box, links) {
  const code = p.code, n = p.counts;
  const canonical = `${SITE}/${CL.pagePath(code)}`;
  const koHref = `${SITE}/${CL.koPath(code)}`;
  const label = nameEn ? `${code} ${nameEn}` : code;
  const h1 = `${label} — Card List`;
  const title = unique(fit([
    `One Piece ${label} Card List & Set List`,
    `${label} Card List & Set List`,
    `${label} Card List (${n.cards} Cards)`,
    `${label} Card List`,
    `${code} Card List & Set List (${n.cards} Cards)`,
  ], TITLE_MAX, code));
  const desc = fit([
    `Official ${label} card list: ${n.cards} cards, ${n.numbers} card numbers — rarity, type, color, cost and power, with matched NM, auction and PSA 10 prices.`,
    `Official ${label} card list: ${n.cards} cards, ${n.numbers} card numbers — rarity, type, color, cost and power, with matched prices.`,
    `Official ${code} card list: ${n.cards} cards, ${n.numbers} card numbers — rarity, type, color, cost and power.`,
  ], DESC_MAX, code);
  const setHref = links.setPage ? `${CL.slugOf(code)}.html` : "";
  const crumbs = [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "Set Guides", item: `${SITE}/sets/index.html` },
    ...(setHref ? [{ "@type": "ListItem", position: 3, name: `${code} Guide`, item: `${SITE}/sets/${setHref}` }] : []),
  ];
  crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name: `${code} Card List`, item: canonical });
  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: h1,
    url: canonical,
    inLanguage: "en",
    dateModified: pageDate(src, box, rows),
    isBasedOn: src.jp.url,
    isPartOf: { "@type": "WebSite", name: "OP Box Index", url: `${SITE}/` },
    mainEntity: {
      "@type": "ItemList",
      name: `${label} official card list (Japanese edition)`,
      numberOfItems: rows.length,
      itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${r.id} ${r.nameEn || r.nameJa}`, url: `${canonical}#${anchorOf(r.id)}` })),
    },
  };
  const extraLd = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs })}</script>
    <script type="application/ld+json">${JSON.stringify(ld)}</script>`;

  const sum = [["Cards", "카드", n.cards], ["Card numbers", "카드 번호", n.numbers], ["Base", "기본", n.base], ["Parallel", "패러렐", n.parallel],
    ...(n.reprint ? [["Reprint", "재수록", n.reprint]] : []), ["SP", "SP", n.sp], ["TR", "TR", n.tr], ["Leaders", "리더", n.leaders]];
  const enSrc = src.en.length
    ? src.en.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.code)}</a> checked <time datetime="${e.checked}">${e.checked}</time>`).join(" · ")
    : "—";
  const boxBit = (ed, lbl) => (box[ed] ? `${lbl} <b>${money(box[ed].usd)}</b> (${esc(box[ed].date)}, n=${box[ed].n})` : `${lbl} <b>—</b>`);
  const tr = rows.map((r) => {
    const kind = KIND_EN[r.kind];
    const name = r.nameEn ? `<b>${esc(r.nameEn)}</b>` : `<b lang="ja">${esc(r.nameJa)}</b>`;
    const nameCell = r.href ? `<a href="${esc(r.href)}">${name}</a>` : name;
    const ourBits = [r.nm ? `NM ${money(r.nm.usd)}` : "", r.auction ? `Auction JP ${paid(r.auction.usd)} (n=${r.auction.n})` : "", r.auctionEn ? `Auction EN ${paid(r.auctionEn.usd)} (n=${r.auctionEn.n})` : "", r.psa10 ? `PSA 10 ${money(r.psa10.usd)}` : ""].filter(Boolean);
    return `<tr id="${anchorOf(r.id)}" data-id="${esc(r.id)}"><td class="cn"><span class="cNo">${esc(r.id)}${kind ? ` · ${kind}` : ""}</span>${nameCell}${r.nameEn ? `<span class="ja" lang="ja">${esc(r.nameJa)}</span>` : ""}`
      + `<span class="sub">${esc([r.rarity, TYPE_EN[r.type] || r.type, r.color, r.costKind === "life" ? `Life ${r.cost}` : `Cost ${r.cost}`, shown(r.power) ? `Power ${r.power}` : ""].filter(Boolean).join(" · "))}</span>`
      + `${ourBits.length ? `<span class="sub">${esc(ourBits.join(" · "))}</span>` : ""}</td>`
      + `<td class="wide">${esc(r.rarity)}</td><td class="wide">${esc(TYPE_EN[r.type] || r.type)}</td><td class="wide">${esc(r.color)}</td>`
      + `<td class="num wide">${costShow(r, "Life")}</td><td class="num wide">${dashOr(r.power)}</td>`
      + `<td class="num wide">${numCell(r.nm, nmSub)}</td><td class="num wide">${numCell(r.auction, aucSub, paid)}</td><td class="num wide">${numCell(r.auctionEn, aucSub, paid)}</td><td class="num wide">${numCell(r.psa10, psaSub)}</td></tr>`;
  }).join("\n          ");

  const linkBits = [
    setHref ? `<a href="${setHref}" data-ko="${code} 세트 페이지">${code} set page</a>` : "",
    links.english ? `<a href="${CL.slugOf(code)}-english.html" data-ko="${code} 영문판 박스">${code} English box</a>` : "",
    `<a href="${CL.slugOf(code)}-card-list.csv">CSV</a>`,
    `<a href="${CL.slugOf(code)}-card-list.json">JSON</a>`,
    `<a href="index.html#card-lists" data-ko="전체 카드 리스트">All card lists</a>`,
  ].filter(Boolean);

  const LEGEND_EN = `<p class="clLegend">Base = official card ID without suffix · Parallel = ID ending _p · Reprint = ID ending _r · SP = rarity SP CARD · TR = rarity TR · Leaders = base-print Leader cards · Leaders show Life in the cost column · cards from other sets' numbers follow this set's own numbers.<br />NM = Japanese raw near-mint retail ask, ¥ → USD (MM-DD = observed). Auction JP / EN = median winning bid for the Japanese / English print of that card, ungraded, last 45 days to ${esc(AUCTION_DAY || "—")} (n = sales); prints are never combined. PSA 10 = median of completed sales (n ≥ ${MIN_N}). Numbers appear only where the card ID matches by rule; otherwise —. Effect text and card images are not reproduced. <a href="../methodology.html">Methodology</a> · Data ${esc(pageDate(src, box, rows))}</p>`;
  const html = `${pageHead({ title, desc, canonical, koHref, extraLd, extraCss: CSS, chart: false })}
      <p class="eyebrow" data-ko="공식 카드 리스트 · 일본판">Official card list · Japanese edition</p>
      <h1>${esc(h1)}</h1>
      <!-- CARD-LIST:START -->
      <p class="clSummary">${sum.map(([en, ko, v]) => `<span><span data-ko="${ko}">${en}</span> <b>${v}</b></span>`).join("")}</p>
      <p class="clMeta"><span data-ko="공식 목록(일본판):">Official list (Japanese):</span> <a href="${esc(src.jp.url)}" target="_blank" rel="noopener noreferrer">Bandai card list</a> checked <time datetime="${src.jp.checked}">${src.jp.checked}</time><br /><span data-ko="영문 이름:">English names:</span> Bandai English card list ${enSrc}<br />${boxBit("jp", "JP box sold median")} · ${boxBit("en", "EN box")}</p>
      <p class="clLinks">${linkBits.join("")}</p>
      ${LEGEND_EN}
      <table class="clTable text">
        <thead><tr><th data-ko="카드">Card</th><th class="wide" data-ko="레어도">Rarity</th><th class="wide" data-ko="종류">Type</th><th class="wide" data-ko="색">Color</th><th class="num wide" data-ko="코스트/라이프">Cost / Life</th><th class="num wide" data-ko="파워">Power</th><th class="num wide">NM</th><th class="num wide" data-ko="경매 일본판">Auction JP</th><th class="num wide" data-ko="경매 영문판">Auction EN</th><th class="num wide">PSA 10</th></tr></thead>
        <tbody>
          ${tr}
        </tbody>
      </table>
      <!-- CARD-LIST:END -->
${foot({ chart: false, affiliate: false })}`;
  return html;
}

// ── 한국어 페이지 — 같은 사실(숫자는 USD 그대로, 환산하지 않는다)
function pageKo(p, rows, nameEn, nameKo, src, box, links) {
  const code = p.code, n = p.counts;
  const canonical = `${SITE}/${CL.koPath(code)}`;
  const enUrl = `${SITE}/${CL.pagePath(code)}`;
  const label = `${code} ${nameKo || ""}`.trim();
  const h1 = `${label} — 카드 리스트`;
  const titleFull = `${label} 카드 리스트 (${n.cards}장) | opboxindex`;
  const title = titleFull.length <= 40 ? titleFull : `${label} 카드 리스트 (${n.cards}장)`;
  const descFull = `${label} 공식 카드 리스트 ${n.cards}장(카드 번호 ${n.numbers}종) — 번호·레어도·종류·색·코스트·파워와 확인된 시세.`;
  const desc = descFull.length <= 80 ? descFull : `${code} 공식 카드 리스트 ${n.cards}장 — 번호·레어도·종류·색·코스트·파워.`;
  const crumb = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: `${code} 카드 리스트`, item: canonical },
  ] });
  const ld = JSON.stringify({
    "@context": "https://schema.org", "@type": "CollectionPage", name: h1, url: canonical, inLanguage: "ko", dateModified: pageDate(src, box, rows), isBasedOn: src.jp.url,
    isPartOf: { "@type": "WebSite", name: "OP Box Index", url: `${SITE}/` },
    mainEntity: { "@type": "ItemList", name: `${label} 공식 카드 리스트(일본판)`, numberOfItems: rows.length,
      itemListElement: rows.map((r, i) => ({ "@type": "ListItem", position: i + 1, name: `${r.id} ${r.nameEn || r.nameJa}`, url: `${canonical}#${anchorOf(r.id)}` })) },
  });
  const sum = [["카드", n.cards], ["카드 번호", n.numbers], ["기본", n.base], ["패러렐", n.parallel], ...(n.reprint ? [["재수록", n.reprint]] : []), ["SP", n.sp], ["TR", n.tr], ["리더", n.leaders]];
  const enSrc = src.en.length ? src.en.map((e) => `<a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.code)}</a> 확인 <time datetime="${e.checked}">${e.checked}</time>`).join(" · ") : "—";
  const boxBit = (ed, lbl) => (box[ed] ? `${lbl} <b>${money(box[ed].usd)}</b> (${esc(box[ed].date)}, n=${box[ed].n})` : `${lbl} <b>—</b>`);
  const colorKo = (c) => String(c || "").split("/").map((x) => COLOR_KO[x] || x).join("/");
  const tr = rows.map((r) => {
    const kind = KIND_KO[r.kind];
    const name = r.nameEn ? `<b>${esc(r.nameEn)}</b>` : `<b lang="ja">${esc(r.nameJa)}</b>`;
    const nameCell = r.href ? `<a href="${esc(r.href)}">${name}</a>` : name;
    const ourBits = [r.nm ? `NM ${money(r.nm.usd)}` : "", r.auction ? `경매 일본판 ${paid(r.auction.usd)} (n=${r.auction.n})` : "", r.auctionEn ? `경매 영문판 ${paid(r.auctionEn.usd)} (n=${r.auctionEn.n})` : "", r.psa10 ? `PSA 10 ${money(r.psa10.usd)}` : ""].filter(Boolean);
    const psaKo = (o) => `${o.basis === "sold" ? "판매" : "경매"}${o.date ? " · " + o.date.slice(5) : ""} · n=${o.n}`;
    return `<tr id="${anchorOf(r.id)}" data-id="${esc(r.id)}"><td class="cn"><span class="cNo">${esc(r.id)}${kind ? ` · ${kind}` : ""}</span>${nameCell}${r.nameEn ? `<span class="ja" lang="ja">${esc(r.nameJa)}</span>` : ""}`
      + `<span class="sub">${esc([r.rarity, TYPE_KO[r.type] || r.type, colorKo(r.color), r.costKind === "life" ? `라이프 ${r.cost}` : `코스트 ${r.cost}`, shown(r.power) ? `파워 ${r.power}` : ""].filter(Boolean).join(" · "))}</span>`
      + `${ourBits.length ? `<span class="sub">${esc(ourBits.join(" · "))}</span>` : ""}</td>`
      + `<td class="wide">${esc(r.rarity)}</td><td class="wide">${esc(TYPE_KO[r.type] || r.type)}</td><td class="wide">${esc(colorKo(r.color))}</td>`
      + `<td class="num wide">${costShow(r, "라이프")}</td><td class="num wide">${dashOr(r.power)}</td>`
      + `<td class="num wide">${numCell(r.nm, nmSub)}</td><td class="num wide">${numCell(r.auction, aucSub, paid)}</td><td class="num wide">${numCell(r.auctionEn, aucSub, paid)}</td><td class="num wide">${numCell(r.psa10, psaKo)}</td></tr>`;
  }).join("\n          ");
  const slug = CL.slugOf(code);
  const linkBits = [
    links.koSet ? `<a href="${slug}.html">${code} 박스 시세</a>` : "",
    links.setPage ? `<a href="../sets/${slug}.html">${code} 세트 페이지(영문)</a>` : "",
    `<a href="../sets/${slug}-card-list.csv">CSV</a>`,
    `<a href="../sets/${slug}-card-list.json">JSON</a>`,
    // 영문판과 같은 묶음 — 전체 카드 리스트·전체 세트 가이드(2026-10-14 QA: ko 판에만 없었다)
    `<a href="../sets/index.html#card-lists">전체 카드 리스트</a>`,
    `<a href="../sets/index.html">전체 세트 가이드</a>`,
  ].filter(Boolean);
  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="ko" href="${canonical}" />
    <link rel="alternate" hreflang="en" href="${enUrl}" />
    <link rel="alternate" hreflang="x-default" href="${enUrl}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${crumb}</script>
    <script type="application/ld+json">${ld}</script>
    <link rel="stylesheet" href="../styles.css?v=${CSS_VER}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
${CSS}
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${navHtmlKo(CL.koPath(code), `/${CL.pagePath(code)}`)}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:var(--muted);text-decoration:none">한국어 시세</a> · 공식 카드 리스트 · 일본판</p>
      <h1>${esc(h1)}</h1>
      <!-- CARD-LIST:START -->
      <p class="clSummary">${sum.map(([k, v]) => `<span>${k} <b>${v}</b></span>`).join("")}</p>
      <p class="clMeta">공식 목록(일본판): <a href="${esc(src.jp.url)}" target="_blank" rel="noopener noreferrer">반다이 카드 리스트</a> 확인 <time datetime="${src.jp.checked}">${src.jp.checked}</time><br />영문 이름: 반다이 영문 카드 리스트 ${enSrc}<br />${boxBit("jp", "일본판 박스 판매 중앙값")} · ${boxBit("en", "영문판 박스")}</p>
      <p class="clLinks">${linkBits.join("")}</p>
      <p class="clLegend">기본 = 접미어 없는 공식 카드 ID · 패러렐 = _p 로 끝나는 ID · 재수록 = _r 로 끝나는 ID · SP = 레어도 SP CARD · TR = 레어도 TR · 리더 = 기본 인쇄 리더 카드 · 리더는 코스트 칸에 라이프 · 다른 세트 번호 카드는 이 세트 번호 뒤에.<br />금액은 달러(USD). NM = 일본판 미개봉급 낱장 소매 호가, 엔 → 달러(MM-DD = 관측일). 경매 일본판/영문판 = 그 카드의 일본판/영문판 인쇄·미감정 낙찰가 중앙값, ${esc(AUCTION_DAY || "—")}까지 45일(n = 낙찰 수), 두 판을 합치지 않음. PSA 10 = 판매 완료 중앙값(n ≥ ${MIN_N}). 카드 ID 가 규칙으로 맞을 때만 숫자를 싣고, 아니면 —. 효과 텍스트·카드 이미지는 싣지 않습니다. 데이터 ${esc(pageDate(src, box, rows))}</p>
      <table class="clTable text">
        <thead><tr><th>카드</th><th class="wide">레어도</th><th class="wide">종류</th><th class="wide">색</th><th class="num wide">코스트/라이프</th><th class="num wide">파워</th><th class="num wide">NM</th><th class="num wide">경매 일본판</th><th class="num wide">경매 영문판</th><th class="num wide">PSA 10</th></tr></thead>
        <tbody>
          ${tr}
        </tbody>
      </table>
      <!-- CARD-LIST:END -->
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
}

// ── 기계 판독 파일
const CSV_COLS = ["set", "id", "number", "print", "rarity", "type", "name_en", "name_ja", "color", "cost", "cost_kind", "power", "counter", "attribute", "features", "trigger",
  "nm_usd", "nm_date", "auction_jp_median_usd", "auction_jp_sold_n", "auction_en_median_usd", "auction_en_sold_n", "psa10_usd", "psa10_n", "psa10_basis", "psa10_date", "card_page", "source"];
const csvCell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
function cardJson(r) {
  return {
    id: r.id, number: r.num, print: r.kind, rarity: r.rarity, type: r.type, nameEn: r.nameEn || null, nameJa: r.nameJa || null, color: r.color,
    cost: r.cost, costKind: r.costKind, power: r.power, counter: r.counter, attribute: r.attribute, features: r.feature || null, trigger: r.trigger,
    nm: r.nm ? { usd: r2(r.nm.usd), observedOn: r.nm.date } : null,
    auction: r.auction ? { print: "Japanese", medianUsd: r2(r.auction.usd), sold: r.auction.n, windowDays: 45, through: AUCTION_DAY || null } : null,
    auctionEnglishPrint: r.auctionEn ? { print: "English", medianUsd: r2(r.auctionEn.usd), sold: r.auctionEn.n, windowDays: 45, through: AUCTION_DAY || null } : null,
    psa10: r.psa10 ? { usd: r2(r.psa10.usd), n: r.psa10.n, basis: r.psa10.basis, observedOn: r.psa10.date } : null,
    cardPage: r.href ? `${SITE}/cards/${r.href.replace("../cards/", "")}` : null,
  };
}
function machineFiles(p, rows, nameEn, src, box) {
  const doc = {
    // updated = 페이지 날짜(pageDate — 화면 "Data"·CollectionPage dateModified 와 같은 값, 2026-10-15 4차). 종전 DATA_DATE(10-14)는
    // 파일 안 경매 through(10-15)보다 일렀고, free-data #card-lists Dataset(10-15)과도 달랐다.
    set: p.code, name: nameEn || null, edition: "Japanese", page: `${SITE}/${CL.pagePath(p.code)}`, updated: pageDate(src, box, rows),
    officialList: { url: src.jp.url, checked: src.jp.checked, changed: src.jp.changed },
    englishNames: src.en.map((e) => ({ product: e.code, url: e.url, checked: e.checked })),
    counts: { cards: p.counts.cards, cardNumbers: p.counts.numbers, base: p.counts.base, parallel: p.counts.parallel, reprint: p.counts.reprint, sp: p.counts.sp, tr: p.counts.tr, leaders: p.counts.leaders },
    box: { japaneseSoldMedianUsd: box.jp ? box.jp.usd : null, japaneseObservedOn: box.jp ? box.jp.date : null, japaneseN: box.jp ? box.jp.n : null, englishSoldMedianUsd: box.en ? box.en.usd : null, englishObservedOn: box.en ? box.en.date : null, englishN: box.en ? box.en.n : null },
    notes: "Card facts (number, names, rarity, type, color, cost/life, power, counter, attribute, features, trigger) are from Bandai's official card lists linked above; effect text and images are not included. nm/auction/psa10 are OP Box Index observations attached only where the official card ID matches by rule (null otherwise): nm = Japanese raw near-mint retail ask in USD, auction / auctionEnglishPrint = median winning bid for the Japanese / English print of that card number and print type, ungraded, 45-day window (prints never combined), psa10 = median of completed sales (n >= 3). OP Box Index numbers: CC BY 4.0, attribute 'OP Box Index (opboxindex.com)'.",
    cards: rows.map(cardJson),
  };
  const csv = [CSV_COLS.join(",")].concat(rows.map((r) => {
    const j = cardJson(r);
    return [p.code, r.id, r.num, r.kind, r.rarity, r.type, r.nameEn, r.nameJa, r.color, r.cost, r.costKind, r.power, r.counter, r.attribute, r.feature, r.trigger ? "yes" : "no",
      j.nm ? j.nm.usd : "", j.nm ? j.nm.observedOn : "", j.auction ? j.auction.medianUsd : "", j.auction ? j.auction.sold : "", j.auctionEnglishPrint ? j.auctionEnglishPrint.medianUsd : "", j.auctionEnglishPrint ? j.auctionEnglishPrint.sold : "",
      j.psa10 ? j.psa10.usd : "", j.psa10 ? j.psa10.n : "", j.psa10 ? j.psa10.basis : "", j.psa10 ? j.psa10.observedOn || "" : "", j.cardPage || "", src.jp.url].map(csvCell).join(",");
  })).join("\n") + "\n";
  return { doc, csv };
}
// 사이트맵 lastmod 를 올릴지 — 확인일·데이터일을 뺀 내용이 직전 JSON 과 다를 때만.
const stableOf = (d) => JSON.stringify({ ...d, updated: null, officialList: { ...d.officialList, checked: null }, englishNames: (d.englishNames || []).map((e) => ({ ...e, checked: null })) });

function main() {
  const list = CL.products();
  const smEntriesEn = [], smEntriesKo = [], written = [];
  for (const p of list) {
    const code = p.code, slug = CL.slugOf(code);
    const nameEn = setNameEn(code);
    const nameKo = setNameKo(code, nameEn);
    const rows = rowsOf(p);
    const src = sources(code, p);
    const box = boxNow(code);
    const links = {
      setPage: fs.existsSync(path.join(ROOT, "sets", `${slug}.html`)),
      english: fs.existsSync(path.join(ROOT, "sets", `${slug}-english.html`)),
      koSet: fs.existsSync(path.join(ROOT, "ko", `${slug}.html`)),
    };
    const { doc, csv } = machineFiles(p, rows, nameEn, src, box);
    const jsonFile = path.join(ROOT, CL.jsonPath(code));
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(jsonFile, "utf8")); } catch { /* 첫 생성 */ }
    const changed = !prev || stableOf(prev) !== stableOf(doc);
    fs.writeFileSync(path.join(ROOT, CL.pagePath(code)), pageEn(p, rows, nameEn, src, box, links), "utf8");
    fs.writeFileSync(path.join(ROOT, CL.koPath(code)), pageKo(p, rows, nameEn, nameKo, src, box, links), "utf8");
    fs.writeFileSync(jsonFile, JSON.stringify(doc, null, 1) + "\n", "utf8");
    fs.writeFileSync(path.join(ROOT, CL.csvPath(code)), csv, "utf8");
    smEntriesEn.push({ loc: `${SITE}/${CL.pagePath(code)}`, changed });
    smEntriesKo.push({ loc: `${SITE}/${CL.koPath(code)}`, changed });
    written.push({ code, rows: rows.length, numbers: rows.filter((r) => r.nm || r.auction || r.auctionEn || r.psa10).length });
  }
  const sm = path.join(ROOT, "sitemap.xml");
  const a = addUrls(sm, smEntriesEn, { priority: "0.7" });
  const b = addUrls(sm, smEntriesKo, { priority: "0.5" });
  console.log(JSON.stringify({ pages: written.length, rowsTotal: written.reduce((s, w) => s + w.rows, 0), rowsWithOurNumbers: written.reduce((s, w) => s + w.numbers, 0), sitemapAdded: a.added + b.added, sitemapBumped: a.bumped + b.bumped, sets: written.map((w) => `${w.code}:${w.rows}/${w.numbers}`) }));
}

module.exports = { ruleKey, KEY_OF, rowsOf };
if (require.main === module) main();
