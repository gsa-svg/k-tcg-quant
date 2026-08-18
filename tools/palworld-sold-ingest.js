#!/usr/bin/env node
// 팰월드 박스 sold 덤프 → data/palworld-sold-ledger.json (append-only) — 2026-08-17 신설.
//
// 원피스 원장(box-sold-ingest.js)과 같은 규칙을 따른다. 다른 점만 여기에 적는다:
//   · 1박스 = 12팩 (원피스 일반 24 / 프리미엄 20)
//   · 중국어판이 검색에 섞인다 — 간체/번체 표기와 "Chinese" 를 배제한다.
//     팰월드는 세계 동시 발매라 중국어판 물량이 실제로 eBay 에 돈다.
//   · "1st Edition" 표기가 존재한다. 초판/재판이 갈릴 수 있으므로 판정하지 않고 제목을 보존하고,
//     firstPrint 플래그만 붙여 둔다. 지금 나누기엔 표본이 없다 — 나중에 나눌 수 있게만 해 둔다.
//
// 원장은 append-only 다(never modified). 같은 id 는 다시 넣지 않는다.
// Run: node tools/palworld-sold-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");
const { parseLotQuantity, unitPrice } = require("./lot-quantity");

const ROOT = path.join(__dirname, "..");
const fxPath = path.join(ROOT, "data", "fx.json");
const ledgerPath = path.join(ROOT, "data", "palworld-sold-ledger.json");

const PACKS_PER_BOX = 12;
const BOOSTER = /booster\s*box/i;
const SINGLE_PACK = /\bbooster pack\b(?!s)/i;
// 중국어판·한국어판·기타 언어판 배제. 팰월드는 세계 동시 발매라 중국어 박스가 실제로 섞인다.
const BAD = /chinese|simplified|traditional|中文|简体|繁體|korean|한국|proxy|custom|empty|opened/i;
const FIRST_PRINT = /\b1st\s*edition\b|\bfirst\s*edition\b/i;

// 우리가 아는 팰월드 세트. 제목에 이 이름이 있어야 그 세트로 인정한다.
const SETS = [{ code: "BP-01", re: /dawn\s+of\s+palpagos|\bbp-?01\b/i }];

const soldDateOf = (s) => {
  const m = String(s || "").match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/);
  if (!m) return null;
  const M = { Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06", Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12" }[m[1]];
  return M ? `${m[3]}-${M}-${String(m[2]).padStart(2, "0")}` : null;
};

// 언어는 eBay 신고값(패싯)을 우선하되, 제목이 정반대로 말하면 버린다(판매자 오신고 방어).
function editionOfTitle(t) {
  if (/english|\beng\b/i.test(t)) return "en";
  if (/japanese|japan\b|日本語/i.test(t)) return "jp";
  return null;
}

function judge(item, fxUsdKrw, declaredEd) {
  const t = String(item.t || "");
  if (!BOOSTER.test(t)) return { drop: "not-booster-box" };
  if (SINGLE_PACK.test(t)) return { drop: "single-pack" };
  if (BAD.test(t)) return { drop: "bad-word" };
  const hit = SETS.filter((s) => s.re.test(t));
  if (hit.length !== 1) return { drop: hit.length ? "cross-set" : "code-missing" };
  const fromTitle = editionOfTitle(t);
  if (declaredEd && fromTitle && fromTitle !== declaredEd) return { drop: "lang-conflict" };
  const ed = declaredEd || fromTitle;
  if (!ed) return { drop: "no-language" };
  const qty = parseLotQuantity(t, "box", { perBox: PACKS_PER_BOX });
  if (qty == null) return { drop: "uncountable-lot" };
  const totalUsd = item.cur === "USD" ? item.k : item.cur === "KRW" ? item.k / fxUsdKrw : null;
  if (!Number.isFinite(totalUsd)) return { drop: "bad-currency" };
  const unit = unitPrice(totalUsd, qty);
  // 하한 20 / 상한 2000 — 정가 $36(¥5,280) 대비. 하한 아래는 낱팩·부속품, 상한 위는 케이스·오탈자다.
  if (unit == null || unit < 20 || unit > 2000) return { drop: "price-out-of-range" };
  const d = soldDateOf(item.d);
  if (!d) return { drop: "bad-date" };
  const rec = { id: String(item.id), d, unit: Number(unit.toFixed(2)), total: Number(totalUsd.toFixed(2)), qty, title: t.slice(0, 140) };
  if (item.cur === "KRW") { rec.krw = Math.round(item.k / qty); rec.fx = Number(fxUsdKrw.toFixed(2)); }
  if (FIRST_PRINT.test(t)) rec.firstPrint = true;
  return { rec, ed, code: hit[0].code };
}

function main(dumpFile) {
  const dump = JSON.parse(fs.readFileSync(dumpFile, "utf8"));
  const fx = JSON.parse(fs.readFileSync(fxPath, "utf8")).usdKrw;
  const today = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today || "")) throw new Error("dump.collectedAt 필요 (YYYY-MM-DD)");

  let ledger;
  try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch {
    ledger = {
      note: "팰월드 TCG 박스 즉시구매(BIN) 실거래 원장. append-only — 한 번 들어간 판매 기록은 never modified. 경매는 포함하지 않는다.",
      game: "palworld",
      packsPerBox: PACKS_PER_BOX,
      sets: {},
    };
  }

  const seen = new Set();
  for (const s of Object.values(ledger.sets)) for (const arr of Object.values(s)) if (Array.isArray(arr)) for (const r of arr) seen.add(r.id);

  const drops = {};
  let added = 0, dup = 0;
  for (const pg of dump.pages || []) {
    const declaredEd = pg.query === "jp" ? "jp" : pg.query === "en" ? "en" : null;
    for (const it of pg.items || []) {
      const j = judge(it, fx, declaredEd);
      if (j.drop) { drops[j.drop] = (drops[j.drop] || 0) + 1; continue; }
      if (seen.has(j.rec.id)) { dup++; continue; }
      seen.add(j.rec.id);
      const s = (ledger.sets[j.code] = ledger.sets[j.code] || { jp: [], en: [] });
      s[j.ed].push(j.rec);
      added++;
    }
  }
  for (const s of Object.values(ledger.sets)) for (const k of ["jp", "en"]) s[k].sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0));
  ledger.updated = today;

  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1) + "\n", "utf8");
  const counts = {};
  for (const [c, s] of Object.entries(ledger.sets)) counts[c] = { jp: s.jp.length, en: s.en.length };
  console.log(JSON.stringify({ added, dup, drops, total: counts, updated: today }));
}

if (require.main === module) main(process.argv[2]);
module.exports = { judge, SETS, PACKS_PER_BOX };
