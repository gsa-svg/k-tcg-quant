// OPBOX 성적표(board) + 개봉 미터 → onepiece-packs.json 의 marketIndex
//  - board 가격: 우리 eBay 실판매 원장(box-sold-series.json, jp 주간 중앙값 USD).
//    2026-08-21 전환 — 종전 외부 boxSeries 는 20/21 세트가 07-11~13 에 멈춘 것을
//    아무도 몰랐다. 우리 원장은 멈추면 수집 감사가 바로 잡는다. 차트와 같은 소스라
//    홈 표 $348 vs 차트 $305 처럼 한 화면에 두 가격이 뜨는 문제도 사라진다.
//  - Change = 각 세트 추적 시작일 대비(발매 대비 아님 — 발매추적은 launchTracked 만).
//  - 지수(2026-01-07=100)는 소비처가 없어서 전환 때 삭제했다. 화면 표시는 2026-07-29 에
//    이미 빠졌고 남은 건 방문자 페이로드 속 죽은 시계열뿐이었다.
//  - 개봉 미터: 전세트 psaWeekly 합산(최근 주) + 전주대비. 누적은 psaFull.total 합.
// Run: node tools/build-market-index.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const FX = d.fx || {};
const usd = (krw) => (FX.usdKrw ? krw / FX.usdKrw : null);
const yenUsd = (yen) => (FX.jpyKrw && FX.usdKrw ? (yen * FX.jpyKrw) / FX.usdKrw : null);
// 검증된 세트 팩트(정가·재판) — 나이틀리에 안 지워지는 소스 파일
let FACTS = { sets: {}, bandaiAnnouncesReprints: false };
try { FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-facts.json"), "utf8")); } catch (e) {}
// 발매 시점부터 실제 추적한 세트만(감사 결과). 나머지는 중간 시작이라 "발매 대비" 주장 금지.
const LAUNCH_TRACKED = new Set(["OP-16", "OP-17"]);
const codes = [...d.jp.list, ...d.extra.list];

const SOLD = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8"));
// 세트별 일본판 주간 판매 중앙값(USD). 값 없는 주는 건너뛴다 — 추정 금지.
function ptsOf(c) {
  const arr = (SOLD.sets[c] && SOLD.sets[c].jp) || [];
  return arr.filter((p) => p && p.median != null).map((p) => ({ d: p.d, p: p.median, n: p.n }));
}

// ── 개봉 미터(psaWeekly 전세트 합산)
const weekTotals = {};
const weekCoverage = {};
for (const c of codes) {
  const wk = (d.sets[c] && d.sets[c].psaWeekly && d.sets[c].psaWeekly.points) || [];
  for (const p of wk) {
    weekTotals[p.d] = (weekTotals[p.d] || 0) + p.v;
    weekCoverage[p.d] = (weekCoverage[p.d] || 0) + 1;
  }
}
const wkDates = Object.keys(weekTotals).sort();
const meterWeeks = wkDates.map((t) => ({ d: t, v: weekTotals[t], n: weekCoverage[t] }));
const meterLatest = meterWeeks[meterWeeks.length - 1] || null;
const meterPrev = meterWeeks[meterWeeks.length - 2] || null;
const meterWoW = meterLatest && meterPrev ? Math.round((meterLatest.v / meterPrev.v - 1) * 1000) / 10 : null;
const meterUpdated = codes
  .map((c) => d.sets[c]?.psaWeekly?.updated)
  .filter(Boolean)
  .sort()
  .at(-1) || meterLatest?.d || null;
const todayIso = new Date().toISOString().slice(0, 10);
const meterAgeDays = meterLatest
  ? Math.max(0, Math.floor((Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${meterLatest.d}T00:00:00Z`)) / 864e5))
  : null;
// PSA weekly figures are manually verified snapshots. Once they trail the live
// market index by more than ten days, the UI must present them as historical.
const meterIsStale = meterAgeDays == null || meterAgeDays > 10;
let allTimeGraded = 0;
for (const c of codes) { const s = d.sets[c]; if (s && s.psaFull && s.psaFull.total) allTimeGraded += s.psaFull.total; }

// ── 성적표(전세트, 각 세트 추적 시작일 대비)
const board = [];
for (const c of codes) {
  const p = ptsOf(c); if (!p.length) continue;
  const firstV = p[0].p;
  const firstD = p[0].d;
  const lastV = p[p.length - 1].p;
  const f = (FACTS.sets && FACTS.sets[c]) || {};
  const msrpUsd = f.jpMsrpYen ? yenUsd(f.jpMsrpYen) : null;
  const nowUsd = lastV;   // 이미 USD
  board.push({
    code: c,
    nameEn: d.sets[c].nameEn || c,
    baseUsd: Math.round(firstV),
    baseDate: firstD,
    nowUsd: Math.round(nowUsd),
    nowDate: p[p.length - 1].d,   // 마지막 판매 관측일 — 표가 "오늘 값"으로 읽히지 않게
    changePct: Math.round((lastV / firstV - 1) * 1000) / 10,
    launchTracked: LAUNCH_TRACKED.has(c), // true면 "발매 대비"라고 말해도 됨
    msrpYen: f.jpMsrpYen || null,
    msrpUsd: msrpUsd != null ? Math.round(msrpUsd) : null,
    vsMsrp: msrpUsd && nowUsd ? Math.round((nowUsd / msrpUsd) * 10) / 10 : null, // 정가 대비 배수
    reprints: (f.reprintRecords || []).length,
  });
}
board.sort((a, b) => b.changePct - a.changePct);

const out = {
  updated: d.updated || SOLD.updated || todayIso,
  method: "Per-set change from each set's own tracking start date, using weekly medians of completed eBay sales of sealed Japanese booster boxes (our own ledger).",
  meter: {
    latestWeek: meterLatest,
    weeks: meterWeeks,
    wowPct: meterWoW,
    allTimeGraded,
    updated: meterUpdated,
    ageDays: meterAgeDays,
    isStale: meterIsStale,
    basis: "verified PSA population weekly deltas",
  },
  board,
  reprints: { bandaiAnnounces: FACTS.bandaiAnnouncesReprints === true, bySet: FACTS.sets || {} },
};
// 메인 JSON에 통합(단일 소스·단일 버전 — 별도 파일의 버전 엇갈림 사고 방지)
const mainPath = path.join(ROOT, "data", "onepiece-packs.json");
const main = JSON.parse(fs.readFileSync(mainPath, "utf8"));
main.marketIndex = out;
fs.writeFileSync(mainPath, JSON.stringify(main));
console.log(JSON.stringify({
  boardSets: board.length,
  meter: meterLatest ? `${meterLatest.v.toLocaleString()} graded wk of ${meterLatest.d} (WoW ${meterWoW >= 0 ? "+" : ""}${meterWoW}%), all-time ${allTimeGraded.toLocaleString()}` : "none",
  boardTop: board[0].code + " " + board[0].changePct + "% ... " + board[board.length - 1].code + " " + board[board.length - 1].changePct + "%",
  launchTracked: board.filter((b) => b.launchTracked).map((b) => b.code),
}, null, 1));
