#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
// 런어웨이 백스톱일 뿐, 실보존은 compact-series.js 가 담당한다(최근120일 일단위+주단위+월단위 다년 보존).
// 과거 180 이면 compact 가 티어링하기 전에 오래된 점을 지워 다년 이력이 쌓이지 않았다 — 2026-07-21 감사.
const historyDays = 3650;
// 영문판은 표본 3건 미만이면 신뢰도가 낮아 점을 만들지 않는다(일판은 조건 없음).
const MIN_SAMPLE = { jp: 0, en: 3 };

function marketKrw(value, currency, fx) {
  if (!Number.isFinite(value)) return null;
  if (currency === "KRW") return Math.round(value);
  if (currency === "JPY") return Math.round(value * (fx.jpyKrw || 9.1));
  if (currency === "USD") return Math.round(value * (fx.usdKrw || 1388.2));
  return null;
}

// 오늘 받은 스냅샷은 같은 날 점을 갈아끼운다(같은 날 두 번 받으면 마지막 것). 지난 스냅샷은 그 날짜 점이 없을 때만 넣는다 —
// update-market-data 는 영문판을 새로 안 받으므로, 다시 계산하면 그사이 바뀐 환율로 기존 관측을 고치게 된다(2026-09-30).
function appendSnapshot(points, snapshot, today) {
  const cutoff = new Date(snapshot.d);
  cutoff.setDate(cutoff.getDate() - historyDays);
  const existing = Array.isArray(points) ? points : [];
  if (snapshot.d < today && existing.some((point) => point?.d === snapshot.d)) return existing;
  return [...existing.filter((point) => point?.d && new Date(point.d) >= cutoff && point.d !== snapshot.d), snapshot]
    .sort((a, b) => a.d.localeCompare(b.d));
}

// 세트의 진행매물 스냅샷 하나(ed = "jp" | "en") → { key: 쌓을 시계열 필드, point }. 점이 못 되면 null.
// 야간 축적과 가드 D13 이 같은 규칙을 쓰도록 여기 한 곳에 둔다 — 2026-09-30.
// 점 날짜는 실행일이 아니라 스냅샷의 수집일(updated)이다. 실행일로 찍던 때는 update-market-data 가
// 전날 수집한 영문판 스냅샷을 오늘 관측처럼 한 번 더 찍었다(8/3·8/28 — 그날 밤 매물 수집이 덮어써 남지는 않았다).
function editionPoint(set, ed, fx) {
  const active = set?.boxMarket?.[ed]?.ebayActive;
  if (!active || active.middle == null || !active.currency || !/^\d{4}-\d{2}-\d{2}$/.test(active.updated || "")) return null;
  if (Number(active.sampleSize || 0) < MIN_SAMPLE[ed]) return null;
  const p = marketKrw(Number(active.middle), active.currency, fx || {});
  if (!Number.isFinite(p)) return null;
  // 주간 시세 시리즈(임시 표시용, 2026-07 사용자 결정)는 절대 덮지 않는다 —
  // eBay 스냅샷은 boxSeriesEbay / boxSeriesEnEbay 에 병행 축적해 eBay 전환 때 승격.
  const base = ed === "en" ? "boxSeriesEn" : "boxSeries";
  const key = /Weekly ungraded/i.test(set[base]?.source || "") ? `${base}Ebay` : base;
  return { key, point: { d: active.updated, p, n: Number(active.sampleSize || 0), basis: "active" } };
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  let updated = 0;
  let skipped = 0;

  for (const code of codes) {
    const set = data.sets?.[code];
    const jp = editionPoint(set, "jp", data.fx);
    if (!jp) {
      skipped += 1;
      continue;
    }
    const jpTarget = (set[jp.key] = set[jp.key] || {});
    jpTarget.currency = "KRW";
    jpTarget.source = "eBay Sold weekly medians plus eBay Active snapshots";
    jpTarget.note = "Sold history is retained when available; current updates append eBay Active middle-price snapshots.";
    jpTarget.updated = today;
    jpTarget.sampleSize = Math.max(Number(jpTarget.sampleSize || 0), jp.point.n);
    jpTarget.points = appendSnapshot(jpTarget.points, jp.point, today);
    updated += 1;
  }

  // 영문판 박스 이력 축적 (일판과 동일 구조)
  for (const code of codes) {
    const set = data.sets?.[code];
    const en = editionPoint(set, "en", data.fx);
    if (!en) continue;
    const enTarget = (set[en.key] = set[en.key] || {});
    enTarget.currency = "KRW";
    enTarget.source = "eBay Active snapshots (English sealed boxes)";
    enTarget.updated = today;
    enTarget.points = appendSnapshot(enTarget.points, en.point, today);
  }

  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ updated, skipped, historyDays }, null, 2));
}

module.exports = { editionPoint };

if (require.main === module) main();
