// CGC 카드별 등급분포 주간 적재 — cgc-card-pop.js(브라우저) 덤프를 우리 top10 카드에 매칭해 append-only 저장.
//
// 입력: { collectedAt:"YYYY-MM-DD", sets:{ "OP-13":[ {num:"OP13-118", label:"Monkey D. Luffy (2025) Red Manga Alt. Art SEC", grades:{"Total":2,"Pristine 10":2}} ] } }
// 출력: data/cgc-card-pop.json — 카드·변형별 주간 점 [{d,total,g:{등급:수}}]. 같은 날짜 스킵(append-only).
//
// 변형 매칭(정확도 최우선 — 오매칭이면 안 담는다):
//   우리 이름                         ↔ CGC 라벨(실측 2026-07-24)
//   Red Manga / Red …                → "Red Manga Alt. Art" · "Red Alt. Art Parallel"
//   Super Alternate / Manga(단독)    → "Manga Alt. Art Parallel"
//   SP Gold / SP Silver / SP         → "SP Ver." (+ "Gold"/"Silver")
//   Parallel / Alternate Art         → "(…) Alt Art" (Map BG/Borderless 등)
//   Wanted Poster                    → "Wanted"
//   Gold Stamped Signature           → "Stamped"/"Signature"
//   같은 번호에서 해당 tier 의 CGC 행이 정확히 1개일 때만 기록, 아니면 skip+플래그.
// Run: node tools/cgc-card-pop-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const histPath = path.join(ROOT, "data", "cgc-card-pop.json");

// 우리 카드명 → 변형 tier. 순서 중요(리뷰 확정버그 2건 반영 2026-07-24):
//  - box topper 분기 없던 탓에 "Boa Hancock Box Topper"가 base 로 오염 → boxtopper 신설
//  - /silver/ 가 캐릭터명 "Silvers Rayleigh" 에 걸림 → \bsilver\b + super/manga 판정을 먼저
function ourTier(name) {
  const s = String(name || "").toLowerCase();
  if (/red\s*(manga|super|alt|parallel)/.test(s)) return "red";
  if (/stamped|signature/.test(s)) return "signature";
  if (/box\s*topper/.test(s)) return "boxtopper";
  if (/super\s*(alt|alternate|parallel)|\bmanga\b|comic/.test(s)) return "super";
  if (/\bgold\b/.test(s)) return "gold";
  if (/\bsilver\b/.test(s)) return "silver";
  if (/\bsp\b/.test(s)) return "sp";
  if (/wanted/.test(s)) return "wanted";
  if (/parallel|alternate|\balt\b/.test(s)) return "alt";
  return "base";
}
function cgcTier(label) {
  const s = String(label || "").toLowerCase();
  if (/red\s*(manga|alt)/.test(s)) return "red";
  if (/stamped|signature/.test(s)) return "signature";
  if (/sp\s*ver|foil\s*parallel/.test(s)) {           // EB-02 재록 SP 는 CGC 라벨이 "Foil Parallel"(실측)
    if (/gold/.test(s)) return "gold";
    if (/silver/.test(s)) return "silver";
    return "sp";
  }
  if (/manga\s*alt\.?\s*(art|parallel)|manga.*parallel/.test(s)) return "super";
  if (/box\s*topper/.test(s)) return "boxtopper";
  if (/wanted/.test(s)) return "wanted";
  if (/alt\.?\s*art|parallel/.test(s)) return "alt";  // "Alt. Art"(마침표 포함, 실측) 도 매칭
  return "base";
}

function ingest(dump) {
  const d = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("collectedAt 필요");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  let hist;
  try { hist = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { hist = { grader: "cgc", sets: {} }; }
  hist.sets = hist.sets || {};

  let appended = 0, skippedDate = 0, unmatched = [];
  for (const [code, sset] of Object.entries(data.sets)) {
    const rows = dump.sets?.[code] || [];
    if (!rows.length) continue;
    for (const card of sset.cards || []) {
      const num = (card.number || "").replace(/^#/, "").toUpperCase();
      if (!num) continue;
      const tier = ourTier(card.name);
      let cands = rows.filter((r) => r.num === num && cgcTier(r.label) === tier);
      // PRB 세트 한정 폴백: PRB 의 망가 재록은 CGC 라벨이 "(Borderless) Alt Art"(실측 2026-07-24) 라
      // super 후보가 없으면 alt 후보가 유일할 때 그걸 쓴다. PRB 는 다른 alt 변형이 없어 안전.
      if (!cands.length && code.startsWith("PRB") && tier === "super") {
        const alt = rows.filter((r) => r.num === num && cgcTier(r.label) === "alt");
        if (alt.length === 1) cands = alt;
      }
      if (cands.length !== 1) {
        if (rows.some((r) => r.num === num)) unmatched.push(`${code} ${num} [${tier}] 후보${cands.length}`);
        continue;
      }
      const g = cands[0].grades || {};
      const total = Number(g["Total"]) || 0;
      if (!(total > 0)) continue;
      const key = `${num}|${tier}`;
      hist.sets[code] = hist.sets[code] || {};
      const arr = hist.sets[code][key] = hist.sets[code][key] || [];
      if (arr.some((p) => p.d === d)) { skippedDate++; continue; }
      const grades = {}; for (const [k, v] of Object.entries(g)) if (k !== "Total") grades[k] = v;
      arr.push({ d, total, label: cands[0].label.slice(0, 80), g: grades });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
    }
  }
  // 빈/부분 덤프 보호(리뷰 확정버그): 매칭 0건 + 같은날짜 스킵 0건이면 수집 실패로 보고 파일 미변경·실패 종료.
  if (appended === 0 && skippedDate === 0) {
    console.error(JSON.stringify({ error: "EMPTY_INGEST — 덤프에서 매칭 0건, 이력 파일 미변경(수집 실패 의심)" }));
    process.exitCode = 1;
    return { appended: 0, skippedDate: 0, unmatched: unmatched.slice(0, 12), error: "empty" };
  }
  hist.note = "Weekly CGC grade distribution for our tracked top-10 One Piece chase cards (Japanese printings), matched by card number + variant tier from the public CGC population report. Each point stores the cumulative count per grade (Perfect 10 / Pristine 10 / Gem Mint 10 / 9.5 ...). Append-only; ambiguous variant matches are skipped rather than guessed.";
  hist.grader = "cgc";
  hist.updated = appended > 0 ? d : hist.updated;
  fs.writeFileSync(histPath, JSON.stringify(hist) + "\n", "utf8");
  return { appended, skippedDate, unmatched: unmatched.slice(0, 12), cards: Object.values(hist.sets).reduce((a, s) => a + Object.keys(s).length, 0) };
}

module.exports = { ingest, ourTier, cgcTier };
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node tools/cgc-card-pop-ingest.js <dump.json>"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")))));
}
