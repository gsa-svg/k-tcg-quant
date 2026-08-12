#!/usr/bin/env node
// 수집 건강검진 — 2026-08-07 신설.
//
// 왜 만드나: 워크플로가 **성공했다고 보고하면서 아무것도 안 모으는** 경우가 실제로 있었다.
// 2026-08-05 에 PSA 주간 수집이 2주 동안 조용히 죽어 있었다(중간 단계가 exit 1 을 냈는데
// continue-on-error 로 덮여 뒤 단계가 통째로 건너뛰어졌다). 우연히 발견했다.
// 경매·시계열은 소급 수집이 안 되므로, 그 2주가 영원한 구멍으로 남는다.
//
// 그래서 "실행이 실패했는가"가 아니라 **"데이터가 늙지 않았는가"**를 본다.
// 워크플로가 뭐라고 보고하든, 파일이 어제 것이 아니면 그게 사고다.
//
// 종료 코드: 문제가 하나라도 있으면 1. 워크플로에서 이걸 실패로 잡으면 알림이 간다.
// Run: node tools/audit-collection-health.js [--json]
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const R = (p) => path.join(ROOT, p);
const has = (p) => fs.existsSync(R(p));
const readJSON = (p) => JSON.parse(fs.readFileSync(R(p), "utf8"));

// UTC 기준 오늘. 수집기가 전부 UTC 날짜로 파일을 쓰므로 여기서도 UTC 로 센다.
const today = new Date().toISOString().slice(0, 10);
const daysAgo = (d) => Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${d}T00:00:00Z`)) / 86400000);

const problems = [];
const notes = [];
const fail = (m) => problems.push(m);
const ok = (m) => notes.push(m);

// ── 1. 원피스 경매 원장 — 하루 한 파일. 이틀 넘게 안 늘면 수집이 멈춘 것이다.
{
  const dir = "data/auction-archive";
  if (!has(dir)) fail("원피스 경매 원장 폴더가 없다");
  else {
    const files = fs.readdirSync(R(dir)).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) fail("원피스 경매 원장이 비었다");
    else {
      const last = files[files.length - 1].slice(0, 10);
      const age = daysAgo(last);
      // 어제까지는 정상(오늘 자정 이후 아직 안 돌았을 수 있다). 이틀 넘으면 사고.
      if (age > 1) fail(`원피스 경매 원장이 ${age}일째 안 늘었다 (마지막 ${last})`);
      else ok(`원피스 원장 최신 ${last}`);
      // 마지막 며칠이 정상 규모인지 — 파일은 생기는데 내용이 비는 실패가 제일 찾기 어렵다.
      const recent = files.slice(-3);
      for (const f of recent) {
        const n = (readJSON(`${dir}/${f}`).sales || []).length;
        const d = f.slice(0, 10);
        if (daysAgo(d) >= 1 && n < 100) fail(`원피스 ${d} 수집량 ${n}건 — 정상일은 500건 이상이다`);
      }
    }
  }
}

// ── 2. TCG 스냅샷 — 하루 한 줄.
if (has("data/tcg-snapshot.json")) {
  const S = readJSON("data/tcg-snapshot.json");
  const pts = S.points || [];
  if (!pts.length) fail("TCG 스냅샷이 비었다");
  else {
    const last = pts[pts.length - 1];
    const age = daysAgo(last.d);
    if (age > 1) fail(`TCG 스냅샷이 ${age}일째 안 늘었다 (마지막 ${last.d})`);
    else ok(`TCG 스냅샷 최신 ${last.d}`);
    // 게임이 통째로 0 이 되면 검색어가 죽었거나 eBay 응답이 바뀐 것이다.
    const dead = (last.games || []).filter((g) => !g.live);
    if (dead.length) fail(`TCG 스냅샷에서 물량 0 인 게임: ${dead.map((g) => g.k).join(", ")} — 검색어 확인 필요`);
    const expected = Object.keys(S.terms || {}).length;
    if (expected && (last.games || []).length !== expected) {
      fail(`TCG 스냅샷 게임 수 불일치: ${last.games.length} vs 등록 ${expected}`);
    }
  }
}

// ── 3. TCG 정산 — 감시 목록이 계속 불어나면 처리량이 유입량을 못 따라가는 것이다.
//    밀린 건은 종료 후 30시간이 지나면 조회가 안 되고, 그대로 영원한 빈칸이 된다.
if (has("data/tcg-watch.json")) {
  const W = readJSON("data/tcg-watch.json");
  const pending = W.pending || [];
  const now = Date.now();
  const overdue = pending.filter((p) => Date.parse(p.end) < now - 30 * 3600 * 1000);
  if (overdue.length > 50) fail(`TCG 감시 목록에 시한 넘긴 건이 ${overdue.length}건 — 정산이 밀리고 있다`);
  if (pending.length > 6000) fail(`TCG 감시 목록이 ${pending.length}건까지 불었다 — 유입 대비 처리량 부족`);
  else ok(`TCG 감시 대기 ${pending.length}건`);
}

// ── 4. TCG 정산 원장 — 스냅샷은 도는데 정산이 안 되면 낙찰률이 영영 안 나온다.
if (has("data/tcg-archive")) {
  const files = fs.readdirSync(R("data/tcg-archive")).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  if (!files.length) fail("TCG 정산 원장이 비었다");
  else {
    const last = files[files.length - 1].slice(0, 10);
    const age = daysAgo(last);
    if (age > 2) fail(`TCG 정산이 ${age}일째 안 늘었다 (마지막 ${last})`);
    else ok(`TCG 정산 최신 ${last}`);
  }
}

// ── 5. 파생 집계가 원본보다 뒤처지면, 화면은 낡은 값을 보여주면서 아무도 모른다.
for (const [f, label] of [["data/auction-series.json", "원피스 시계열"], ["data/tcg-series.json", "TCG 시계열"]]) {
  if (!has(f)) { fail(`${label} 파일이 없다`); continue; }
  const S = readJSON(f);
  const last = S.builtFrom?.last;
  if (!last) { fail(`${label}에 builtFrom.last 가 없다`); continue; }
  const age = daysAgo(last);
  if (age > 1) fail(`${label}이 ${age}일째 안 갱신됐다 (마지막 ${last})`);
  else ok(`${label} 최신 ${last}`);
}

// ── 6. 진행 중 매물 관측 — 하루 4회 도는 워크플로다. 이틀 넘게 멈추면 사고.
if (has("data/auction-market.json")) {
  const pts = readJSON("data/auction-market.json").points || [];
  const last = pts.length ? pts[pts.length - 1].d : null;
  if (!last) fail("진행 중 매물 관측이 비었다");
  else if (daysAgo(last) > 1) fail(`진행 중 매물 관측이 ${daysAgo(last)}일째 안 늘었다 (마지막 ${last})`);
  else ok(`진행 중 매물 관측 최신 ${last}`);
}

// ── 7. 그레이딩 주간 데이터 — 이 감시자를 만들게 된 바로 그 사고가 여기서 났는데
//    정작 검사 범위에 없었다(2026-08-12 발견). 실제로 PSA 판본별이 7/29 에 멈춘 채
//    화면에는 그 값이 "THIS WEEK" 으로 나가고 있었다.
//
//    주간 수집이라 하루이틀 늦는 건 정상이다. 두 주를 통째로 건너뛰면 사고다.
//    기관마다 공개 요일이 달라 날짜가 서로 다른 것 자체는 정상 — 각자 자기 기준으로만 본다.
{
  const WEEK_STALE = 10;  // 한 주(7일) + 여유 3일. 이걸 넘으면 한 주를 통째로 놓친 것이다.
  // 객체 어디에 박혀 있든 YYYY-MM-DD 를 긁어 가장 최근을 찾는다 — 파일마다 구조가 달라서다.
  const scanDates = (o, out = []) => {
    if (o == null) return out;
    if (typeof o === "string") { if (/^\d{4}-\d{2}-\d{2}$/.test(o)) out.push(o); return out; }
    if (Array.isArray(o)) { for (const x of o) scanDates(x, out); return out; }
    if (typeof o === "object") {
      for (const [k, v] of Object.entries(o)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k)) out.push(k);
        scanDates(v, out);
      }
    }
    return out;
  };
  const GRADING = [
    ["data/gemrate-psa-history.json", "PSA 주간 이력"],
    ["data/psa-edition-weekly.json", "PSA 판본별 주간"],
    ["data/cgc-grading-history.json", "CGC 이력"],
    ["data/tag-grading-history.json", "TAG 이력"],
  ];
  for (const [f, label] of GRADING) {
    if (!has(f)) { fail(`${label} 파일이 없다`); continue; }
    const ds = [...new Set(scanDates(readJSON(f)))].sort();
    if (!ds.length) { fail(`${label}에 날짜가 하나도 없다`); continue; }
    const last = ds[ds.length - 1];
    const age = daysAgo(last);
    if (age > WEEK_STALE) fail(`${label}이 ${age}일째 안 늘었다 (마지막 ${last}) — 주간 수집을 건너뛴 것이다`);
    else ok(`${label} 최신 ${last}`);
  }
}

const out = { status: problems.length ? "FAIL" : "OK", today, problems, checked: notes };
console.log(JSON.stringify(out, null, process.argv.includes("--json") ? 0 : 1));
if (problems.length) process.exit(1);
