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
  if (/treasure\s*rare/.test(s)) return "tr";         // TR 은 base 가 아니다(실측 오배정: OP-12 en OP10-063|base)
  // TAG 는 SP 를 "Special Alternate Art" 로 쓰고, 애니버서리 금/은은 그 뒤에 붙인다 —
  // 실측 세트명(2026-08-25): "… Special Alternate Art - Gold" · "… Japanese Special Alternate Art Gold".
  // 종전엔 여기서 전부 sp 로 떨어져 금/은 카드가 통째로 안 붙었다(OP-11·OP-12·OP-13·OP-14 6장).
  if (/special\s*alternate/.test(s)) {
    if (/\bgold\b/.test(s)) return "gold";
    if (/\bsilver\b/.test(s)) return "silver";
    return "sp";
  }
  if (/alternate\s*art|parallel/.test(s)) return "alt";
  return "base";
}

// 이름 대조 — PSA 적재기와 같은 규칙(표기차만 별칭 처리, 다른 인물은 절대 안 됨).
// TAG 는 전체번호(OP06-021)로 매칭해 구조적으로는 안전하지만, 등급사가 표기를 바꾸면
// 조용히 어긋난다. 이름이 있으면 반드시 확인한다 — 옛 기록엔 이름이 없어 그때만 통과시킨다.
const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const TAG_ALIAS = [["bonkurei", "bonclay"], ["bentham", "bonclay"], ["kouzuki", "kozuki"]];
function nameAgrees(ourName, rowName) {
  if (!rowName) return true;                 // TAG 가 이름을 안 준 옛 기록 — 확인 불가, 번호로만 간다
  const a = nameKey(ourName), b = nameKey(rowName);
  if (!a || !b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return TAG_ALIAS.some(([x, y]) => {
    const p = a.replace(x, y), q = b.replace(x, y);
    return p.includes(q) || q.includes(p);
  });
}

// DON!! 카드는 TAG 에서도 번호가 전부 "DON!!" 이라 번호로는 못 가른다. 캐릭터는 이름 칸에 있다.
// 우리 이름 "DON Card <캐릭터> Gold" 에서 캐릭터를 뽑아 대조한다.
const donCharOf = (cardName) => {
  const m = String(cardName || "").match(/^DON\s*Card\s+(.+?)\s+Gold$/i);
  return m ? m[1] : null;
};

function ingest(dump) {
  const d = dump.collectedAt;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d || "")) throw new Error("collectedAt 필요");
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  let hist;
  try { hist = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { hist = { grader: "tag", sets: {} }; }
  hist.sets = hist.sets || {};

  // ── 판(jp/en) 구분 — 2026-08-25.
  // 종전엔 일본판만 수집해서 판 구분이 없었다(/Japanese/ 로 링크를 걸렀다).
  // 영문판까지 받자 같은 (box,num,tier) 에 두 판이 겹쳐 라벨이 갈렸고, ingest 가 그걸
  // "진짜 모호"로 보고 296건을 통째로 스킵했다. 판을 나누면 둘 다 정직하게 담긴다.
  // TAG 세트명은 일본판에만 "Japanese" 가 붙는다(실측: "... Japanese Alternate Art" vs "... Alternate Art").
  const edOf = (tagSet) => (/japanese/i.test(String(tagSet || "")) ? "jp" : "en");

  // 기존 기록은 전부 일본판이다(그때 일본판만 긁었다) — jp 밑으로 옮긴다. 값은 손대지 않는다.
  let migrated = 0;
  for (const [code, bucket] of Object.entries(hist.sets)) {
    if (!bucket || bucket.jp || bucket.en) continue;          // 이미 옮겼음
    const legacy = {};
    for (const [k, v] of Object.entries(bucket)) {
      if (k === "jp" || k === "en") continue;
      legacy[k] = v; delete bucket[k]; migrated += 1;
    }
    if (Object.keys(legacy).length) bucket.jp = legacy;
  }

  // 덤프를 (box,num,tier,ed) 로 그룹
  const byKey = new Map();
  for (const r of dump.cards || []) {
    const key = `${r.box}|${r.num}|${tagTier(r.tagSet)}|${edOf(r.tagSet)}`;
    (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }

  let appended = 0, skippedDate = 0, ambiguous = [];
  for (const [code, sset] of Object.entries(data.sets)) {
    for (const card of sset.cards || []) {
      const donChar = donCharOf(card.name);
      const num = donChar ? "DON!!" : (card.number || "").replace(/^#/, "").toUpperCase();
      if (!num) continue;
      const tier = donChar ? "gold" : ourTier(card.name);
      const ledgerKey = donChar ? `DON-${nameKey(donChar)}|gold` : null;
      for (const ed of ["jp", "en"]) {
      let rows = byKey.get(`${code}|${num}|${tier}|${ed}`) || [];
      // 이름이 안 맞는 행은 버린다. DON 은 캐릭터가 이름 칸에 있으므로 같은 방식으로 걸러진다.
      // (DON 은 번호가 전부 "DON!!" 이라 이 대조가 유일한 구분 수단이다.)
      rows = rows.filter((r) => nameAgrees(donChar || card.name, r.name));
      if (donChar) rows = rows.filter((r) => r.name);   // 이름 없는 옛 DON 기록은 캐릭터를 알 수 없다
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
      // DON 은 번호가 전부 "DON!!" 이라 번호로 키를 만들면 캐릭터끼리 한 칸에서 부딪힌다.
      // 화면(inject-card-grades)이 쓰는 DON 키와 같은 형식으로 맞춘다: DON-<캐릭터>|gold
      const key = ledgerKey || `${num}|${tier}`;
      hist.sets[code] = hist.sets[code] || {};
      hist.sets[code][ed] = hist.sets[code][ed] || {};
      const arr = hist.sets[code][ed][key] = hist.sets[code][ed][key] || [];
      if (arr.some((p) => p.d === d)) { skippedDate++; continue; }
      const grades = {}; for (const [k, v] of Object.entries(g)) if (k !== "Total") grades[k] = v;
      arr.push({ d, total, label: rows[0].tagSet.slice(0, 80), g: grades });
      arr.sort((a, b) => a.d.localeCompare(b.d));
      appended++;
      }
    }
  }
  // 빈/부분 덤프 보호(리뷰 확정버그): 아무것도 못 담았고 같은날짜 스킵도 없으면 = 수집 실패(페이지 구조 변화 등)
  // → 파일 안 건드리고 실패 종료. updated 가 조용히 전진해 "수집된 척" 하는 걸 막는다.
  if (appended === 0 && skippedDate === 0) {
    console.error(JSON.stringify({ error: "EMPTY_INGEST — 덤프에서 매칭 0건, 이력 파일 미변경(수집 실패 의심)" }));
    process.exitCode = 1;
    return { appended: 0, skippedDate: 0, ambiguous, error: "empty" };
  }
  hist.note = "Weekly TAG grade distribution for our tracked top-10 One Piece chase cards, kept separate for the Japanese and English printings. Matched by card number + variant tier taken from the TAG set name; the printing comes from whether that name carries 'Japanese'. Each point stores cumulative counts per grade (1..10, 10P). Append-only; ambiguous matches are skipped rather than guessed. Records collected before 2026-08-25 were Japanese-only and live under .jp.";
  hist.grader = "tag";
  hist.updated = appended > 0 ? d : hist.updated;
  fs.writeFileSync(histPath, JSON.stringify(hist) + "\n", "utf8");
  return { appended, skippedDate, ambiguous: ambiguous.slice(0, 10), cards: Object.values(hist.sets).reduce((a, b) => a + Object.keys(b.jp || {}).length + Object.keys(b.en || {}).length, 0), migrated };
}

module.exports = { ingest, tagTier };
if (require.main === module) {
  const f = process.argv[2];
  if (!f) { console.error("usage: node tools/tag-card-pop-ingest.js <dump.json>"); process.exit(1); }
  console.log(JSON.stringify(ingest(JSON.parse(fs.readFileSync(f, "utf8")))));
}
