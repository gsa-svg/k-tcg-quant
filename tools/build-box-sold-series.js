// 박스 eBay SOLD(실거래) 시계열 — **원장에서 판매일 기준으로 다시 센다**.
//
// 2026-08-13 교체. 그 전(append-box-sold-series.js)은 "수집일 스냅샷"을 하루 한 점씩 덧붙였다.
// 두 가지가 틀어져 있었다:
//
//  1) **수집 방식이 바뀌면 값이 튄다.** 8/13 에 언어 판별을 제목 추측 → eBay 신고값(Language 패싯)으로
//     바꾸자 일본판 표본이 10배로 늘었고, 그날 점만 OP-13 $118 → $137 로 뛰었다. 시장이 움직인 게
//     아니라 우리가 더 잘 보게 된 것인데 그래프에는 급등으로 그려졌다 — D4 가드가 막으려던 바로 그 형태다.
//  2) **후행한다.** 스냅샷은 그날 검색결과에 보인 sold 를 전부 뭉갠 값이라 사실상 최근 90일 평균이었다.
//     OP-01 영문판은 스냅샷 $1,525 인데 최근 4주 실거래 중앙값은 $1,363 이었다. 시세가 내리는 중이면
//     스냅샷이 계속 위쪽에 붙어 있는다.
//
// 그래서 이제 원장(box-sold-ledger.json, 건별 실거래)에서 **판매일** 기준 롤링 중앙값으로 매번 다시 만든다.
// 수집일이 언제였는지, 그날 검색이 넓었는지 좁았는지와 무관해진다. 오늘 새로 발견한 과거 판매도
// 그 판매일 구간에 함께 들어가므로 지난 구간까지 같이 두꺼워진다.
//
// ⚠️ 원장은 절대 건드리지 않는다. 이 도구는 원장을 읽기만 하고 시계열만 다시 쓴다.
//    시계열은 파생물이라 언제든 재생성 가능하다 — 원장이 유일한 원본이다.
//
// Run: node tools/build-box-sold-series.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const ledgerPath = path.join(ROOT, "data", "box-sold-ledger.json");
const seriesPath = path.join(ROOT, "data", "box-sold-series.json");

// 창 길이는 **계열마다** 정한다. 세트별 거래 밀도가 10배 넘게 차이 나기 때문이다:
// OP-01 영문판은 4주에 30건 가까이 팔리는데 OP-03 일본판은 4주에 3건도 안 된다.
// 창을 하나로 고정하면 둘 중 하나가 망가진다 — 짧으면 얇은 세트가 한두 건에 흔들리고,
// 길면 두꺼운 세트가 6주 평균이 되어 시세 변화를 늦게 반영한다(스냅샷 방식이 딱 그랬다).
// 그래서 한 점에 목표 건수가 모일 만큼만 창을 늘린다. 한 계열 안에서는 창이 일정해
// 선의 기준이 중간에 바뀌지 않고, 창 길이는 시계열에 기록해 화면에서 밝힌다.
const TARGET_N = 12;      // 한 점에 이 정도가 모이도록 창을 잡는다
const MIN_WINDOW = 28;
const MAX_WINDOW = 56;    // 이보다 길면 "최근 시세"라고 부르기 어렵다
const STEP_DAYS = 7;      // 주 단위면 4개월치가 17점 남짓 — 선이 읽히면서 파일도 가볍다
const MIN_N = 6;          // 창을 최대로 늘려도 이만큼 안 모이면 점을 찍지 않는다. 빈 구간이 틀린 값보다 낫다.

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const quant = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

function seriesFor(records) {
  const rs = (records || [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(Number(r.unit)) && Number(r.unit) > 0)
    .map((r) => ({ t: Date.parse(r.d), unit: Number(r.unit) }))
    .sort((a, b) => a.t - b.t);
  if (rs.length < MIN_N) return { points: [], windowDays: null };

  const first = rs[0].t, last = rs[rs.length - 1].t;

  // 이 계열의 거래 밀도로 창을 정한다. 최근 8주만 보고 고른다 — 옛날에 활발했다가
  // 지금 조용해진 세트에 짧은 창을 물려주면 최근 구간이 통째로 비어버린다.
  const recentFrom = last - 56 * DAY;
  const recent = rs.filter((r) => r.t > recentFrom).length;
  const spanDays = Math.max(1, Math.min(56, (last - first) / DAY));
  const perDay = recent / spanDays;
  const need = perDay > 0 ? Math.ceil(TARGET_N / perDay / 7) * 7 : MAX_WINDOW;
  const windowDays = Math.max(MIN_WINDOW, Math.min(MAX_WINDOW, need));

  const at = (t) => {
    const lo = t - windowDays * DAY;
    const u = [];
    for (const r of rs) { if (r.t > lo && r.t <= t) u.push(r.unit); }
    if (u.length < MIN_N) return null;
    return { d: iso(t), median: Math.round(quant(u, 0.5)), low: Math.round(quant(u, 0.25)), high: Math.round(quant(u, 0.75)), n: u.length };
  };

  // 격자는 **마지막 판매일에서 거꾸로** 잡는다. 앞에서부터 7일씩 세면 마지막 점이 격자에 안 걸려
  // 따로 끼워 넣게 되는데, 그러면 직전 점과 며칠밖에 안 떨어진 점이 하나 더 생겨
  // 창이 거의 같은데도 값이 달라 보이는 절벽이 만들어진다(OP-01 일본판 $290 → $258, 2026-08-13 실측).
  // 뒤에서부터 세면 마지막 점이 항상 격자 위에 있고, 점 간격도 일정해진다.
  const points = [];
  for (let t = last; t >= first + windowDays * DAY; t -= STEP_DAYS * DAY) {
    const p = at(t);
    if (p) points.push(p);
  }
  points.reverse();
  return { points, windowDays };
}

// 월간은 롤링이 아니라 **그 달에 팔린 것 전부**의 중앙값이다.
// 왜 같이 내보내나: 개별 거래 분산이 큰 세트가 있다. OP-01 일본판은 같은 4주 안에서 $105 부터
// $395 까지 팔린다(상태·경매 종료가 차이). 표본 13건짜리 주간 중앙값은 그 안에서 계속 흔들린다.
// 달 단위로 묶으면 표본이 두세 배가 되어 흔들림이 줄고, 대신 반응은 느려진다 — 둘 다 보여주고 고르게 한다.
const MONTH_MIN_N = 6;
function monthlyFor(records) {
  const buckets = new Map();
  for (const r of records || []) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.d) || !(Number(r.unit) > 0)) continue;
    const k = r.d.slice(0, 7);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(Number(r.unit));
  }
  // 진행 중인 달은 아직 다 안 팔렸으니 문턱을 낮춰 넣는다 — 안 그러면 8월 중순에 7월이 최신으로 보인다.
  // 다만 한 단계만 낮춘다 — 3건짜리 중앙값을 넣었더니 OP-01 일본판 8월이 $275 → $176 으로
  // 36% 급락한 것처럼 그려졌다. 표본 수(n)는 그대로 실어 보내 얼마나 얇은 값인지 화면에서 드러나게 한다.
  const thisMonth = new Date().toISOString().slice(0, 7);
  return [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([k, u]) => u.length >= (k === thisMonth ? MONTH_MIN_N - 1 : MONTH_MIN_N))
    .map(([k, u]) => ({
      d: k + "-01", median: Math.round(quant(u, 0.5)), low: Math.round(quant(u, 0.25)),
      high: Math.round(quant(u, 0.75)), n: u.length,
    }));
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

const sets = {};
let points = 0, drawable = 0;
const windowsUsed = {};
let monthPoints = 0;
for (const [code, eds] of Object.entries(ledger.sets || {})) {
  const jp = seriesFor(eds.jp), en = seriesFor(eds.en);
  if (!jp.points.length && !en.points.length) continue;
  const mJp = monthlyFor(eds.jp), mEn = monthlyFor(eds.en);
  sets[code] = {
    // 기존 키(jp/en)는 그대로 둔다 — 주간이 기본 보기이고, 이 키를 읽는 곳이 여럿이다.
    jp: jp.points, en: en.points,
    windowDays: { jp: jp.windowDays, en: en.windowDays },
    monthly: { jp: mJp, en: mEn },
  };
  points += jp.points.length + en.points.length;
  monthPoints += mJp.length + mEn.length;
  for (const s of [jp, en]) {
    if (s.points.length >= 3) { drawable++; windowsUsed[s.windowDays] = (windowsUsed[s.windowDays] || 0) + 1; }
  }
}

const store = {
  note: `Rolling median of individual completed eBay sales of sealed One Piece booster boxes, sampled every ${STEP_DAYS} days and dated by SALE date (not collection date). The averaging window is chosen per series (${MIN_WINDOW}-${MAX_WINDOW} days) so that each point rests on roughly ${TARGET_N} sales, because sales volume differs more than tenfold between sets; each series records the window it used. Rebuilt from data/box-sold-ledger.json on every run, so a change in how listings are collected cannot show up as a price move. Windows with fewer than ${MIN_N} sales are omitted rather than estimated. Prices are per box in USD. A monthly view (median of every sale within each calendar month, minimum ${MONTH_MIN_N} sales) is included alongside, because sets with wide dispersion between individual sales are steadier when grouped by month.`,
  window: { targetSales: TARGET_N, minDays: MIN_WINDOW, maxDays: MAX_WINDOW, stepDays: STEP_DAYS, minSales: MIN_N, basis: "sold", datedBy: "saleDate" },
  builtFrom: { ledger: "data/box-sold-ledger.json", updated: ledger.updated || today },
  updated: today,
  sets,
};

fs.writeFileSync(seriesPath, JSON.stringify(store, null, 1) + "\n", "utf8");

const dates = [...new Set(Object.values(sets).flatMap((v) => [...v.jp, ...v.en].map((p) => p.d)))].sort();
const out = {
  sets: Object.keys(sets).length,
  points,
  monthPoints,
  drawableSeries: `${drawable}/${Object.keys(sets).length * 2}`,
  windowsUsed,
  range: dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : null,
};
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
