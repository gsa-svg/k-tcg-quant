#!/usr/bin/env node
// 경매 원장에서 "말할 수 있는 것"만 추려낸다 — 2026-08-10 신설.
//
// 왜 도구로 만드나: 발견을 사람이 한 번 찾아 글에 박아두면, 데이터가 늘어 그 발견이 더는 참이 아니게 돼도
// 글은 그대로 남는다. 리서치 사이트에서 그건 최악이다. 그래서 매번 원장에서 다시 계산하고,
// **기준을 못 넘기면 발견을 내놓지 않는다**. 글은 이 출력에서만 인용한다.
//
// 통과 기준(하나라도 못 넘으면 그 발견은 not-reportable):
//   · 표본 하한 — 비율은 구간당 최소 MIN_N
//   · 신뢰구간 비중첩 — 두 값을 "다르다"고 말하려면 윌슨 95% 구간이 겹치지 않아야 한다
//   · 시간대 일관성 — 요일 발견은 UTC 와 미 동부 양쪽에서 같은 방향이어야 한다
//     (eBay 경매는 미국 저녁에 몰려 끝난다. UTC 금요일 01시 = 동부 목요일 21시라, 기준을 하나만 쓰면
//      "요일 효과"가 시간대 착시일 수 있다.)
//
// ⚠️ 여기 없는 것: 카드별 등급 프리미엄. 같은 카드번호라도 변형(알트/망가/SP)이 다르면 다른 물건이고,
//    원장의 variant 로 좁히면 양쪽 3건 이상인 카드가 0종이었다(2026-08-10 실측). 계산은 되지만 뜻이 없어서 뺐다.
//
// Run: node tools/audit-auction-findings.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARCHIVE = path.join(ROOT, "data", "auction-archive");
const OUT = path.join(ROOT, "data", "auction-findings.json");

// 등급/낱장 분류가 붙기 시작한 날. 그 전은 종류별 이야기를 할 수 없다.
const CLEAN_SINCE = "2026-07-22";
const MIN_N = 300;          // 요일 한 칸의 최소 표본
const MIN_BID_N = 500;      // 입찰 전환 발견의 최소 표본
// eBay US 마켓플레이스 기준 시간대. 서머타임 동안 UTC-4 (분석 기간이 여름이라 고정으로 충분하고,
// 고정이라는 사실을 출력에 적어 둔다 — 나중에 겨울 데이터가 섞이면 여기부터 손봐야 한다).
const ET_OFFSET_HOURS = -4;

const DOW_EN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];

// 윌슨 95% 반폭(%p). 비율을 말할 때 이것 없이 말하지 않는다.
const wilson = (s, n) => {
  if (!n) return null;
  const z = 1.96, p = s / n;
  return +((z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)) / (1 + (z * z) / n)) * 100).toFixed(1);
};
const rateOf = (rows) => {
  const n = rows.length, s = rows.filter((r) => r.sold).length;
  return { n, sold: s, rate: n ? +((s / n) * 100).toFixed(1) : null, ci: wilson(s, n) };
};
// 두 비율이 "다르다"고 말해도 되는가 — 구간이 겹치면 안 된다
const separated = (a, b) => a.rate != null && b.rate != null && Math.abs(a.rate - b.rate) > a.ci + b.ci;

function load() {
  if (!fs.existsSync(ARCHIVE)) throw new Error("auction-archive 폴더가 없다");
  const rows = [];
  for (const f of fs.readdirSync(ARCHIVE).filter((n) => /^\d{4}-\d{2}-\d{2}\.json$/.test(n)).sort()) {
    rows.push(...(JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8")).sales || []));
  }
  return rows;
}

// ── 발견 1. 입찰이 붙으면 팔리는가 ────────────────────────────────────────────
// 순환논법 방지: 유찰건에도 입찰 기록이 남는지 먼저 확인한다. 하나도 없다면 "입찰=낙찰"은
// 데이터가 그렇게 생겨서일 뿐이므로 발견이 아니다.
function bidConversion(clean) {
  const withBid = clean.filter((r) => (r.bidders || 0) > 0);
  const unsoldWithBid = clean.filter((r) => !r.sold && (r.bidders || 0) > 0);
  const soldNoBid = clean.filter((r) => r.sold && !((r.bidders || 0) > 0));
  const x = rateOf(withBid);
  const reportable = x.n >= MIN_BID_N && unsoldWithBid.length > 0;
  return {
    reportable,
    why: !reportable
      ? (unsoldWithBid.length === 0
        ? "유찰건에 입찰 기록이 하나도 없다 — 순환논법이라 발표 불가"
        : `표본 ${x.n} < ${MIN_BID_N}`)
      : null,
    bidReceiving: x.n,
    soldAmongThem: x.sold,
    conversion: x.rate,
    ci: x.ci,
    bidButUnsold: unsoldWithBid.length,     // 최저가 미달 등으로 안 팔린 건
    soldWithoutBid: soldNoBid.length,       // 0이어야 정상(즉시구매 혼입 감지용)
    overallSellThrough: rateOf(clean),
  };
}

// ── 발견 2. 종료 요일 효과 ───────────────────────────────────────────────────
// 시각(endedAt)이 있는 행만 쓴다. 날짜만으로 요일을 세면 시간대 착시가 섞인다.
function dayOfWeek(clean) {
  const timed = clean.filter((r) => r.endedAt);
  const coverage = clean.length ? +((timed.length / clean.length) * 100).toFixed(1) : 0;
  const build = (offsetHours) => {
    const g = {};
    for (const r of timed) {
      const d = new Date(new Date(r.endedAt).getTime() + offsetHours * 3600 * 1000).getUTCDay();
      (g[d] = g[d] || []).push(r);
    }
    return Object.fromEntries(Object.entries(g).map(([d, rows]) => [d, rateOf(rows)]));
  };
  const utc = build(0);
  const et = build(ET_OFFSET_HOURS);
  const thin = Object.values(et).filter((x) => x.n < MIN_N).map((x) => x.n);
  const rank = (t) => Object.entries(t).filter(([, x]) => x.n >= MIN_N).sort((a, b) => a[1].rate - b[1].rate);
  const etRank = rank(et), utcRank = rank(utc);
  if (etRank.length < 5 || utcRank.length < 5) {
    return { reportable: false, why: `표본 ${MIN_N}건 넘는 요일이 부족(ET ${etRank.length}/UTC ${utcRank.length})`, coverage };
  }
  const [worstD, worst] = etRank[0];
  const [bestD, best] = etRank[etRank.length - 1];
  // 두 기준에서 최저 요일이 같아야 한다 — 다르면 시간대 착시다.
  const utcWorst = utcRank[0][0];
  const consistent = utcWorst === worstD;
  const distinct = separated(worst, best);
  return {
    reportable: consistent && distinct,
    why: !consistent ? `최저 요일이 시간대에 따라 다름(ET ${DOW_EN[worstD]} vs UTC ${DOW_EN[utcWorst]}) — 시간대 착시`
      : !distinct ? "최고·최저 신뢰구간이 겹침" : null,
    timestampCoverage: coverage,
    timezone: `UTC${ET_OFFSET_HOURS} (eBay US, 서머타임 고정)`,
    worst: { day: DOW_EN[worstD], dayKo: DOW_KO[worstD], ...worst },
    best: { day: DOW_EN[bestD], dayKo: DOW_KO[bestD], ...best },
    gapPoints: +(best.rate - worst.rate).toFixed(1),
    ratio: +(best.rate / worst.rate).toFixed(2),
    byDayET: Object.fromEntries(Object.entries(et).map(([d, x]) => [DOW_EN[d], x])),
    thinBuckets: thin,
  };
}

function main() {
  const all = load();
  const clean = all.filter((r) => r.d >= CLEAN_SINCE);
  const findings = {
    basis: "Completed eBay One Piece card auctions, from our own append-only ledger",
    note: "Only findings that clear their sample floor and whose 95% Wilson intervals do not overlap are marked reportable. Day-of-week is computed from listing end timestamps in the marketplace's own timezone and cross-checked against UTC, because most auctions end in the US evening and a date-only reading would shift a day. Anything marked reportable:false must not be quoted. Terms of use: https://opboxindex.com/free-data.html#terms",
    window: { from: clean[0] && clean[0].d, to: clean[clean.length - 1] && clean[clean.length - 1].d, auctions: clean.length },
    minSample: { dayOfWeek: MIN_N, bidConversion: MIN_BID_N },
    bidConversion: bidConversion(clean),
    dayOfWeek: dayOfWeek(clean),
    generatedFrom: `${all.length} settled auctions (${clean.length} since ${CLEAN_SINCE})`,
  };
  fs.writeFileSync(OUT, `${JSON.stringify(findings)}\n`, "utf8");

  const b = findings.bidConversion, d = findings.dayOfWeek;
  if (process.argv.includes("--json")) { console.log(JSON.stringify(findings, null, 1)); return; }
  console.log(`창: ${findings.window.from}~${findings.window.to} · ${findings.window.auctions}건`);
  console.log(`\n[1] 입찰→낙찰 전환  ${b.reportable ? "발표 가능" : "발표 불가: " + b.why}`);
  if (b.reportable) {
    console.log(`    입찰이 붙은 ${b.bidReceiving}건 중 ${b.soldAmongThem}건 낙찰 = ${b.conversion}% ±${b.ci}`);
    console.log(`    입찰 받고도 유찰: ${b.bidButUnsold}건 · 전체 낙찰률 ${b.overallSellThrough.rate}%`);
  }
  console.log(`\n[2] 종료 요일 효과  ${d.reportable ? "발표 가능" : "발표 불가: " + d.why}`);
  if (d.reportable) {
    console.log(`    최저 ${d.worst.dayKo} ${d.worst.rate}% ±${d.worst.ci} (n=${d.worst.n})`);
    console.log(`    최고 ${d.best.dayKo} ${d.best.rate}% ±${d.best.ci} (n=${d.best.n})`);
    console.log(`    격차 ${d.gapPoints}%p (${d.ratio}배) · 시각 정보 커버리지 ${d.timestampCoverage}%`);
  }
  console.log(`\n→ ${path.relative(ROOT, OUT)}`);
}

if (require.main === module) main();
module.exports = { wilson, separated };
