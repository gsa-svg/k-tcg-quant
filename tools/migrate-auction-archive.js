// 일회성 이전 — auction-sold.json 의 개별 기록을 일자별 아카이브로 옮긴다.
// 기록 자체는 하나도 버리지 않는다. 옮긴 뒤 원본과 건수·id 를 대조해 다르면 실패시킨다.
// Run: node tools/migrate-auction-archive.js
const fs = require("fs");
const path = require("path");
const { appendSales, readRecent, listDays, readDay } = require("./auction-archive");

const ROOT = path.join(__dirname, "..");
const soldPath = path.join(ROOT, "data", "auction-sold.json");

const src = JSON.parse(fs.readFileSync(soldPath, "utf8"));
const sales = src.sales || [];
if (!sales.length) { console.error("옮길 기록이 없다 — 중단"); process.exit(1); }

const added = appendSales(sales);

// 검증: 원본의 모든 id 가 아카이브에 있어야 한다.
const inArchive = new Set(listDays().flatMap((d) => readDay(d).map((s) => s.id)));
const missing = sales.filter((s) => !inArchive.has(s.id));
if (missing.length) {
  console.error(`이전 실패 — ${missing.length}건이 아카이브에 없다. 원본을 건드리지 않았다.`);
  process.exit(1);
}

console.log(JSON.stringify({
  source: sales.length,
  added,
  days: listDays().length,
  archived: inArchive.size,
  recent14: readRecent(14).length,
}));
