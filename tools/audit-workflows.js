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
//
// Run: node tools/audit-workflows.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DIR = path.join(ROOT, ".github", "workflows");
const problems = [], notes = [];

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

  notes.push(`${file}: 스텝 ${[...stepIndents.values()].reduce((a, b) => a + b.length, 0)}개`);
}

const out = { audit: problems.length ? "FAIL" : "WORKFLOWS_OK", checked: fs.readdirSync(DIR).filter((f) => /\.ya?ml$/.test(f)).length, problems, notes };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
process.exit(problems.length ? 1 : 0);
