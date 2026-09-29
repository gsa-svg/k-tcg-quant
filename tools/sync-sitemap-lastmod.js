#!/usr/bin/env node
// sitemap.xml 의 lastmod 를 그 파일이 실제로 마지막으로 바뀐 날(git 커밋일)로 맞춘다.
//
// 왜: 생성기가 있는 페이지(ko/·sets/·cards/·auction 등)는 각자 lastmod 를 올리는데
//     `articles/*.html` 은 생성기가 없어 **아무도 갱신하지 않았다**. 2026-09-29 실측:
//       one-piece-set-list-release-dates  sitemap 09-14 / 실제 09-29
//       one-piece-booster-box-price-guide sitemap 07-06 / 실제 09-29  (약 3개월 차이)
//       how-many-packs-one-piece-booster-box sitemap 07-16 / 실제 09-29
//     구글은 lastmod 를 보고 재크롤 우선순위를 정하므로, 내용을 고쳐도 "안 바뀐 페이지"로 남는다.
//
// 규칙
//  · 날짜 출처는 git 의 마지막 커밋일(%cs). 파일 mtime 은 재생성만 해도 바뀌어 신뢰할 수 없다.
//  · **앞으로만 옮긴다.** 기존 lastmod 가 더 최신이면 건드리지 않는다(매일 다시 굽는 시세 페이지 보호).
//  · sitemap 에 URL 을 더하거나 빼지 않는다([[opbox-never-deindex]]).
"use strict";
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SM = path.join(ROOT, "sitemap.xml");
if (!fs.existsSync(SM)) { console.log(JSON.stringify({ status: "skip", reason: "sitemap 없음" })); process.exit(0); }

// loc → 저장소 안 파일 경로
function locToFile(loc) {
  let p = loc.replace(/^https?:\/\/[^/]+/, "");
  if (p === "" || p === "/") return "index.html";
  p = p.replace(/^\//, "");
  if (p.endsWith("/")) p += "index.html";
  if (!/\.[a-z0-9]+$/i.test(p)) p += ".html";
  return p;
}

// git 로그 한 번으로 파일 → 마지막 커밋일 지도를 만든다(파일마다 git 을 부르면 219번이다)
const gitDate = new Map();
try {
  const log = execSync("git log --name-only --format=%x00%cs --no-renames -- . ", { cwd: ROOT, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  let cur = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("\0")) { cur = line.slice(1).trim(); continue; }
    const f = line.trim();
    if (!f || !cur) continue;
    if (!gitDate.has(f)) gitDate.set(f, cur); // 로그는 최신순이라 첫 등장이 마지막 커밋일
  }
} catch (e) {
  console.log(JSON.stringify({ status: "skip", reason: "git 로그 실패: " + e.message.slice(0, 80) }));
  process.exit(0);
}

// 아직 커밋 안 된 변경분은 오늘 날짜로 본다(생성 사슬은 커밋 전에 돌기 때문에
// git 기록만 보면 lastmod 가 하루씩 늦는다).
const TODAY = new Date().toISOString().slice(0, 10);
try {
  const st = execSync("git status --porcelain -- .", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  for (const line of st.split("\n")) {
    const f = line.slice(3).trim().replace(/^"|"$/g, "");
    if (f && f.endsWith(".html")) gitDate.set(f, TODAY);
  }
} catch {}

let sm = fs.readFileSync(SM, "utf8");
const blocks = [...sm.matchAll(/<url>[\s\S]*?<\/url>/g)].map((m) => m[0]);
let raised = 0, same = 0, noGit = 0, added = 0;
const samples = [];

for (const block of blocks) {
  const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
  if (!loc) continue;
  const file = locToFile(loc);
  const g = gitDate.get(file);
  if (!g) { noGit++; continue; }
  const cur = (block.match(/<lastmod>(\d{4}-\d{2}-\d{2})/) || [])[1] || null;
  if (cur && cur >= g) { same++; continue; }

  const next = cur
    ? block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${g}</lastmod>`)
    : block.replace(/(<loc>[^<]*<\/loc>)/, `$1\n    <lastmod>${g}</lastmod>`);
  if (next === block) continue;
  sm = sm.replace(block, next);
  if (cur) raised++; else added++;
  if (samples.length < 6) samples.push(`${file} ${cur || "(없음)"} → ${g}`);
}

if (raised || added) fs.writeFileSync(SM, sm);
console.log(JSON.stringify({ status: "ok", urls: blocks.length, raised, added, unchanged: same, noGitRecord: noGit, samples }));
