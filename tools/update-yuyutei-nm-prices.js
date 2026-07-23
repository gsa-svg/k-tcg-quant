#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");

const codeToPath = (code) => code.toLowerCase().replace("-", "");
const yuyuteiUrl = (code) => `https://yuyu-tei.jp/sell/opc/s/${codeToPath(code)}`;

function stripTags(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseYuyuteiProducts(html) {
  const products = [];
  const regex =
    /<img[^>]+alt="([^"]+)"[^>]*>[\s\S]*?<span[^>]*>\s*([A-Z0-9-]+)\s*<\/span>[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>[\s\S]*?<strong[^>]*>\s*([\d,]+)\s*円\s*<\/strong>[\s\S]*?在庫\s*:\s*([\s\S]*?)<\/label>/g;

  for (const match of html.matchAll(regex)) {
    products.push({
      alt: stripTags(match[1]),
      number: stripTags(match[2]),
      name: stripTags(match[3]),
      priceJpy: Number(match[4].replace(/,/g, "")),
      stockText: stripTags(match[5]),
    });
  }

  return products.filter((product) => product.number && Number.isFinite(product.priceJpy));
}

// 변형 등급 — 유유테이 일본어 라벨 기준(가장 구체적부터). 실측 라벨(2026-07-23):
//  (レッドスーパーパラレル)=red · (スーパーパラレル)=super · (金パラレル)=gold · (銀パラレル)=silver · (手配書)=wanted · (パラレル)=parallel · 괄호없음=base
function yuyuTier(product) {
  const s = `${product.name} ${product.alt}`;
  if (/レッド.*スーパーパラレル/.test(s)) return "red";
  if (/スーパーパラレル/.test(s)) return "super";
  if (/金パラレル|ゴールド/.test(s)) return "gold";
  if (/銀パラレル|シルバー/.test(s)) return "silver";
  if (/手配書/.test(s)) return "wanted";
  if (/パラレル/.test(s)) return "parallel";
  return "base";
}
// 우리 카드 이름 → 같은 등급 체계. manga/comic 는 슈퍼파라렐을 뜻함(유유테이엔 별도 'manga' 등급 없음).
function cardTier(card) {
  const s = `${card.name || ""} ${card.rarity || ""}`.toLowerCase();
  if (/red\s*(manga|super|parallel)/.test(s)) return "red";
  if (/super\s*(alt|alternate|parallel)|\bmanga\b|comic/.test(s)) return "super";
  if (/\bgold\b/.test(s)) return "gold";
  if (/\bsilver\b/.test(s)) return "silver";
  if (/wanted/.test(s)) return "wanted";
  if (/parallel/.test(s)) return "parallel";
  if (/alternate|\balt\b/.test(s)) return "alt";   // base/parallel 애매 — 아래 폴백에서만 처리
  return "base";
}

const PROX = Math.log(3);   // 기존값 대비 3배 이내 후보만 인정(그 이상은 값이 이동했거나 기존이 틀린 것 → 스킵+수동).

// 한 카드번호에 속한 우리 카드들 ↔ 유유테이 후보들을 매칭.
// 핵심: top10 카드는 대부분 파라렐/chase라 base가 아니다. 변형 가격은 자릿수로 갈리므로,
//       "기존 nmJpy(대략 맞는 값)와 가장 근접한 후보"에 배정하면 변형이 정확히 갈린다(중복번호도 자연분리).
//       기존값 없는 카드만 이름→등급 매칭. 확신 없으면 배정 안 함(기존값 보존 + 수동플래그).
// 반환: Map(ourCard -> product).
function assignByNumber(ourCards, cands) {
  const res = new Map();
  const used = new Set();
  // 1) 기존값 있는 카드: (카드,후보) 근접쌍을 로그비 오름차순으로 그리디 배정(1:1, 3배 초과는 배정 안 함).
  const pairs = [];
  for (const c of ourCards) {
    if (!(c.nmJpy > 0)) continue;
    for (const p of cands) pairs.push({ card: c, product: p, r: Math.abs(Math.log(p.priceJpy / c.nmJpy)) });
  }
  pairs.sort((a, b) => a.r - b.r);
  for (const { card, product, r } of pairs) {
    if (res.has(card) || used.has(product) || r > PROX) continue;
    res.set(card, product); used.add(product);
  }
  // 2) 기존값 없는 카드: 이름→등급 정확일치가 유일할 때만.
  for (const c of ourCards) {
    if (res.has(c) || c.nmJpy > 0) continue;
    const t = cardTier(c);
    const ms = cands.filter((p) => !used.has(p) && yuyuTier(p) === t);
    if (ms.length === 1) { res.set(c, ms[0]); used.add(ms[0]); }
  }
  return res;
}

async function fetchProducts(code) {
  const url = yuyuteiUrl(code);
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 K-TCG-Quant research bot",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`${code} yuyu-tei HTTP ${response.status}`);
  }

  return { url, products: parseYuyuteiProducts(await response.text()) };
}

async function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const requestedCodes = process.argv.slice(2);
  const defaultCodes = [...data.jp.list, ...data.extra.list].filter((code) => data.sets[code]?.cards?.length);
  const codes = requestedCodes.length ? requestedCodes : defaultCodes;
  const summary = [];

  for (const code of codes) {
    const set = data.sets[code];
    if (!set?.cards?.length) continue;

    const { url, products } = await fetchProducts(code);
    let updated = 0;
    let missed = 0;

    // 카드번호별로 묶어 등급매칭(같은 번호에 base/파라렐/슈퍼 등 변형이 여럿 → 정확히 배정).
    const byNumber = new Map();
    for (const card of set.cards) {
      const num = (card.number || "").replace(/^#/, "").toUpperCase();
      if (!num) continue;
      (byNumber.get(num) || byNumber.set(num, []).get(num)).push(card);
    }
    const ambiguous = [];
    for (const [num, ourCards] of byNumber) {
      const cands = products.filter((p) => p.number.toUpperCase() === num);
      if (!cands.length) { missed += ourCards.length; continue; }
      const picks = assignByNumber(ourCards, cands);
      for (const card of ourCards) {
        const selected = picks.get(card);
        if (!selected) { missed += 1; if (cands.length > 1) ambiguous.push(`${num} "${(card.name || "").slice(0, 24)}" (기존 ¥${card.nmJpy ?? "-"})`); continue; }
        card.nmJpy = selected.priceJpy;
        card.nmVenue = "遊々亭";
        card.nmSourceUrl = url;
        card.nmStock = selected.stockText;
        updated += 1;
      }
    }
    if (ambiguous.length) console.log(`  [수동검토 필요] ${code}: ${ambiguous.join(" · ")}`);

    set.priced = true;
    set.nmSource = "遊々亭 single-card listing";
    summary.push({ code, updated, missed, products: products.length });
    console.log(`${code}: updated=${updated} missed=${missed} products=${products.length}`);
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data)}\n`, "utf8");

  const missedTotal = summary.reduce((sum, row) => sum + row.missed, 0);
  if (missedTotal) {
    console.error(`Missed NM matches: ${missedTotal}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
