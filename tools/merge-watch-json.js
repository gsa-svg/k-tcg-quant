#!/usr/bin/env node
"use strict";
// 감시목록 JSON({ pending:[{id,...}], ... })의 git 3-way 병합 — 2026-09-10 신설.
//
// 왜: 검색(추가)과 정산(제거)이 같은 파일 data/auction-watch.json 을 다른 워크플로에서 고친다.
//     둘이 겹치면 뒤에 푸시하는 쪽의 `git pull --rebase` 가 내용 충돌로 죽고 그 회차 수집이 통째로 버려진다
//     (2026-09-04, 2026-09-10 00:17 UTC 실제). git 은 JSON 배열을 줄 단위로만 보기 때문이다.
// 규칙(집합 병합): 결과 = (upstream ∪ ours) − (base 에 있었는데 upstream 이 뺀 것) − (base 에 있었는데 ours 가 뺀 것).
//     즉 어느 한쪽이 새로 넣은 것은 살리고, 어느 한쪽이 뺀 것(정산 완료)은 빼는 것이다. id 가 같으면 upstream 항목을 쓴다.
//     pending 외의 필드(updated, note …)는 ours 것을 쓴다.
// 사용(리베이스 충돌 상태에서): node tools/merge-watch-json.js data/auction-watch.json
//   → git 의 :1(base) :2(upstream) :3(ours) 스테이지를 읽어 작업 파일에 쓴다. 그 뒤 git add + rebase --continue 는 호출 쪽 몫.
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");

const file = process.argv[2];
if (!file) { console.error("usage: node tools/merge-watch-json.js <path-in-conflict>"); process.exit(2); }

const stage = (n) => {
  try { return JSON.parse(execFileSync("git", ["show", `:${n}:${file}`], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })); }
  catch { return null; }
};
const base = stage(1), upstream = stage(2), ours = stage(3);
if (!upstream || !ours) { console.error(`${file}: 충돌 스테이지를 못 읽었다(base ${!!base}, upstream ${!!upstream}, ours ${!!ours})`); process.exit(1); }

const idOf = (p) => p && p.id;
const ids = (doc) => new Set(((doc && doc.pending) || []).map(idOf).filter(Boolean));
const baseIds = ids(base), upIds = ids(upstream), ourIds = ids(ours);
const removedByUpstream = new Set([...baseIds].filter((id) => !upIds.has(id)));
const removedByOurs = new Set([...baseIds].filter((id) => !ourIds.has(id)));

const merged = new Map();
for (const p of (ours.pending || [])) if (idOf(p)) merged.set(p.id, p);
for (const p of (upstream.pending || [])) if (idOf(p)) merged.set(p.id, p);   // 같은 id 는 upstream 우선
for (const id of [...removedByUpstream, ...removedByOurs]) merged.delete(id);

const out = { ...ours, pending: [...merged.values()] };
fs.writeFileSync(file, `${JSON.stringify(out)}\n`, "utf8");
console.log(JSON.stringify({ file, base: baseIds.size, upstream: upIds.size, ours: ourIds.size, merged: merged.size, removedByUpstream: removedByUpstream.size, removedByOurs: removedByOurs.size }));
