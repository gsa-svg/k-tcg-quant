#!/usr/bin/env node

const assert = require("node:assert/strict");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");
const { isPsa10JapaneseCardListing, setCodeFromText, listingSetConflicts } = require("./ebay-psa10-listing-filter");

assert.equal(
  isJapaneseSealedBoosterBoxTitle("Sealed Japanese EB-02 Anime 25th Collection Booster Box [US Seller] One Piece", "EB-02"),
  true,
);

assert.equal(
  isExcludedEbaySellerOrLocation({
    itemLocation: { country: "US" },
    seller: { username: "jindoutian" },
  }),
  true,
);

assert.equal(
  isExcludedEbaySellerOrLocation({
    itemLocation: { country: "CN" },
    seller: { username: "example_cards" },
  }),
  true,
);

assert.equal(
  isExcludedEbaySellerOrLocation({
    itemLocation: { country: "US", city: "Shenzhen" },
    seller: { username: "example_cards" },
  }),
  true,
);

assert.equal(
  isExcludedEbaySellerOrLocation({
    itemLocation: { country: "US", city: "Dallas" },
    seller: { username: "trusted_tcg" },
  }),
  false,
);

const treasureRare = { number: "OP07-109", name: "Monkey D. Luffy TR", rarity: "TR" };
assert.equal(
  isPsa10JapaneseCardListing(
    { title: "PSA 10 JAPANESE MONKEY D. LUFFY ONE PIECE OP07-109", country: "US" },
    "OP-08",
    treasureRare,
  ),
  false,
  "Treasure Rare must not match a number-only base-card listing",
);
assert.equal(
  isPsa10JapaneseCardListing(
    { title: "2024 ONE PIECE OP07-109 MONKEY D. LUFFY TREASURE RARE JAPANESE PSA 10", country: "US" },
    "OP-08",
    treasureRare,
  ),
  true,
  "Treasure Rare listing with an explicit variant signal should pass",
);
assert.equal(
  isPsa10JapaneseCardListing(
    { title: "2024 ONE PIECE OP07-109 MONKEY D. LUFFY TR JAPANESE PSA 10", country: "US" },
    "OP-08",
    { number: "OP07-109", name: "Monkey D. Luffy", rarity: "SR" },
  ),
  false,
  "A base card must not match an explicitly named Treasure Rare listing",
);

// 교차세트 오매칭(2026-07-22 실사고): PRB-01 재판 알트아트가 OP-01 원본에 물림.
// Set 속성으로 세트코드를 뽑아 카드 세트와 다르면 걸러야 한다.
assert.equal(setCodeFromText("ONE PIECE PRB01-PREMIUM BOOSTER -ONE PIECE CARD THE BEST-"), "PRB-01");
assert.equal(setCodeFromText("ONE PIECE OP01-ROMANCE DAWN"), "OP-01");
assert.equal(setCodeFromText("Pokemon nonsense"), null);
assert.equal(
  listingSetConflicts("ONE PIECE PRB01-PREMIUM BOOSTER -ONE PIECE CARD THE BEST-", "OP-01"),
  true,
  "PRB-01 reprint listing must be flagged as a set mismatch for an OP-01 card",
);
assert.equal(
  listingSetConflicts("ONE PIECE OP01-ROMANCE DAWN", "OP-01"),
  false,
  "A matching OP-01 Set aspect must not be flagged",
);
assert.equal(
  listingSetConflicts(null, "OP-01"),
  false,
  "Missing Set aspect must not over-reject (keep, do not guess)",
);

console.log("eBay listing filter tests passed");
