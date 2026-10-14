// Pure, offline checks: responsive presentation must not fabricate data.
const assert = require("node:assert/strict");
const { chartHTML, clean, CSS } = require("../box-chart");

const points = [
  { d: "2026-08-01", median: 100, n: 8 },
  { d: "2026-08-08", median: 120, n: 8 },
  { d: "2026-08-15", median: 90, n: 8 },
];
const before = JSON.stringify(points);
const html = chartHTML({ jp: points }, { lang: "en", today: "2026-08-30" });
assert.equal(JSON.stringify(points), before, "rendering never mutates source data");
assert.match(html, /data-v="\$100"/);
assert.match(html, /data-v="\$120"/);
assert.match(html, /data-v="\$90"/);
assert.match(html, /opbcFlag/);
assert.match(html, /role="img"/);
assert.equal(chartHTML({ jp: [] }), "", "empty series is not zero-filled");
assert.equal(clean([...points, { d: "2026-08-22", median: 110, n: 1 }]).length, 3, "thin samples stay excluded");
assert.doesNotMatch(html, /class="opbcBar/, "no count source → no volume bars (nothing is derived from price points)");

// ── 2026-10-14: 거래량 막대는 달력 칸마다(0건 칸 포함), 색 하나, 원장 집계일(through) 뒤는 그리지 않는다.
const pane = (h, grain, label) => {
  const i = h.indexOf('opbcGridWrap" data-grain="' + grain + '"');
  assert.ok(i >= 0, grain + " grid exists");
  const rest = h.slice(i);
  const end = rest.indexOf('<div class="opbcGridWrap', 10);
  const grid = end < 0 ? rest : rest.slice(0, end);
  const p = grid.split('<figure class="opbcPane').slice(1).find((x) => x.includes('opbcLabel">' + label + "<"));
  assert.ok(p, grain + " " + label + " pane exists");
  return p;
};
const weekly = (from, n, med) => Array.from({ length: n }, (_, i) => ({ d: new Date(Date.parse(from) + i * 7 * 864e5).toISOString().slice(0, 10), median: med(i), n: 12 }));
// 두꺼운 계열: 월요일 2026-07-06 주부터 매주 7건(월 3·수 2·금 2 — 묶음 기준 6건 이상), 단 07-20 주는 0건.
const thickCounts = {};
for (let t = Date.parse("2026-07-06"); t <= Date.parse("2026-08-26"); t += 864e5) {
  const d = new Date(t).toISOString().slice(0, 10);
  if (d >= "2026-07-20" && d <= "2026-07-26") continue;
  if (new Date(t).getUTCDay() % 2) thickCounts[d] = (new Date(t).getUTCDay() === 1 ? 3 : 2);
}
thickCounts["2026-09-02"] = 4;   // through 뒤 — 세면 안 된다
const thick = {
  en: weekly("2026-07-08", 8, (i) => 1000 + i * 3),
  counts: { through: "2026-08-26", en: thickCounts },
};
const h2 = chartHTML(thick, { lang: "en", today: "2026-08-28" });
const wk = pane(h2, "week", "English");
const barCount = (p) => (p.match(/<rect class="opbcBar[ "]/g) || []).length;
// 07-06 ~ 08-24 주 = 8칸 (through 08-26 이 든 08-24 주 포함), 09-02 판매는 없음.
assert.equal(barCount(wk), 8, "one bar per calendar week from the first point's week to the ledger date");
assert.match(wk, /opbcBar opbcBar0"/, "a zero-sale week is a 2px floor bar, not a hole");
assert.match(wk, /opbcBarN"[^>]*>0<\/text>/, "zero-sale week is labelled 0");
assert.match(wk, /opbcBarPart/, "the week holding the ledger date is drawn as in progress");
assert.doesNotMatch(wk, /fill="#(00e5a0|ff5f6e)"/, "volume bars use one neutral colour");
assert.doesNotMatch(wk, /Sales 09\//, "days after the ledger date are not counted");
assert.match(wk, /Sales \/ week/);

// 얇은 계열(완료 주 중앙값 < 3) → 겹치지 않는 4주 묶음, 라벨은 날짜 범위.
const thinCounts = {};
for (let t = Date.parse("2026-06-01"); t <= Date.parse("2026-08-30"); t += 9 * 864e5) thinCounts[new Date(t).toISOString().slice(0, 10)] = 1;
const thin = { jp: weekly("2026-06-03", 13, (i) => 300 + (i % 3)), counts: { through: "2026-08-30", jp: thinCounts } };
const h3 = chartHTML(thin, { lang: "en", today: "2026-08-30" });
const tw = pane(h3, "week", "Japanese");
assert.match(tw, /Sales \/ 4 weeks/, "thin series switch to 4-week bundles");
assert.equal(barCount(tw), 4, "13 calendar weeks → 4 bundles");
assert.match(tw, /data-l="Sales 06\/01–06\/28: \d+ sales?"/, "bundle label is its date range");

// 안쪽 빠진 점은 잇지 않는다 — 선이 두 조각, 사이는 빗금 + '<6'.
const gap = { jp: [...weekly("2026-07-01", 3, () => 200), ...weekly("2026-08-05", 3, () => 210)] };
gap.counts = { through: "2026-08-20", jp: { "2026-07-02": 6, "2026-08-06": 6 } };
const gw = pane(chartHTML(gap, { lang: "en", today: "2026-08-20" }), "week", "Japanese");
assert.equal((gw.match(/opbcLine opbcDraw/g) || []).length, 2, "a missing weekly point splits the line");
assert.match(gw, /opbcGap/, "the missing span is hatched");
assert.match(gw, /&lt;6 sales/, "and labelled with the sample floor");

// 월간: 진행 중인 달은 테두리 + 'M/1–M/D', 점이 없는 달은 '<6' 빗금. 등락은 탭과 무관하게 주간 기준 하나.
const mser = {
  jp: weekly("2026-06-03", 15, (i) => 300 + i),
  monthly: { jp: [{ d: "2026-06-01", median: 300, n: 9 }, { d: "2026-07-01", median: 310, n: 8 }] },
  counts: { through: "2026-09-10", jp: { "2026-06-05": 9, "2026-07-03": 8, "2026-08-04": 3, "2026-09-02": 2 } },
};
const hm = chartHTML(mser, { lang: "en", today: "2026-09-10" });
const mp = pane(hm, "month", "Japanese");
assert.equal(barCount(mp), 4, "every calendar month gets a bar, including months under the floor");
assert.match(mp, /opbcBarPart/, "the current month is an outline bar");
assert.match(mp, />09\/1–09\/10<\/text>/, "in-progress month is labelled with the counted span");
assert.match(mp, /opbcGap/, "months without a price point are hatched, not dropped");
const tagOf = (p) => (p.match(/opbcChg (\w+)">.\s([\d.]+)% <small class="opbcChgTag">([^<]+)/) || []).slice(1).join(" ");
// 2026-10-14 QA: 월간 마지막 점(7월)이 28일 넘게 묵었다 → 칩과 같은 규칙으로 흐리게 + 'Jul', 등락은 숨긴다.
assert.match(mp, /opbcNow opbcNowStale"/, "a monthly headline older than 28 days is dimmed");
assert.match(mp, /<small class="opbcAsOf">Jul<\/small>/, "and carries its as-of label");
assert.doesNotMatch(mp, /class="opbcChg /, "and hides the change");
// 진행 중인 달(9월)은 빗금이 아니라 테두리 — 빗금은 점이 없는 완료된 달(8월)까지만.
const gapEnds = [...mp.matchAll(/class="opbcStale opbcGap" x="([\d.]+)" y="\d+" width="([\d.]+)"/g)].map((m) => Number(m[1]) + Number(m[2]));
const augBar = mp.match(/<rect class="opbcBar[^"]*" x="([\d.]+)" y="[\d.]+" width="([\d.]+)"[^>]*data-s="2026-08-01"/);
assert.ok(augBar, "August bar carries its day span");
const augCx = Number(augBar[1]) + Number(augBar[2]) / 2;
assert.ok(gapEnds.length && Math.max(...gapEnds) <= augCx + 1, "hatch stops at the last completed month; the in-progress month is not hatched");
// 주간 계열 등락을 다른 탭에 쓰면 기준을 적는다 — 월간 점이 신선할 때(8/20 기준 7월 점은 20일 전).
const hm2 = chartHTML(mser, { lang: "en", today: "2026-08-20" });
const wkTag = tagOf(pane(hm2, "week", "Japanese"));
assert.ok(wkTag, "weekly change exists");
assert.match(pane(hm2, "month", "Japanese"), /opbcChgTag">weekly /, "monthly tab labels the weekly basis of its change");
assert.doesNotMatch(pane(hm2, "week", "Japanese"), /opbcChgTag">weekly /, "the weekly tab needs no basis label");

// 일간: 막대는 매일(1~2건 날 포함), 가격 점은 3건 이상인 날만, 하루 넘게 비면 선을 끊는다.
const dser = {
  en: weekly("2026-08-01", 4, () => 100),
  daily: { en: [{ d: "2026-08-10", median: 100, n: 3 }, { d: "2026-08-11", median: 101, n: 4 }, { d: "2026-08-14", median: 99, n: 3 }, { d: "2026-08-15", median: 98, n: 3 }] },
  counts: { through: "2026-08-16", en: { "2026-08-10": 3, "2026-08-11": 4, "2026-08-12": 1, "2026-08-14": 3, "2026-08-15": 3 } },
};
const dp = pane(chartHTML(dser, { lang: "en", today: "2026-08-16" }), "day", "English");
assert.equal(barCount(dp), 7, "a bar for each day 08/10–08/16");
assert.match(dp, /Sales 08\/12: 1 sale"/, "1-sale days still get a bar");
assert.equal((dp.match(/opbcLine opbcDraw/g) || []).length, 2, "a day without a price point breaks the daily line");

// 공급: 빠진 날에서 선을 끊고 빗금. 보간 없음.
const sup = { jp: weekly("2026-08-01", 4, () => 100), supply: [
  { d: "2026-08-01", jp: 10, en: 20 }, { d: "2026-08-02", jp: 11, en: 21 }, { d: "2026-08-03", jp: 12, en: 22 },
  { d: "2026-08-06", jp: 13, en: 23 }, { d: "2026-08-07", jp: 12, en: 22 },
] };
const sh = chartHTML(sup, { lang: "en", today: "2026-08-07" });
const sp = sh.slice(sh.indexOf("opbcSupply"));
assert.equal((sp.match(/opbcSupLine/g) || []).length, 4, "each supply line splits at the missing days");
assert.match(sp, /opbcGap/, "missing collection days are hatched");
assert.match(sp, /not collected/);

// ── 2026-10-14 QA 반영
// ① 주간 x 라벨: 끝 라벨은 축 끝(오늘), 점이 왼쪽에 몰리면 가운데 라벨은 뺀다(OP-02 일본판 06/16~07/07, 축은 10/14까지).
const clustered = { jp: weekly("2026-06-16", 4, () => 147), counts: { through: "2026-10-14", jp: { "2026-06-16": 6, "2026-07-07": 6, "2026-10-10": 2 } } };
const cw = pane(chartHTML(clustered, { lang: "en", today: "2026-10-14" }), "week", "Japanese");
const xLabels = [...cw.matchAll(/<text class="opbcAx" x="[\d.]+" y="348" text-anchor="(\w+)">([^<]+)<\/text>/g)].map((m) => m[1] + ":" + m[2]);
assert.deepEqual(xLabels, ["start:06/16", "end:10/14"], "axis-end label is today and the crowded middle label is dropped");
// ② 마지막 점이 28일 넘게 묵은 주간 헤드라인: 흐리게 + 'MM/DD', 등락 없음(홈 칩과 같은 규칙).
assert.match(cw, /opbcNow opbcNowStale"/);
assert.match(cw, /<small class="opbcAsOf">07\/07<\/small>/);
assert.doesNotMatch(cw, /class="opbcChg /);
// ③ 빗금 안 글자는 없다(범례에만).
assert.doesNotMatch(cw, /class="opbcStaleTx"[^>]*>&lt;6/, "no '<6 sales' text inside the hatch");
// ④ 판독 줄용 날짜: 가격 점은 data-t(전체 날짜), 막대는 data-s/data-e(칸 구간).
assert.match(cw, /class="opbcHitDot"[^>]*data-t="2026-07-07"/);
assert.match(cw, /class="opbcBar[^"]*"[^>]*data-s="\d{4}-\d{2}-\d{2}" data-e="\d{4}-\d{2}-\d{2}"/);
// ⑤ 주 판매 중앙값 6건 미만(주 4건)은 4주 묶음.
const mid4 = {};
for (let t = Date.parse("2026-06-01"); t <= Date.parse("2026-08-30"); t += 864e5) { const wd = new Date(t).getUTCDay(); if (wd === 1 || wd === 3) mid4[new Date(t).toISOString().slice(0, 10)] = 2; }
assert.match(pane(chartHTML({ jp: weekly("2026-06-03", 13, () => 300), counts: { through: "2026-08-30", jp: mid4 } }, { lang: "en", today: "2026-08-30" }), "week", "Japanese"), /Sales \/ 4 weeks/, "median 4 sales a week is bundled");
// ⑥ 일간 점이 있는 날이 구간의 절반 미만이면 일간 패널 대신 안내(선 조각을 그리지 않는다) — 다른 판도 일간이 없으면 탭이 없다.
const sparseDaily = { en: weekly("2026-08-01", 6, () => 100), daily: { en: [{ d: "2026-08-01", median: 100, n: 3 }, { d: "2026-08-09", median: 101, n: 3 }, { d: "2026-08-20", median: 99, n: 4 }, { d: "2026-08-30", median: 98, n: 3 }] }, counts: { through: "2026-09-05", en: { "2026-08-01": 3, "2026-08-09": 3, "2026-08-20": 4, "2026-08-30": 3 } } };
assert.doesNotMatch(chartHTML(sparseDaily, { lang: "en", today: "2026-09-05" }), /data-grain="day"/, "sparse daily points do not get a daily panel");
// ⑦ 첫 막대 숫자가 SVG 왼쪽 밖으로 나가지 않는다(OP-16 영문 월간 '|52').
const mFirst = { en: weekly("2026-05-06", 20, () => 900), monthly: { en: [{ d: "2026-05-01", median: 900, n: 152 }, { d: "2026-06-01", median: 910, n: 40 }, { d: "2026-07-01", median: 905, n: 40 }] }, counts: { through: "2026-07-20", en: { "2026-05-10": 152, "2026-06-10": 40, "2026-07-10": 40 } } };
const firstN = pane(chartHTML(mFirst, { lang: "en", today: "2026-07-20" }), "month", "English").match(/opbcBarN" x="([\d.]+)"[^>]*>152</);
assert.ok(firstN && Number(firstN[1]) >= 3 * 0.6 * 38 / 2, "first bar number stays inside the SVG at the largest axis font");
// ⑧ 영문만 넘긴 공급 패널에는 'JP -' 범례가 없다.
const enSup = chartHTML({ en: weekly("2026-08-01", 4, () => 100), supply: [{ d: "2026-08-01", en: 20 }, { d: "2026-08-02", en: 21 }, { d: "2026-08-03", en: 22 }] }, { lang: "en", today: "2026-08-03" });
assert.doesNotMatch(enSup.slice(enSup.indexOf("opbcSupply")), />JP /, "no empty JP legend on an English-only supply panel");

assert.match(CSS, /container:boxplot \/ inline-size/);
assert.match(CSS, /@container boxplot/);
assert.match(CSS, /prefers-reduced-motion:no-preference/);
assert.match(CSS, /\.opbcReadout\{[^}]*font-size:13px/);
console.log("Box chart UI tests passed: values, calendar volume bars, zero weeks, bundles, gaps, monthly/daily rules, supply gaps, motion and readout");
