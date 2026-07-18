#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
const reportPath = path.join(projectRoot, "data", "price-quality-audit.json");

const shouldHideSuspiciousNm = process.argv.includes("--hide-suspicious-nm");

function krwFromJpy(value, fx) {
  return value * (fx.jpyKrw || 9.1);
}

function krwFromUsd(value, fx) {
  return value * (fx.usdKrw || 1388.2);
}

function cardText(card) {
  return `${card.name || ""} ${card.rarity || ""}`.toLowerCase();
}

function addIssue(issues, issue) {
  issues.push({
    severity: issue.severity || "review",
    code: issue.code,
    rank: issue.card.rank,
    number: issue.card.number || null,
    name: issue.card.name || "",
    field: issue.field,
    reason: issue.reason,
    current: issue.current || null,
  });
}

function auditNmPrice(issues, code, card, fx) {
  if (card.nmJpy == null) return;

  const text = cardText(card);
  const nmKrw = krwFromJpy(card.nmJpy, fx);
  const englishKrw = Number.isFinite(card.priceUsd) ? krwFromUsd(card.priceUsd, fx) : null;
  const current = {
    nmJpy: card.nmJpy,
    nmKrw: Math.round(nmKrw),
    priceUsd: card.priceUsd || null,
    nmVenue: card.nmVenue || null,
  };

  const isPrbReprint = /^PRB-/i.test(code) || /\bPRB\b|PRB0/i.test(card.name || "");

  if (!isPrbReprint && /manga|comic/.test(text) && card.nmJpy < 30000) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "nmJpy",
      reason: "manga_or_comic_nm_too_low_variant_mismatch_likely",
      current,
    });
  }

  if (/red/.test(text) && /manga|super|parallel|alternate/.test(text) && card.nmJpy < 80000) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "nmJpy",
      reason: "red_super_parallel_nm_too_low_variant_mismatch_likely",
      current,
    });
  }

  if (/signature|signed|gold stamped/.test(text) && card.nmJpy < 30000) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "nmJpy",
      reason: "signature_or_gold_stamped_nm_too_low_variant_mismatch_likely",
      current,
    });
  }

  if (englishKrw != null && card.priceUsd >= 100 && nmKrw < englishKrw * 0.04) {
    addIssue(issues, {
      severity: "review",
      code,
      card,
      field: "nmJpy",
      reason: "japanese_nm_less_than_4_percent_of_english_reference",
      current: {
        ...current,
        englishKrw: Math.round(englishKrw),
        ratio: Number((nmKrw / englishKrw).toFixed(4)),
      },
    });
  }
}

function auditPsa10Price(issues, code, card) {
  if (card.psa10Usd != null) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "psa10Usd",
      reason: "legacy_single_usd_psa10_price_should_not_be_published",
      current: { psa10Usd: card.psa10Usd, psa10Venue: card.psa10Venue || null },
    });
  }

  if (card.psa10Ebay && !card.psa10Ebay.soldBased) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "psa10Ebay",
      reason: "psa10_ebay_active_price_should_not_be_published",
      current: card.psa10Ebay,
    });
  }

  if (card.psa10Ebay?.soldBased && card.psa10Ebay.sampleSize < 2) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "psa10Ebay",
      reason: "psa10_sold_sample_too_small",
      current: card.psa10Ebay,
    });
  }
}

function auditJapaneseNmEbay(issues, code, card) {
  const market = card.japaneseNmEbay;
  if (!market) return;

  if (market.soldBased !== true) {
    addIssue(issues, {
      severity: "review",
      code,
      card,
      field: "japaneseNmEbay",
      reason: "japanese_nm_ebay_active_not_sold_price",
      current: {
        sampleSize: market.sampleSize,
        confidence: market.confidence || null,
        matchScore: market.matchScore || null,
        middle: market.middle,
        currency: market.currency,
      },
    });
  }

  if ((market.matchScore || 0) < 80 || market.sampleSize < 1) {
    addIssue(issues, {
      severity: "block",
      code,
      card,
      field: "japaneseNmEbay",
      reason: "japanese_nm_ebay_match_quality_too_low",
      current: market,
    });
  }
}

const hideableNmReviewReasons = new Set([
  "japanese_nm_less_than_4_percent_of_english_reference",
]);

function shouldHideNmIssue(issue) {
  if (issue.field !== "nmJpy") return false;
  if (issue.severity === "block") return true;
  return issue.severity === "review" && hideableNmReviewReasons.has(issue.reason);
}

function hideSuspiciousNm(data, issues) {
  const suspiciousNmKeys = new Set(
    issues
      .filter(shouldHideNmIssue)
      .map((issue) => `${issue.code}|${issue.rank}|${issue.number}|${issue.name}`),
  );

  for (const [code, set] of Object.entries(data.sets || {})) {
    for (const card of set.cards || []) {
      const key = `${code}|${card.rank}|${card.number || null}|${card.name || ""}`;
      if (!suspiciousNmKeys.has(key)) continue;
      delete card.nmJpy;
      delete card.nmVenue;
      delete card.nmSourceUrl;
      delete card.nmStock;
      card.nmHiddenReason = "variant_match_uncertain";
    }
  }
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const fx = data.fx || {};
  const issues = [];

  const targetCodes = new Set([...(data.jp?.list || []), ...(data.extra?.list || [])]);
  for (const [code, set] of Object.entries(data.sets || {})) {
    if (!targetCodes.has(code)) continue;
    for (const card of set.cards || []) {
      auditNmPrice(issues, code, card, fx);
      auditPsa10Price(issues, code, card);
      auditJapaneseNmEbay(issues, code, card);
    }
  }

  if (shouldHideSuspiciousNm) {
    hideSuspiciousNm(data, issues);
    data.updated = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  }

  const report = {
    updated: new Date().toISOString(),
    hideSuspiciousNm: shouldHideSuspiciousNm,
    summary: {
      issues: issues.length,
      block: issues.filter((issue) => issue.severity === "block").length,
      review: issues.filter((issue) => issue.severity === "review").length,
    },
    issues,
  };

  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`, "utf8");
  console.log(JSON.stringify(report.summary, null, 2));

  if (report.summary.block > 0 && !shouldHideSuspiciousNm) {
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = { shouldHideNmIssue };
