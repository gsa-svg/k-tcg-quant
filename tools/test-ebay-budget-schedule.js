#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { SCHEDULE, reserveLeft } = require("./ebay-budget");

const workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "collect-tcg.yml"), "utf8");
const hours = [...workflow.matchAll(/cron:\s*["']0\s+([\d,]+)\s+\*\s+\*\s+\*["']/g)]
  .flatMap((match) => match[1].split(",").map(Number))
  .sort((a, b) => a - b);

assert.deepEqual(SCHEDULE.tcg, hours, "TCG quota reservation schedule must match every collection cron hour");
assert.equal(reserveLeft("tcg", 20), 300, "the final 21:00 UTC TCG run still needs its reservation");
assert.equal(reserveLeft("tcg", 21), 0, "reservation is released after the final TCG run starts");
console.log("eBay budget schedule tests passed");
