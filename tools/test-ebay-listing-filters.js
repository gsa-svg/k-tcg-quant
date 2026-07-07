#!/usr/bin/env node

const assert = require("node:assert/strict");
const { isExcludedEbaySellerOrLocation, isJapaneseSealedBoosterBoxTitle } = require("./ebay-listing-filters");

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

console.log("eBay listing filter tests passed");
