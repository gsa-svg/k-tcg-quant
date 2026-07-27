#!/usr/bin/env node
// 주간 PSA 이력 게시 범위를 2025-12-03 이후로 자른다 — 2026-07-27 소유자 지시.
//
// 왜: 오늘 소급으로 2025-02까지 만들었지만, 남의 집계를 통째로 복제해 재게시하는 모양이 된다.
// 우리가 직접 주차별로 쌓기 시작한 구간만 남기고 그 앞은 버린다. 우리 저장소도 공개라
// "안 보여주기"로는 부족하고 파일에서 실제로 지운다.
//
// append-only 계약과 충돌하지 않는 이유: 지우는 구간은 매주 관측해 쌓은 값이 아니라
// 오늘 한 번에 역산해 만든 파생값이다. 주차별로 실제 축적해온 2026-06-03 이후는 그대로 둔다.
// Run: node tools/trim-gemrate-history.js [--from YYYY-MM-DD] [--dry]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE = path.join(ROOT, "data", "gemrate-psa-history.json");
const argOf = (f) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : null; };
const FROM = argOf("--from") || "2025-12-03";

const source = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
let dropped = 0, kept = 0;
for (const set of Object.values(source.sets)) {
  const before = (set.weekly || []).length;
  set.weekly = (set.weekly || []).filter((p) => p.d >= FROM);
  dropped += before - set.weekly.length;
  kept += set.weekly.length;
}
for (const [code, list] of Object.entries(source.corrections || {})) {
  source.corrections[code] = list.filter((c) => c.date >= FROM);
  if (!source.corrections[code].length) delete source.corrections[code];
}
source.retainedWeeklyDates = (source.retainedWeeklyDates || []).filter((d) => d >= FROM);
source.historyStart = FROM;
source.publishedFrom = FROM;
source.note = "Append-only verified Wednesday-to-Wednesday GemRate full-set PSA deltas. Retained dates must never be deleted. Declared upstream corrections remain visible as gaps instead of estimated values. "
  + `Weekly history is published from ${FROM} only; earlier weeks are intentionally not republished.`;
delete source.backfilledAt;

if (!process.argv.includes("--dry")) fs.writeFileSync(SOURCE, `${JSON.stringify(source, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ from: FROM, dropped, kept, weeks: source.retainedWeeklyDates.length }));
