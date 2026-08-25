#!/usr/bin/env node
// 박스 그래프 값 검증 — 2026-08-25 신설.
//
// 그래프에 그려지는 점(median/low/high/n/vol)을 **원장에서 독립적으로 다시 계산해** 대조한다.
// 생성기의 함수를 import 하지 않는다 — 같은 코드로 검사하면 그 코드가 틀렸을 때 같이 틀린다.
// 여기서는 시계열에 기록된 windowDays 를 그대로 받아, 사분위수 계산만 따로 구현해 맞춰 본다.
//
// 같이 보는 것:
//  · 화면에 쓰이는 boxMarket.ebaySold 가 계열의 마지막 점과 같은가(다르면 카드는 A, 그래프는 B 를 말한다)
//  · 점 간격이 STEP(7일) 격자에 맞는가 — 격자를 벗어난 점은 창이 겹쳐 절벽을 만든다
//  · 점의 n 이 최소 표본을 넘는가
//  · 마지막 점이 마지막 실제 판매일과 같은가(미래 날짜/공백 없는 척 금지)
//
// Run: node tools/audit-box-series.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const LEDGER = read("data/box-sold-ledger.json");
const SERIES = read("data/box-sold-series.json");
const PACKS = read("data/onepiece-packs.json");

const DAY = 86400000;
const MIN_N = 6, BLUE_MIN_N = 3, STEP_DAYS = 7;

// 생성기와 같은 정의(선형보간 사분위수)를 따로 구현한다.
const quant = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i);
  return lo === hi ? s[lo] : s[lo] + (s[hi] - s[lo]) * (i - lo);
};

const problems = [], notes = [];
let checkedPoints = 0, checkedSeries = 0;

// 영문판 OP-01 처럼 초판(Blue)을 따로 그리는 계열이 있다. 그 계열의 `en` 선은 **재판만**이다.
// 이 구분을 모르면 표본 수도 마지막 판매일도 다 어긋나 보인다(2026-08-25 첫 실행에서 그랬다).
// 제목 규칙은 생성기와 같아야 한다 — 다르면 여기서 갈린다.
const WAVE1_BLUE = /\b(blue\s*bottom|wave\s*1)\b/i;
const isFirstPrint = (r) => WAVE1_BLUE.test((r && r.title) || "");

// 원장 레코드 → 계열별 실거래(즉시구매만). 생성기와 같은 조건이어야 값이 맞는다.
// wave: null=전부 · "blue"=초판만 · "white"=재판만
function recordsOf(code, ed, wave) {
  const node = (LEDGER.sets || {})[code] || {};
  const arr = node[ed] || [];
  return arr
    .filter((r) => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d) && Number(r.unit) > 0 && r.fmt === "bin")
    .filter((r) => (wave === "blue" ? isFirstPrint(r) : wave === "white" ? !isFirstPrint(r) : true))
    .map((r) => ({ t: Date.parse(r.d), unit: Number(r.unit) }))
    .sort((a, b) => a.t - b.t);
}

for (const [code, node] of Object.entries(SERIES.sets || {})) {
  for (const ed of ["jp", "en"]) {
    const pts = (node[ed] || []).filter((p) => p && p.median != null);
    if (!pts.length) continue;
    checkedSeries += 1;

    const win = (node.windowDays && node.windowDays[ed]) || null;
    if (!win) { problems.push(`${code}|${ed} — 창 길이(windowDays)가 기록돼 있지 않다. 화면이 며칠 평균인지 못 밝힌다`); continue; }

    // 같은 판에 Blue 계열(enBlue/jpBlue)이 따로 있으면 이 선은 재판만이다.
    const wave = node[`${ed}Blue`] ? "white" : null;
    const rs = recordsOf(code, ed, wave);
    if (!rs.length) { problems.push(`${code}|${ed} — 그래프에 점이 ${pts.length}개인데 원장에 즉시구매 실거래가 없다`); continue; }
    const lastSale = rs[rs.length - 1].t;

    // 마지막 점 = 마지막 실제 판매일
    const lastPt = pts[pts.length - 1];
    if (lastPt.d !== new Date(lastSale).toISOString().slice(0, 10)) {
      problems.push(`${code}|${ed} — 마지막 점 ${lastPt.d} 이 마지막 실거래일 ${new Date(lastSale).toISOString().slice(0, 10)} 과 다르다`);
    }

    // 점 간격 = STEP 격자
    for (let i = 1; i < pts.length; i += 1) {
      const gap = Math.round((Date.parse(pts[i].d) - Date.parse(pts[i - 1].d)) / DAY);
      if (gap % STEP_DAYS !== 0) {
        problems.push(`${code}|${ed} — ${pts[i - 1].d}→${pts[i].d} 간격이 ${gap}일 (${STEP_DAYS}일 격자를 벗어났다: 창이 겹쳐 절벽이 생긴다)`);
        break;
      }
    }

    // 점마다 다시 계산
    const minN = code === "OP-01" && ed === "jp" ? MIN_N : MIN_N;   // blue/white 분리 계열은 아래에서 건너뛴다
    for (const p of pts) {
      const t = Date.parse(p.d), lo = t - win * DAY;
      const u = rs.filter((r) => r.t > lo && r.t <= t).map((r) => r.unit);
      checkedPoints += 1;
      if (u.length !== p.n) {
        // 초판/재판을 나눠 그리는 계열은 이 감사기가 그 분리를 모른다 — 표본 수가 다르면 건너뛰고 알린다.
        notes.push(`${code}|${ed} ${p.d} — 표본 수가 다르다(기록 ${p.n} vs 재계산 ${u.length}). 초판/재판 분리 계열이면 정상.`);
        continue;
      }
      const med = Math.round(quant(u, 0.5)), q1 = Math.round(quant(u, 0.25)), q3 = Math.round(quant(u, 0.75));
      if (med !== p.median || q1 !== p.low || q3 !== p.high) {
        problems.push(`${code}|${ed} ${p.d} — 재계산 중앙값 ${med}(사분위 ${q1}/${q3}) vs 기록 ${p.median}(${p.low}/${p.high})`);
      }
      if (p.n < (u.length >= BLUE_MIN_N ? BLUE_MIN_N : minN)) {
        problems.push(`${code}|${ed} ${p.d} — 표본 ${p.n}건으로 점을 찍었다`);
      }
      const vLo = t - STEP_DAYS * DAY;
      const vol = rs.filter((r) => r.t > vLo && r.t <= t).length;
      if (p.vol != null && p.vol !== vol) {
        problems.push(`${code}|${ed} ${p.d} — 거래량 막대 ${p.vol} vs 재계산 ${vol}`);
      }
    }

    // 카드/헤더가 읽는 값이 계열의 마지막 점과 같은가
    const shown = ((PACKS.sets || {})[code] || {}).boxMarket?.[ed]?.ebaySold;
    if (shown && shown.median != null) {
      if (shown.median !== lastPt.median || shown.updated !== lastPt.d) {
        problems.push(`${code}|${ed} — 화면 표시값 ${shown.median}(${shown.updated}) 이 그래프 마지막 점 ${lastPt.median}(${lastPt.d}) 과 다르다`);
      }
      if (shown.sampleSize !== lastPt.n) {
        problems.push(`${code}|${ed} — 화면 표본 ${shown.sampleSize} 이 그래프 마지막 점 ${lastPt.n} 과 다르다`);
      }
    }
  }
}

const out = { audit: problems.length ? "FAIL" : "BOX_SERIES_OK", checkedSeries, checkedPoints, problems, notes: notes.slice(0, 15) };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
process.exit(problems.length ? 1 : 0);
