#!/usr/bin/env node
// 등급 **귀속** 감사 — 2026-08-25 신설.
//
// 왜 따로 만드나: audit-grading-numbers.js 는 숫자(총량·증감)가 말이 되는지만 본다.
// 정작 우리를 반복해서 물어뜯은 사고는 숫자가 아니라 **귀속**이었다.
//   실측 오배정: 우리 "Buggy OP09-051 SP" 에 OP-09 목록의 051 = Boa Hancock(4,496장) 이 붙었다.
//                우리 "Monkey D. Luffy OP05-119 SP" 에 OP-11 목록의 119 = Sanji(1,346장) 가 붙었다.
// 그래서 "값이 그럴듯한가"가 아니라 "이 값이 정말 이 카드 것인가"를 따로 검사한다.
//
// 검사 대상은 **지금 화면에 붙어 있는 값**(packs.json 의 graderPop)과 그것이 온 원장 최신점이다.
// 원장은 점마다 출처 라벨을 같이 저장한다(PSA par · CGC variant · TAG label). 그 라벨로 역검증한다.
//   A) 값 일치   — 화면 숫자가 원장 최신점과 같은가
//   B) 변형 귀속 — 라벨에서 되읽은 tier 가 카드 이름에서 뽑은 tier 와 같은가
//   C) 판 귀속   — TAG 라벨의 Japanese 여부가 저장된 판과 같은가
//   D) 이름 귀속 — 원본 덤프를 주면 카드명까지 대조한다(PSA 덤프 한정)
//
// Run: node tools/audit-grade-attribution.js [--psa-dump <dump.json>] [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const { ourTier } = require("./cgc-card-pop-ingest.js");
const { PARALLEL, donRef } = require("./psa-card-pop-ingest.js");

const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const data = read("data/onepiece-packs.json");
const psa = read("data/psa-card-pop.json");
const cgc = read("data/cgc-card-pop.json");
const tag = read("data/tag-card-pop.json");

// 라벨 → tier. ingest 의 함수를 그대로 import 하지 않는다 —
// 같은 함수로 검사하면 그 함수가 틀렸을 때 같이 틀린다.
const cgcTierOf = (s0) => {
  const s = String(s0 || "").toLowerCase();
  if (/red\s*(manga|alt)/.test(s)) return "red";
  // CGC 는 서명본을 "… 1st Anniversary Art Signed" 로도 적는다(실측 2026-08-25).
  if (/stamped|signature|\bsigned\b/.test(s)) return "signature";
  if (/sp\s*ver|foil\s*parallel/.test(s)) return /gold/.test(s) ? "gold" : /silver/.test(s) ? "silver" : "sp";
  if (/manga\s*alt\.?\s*(art|parallel)|manga.*parallel/.test(s)) return "super";
  if (/box\s*topper/.test(s)) return "boxtopper";
  if (/wanted/.test(s)) return "wanted";
  if (/treasure\s*rare/.test(s)) return "tr";
  if (/alt\.?\s*art|parallel/.test(s)) return "alt";
  return "base";
};
const tagTierOf = (s0) => {
  const s = String(s0 || "").toLowerCase();
  if (/red\s*(manga|super|alt)/.test(s)) return "red";
  if (/manga\s*alternate|manga\s*alt/.test(s)) return "super";
  if (/gold\s*stamped|signature/.test(s)) return "signature";
  if (/\bsp\b/.test(s)) return /gold/.test(s) ? "gold" : /silver/.test(s) ? "silver" : "sp";
  if (/wanted/.test(s)) return "wanted";
  if (/box\s*topper/.test(s)) return "boxtopper";
  if (/treasure\s*rare/.test(s)) return "tr";
  // TAG 는 애니버서리 금/은을 "Special Alternate Art - Gold" 처럼 뒤에 붙인다(실측 2026-08-25).
  // 종전엔 전부 sp 로 떨어져 금/은 카드가 통째로 안 붙었다.
  if (/special\s*alternate/.test(s)) {
    if (/\bgold\b/.test(s)) return "gold";
    if (/\bsilver\b/.test(s)) return "silver";
    return "sp";
  }
  if (/alternate\s*art|parallel/.test(s)) return "alt";
  return "base";
};

// CGC 가 일본판에서 "Manga" 라는 말 없이 구분표식만 라벨로 쓴 줄 — 코드의 VARIANT_TIER_OVERRIDE 와 같아야 한다.
//   PRB-01|jp OP02-013 "(★ above SEC)" — 그 번호의 일본판 행이 이것 하나뿐이고, 영문판 같은 카드는
//   "Manga Alt. Art Parallel (★ above SEC)" 다. PRB-01 실물에도 SEC 위에 ★ 가 있다(2026-08-25 이미지 확인).
// ⚠️ 여기에 줄을 추가하려면 **등급사 간 규모가 맞는지** 먼저 보라. OP01-120 "(Borderless) Alt Art" 는
//    그 검사에서 걸려 제거됐다(자세한 사유는 cgc-card-pop-api-ingest.js 주석).
const CGC_LABEL_EXCEPTION = new Set([
  "PRB-01|OP02-013|super|(★ above SEC)",
]);

const nameKey = (s) => String(s || "").toLowerCase().replace(/[^a-z]/g, "");
const ALIAS = [["bonkurei", "bonclay"], ["bentham", "bonclay"], ["kouzuki", "kozuki"]];
function nameAgrees(a0, b0) {
  const a = nameKey(a0), b = nameKey(b0);
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  return ALIAS.some(([x, y]) => {
    const p = a.replace(x, y), q = b.replace(x, y);
    return p.includes(q) || q.includes(p);
  });
}

const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
const problems = [], notes = [];
const checked = { psa: 0, cgc: 0, tag: 0 };

// PSA 덤프를 주면 이름까지 본다(선택 — 덤프는 임시파일이라 늘 남아 있지는 않다).
const di = process.argv.indexOf("--psa-dump");
let psaDump = null;
if (di > -1 && process.argv[di + 1]) {
  try { psaDump = JSON.parse(fs.readFileSync(process.argv[di + 1], "utf8")); }
  catch { notes.push("PSA 덤프를 못 읽었다 — 이름 대조는 건너뛴다"); }
}
const bare = (s) => String(s || "").replace(/^[A-Z]+\d{2}-/, "").replace(/^0+(?=\d)/, "");

for (const [code, set] of Object.entries(data.sets)) {
  for (const card of set.cards || []) {
    const g = card.graderPop;
    if (!g) continue;
    const num = String(card.number || "").toUpperCase();
    const don = donRef(card.name);
    const tier = don ? "gold" : ourTier(card.name || "");
    const key = don ? don.key : `${num}|${tier}`;
    const where = `${code} ${card.name}`;

    // ── PSA : 원장은 카드 각인 세트 밑에 쌓인다 ──────────────────────────
    if (g.psa) {
      // 적재·주입과 같은 규칙: 담고 있는 박스 목록만 본다(각인 세트 폴백 없음).
      const pcode = code;
      for (const ed of ["jp", "en"]) {
        const shown = g.psa[ed];
        if (!shown) continue;
        checked.psa += 1;
        const p = last(psa.sets?.[pcode]?.[ed]?.[key]);
        if (!p) { problems.push(`PSA ${where} [${ed}] — 화면에 값이 있는데 원장 ${pcode}/${key} 에 점이 없다`); continue; }
        if (p.total !== shown.total || p.g10 !== shown.g10) {
          problems.push(`PSA ${where} [${ed}] — 화면 ${shown.total}/${shown.g10} vs 원장 ${p.total}/${p.g10}`);
        }
        if (don) {
          // DON 은 par 가 "<캐릭터>-Gold" 라 목록 대조가 아니라 캐릭터 대조다.
          const ch = String(p.par || "").replace(/-Gold$/i, "");
          if (!/-Gold$/i.test(String(p.par || "")) || !nameAgrees(don.char, ch)) {
            problems.push(`PSA ${where} [${ed}] — DON par "${p.par}" 가 캐릭터 "${don.char}" 와 안 맞는다`);
          }
        } else {
          const wants = PARALLEL[tier];
          if (!wants) problems.push(`PSA ${where} — tier "${tier}" 에 대응하는 par 목록이 없다`);
          else if (!wants.includes(p.par)) {
            problems.push(`PSA ${where} [${ed}] — par "${p.par}" 는 tier "${tier}"(허용: ${wants.join("/")}) 가 아니다`);
          }
        }
        if (psaDump && !don) {
          // 같은 par·같은 숫자에 여러 카드가 있을 수 있다(재수록 세트). 그래서 "첫 행"이 아니라
          // **이름이 맞는 행**을 찾고, 그 행의 수치가 우리가 저장한 값과 같은지 본다.
          // 이름이 맞는 행이 아예 없으면 남의 카드를 붙인 것이다.
          const rows = (psaDump.sets?.[`${pcode}|${ed}`] || [])
            .filter((r) => String(r.par) === String(p.par) && bare(r.num) === bare(num));
          if (rows.length) {
            const mine = rows.filter((r) => nameAgrees(card.name, r.name));
            if (!mine.length) {
              problems.push(`PSA ${where} [${ed}] — 덤프의 ${p.par}/${bare(num)} 행 중 이름이 맞는 게 없다 (있는 이름: ${rows.map((r) => r.name).join(", ")})`);
            } else if (!mine.some((r) => r.total === p.total)) {
              problems.push(`PSA ${where} [${ed}] — 저장값 ${p.total} 이 이름 맞는 행(${mine.map((r) => `${r.name}:${r.total}`).join(", ")})과 다르다`);
            }
          }
        }
      }
    }

    // ── CGC : 담고 있는 세트 밑, 판별 ────────────────────────────────────
    if (g.cgc) {
      for (const ed of ["jp", "en"]) {
        const shown = g.cgc[ed];
        if (!shown) continue;
        checked.cgc += 1;
        const p = last(cgc.sets?.[code]?.[ed]?.[key]);
        if (!p) { problems.push(`CGC ${where} [${ed}] — 화면에 값이 있는데 원장 ${code}/${key} 에 점이 없다`); continue; }
        if (p.total !== shown.total) problems.push(`CGC ${where} [${ed}] — 화면 총량 ${shown.total} vs 원장 ${p.total}`);
        // variant 는 여러 줄을 합쳤을 수 있다(" + " 로 이어 저장). 조각이 전부 같은 tier 여야 한다.
        for (const v of String(p.variant || "").split(" + ").filter(Boolean)) {
          if (v === "(빈칸)") continue;   // CGC 가 라벨을 안 준 줄 — base 로 본다
          if (CGC_LABEL_EXCEPTION.has(`${code}|${num}|${tier}|${v}`)) continue;
          // 수배서(Wanted Poster) ↔ CGC "SP Ver. (SP next to number)" — 2026-08-25 확인.
          // 근거는 변형 개수의 1:1 대응이다. OP-13 OP13-119 는 PSA·CGC 둘 다 5개이고
          // Red Manga 까지 이름이 겹치는데, 남는 한 자리가 PSA "Wanted Alternate Art" ↔ CGC "SP Ver." 다.
          // OP-03 ST01-012 는 양쪽 다 그 한 줄뿐이다. 적재기는 같은 번호에 우리 sp 카드가 따로 있으면
          // 이 매핑을 쓰지 않는다(둘이 같은 줄을 집어가므로).
          if (tier === "wanted" && /sp\s*ver/i.test(v)) continue;
          // DON!! 카드는 CGC 가 변형을 "Gold" 한 단어로만 적는다(캐릭터는 이름 칸에 있다).
          if (don && /^gold$/i.test(v)) continue;
          if (cgcTierOf(v) !== tier) {
            problems.push(`CGC ${where} [${ed}] — variant "${v}" 는 tier "${cgcTierOf(v)}" 인데 카드는 "${tier}"`);
          }
        }
      }
    }

    // ── TAG : 담고 있는 세트 밑, 판별 ────────────────────────────────────
    if (g.tag) {
      for (const ed of ["jp", "en"]) {
        const shown = g.tag[ed];
        if (!shown) continue;
        checked.tag += 1;
        const p = last(tag.sets?.[code]?.[ed]?.[key]);
        if (!p) { problems.push(`TAG ${where} [${ed}] — 화면에 값이 있는데 원장 ${code}/${key} 에 점이 없다`); continue; }
        if (p.total !== shown.total) problems.push(`TAG ${where} [${ed}] — 화면 총량 ${shown.total} vs 원장 ${p.total}`);
        const lbl = String(p.label || "");
        if (!lbl) { notes.push(`TAG ${where} [${ed}] — 라벨 없는 옛 기록(검증 불가)`); continue; }
        if (tagTierOf(lbl) !== tier) {
          problems.push(`TAG ${where} [${ed}] — 라벨 "${lbl}" 은 tier "${tagTierOf(lbl)}" 인데 카드는 "${tier}"`);
        }
        const lblEd = /japanese/i.test(lbl) ? "jp" : "en";
        if (lblEd !== ed) problems.push(`TAG ${where} — 라벨 "${lbl}" 은 ${lblEd} 인데 ${ed} 밑에 쌓였다`);
      }
    }
  }
}

const out = { audit: problems.length ? "FAIL" : "ATTRIBUTION_OK", checked, problems, notes: notes.slice(0, 20) };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
process.exit(problems.length ? 1 : 0);
