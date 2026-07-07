#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const reportPath = path.join(projectRoot, "data", "active-listing-audit.json");
const maxFreshDays = Number(process.env.ACTIVE_LISTING_MAX_FRESH_DAYS || 3);

function compact(value) {
  return String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function normalizeNumber(number, setCode) {
  const raw = String(number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  return raw;
}

function daysSince(dateString, today = new Date()) {
  if (!dateString) return Infinity;
  const then = new Date(`${dateString}T00:00:00Z`);
  if (Number.isNaN(then.getTime())) return Infinity;
  return Math.floor((today - then) / 86400000);
}

function isEbayItemUrl(value) {
  try {
    const url = new URL(value);
    return /(^|\.)ebay\./i.test(url.hostname) && /\/itm\//i.test(url.pathname);
  } catch {
    return false;
  }
}

function hasExpectedCardNumber(title, number) {
  if (!number) return true;
  const normalizedTitle = compact(title);
  const expected = compact(number);
  if (normalizedTitle.includes(expected)) return true;

  const match = expected.match(/^(OP|EB|PRB|ST)(\d{1,2})(\d{3})$/);
  if (!match) return false;
  return normalizedTitle.includes(`${match[1]}${Number(match[2])}${match[3]}`);
}

function hasConflictingCardNumber(title, expectedNumber) {
  const expected = compact(expectedNumber);
  const found = String(title || "").match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(compact).some((number) => number !== expected);
}

function hasVariantSignal(title, card) {
  const expected = `${card.name || ""} ${card.rarity || ""}`;
  if (/signature|signed|stamp/i.test(expected)) return /signature|signed|stamp/i.test(title);
  if (/manga|comic/i.test(expected)) return /manga|comic/i.test(title);
  if (/\bsp\b|special/i.test(expected)) return /\bsp\b|special|parallel/i.test(title);
  if (/parallel|alternate/i.test(expected)) return /parallel|alternate|alt\s*art|leader\s*parallel|paralle/i.test(title);
  return true;
}

function isJapanesePsa10CardListing(listing, code, card) {
  const title = listing?.title || "";
  const number = normalizeNumber(card.number, code);
  const hasJapaneseSignal = /japanese|japan|jpn/i.test(title) || listing?.country === "JP";
  const positive = [/one piece/i, /psa\s*10|gem\s*mint\s*10/i];
  const negative = [
    /psa\s*[1-9]\b(?!0)|psa\s*9|psa\s*8|bgs|cgc|ars|raw|ungraded|proxy|digital/i,
    /english|\beng\b|\ben\b|korean|chinese|simplified/i,
    /lot of|bundle|repack|booster|box|case/i,
  ];

  return (
    positive.every((pattern) => pattern.test(title)) &&
    hasJapaneseSignal &&
    !negative.some((pattern) => pattern.test(title)) &&
    hasExpectedCardNumber(title, number) &&
    !hasConflictingCardNumber(title, number) &&
    hasVariantSignal(title, card)
  );
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || "block",
    type: issue.type,
    code: issue.code,
    rank: issue.rank || null,
    number: issue.number || null,
    name: issue.name || null,
    reason: issue.reason,
    title: issue.title || null,
    url: issue.url || null,
  });
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const issues = [];
  const summary = {
    sets: 0,
    boxesChecked: 0,
    psa10LinksChecked: 0,
    missingBoxLinks: 0,
    missingPsa10Links: 0,
    staleMarkets: 0,
  };
  const today = new Date();

  for (const code of [...data.jp.list, ...data.extra.list]) {
    const set = data.sets[code];
    if (!set) continue;
    summary.sets += 1;

    const market = set.boxMarket?.jp?.ebayActive;
    const bestListing = market?.bestListing;
    if (daysSince(market?.updated, today) > maxFreshDays) {
      summary.staleMarkets += 1;
      addIssue(issues, {
        type: "box",
        code,
        reason: "box_active_market_stale_or_missing_update_date",
        title: bestListing?.title,
        url: bestListing?.url,
      });
    }
    if (!bestListing?.url) {
      summary.missingBoxLinks += 1;
      addIssue(issues, {
        type: "box",
        code,
        reason: "box_best_listing_missing",
      });
      continue;
    }
    summary.boxesChecked += 1;
    if (!isEbayItemUrl(bestListing.url)) {
      addIssue(issues, {
        type: "box",
        code,
        reason: "box_best_listing_url_is_not_ebay_item",
        title: bestListing.title,
        url: bestListing.url,
      });
    }
    if (!isJapaneseSealedBoosterBoxTitle(bestListing.title, code)) {
      addIssue(issues, {
        type: "box",
        code,
        reason: "box_best_listing_title_failed_filter",
        title: bestListing.title,
        url: bestListing.url,
      });
    }
    if (isExcludedEbaySellerOrLocation(bestListing)) {
      addIssue(issues, {
        type: "box",
        code,
        reason: "box_best_listing_excluded_seller_or_location",
        title: bestListing.title,
        url: bestListing.url,
      });
    }

    for (const card of set.cards || []) {
      const active = card.psa10Active;
      const listing = active?.bestListing;
      if (!listing?.url) {
        summary.missingPsa10Links += 1;
        continue;
      }

      summary.psa10LinksChecked += 1;
      if (daysSince(active.updated, today) > maxFreshDays) {
        summary.staleMarkets += 1;
        addIssue(issues, {
          type: "psa10",
          code,
          rank: card.rank,
          number: card.number,
          name: card.name,
          reason: "psa10_active_market_stale_or_missing_update_date",
          title: listing.title,
          url: listing.url,
        });
      }
      if (!isEbayItemUrl(listing.url)) {
        addIssue(issues, {
          type: "psa10",
          code,
          rank: card.rank,
          number: card.number,
          name: card.name,
          reason: "psa10_best_listing_url_is_not_ebay_item",
          title: listing.title,
          url: listing.url,
        });
      }
      if (!isJapanesePsa10CardListing(listing, code, card)) {
        addIssue(issues, {
          type: "psa10",
          code,
          rank: card.rank,
          number: card.number,
          name: card.name,
          reason: "psa10_best_listing_title_failed_filter",
          title: listing.title,
          url: listing.url,
        });
      }
      if (isExcludedEbaySellerOrLocation(listing)) {
        addIssue(issues, {
          type: "psa10",
          code,
          rank: card.rank,
          number: card.number,
          name: card.name,
          reason: "psa10_best_listing_excluded_seller_or_location",
          title: listing.title,
          url: listing.url,
        });
      }
    }
  }

  const report = {
    updated: new Date().toISOString(),
    maxFreshDays,
    summary: {
      ...summary,
      issues: issues.length,
      block: issues.filter((issue) => issue.severity === "block").length,
    },
    issues,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`, "utf8");

  if (issues.length) {
    console.error(JSON.stringify(report.summary, null, 2));
    console.error(JSON.stringify({ activeListingIssues: issues.slice(0, 25) }, null, 2));
    process.exit(1);
  }

  console.log(JSON.stringify(report.summary, null, 2));
}

main();
