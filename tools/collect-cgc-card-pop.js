#!/usr/bin/env node
// 카드별 CGC 인구 수집 — 2026-08-10 정식화(지난 월요일엔 임시 스크립트로 돌렸다).
//
// CGC 공개 API(production.api.aws.ccg-ops.com)에서 우리 세트의 카드별 인구를 받아
// cgc-card-pop-api-ingest.js 가 먹는 덤프({num,name,variant,total,pristine,gem})를 만든다.
//
// ⚠️ 그룹 매칭 규칙 — 번호만 보면 안 된다(2026-08-10 실측):
//   일본판에는 구형 제품군 "(OP05) One Piece Booster Pack Vol.5" 가 현행 TCG 와 같은 OP 번호를 쓴다.
//   그래서 (1) 언어 일치 (2) 코드 일치("OP05"/"OP-05" 정규화) (3) 우리 세트 영문명 포함
//   순으로 좁히고, 하나로 안 떨어지면 **추측하지 않고 예외로 끊는다**.
//   그룹 목록 전수(11,137개)는 페이지네이션으로 받아 $TEMP 에 캐시한다(검색 파라미터가 전부 무시된다).
//
// Run: node tools/collect-cgc-card-pop.js <출력덤프.json> [--links <출력links.json>] [--refresh-groups]
//      → node tools/cgc-card-pop-api-ingest.js <덤프> [--links <links>]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const API = "https://production.api.aws.ccg-ops.com/api/cards/research/trading-cards";
// 그룹 목록 캐시는 반드시 저장소 **밖**에 둔다. TEMP 는 윈도우에만 있어서, 예전 폴백(|| ROOT)은
// 리눅스 러너에서 저장소 루트에 cgc-groups.json 을 떨어뜨렸다 — 추적 안 되는 파일이 남아
// 다음 rebase 를 깨뜨릴 자리였다(2026-08-12 자동화하며 발견).
const CACHE = path.join(process.env.RUNNER_TEMP || process.env.TEMP || require("node:os").tmpdir(), "cgc-groups.json");

const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const ORDER = [...packs.jp.list, ...packs.extra.list].filter((c) => (packs.sets[c]?.cards || []).length > 0);

const norm = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

async function pageAll(url) {
  const first = await (await fetch(`${url}Page=1`)).json();
  const items = [...(first.Items || [])];
  for (let p = 2; p <= (first.PageCount || 1); p += 1) {
    const j = await (await fetch(`${url}Page=${p}`)).json();
    items.push(...(j.Items || []));
  }
  return items;
}

async function groups(refresh) {
  if (!refresh && fs.existsSync(CACHE)) {
    const st = fs.statSync(CACHE);
    // 그룹 목록은 천천히 변한다 — 7일 넘은 캐시만 다시 받는다(전수 223페이지라 비싸다)
    if (Date.now() - st.mtimeMs < 7 * 86400000) return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  const all = await pageAll(`${API}/groups?PageSize=50&`);
  fs.writeFileSync(CACHE, JSON.stringify(all), "utf8");
  return all;
}

function pickGroup(all, code, ed, nameEn) {
  const lang = ed === "jp" ? "Japanese" : "English";
  const codeKey = norm(code);                       // "OP-05" -> "OP05"
  const byLang = all.filter((g) => g.collectibleLanguage?.languageName === lang);
  const byCode = byLang.filter((g) => norm(g.displayName).includes(codeKey));
  if (!byCode.length) return null;                  // 그 판본이 CGC 에 아직 없음 — 조용히 건너뜀(수집 0 은 가드가 본다)
  const byName = byCode.filter((g) => nameEn && norm(g.displayName).includes(norm(nameEn)));
  const pool = byName.length ? byName : byCode;
  if (pool.length !== 1) {
    throw new Error(`${code}|${ed}: 그룹 후보 ${pool.length}개 — 추측하지 않음: ${pool.map((g) => g.displayName).join(" / ")}`);
  }
  return pool[0];
}

async function main() {
  const outPath = process.argv[2];
  if (!outPath || outPath.startsWith("--")) throw new Error("사용법: <출력덤프.json> [--links <파일>] [--refresh-groups]");
  const li = process.argv.indexOf("--links");
  const linksPath = li > -1 ? process.argv[li + 1] : null;

  const all = await groups(process.argv.includes("--refresh-groups"));
  console.log(`그룹 전수 ${all.length}개 (캐시 ${CACHE})`);

  const dump = { grader: "cgc", collectedAt: new Date().toISOString().slice(0, 10), sets: {} };
  const links = {};
  let matched = 0, absent = 0;
  for (const code of ORDER) {
    const nameEn = packs.sets[code].nameEn || "";
    for (const ed of ["jp", "en"]) {
      const g = pickGroup(all, code, ed, nameEn);
      if (!g) { absent += 1; continue; }
      const rows = await pageAll(`${API}/population?researchGroupID=${g.researchGroupID}&PageSize=50&`);
      dump.sets[`${code}|${ed}`] = rows.map((r) => ({
        num: String(r.cardNumber || ""),
        name: String(r.name || ""),
        variant: String(r.variant || ""),
        total: Number(r.population_Total || 0),
        pristine: Number(r.population_Pristine10 || 0),
        gem: Number(r.population_GemMint10 || 0),
      }));
      links[`${code}|${ed}`] = `${API}/population?researchGroupID=${g.researchGroupID}`;
      matched += 1;
      console.log(`${code}|${ed}: ${rows.length}행 ← ${g.displayName}`);
    }
  }
  fs.writeFileSync(outPath, `${JSON.stringify(dump)}\n`, "utf8");
  if (linksPath) fs.writeFileSync(linksPath, `${JSON.stringify(links, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ status: "ok", matched, absent, out: outPath }));
}

main().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
