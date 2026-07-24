// TAG 카드별 등급분포 주간 적재 — tag-card-pop.js(브라우저) 덤프를 top10 카드에 매칭해 append-only 저장.
//
// 입력: { collectedAt, cards:[ {box:"OP-13", tagSet:"One Piece Carrying on His Will Japanese Alternate Art", num:"OP13-118", grades:{"9":4,"10":20,"10P":1,"Total":25}} ] }
// 출력: data/tag-card-pop.json — 카드·변형별 주간 점 [{d,total,g}]. CGC(cgc-card-pop)와 동일 구조.
//
// 변형(tier)은 TAG "세트 이름"에서 딴다(실측): "... Japanese" = base · "... Japanese Alternate Art" = alt
// · "... Japanese Manga Alternate Art" = super · "... Japanese SP" = sp · Box Topper/Wanted 등은 해당 tier.
// 우리 카드(ourTier)와 tier 가 정확히 1:1 일 때만 기록(같은 번호가 그 tier 덤프에 2행이면 스킵 — 오매칭 금지).
// Run: node tools/tag-card-pop-ingest.js <dump.json>
const fs = require("fs");
const path = require("path");
const { ourTier } = require("./cgc-card-pop-ingest");
const ROOT = path.join(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const histPath = path.join(ROOT, "data", "tag-card-pop.json");

function tagTier(tagSetName) {
  const s = String(tagSetName || "").toLowerCase();
  if (/red\s*(manga|super|alt)/.test(s)) return "red";
  if (/manga\s*alternate|manga\s*alt/.test(s)) return "super";
  if (/gold\s*stamped|signature/.test(s)) return "signature";
  if (/\bsp\b/.test(s)) {
    if (/gold/.test(s)) return "gold";
    if (/silver/.test(s)) return "silver";
    return "sp";
  }
  if (/wanted/.test(s)) return "wanted";
  if (/box\s*topper/.test(s)) return "boxtopper";
  if (/special\s*alternate/.test(s)) return "sp";     // TAG 는 SP 를 "Special Alternate Art" 로 표기(실측)
  if (/alternate\s*art|parallel/.test(s)) return "alt";
  return "base";
}

function ingest(dump) {
  const d = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("collectedAt 필요");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  let hist;
  try { hist = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { hist = { grader: "tag", sets: {} }; }
  hist.sets = hist.sets || {};

  // 덤프를 (box,num,tier) 로 그룹
  const byKey = new Map();
  for (const r of dump.cards || []) {
    const key = `${r.box}|${r.num}|${tagTier(r.tagSet)}`;
    (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }

  let appended = 0, skippedDate = 0, ambiguous = [];
  for (const [code, sset] of Object.entries(data.sets)) {
    for (const card of sset.cards || []) {
      const num = (card.number || "").replace(/^#/, "").toUpperCase();
      if (!num) continue;
      const tier = ourTier(card.name);
      let rows = byKey.get(`${code}|${num}|${tier}`) || [];
      if (!rows.length) continue;
      if (rows.length > 1) {
        // (tagSet, grades) 완전 동일 행은 이중 방문 중복 → 1개로 dedupe(합산하면 2배 계상, 리뷰 확정버그).
        const seenDup = new Set();
        rows = rows.filter((r) => { const k = r.tagSet + "|" + JSON.stringify(r.grades); if (seenDup.has(k)) return false; seenDup.add(k); return true; });
      }
      if (rows.length > 1) {
        // TAG 는 같은 세트를 연도 그룹 중복으로 나눠 담기도 한다(실측: OP13-118 Manga가 13+19 두 그룹).
        // 라벨이 전부 동일할 때만 합산(같은 변형의 분할 그룹). 라벨이 다르면 진짜 모호 → 스킵.
        const labels = new Set(rows.map((r) => r.tagSet));
        if (labels.size === 1) {
          const merged = {};
          for (const r of rows) for (const [k, v] of Object.entries(r.grades || {})) merged[k] = (merged[k] || 0) + (Number(v) || 0);
          rows = [{ tagSet: rows[0].tagSet, grades: merged }];
        } else { ambiguous.push(`${code} ${num} [${tier}] ${rows.length}행`); continue; }
      }
      const g = rows[0].grades || {};
      const total = Number(g["Total"]) || 0;
      if (!(total > 0)) continue;
      const key = `${num}|${tier}`;
      hist.sets[code] = hist.sets[code] || {};
      const arr = hist.sets[code][key] = hist.sets[code][key] || [];
      if (arr.some((p) => p.d === d)) { skippedDate++; continue; }
      const grades = {}; for (const [k, v] of Object.entries(g)) if (k !== "Total") grades[k] = v;
      arr.push({ d, total, label: rows[0].tagSet.slice(0, 80), g: grades });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
    }
  }
  // 빈/부분 덤프 보호(리뷰 확정버그): 아무것도 못 담았고 같은날짜 스킵도 없으면 = 수집 실패(페이지 구조 변화 등)
  // → 파일 안 건드리고 실패 종료. updated 가 조용히 전진해 "수집된 척" 하는 걸 막는다.
  if (appended === 0 && skippedDate === 0) {
    console.error(JSON.stringify({ error: "EMPTY_INGEST — 덤프에서 매칭 0건, 이력 파일 미변경(수집 실패 의심)" }));
    process.exitCode = 1;
    return { appended: 0, skippedDate: 0, ambiguous, error: "empty" };
  }
  hist.note = "Weekly TAG grade distribution for our tracked top-10 One Piece chase cards (Japanese printings), matched by card number + variant tier taken from the TAG set name. Each point stores cumulative counts per grade (1..10, 10P). Append-only; ambiguous matches are skipped rather than guessed.";
  hist.grader = "tag";
  hist.updated = appended > 0 ? d : hist.updated;
  fs.writeFileSync(histPath, JSON.stringify(hist) + "\n", "utf8");
  return { appended, skippedDate, ambiguous: ambiguous.slice(0, 10), cards: Object.values(hist.sets).reduce((a, s) => a + Object.keys(s).length, 0) };
}

module.exports = { ingest, tagTier };
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node tools/tag-card-pop-ingest.js <dump.json>"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")))));
}
