#!/usr/bin/env node
"use strict";
// 생성 순서의 유일한 출처 — 2026-10-15 신설. 커밋된 data/ 에서 화면·AI 파일 전부를 다시 굽는다.
//
// 왜: 같은 생성 목록이 세 곳(daily.ps1 $GEN · update-active-listings.yml · update-market-data.yml)에 따로 있었고 서로 달랐다 —
//   일일 워크플로에는 generate-psa-grading-page·inject-lang-toggle 이, 주간 워크플로에는 build-set-auction-stats·generate-tcg-auction-page 가,
//   daily.ps1 에는 build-set-auction-stats·inject-card-grades·build-grading-series 가 없었다. 규칙 하나를 바꾸면 세 목록을 손으로
//   맞춰야 했고(2026-10-14 CL1·AD1·SM1 가드 FAIL 이 그 결과), 집계가 생성기 뒤에 돌아 화면이 하루 묵은 값을 싣기도 했다(2026-10-13).
//   이제 순서는 아래 STEPS 하나다. 워크플로·daily.ps1 은 이 파일을 부르고, 검사는 tools/check.js 가 한 번에 한다(tools/BUILD.md).
// 규칙
//  · 네트워크 없음, 날짜 없음. 수집기(collect-*·update-ebay-*·fetch-*)와 "오늘" 기준 집계(build-set-auction-stats)는 여기 없다 —
//    커밋된 data/ 만으로 결정적이라 같은 입력이면 바이트까지 같은 출력이 나와야 한다(feed.xml 의 빌드 시각만 예외).
//    새 생성기는 STEPS 에 한 줄 넣고 이 파일을 돌려 확인한다.
//    2026-10-15 실측 단서: "오늘"(UTC 날짜)을 경과일·신선도 기준으로 읽는 단계가 아직 남아 있다(build-box-sold-series 창·build-grading-series
//    updated·build-market-index ageDays·generate-card-pages/ko/tcg-auction/upcoming/ja today·sync-article-dates·sync-sitemap-lastmod).
//    같은 UTC 날짜 안에서는 바이트 동일, 날이 바뀌면 경과일 표기가 달라질 수 있다 — 바이트 동일성 비교는 같은 날 안에서 한다.
//  · 한 단계가 실패하면 그 자리에서 멈춘다 — 그 단계의 출력(stderr 포함)을 그대로 보여주고 같은 종료코드로 끝난다.
//    반쪽 빌드를 가드에 넘기지 않는다. 단 OPTIONAL 에 있는 단계는 파일이 없으면 경고만 하고 건너뛴다.
//  · 모든 단계는 멱등이다. 두 번 돌려도 같은 파일이 나온다(daily.ps1 은 build-box-sold-series 를 적재 직후에도 한 번 더 돈다).
// Run: node tools/build.js [--dry] [--only a,b] [--from step] [--log-dir logs]
//   --dry       순서만 찍는다(실행 안 함). 없는 파일도 알려준다.
//   --only a,b  쉼표로 고른 단계만 — 순서는 STEPS 순(적은 순서가 아니다)
//   --from s    그 단계부터 끝까지(앞 단계가 이미 돌았을 때)
//   --log-dir d 단계별 전체 출력을 <d>/<step>.log 로 남긴다(워크플로 아티팩트). 없으면 실패한 단계 출력만 화면에 찍는다.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");

// 순서가 곧 의존 관계다. 옮길 때는 옆 주석의 이유를 먼저 읽는다.
const STEPS = [
  // ── 1. 원장 → 파생 데이터(data/*.json). 페이지 생성기가 전부 이것을 읽는다.
  "build-box-sold-series",      // 박스 sold 원장 → data/box-sold-series.json + packs 의 ebaySold 요약. 맨 앞 — 아래 전부가 읽는다
  "build-grading-series",       // PSA·CGC·TAG 원장 → data/grading-series.json(세트×등급사×주차). packs 는 세트 순서만 읽는다
  "inject-card-grades",         // 카드별 등급 원장 → packs 의 카드 등급. 들여쓰기로 저장하므로 compact-series 가 뒤따른다
  "compact-series",             // packs.json 압축(오래된 시계열 성기게 + 한 줄). packs 를 들여쓰기로 쓴 단계는 전부 이 앞에
  "build-site-facts",           // 사이트 사실값 한 곳(data/derived/site-facts.json — gitignore 캐시, 입력 해시가 다르면 load() 가 스스로 다시 굽는다) — compact 직후, 생성기 앞. 파일이 없으면 건너뛴다(OPTIONAL)
  // build-set-auction-stats 는 여기 없다 — 창 끝이 "오늘"이라(window.to = today) 날이 바뀌면 같은 원장에서 다른 파일이 나온다(결정적이지 않다).
  // 경매 원장을 매일 받는 update-active-listings 가 build 앞에서 돌린다(가드 audit-workflows 5번: 집계가 읽는 쪽보다 먼저).
  // 그 밖의 빌드는 커밋된 data/set-auction-stats.json(최대 하루 전)을 읽는다. 창 끝을 원장 마지막 날로 바꾸면 여기 넣을 수 있다.
  "build-market-index",         // packs.marketIndex(board·reprints) — 홈 요약표·ko·CSV 공급원. compact·site-facts 뒤, 생성기 앞
  // ── 2. 페이지 생성기. 각자 자기 파일을 통째로 쓴다(메뉴·언어 토글은 뒤의 주입기가 덮는다).
  "generate-image-variants",    // 파생 이미지 목록(data/image-variants.json) — 생성기들이 파생본 유무를 이걸로 안다. sharp 없으면 건너뜀
  "generate-card-pages",        // cards/ + cards/card-map.json
  "generate-card-list-pages",   // 세트별 공식 카드리스트(+csv·json) — card-map.json 다음(카드 페이지 링크)
  "generate-english-set-pages",
  "generate-set-pages",         // sets/ + psa10-ranking.html
  "generate-upcoming-set-pages",
  "generate-ko-pages",
  "generate-ko-topic-pages",    // 영문 amazon-lottery.html 을 읽어 ko 판을 만든다
  "generate-ja-pages",
  "generate-psa-grading-page",  // psa-grading.html — grading-series·image-variants 뒤
  "generate-auction-page",
  "generate-tcg-auction-page",
  "generate-free-data",         // free-data.html + opbox-*.csv — 카드리스트 json 을 읽으므로 그 뒤
  "generate-weekly",
  // ── 3. AI 파일(opbox-ai-*.json · llms*.txt). data/ 만 읽는다 — 페이지와 무관.
  "generate-ai-data",
  "generate-ai-extras",
  "generate-llms",              // opbox-ai-*.json 을 읽는다 — 위 둘 뒤
  // ── 4. 손으로 쓴 HTML 에 숫자를 꽂는 주입기. 각자 자기 마커 구간만 바꾼다(서로 순서 무관), 전부 생성기 뒤.
  "inject-home-summary",        // index/packs/box-prices 요약표 — card-map.json 뒤
  "prerender-home",             // 홈 첫 화면 선렌더(크롬) — 요약표 주입 뒤. 크롬 없으면 건너뜀
  "inject-set-list-prices",
  "inject-pack-math",
  "inject-box-price-guide",
  "inject-set-comparison",      // compare.html · best-one-piece-booster-box.html · 글 4개
  "inject-jp-en-6mo",
  "inject-jp-vs-en-buy",
  "inject-op05-op06",
  "inject-sea-prices",
  // ── 5. 마무리 — 모든 HTML 이 확정된 뒤.
  "sync-article-dates",         // 글 날짜는 여기 한 곳에서(주입기가 쓴 dateModified 를 본문이 바뀐 날로 되돌림) — 글 주입기 전부 뒤
  "inject-nav",                 // 메뉴(site-nav.js) — 생성기가 덮어쓰므로 반드시 뒤. 빠지면 가드 N1
  "inject-lang-toggle",         // 언어 토글 — 같은 이유
  "generate-feed",              // feed.xml · ko/feed.xml — 글 날짜 확정 뒤, 사이트맵 날짜 갱신 앞(세 곳 모두 이 순서였다)
  "sync-sitemap-lastmod",       // 사이트맵 lastmod 를 본문 해시로 — 맨 끝(가드 SM1). 앞에 두면 뒤 단계가 바꾼 본문을 놓친다
];
// 파일이 없어도 멈추지 않는 단계 — 다른 작업이 만드는 중이거나 선택 사항.
const OPTIONAL = new Set(["build-site-facts"]);

// 빌드가 쓰는 경로(2026-10-15 실측: 격리 사본에서 전체 빌드 뒤 mtime 으로 확인). 워크플로 커밋 범위(git add)가 이걸 전부
// 담아야 한다 — audit-workflows 8번이 대조한다. 빠지면 미스테이징 변경이 남아 푸시 경합 뒤 rebase 가 죽는다(가드 W1 과 같은 사고).
// 새 생성기가 새 경로를 쓰면 여기도 한 줄 — 그러면 두 워크플로의 커밋 범위에 그 경로를 더하라고 감사가 알린다.
// data/derived/site-facts.json 은 여기 없다 — .gitignore 된 캐시다(커밋하면 하루 1.5MB 씩 이력이 붓고, git add 가 무시 경로에 실패한다).
const OUTPUTS = [
  "data/onepiece-packs.json", "data/box-sold-series.json", "data/grading-series.json", "data/image-variants.json",
  "data/sitemap-lastmod-state.json",
  "cards/", "sets/", "ko/", "ja/", "articles/", "img/", "card-img/",
  "index.html", "packs.html", "box-prices.html", "auction.html", "tcg-auction.html", "compare.html", "free-data.html", "weekly.html",
  "psa-grading.html", "psa10-ranking.html", "about.html", "amazon-lottery.html", "changelog.html", "disclaimer.html", "methodology.html", "privacy.html",
  "feed.xml", "sitemap.xml", "llms.txt", "llms-full.txt",
  "opbox-ai-data.json", "opbox-ai-cards.json", "opbox-ai-grading.json", "opbox-ai-auctions.json",
  "opbox-set-prices.csv", "opbox-grading-population.csv", "opbox-auction-daily.csv",
];

function parseArgs(argv) {
  const o = { dry: false, only: null, from: null, logDir: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry") o.dry = true;
    else if (a === "--only") o.only = String(argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--from") o.from = argv[++i];
    else if (a === "--log-dir") o.logDir = argv[++i];
    else throw new Error(`모르는 인자 ${a} — node tools/build.js [--dry] [--only a,b] [--from step] [--log-dir d]`);
  }
  return o;
}

// 실행할 단계 — 항상 STEPS 순서.
function plan({ only = null, from = null } = {}) {
  let steps = STEPS.slice();
  if (from) {
    const i = steps.indexOf(from);
    if (i < 0) throw new Error(`--from ${from}: 그런 단계가 없다`);
    steps = steps.slice(i);
  }
  if (only) {
    const bad = only.filter((s) => !STEPS.includes(s));
    if (bad.length) throw new Error(`--only ${bad.join(",")}: 그런 단계가 없다`);
    steps = steps.filter((s) => only.includes(s));
  }
  return steps;
}

const toolFile = (name) => path.join(ROOT, "tools", `${name}.js`);
const sec = (ms) => `${(ms / 1000).toFixed(1)}s`.padStart(6);
// 한 줄 요약 — 도구가 찍은 JSON 이면 한 줄로 접고, 아니면 마지막 줄.
function summary(stdout) {
  const s = String(stdout || "").trim();
  try { return JSON.stringify(JSON.parse(s)); } catch {}
  return s.split("\n").filter(Boolean).at(-1) || "";
}

function runStep(name, logDir) {
  const file = toolFile(name);
  if (!fs.existsSync(file)) {
    if (OPTIONAL.has(name)) return { status: "skip", why: "tools/" + name + ".js 없음" };
    return { status: "fail", code: 1, ms: 0, out: `tools/${name}.js 가 없다 — STEPS 의 이름을 확인할 것` };
  }
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [file], { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const ms = Date.now() - t0;
  const out = `${r.stdout || ""}${r.stderr ? `\n[stderr]\n${r.stderr}` : ""}`;
  if (logDir) fs.writeFileSync(path.join(logDir, `${name}.log`), out);
  if (r.error) return { status: "fail", code: 1, ms, out: `${out}\n${r.error.message}` };
  if (r.status !== 0) return { status: "fail", code: r.status ?? 1, ms, out };
  return { status: "ok", ms, last: summary(r.stdout) };
}

function main() {
  const o = parseArgs(process.argv.slice(2).filter(Boolean));
  const steps = plan(o);
  if (o.dry) {
    let missing = 0;
    steps.forEach((s, i) => {
      const exists = fs.existsSync(toolFile(s));
      const note = exists ? "" : OPTIONAL.has(s) ? "  (없음 — 건너뜀)" : "  (없음!)";
      if (!exists && !OPTIONAL.has(s)) missing++;
      console.log(`${String(i + 1).padStart(2)}  ${s}${note}`);
    });
    console.log(`${steps.length} steps${missing ? ` — ${missing} missing` : ""}`);
    process.exit(missing ? 1 : 0);
  }
  if (o.logDir) fs.mkdirSync(path.resolve(ROOT, o.logDir), { recursive: true });
  const logDir = o.logDir ? path.resolve(ROOT, o.logDir) : null;
  const t0 = Date.now();
  let done = 0, skipped = 0;
  for (const name of steps) {
    const r = runStep(name, logDir);
    if (r.status === "skip") { skipped++; console.log(`skip  ${"".padStart(6)}  ${name}  — ${r.why}`); continue; }
    if (r.status === "fail") {
      console.log(`FAIL  ${sec(r.ms)}  ${name}  exit ${r.code}`);
      console.log(r.out.trim());
      if (process.env.GITHUB_ACTIONS) console.log(`::error::build: ${name} exit ${r.code}`);
      console.log(`build FAIL at ${name} (${done} ok, ${sec(Date.now() - t0).trim()})`);
      process.exit(r.code || 1);
    }
    done++;
    console.log(`ok    ${sec(r.ms)}  ${name}  ${r.last.slice(0, 110)}`);
  }
  console.log(`build OK  ${sec(Date.now() - t0).trim()}  ${done} steps${skipped ? ` (${skipped} skipped)` : ""}`);
}

module.exports = { STEPS, OPTIONAL, OUTPUTS, plan };
if (require.main === module) {
  try { main(); } catch (e) { console.error(e.message); process.exit(2); }
}
