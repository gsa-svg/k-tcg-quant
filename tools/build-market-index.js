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

// ── 성적표(전세트). 변화율은 **최근 4주** — "추적 시작 대비"를 버렸다(2026-08-24).
// 시리즈는 원장에서 매번 다시 만드는데, 새 수집이 과거 판매를 되메우면 초기 희소 구간의
// 중앙값이 통째로 바뀐다. 실측: OP-13 기준가가 하루 사이 \$149(05-24) → \$277(05-29) 로 튀어
// 같은 세트가 +2.7% 에서 -51.6% 가 됐다. 시장이 아니라 우리 표본이 움직인 것이다.
// 최근 4주는 양끝이 다 두꺼운 구간이라 되메움에 둔감하고, 세트 페이지의 4-week change 와 기준이 같다.
const board = [];
for (const c of codes) {
  const p = ptsOf(c); if (!p.length) continue;
  const lastV = p[p.length - 1].p;
  const lastD = p[p.length - 1].d;
  const cut = new Date(Date.parse(lastD) - 28 * 864e5).toISOString().slice(0, 10);
  let ref = null;
  for (const pt of p) { if (pt.d <= cut) ref = pt; else break; }
  const f = (FACTS.sets && FACTS.sets[c]) || {};
  const msrpUsd = f.jpMsrpYen ? yenUsd(f.jpMsrpYen) : null;
  const nowUsd = lastV;   // 이미 USD
  board.push({
    code: c,
    nameEn: d.sets[c].nameEn || c,
    nowUsd: Math.round(nowUsd),
    nowDate: lastD,   // 마지막 판매 관측일 — 표가 "오늘 값"으로 읽히지 않게
    changePct: ref ? Math.round((lastV / ref.p - 1) * 1000) / 10 : null,   // 최근 4주
    changeBasis: ref ? ref.d : null,
    launchTracked: LAUNCH_TRACKED.has(c), // true면 "발매 대비"라고 말해도 됨
    msrpYen: f.jpMsrpYen || null,
    msrpUsd: msrpUsd != null ? Math.round(msrpUsd) : null,
    vsMsrp: msrpUsd && nowUsd ? Math.round((nowUsd / msrpUsd) * 10) / 10 : null, // 정가 대비 배수
    reprints: (f.reprintRecords || []).length,
  });
}
board.sort((a, b) => (b.changePct ?? -Infinity) - (a.changePct ?? -Infinity));

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
  boardTop: board[0].code + " " + board[0].changePct + "% ... " + board[board.length - 1].code + " " + board[board.length - 1].changePct + "%",   // null 이면 4주 기준점 없는 신생 세트
  launchTracked: board.filter((b) => b.launchTracked).map((b) => b.code),
}, null, 1));
