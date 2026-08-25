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
//   - 우리 tier 로 좁힌 뒤, 남은 줄이 여러 개면 **합산**한다(사유는 match() 안 주석 참고).
//     우리 카드 목록엔 같은 번호+변형이 둘 있는 경우가 없어서 합쳐도 다른 카드와 섞이지 않는다.
//   - tier 로 좁혀 한 줄도 안 남으면 그 카드는 값이 없는 것으로 둔다(비슷한 걸 갖다 붙이지 않는다).
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
  // CGC 가 판본에 따라 같은 물리 카드를 다른 이름으로 등록한 예외 — 2026-08-21.
  // PRB-01 만가 변형을 en 은 "Manga Alt. Art Parallel"(→super)로, jp 는 아래처럼 다르게 적는다.
  // 전역 규칙(cgcTier)을 바꾸면 다른 세트의 진짜 알트아트가 만가로 오인되므로, 근거가 있는
  // 세트|판|번호|변형 조합만 명시한다. 근거 없는 조합은 절대 추가하지 말 것 — absent 가 정직하다.
  //  · OP02-013 "(★ above SEC)": ★ above SEC 는 en 이 만가행에 붙이는 바로 그 인쇄 마크
  //    ("Manga Alt. Art Parallel (★ above SEC)"), PRB-01 판 실물 카드에도 SEC 위에 ★ 가 찍혀 있다.
  //    jp 에 다른 후보 행이 없다. 규모도 맞는다(PSA jp 80 ↔ CGC jp 4).
  //
  // ⚠️ OP01-120 "(Borderless) Alt Art" 는 **제거했다**(2026-08-25). 종전엔 super 로 강제했는데
  //    등급사 간 순서가 뒤집힌다: PSA 는 OP-01 원본 4,863 ≫ PRB-01 재수록 81 인데,
  //    CGC 는 OP-01 원본 47 < 이 행 77 이 된다. 다른 원본들의 PSA/CGC 비율은 103~122 로 일정한데
  //    이 조합만 1.1 이다. 라벨에 manga 라는 말도 없다(같은 번호의 다른 후보는 "(OPTCG Stamp bottom left)" 501).
  //    PRB-01 일본판 샹크스 망가는 CGC 에 별도 행이 없는 것으로 보고 비워 둔다.
  // OP05-119·OP05-074 도 앵커가 없어 넣지 않았다(리포트 absent 로 계속 보인다).
  const VARIANT_TIER_OVERRIDE = {
    "PRB-01|jp|OP02-013|(★ above SEC)": "super",
  };
  const rowTier = (code, ed, num, r) => VARIANT_TIER_OVERRIDE[`${code}|${ed}|${num}|${r.variant}`] || cgcTier(r.variant);

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
        const hits = same.filter((r) => rowTier(code, ed, num, r) === tier);
        if (hits.length === 0) { absent.push(`${code}|${ed} ${num} [${tier}]`); continue; }
        // 같은 번호·같은 변형인데 CGC 에 줄이 여러 개인 경우가 있다(2026-08-03 실측):
        //  · 영문판 오탈자 수정 재판이 따로 등록됨 — Post-Errata ("Up to"). 그림·번호·변형이 같은 같은 카드다.
        //  · 철자만 다른 중복 등록 — "Kouzuki Hiyori" vs "Kozuki Hiyori".
        //  · 라벨까지 똑같은 줄이 두 개 — CGC 쪽 중복 등록.
        //  · 같은 알트아트의 테두리 처리 차이 — (Borderless) vs (Map Text Box).
        // 우리 카드 한 장에 값 하나를 보여주므로 이것들을 **더한다**. 한 줄만 쓰면 나머지 장수가 사라진다.
        // 합쳐도 안전한 근거: 우리 카드 목록에는 같은 번호+변형이 둘 있는 경우가 없다(번호 없는 카드는 애초에 제외).
        // 몇 줄을 합쳤는지 rows 로 남겨 나중에 되짚을 수 있게 한다.
        const total = hits.reduce((a, r) => a + (Number(r.total) || 0), 0);
        const pristine = hits.reduce((a, r) => a + (Number(r.pristine) || 0), 0);
        const gem = hits.reduce((a, r) => a + (Number(r.gem) || 0), 0);
        if (!(total > 0) || pristine + gem > total) { ambiguous.push({ code, ed, num, tier, card: card.name, options: hits.map((h) => `${h.variant || "(빈칸)"} · ${h.total}장`) }); continue; }
        accepted.push({ code, ed, num, tier, card: card.name, variant: hits.map((h) => h.variant || "(빈칸)").join(" + "), rows: hits.length, total, pristine, gem });
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
    arr.push({ d: dump.collectedAt, total: a.total, g: { "Pristine 10": a.pristine, "Gem Mint 10": a.gem }, variant: a.variant, rows: a.rows });
    arr.sort((x, y) => x.d.localeCompare(y.d));
    appended += 1;
  }
  hist.grader = "cgc";
  hist.updated = dump.collectedAt;
  hist.note = "Weekly CGC population for our tracked top-10 One Piece chase cards, per card and per printing variant, kept separately for Japanese and English. Source: CGC public population API. Matched by stamped card number + variant. Where CGC lists the same card and variant on several rows — an English post-errata reprint, a spelling duplicate, or two border treatments of the same alt art — those rows are added together, because we show one figure per card; the number of rows combined is kept alongside each point. Japanese and English are never summed together, and neither are different graders. Append-only.";
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
    // absent 도 같이 낸다 — 2026-08-21. PRB-01 jp OP01-120 이 25일간 조용히 죽어 있는 걸
    // 아무도 못 봤다. 리포트에 안 나오는 실패는 없는 실패처럼 보인다.
    console.log(JSON.stringify({ summary, ambiguous: res.ambiguous.map((a) => ({ ...a, url: links[`${a.code}|${a.ed}`] || null })), absent: res.absent }, null, 1));
  } else {
    console.log(JSON.stringify({ ...summary, ...ingest(dump, res) }));
  }
}
