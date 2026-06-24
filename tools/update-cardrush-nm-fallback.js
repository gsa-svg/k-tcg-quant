#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");

function stripTags(value) {
  return value
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeNumber(number, setCode) {
  const raw = (number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) {
    return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  }
  return raw;
}

function parseCardrushProducts(html) {
  const products = [];
  const regex =
    /<span class="goods_name">([\s\S]*?)<wbr[\s\S]*?<span class="figure">([\d,]+)円<\/span>[\s\S]*?<p class="stock">([\s\S]*?)<\/p>/g;

  for (const match of html.matchAll(regex)) {
    const name = stripTags(match[1]);
    const number = name.match(/\{([A-Z0-9-]+)\}/)?.[1] || "";
    products.push({
      name,
      number,
      priceJpy: Number(match[2].replace(/,/g, "")),
      stockText: stripTags(match[3]),
    });
  }

  return products.filter((product) => product.number && Number.isFinite(product.priceJpy));
}

async function searchCardrush(keyword) {
  const url = `https://cardrush-op.jp/product-list?keyword=${encodeURIComponent(keyword)}`;
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 K-TCG-Quant research bot",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`Cardrush ${keyword} HTTP ${response.status}`);
  }
  return { url, products: parseCardrushProducts(await response.text()) };
}

function chooseProduct(products, targetNumber) {
  const cleanTarget = targetNumber.toUpperCase();
  const candidates = products.filter((product) => {
    const name = product.name.toLowerCase();
    return product.number.toUpperCase() === cleanTarget && !/psa|鑑定|ars|bgs/.test(name);
  });
  if (!candidates.length) return null;

  return candidates.sort((a, b) => b.priceJpy - a.priceJpy)[0];
}

async function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const requestedCodes = process.argv.slice(2);
  const defaultCodes = [...data.jp.list, ...data.extra.list].filter((code) => data.sets[code]?.cards?.length);
  const codes = requestedCodes.length ? requestedCodes : defaultCodes;
  let updatedTotal = 0;
  let missedTotal = 0;

  for (const code of codes) {
    const set = data.sets[code];
    if (!set?.cards?.length) continue;

    let updated = 0;
    let missed = 0;
    for (const card of set.cards) {
      if (card.nmJpy != null) continue;

      const targetNumber = normalizeNumber(card.number, code);
      if (!targetNumber) {
        missed += 1;
        continue;
      }

      const { url, products } = await searchCardrush(targetNumber);
      const selected = chooseProduct(products, targetNumber);
      if (!selected) {
        missed += 1;
        continue;
      }

      card.nmJpy = selected.priceJpy;
      card.nmVenue = "カードラッシュ";
      card.nmSourceUrl = url;
      card.nmStock = selected.stockText;
      updated += 1;
    }

    updatedTotal += updated;
    missedTotal += missed;
    if (updated || missed) console.log(`${code}: updated=${updated} missed=${missed}`);
  }

  data.updated = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(`Cardrush fallback updated=${updatedTotal} missed=${missedTotal}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
