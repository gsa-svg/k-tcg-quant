#!/usr/bin/env node

const assert = require("node:assert/strict");
const { shouldHideNmIssue } = require("./audit-price-quality");

assert.equal(shouldHideNmIssue({ severity: "block", field: "nmJpy", reason: "variant_mismatch" }), true);
assert.equal(shouldHideNmIssue({
  severity: "review",
  field: "nmJpy",
  reason: "japanese_nm_less_than_4_percent_of_english_reference",
}), true);
assert.equal(shouldHideNmIssue({ severity: "review", field: "nmJpy", reason: "manual_review" }), false);
assert.equal(shouldHideNmIssue({ severity: "block", field: "psa10Ebay", reason: "bad_sample" }), false);

console.log("price quality audit tests passed");
