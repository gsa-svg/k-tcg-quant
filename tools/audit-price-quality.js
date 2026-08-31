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

// 값이 언제 것인지 — 2026-08-25 추가.
// 종전 검사는 "값이 그럴듯한가"만 봤다. 오래된 값은 그럴듯하다. 실측으로 175장 중 80장이
// 옛 가격이었고 최대 -53% 차이가 났는데(유유테이 수집이 밀려 있었다) 어떤 검사도 걸지 못했다.
// 유유테이 매칭에 실패한 카드는 nmUpdated 가 아예 안 찍히므로 여기서 드러난다.
const NM_STALE_DAYS = 21;

function auditNmFreshness(issues, code, card) {
  if (card.nmJpy == null) return;
  const current = { nmJpy: card.nmJpy, nmUpdated: card.nmUpdated || null, nmVenue: card.nmVenue || null };
  if (!card.nmUpdated) {
    addIssue(issues, { severity: "review", code, card, field: "nmUpdated", reason: "nm_price_has_no_observation_date", current });
    return;
  }
  const days = Math.floor((Date.now() - Date.parse(card.nmUpdated)) / 864e5);
  if (!Number.isFinite(days)) {
    addIssue(issues, { severity: "review", code, card, field: "nmUpdated", reason: "nm_observation_date_unparseable", current });
  } else if (days > NM_STALE_DAYS) {
    addIssue(issues, { severity: "review", code, card, field: "nmUpdated", reason: "nm_price_stale", current: { ...current, days } });
  }
}

// 등급 가격(PSA10)이 언제 것인지 — 2026-08-31 추가.
// NM 은 신선도를 보는데 등급 가격은 안 봤다. 그 사이 psa10Ebay 가 7/10 이후 두 달을 멈춰
// 있었고, 화면은 두 달 전 값을 현재 시세처럼 계속 내보냈다. 수집기(update-ebay-psa10-prices)가
// 어떤 워크플로에도 안 걸려 있어 아무도 몰랐다 — 낡은 값은 그럴듯해서 눈으로는 안 잡힌다.
// PSA10 실거래는 eBay 가 API 를 막아 브라우저로만 받는다(psa10-sold-refresh → psa10-sold-write).
// 그래서 자동화가 아니라 이 검사가 '다시 받을 때'를 알려주는 장치다.
const PSA10_STALE_DAYS = 35;

function auditPsa10Freshness(issues, code, card) {
  const g = card.psa10Ebay;
  if (!g || g.middle == null) return;
  const current = { middle: g.middle, updated: g.updated || null, sampleSize: g.sampleSize ?? null };
  if (!g.updated) {
    addIssue(issues, { severity: "review", code, card, field: "psa10Ebay.updated", reason: "psa10_price_has_no_observation_date", current });
    return;
  }
  const days = Math.floor((Date.now() - Date.parse(g.updated)) / 864e5);
  if (!Number.isFinite(days)) {
    addIssue(issues, { severity: "review", code, card, field: "psa10Ebay.updated", reason: "psa10_observation_date_unparseable", current });
  } else if (days > PSA10_STALE_DAYS) {
    addIssue(issues, { severity: "review", code, card, field: "psa10Ebay.updated", reason: "psa10_price_stale", current: { ...current, days } });
  }
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
      auditNmFreshness(issues, code, card);

      auditPsa10Freshness(issues, code, card);
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
