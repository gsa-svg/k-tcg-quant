# PRB-01 and OP-13 visual repair - 2026-07-27

## Completed

- Rebuilt the PRB-01 top-ten from the TCG Quant reference supplied by the user.
- Self-hosted the verified official Japanese images under `img/jp/`.
- Corrected OP-13 rank 9 to `OP13-091` St Marcus Mars Parallel and rank 10 to `OP13-119` Portgas D. Ace Wanted Poster.
- Regenerated the affected static set pages and PSA ranking page.

## Accuracy rule used

The old PRB-01 entries mixed values, images, PSA data, and purchase links from
different card variants. The rebuilt entries intentionally contain only the
verified rank, card identity, official image, rarity, and TCG Quant reference
price. Do not copy NM, PSA10, eBay, or affiliate fields from another print,
parallel, manga, or set merely to fill an empty card.

The PRB-01 Zoro Gold DON card currently uses the site fallback image. Its
official card identifier/image suffix was not verified, so an incorrect card
image is intentionally not shown.

## Helper scripts

- `tools/selfhost-prb01-op13-official-images.js`: converts the verified official
  source files from `tmp-prb-op13-official/` to WebP.
- `tools/repair-prb01-op13-verified-cards.js`: applies the card identity repair.

Both scripts are scoped to this repair. Future market collection must match the
exact `number` plus image variant before attaching any price or buy link.

## Verification completed

`node tools/guard-invariants.js` passed after the repair and page generation.
