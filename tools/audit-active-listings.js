#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");
const { isPsa10JapaneseCardListing } = require("./ebay-psa10-listing-filter");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const reportPath = path.join(projectRoot, "data", "active-listing-audit.json");
const maxFreshDays = Number(process.env.ACTIVE_LISTING_MAX_FRESH_DAYS || 3);

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
      if (!isPsa10JapaneseCardListing(listing, code, card)) {
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
