#!/usr/bin/env node
// 원장 → data/auction-sold.json 재집계. eBay 를 한 번도 부르지 않는다 — 2026-09-01 신설.
//
// 왜 필요한가: 분류 규칙(auction-classify.js)을 고치면 과거 기록도 새 규칙으로 다시 봐야 한다.
// 종전에는 그 경로가 settle-auctions.js 안에만 있어서, 규칙만 고치려 해도 eBay 호출량
// (하루 5,000건 한도)을 써야 했다. 원장이 원본이므로 파생은 언제든 공짜로 다시 만들 수 있어야 한다.
//
// 집계식은 auction-aggregate.js 한 곳에 있고 수집 경로와 공유한다 — 두 벌로 갈라지면 반드시 어긋난다.
// Run: node tools/reaggregate-auctions.js [--apply]
const fs = require("fs");
const path = require("path");
const { readRecent } = require("./auction-archive");
const { buildDaily } = require("./auction-aggregate");

const ROOT = path.join(__dirname, "..");
const soldPath = path.join(ROOT, "data", "auction-sold.json");
const KEEP_SALES_DAYS = 45;      // settle-auctions.js 와 같은 창
const KEEP_DAILY_DAYS = 400;

const apply = process.argv.includes("--apply");

const out = JSON.parse(fs.readFileSync(soldPath, "utf8"));
const before = JSON.parse(JSON.stringify(out.daily || []));
const window = readRecent(KEEP_SALES_DAYS);
const days = [...new Set(window.map((s) => s.d))];
const daily = buildDaily(window);

const now = Date.now();
const cutDaily = new Date(now - KEEP_DAILY_DAYS * 86400000).toISOString().slice(0, 10);
const priorDaily = (out.daily || []).filter((p) => p.d >= cutDaily && !days.includes(p.d));
out.daily = [...priorDaily, ...daily].sort((a, b) => a.d.localeCompare(b.d));
out.updated = new Date(now).toISOString();

// 무엇이 달라졌는지 유형별로 보여준다 — 조용히 바뀌면 확인할 수 없다.
const sum = (rows, k) => rows.reduce((t, r) => t + ((r.byKind && r.byKind[k] && r.byKind[k].n) || 0), 0);
const diff = {};
for (const k of ["box", "carton", "pack", "card"]) {
  const b = sum(before, k), a = sum(out.daily, k);
  if (b !== a) diff[k] = `${b} → ${a} (${a - b >= 0 ? "+" : ""}${a - b})`;
}

if (apply) fs.writeFileSync(soldPath, JSON.stringify(out) + "\n", "utf8");
console.log(JSON.stringify({
  apply,
  원장일수: days.length,
  집계일수: out.daily.length,
  유형별건수변화: Object.keys(diff).length ? diff : "변화 없음",
}, null, 1));
if (!apply) console.log("드라이런 — 반영하려면 --apply");
