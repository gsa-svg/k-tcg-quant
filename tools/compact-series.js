// 시세 시계열 압축 — 오래된 구간을 성기게 만들어 파일 크기를 유한하게 묶는다.
//
// 왜 필요한가 (2026-07-20 실측): data/onepiece-packs.json 은 방문자가 페이지마다 통째로 받는다.
// 시계열 100개 × 하루 1점 × 29바이트 = 매년 원본 +1MB. 3년이면 3.5MB(전송 ~600KB)로
// 모바일에서 체감되는 크기가 된다. 경매·공급 시계열엔 상한을 걸어놨는데 정작 이 파일만 무제한이었다.
//
// 왜 자르지 않고 성기게 하나: "2026년부터 추적한 시세"가 이 사이트의 값어치다. 오래된 구간을
// 삭제하면 장기 그래프가 사라진다. 대신 해상도를 낮춘다 — 3년 전 시세를 하루 단위로 볼 사람은 없고,
// 주/월 단위면 추세는 그대로 보인다.
//
// 규칙 (오래될수록 성기게)
//   최근 120일 : 전부 유지 (일 단위)
//   120일~1년  : 주당 1점  (그 주의 마지막 값)
//   1년 이상   : 월당 1점  (그 달의 마지막 값)
//
// ⚠️ 절대 지킬 것
//  - 값을 바꾸지 않는다. 고르기만 한다. 평균·보간 금지 — 없는 거래를 만들어내는 것과 같다.
//  - 첫 점(추적 시작)과 마지막 점(최신)은 무조건 남긴다. 시작일이 밀리면 "언제부터 추적"이 틀어진다.
//  - 이미 성긴 시계열은 건드리지 않는다(멱등). 매일 돌아도 결과가 같아야 한다.
//
// Run: node tools/compact-series.js   (야간 파이프라인에서 시세 갱신 뒤에 실행)
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const target = path.join(ROOT, "data", "onepiece-packs.json");

const DAILY_DAYS = 120;    // 이 기간 안은 손대지 않는다
const WEEKLY_DAYS = 365;   // 여기까지는 주 1점, 그 이전은 월 1점

const day = (s) => Date.parse(s + "T00:00:00Z");

// 같은 버킷(주/월)에 여러 점이 있으면 마지막 것만 남긴다.
// 마지막을 고르는 이유: 그 구간이 끝났을 때의 실제 시세가 다음 구간의 출발점이라 이어붙였을 때 자연스럽다.
function bucketKey(d, mode) {
  if (mode === "month") return d.slice(0, 7);
  const t = day(d);
  return String(Math.floor(t / (7 * 86400000)));   // ISO 주 대신 고정 7일 격자 — 경계가 안 흔들린다
}

function compact(points, now) {
  if (!Array.isArray(points) || points.length < 3) return points;
  const sorted = [...points].sort((a, b) => String(a.d).localeCompare(String(b.d)));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const dailyCut = now - DAILY_DAYS * 86400000;
  const weeklyCut = now - WEEKLY_DAYS * 86400000;

  const keep = [];
  const bucketLast = new Map();
  for (const p of sorted) {
    const t = day(String(p.d));
    if (!Number.isFinite(t)) { keep.push(p); continue; }   // 날짜를 못 읽으면 버리지 않는다
    if (t >= dailyCut) { keep.push(p); continue; }         // 최근 구간은 그대로
    const mode = t >= weeklyCut ? "week" : "month";
    bucketLast.set(mode + ":" + bucketKey(String(p.d), mode), p);
  }
  const out = [...bucketLast.values(), ...keep];
  // 첫 점은 추적 시작일이라 버킷에서 밀려났더라도 되살린다
  if (!out.includes(first)) out.push(first);
  if (!out.includes(last)) out.push(last);
  return out.sort((a, b) => String(a.d).localeCompare(String(b.d)));
}

// 시계열처럼 생긴 배열(= {d: "YYYY-MM-DD", ...} 의 배열)을 재귀로 찾아 압축한다.
// 세트/카드/지수 구조가 제각각이라 경로를 하드코딩하면 새 시계열이 생길 때마다 누락된다.
function walk(node, stats, now, depth = 0) {
  if (!node || typeof node !== "object" || depth > 8) return node;
  if (Array.isArray(node)) {
    const looksLikeSeries = node.length > 2 && node.every((p) => p && typeof p === "object" && typeof p.d === "string");
    if (looksLikeSeries) {
      const before = node.length;
      const after = compact(node, now);
      stats.before += before;
      stats.after += after.length;
      if (after.length !== before) stats.changed++;
      return after;
    }
    return node.map((v) => walk(v, stats, now, depth + 1));
  }
  for (const k of Object.keys(node)) node[k] = walk(node[k], stats, now, depth + 1);
  return node;
}

const raw = fs.readFileSync(target, "utf8");
const data = JSON.parse(raw);
const stats = { before: 0, after: 0, changed: 0 };
walk(data, stats, Date.now());

const outStr = JSON.stringify(data);
if (outStr.length < raw.length) {
  fs.writeFileSync(target, outStr + "\n", "utf8");
}
console.log(JSON.stringify({
  seriesCompacted: stats.changed,
  pointsBefore: stats.before,
  pointsAfter: stats.after,
  bytesBefore: raw.length,
  bytesAfter: Math.min(outStr.length + 1, raw.length),
}));
