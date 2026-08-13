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
// 초판(Blue)처럼 몇 달에 몇 건뿐인 계열은 56일로는 점이 하나도 안 나온다.
// 이런 계열만 창을 더 늘린다 — 창 길이는 화면에 그대로 표시되므로 얼마나 넓게 평균했는지 드러난다.
const RARE_MAX_WINDOW = 120;
const STEP_DAYS = 7;      // 주 단위면 4개월치가 17점 남짓 — 선이 읽히면서 파일도 가볍다
const MIN_N = 6;          // 창을 최대로 늘려도 이만큼 안 모이면 점을 찍지 않는다. 빈 구간이 틀린 값보다 낫다.

// 이 그래프는 **즉시구매 시세**다. 경매 낙찰가는 입찰이 안 붙으면 시세보다 훨씬 낮게 끝나
// 섞으면 시세가 아니라 잡음이 된다(2026-08-13: OP-01 일본판 한 세트에만 경매 69건이 섞여 있었다).
// 경매는 별도로 모은다.
//
// fmt 는 2026-08-13 부터 수집한다. 그 이전 레코드는 오늘 즉구 목록에 다시 나타난 것만 소급 표시됐다 —
// eBay 가 sold 를 90일까지만 보여줘서, 그보다 오래된 판매는 즉구였는지 확인할 방법이 없다.
// 확인 안 된 건 버린다. 시계열이 짧아지지만, 경매가 섞인 시세보다 짧고 정확한 쪽이 낫다.
const BIN_ONLY = true;

const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const quant = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

function seriesFor(records, wave) {
  const rs = (records || [])
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number.isFinite(Number(r.unit)) && Number(r.unit) > 0)
    .filter((r) => !BIN_ONLY || r.fmt === "bin")
    .filter((r) => (wave === "blue" ? isFirstPrint(r) : wave === "white" ? !isFirstPrint(r) : true))
    .map((r) => ({ t: Date.parse(r.d), unit: Number(r.unit) }))
    .sort((a, b) => a.t - b.t);
  // 초판(Blue)은 몇 달에 4건뿐이라 일반 기준(6건)으로는 아무것도 안 나온다.
  // 이 계열만 3건으로 낮춘다 — 얇은 건 사실이라, 화면에 n 과 창 길이를 그대로 실어 보낸다.
  const minN = wave === "blue" ? 3 : MIN_N;
  if (rs.length < minN) return { points: [], windowDays: null };

  const first = rs[0].t, last = rs[rs.length - 1].t;

  // 이 계열의 거래 밀도로 창을 정한다. 최근 8주만 보고 고른다 — 옛날에 활발했다가
  // 지금 조용해진 세트에 짧은 창을 물려주면 최근 구간이 통째로 비어버린다.
  const recentFrom = last - 56 * DAY;
  const recent = rs.filter((r) => r.t > recentFrom).length;
  const spanDays = Math.max(1, Math.min(56, (last - first) / DAY));
  const perDay = recent / spanDays;
  const need = perDay > 0 ? Math.ceil(TARGET_N / perDay / 7) * 7 : MAX_WINDOW;
  const cap = wave === "blue" ? RARE_MAX_WINDOW : MAX_WINDOW;
  const windowDays = Math.max(MIN_WINDOW, Math.min(cap, need));

  const at = (t) => {
    const lo = t - windowDays * DAY;
    const u = [];
    for (const r of rs) { if (r.t > lo && r.t <= t) u.push(r.unit); }
    if (u.length < minN) return null;
    // vol = 그 점 **직전 한 주**에 실제로 팔린 건수. 중앙값을 만든 n(창 전체, 28~56일)과 다르다.
    // n 을 막대로 쓰면 창이 겹쳐 같은 판매를 여러 번 세게 되고, 막대 높이가 창 길이만 반영한다.
    let vol = 0;
    const volLo = t - STEP_DAYS * DAY;
    for (const r of rs) { if (r.t > volLo && r.t <= t) vol++; }
    return { d: iso(t), median: Math.round(quant(u, 0.5)), low: Math.round(quant(u, 0.25)), high: Math.round(quant(u, 0.75)), n: u.length, vol };
  };

  // 격자는 **마지막 판매일에서 거꾸로** 잡는다. 앞에서부터 7일씩 세면 마지막 점이 격자에 안 걸려
  // 따로 끼워 넣게 되는데, 그러면 직전 점과 며칠밖에 안 떨어진 점이 하나 더 생겨
  // 창이 거의 같은데도 값이 달라 보이는 절벽이 만들어진다(OP-01 일본판 $290 → $258, 2026-08-13 실측).
  // 뒤에서부터 세면 마지막 점이 항상 격자 위에 있고, 점 간격도 일정해진다.
  // 창이 관측 기간보다 길 수 있다(초판처럼 창을 120일까지 늘린 계열). 그때 `first + 창` 을
  // 그대로 하한으로 쓰면 루프가 한 번도 안 돌아 점이 0개가 된다 — 최소한 마지막 날 한 점은 찍는다.
  const floor = Math.min(first + windowDays * DAY, last);
  const points = [];
  for (let t = last; t >= floor; t -= STEP_DAYS * DAY) {
    const p = at(t);
    if (p) points.push(p);
  }
  points.reverse();

  // 끊긴 앞부분은 버린다. 카테고리 필터를 켠 뒤 아주 오래된 판매가 한두 건씩 딸려 오는데,
  // 그런 고립된 점과 최근 구간을 선으로 이으면 없던 추세가 생긴다
  // (2026-08-13: OP-01 일본판이 2/1 $140 한 점 뒤 4개월 공백, 그다음 6/14 $286 — 선이 그 사이를 곧게 이었다).
  // 점 간격이 창 길이를 넘으면 그 지점에서 잘라 **끊김 없이 이어지는 최근 구간**만 남긴다.
  const maxGap = windowDays * DAY;
  let cut = 0;
  for (let i = points.length - 1; i > 0; i--) {
    if (Date.parse(points[i].d) - Date.parse(points[i - 1].d) > maxGap) { cut = i; break; }
  }
  return { points: points.slice(cut), windowDays };
}

// 월간은 롤링이 아니라 **그 달에 팔린 것 전부**의 중앙값이다.
// 왜 같이 내보내나: 개별 거래 분산이 큰 세트가 있다. OP-01 일본판은 같은 4주 안에서 $105 부터
// $395 까지 팔린다(상태·경매 종료가 차이). 표본 13건짜리 주간 중앙값은 그 안에서 계속 흔들린다.
// 달 단위로 묶으면 표본이 두세 배가 되어 흔들림이 줄고, 대신 반응은 느려진다 — 둘 다 보여주고 고르게 한다.
const MONTH_MIN_N = 6;
function monthlyFor(records, wave) {
  const buckets = new Map();
  for (const r of records || []) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.d) || !(Number(r.unit) > 0)) continue;
    if (BIN_ONLY && r.fmt !== "bin") continue;
    if (wave === "blue" && !isFirstPrint(r)) continue;
    if (wave === "white" && isFirstPrint(r)) continue;
    const k = r.d.slice(0, 7);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(Number(r.unit));
  }
  // 진행 중인 달은 아직 다 안 팔렸으니 문턱을 낮춰 넣는다 — 안 그러면 8월 중순에 7월이 최신으로 보인다.
  // 다만 한 단계만 낮춘다 — 3건짜리 중앙값을 넣었더니 OP-01 일본판 8월이 $275 → $176 으로
  // 36% 급락한 것처럼 그려졌다. 표본 수(n)는 그대로 실어 보내 얼마나 얇은 값인지 화면에서 드러나게 한다.
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthGap = (a, b) => {
    const [ay, am] = a.split("-").map(Number), [by, bm] = b.split("-").map(Number);
    return (by * 12 + bm) - (ay * 12 + am);
  };
  const rows = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([k, u]) => u.length >= (k === thisMonth ? MONTH_MIN_N - 1 : MONTH_MIN_N))
    .map(([k, u]) => ({
      // 월간은 겹치지 않는 버킷이라 n 이 곧 그 달 거래량이다.
      d: k + "-01", median: Math.round(quant(u, 0.5)), low: Math.round(quant(u, 0.25)),
      high: Math.round(quant(u, 0.75)), n: u.length, vol: u.length,
    }));
  // 달이 두 칸 이상 비면 그 앞은 버린다 — 주간과 같은 이유다(고립된 옛 점이 가짜 추세를 만든다).
  let cut = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (monthGap(rows[i - 1].d.slice(0, 7), rows[i].d.slice(0, 7)) > 2) { cut = i; break; }
  }
  return rows.slice(cut);
}

// 일별 — 그날 팔린 것만 센다. 롤링이 아니다.
// 박스는 하루 0.45건(중앙값 계열)이라 대부분의 날이 비어 있다. 그게 사실이므로 억지로 채우지 않는다:
// **3건 이상 팔린 날만** 점을 찍고, 나머지는 비운다. 1~2건짜리 "중앙값" 은 그날 팔린 한 건의 가격일 뿐이다.
const DAY_MIN_N = 3;
function dailyFor(records, wave) {
  const buckets = new Map();
  for (const r of records || []) {
    if (!r || !/^\d{4}-\d{2}-\d{2}$/.test(r.d) || !(Number(r.unit) > 0)) continue;
    if (BIN_ONLY && r.fmt !== "bin") continue;
    if (wave === "blue" && !isFirstPrint(r)) continue;
    if (wave === "white" && isFirstPrint(r)) continue;
    if (!buckets.has(r.d)) buckets.set(r.d, []);
    buckets.get(r.d).push(Number(r.unit));
  }
  const rows = [...buckets.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .filter(([, u]) => u.length >= DAY_MIN_N)
    .map(([d, u]) => ({
      d, median: Math.round(quant(u, 0.5)), low: Math.round(quant(u, 0.25)),
      high: Math.round(quant(u, 0.75)), n: u.length, vol: u.length,
    }));
  // 앞쪽에 뚝 떨어진 점 하나가 남으면 선이 그 사이를 곧게 이어 없던 추세를 만든다(주간·월간과 같은 이유).
  let cut = 0;
  for (let i = rows.length - 1; i > 0; i--) {
    if (Date.parse(rows[i].d) - Date.parse(rows[i - 1].d) > 21 * DAY) { cut = i; break; }
  }
  return rows.slice(cut);
}

// 진행 중 매물 수(공급)는 tools/update-supply-series.js 가 매일 쌓는다.
// 가격과 함께 한 파일로 실어 보낸다 — 화면이 요청을 두 번 하지 않게. 원본(347KB)에서
// 날짜와 jp/en 매물 수만 뽑는다. 나머지 필드(신규·이탈·판매자 구성)는 이 그래프가 안 쓴다.
//
// ⚠️ 이건 "팔린 개수"가 아니라 "지금 올라와 있는 개수"다. 절대 거래량으로 표기하지 말 것.
let SUPPLY = { sets: {} };
try { SUPPLY = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "supply-series.json"), "utf8")); } catch (e) {}
function supplyFor(code) {
  const pts = ((SUPPLY.sets || {})[code] || {}).points || [];
  return pts
    .filter((p) => p && /^\d{4}-\d{2}-\d{2}$/.test(p.d) && (Number.isFinite(p.jp) || Number.isFinite(p.en)))
    .map((p) => ({ d: p.d, jp: Number.isFinite(p.jp) ? p.jp : null, en: Number.isFinite(p.en) ? p.en : null }))
    .sort((a, b) => a.d.localeCompare(b.d));
}

// 영문판 OP-01 은 인쇄 차수가 둘이고 **시세가 2~3배 다른 별개 상품**이다.
//   Blue Bottom = Wave 1 = 초판   (우리 실거래 5건 중앙 $4,143 · TCGplayer $5,622)
//   White Bottom = Wave 2 = 재판  (우리 실거래 31건 중앙 $1,561 · TCGplayer $1,526)
// TCGplayer 도 TCG Quant 도 둘을 별개 상품으로 관리한다.
//
// 그래서 **따로 그린다**. 한 선에 섞으면 재판 시세에 초판 몇 건이 얹혀 위쪽이 부풀고,
// 무엇보다 "영문판 박스 시세"가 무엇을 가리키는지 알 수 없어진다.
// 초판은 거래가 드물어(4건) 창을 넓게 잡아야 점이 나온다 — 못 그리면 요약 줄의 숫자만 남는다.
//
// 2026-08-13 정정: 처음엔 Blue 와 White 를 뭉뚱그려 "초판" 하나로 셌다. 정반대였다 —
// 우리 영문판 실거래의 다수는 White(재판)다.
const WAVE1_BLUE = /\b(blue\s*bottom|wave\s*1)\b/i;
const WAVE2_WHITE = /\b(white\s*bottom|wave\s*2)\b/i;
const isFirstPrint = (r) => WAVE1_BLUE.test((r && r.title) || "");

// 선에서 뺀 초판을 "지금 얼마"로만 요약한다. 최근 90일 실거래의 중앙값.
function firstPrintSpot(records) {
  const rs = (records || []).filter((r) => r && r.fmt === "bin" && isFirstPrint(r));
  if (rs.length < 3) return null;
  const recent = rs.slice(-12).map((r) => r.unit).sort((a, b) => a - b);
  return { median: Math.round(quant(recent, 0.5)), n: rs.length, last: rs[rs.length - 1].d };
}

// 남은 선이 재판 위주인지 알려준다 — 어느 쪽을 보고 있는지 화면에 적기 위한 값.
function reprintShare(records) {
  const rs = (records || []).filter((r) => r && r.fmt === "bin" && !isFirstPrint(r));
  if (rs.length < 5) return null;
  const white = rs.filter((r) => WAVE2_WHITE.test(r.title || "")).length;
  return white ? Math.round((white / rs.length) * 100) : null;
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const today = new Date().toISOString().slice(0, 10);

const sets = {};
let points = 0, drawable = 0;
const windowsUsed = {};
let monthPoints = 0;
let dayPoints = 0;
for (const [code, eds] of Object.entries(ledger.sets || {})) {
  const jp = seriesFor(eds.jp), en = seriesFor(eds.en, "white"), enBlue = seriesFor(eds.en, "blue");
  if (!jp.points.length && !en.points.length) continue;
  const mJp = monthlyFor(eds.jp), mEn = monthlyFor(eds.en, "white"), mEnBlue = monthlyFor(eds.en, "blue");
  const dJp = dailyFor(eds.jp), dEn = dailyFor(eds.en, "white"), dEnBlue = dailyFor(eds.en, "blue");
  sets[code] = {
    // 기존 키(jp/en)는 그대로 둔다 — 주간이 기본 보기이고, 이 키를 읽는 곳이 여럿이다.
    jp: jp.points, en: en.points, enBlue: enBlue.points,
    windowDays: { jp: jp.windowDays, en: en.windowDays, enBlue: enBlue.windowDays },
    monthly: { jp: mJp, en: mEn, enBlue: mEnBlue },
    daily: { jp: dJp, en: dEn, enBlue: dEnBlue },
    supply: supplyFor(code),
    reprintPct: { jp: reprintShare(eds.jp), en: reprintShare(eds.en) },
    firstPrint: { jp: firstPrintSpot(eds.jp), en: firstPrintSpot(eds.en) },
  };
  points += jp.points.length + en.points.length;
  monthPoints += mJp.length + mEn.length;
  dayPoints += dJp.length + dEn.length;
  for (const s of [jp, en]) {
    if (s.points.length >= 3) { drawable++; windowsUsed[s.windowDays] = (windowsUsed[s.windowDays] || 0) + 1; }
  }
}

const store = {
  note: `Rolling median of individual completed eBay sales of sealed One Piece booster boxes, sampled every ${STEP_DAYS} days and dated by SALE date (not collection date). The averaging window is chosen per series (${MIN_WINDOW}-${MAX_WINDOW} days) so that each point rests on roughly ${TARGET_N} sales, because sales volume differs more than tenfold between sets; each series records the window it used. Rebuilt from data/box-sold-ledger.json on every run, so a change in how listings are collected cannot show up as a price move. Windows with fewer than ${MIN_N} sales are omitted rather than estimated. Only fixed-price (Buy It Now) sales are included; auction results are collected separately and excluded, because an auction that draws no bidding closes far below the going rate. Prices are per box in USD. A monthly view (median of every sale within each calendar month, minimum ${MONTH_MIN_N} sales) is included alongside, because sets with wide dispersion between individual sales are steadier when grouped by month.`,
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
  dayPoints,
  drawableSeries: `${drawable}/${Object.keys(sets).length * 2}`,
  windowsUsed,
  range: dates.length ? `${dates[0]} ~ ${dates[dates.length - 1]}` : null,
};
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
