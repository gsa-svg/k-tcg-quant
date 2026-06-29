import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const dataPath = path.join(root, "data", "onepiece-packs.json");
const reportPath = path.join(root, "data", "psa10-sold-audit.json");

const compact = (value) => String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();

function normalizeNumber(number, setCode) {
  const raw = String(number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  return raw;
}

function hasConflictingNumber(title, expected) {
  const expectedCompact = compact(expected);
  const found = title.match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(compact).some((number) => number !== expectedCompact);
}

function hasVariantSignal(title, card) {
  const name = `${card.name || ""} ${card.rarity || ""}`;
  if (/manga|comic/i.test(name)) return /manga|comic/i.test(title);
  if (/\bsp\b|special/i.test(name)) return /\bsp\b|special|parallel|alt/i.test(title);
  if (/parallel|alternate/i.test(name)) return /parallel|alternate|alt\s*art|comic/i.test(title);
  return true;
}

function isValidJapanesePsa10Title(title, card, setCode) {
  const number = normalizeNumber(card.number, setCode);
  return (
    /one piece/i.test(title) &&
    /psa\s*10|gem\s*mint\s*10/i.test(title) &&
    /japanese|japan|jpn|\bjap\b/i.test(title) &&
    !/english|\beng\b|\ben\b|korean|chinese|simplified|bgs|cgc|ars|ace|sgc|tag|psa\s*9|raw|ungraded|proxy|digital|lot of|bundle|repack|booster|box|case/i.test(title) &&
    compact(title).includes(compact(number)) &&
    !hasConflictingNumber(title, number) &&
    hasVariantSignal(title, card)
  );
}

function parseKrw(line) {
  const match = String(line || "").match(/KRW\s*([0-9,]+(?:\.[0-9]+)?)/i);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

function percentile(values, ratio) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * ratio));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const weight = position - lower;
  return Math.round(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

function parseSoldItems(text, card, setCode) {
  const lines = String(text || "").split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const items = [];

  for (let i = 0; i < lines.length; i += 1) {
    if (!/^판매됨\s+\d{4}년/.test(lines[i])) continue;
    const soldDateKo = lines[i].replace(/^판매됨\s+/, "");
    const title = lines[i + 1] || "";
    let priceKrw = null;
    let origin = "";

    for (let j = i + 2; j < Math.min(lines.length, i + 20); j += 1) {
      if (priceKrw == null) priceKrw = parseKrw(lines[j]);
      if (/출발지/.test(lines[j])) origin = lines[j];
    }

    if (priceKrw == null) continue;
    if (/중국|홍콩|마카오|China|Hong Kong|Macau/i.test(origin)) continue;
    if (!isValidJapanesePsa10Title(title, card, setCode)) continue;
    items.push({ soldDateKo, title, priceKrw, origin });
  }

  return items;
}

function buildQuery(setCode, card) {
  return [normalizeNumber(card.number, setCode), card.name, "PSA 10 Japanese"].filter(Boolean).join(" ");
}

function getTargets(data) {
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])].filter((code) => data.sets[code]?.cards?.length);
  return codes.flatMap((code) => (data.sets[code].cards || []).map((card) => ({ code, card })));
}

async function scrapeCard(tab, code, card) {
  const query = buildQuery(code, card);
  const url = new URL("https://www.ebay.com/sch/i.html");
  url.searchParams.set("_nkw", query);
  url.searchParams.set("LH_Sold", "1");
  url.searchParams.set("LH_Complete", "1");
  url.searchParams.set("_sop", "13");

  let navError = null;
  try {
    await tab.goto(url.toString());
    await tab.playwright.waitForLoadState({ state: "load", timeoutMs: 12000 });
  } catch (error) {
    navError = String(error?.message || error).slice(0, 160);
  }

  await tab.playwright.waitForTimeout(850);
  const text = await tab.playwright.evaluate(() => document.body.innerText).catch(() => "");
  const samples = parseSoldItems(text, card, code);
  const prices = samples.map((sample) => sample.priceKrw).sort((a, b) => a - b);

  return { query, navError, samples, prices };
}

function clearPsa(card) {
  delete card.psa10Ebay;
  delete card.psa10Usd;
  delete card.psa10Date;
  delete card.psa10Venue;
}

export async function runSoldAudit({ start = 0, batchSize = 60, reset = false } = {}) {
  if (!globalThis.browser) throw new Error("browser global is required. Run from the browser-enabled Codex session.");

  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const targets = getTargets(data);
  const report = reset || !fs.existsSync(reportPath)
    ? { updated: new Date().toISOString(), source: "eBay sold/completed browser search", total: targets.length, processed: 0, updatedCount: 0, hiddenCount: 0, noSoldCount: 0, errorCount: 0, rows: [] }
    : JSON.parse(fs.readFileSync(reportPath, "utf8"));

  if (reset) {
    for (const { card } of targets) clearPsa(card);
  }

  const viewport = await globalThis.browser.capabilities.get("viewport");
  const tab = await globalThis.browser.tabs.new();
  await viewport.set({ width: 1280, height: 900 });

  const end = Math.min(targets.length, start + batchSize);
  for (let index = start; index < end; index += 1) {
    const { code, card } = targets[index];
    if (!reset) clearPsa(card);

    const result = await scrapeCard(tab, code, card);
    if (result.navError) report.errorCount += 1;

    if (result.prices.length >= 2) {
      card.psa10Ebay = {
        source: "eBay Sold completed search",
        query: result.query,
        updated: new Date().toISOString().slice(0, 10),
        marketplaceId: "EBAY_US",
        currency: "KRW",
        low: percentile(result.prices, 0.15),
        middle: percentile(result.prices, 0.5),
        high: percentile(result.prices, 0.85),
        sampleSize: result.prices.length,
        excludedCount: 0,
        outlierCount: 0,
        soldBased: true,
      };
      report.updatedCount += 1;
    } else if (result.samples.length) {
      report.hiddenCount += 1;
    } else {
      report.noSoldCount += 1;
    }

    report.processed = Math.max(report.processed || 0, index + 1);
    report.rows.push({
      code,
      rank: card.rank,
      number: card.number,
      name: card.name,
      query: result.query,
      navError: result.navError,
      rawMatches: result.samples.length,
      used: result.prices.length >= 2 ? result.prices.length : 0,
      middleKrw: card.psa10Ebay?.middle || null,
      samples: result.samples.slice(0, 5),
    });

    data.updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
    fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`, "utf8");
  }

  await tab.close();
  await viewport.reset();
  return { start, end, processed: report.processed, updatedCount: report.updatedCount, hiddenCount: report.hiddenCount, noSoldCount: report.noSoldCount, errorCount: report.errorCount };
}
