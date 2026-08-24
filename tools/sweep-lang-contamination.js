#!/usr/bin/env node
// 원장 언어 오염 일회성 정리 — 2026-08-24.
//
// eBay Language 패싯은 판매자 신고값이라 영문판이 Japanese 로 신고되는 일이 잦다.
// 실측: 일본판 원장 917건 중 83건(9%)이 영문판 가격대에 있었고 OP-13 은 23/91(25%)였다.
// 42일 롤링 중앙값이 정상 무리에 안착해 있어 게시값 자체는 맞았지만, 오염이 커지면 중앙값이 뒤집힌다.
//
// 기준은 box-sold-ingest.js 의 lang-unverified-price-band 와 **같다**:
//   제목이 언어를 명시하지 않았고(신고값만 있음), 값이 상대 판본 대역(0.8배 이상)에 앉아 있고,
//   자기 판본 중앙값의 2배를 넘으면 → 신고값을 믿지 않는다.
// 판별 중앙값은 **제목이 언어를 명시한 기록만**으로 만든다(순환 방지).
//
// 원장은 append-only 다. 지우지 않고 excluded 로 옮기며 사유를 남긴다.
// Run: node tools/sweep-lang-contamination.js [--apply]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ledgerPath = path.join(ROOT, "data", "box-sold-ledger.json");
const APPLY = process.argv.includes("--apply");
const TODAY = new Date().toISOString().slice(0, 10);

function editionOf(title) {
  if (/english|\beng\b/i.test(title)) return "en";
  if (/japanese|japan\b/i.test(title)) return "jp";
  return null;
}
const med = (a) => {
  const x = [...a].sort((p, q) => p - q);
  const i = Math.floor(x.length / 2);
  return x.length % 2 ? x[i] : (x[i - 1] + x[i]) / 2;
};

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
ledger.excluded = ledger.excluded || [];

const hits = [];
for (const [code, eds] of Object.entries(ledger.sets)) {
  const band = {};
  for (const edKey of ["jp", "en"]) {
    const named = (eds[edKey] || []).filter((r) => editionOf(r.title || "") === edKey).map((r) => r.unit);
    if (named.length >= 5) band[edKey] = med(named);
  }
  if (!(band.jp && band.en)) continue;

  for (const edKey of ["jp", "en"]) {
    const mine = band[edKey], other = band[edKey === "jp" ? "en" : "jp"];
    if (!(other > mine * 2)) continue;   // 두 판본 가격이 비슷하면 판별 불가 — 건드리지 않는다
    const keep = [];
    for (const r of eds[edKey] || []) {
      const named = editionOf(r.title || "");
      if (!named && r.unit >= other * 0.8 && r.unit > mine * 2) {
        hits.push({ ...r, code, from: edKey, mine: Math.round(mine), other: Math.round(other) });
      } else keep.push(r);
    }
    if (APPLY) eds[edKey] = keep;
  }
}

if (APPLY) {
  for (const h of hits) {
    ledger.excluded.push({
      code: h.code, from: h.from, id: h.id, d: h.d, unit: h.unit, total: h.total, qty: h.qty,
      title: h.title, fmt: h.fmt, excludedAt: TODAY, reason: "lang-unverified-price-band",
    });
  }
  ledger.updated = TODAY;
  fs.writeFileSync(ledgerPath, `${JSON.stringify(ledger)}\n`, "utf8");
}

const bySet = {};
for (const h of hits) bySet[h.code] = (bySet[h.code] || 0) + 1;
console.log(JSON.stringify({ mode: APPLY ? "applied" : "dry-run", moved: hits.length, bySet }, null, 1));
if (!APPLY) hits.slice(0, 8).forEach((h) => console.log(`  ${h.code}|${h.from} $${Math.round(h.unit)} (자기 $${h.mine} / 상대 $${h.other})  ${String(h.title).slice(0, 56)}`));
