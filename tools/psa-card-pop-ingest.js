#!/usr/bin/env node
// 카드별 PSA 인구 적재 — 2026-08-03.
//
// 입력: GemRate 공개 페이지(item-details-advanced)의 RowData 덤프.
//   { grader:"psa", collectedAt, sets:{ "OP-13|jp":[{num,name,par,total,g10,g9,updated}] } }
//   set URL 은 추측하지 않는다 — 이미 검증된 gemrate-psa-history / gemrate-psa-en-totals 의 url 에서
//   경로만 item-details-advanced 로 바꿔 쓴다(세트명 규칙을 추측하다 OP-06·OP-02 에서 당한 적 있음).
// 출력: data/psa-card-pop.json — 카드·변형별 주간 점 [{d,total,g10,g9}] append-only. CGC/TAG 원장과 같은 구조.
//
// ⚠️ 이 파일의 존재 이유는 "매칭을 틀리지 않는 것" 하나다(소유자 지시). 그래서:
//   1) **세트 각인이 그 세트 것일 때만** 본다. OP-13 목록에 있는 OP09 각인 재록 카드는 건너뛴다 —
//      우리 카드 번호는 각인 기준이고 GemRate 행 번호는 접두어가 없어, 재록까지 끌어들이면 번호가 겹친다.
//   2) 번호가 같은 행이 여럿이면 **변형(parallel)까지 정확히 1개로 좁혀질 때만** 채택한다.
//      0개거나 2개 이상이면 버리고 사유를 남긴다(ambiguous). 지어내지 않는다.
//   3) 대응표에 없는 우리 tier 는 시도조차 하지 않는다(모르는 걸 아는 척하지 않는다).
//
// 대응표 — 왼쪽이 우리 tier(cgc-card-pop-ingest.ourTier), 오른쪽이 GemRate parallel 표기(실측 2026-08-03).
// 확신이 없는 tier(signature 등)는 일부러 비워 뒀다. 비면 그 카드는 그냥 PSA 값이 없는 것으로 남는다.
const PARALLEL = {
  base: ["Base"],
  alt: ["Alternate Art"],
  super: ["Manga Alternate Art"],
  red: ["Red Manga Alternate Art"],
  wanted: ["Wanted Alternate Art"],
  boxtopper: ["Box Topper"],
  sp: ["Special Alternate Art"],
};
// Run: node tools/psa-card-pop-ingest.js <dump.json> [--report]   (--report = 적재하지 않고 매칭 결과만 출력)
const fs = require("node:fs");
const path = require("node:path");
const { ourTier } = require("./cgc-card-pop-ingest.js");

const ROOT = path.resolve(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const histPath = path.join(ROOT, "data", "psa-card-pop.json");

const digits = (s) => (String(s || "").match(/(\d{1,4})\s*$/) || [, ""])[1].replace(/^0+(?=\d)/, "");
const codeNoDash = (c) => String(c || "").replace(/-/g, "").toUpperCase();

function match(dump, data) {
  const accepted = [], ambiguous = [], noRow = [], skippedReprint = [], noMapping = [];
  for (const [code, set] of Object.entries(data.sets)) {
    for (const card of set.cards || []) {
      const num = String(card.number || "").toUpperCase();
      if (!num) continue;
      const stamp = (num.match(/^([A-Z]+\d{2})/) || [, ""])[1];
      // ⚠️ 어느 세트 목록에서 찾을지는 **카드의 각인**이 정한다. 박스가 아니라.
      //    OP-13 top10 에 있는 OP09-004 는 OP-09 목록에서 찾아야 그 카드의 인구다.
      //    담고 있는 박스 목록에서 번호로 찾으면 남의 카드를 집는다(그게 변형 오배정의 전형적 경로다).
      //    각인 세트를 우리가 안 받아온 경우(ST 스타터덱 등)는 조용히 버린다.
      const lookIn = stamp ? `${stamp.slice(0, -2)}-${stamp.slice(-2)}` : code;
      const tier = ourTier(card.name || "");
      const wants = PARALLEL[tier];
      if (!wants) { noMapping.push(`${code} ${num} (${tier})`); continue; }

      let found = false;
      for (const ed of ["jp", "en"]) {
        const rows = dump.sets[`${lookIn}|${ed}`];
        if (!Array.isArray(rows)) continue;
        const sameNum = rows.filter((r) => digits(r.num) && digits(r.num) === digits(num));
        if (!sameNum.length) { noRow.push(`${lookIn}|${ed} ${num}`); continue; }
        const hits = sameNum.filter((r) => wants.includes(r.par));
        if (hits.length !== 1) {
          ambiguous.push({ key: `${lookIn}|${ed} ${num}`, card: card.name, tier, want: wants.join("/"), got: sameNum.map((r) => `${r.par}(${r.total})`) });
          continue;
        }
        const r = hits[0];
        if (!(Number.isInteger(r.total) && r.total > 0 && Number.isInteger(r.g10) && r.g10 <= r.total)) continue;
        found = true;
        // 원장 키는 **카드 각인 기준**(lookIn)으로 남긴다 — 같은 카드가 여러 박스 top10 에 있어도 한 곳에만 쌓인다.
        accepted.push({ code: lookIn, box: code, ed, num, tier, card: card.name, par: r.par, total: r.total, g10: r.g10, g9: r.g9, d: r.updated || dump.collectedAt });
      }
      if (!found && stamp && !dump.sets[`${lookIn}|jp`] && !dump.sets[`${lookIn}|en`]) skippedReprint.push(`${code} ${num} → ${lookIn} 미수집`);
    }
  }
  return { accepted, ambiguous, noRow, skippedReprint, noMapping };
}

function ingest(dump, res) {
  let store;
  try { store = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { store = { grader: "psa", sets: {} }; }
  store.sets = store.sets || {};
  let appended = 0, skipped = 0;
  for (const a of res.accepted) {
    const key = `${a.num}|${a.tier}`;
    const bucket = (store.sets[a.code] = store.sets[a.code] || {});
    const byEd = (bucket[a.ed] = bucket[a.ed] || {});
    const arr = (byEd[key] = byEd[key] || []);
    if (arr.some((p) => p.d === a.d)) { skipped += 1; continue; }
    arr.push({ d: a.d, total: a.total, g10: a.g10, g9: a.g9, par: a.par });
    arr.sort((x, y) => x.d.localeCompare(y.d));
    appended += 1;
  }
  store.grader = "psa";
  store.updated = dump.collectedAt;
  store.note = "Weekly PSA population for our tracked top-10 One Piece chase cards, per card and per printing variant, kept separately for Japanese and English. Source: GemRate public set pages. Matched by set stamp + card number + variant; a card is recorded only when exactly one variant row matches, never guessed. Japanese and English are never summed. Append-only.";
  fs.writeFileSync(histPath, `${JSON.stringify(store)}\n`, "utf8");
  return { appended, skipped };
}

module.exports = { match, ingest, PARALLEL };
if (require.main === module) {
  const file = process.argv.slice(2).find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node tools/psa-card-pop-ingest.js <dump.json> [--report]"); process.exit(1); }
  const dump = JSON.parse(fs.readFileSync(file, "utf8"));
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const res = match(dump, data);
  const summary = { accepted: res.accepted.length, ambiguous: res.ambiguous.length, noRow: res.noRow.length, skippedReprint: res.skippedReprint.length, noMapping: res.noMapping.length };
  if (process.argv.includes("--report")) {
    console.log(JSON.stringify({ summary, ambiguousSample: res.ambiguous.slice(0, 12), noMappingSample: res.noMapping.slice(0, 8), acceptedSample: res.accepted.slice(0, 6) }, null, 1));
  } else {
    console.log(JSON.stringify({ ...summary, ...ingest(dump, res) }));
  }
}
