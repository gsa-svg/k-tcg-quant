#!/usr/bin/env node
// 카드별 CGC 인구 적재(공개 API 판) — 2026-08-03.
//
// 예전 수집기(cgc-card-pop.js)는 세트 상세를 브라우저로 긁어 **일본판만** 담았다.
// CGC 공개 API 를 찾은 뒤로는 일본판·영문판 모두, 카드번호가 각인 그대로(OP07-118) 온다.
// 각인이 붙어 있어 번호 매칭이 PSA(번호만 옴)보다 안전하다.
//
// 입력: { grader:"cgc", collectedAt, sets:{ "OP-13|en":[{num,name,variant,total,pristine,gem}] } }
// 출력: data/cgc-card-pop.json — sets[코드][판][번호|tier] = [{d,total,g:{...}}] append-only.
//   ⚠️ 기존 파일은 판 구분이 없는 sets[코드][번호|tier] 였다. 처음 실행할 때 그 기록을 통째로
//   .jp 밑으로 옮긴다(값은 손대지 않는다 — 그때 담은 게 일본판이었다). 과거 점은 절대 버리지 않는다.
//
// 매칭(틀리지 않는 게 전부):
//   - 번호는 각인 포함 완전일치. 변형은 기존 cgcTier() 를 그대로 쓴다(가드 Q4 가 검증하는 규칙).
//   - 우리 tier 로 좁혀 **정확히 1개**일 때만 채택. 2개 이상이면 버리고 사람이 볼 수 있게 남긴다.
//     (영문판엔 오탈자 수정판 Post-Errata 가 따로 있어 같은 tier 로 2행이 되는 경우가 있다.)
// Run: node tools/cgc-card-pop-api-ingest.js <dump.json> [--report] [--links links.json]
const fs = require("node:fs");
const path = require("node:path");
const { ourTier, cgcTier } = require("./cgc-card-pop-ingest.js");

const ROOT = path.resolve(__dirname, "..");
const dataPath = path.join(ROOT, "data", "onepiece-packs.json");
const histPath = path.join(ROOT, "data", "cgc-card-pop.json");

function migrate(hist) {
  let moved = 0;
  for (const [code, bucket] of Object.entries(hist.sets || {})) {
    if (bucket && (bucket.jp || bucket.en) && !Object.keys(bucket).some((k) => k.includes("|"))) continue;
    const legacy = {};
    for (const [k, v] of Object.entries(bucket)) {
      if (k === "jp" || k === "en") continue;
      legacy[k] = v; delete bucket[k]; moved += 1;
    }
    if (Object.keys(legacy).length) bucket.jp = { ...legacy, ...(bucket.jp || {}) };
  }
  return moved;
}

function match(dump, data) {
  const accepted = [], ambiguous = [], absent = [];
  for (const [code, set] of Object.entries(data.sets)) {
    for (const card of set.cards || []) {
      const num = String(card.number || "").toUpperCase();
      if (!num) continue;
      const tier = ourTier(card.name || "");
      for (const ed of ["jp", "en"]) {
        const rows = dump.sets[`${code}|${ed}`];
        if (!Array.isArray(rows)) continue;
        const same = rows.filter((r) => String(r.num || "").toUpperCase() === num);
        if (!same.length) continue;
        const hits = same.filter((r) => cgcTier(r.variant) === tier);
        if (hits.length === 1) {
          const r = hits[0];
          if (!(Number.isInteger(r.total) && r.total > 0)) continue;
          const pristine = Number(r.pristine) || 0, gem = Number(r.gem) || 0;
          if (pristine + gem > r.total) continue;   // 만점이 총량을 넘으면 매칭이 어긋난 것
          accepted.push({ code, ed, num, tier, card: card.name, variant: r.variant, total: r.total, pristine, gem });
        } else if (hits.length === 0) absent.push(`${code}|${ed} ${num} [${tier}]`);
        else ambiguous.push({ code, ed, num, tier, card: card.name, options: hits.map((h) => `${h.variant || "(빈칸)"} · ${h.total}장`) });
      }
    }
  }
  return { accepted, ambiguous, absent };
}

function ingest(dump, res) {
  let hist;
  try { hist = JSON.parse(fs.readFileSync(histPath, "utf8")); } catch { hist = { grader: "cgc", sets: {} }; }
  hist.sets = hist.sets || {};
  const moved = migrate(hist);
  let appended = 0, skipped = 0;
  for (const a of res.accepted) {
    const bucket = (hist.sets[a.code] = hist.sets[a.code] || {});
    const byEd = (bucket[a.ed] = bucket[a.ed] || {});
    const arr = (byEd[`${a.num}|${a.tier}`] = byEd[`${a.num}|${a.tier}`] || []);
    if (arr.some((p) => p.d === dump.collectedAt)) { skipped += 1; continue; }
    arr.push({ d: dump.collectedAt, total: a.total, g: { "Pristine 10": a.pristine, "Gem Mint 10": a.gem }, variant: a.variant });
    arr.sort((x, y) => x.d.localeCompare(y.d));
    appended += 1;
  }
  hist.grader = "cgc";
  hist.updated = dump.collectedAt;
  hist.note = "Weekly CGC population for our tracked top-10 One Piece chase cards, per card and per printing variant, kept separately for Japanese and English. Source: CGC public population API. Matched by stamped card number + variant; recorded only when exactly one variant row matches. Japanese and English are never summed. Append-only.";
  fs.writeFileSync(histPath, `${JSON.stringify(hist)}\n`, "utf8");
  return { appended, skipped, migrated: moved };
}

module.exports = { match, ingest, migrate };
if (require.main === module) {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith("--"));
  if (!file) { console.error("usage: node tools/cgc-card-pop-api-ingest.js <dump.json> [--report] [--links links.json]"); process.exit(1); }
  const dump = JSON.parse(fs.readFileSync(file, "utf8"));
  const res = match(dump, JSON.parse(fs.readFileSync(dataPath, "utf8")));
  const summary = { accepted: res.accepted.length, jp: res.accepted.filter((a) => a.ed === "jp").length, en: res.accepted.filter((a) => a.ed === "en").length, ambiguous: res.ambiguous.length, absent: res.absent.length };
  if (args.includes("--report")) {
    const li = args.indexOf("--links");
    const links = li > -1 && args[li + 1] ? JSON.parse(fs.readFileSync(args[li + 1], "utf8")) : {};
    console.log(JSON.stringify({ summary, ambiguous: res.ambiguous.map((a) => ({ ...a, url: links[`${a.code}|${a.ed}`] || null })) }, null, 1));
  } else {
    console.log(JSON.stringify({ ...summary, ...ingest(dump, res) }));
  }
}
