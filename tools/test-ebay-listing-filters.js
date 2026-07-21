#!/usr/bin/env node

const assert = require("node:assert/strict");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");
const { isPsa10JapaneseCardListing } = require("./ebay-psa10-listing-filter");

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

console.log("eBay listing filter tests passed");
