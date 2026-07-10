# OP Box Index Automation

This project updates market data through GitHub Actions and local scripts.

## Daily Active Listing Refresh

Workflow: `.github/workflows/update-active-listings.yml`

Schedule:

- Every day at 03:00 KST
- UTC cron: `0 18 * * *`

Purpose:

- Refresh eBay Active booster box links.
- Refresh eBay Active PSA 10 links.
- Append a daily box price snapshot.
- Audit active listing quality.
- Upload logs and `data/active-listing-audit.json` as a workflow artifact.

Expected outputs:

- `data/onepiece-packs.json`
- `data/active-listing-audit.json`
- Workflow artifact: `active-listing-update-logs`

## Weekly Deep Market Refresh

Workflow: `.github/workflows/update-market-data.yml`

Schedule:

- Every Monday at 03:00 KST
- UTC cron: `0 18 * * 0`

Purpose:

- Refresh eBay pack prices.
- Refresh English NM references.
- Refresh Japanese NM sold references where possible.
- Append box history.
- Run price quality and active listing audits.
- Upload logs as a workflow artifact.

Expected outputs:

- `data/onepiece-packs.json`
- `data/price-quality-audit.json`
- `data/japanese-nm-sold-audit.json`
- `data/active-listing-audit.json`
- Workflow artifact: `market-data-update-logs`

## Required GitHub Secrets

These must exist in GitHub repository secrets:

```text
EBAY_CLIENT_ID
EBAY_CLIENT_SECRET
```

Do not commit these values to the repository.

## Local Manual Run

Use this sequence when a manual refresh is needed:

```powershell
node tools/update-ebay-pack-prices.js
node tools/update-ebay-psa10-active-links.js
node tools/update-box-series-history.js
node tools/audit-active-listings.js
```

For the deeper weekly flow:

```powershell
node tools/update-ebay-pack-prices.js
node tools/update-ebay-english-nm-prices.js
node tools/update-ebay-japanese-nm-sold-prices.js --continue-on-error
node tools/update-box-series-history.js
node tools/audit-price-quality.js --hide-suspicious-nm
node tools/audit-price-quality.js
node tools/audit-active-listings.js
```

## Quality Rules

The active listing audit fails when:

- A booster box best listing is missing.
- A booster box listing title fails the sealed Japanese booster box filter.
- A PSA 10 best listing title fails the Japanese PSA 10 card filter.
- A stored best listing URL is not an eBay item URL.
- Active market data is older than `ACTIVE_LISTING_MAX_FRESH_DAYS` days. Default: `3`.

Missing PSA 10 links are allowed when no reliable match exists. A blank field is safer than a wrong price.

## Weekly Threads Asset Generation

Workflow: `.github/workflows/generate-weekly-social-assets.yml`

Schedule:

- Every Monday at 03:40 KST
- UTC cron: `40 18 * * 0`

Purpose:

- Generate two 1080x1350 Threads-ready image cards.
- Generate English post copy for the weekly OP Box Index account update.
- Store weekly Japanese NM card-price snapshots so the next run can calculate real week-over-week movers.

Expected outputs:

- Workflow artifact: `weekly-threads-assets`
- `data/social-card-price-snapshots.json`

Local manual run:

```powershell
python tools/generate-weekly-threads-assets.py
```

Current limitation:

- This workflow generates the image and post text only. Auto-posting to Threads requires a Meta/Threads API token and app approval.
