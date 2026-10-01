#!/usr/bin/env node
// 박스 sold 원장 판매일 이관 — 전 행 d 를 +1일. 2026-10-01, 1회성(멱등).
//
// 무엇이 잘못돼 있었나:
//   box-sold-ingest.js 의 soldDateOf 가 2026-07-22 신설 때부터 eBay 표시일 "Sold  Sep 29, 2026" 을
//   Date.parse(실행 머신 로컬 자정 = KST 00:00) → toISOString(UTC = 전날 15:00) 으로 바꿔 **하루 이른 날짜**(9/28)를 적었다.
//   실행은 늘 이 PC(KST)였고 파서는 한 번도 바뀌지 않았으므로 전 기간 단일 동작이다.
//   검증(2026-09-30): 9/30 덤프 255,760건 전부 -1일·같은 날 0건. 원장 5,890행 중 덤프로 확인된 3,349행 전부 -1,
//   예외(표시일 = d 인 행) 0. 창 밖 행도 git 전 커밋에서 (id|d) 최초 등장일 - d 가 0일인 행이 0건(팰월드는 83건)이고
//   seen(수집일) 있는 3,390행 전부 d+1 ≤ seen. 그래서 전 행 +1일.
//   eBay 가 보여주는 날짜는 브라우저 로컬(KST) 기준 날짜라 그 글자가 곧 판매일이다.
//
// 원장은 append-only 지만 이번 건은 소유자가 "판매일 전체 이관"을 직접 지시했다 — d 만 고친다.
//   · 대상: sets 전 행 + excluded(같은 파서가 적은 값이라 같이 옮긴다).
//   · 건드리지 않는 것: lastAppended.d(수집일)·collectedDays·seen·repairs[].date·fxRestored.on — 수집일이지 판매일이 아니다.
//   · 다른 필드·행 수·행 순서 불변 — 실행 전후 d 를 뺀 전 행 해시를 직접 비교하고, 다르면 쓰지 않는다.
//   · +1 한 날짜가 그 행의 seen(수집일)이나 원장 updated(마지막 수집일)를 넘거나 id|d 가 겹치면 쓰지 않는다 — 추정으로 고치지 않는다.
//   · 멱등: 원장 최상위에 dateBasis:"ebay-display-date" 와 migratedAt 를 적고, 이미 있으면 아무것도 하지 않는다.
//     가드 D15 가 이 마커를 요구한다 — 중복 키가 id|판매일이라 이관 안 된 원장에 새 파서가 돌면 지난 판매가 전부
//     새 키로 다시 들어온다(이중 적재). 그래서 파서 수정과 이 이관은 한 커밋이다.
//
// 팰월드(palworld-sold-ingest.js)는 처음부터 월/일/연을 글자로 조립해 결함이 없다 — 이관 대상이 아니다
// (같은 검증: 덤프 대조 same 1,109 / minusOne 4 — 그 4건은 연일 재판매라 eBay 가 최근 판매일만 보여준 것).
//
// Run: node tools/migrate-box-sold-dates-20261001.js
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const ledgerPath = path.join(ROOT, "data", "box-sold-ledger.json");
const BASIS = "ebay-display-date";
const DAY = 86400000;
// Date.parse("YYYY-MM-DD") 는 UTC 자정으로 읽히고 toISOString 도 UTC 라 실행 머신 TZ 와 무관하다.
const plusOne = (d) => new Date(Date.parse(d) + DAY).toISOString().slice(0, 10);

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
if (ledger.dateBasis === BASIS) {
  console.log(JSON.stringify({ migrated: false, reason: "already", dateBasis: ledger.dateBasis, migratedAt: ledger.migratedAt }));
  process.exit(0);
}

const rows = [];
for (const [code, eds] of Object.entries(ledger.sets || {})) for (const ed of ["jp", "en"]) for (const r of eds[ed] || []) rows.push({ where: `${code}.${ed}`, r });
const nSets = rows.length;
for (const r of ledger.excluded || []) rows.push({ where: "excluded", r });
const nExcluded = rows.length - nSets;

const strip = ({ d, ...rest }) => rest;
const hashOf = () => crypto.createHash("sha256").update(JSON.stringify(rows.map(({ r }) => strip(r)))).digest("hex");
const before = hashOf();

const problems = [];
const keys = new Set();
for (const { where, r } of rows) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(r.d || "")) { problems.push(`${where} ${r.id}: 날짜 형식 이상 (${r.d})`); continue; }
  const d1 = plusOne(r.d);
  const bound = r.seen || ledger.updated;
  if (bound && d1 > bound) problems.push(`${where} ${r.id}: +1 한 ${d1} 이 수집일 ${bound} 보다 늦다`);
  if (where !== "excluded") {
    const k = `${r.id}|${d1}`;
    if (keys.has(k)) problems.push(`${where} ${r.id}: +1 뒤 id|판매일 중복 (${d1})`);
    keys.add(k);
  }
}
if (problems.length) {
  console.error(JSON.stringify({ migrated: false, problems }, null, 2));
  process.exit(1);
}

let minD = "9999-99-99", maxD = "";
for (const { r } of rows) {
  r.d = plusOne(r.d);
  if (r.d < minD) minD = r.d;
  if (r.d > maxD) maxD = r.d;
}
const after = hashOf();
if (after !== before || rows.length !== nSets + nExcluded) {
  console.error(JSON.stringify({ migrated: false, problems: ["d 외 필드 또는 행 수가 달라졌다 — 쓰지 않는다"], before, after }));
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
ledger.dateBasis = BASIS;
ledger.migratedAt = today;
ledger.repairs = [...(ledger.repairs || []), {
  date: today, shiftedDays: 1, rows: nSets, excluded: nExcluded,
  reason: "Sale dates had been stored one day early since the ledger began (2026-07-22): the ingest parsed eBay's displayed sale date through a local-midnight-to-UTC conversion. eBay shows the date in the browser's local day, so the displayed date is the sale date. Every record's date was moved forward by one day; no other field was changed, and nothing was added or removed.",
}];
fs.writeFileSync(ledgerPath, JSON.stringify(ledger) + "\n", "utf8");
console.log(JSON.stringify({ migrated: true, rows: nSets, excluded: nExcluded, range: `${minD} ~ ${maxD}`, hashUnchanged: after === before, dateBasis: BASIS, migratedAt: today }));
