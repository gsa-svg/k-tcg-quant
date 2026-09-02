#!/usr/bin/env node
// 수집 현황 한 장 — 2026-09-02 신설.
//
// 왜 만드나: 소유자 지적 "박스 수집·월수금 알림·워크플로가 파편적이라 내가 지금 뭘 수집하는지 모르겠다,
// 하나로 만들어봐." 실제로 수집이 세 군데에 흩어져 있었다:
//   ① GitHub Actions 11개 워크플로(자동)  ② 브라우저로만 되는 수동 수집 5종  ③ 월수금 알림(사람에게만 옴)
// audit-collection-health.js 는 "데이터가 늙었나"를 잘 보지만, **뭐가 자동이고 뭐가 내 손이 필요한지**는
// 말해주지 않는다. 늙은 데이터를 보고도 "이건 자동이니 기다리면 되는 건가, 내가 해야 하나"를 알 수 없다.
//
// 그래서 이 파일이 답하는 질문은 딱 하나: **"지금 내가 뭘 해야 하나?"**
// 각 수집원을 (자동|수동) × (정상|지연|늦음) 으로 나누고, 수동이면 실행 절차까지 붙여 출력한다.
//
// 이 파일은 원장을 읽기만 한다 — 아무것도 수집하지 않고 아무 파일도 쓰지 않는다.
// Run: node tools/collect-status.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const R = (p) => path.join(ROOT, p);
const readJSON = (p) => JSON.parse(fs.readFileSync(R(p), "utf8"));
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => (d ? Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000) : null);

// 최신 날짜를 뽑는 방법은 파일마다 다르다. 각 수집원이 자기 방식을 들고 있게 한다.
const latest = {
  auctionArchive() {
    const dir = R("data/auction-archive");
    const days = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return days.length ? days[days.length - 1].slice(0, -5) : null;
  },
  tcgArchive() {
    const dir = R("data/tcg-archive");
    if (!fs.existsSync(dir)) return null;
    const days = fs.readdirSync(dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    return days.length ? days[days.length - 1].slice(0, -5) : null;
  },
  boxLedger() {
    const L = readJSON("data/box-sold-ledger.json");
    let best = null;
    for (const set of Object.values(L.sets || {})) {
      for (const ed of ["jp", "en"]) {
        const arr = set[ed] && (Array.isArray(set[ed]) ? set[ed] : set[ed].sales);
        if (!Array.isArray(arr)) continue;
        for (const r of arr) {
          const d = r.date || r.d;
          if (d && (!best || d > best)) best = d;
        }
      }
    }
    return best;
  },
  // 어떤 파일은 "2026-09-02", 어떤 파일은 "2026-09-02T00:11:42Z" 를 쓴다. 날짜만 잘라 통일한다 —
  // 안 자르면 daysAgo 의 Date.parse 가 어긋나 멀쩡한 수집이 "지연"으로 뜬다.
  fieldOf: (file, field) => () => {
    const v = readJSON(file)[field];
    return v ? String(v).slice(0, 10) : null;
  },
  seriesTail: (file, pick) => () => {
    const j = readJSON(file);
    const arr = pick(j);
    if (!Array.isArray(arr) || !arr.length) return null;
    const last = arr[arr.length - 1];
    return last.d || last.date || last.week || null;
  },
};

// ── 수집원 목록 ────────────────────────────────────────────────
// warn/late = 며칠 지나면 노랑/빨강. 자동 수집은 주기의 2~3배를 넘으면 사고다.
// how = 수동 수집의 실행 절차(사람이 그대로 따라할 수 있게 한 줄로).
const SOURCES = [
  { key: "op-auction", name: "원피스 경매 정산", mode: "auto", every: "90분마다",
    wf: "settle-auctions", warn: 1, late: 2, get: latest.auctionArchive },
  { key: "op-market", name: "원피스 경매 시장 스캔", mode: "auto", every: "3시간마다",
    wf: "collect-auction-market", warn: 1, late: 2, get: latest.fieldOf("data/auction-watch.json", "updated") },
  { key: "tcg", name: "TCG 17종 경매", mode: "auto", every: "6시간마다(스냅샷 1일 1회)",
    wf: "collect-tcg", warn: 1, late: 2, get: latest.tcgArchive },
  { key: "active", name: "진행 중 매물 관측", mode: "auto", every: "매일 03:00 KST",
    wf: "update-active-listings", warn: 2, late: 3, get: latest.fieldOf("data/active-listing-audit.json", "updated") },
  // fx.json 은 updated 가 아니라 date 를 쓴다 — 파일마다 필드명이 다르니 각자 자기 것을 지정한다.
  { key: "fx", name: "환율", mode: "auto", every: "매일 09:10 KST",
    wf: "update-fx", warn: 2, late: 3, get: latest.fieldOf("data/fx.json", "date") },
  { key: "grading", name: "그레이딩 시계열", mode: "auto", every: "매주 월요일",
    wf: "collect-grading", warn: 8, late: 12, get: latest.fieldOf("data/grading-series.json", "updated") },

  { key: "box", name: "박스 판매(BIN) 원장", mode: "manual", every: "주 3회(월·수·금)",
    warn: 3, late: 5, get: latest.boxLedger,
    how: "브라우저 수집 → node tools/box-sold-ingest.js <덤프> → node tools/build-box-sold-series.js",
    note: "eBay 가 sold 검색을 API 로 막아 실브라우저로만 된다. 빈 응답 재시도가 들어 있으니 empties 가 0인지 확인할 것." },
  { key: "psa", name: "PSA 등급 인구", mode: "manual", every: "주 1회",
    warn: 8, late: 14, get: latest.fieldOf("data/psa-card-pop.json", "updated"),
    how: "브라우저로 GemRate 수집 → node tools/collect-psa-card-pop.js" },
  { key: "cgc", name: "CGC 등급 인구", mode: "manual", every: "주 1회",
    warn: 8, late: 14, get: latest.fieldOf("data/cgc-card-pop.json", "updated"),
    how: "브라우저로 CGC 팝리포트 수집 → node tools/cgc-card-pop-ingest.js" },
  { key: "tag", name: "TAG 등급 인구", mode: "manual", every: "주 1회",
    warn: 8, late: 14, get: latest.fieldOf("data/tag-card-pop.json", "updated"),
    how: "브라우저로 TAG 팝리포트 수집 → node tools/tag-card-pop-ingest.js" },
  { key: "palworld", name: "팰월드 박스 판매", mode: "manual", every: "주 1회",
    warn: 8, late: 14, get: latest.boxLedgerPalworld || (() => {
      try { return readJSON("data/palworld-sold-ledger.json").updated || null; } catch { return null; }
    }),
    how: "node tools/palworld-sold-urls.js --setup → 브라우저 수집 → ingest" },
];

const rows = SOURCES.map((s) => {
  let last = null, err = null;
  try { last = s.get(); } catch (e) { err = String(e.message || e).slice(0, 60); }
  const age = daysAgo(last);
  const state = err ? "오류" : age == null ? "없음" : age >= s.late ? "늦음" : age >= s.warn ? "지연" : "정상";
  return { ...s, last, age, state, err };
});

// 지금 해야 할 일 = 수동인데 지연·늦음인 것. 자동은 늦어도 사람이 할 게 없다(워크플로 로그를 볼 뿐).
const todo = rows.filter((r) => r.mode === "manual" && (r.state === "지연" || r.state === "늦음" || r.state === "없음"));
const autoBroken = rows.filter((r) => r.mode === "auto" && (r.state === "늦음" || r.state === "오류"));

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ today, todo: todo.map((r) => r.key), autoBroken: autoBroken.map((r) => r.key), rows }, null, 1));
  process.exit(0);
}

// 콘솔 출력. 윈도우 cp949 라 이모지·기호를 쓰지 않는다 — 글자만 쓴다.
const pad = (s, n) => String(s) + " ".repeat(Math.max(0, n - [...String(s)].reduce((a, c) => a + (c.charCodeAt(0) > 127 ? 2 : 1), 0)));
const line = [];
line.push(`수집 현황 — ${today}`);
line.push("");
line.push("[자동] GitHub Actions 가 알아서 돌린다. 사람이 할 일 없음.");
for (const r of rows.filter((x) => x.mode === "auto")) {
  line.push(`  ${pad(r.name, 24)} ${pad(r.state, 6)} 최신 ${r.last || "-"}  (${r.every})`);
}
line.push("");
line.push("[수동] 브라우저가 필요하다 — 이건 사람이 시켜야 돈다.");
for (const r of rows.filter((x) => x.mode === "manual")) {
  line.push(`  ${pad(r.name, 24)} ${pad(r.state, 6)} 최신 ${r.last || "-"}  (${r.every})`);
}
line.push("");
if (autoBroken.length) {
  line.push("!! 자동인데 멈춤 — 워크플로 로그를 볼 것:");
  for (const r of autoBroken) line.push(`   ${r.name}: ${r.age}일째 (${r.wf})`);
  line.push("");
}
if (todo.length) {
  line.push("== 지금 할 일 ==");
  for (const r of todo) {
    line.push(`  ${r.name} — ${r.age == null ? "기록 없음" : r.age + "일째"}`);
    line.push(`    ${r.how}`);
    if (r.note) line.push(`    참고: ${r.note}`);
  }
} else {
  line.push("== 지금 할 일 없음 — 수동 수집 전부 최신 ==");
}
console.log(line.join("\n"));
