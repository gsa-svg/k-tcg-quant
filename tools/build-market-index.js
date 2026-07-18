// OPBOX 마켓 인덱스 + 개봉 미터 + 성적표 계산기 → data/market-index.json
// 방법론(고정, 페이지에 그대로 공개):
//  - 지수: 2026-01-07 = 100 기준, 그날 가격이 있는 세트만 구성종목(=18). 등가중,
//    각 세트 price(t)/price(base) 평균 ×100. 결측일은 직전값 carry-forward.
//    후발 세트(OP-02/15/16 등 1월 미포함)는 지수 계산에서 제외 — 개별 성적표엔 표시.
//  - 이유: 발매 시점부터 추적한 세트가 4개뿐이라 "발매 대비"는 대부분 거짓. 그래서
//    지수·성적표는 전부 "1월 7일 이후"로만 말한다. 진짜 발매추적 세트만 launchTracked:true.
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
const BASE = "2026-01-07";
// 발매 시점부터 실제 추적한 세트만(감사 결과). 나머지는 1월 시작이라 "발매 대비" 주장 금지.
const LAUNCH_TRACKED = new Set(["OP-16"]); // OP-17부터 자동 추가 예정
const codes = [...d.jp.list, ...d.extra.list];

function ptsOf(c) { return (d.sets[c] && d.sets[c].boxSeries && d.sets[c].boxSeries.points) || []; }
function priceAt(pts, iso) { let v = null; for (const p of pts) { if (p.d <= iso) v = p.p; else break; } return v; }

// ── 구성종목 = BASE에 가격 있는 세트
const series = {};
const allDates = new Set();
for (const c of codes) { const p = ptsOf(c); if (p.length) { series[c] = p; p.forEach((x) => allDates.add(x.d)); } }
const constituents = Object.keys(series).filter((c) => priceAt(series[c], BASE) != null);
const dates = [...allDates].sort().filter((x) => x >= BASE);

// ── 일별 지수
const indexSeries = [];
for (const t of dates) {
  let sum = 0, n = 0;
  for (const c of constituents) { const b = priceAt(series[c], BASE), v = priceAt(series[c], t); if (b && v) { sum += v / b; n++; } }
  if (n) indexSeries.push({ d: t, v: Math.round((100 * sum) / n * 10) / 10, n });
}
const latest = indexSeries[indexSeries.length - 1];
// 진짜 7일 전 값(carry-forward 아티팩트 방지)
function idxAtOrBefore(iso) { let r = null; for (const e of indexSeries) { if (e.d <= iso) r = e; else break; } return r; }
const wkAgoDate = new Date(new Date(latest.d + "T00:00:00Z").getTime() - 7 * 864e5).toISOString().slice(0, 10);
const wkAgo = idxAtOrBefore(wkAgoDate) || indexSeries[0];
const weekChangePct = Math.round((latest.v / wkAgo.v - 1) * 1000) / 10;
const sinceBasePct = Math.round((latest.v - 100) * 10) / 10;

// ── 개봉 미터(psaWeekly 전세트 합산)
const weekTotals = {};
for (const c of codes) { const wk = (d.sets[c] && d.sets[c].psaWeekly && d.sets[c].psaWeekly.points) || []; for (const p of wk) weekTotals[p.d] = (weekTotals[p.d] || 0) + p.v; }
const wkDates = Object.keys(weekTotals).sort();
const meterWeeks = wkDates.map((t) => ({ d: t, v: weekTotals[t] }));
const meterLatest = meterWeeks[meterWeeks.length - 1] || null;
const meterPrev = meterWeeks[meterWeeks.length - 2] || null;
const meterWoW = meterLatest && meterPrev ? Math.round((meterLatest.v / meterPrev.v - 1) * 1000) / 10 : null;
let allTimeGraded = 0;
for (const c of codes) { const s = d.sets[c]; if (s && s.psaFull && s.psaFull.total) allTimeGraded += s.psaFull.total; }

// ── 성적표(전세트, "1월 7일 이후" 기준 — 발매 대비 아님)
const board = [];
for (const c of codes) {
  const p = ptsOf(c); if (!p.length) continue;
  const base = priceAt(p, BASE); // 1월에 없으면 첫 포인트
  const firstV = base != null ? base : p[0].p;
  const firstD = base != null ? BASE : p[0].d;
  const lastV = p[p.length - 1].p;
  const f = (FACTS.sets && FACTS.sets[c]) || {};
  const msrpUsd = f.jpMsrpYen ? yenUsd(f.jpMsrpYen) : null;
  const nowUsd = usd(lastV);
  board.push({
    code: c,
    nameEn: d.sets[c].nameEn || c,
    baseUsd: Math.round(usd(firstV)),
    baseDate: firstD,
    nowUsd: Math.round(nowUsd),
    changePct: Math.round((lastV / firstV - 1) * 1000) / 10,
    launchTracked: LAUNCH_TRACKED.has(c), // true면 "발매 대비"라고 말해도 됨
    msrpYen: f.jpMsrpYen || null,
    msrpUsd: msrpUsd != null ? Math.round(msrpUsd) : null,
    vsMsrp: msrpUsd && nowUsd ? Math.round((nowUsd / msrpUsd) * 10) / 10 : null, // 정가 대비 배수
    reprints: (f.reprintRecords || []).length,
  });
}
board.sort((a, b) => b.changePct - a.changePct);

const excluded = Object.keys(series).filter((c) => !constituents.includes(c));
const out = {
  updated: d.updated || latest.d,
  base: { date: BASE, value: 100 },
  method: `Equal-weight index of ${constituents.length} Japanese booster boxes with a tracked price on ${BASE} (=100). Sets first tracked after that date (${excluded.join(", ")}) are shown individually but excluded from the index. Prices carry forward on days without a new reading.`,
  constituents,
  index: { value: latest.v, asOf: latest.d, weekChangePct, sinceBasePct, series: indexSeries },
  meter: { latestWeek: meterLatest, weeks: meterWeeks, wowPct: meterWoW, allTimeGraded },
  board,
  reprints: { bandaiAnnounces: FACTS.bandaiAnnouncesReprints === true, bySet: FACTS.sets || {} },
};
// 메인 JSON에 통합(단일 소스·단일 버전 — 별도 파일의 버전 엇갈림 사고 방지)
const mainPath = path.join(ROOT, "data", "onepiece-packs.json");
const main = JSON.parse(fs.readFileSync(mainPath, "utf8"));
main.marketIndex = out;
fs.writeFileSync(mainPath, JSON.stringify(main));
console.log(JSON.stringify({
  index: `${out.index.value} (${sinceBasePct >= 0 ? "+" : ""}${sinceBasePct}% since ${BASE}, wk ${weekChangePct >= 0 ? "+" : ""}${weekChangePct}%)`,
  constituents: constituents.length,
  excluded: Object.keys(series).filter((c) => !constituents.includes(c)),
  meter: meterLatest ? `${meterLatest.v.toLocaleString()} graded wk of ${meterLatest.d} (WoW ${meterWoW >= 0 ? "+" : ""}${meterWoW}%), all-time ${allTimeGraded.toLocaleString()}` : "none",
  boardTop: board[0].code + " " + board[0].changePct + "% ... " + board[board.length - 1].code + " " + board[board.length - 1].changePct + "%",
  launchTracked: board.filter((b) => b.launchTracked).map((b) => b.code),
}, null, 1));
