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
      // ⚠️ 오늘 갱신이 **정직하게 0건**을 낸 경우와 코드가 링크를 빠뜨린 경우를 가른다 — 2026-08-27.
      // OP-07 일본판은 제목으로 일판임을 증명하는 매물이 실제로 0건인 날이 있다(직접 확인:
      // API 67건 전부가 무표기·케이스·팩·"Sealed Box JP" 같은 비정합 제목). "빈 값이 틀린 값보다
      // 낫다"는 원칙대로 그날 링크는 비는 게 맞다. 그런데 이걸 block 으로 두면 그 한 세트 때문에
      // 파이프라인 전체가 죽어 **나머지 21세트까지 사흘째 갱신이 안 됐다**(8/24~26 CI 실패의 원인).
      //  · 오늘 관측했고(updated=오늘) 통과 표본이 0(sampleSize=0) → 시장 사실 = review
      //  · 표본이 있는데 링크가 없거나, 관측 자체가 오래됨 → 코드/파이프라인 문제 = block 유지
      const observedToday = market?.updated === today.toISOString().slice(0, 10);
      const honestlyEmpty = observedToday && (market?.sampleSize || 0) === 0;
      addIssue(issues, {
        severity: honestlyEmpty ? "review" : "block",
        type: "box",
        code,
        reason: honestlyEmpty ? "box_no_qualifying_listing_today" : "box_best_listing_missing",
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
    // review(정직한 빈 값 등)로는 파이프라인을 멈추지 않는다 — 2026-08-27.
    // issues.length 로 exit 1 을 내면 OP-07 하루 0건 같은 시장 사실 하나가
    // 나머지 21세트의 일일 갱신까지 통째로 막는다(8/24~26 실제로 그랬다). block 만 멈춘다.
    if (issues.some((issue) => issue.severity === "block")) process.exit(1);
  }

  console.log(JSON.stringify(report.summary, null, 2));
}

main();
