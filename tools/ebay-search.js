#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const envPath = path.join(projectRoot, ".env");

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .reduce((values, line) => {
      const separator = line.indexOf("=");
      if (separator === -1) {
        return values;
      }

      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      values[key] = rawValue.replace(/^['"]|['"]$/g, "");
      return values;
    }, {});
}

const env = { ...loadEnv(envPath), ...process.env };
const clientId = env.EBAY_CLIENT_ID;
const clientSecret = env.EBAY_CLIENT_SECRET;
const marketplaceId = env.EBAY_MARKETPLACE_ID || "EBAY_US";
const searchLimit = env.EBAY_SEARCH_LIMIT || "10";
const defaultQuery =
  "One Piece Card Game OP-05 Awakening of the New Era Booster Box Japanese sealed";
const query = process.argv.slice(2).join(" ") || defaultQuery;

function requireCredentials() {
  if (clientId && clientSecret) {
    return;
  }

  throw new Error(
    "Missing EBAY_CLIENT_ID or EBAY_CLIENT_SECRET. Copy .env.example to .env and fill the rotated Production keyset."
  );
}

async function getApplicationToken() {
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "client_credentials",
    scope: "https://api.ebay.com/oauth/api_scope",
  });

  const response = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay OAuth failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

async function searchActiveListings(accessToken) {
  const url = new URL("https://api.ebay.com/buy/browse/v1/item_summary/search");
  url.searchParams.set("q", query);
  url.searchParams.set("limit", searchLimit);
  url.searchParams.set("filter", "buyingOptions:{FIXED_PRICE}");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-EBAY-C-MARKETPLACE-ID": marketplaceId,
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`eBay Browse search failed (${response.status}): ${text.slice(0, 500)}`);
  }

  return response.json();
}

function summarizeItems(items) {
  return items.map((item) => ({
    title: item.title,
    price: item.price ? `${item.price.currency} ${item.price.value}` : null,
    condition: item.condition || null,
    buyingOptions: item.buyingOptions || [],
    url: item.itemWebUrl,
  }));
}

async function main() {
  requireCredentials();

  const token = await getApplicationToken();
  const result = await searchActiveListings(token.access_token);

  console.log(
    JSON.stringify(
      {
        query,
        marketplaceId,
        total: result.total,
        returned: result.itemSummaries?.length || 0,
        items: summarizeItems(result.itemSummaries || []),
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
