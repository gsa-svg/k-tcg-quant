#!/usr/bin/env node
// 시계열 공백 감사 — 2026-08-26 신설. 원피스 · 팰월드 · TCG 시장 전부.
//
// 왜: 기존 audit-collection-health.js 는 **가장 최근 날짜**만 본다. 어제 것이 있으면 OK 다.
// 그래서 중간에 며칠이 통째로 빠져도 통과한다. 실거래·경매 관측은 **소급 수집이 안 된다** —
// 그날 지나면 영영 못 채운다. 실제로 7/10~7/24 월·수·금 여섯 번을 놓쳤는데 아무도 몰랐고
// 그 칸은 지금도 비어 있다. 공백은 생긴 다음 날 보여야 의미가 있다.
//
// 보는 것:
//   A) 매일 도는 계열 — 최근 N일 중 빠진 날
//   B) 수동 수집(박스 sold, 월·수·금) — 지나간 수집일 중 안 돈 날
//   C) 주간 수집(등급) — 지나간 월요일 중 안 돈 주
//
// 지난 공백은 못 채운다. 그래도 **보이게** 한다 — 안 보이면 다음 주에 또 놓친다.
// Run: node tools/audit-series-gaps.js [--days 21] [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DAY = 86400000;
const argN = process.argv.indexOf("--days");
const WINDOW = argN > -1 ? Number(process.argv[argN + 1]) || 21 : 21;

const iso = (t) => new Date(t).toISOString().slice(0, 10);
const TODAY = iso(Date.now());
// 오늘은 아직 진행 중이라 공백으로 세지 않는다.
const LAST_FULL = iso(Date.parse(TODAY) - DAY);

const read = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8")); } catch { return null; } };
const problems = [], notes = [];

// 조사가 끝난 영구 공백은 problems 가 아니라 notes 로 낸다 — data/known-gaps.json.
// 매번 FAIL 이 나면 사람이 이 감사를 무시하게 되고, 그러면 진짜 새 공백도 같이 묻힌다.
// 대신 목록은 사유와 확인일을 반드시 적게 해서, 새 공백을 조용히 덮는 데 못 쓰게 한다.
const KNOWN = (() => {
  const j = read("data/known-gaps.json");
  const byDay = new Set(), byWeek = new Set();
  for (const g of (j && j.gaps) || []) {
    if (!g.reason || !g.confirmed) continue;              // 사유·확인일 없으면 인정하지 않는다
    for (const d of g.dates || []) byDay.add(`${g.series}|${d}`);
    for (const w of g.weeks || []) byWeek.add(`${g.series}|${w}`);
  }
  return { byDay, byWeek, count: ((j && j.gaps) || []).length };
})();
const knownDay = (label, d) => KNOWN.byDay.has(`${label}|${d}`);
const knownWeek = (label, w) => KNOWN.byWeek.has(`${label}|${w}`);

function missingDays(dates, from, to) {
  const have = new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 10)));
  const out = [];
  for (let t = Date.parse(from); t <= Date.parse(to); t += DAY) {
    const d = iso(t);
    if (!have.has(d)) out.push(d);
  }
  return out;
}

// 계열의 시작일보다 앞은 공백이 아니다(그때는 수집 자체가 없었다).
function checkDaily(label, dates, opts = {}) {
  const u = [...new Set(dates.filter(Boolean).map((d) => String(d).slice(0, 10)))].sort();
  if (!u.length) { problems.push(`${label} — 데이터가 아예 없다`); return; }
  const start = iso(Math.max(Date.parse(u[0]), Date.parse(LAST_FULL) - (WINDOW - 1) * DAY));
  const all = missingDays(u, start, LAST_FULL);
  const known = all.filter((d) => knownDay(label, d));
  const gaps = all.filter((d) => !knownDay(label, d));
  const line = `${label} — ${u[0]} ~ ${u[u.length - 1]} (${u.length}일)`;
  if (known.length) notes.push(`${label} — 확인된 영구 공백 ${known.length}일(${known.join(" ")}) · known-gaps.json 참조`);
  if (!gaps.length) { notes.push(`${line} · 최근 ${WINDOW}일 새 공백 없음`); return; }
  const msg = `${label} — 최근 ${WINDOW}일 중 ${gaps.length}일 비었다: ${gaps.join(" ")}`;
  if (opts.soft) notes.push(`(참고) ${msg}`); else problems.push(msg);
}

// ── A) 매일 도는 계열 ────────────────────────────────────────────────
const auc = read("data/auction-series.json");
if (auc) checkDaily("원피스 경매 일별", (auc.daily || []).map((r) => r.d));
else problems.push("원피스 경매 시계열 파일을 못 읽었다");

const tcg = read("data/tcg-snapshot.json");
if (tcg) checkDaily("TCG 시장 스냅샷", (tcg.points || []).map((r) => r.d));
else problems.push("TCG 스냅샷 파일을 못 읽었다");

const pw = read("data/palworld-auction-market.json");
if (pw) checkDaily("팰월드 경매 관측", (pw.points || []).map((r) => r.d));
else problems.push("팰월드 경매 관측 파일을 못 읽었다");

const pwSold = read("data/palworld-auction-sold.json");
if (pwSold) checkDaily("팰월드 낙찰 일별", (pwSold.daily || []).map((r) => r.d));

// ── B) 수동 수집(박스 sold) — 월·수·금 ──────────────────────────────
// 이 수집만 브라우저가 필요해 자동화가 안 된다. 그래서 가장 잘 빠진다.
const MWF = new Set([1, 3, 5]);   // 월·수·금 (UTC 요일)
function checkManual(label, ledgerPath) {
  const led = read(ledgerPath);
  if (!led) { problems.push(`${label} 원장을 못 읽었다`); return; }
  const days = led.collectedDays || [];
  if (!days.length) {
    notes.push(`${label} — 수집일 기록이 아직 없다(2026-08-26 부터 남긴다). 다음 수집부터 공백 판정 가능.`);
    return;
  }
  const have = new Set(days);
  const from = iso(Math.max(Date.parse(days[0]), Date.parse(LAST_FULL) - (WINDOW - 1) * DAY));
  const missed = [];
  for (let t = Date.parse(from); t <= Date.parse(LAST_FULL); t += DAY) {
    const d = iso(t);
    if (MWF.has(new Date(t).getUTCDay()) && !have.has(d)) missed.push(d);
  }
  if (missed.length) problems.push(`${label} — 수집일(월·수·금)인데 안 돈 날 ${missed.length}일: ${missed.join(" ")}`);
  else notes.push(`${label} — 최근 ${WINDOW}일 수집일 전부 실행됨(마지막 ${days[days.length - 1]})`);
}
checkManual("원피스 박스 sold", "data/box-sold-ledger.json");
checkManual("팰월드 sold", "data/palworld-sold-ledger.json");

// ── C) 주간 수집(등급) — 월요일 ─────────────────────────────────────
// 등급 인구는 누적값이라 하루 늦어도 값이 사라지진 않는다. 다만 주가 통째로 빠지면
// 그 주의 유입량(증분)을 영영 못 나눈다. 그래서 주 단위로 본다.
for (const [label, file] of [["PSA 카드별", "data/psa-card-pop.json"], ["CGC 카드별", "data/cgc-card-pop.json"], ["TAG 카드별", "data/tag-card-pop.json"]]) {
  const j = read(file);
  if (!j) { problems.push(`${label} 원장을 못 읽었다`); continue; }
  const dates = new Set();
  for (const bucket of Object.values(j.sets || {})) {
    for (const byEd of Object.values(bucket || {})) {
      if (!byEd || typeof byEd !== "object") continue;
      for (const arr of Object.values(byEd)) {
        if (Array.isArray(arr)) for (const p of arr) if (p && p.d) dates.add(p.d);
      }
    }
  }
  const u = [...dates].sort();
  if (!u.length) { problems.push(`${label} — 관측이 하나도 없다`); continue; }
  const weeks = new Set(u.map((d) => isoWeek(d)));
  const missed = [];
  for (let t = Date.parse(LAST_FULL) - (WINDOW - 1) * DAY; t <= Date.parse(LAST_FULL); t += 7 * DAY) {
    const w = isoWeek(iso(t));
    if (!weeks.has(w) && iso(t) >= u[0]) missed.push(w);
  }
  const uniq = [...new Set(missed)];
  const knownW = uniq.filter((w) => knownWeek(label, w));
  const freshW = uniq.filter((w) => !knownWeek(label, w));
  if (knownW.length) notes.push(`${label} — 확인된 영구 공백 주 ${knownW.join(" ")} · known-gaps.json 참조`);
  if (freshW.length) problems.push(`${label} — 관측이 없는 주 ${freshW.join(" ")}`);
  else notes.push(`${label} — 최근 ${WINDOW}일 새 공백 없음(마지막 관측 ${u[u.length - 1]})`);
}

function isoWeek(d) {
  const t = new Date(Date.parse(d));
  const day = (t.getUTCDay() + 6) % 7;               // 월=0
  t.setUTCDate(t.getUTCDate() - day + 3);            // 그 주의 목요일
  const first = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t - first) / DAY - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

const out = { audit: problems.length ? "FAIL" : "NO_GAPS", today: TODAY, window: WINDOW, problems, notes };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
process.exit(problems.length ? 1 : 0);
