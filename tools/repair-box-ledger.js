// 원장 분류 교정 — 잘못 들어간 레코드를 **지우지 않고 옮긴다**.
//
// 원장은 append-only 다(과거 기록을 고치거나 지우지 않는다). 다만 그 원칙이 지키려는 것은
// "가격·날짜·거래 사실"이지 "우리가 붙인 분류"가 아니다. 판별 규칙이 틀렸던 게 나중에 드러나면
// 그 레코드를 남겨둔 채 올바른 칸으로 옮기는 게 맞다 — 안 옮기면 시세가 계속 틀린다.
//
// 2026-08-13 실사고: 판매자가 영문판을 Language=Japanese 로 신고했고 제목에 "English" 단어가
// 없어 그대로 일본판으로 적재됐다. White Bottom $1,458~$1,686, Blue Bottom $4,101 짜리가
// OP-01 "일본판" 시세에 들어가 5월 중앙값이 $1,437 로 찍혔다(실제 일본판은 $290 대).
// White/Blue Bottom 과 Wave 1/2 는 영문판에만 있는 물리적 특징이라 판매자 신고와 무관하게 판별된다.
//
// 하는 일:
//  1. 일본판 칸에 있는 영문판(EN_ONLY_TRAIT) → 영문판 칸으로 이동
//  2. 한국판(korean) → excluded 로 이동 (이 원장은 일본판/영문판만 다룬다)
//  3. 옮긴 내역은 ledger.repairs 에 날짜와 함께 남긴다 — 조용히 바꾸지 않는다
//
// 가격·날짜·id 는 절대 건드리지 않는다. 재실행해도 결과가 같다(이미 옮긴 건 다시 안 옮긴다).
// Run: node tools/repair-box-ledger.js [--dry]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ledgerPath = path.join(ROOT, "data", "box-sold-ledger.json");

const EN_ONLY_TRAIT = /\b(white|blue)\s*bottom\b|\bwave\s*[12]\b/i;
const KOREAN = /korean/i;

const dry = process.argv.includes("--dry");
const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

const moved = { toEn: [], toExcluded: [] };

for (const [code, eds] of Object.entries(ledger.sets || {})) {
  eds.jp = eds.jp || [];
  eds.en = eds.en || [];

  // 1. 일본판 칸의 영문판 → 영문판 칸.
  //    이미 영문판 칸에 같은 id 가 있으면 옮기지 않고 버린다(중복 방지) — 그런 경우는 없어야 정상이다.
  const enIds = new Set(eds.en.map((r) => r.id));
  const keepJp = [];
  for (const r of eds.jp) {
    if (KOREAN.test(r.title || "")) { moved.toExcluded.push({ code, from: "jp", ...r }); continue; }
    if (EN_ONLY_TRAIT.test(r.title || "")) {
      moved.toEn.push({ code, id: r.id, unit: r.unit, title: (r.title || "").slice(0, 70) });
      if (!enIds.has(r.id)) { eds.en.push(r); enIds.add(r.id); }
      continue;
    }
    keepJp.push(r);
  }
  eds.jp = keepJp;

  // 2. 영문판 칸의 한국판 → 제외
  eds.en = eds.en.filter((r) => {
    if (KOREAN.test(r.title || "")) { moved.toExcluded.push({ code, from: "en", ...r }); return false; }
    return true;
  });

  for (const ed of ["jp", "en"]) eds[ed].sort((a, b) => a.d.localeCompare(b.d) || a.id.localeCompare(b.id));
}

// 제외된 건은 버리지 않고 따로 보관한다 — 나중에 규칙이 또 바뀔 수 있고, 지운 건 되돌릴 수 없다.
if (moved.toExcluded.length) {
  ledger.excluded = ledger.excluded || [];
  const known = new Set(ledger.excluded.map((r) => r.id));
  for (const r of moved.toExcluded) if (!known.has(r.id)) { ledger.excluded.push({ ...r, excludedAt: today, reason: "korean-edition" }); known.add(r.id); }
}

if (moved.toEn.length || moved.toExcluded.length) {
  ledger.repairs = ledger.repairs || [];
  ledger.repairs.push({
    date: today,
    movedJpToEn: moved.toEn.length,
    excludedKorean: moved.toExcluded.length,
    reason: "Sellers had declared English-edition boxes as Japanese; White/Blue Bottom and Wave 1/2 are English-only physical traits. Korean-edition boxes do not belong in a ledger that tracks only the Japanese and English editions. Records were moved, never deleted.",
  });
  ledger.updated = ledger.updated || today;
}

const out = {
  movedJpToEn: moved.toEn.length,
  excludedKorean: moved.toExcluded.length,
  samples: moved.toEn.slice(0, 5),
  dryRun: dry,
};
if (!dry) fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 1) + "\n", "utf8");
console.log(JSON.stringify(out, null, 1));
