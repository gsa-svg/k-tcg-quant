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

function chooseBestProduct(products, card) {
  const cardNumber = (card.number || "").replace(/^#/, "").toUpperCase();
  const candidates = products.filter((product) => product.number.toUpperCase() === cardNumber);
  if (!candidates.length) return null;

  return candidates
    .map((product) => ({ product, score: scoreProduct(product, card) }))
    .sort((a, b) => b.score - a.score || b.product.priceJpy - a.product.priceJpy)[0].product;
}

function scoreProduct(product, card) {
  const cardText = `${card.name || ""} ${card.rarity || ""}`.toLowerCase();
  const productText = `${product.alt} ${product.name}`.toLowerCase();
  let score = product.priceJpy;

  if (/manga|comic|wanted|signature|gold/.test(cardText) && /スーパーパラレル|パラレル|金|漫画|手配書/.test(productText)) {
    score += 1_000_000;
  }
  if (/sp|special/.test(cardText) && /sp|スペシャル|パラレル/.test(productText)) {
    score += 500_000;
  }
  if (/parallel|alternate|alt/.test(cardText) && /パラレル/.test(productText)) {
    score += 250_000;
  }
  if (/leader|\bl\b/.test(cardText) && /リーダー|l /.test(productText)) {
    score += 75_000;
  }
  if (/box topper/.test(cardText) && /ボックス|box|パラレル/.test(productText)) {
    score += 75_000;
  }

  return score;
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

    for (const card of set.cards) {
      const selected = chooseBestProduct(products, card);
      if (!selected) {
        missed += 1;
        continue;
      }

      card.nmJpy = selected.priceJpy;
      card.nmVenue = "遊々亭";
      card.nmSourceUrl = url;
      card.nmStock = selected.stockText;
      updated += 1;
    }

    set.priced = true;
    set.nmSource = "遊々亭 single-card listing";
    summary.push({ code, updated, missed, products: products.length });
    console.log(`${code}: updated=${updated} missed=${missed} products=${products.length}`);
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");

  const missedTotal = summary.reduce((sum, row) => sum + row.missed, 0);
  if (missedTotal) {
    console.error(`Missed NM matches: ${missedTotal}`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
