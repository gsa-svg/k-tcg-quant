#!/usr/bin/env node
// tcg-auction.html — 카드게임 13종의 eBay 경매 시장을 숫자·표·그래프로만 보여준다 — 2026-10-13 재설계.
//
// ── 소유자 지시(2026-10-13)
// 보는 사람이 숫자를 보고 "TCG 경매 시장이 지금 이렇게 흘러간다"를 각자 판단한다. 우리가 쓴 문장
// (요약·해설·경고 문단)은 넣지 않는다. 글자는 제목·열 이름·기간 라벨·정의 한 토막·링크뿐이다.
// 종전의 작업량 타일 5개, 토글 234조합(게임×기간×지표), Coverage/Unsold/Checked 같은 내부 열은 뺐다.
//
// ── 구조
//   ① h1 + 제휴 고지(AFF_TOP, 첫 제휴 링크보다 앞 — 가드 E1)
//   ② This week: 전 게임 합산 최근 7일 vs 직전 7일 — Sell rate / Median sold price / Auctions closing per day
//   ③ 게임 순위표(최근 4주 vs 직전 4주 — 2026-10-14): Sell rate · vs prior 4 weeks · Median sold price · Closing per day
//      · Trend(4주 이동 합산 낙찰률 스파크라인)
//   ④ Sell rate by week: 전 게임 합산 막대(완전한 주만 최대 13주, 막대 아래 표준 표본일 'n/7', 토글 없음)
//   ⑤ Median sold price by game: 가로 막대(③과 같은 4주 창)
//   ⑥ raw CSV · How we count 링크
//
// ── 데이터(전부 data/ 에서 파생, 추정·하드코딩 없음)
//   data/tcg-series.json   게임 × 날짜: endingToday(eBay 가 알려준 실제 종료 수) · offHour(다른 시각 표본일 표시)
//   data/tcg-archive/*.json 정산 원장(종료일 파일) — 낙찰률·중앙 낙찰가는 전부 여기서 직접 센다. 중앙가는 낙찰 건을 한 줄로
//                           세워 자른다(일별 중앙값의 중앙값은 중앙값이 아니다).
//   진행 중인 오늘은 뺀다(2026-10-13 QA: 정산이 덜 된 반쪽 날이 7일 창에 들어갔다 — auction-page-model 과 같은 규칙).
//   표본 하한: 낙찰률은 series.minRateSample(20) 미만이면 "—", 중앙가는 낙찰 20건 미만이면 "—".
//   낙찰률 ± 는 95% 윌슨 구간 반폭(원피스 페이지와 같은 식).
//   제외 게임: tcg-config EXCLUDED_TCG_KEYS(수집 중단 4종).
//   비교값(이번 주 낙찰률·중앙가, 게임표, 주별 막대, 추이, 중앙가 막대)은 "표준 시각 표본"만 센다 — 2026-10-13:
//   · 여유분(원장 extra:true, topup-tcg-watch)은 뺀다. 남는 쿼터로 다른 UTC 회차에 고른 종료 임박 표본이라 표준일에
//     그대로 섞이면 낙찰률이 내려간다(직전 7일 2,210건·18%; 10/11 여유분 17.5% vs 표본 42.7%).
//   · 다른 시각 표본일(series daily offHour — 스냅샷이 tcg-config TCG_SNAPSHOT_STD_HOURS 밖)에 고른 표본은 뺀다
//     (10/8~10/10: 12.3·20.7·22.9%). 표본일은 원장 행의 seen(2026-10-14~), 없으면 보정 파일(data/tcg-archive-seen.json),
//     거기도 없으면 원장 날짜다.
//   하루 종료 경매 수는 eBay 가 알려준 실제 수(표본 아님)라 그대로 둔다. 뺀 날이 있으면 기간 라벨에 "N days excluded",
//   정의는 이번 주 아래 정의 줄에 한 번만 적는다.
//   ⚠️ eBay 의 "Pokemon Card Japanese" 종료 수는 "Pokemon TCG" 안에 들어 있다(snapshot note). 합산 KPI 에서는 뺀다.
//
// Run: node tools/generate-tcg-auction-page.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const OUT = path.join(ROOT, "tcg-auction.html");
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const { navHtml } = require("./site-nav");
const { EXCLUDED_TCG_KEYS, TCGS } = require("./tcg-config");
const { AFF_TOP, epnUrl } = require("./set-page-shared");
const { visibleTrendRows } = require("./tcg-trend-model");
const { weekExplorer } = require("./auction-dashboard-view");
const { readSeenFix, sampleOf } = require("./build-tcg-archive-seen");

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => (n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("en-US"));
const money = (v) => (v == null || !isFinite(v) ? "—" : "$" + (Number.isInteger(v) ? v.toLocaleString("en-US") : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })));
const pct = (v) => (v == null || !isFinite(v) ? "—" : v.toFixed(1) + "%");
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const md = (iso) => { const [, m, d] = iso.split("-").map(Number); return MON[m - 1] + " " + d; };
const mdy = (iso) => md(iso) + ", " + iso.slice(0, 4);
const mdKo = (iso) => { const [, m, d] = iso.split("-").map(Number); return m + "/" + d; };   // 한국어 토글용(auction.html 과 같은 꼴)
const addDays = (iso, n) => { const t = new Date(iso + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekKeyOf = (d) => { const t = new Date(d + "T00:00:00Z"); t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7)); return t.toISOString().slice(0, 10); };
const median = (arr) => { if (!arr.length) return null; const a = arr.slice().sort((x, y) => x - y); return a[Math.floor((a.length - 1) / 2)]; };
const wilson = (s, n) => {
  if (!n) return null;
  const z = 1.96, p = s / n;
  return +((z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n)) / (1 + (z * z) / n)) * 100).toFixed(1);
};

const series = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-series.json"), "utf8"));
const MIN_N = Number.isFinite(series.minRateSample) ? series.minRateSample : 20;   // 낙찰률 표본 하한
const MIN_PRICE_N = 20;                                                            // 중앙 낙찰가 표본 하한
const EXCLUDED = new Set(EXCLUDED_TCG_KEYS);
const CONTAINED = new Set(["pokemonjp"]);   // eBay 종료 수가 pokemon 안에 포함 — 합산 KPI 에서 제외

// 진행 중인 오늘(UTC)은 뺀다 — 정산이 아직 도는 날이라 표본이 반쪽이다(10/13 728건 vs 평소 1,200~2,100건).
const TODAY = new Date().toISOString().slice(0, 10);
const days = (series.daily || []).filter((d) => d && d.d && d.games && d.d < TODAY);
if (days.length < 3) throw new Error("TCG 시계열이 너무 짧다 — 페이지를 만들지 않는다");
const from = days[0].d, to = days[days.length - 1].d;
const dayMap = new Map(days.map((d) => [d.d, d]));
const names = series.games || {};
const GAMES = TCGS.map((g) => g.k).filter((k) => !EXCLUDED.has(k) && days.some((d) => d.games[k]));
const nameOf = (k) => (names[k] && names[k].name) || (TCGS.find((g) => g.k === k) || {}).nm || k;

// ── 표준 시각 밖에서 표본을 고른 날 — 그날 고른 표본을 비교값에서 뺀다(맨 위 주석). closing(eBay 실제 종료 수)에는 쓰지 않는다.
const OFF = new Set(days.filter((r) => r.offHour === true).map((r) => r.d));
const offIn = (dayList) => dayList.filter((d) => OFF.has(d)).length;
// ── 표준 표본일 = 그날 스냅샷(표본을 고른 순간)이 있고 그 시각이 표준 시각 안인 날 — 2026-10-14.
// 주별 막대 아래 'n/7' 과 4주 창의 'n/28' 이 이 날 수다. 스냅샷이 없던 날(8/29·8/30·9/1·9/26)은 그날 고른 표본이 없다 —
// 원장의 그날 행은 앞 날 표본이 늦게 끝난 것뿐이다. 다른 시각 표본일(OFF)은 표본을 뺐으니 세지 않는다.
const SHOT = new Set((JSON.parse(fs.readFileSync(path.join(ROOT, "data", "tcg-snapshot.json"), "utf8")).points || []).map((p) => p.d));
const stdDay = (d) => SHOT.has(d) && !OFF.has(d);

// ── 정산 원장: 종료일 → 게임 → { ended, sold, prices[] } — 표준 시각 표본만(여유분·다른 시각 표본일 제외)
// 표본일 = 행의 seen(2026-10-14~) → 보정 파일(data/tcg-archive-seen.json — git 감시 이력에서 복원, 원장 날짜와 다른 행만)
// → 원장 날짜. 2026-10-14 감사: 보정 전엔 10/14 이전 행을 원장 날짜로 대신해 다른 시각 표본 6,234행이 섞이고
// 표준 표본 1,874행이 빠졌다(10/11 화면 42.7% vs 표본일 기준 38.1%).
const ARCHIVE = path.join(ROOT, "data", "tcg-archive");
// 그날 표본에 들었는데 이미 여유분으로 감시 중이라 원장에 extra 로 남은 행(보정 파일 promoted)은 표본으로 센다 — 2026-10-14 QA
// (표본의 가장 먼저 끝나는 앞부분이 빠졌다). 판정은 build-tcg-series 와 같은 sampleOf.
const SEEN_FIX = readSeenFix(ROOT);
const ledger = {};
let leftExtra = 0, leftOff = 0;
// ⚠️ 정규식의 \d 는 셸을 거치면 d 로 깨진다 — 이 파일은 Edit/Write 도구로만 고치고, 고친 뒤 \d 가 살아있는지 확인할 것.
for (const f of fs.readdirSync(ARCHIVE).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
  const d = f.slice(0, 10);
  if (d >= TODAY) continue;
  const day = JSON.parse(fs.readFileSync(path.join(ARCHIVE, f), "utf8"));
  for (const r of day.sales || []) {
    if (!r || !r.g) continue;
    const smp = sampleOf(r, d, SEEN_FIX);
    if (!smp.base) { leftExtra += 1; continue; }
    if (OFF.has(smp.seen)) { leftOff += 1; continue; }
    const b = ((ledger[d] = ledger[d] || {})[r.g] = ledger[d][r.g] || { ended: 0, sold: 0, prices: [] });
    b.ended += 1;
    if (r.sold !== true) continue;
    b.sold += 1;
    // 통화가 USD 가 아니면 가격에서 뺀다(build-tcg-series 와 같은 규칙 — 환산해 섞으면 어느 시점 환율인지 모른다).
    if (r.currency === "USD" && Number.isFinite(r.price) && r.price > 0) b.prices.push(r.price);
  }
}
const cellOf = (d, k) => (ledger[d] || {})[k] || null;

// ── 7일 창(달력 기준). 기록이 없는 날은 row=null 로 남겨 "Some days missing" 라벨의 근거가 된다.
const windowDays = (end, len) => Array.from({ length: len }, (_, i) => { const d = addDays(end, i - (len - 1)); return { d, row: dayMap.get(d) || null }; });
const W7 = windowDays(to, 7), P7 = windowDays(addDays(to, -7), 7);
const rateOf = (sold, ended) => (ended >= MIN_N ? Math.round((sold / ended) * 1000) / 10 : null);

function gameStats(key, win) {
  let ended = 0, sold = 0, present = 0;
  const closing = [], prices = [];
  for (const { d, row } of win) {
    if (!row) continue;
    const g = row.games[key];
    if (g) {
      present += 1;
      if (Number.isFinite(g.endingToday)) closing.push(g.endingToday);
    }
    const c = cellOf(d, key);
    if (c) { ended += c.ended; sold += c.sold; for (const p of c.prices) prices.push(p); }
  }
  return {
    ended, sold, days: present,
    rate: rateOf(sold, ended),
    ci: ended >= MIN_N ? wilson(sold, ended) : null,
    priceN: prices.length,
    med: prices.length >= MIN_PRICE_N ? median(prices) : null,
    closing: closing.length ? closing.reduce((a, b) => a + b, 0) / closing.length : null,
  };
}
function totalStats(win) {
  let ended = 0, sold = 0, closing = 0, closingKnown = false;
  const prices = [];
  for (const k of GAMES) {
    const s = gameStats(k, win);
    ended += s.ended; sold += s.sold;
    if (!CONTAINED.has(k) && s.closing != null) { closing += s.closing; closingKnown = true; }
    for (const { d, row } of win) { const c = row && cellOf(d, k); if (c) for (const p of c.prices) prices.push(p); }
  }
  return {
    ended, sold,
    rate: rateOf(sold, ended),
    med: prices.length >= MIN_PRICE_N ? median(prices) : null,
    closing: closingKnown ? closing : null,
    missing: win.filter((x) => !x.row).length,
  };
}
const L = totalStats(W7), P = totalStats(P7);
// 뺀 날 수는 창마다 따로 센다 — 14일을 합쳐 적으면 직전 7일에서 뺀 날이 최근 7일에서 빠진 것처럼 읽힌다(2026-10-13 QA).
const offLast7 = offIn(W7.map((x) => x.d)), offPrev7 = offIn(P7.map((x) => x.d));
// 라벨은 "N days excluded" 로 짧게 — 무엇을 뺐는지(정의)는 이번 주 정의 줄에 한 번만 적는다(EXCL_DEF).
const exclSpan = (n) => `<span data-ko="${n}일 제외">${n} day${n === 1 ? "" : "s"} excluded</span>`;
const exclLabel = (a, b = 0) => (a ? ` · ${exclSpan(a)}` : "") + (b ? ` · <span data-ko="직전 7일 ${b}일 제외">${b} excluded in the 7 before</span>` : "");
const dRate = L.rate != null && P.rate != null ? Math.round((L.rate - P.rate) * 10) / 10 : null;
const dMed = L.med != null && P.med != null ? Math.round((L.med - P.med) * 100) / 100 : null;
const dClosing = L.closing != null && P.closing != null ? Math.round(L.closing - P.closing) : null;
const someMissing = L.missing > 0 || P.missing > 0;

// ── 주별(월요일 시작) — 전 게임 합산 막대(마지막 13주) + 게임별 4주 이동 합산 추이.
// 진행 중인 주는 뺀다 — 2026-10-14 감사: 월요일 하루치 44.6% 가 가장 높은 막대였다(요일 효과: 월 45.0 vs 토 34.1).
// 최근 며칠은 상단 7일 KPI 가 맡는다. n = 그 주의 표준 표본일 수(막대 아래 'n/7'). 7 미만인 주도 센 날만의 값을 그대로 싣는다 —
// 빈 날을 메우지 않는다(보간·요일 가중 없음). 주는 첫 완전한 주부터 마지막 완전한 주까지 빠짐없이 깐다(통째로 빈 주도 '0/7').
const weekMap = new Map();
for (const row of days) {
  const wk = weekKeyOf(row.d);
  if (!weekMap.has(wk)) weekMap.set(wk, { d: wk, days: 0, std: 0, ended: 0, sold: 0, games: {} });
  const w = weekMap.get(wk);
  w.days += 1;
  if (stdDay(row.d)) w.std += 1;
  for (const k of GAMES) {
    const c = cellOf(row.d, k);
    if (!c) continue;
    const gw = (w.games[k] = w.games[k] || { ended: 0, sold: 0 });
    gw.ended += c.ended; gw.sold += c.sold;
    w.ended += c.ended; w.sold += c.sold;
  }
}
const MAX_WEEKS = 13;
const currentWeek = weekKeyOf(to);
const lastFullWeek = to === addDays(currentWeek, 6) ? currentWeek : addDays(currentWeek, -7);
// 수집 시작 주(2026-08-07, 목요일)는 3일짜리 영구 반쪽 주라 뺀다(2026-10-13 QA).
let firstWeek = weekKeyOf(from);
if ((weekMap.get(firstWeek) || { days: 0 }).days < 7) firstWeek = addDays(firstWeek, 7);
const fullWeeks = [];
for (let k = firstWeek; k <= lastFullWeek; k = addDays(k, 7)) fullWeeks.push(weekMap.get(k) || { d: k, days: 0, std: 0, ended: 0, sold: 0, games: {} });
const weeklyTotal = visibleTrendRows(fullWeeks.slice(-MAX_WEEKS).map((w) => ({ d: w.d, ended: w.ended, sold: w.sold, rate: rateOf(w.sold, w.ended), n: w.std })), "rate");

// ── 게임별 = 최근 4주 vs 직전 4주(마지막 완전한 주까지), 추이 = 4주 이동 합산 낙찰률(그 주까지 4주의 낙찰 ÷ 종료 건수).
// 2026-10-14 감사: 게임마다 하루 표본이 '같은 시각에 끝나는 묶음'이라 유효 표본이 n 보다 훨씬 작아 주별 값이 ±20pt 씩 튀었다
// (인접 주 급등락 중앙값 17.8pt, 'vs last week' +24.4pt). 4주 건수를 합쳐 센다 — 평균·보간이 아니라 건수 합이다.
// 표의 값과 추이의 마지막 점은 같은 4주다. 중앙 낙찰가·하루 종료 경매도 같은 창(표 한 줄 = 한 기간).
const ROLL = 4;
const lastFullEnd = addDays(lastFullWeek, 6);
const W28 = windowDays(lastFullEnd, ROLL * 7), P28 = windowDays(addDays(lastFullEnd, -ROLL * 7), ROLL * 7);
const stdIn = (win) => win.filter((x) => stdDay(x.d)).length;
const rollOf = (list) => list.map((w, i) => {
  if (i < ROLL - 1) return null;
  let ended = 0, sold = 0;
  for (const x of list.slice(i - ROLL + 1, i + 1)) { ended += x.ended; sold += x.sold; }
  return { d: w.d, ended, sold, rate: rateOf(sold, ended) };
}).filter(Boolean).slice(-MAX_WEEKS);
const trendByGame = {};
for (const k of GAMES) trendByGame[k] = visibleTrendRows(rollOf(fullWeeks.map((w) => ({ d: w.d, ...(w.games[k] || { ended: 0, sold: 0 }) }))), "rate");
const trendPoints = Math.max(0, ...GAMES.map((k) => trendByGame[k].length));
const sparkMax = Math.max(10, Math.ceil(Math.max(0, ...GAMES.flatMap((k) => trendByGame[k].map((r) => r.rate).filter((v) => v != null))) / 10) * 10);

// ── 게임 순위표(낙찰률 내림차순, 표본 미달은 맨 아래)
const rows = GAMES.map((k) => {
  const a = gameStats(k, W28), b = gameStats(k, P28);
  return {
    key: k, name: nameOf(k), ...a,
    delta: a.rate != null && b.rate != null ? Math.round((a.rate - b.rate) * 10) / 10 : null,
    weekly: trendByGame[k],
  };
}).sort((a, b) => (b.rate ?? -1) - (a.rate ?? -1) || b.ended - a.ended);

// ── 진행 중 eBay 경매 링크 — 수집기와 같은 검색어(tcg-config q), EPN 수익(2026-10-02).
const TCG_QUERY = new Map(TCGS.map((g) => [g.k, g.q]));
const liveLink = (key) => {
  const q = TCG_QUERY.get(key);
  const url = q && epnUrl(`https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&LH_Auction=1&_sop=1&customid=tcg-${key}`);
  return url ? `<a class="live" href="${esc(url)}" target="_blank" rel="noopener noreferrer sponsored" data-ko="진행 경매 →">Live auctions →</a>` : "";
};

// ── 화살표·차이. 낙찰률·낙찰가는 부호에 따라 ▲(green)·▼(red)·•(muted) — 색은 토큰만.
// 종료 경매 수의 증감은 좋고 나쁨이 없는 값이라 색을 입히지 않는다(muted) — 원피스 페이지와 같다(2026-10-13 QA).
const arrow = (d) => (d == null ? "" : d > 0 ? "▲" : d < 0 ? "▼" : "•");
const cls = (d) => (d == null ? "" : d > 0 ? " up" : d < 0 ? " down" : "");
const ptsDelta = (d) => (d == null ? "—" : `${arrow(d)} ${Math.abs(d).toFixed(1)} pts`);
const ptsDeltaKo = (d) => (d == null ? "—" : `${arrow(d)} ${Math.abs(d).toFixed(1)}%p`);   // 한국어 토글: pts → %p(auction.html 과 같다)
const ptsSpan = (d, className) => `<span class="${className}${cls(d)}" data-ko="${esc(ptsDeltaKo(d))}">${esc(ptsDelta(d))}</span>`;
const moneyDelta = (d) => (d == null ? "—" : `${arrow(d)} ${money(Math.abs(d))}`);
const numDelta = (d) => (d == null ? "—" : `${arrow(d)} ${num(Math.abs(d))}`);

// ── 스파크라인(인라인 SVG 90×28). 값이 없는 주는 선을 끊는다 — 지어내지 않는다.
function sparkline(wk, label) {
  const W = 90, H = 28, PAD = 3;
  const n = wk.length;
  const pts = wk.map((r, i) => (r.rate == null ? null : [PAD + (n > 1 ? (i / (n - 1)) * (W - 2 * PAD) : (W - 2 * PAD) / 2), H - PAD - (r.rate / sparkMax) * (H - 2 * PAD)]));
  const segs = [];
  let cur = [];
  for (const p of pts) { if (p) cur.push(p); else { if (cur.length) segs.push(cur); cur = []; } }
  if (cur.length) segs.push(cur);
  const f = (v) => v.toFixed(1);
  const paths = segs.filter((s) => s.length > 1).map((s) => `<path d="${s.map((p, i) => (i ? "L" : "M") + f(p[0]) + " " + f(p[1])).join(" ")}" />`).join("");
  const dots = segs.filter((s) => s.length === 1).map((s) => `<circle cx="${f(s[0][0])}" cy="${f(s[0][1])}" r="1.8" />`).join("");
  const last = pts.filter(Boolean).pop();
  const end = last ? `<circle cx="${f(last[0])}" cy="${f(last[1])}" r="2.2" />` : "";
  if (!paths && !dots) return `<span class="none">—</span>`;
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(label)}">${paths}${dots}${end}</svg>`;
}
const sparkLabel = (r) => `Sell rate, rolling 4 weeks: ${r.weekly.map((w) => (w.rate == null ? "—" : w.rate.toFixed(1) + "%")).join(", ")}`;

const tableRows = rows.map((r) => {
  const thin = r.rate == null;
  // 모바일 둘째 줄은 열 이름이 없어 값마다 짧은 라벨을 붙인다(2026-10-13 QA: "$213 · 166/day" 가 무엇인지 헤더 없이는 못 읽었다).
  // 증감 앞에도 비교 기준을 붙인다 — "vs prior 4 weeks" 열 머리는 데스크톱에만 있다(2026-10-13 QA).
  const meta = thin
    ? `<span class="sub2 tiny" data-ko="표본 적음">small sample</span>`
    : `<span class="sub2 mOnly"><span data-ko="직전 4주 대비">vs prior 4 weeks</span> ${ptsSpan(r.delta, "d")} · <span data-ko="중앙가 ${esc(money(r.med))}">median ${esc(money(r.med))}</span> · <span data-ko="하루 ${esc(num(r.closing))}건 종료">${esc(num(r.closing))} closing/day</span></span>`;
  return `          <tr data-rate="${r.rate ?? ""}" data-delta="${r.delta ?? ""}" data-price="${r.med ?? ""}" data-closing="${r.closing ?? ""}">
            <td class="l"><span class="nm">${esc(r.name)}</span>${meta}${liveLink(r.key)}</td>
            <td><span class="pv">${esc(pct(r.rate))}</span>${r.ci != null ? `<span class="sub2">±${r.ci.toFixed(1)}</span>` : ""}<span class="sub2" data-ko="표본 ${esc(num(r.ended))}건">n=${esc(num(r.ended))}</span></td>
            <td class="dOnly">${ptsSpan(r.delta, "d")}</td>
            <td class="dOnly">${esc(money(r.med))}</td>
            <td class="dOnly">${esc(num(r.closing))}</td>
            <td class="trend">${sparkline(r.weekly, sparkLabel(r))}</td>
          </tr>`;
}).join("\n");

// ── ④ 주별 막대(전 게임 합산). 눈금은 0·절반·최고(10% 단위 올림) 셋 — 축 하나.
const wkRates = weeklyTotal.map((w) => w.rate).filter((v) => v != null);
const wkTop = Math.max(10, Math.ceil(Math.max(0, ...wkRates) / 10) * 10);
const wkHi = wkRates.length ? Math.max(...wkRates) : null, wkLo = wkRates.length ? Math.min(...wkRates) : null;
// 막대 아래 'n/7' = 표준 표본일 수. 7 미만인 주는 같은 실색 막대 + 윗변만 점선(원피스 auction.html 과 같은 규칙, 2026-10-14 —
// 옅은 사선 막대는 '빠진 주'로 읽혔다).
const wkCols = weeklyTotal.map((w, i) => {
  const isLast = i === weeklyTotal.length - 1;
  const key = isLast || i === 0 || w.rate === wkHi || w.rate === wkLo;
  const title = `Week of ${md(w.d)}: ${pct(w.rate)} sold (${num(w.sold)} of ${num(w.ended)}) · ${w.n}/7 days counted`;
  // 한국어 토글용 툴팁(lang-toggle.js 가 data-ko-title 로 title 을 갈아끼운다).
  const titleKo = `${mdKo(w.d)} 주: 낙찰률 ${pct(w.rate)} (${num(w.ended)}건 중 ${num(w.sold)}건) · ${w.n}/7일 집계`;
  const tt = `title="${esc(title)}" data-ko-title="${esc(titleKo)}"`;
  const dn = `<span class="dn">${w.n}/7</span>`;
  if (w.rate == null) return `<div class="col nul short" ${tt}><span class="v">—</span>${dn}</div>`;
  return `<div class="col${key ? " key" : ""}${w.n < 7 ? " short" : ""}" style="--h:${((w.rate / wkTop) * 100).toFixed(1)}%" ${tt}><span class="v">${w.rate.toFixed(1)}</span><i></i>${dn}</div>`;
}).join("");
const wkFirst = weeklyTotal[0], wkLast = weeklyTotal[weeklyTotal.length - 1], wkMid = weeklyTotal[Math.floor(weeklyTotal.length / 2)];
const axisDate = (iso) => `<span data-ko="${mdKo(iso)}">${md(iso)}</span>`;
const wkAxis = weeklyTotal.length
  ? `<span>${axisDate(wkFirst.d)}</span>${weeklyTotal.length > 2 ? `<span>${axisDate(wkMid.d)}</span>` : ""}<span>${axisDate(wkLast.d)}</span>`
  : "";
const weekAccess = weekExplorer(weeklyTotal.map(w => ({
  date: w.d, rate: w.rate, sold: w.sold,
  statusEn: `${w.n}/7 days`,
  statusKo: `${w.n}/7일`,
})));

// ── ⑤ 게임별 중앙 낙찰가 가로 막대(큰 순, 표본 미달은 맨 아래 "—")
const priced = rows.slice().sort((a, b) => (b.med ?? -1) - (a.med ?? -1) || b.priceN - a.priceN);
const medMax = Math.max(0, ...priced.map((r) => r.med).filter((v) => v != null));
const priceBars = priced.map((r) => `
          <div class="pb" role="listitem">
            <span class="nm">${esc(r.name)}</span>
            <span class="tr"><i style="width:${r.med == null || !medMax ? 0 : ((r.med / medMax) * 100).toFixed(1)}%"></i></span>
            <span class="val">${esc(money(r.med))}${r.med != null ? `<small data-ko="${esc(num(r.priceN))}건 낙찰">${esc(num(r.priceN))} sold</small>` : `<small class="tiny" data-ko="표본 적음">small sample</small>`}</span>
          </div>`).join("");

const rangeLabel = (win) => `${md(win[0].d)} – ${mdy(win[win.length - 1].d)}`;
const rangeKo = (win) => `${mdKo(win[0].d)}–${mdKo(win[win.length - 1].d)}`;
const rangeSpan = (win) => `<span data-ko="${esc(rangeKo(win))}">${esc(rangeLabel(win))}</span>`;
const GAME_COUNT = rows.length;
// 제외일 정의 — 페이지에 한 번만(이번 주 정의 줄). 이번 주 KPI 의 "N days excluded" 라벨이 쓸 때만 싣는다.
const EXCL_DEF = offLast7 || offPrev7
  ? ` · <b data-ko="제외일">Excluded day</b> = <span data-ko="정해진 수집 시각 밖에 표본을 고른 날(낙찰률·낙찰가만 뺌)">sample picked outside the usual hour (dropped from sell rate and sold price only)</span>`
  : "";
// 4주 창의 센 날 — '24/28 days'. 정의(집계한 날)는 이번 주 정의 줄에 한 번만.
const countedSpan = (win) => { const n = stdIn(win); return `<span data-ko="${n}/${win.length}일">${n}/${win.length} days</span>`; };
const RANGE28 = `<span data-ko="최근 4주">Last 4 weeks</span> · ${rangeSpan(W28)} · ${countedSpan(W28)}`;

// 제휴 고지 — 공용 AFF_TOP(가드 E1 이 보는 .affTop)에 한국어 토글용 data-ko-html 만 얹는다(굵은 글씨가 있어 data-ko 로는 못 바꾼다). 문구는 ko/auction.html 과 같다.
const AFF_TOP_KO = `<b>Paid Link:</b> eBay 파트너 네트워크(EPN) 제휴사로서 eBay 링크를 통한 적격 구매가 발생하면 OP Box Index가 수수료를 받습니다.`;
const affTop = AFF_TOP.replace('<p class="affTop">', `<p class="affTop" data-ko-html="${esc(AFF_TOP_KO)}">`);

const ld = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Dataset",
  name: "Trading card game auction results by game",
  description: `eBay auction results across ${GAME_COUNT} trading card games: sell rate, median sold price and auctions closing per day, last 7 days and week by week.`,
  isAccessibleForFree: true,
  // url·license·내려받기(같은 값의 JSON) — 비어 있었다(2026-10-14 W6b).
  url: `${SITE}/tcg-auction.html`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  distribution: [{ "@type": "DataDownload", encodingFormat: "application/json", contentUrl: `${SITE}/opbox-ai-auctions.json` }],
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
  temporalCoverage: `${from}/${to}`,
  dateModified: series.updated || to,
  variableMeasured: ["Sell rate", "Median sold price", "Auctions closing per day", "Sell rate by week"],
});

// 2026-10-15 소유자 결정: "Mixed items and grades; not a same-item price index." 문장을 뺐다 — 같은 뜻을 낙찰가 정의 라벨("mixed items and grades")에 붙였다.
const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />
    <link rel="canonical" href="${SITE}/tcg-auction.html" />
    <title>TCG Auction Results by Card Game — eBay Sold Data</title>
    <meta name="description" content="eBay auction results across ${GAME_COUNT} trading card games: sell rate, median sold price and auctions closing per day, last 7 days and week by week." />
    <meta property="og:title" content="TCG Auction Results by Card Game — eBay Sold Data" />
    <meta property="og:description" content="Sell rate, median sold price and auctions closing per day across ${GAME_COUNT} card games." />
    <meta property="og:url" content="${SITE}/tcg-auction.html" />
    <meta property="og:image" content="${SITE}/og-image.png" />
    <script type="application/ld+json">${ld}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
    <meta name="theme-color" content="#0a0c10" />
    <style>
      /* 토큰만 쓴다(styles.css :root). 모션 없음(hover 색만). 숫자는 tabular-nums. */
      .wrap { max-width: 1040px; margin: 0 auto; padding: 22px 16px 60px; }
      .wrap h1 { max-width: none; margin: 0 0 6px; font-size: clamp(30px, 5vw, 46px); line-height: 1.1; }
      .sub { margin: 0 0 6px; color: var(--muted); font-size: 14px; }
      .wrap .affTop { margin: 0 0 20px; }
      section { margin: 0 0 38px; }
      .secHead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin: 0 0 6px; }
      .secHead h2 { margin: 0; font-size: 18px; }
      .nt { color: var(--muted); font-size: 12.5px; }
      .def { margin: 0 0 12px; color: var(--muted); font-size: 13px; max-width: 760px; }
      .def b { color: var(--ink); font-weight: 600; }
      .up { color: var(--green); }
      .down { color: var(--red); }
      .tiny { color: var(--muted); font-size: 12px; font-weight: 400; }

      /* ② This week — KPI 3개 */
      .strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 760px; margin: 0 0 8px; }
      .kpi { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
      .kpi .lbl { display: block; color: var(--muted); font-size: 12.5px; }
      .kpi b { display: block; margin: 4px 0 2px; font-family: var(--font-display); font-size: clamp(22px, 5.5vw, 30px); font-weight: 800; letter-spacing: -.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
      .kpi .delta { display: block; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
      .kpi .delta.up { color: var(--green); }
      .kpi .delta.down { color: var(--red); }
      .kpi .was { display: block; color: var(--muted); font-size: 12.5px; }

      /* ③ 게임 순위표 — 데스크톱 6열, 모바일(≤640)은 Game·Sell rate·Trend 3열로 접는다(가로 스크롤 없음) */
      table.t { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
      .t th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12.5px; font-weight: 600; white-space: nowrap; vertical-align: bottom; }
      .t th.l, .t td.l { text-align: left; }
      .t td { text-align: right; padding: 10px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
      .t td.l { white-space: normal; }
      .t tbody tr:hover td { background: var(--paper); }
      .t .nm { display: block; color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.3; }
      .t .pv { display: block; color: var(--ink); font-size: 16px; font-weight: 700; }
      .t .sub2 { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 400; }
      .t .sub2 .d { font-weight: 600; }
      .t td.trend { color: var(--accent); vertical-align: middle; }
      .t td.trend .spark path { fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
      .t td.trend .spark circle { fill: currentColor; }
      .t td.trend .none { color: var(--muted); }
      .t .d.up { color: var(--green); }
      .t .d.down { color: var(--red); }
      /* 터치 대상: 링크 높이를 32px 이상으로(2026-10-13 QA) — 색·모션 없이 크기만 */
      a.live { display: inline-block; margin-top: 4px; padding: 7px 0; color: var(--accent); font-size: 12.5px; font-weight: 600; text-decoration: none; }
      a.live:hover, a.live:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
      @media (min-width: 641px) {
        .mOnly { display: none !important; }
        .t th.l { width: 34%; }
      }
      @media (max-width: 640px) {
        .dOnly { display: none !important; }
        .t th, .t td { padding-left: 6px; padding-right: 6px; }
        .t td.trend { padding-right: 0; }
        .strip { gap: 6px; }
        .kpi { padding: 10px 8px; }
        .kpi .lbl { min-height: 2.6em; line-height: 1.3; }   /* 라벨이 1~2줄로 갈려도 큰 숫자 셋이 한 줄에 선다 */
      }

      /* ④ 주별 낙찰률 막대 — 눈금 3개(0·절반·최고), 축 하나 */
      .wk { padding: 12px 14px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); max-width: 760px; }
      .wkHead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 22px; font-size: 13.5px; font-weight: 600; }
      .wkHead .nt { font-weight: 400; }
      .wkPlot { position: relative; height: 170px; margin-left: 38px; border-bottom: 1px solid var(--line); }
      .guide { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--line); }
      .guide span, .zero { position: absolute; left: -38px; width: 34px; text-align: right; color: var(--muted); font-size: 11.5px; line-height: 1; font-variant-numeric: tabular-nums; }
      .guide span { top: -6px; }
      .zero { bottom: -6px; }
      .cols { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 3px; }
      .col { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
      .col i { position: absolute; left: 0; right: 0; bottom: 0; height: var(--h); background: var(--accent); border-radius: 3px 3px 0 0; }
      /* 표준 표본일이 7일 미만인 주: 같은 실색 막대 + 윗변만 점선(틈은 바탕색) + 아래 n/7 — 흐린 칠·사선은 '빠진 막대'로 읽혔다(2026-10-14) */
      .col.short i, .lg .swd { background: repeating-linear-gradient(90deg, var(--accent) 0 4px, transparent 4px 7px) top / 100% 3px no-repeat, linear-gradient(var(--accent), var(--accent)) bottom / 100% calc(100% - 5px) no-repeat; }
      .lg { display: inline-flex; align-items: center; gap: 6px; }
      .lg .swd { display: inline-block; width: 13px; height: 13px; border-radius: 0; }
      .col:hover i { background: var(--ink); }
      .col .v { position: absolute; left: -8px; right: -8px; bottom: calc(var(--h) + 3px); text-align: center; color: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
      .col.nul .v { bottom: 3px; color: var(--muted); }
      .col .dn { position: absolute; left: -6px; right: -6px; top: calc(100% + 5px); text-align: center; color: var(--muted); font-size: 11.5px; line-height: 1; font-variant-numeric: tabular-nums; }
      .col.short .dn { color: var(--ink); font-weight: 600; }
      .wkAxis { display: flex; justify-content: space-between; margin: 24px 0 0 38px; color: var(--muted); font-size: 12px; }
      @media (max-width: 640px) {
        .wkPlot { height: 150px; }
        .col:not(.key) .v { display: none; }
      }

      /* ⑤ 게임별 중앙 낙찰가 가로 막대 */
      .pbs { max-width: 760px; }
      .pb { display: grid; grid-template-columns: minmax(104px, 170px) 1fr minmax(72px, auto); gap: 0 10px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--line); font-size: 13.5px; }
      .pb .nm { color: var(--ink); font-weight: 600; line-height: 1.25; }
      .pb .tr { display: block; height: 14px; background: var(--line); border-radius: 3px; overflow: hidden; }
      .pb .tr i { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
      .pb:hover .tr i { background: var(--ink); }
      .pb .val { text-align: right; color: var(--ink); font-weight: 700; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .pb .val small { display: block; color: var(--muted); font-size: 12px; font-weight: 400; }

      .foot { margin: 8px 0 0; font-size: 14px; }
      .foot a { display: inline-block; padding: 7px 0; color: var(--accent); }
    </style>
    <link rel="stylesheet" href="auction-dashboard.css?v=${CACHE}" />
    <script defer src="auction-dashboard.js?v=${CACHE}"></script>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("", "tcg-auction.html", { ariaLabel: "Primary navigation" })}
    </header>
    <main id="main-content" class="wrap">
      <h1 data-ko="카드게임별 경매 시장">TCG auction market by game</h1>
      <p class="sub"><span data-ko="eBay 경매 · ${GAME_COUNT}개 게임 · 데이터 기준일 ${esc(to)}">eBay auctions · ${GAME_COUNT} games · data through ${esc(mdy(to))}</span> · USD · UTC</p>
      ${affTop}

      <section id="week" aria-labelledby="weekTitle">
        <div class="secHead"><h2 id="weekTitle" data-ko="최근 7일">Last 7 days</h2><span class="nt">${rangeSpan(W7)} · <span data-ko="직전 7일 대비">vs the 7 before</span>${someMissing ? ` · <span data-ko="빠진 날 있음">Some days missing</span>` : ""}${exclLabel(offLast7, offPrev7)}</span></div>
        <div class="strip">
          <div class="kpi"><span class="lbl" data-ko="낙찰률">Sell rate</span><b>${esc(pct(L.rate))}</b>${ptsSpan(dRate, "delta")}<span class="was"><span data-ko="직전">was</span> ${esc(pct(P.rate))}</span></div>
          <div class="kpi"><span class="lbl" data-ko="중앙 낙찰가">Median sold price</span><b>${esc(money(L.med))}</b><span class="delta${cls(dMed)}">${esc(moneyDelta(dMed))}</span><span class="was"><span data-ko="직전">was</span> ${esc(money(P.med))}</span></div>
          <div class="kpi"><span class="lbl" data-ko="하루 종료 경매">Auctions closing per day</span><b>${esc(num(L.closing))}</b><span class="delta">${esc(numDelta(dClosing))}</span><span class="was"><span data-ko="직전">was</span> ${esc(num(P.closing))}</span></div>
        </div>
        <p class="sampleNote" data-ko="낙찰률·낙찰가 = 수집 표본 · ${esc(num(L.ended))}건 중 ${esc(num(L.sold))}건 낙찰">Sell rate &amp; price = observed sample · ${esc(num(L.sold))} sold / ${esc(num(L.ended))} sampled</p>
        <details class="marketDetails"><summary data-ko="지표·표본 기준">Metrics &amp; sample rules</summary>
          <p class="def"><b data-ko="낙찰률">Sell rate</b> = <span data-ko="종료 경매 중 팔린 비율">share of closed auctions that sold</span> · <b data-ko="낙찰가">Sold price</b> = <span data-ko="낙찰 입찰가, 중앙값 · 상품·등급 혼합">winning bid, middle value · mixed items and grades</span> · <b data-ko="하루 종료 경매">Closing per day</b> = <span data-ko="eBay 가 집계한 24시간 내 종료 경매 수, 일평균">eBay's count of auctions ending within 24 hours, daily average</span> · <b data-ko="집계한 날">Days counted</b> = <span data-ko="정해진 수집 시각에 표본을 고른 날(n/7 · n/28)">days with a sample picked at the usual hour (n/7 · n/28)</span>${EXCL_DEF}</p>
        </details>
      </section>

      <section id="games" aria-labelledby="gamesTitle">
        <div class="secHead"><h2 id="gamesTitle" data-ko="게임별">By game</h2><span class="nt">${RANGE28}</span></div>
        <p class="def"><b data-ko="추이">Trend</b> = <span data-ko="4주 이동 합산 낙찰률(낙찰 ÷ 종료)">rolling 4-week sell rate (sold ÷ closed)</span>, <span data-ko="${trendPoints}점">${trendPoints} points</span> · ± = <span data-ko="95% 구간">95% interval</span></p>
        <div class="marketToolbar" hidden><label for="gameSort" data-ko="높은 순">Highest first</label><select id="gameSort" name="sort" aria-controls="gameTable">
          <option value="rate" data-ko="낙찰률">Sell rate</option><option value="delta" data-ko="낙찰률 변화">Sell-rate change</option><option value="price" data-ko="중앙 낙찰가">Median sold price</option><option value="closing" data-ko="하루 종료 경매">Auctions closing per day</option>
        </select></div>
        <table class="t" id="gameTable" aria-labelledby="gamesTitle">
          <thead><tr>
            <th class="l" data-ko="게임">Game</th>
            <th data-sort="rate" aria-sort="descending" data-ko="낙찰률">Sell rate</th>
            <th class="dOnly" data-sort="delta" data-ko="직전 4주 대비">vs prior 4 weeks</th>
            <th class="dOnly" data-sort="price" data-ko="중앙 낙찰가">Median sold price</th>
            <th class="dOnly" data-sort="closing" data-ko="하루 종료">Closing per day</th>
            <th class="trend" data-ko="추이">Trend</th>
          </tr></thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
      </section>

      <section id="weekly" aria-labelledby="weeklyTitle">
        <div class="secHead"><h2 id="weeklyTitle" data-ko="주별 낙찰률">Sell rate by week</h2><span class="nt"><span data-ko="${weeklyTotal.length}주">${weeklyTotal.length} weeks</span> · <span data-ko="${GAME_COUNT}개 게임 합산">${GAME_COUNT} games combined</span>${weeklyTotal.length ? ` · <span data-ko="${esc(mdKo(wkFirst.d))}–${esc(mdKo(addDays(wkLast.d, 6)))}">${esc(md(wkFirst.d))} – ${esc(mdy(addDays(wkLast.d, 6)))}</span>` : ""}</span></div>
        <div class="wk">
          <div class="wkHead"><span data-ko="종료 경매 중 팔린 비율">Share of closed auctions that sold</span><span class="nt lg"><i class="swd" aria-hidden="true"></i><span data-ko="n/7 = 집계한 날 · 점선 윗변 = 7일 미만">n/7 = days counted · dashed top = under 7</span></span></div>
          <div class="wkPlot">
            <div class="guide" style="bottom:100%"><span>${wkTop}%</span></div>
            <div class="guide" style="bottom:50%"><span>${wkTop / 2}%</span></div>
            <span class="zero">0</span>
            <div class="cols">${wkCols}</div>
          </div>
          <div class="wkAxis">${wkAxis}</div>
          ${weekAccess}
        </div>
      </section>

      <section id="prices" aria-labelledby="pricesTitle">
        <div class="secHead"><h2 id="pricesTitle" data-ko="게임별 중앙 낙찰가">Median sold price by game</h2><span class="nt">${RANGE28} · <span data-ko="낙찰 20건 이상">20 or more sold</span></span></div>
        <div class="pbs" role="list">${priceBars}
        </div>
      </section>

      <p class="foot"><a href="free-data.html" data-ko="원본 일별 CSV 내려받기">Download the raw daily CSVs</a> · <a href="methodology.html" data-ko="집계 방법">How we count</a></p>
    </main>

    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="free-data.html">Free data (CSV)</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
    <script defer src="track.js"></script>
  </body>
</html>
`;

fs.writeFileSync(OUT, html, "utf8");

// 사이트맵에 넣는다(없으면 추가, 있으면 그대로).
const smPath = path.join(ROOT, "sitemap.xml");
let sm = fs.readFileSync(smPath, "utf8");
const loc = `${SITE}/tcg-auction.html`;
let added = 0;
if (!sm.includes(`<loc>${loc}</loc>`)) {
  const today = new Date().toISOString().slice(0, 10);
  sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
  fs.writeFileSync(smPath, sm, "utf8");
  added = 1;
}

console.log(JSON.stringify({ games: GAME_COUNT, last7: { rate: L.rate, med: L.med, closing: L.closing == null ? null : Math.round(L.closing), missingDays: L.missing }, prev7: { rate: P.rate, med: P.med, closing: P.closing == null ? null : Math.round(P.closing), missingDays: P.missing }, weeks: weeklyTotal.map((w) => `${w.d} ${w.rate}% ${w.n}/7`), games4w: { last: `${W28[0].d}~${W28[W28.length - 1].d} ${stdIn(W28)}/28`, prior: `${P28[0].d}~${P28[P28.length - 1].d} ${stdIn(P28)}/28`, trendPoints }, range: `${from} ~ ${to}`, offHourLeftOut: { last7: W7.map((x) => x.d).filter((d) => OFF.has(d)), prev7: P7.map((x) => x.d).filter((d) => OFF.has(d)) }, leftOutRows: { extra: leftExtra, offHourSample: leftOff }, sitemapAdded: added }, null, 1));
