#!/usr/bin/env node
// 박스 원장의 달러값을 "수집일 실제 환율"로 되돌린다 — 2026-08-17, 1회성 교정.
//
// 무엇이 잘못돼 있었나:
//   원장 3,468건 중 3,435건(99%)은 eBay 가 원화로 보여준 가격을 나눠 만든 값이다.
//   그런데 7/22~8/13 아홉 번의 수집이 전부 fx.json 에 굳어 있던 1548.63(7/1 값) 하나를 썼다.
//   그 사이 실제 환율은 1558 → 1415 로 계속 내렸으므로, 늦게 수집된 기록일수록 달러값이 낮게 박혔다.
//   같은 값어치의 박스가 7/22 수집분보다 8/13 수집분에서 4.5% 싸 보인다 — 시장이 아니라 우리 환율이 만든 차이다.
//
// 왜 판매일이 아니라 수집일인가:
//   eBay 는 지난 판매도 **조회 시점** 환율로 원화 표시한다. 2023년에 팔린 건을 오늘 조회하면
//   오늘 환율로 환산된 원화가 나온다. 그래서 되돌릴 때 써야 하는 것도 수집일 환율이다.
//
// 수집일을 어떻게 아는가:
//   레코드에 수집일 필드가 없다. git 이력에서 각 id 가 원장에 처음 등장한 커밋 날짜로 복원한다.
//   (원장은 append-only 라 "처음 등장한 커밋" = "그 건을 수집한 날" 이 성립한다.)
//
// 남기는 것: krw(원화 원본) · fx(적용 환율) · seen(수집일).
//   다음부터는 추정이 필요 없다. box-sold-ingest.js 도 이 세 필드를 함께 쓴다.
//
// 실행: node tools/restore-box-fx.js [--write]   (--write 없으면 dry-run)
const fs = require("node:fs");
const path = require("node:path");
const { execSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const LEDGER = path.join(ROOT, "data", "box-sold-ledger.json");
const HIST = path.join(ROOT, "data", "fx-history.json");
const OLD_FX = 1548.63; // 잘못 적용돼 있던 고정 환율
const WRITE = process.argv.includes("--write");

const git = (a) => execSync("git " + a, { cwd: ROOT, maxBuffer: 1e9 }).toString();

// 1) id → 최초 등장 커밋일(= 수집일)
const log = git('log --reverse --date=short --pretty="%H %ad" -- data/box-sold-ledger.json')
  .trim().split(/\r?\n/).map((l) => l.trim().replace(/^"|"$/g, "").split(/\s+/));
const seenOn = {};
for (const [h, d] of log) {
  let o;
  try { o = JSON.parse(git("show " + h + ":data/box-sold-ledger.json")); } catch { continue; }
  for (const s of Object.values(o.sets || {}))
    for (const arr of Object.values(s)) {
      if (!Array.isArray(arr)) continue;
      for (const r of arr) if (r.id && !seenOn[r.id]) seenOn[r.id] = d;
    }
}

// 2) 수집일별 실제 환율. ECB 는 영업일만 있으므로 주말·공휴일은 직전 영업일 값을 쓴다.
const rates = JSON.parse(fs.readFileSync(HIST, "utf8")).rates;
const days = Object.keys(rates).sort();
const rateOn = (d) => {
  let pick = null;
  for (const k of days) { if (k <= d) pick = k; else break; }
  return pick ? { fx: rates[pick], from: pick } : null;
};

const dates = [...new Set(Object.values(seenOn))].sort();
console.log("수집일 → 적용 환율 (보정배수)");
for (const d of dates) {
  const r = rateOn(d);
  console.log("  " + d + "  " + (r ? r.fx.toFixed(2) + (r.from === d ? "" : " ←" + r.from) : "없음") +
    "  ×" + (r ? (OLD_FX / r.fx).toFixed(4) : "-"));
}

// 3) 재환산
const L = JSON.parse(fs.readFileSync(LEDGER, "utf8"));
let done = 0, already = 0, noDate = 0;
for (const s of Object.values(L.sets || {}))
  for (const arr of Object.values(s)) {
    if (!Array.isArray(arr)) continue;
    for (const r of arr) {
      if (r.fx) { already++; continue; }             // 이미 보정된 건은 건드리지 않는다(재실행 안전)
      const rr = seenOn[r.id] && rateOn(seenOn[r.id]);
      if (!rr) { noDate++; continue; }
      const krw = Math.round(r.unit * OLD_FX);        // eBay 가 보여줬던 원화 단가를 복원
      if (!WRITE) { done++; continue; }
      r.krw = krw;
      r.fx = Number(rr.fx.toFixed(2));
      r.seen = seenOn[r.id];
      r.unit = Number((krw / rr.fx).toFixed(2));
      r.total = Number((r.unit * (r.qty || 1)).toFixed(2));
      done++;
    }
  }

if (!WRITE) { console.log("\ndry-run: 대상 " + done + "건 · 이미보정 " + already + "건 · 수집일없음 " + noDate + "건"); process.exit(0); }

L.fxRestored = {
  on: "2026-08-17",
  oldFx: OLD_FX,
  basis: "collection-date",
  source: "data/fx-history.json (ECB reference rates)",
  note: "7/22~8/13 수집분이 전부 7/1 환율(1548.63)로 환산돼 있었다. eBay 는 지난 판매도 조회 시점 환율로 원화 표시하므로 수집일 환율이 맞다. 이후 레코드는 krw/fx/seen 을 직접 들고 있어 추정이 필요 없다.",
  records: done,
};
fs.writeFileSync(LEDGER, JSON.stringify(L, null, 1) + "\n", "utf8");
console.log("\n재환산 " + done + "건 · 이미보정 " + already + "건 · 수집일없음 " + noDate + "건");
