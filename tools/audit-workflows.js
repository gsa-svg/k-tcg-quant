#!/usr/bin/env node
// 워크플로 YAML 검사 — 2026-08-26 신설.
//
// 왜: update-market-data.yml 에 스텝 하나를 **7칸 들여쓰기**로 넣는 바람에(형제 스텝은 6칸)
// GitHub 이 파일 전체를 거부했다. 실행 기록에는 job 이 0개인 "failure" 만 남고,
// 워크플로 이름 자리에는 친절한 이름 대신 파일 경로가 찍힌다 — 사람이 보기 전엔 알 길이 없다.
// 그 결과 주간 시장데이터 갱신이 통째로 멈춰 있었다.
//
// 기존 감사는 전부 "데이터가 맞는가"만 봤다. **자동화가 살아 있는가**는 아무도 안 봤다.
// 여기서는 파서 없이(의존성 추가 없이) 실전에서 실제로 깨졌던 형태를 검사한다:
//   1) 탭 문자 — YAML 은 들여쓰기에 탭을 금지한다
//   2) 스텝 리스트의 들여쓰기가 파일 안에서 섞임 (위 사고의 정확한 형태)
//   3) 최상위 필수 키 존재 (name / on / jobs)
//   4) run: 블록 스칼라 안이 아닌 곳에서 이어지는 명령 (앵커가 밀린 흔적)
//   5) 세트별 경매 집계가 그 파일을 읽는 생성기보다 먼저 도는가 (2026-10-13 하루 지연 사고)
//   6) 공식 카드리스트 수집 → 카드 페이지 → 카드리스트 생성 순서 (2026-10-14, W7)
//   7) 무인 수집(daily.ps1)이 같은 빌드(tools/build.js)를 쓰는가
//   8) build.js 를 돌리는 워크플로의 커밋 범위가 빌드 산출물을 전부 담는가
// 2026-10-15: 생성 순서가 tools/build.js 한 곳으로 옮겨졌다. 워크플로의 `node tools/build.js` 는 그 STEPS 로,
//   `node tools/check.js` 는 그 CHECKS 로 펼쳐서 본다 — 순서 검사(5·6)는 종전과 같은 의미로 그대로 동작한다.
//
// Run: node tools/audit-workflows.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, ".github", "workflows");
const problems = [], notes = [];

// build.js / check.js 호출을 그 안의 단계 이름으로 펼친다(파일명 .js 붙여서). 플래그를 본다 — `check.js --pre` 는 테스트만 돈다.
const BUILD = require("./build"), CHECK = require("./check");
const has = (flags, f) => flags.includes(f);
function expandCall(name, flags) {
  if (name === "build.js") return BUILD.plan({ only: has(flags, "--only") ? flags[flags.indexOf("--only") + 1].split(",") : null, from: has(flags, "--from") ? flags[flags.indexOf("--from") + 1] : null }).map((s) => `${s}.js`);
  if (name === "check.js") return CHECK.plan({ pre: has(flags, "--pre"), gate: has(flags, "--gate"), fast: has(flags, "--fast") || has(flags, "--no-browser") }).map((c) => `${c.name}.js`);
  return [name];
}
// 주석이 아닌 줄의 `node tools/<x>.js [플래그…]` 를 차례로 — 플래그는 그 호출 뒤 다음 구분자(2>·|·&&·;)까지.
function callsOf(lines) {
  return lines.filter((l) => !/^\s*#/.test(l)).flatMap((l) => {
    const ms = [...l.matchAll(/node tools\/([\w-]+\.js)/g)];
    return ms.flatMap((m, i) => {
      const end = i + 1 < ms.length ? ms[i + 1].index : l.length;
      const flags = l.slice(m.index + m[0].length, end).split(/\s(?:2>|\||&&|;|>)/)[0].trim().split(/\s+/).filter(Boolean);
      return expandCall(m[1], flags);
    });
  });
}

// 5) 준비: data/set-auction-stats.json 을 읽는 도구 — 이름이 소스에 있거나, 그런 모듈을 require 하는 도구.
//    (generate-ai-extras.js 는 ai-data-extras.js 를 거쳐 읽는다.)
const AGG = "build-set-auction-stats.js", AGG_OUT = "set-auction-stats.json";
const TOOLS = path.join(ROOT, "tools");
const toolSrc = new Map(fs.existsSync(TOOLS)
  ? fs.readdirSync(TOOLS).filter((f) => f.endsWith(".js")).map((f) => [f, fs.readFileSync(path.join(TOOLS, f), "utf8")])
  : []);
const mentions = (f) => (toolSrc.get(f) || "").includes(AGG_OUT);
const SELF = new Set([AGG, path.basename(__filename), "build.js", "check.js"]);   // 펼쳐지는 둘은 이름만 적을 뿐 읽지 않는다
const aggReaders = new Set([...toolSrc.keys()].filter((f) => !SELF.has(f) && (mentions(f)
  || [...toolSrc.get(f).matchAll(/require\("\.\/([\w-]+?)(?:\.js)?"\)/g)].some((m) => mentions(`${m[1]}.js`)))));

if (!fs.existsSync(DIR)) {
  console.log(JSON.stringify({ audit: "NO_WORKFLOWS", problems: [], notes: ["워크플로 디렉터리 없음"] }));
  process.exit(0);
}

for (const file of fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f))) {
  const full = path.join(DIR, file);
  const text = fs.readFileSync(full, "utf8");
  const lines = text.split("\n");

  // 1) 탭
  lines.forEach((l, i) => { if (/^\t| \t/.test(l)) problems.push(`${file}:${i + 1} 들여쓰기에 탭 문자가 있다 — YAML 은 탭을 금지한다`); });

  // 2) 스텝 들여쓰기 혼재
  //    "- name:" 으로 시작하는 줄들의 선행 공백이 파일 안에서 여러 값이면 그중 소수파가 사고다.
  const stepIndents = new Map();
  lines.forEach((l, i) => {
    const m = l.match(/^( +)- name:/);
    if (!m) return;
    const n = m[1].length;
    if (!stepIndents.has(n)) stepIndents.set(n, []);
    stepIndents.get(n).push(i + 1);
  });
  if (stepIndents.size > 1) {
    const sorted = [...stepIndents.entries()].sort((a, b) => b[1].length - a[1].length);
    const [mainIndent] = sorted[0];
    for (const [n, at] of sorted.slice(1)) {
      problems.push(`${file}: 스텝 들여쓰기가 섞였다 — 다수는 ${mainIndent}칸인데 ${n}칸인 줄이 있다 (줄 ${at.join(", ")})`);
    }
  }

  // 3) 최상위 키
  for (const key of ["name:", "jobs:"]) {
    if (!lines.some((l) => l.startsWith(key))) problems.push(`${file}: 최상위 "${key}" 가 없다`);
  }
  if (!lines.some((l) => /^on:/.test(l) || /^true:/.test(l))) problems.push(`${file}: 최상위 "on:" 이 없다`);

  // 4) run: 뒤에 명령이 바로 붙는데(블록 스칼라가 아닌데) 다음 줄이 더 깊게 이어지는 경우
  lines.forEach((l, i) => {
    const m = l.match(/^( +)run: +(?![|>])\S/);
    if (!m) return;
    const next = lines[i + 1] || "";
    if (new RegExp(`^ {${m[1].length + 2},}\\S`).test(next) && !/^\s*[-#]/.test(next)) {
      problems.push(`${file}:${i + 1} run: 한 줄짜리인데 다음 줄이 이어진다 — 블록(|)으로 바꾸거나 한 줄로 합칠 것`);
    }
  });

  // 5) 집계를 돌리는 워크플로에서 k번째로 읽는 실행은 k번째 집계 뒤여야 한다(본 단계·rebase 후 재생성 두 묶음).
  //    집계를 안 돌리는 워크플로(update-market-data)는 커밋된 파일을 그대로 쓰므로 대상 아님.
  const calls = callsOf(lines);
  const aggAt = calls.flatMap((c, i) => (c === AGG ? [i] : []));
  if (aggAt.length) {
    const seen = new Map();
    calls.forEach((c, i) => {
      if (!aggReaders.has(c)) return;
      const k = seen.get(c) || 0;
      seen.set(c, k + 1);
      if (!(aggAt[k] < i)) problems.push(`${file}: ${c} 의 ${k + 1}번째 실행이 ${AGG} 보다 먼저다 — 화면이 하루 묵은 data/${AGG_OUT} 를 싣는다`);
    });
  }

  // 6) 공식 카드리스트(2026-10-14, W7) — 순서가 어긋나면 하루 늦은 페이지가 나간다.
  //    (a) 수집기(fetch-official-cardlist)를 돌리는 워크플로에서는 첫 수집이 첫 카드리스트 생성보다 먼저
  //    (b) 카드리스트 생성의 k번째 실행은 카드 페이지 생성(card-map.json)의 k번째 실행 뒤 — 본 단계·rebase 후 재생성 두 묶음 모두
  {
    const at = (name) => calls.flatMap((c, i) => (c === name ? [i] : []));
    const fetchAt = at("fetch-official-cardlist.js"), genAt = at("generate-card-list-pages.js"), cardsAt = at("generate-card-pages.js");
    if (fetchAt.length && genAt.length && !(fetchAt[0] < genAt[0])) problems.push(`${file}: fetch-official-cardlist.js 가 generate-card-list-pages.js 보다 늦다 — 공식 목록이 뜬 날 페이지가 하루 늦는다`);
    if (fetchAt.length && !genAt.length) problems.push(`${file}: fetch-official-cardlist.js 를 돌리는데 generate-card-list-pages.js 가 없다`);
    genAt.forEach((g, k) => { if (!(cardsAt[k] < g)) problems.push(`${file}: generate-card-list-pages.js 의 ${k + 1}번째 실행이 generate-card-pages.js 보다 먼저다 — 카드 페이지 링크(card-map.json)가 하루 묵는다`); });
  }

  // 8) build.js 를 돌리는 워크플로는 빌드가 쓰는 경로(build.js OUTPUTS)를 전부 커밋 범위에 둬야 한다 — 2026-10-15.
  //    빠지면 미스테이징 변경이 남아 "Tracked generated files remain unstaged" 로 멈추거나 푸시 경합 뒤 rebase 가 죽는다(가드 W1 과 같은 사고).
  //    가드 W1 은 워크플로에 이름이 적힌 도구의 소스만 보므로 build.js 안의 단계는 못 본다 — 그 몫을 여기서 한다.
  if (lines.some((l) => !/^\s*#/.test(l) && /node tools\/build\.js/.test(l))) {
    const addLine = (text.match(/^\s*git add ([^\n]+)/m) || [])[1];
    if (addLine) {
      const scope = addLine.trim().split(/\s+/);
      const missing = BUILD.OUTPUTS.filter((p) => !scope.includes(p));
      if (missing.length) problems.push(`${file}: 커밋 범위(git add)에 빌드 산출물 ${missing.length}개가 없다 — ${missing.join(", ")}`);
    }
  }

  notes.push(`${file}: 스텝 ${[...stepIndents.values()].reduce((a, b) => a + b.length, 0)}개`);
}

// 7) 무인 수집 파이프라인(저장소 밖 daily.ps1)도 같은 빌드·검사를 써야 한다 — 2026-10-14 QA, 2026-10-15 개정.
//    종전엔 daily.ps1 의 $GEN 목록과 워크플로 목록을 대조했다(카드리스트·ja·글 날짜 생성기가 빠져 가드 CL1·AD1 이 매일 막혔다).
//    이제 목록은 tools/build.js 하나다 — daily.ps1 이 build.js·check.js 를 부르는지만 본다.
//    저장소 밖 파일이고 소유자 관할이라 경고(notes)로만 알린다 — 수집을 막지 않는다. 파일이 없는 곳(클라우드)에서는 건너뛴다.
{
  const DAILY = process.env.OPBOX_DAILY_PS1 || path.join(ROOT, "..", "box-sold-cdp", "daily.ps1");
  if (fs.existsSync(DAILY)) {
    const ps = fs.readFileSync(DAILY, "utf8");
    if (!/node\s+tools[\\/]build\.js/.test(ps)) notes.push("경고: daily.ps1 이 tools/build.js 를 부르지 않는다 — 생성 순서가 두 곳이 된다(저장소 밖, 소유자 결정)");
    if (!/node\s+tools[\\/]check\.js/.test(ps)) notes.push("경고: daily.ps1 이 tools/check.js 를 부르지 않는다 — 검사 목록이 두 곳이 된다(저장소 밖, 소유자 결정)");
    if (/\$GEN\s*=\s*@\(/.test(ps)) notes.push("경고: daily.ps1 에 생성 목록($GEN)이 아직 있다 — tools/build.js 가 유일한 순서다");
  }
}

const out = { audit: problems.length ? "FAIL" : "WORKFLOWS_OK", checked: fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).length, problems, notes };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
process.exit(problems.length ? 1 : 0);
