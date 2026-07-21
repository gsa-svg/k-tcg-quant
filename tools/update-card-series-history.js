#!/usr/bin/env node

// 카드별 시세 이력 축적: 각 카드의 NM(일본판)·PSA10 Sold 중간값을 KRW로 정규화해
// card.series.points 에 "값이 바뀐 날만" append (박스 update-box-series-history.js 자매 스크립트).
// - 값이 전 포인트와 동일하면 스킵 → 파일 비대화 방지 (NM/PSA10은 주간 갱신이라 매일 돌려도 주 1회만 기록됨).
// - 보존은 compact-series.js 가 담당(다년 티어링). 여기 컷은 런어웨이 백스톱일 뿐.
// Run: node tools/update-card-series-history.js

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const dataPath = path.join(projectRoot, "data", "onepiece-packs.json");
// 과거 180 이면 compact 가 티어링하기 전에 오래된 점을 지워 다년 카드 이력이 안 쌓였다 — 2026-07-21 감사.
const historyDays = 3650;

function marketKrw(value, currency, fx) {
  if (!Number.isFinite(value)) return null;
  if (currency === "KRW") return Math.round(value);
  if (currency === "JPY") return Math.round(value * (fx.jpyKrw || 9.1));
  if (currency === "USD") return Math.round(value * (fx.usdKrw || 1388.2));
  return null;
}

function appendIfChanged(points, snapshot) {
  const existing = Array.isArray(points) ? points : [];
  const cutoff = new Date(snapshot.d);
  cutoff.setDate(cutoff.getDate() - historyDays);
  const kept = existing
    .filter((p) => p?.d && new Date(p.d) >= cutoff && p.d !== snapshot.d)
    .sort((a, b) => a.d.localeCompare(b.d));
  const last = kept[kept.length - 1];
  // 마지막 기록과 nm·psa가 모두 같으면 새 포인트 추가하지 않음(중복 방지)
  if (last && last.nm === snapshot.nm && last.psa === snapshot.psa) return kept;
  return [...kept, snapshot];
}

function main() {
  const data = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  const fx = data.fx || {};
  const today = new Date().toISOString().slice(0, 10);
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  let updated = 0;
  let skipped = 0;
  let appended = 0;

  for (const code of codes) {
    const set = data.sets?.[code];
    if (!set) continue;
    for (const card of set.cards || []) {
      const nm = card.nmJpy != null ? marketKrw(Number(card.nmJpy), "JPY", fx) : null;
      const psa =
        card.psa10Ebay?.soldBased && card.psa10Ebay.middle != null
          ? marketKrw(Number(card.psa10Ebay.middle), card.psa10Ebay.currency || "KRW", fx)
          : null;
      if (nm == null && psa == null) {
        skipped += 1;
        continue;
      }
      const snapshot = { d: today, nm, psa };
      const before = card.series?.points?.length || 0;
      const nextPoints = appendIfChanged(card.series?.points, snapshot);
      card.series = card.series || {};
      card.series.currency = "KRW";
      card.series.source = "Japanese NM (Yuyu-tei/Cardrush) and PSA 10 eBay Sold medians";
      card.series.updated = today;
      card.series.points = nextPoints;
      if (nextPoints.length > before) appended += 1;
      updated += 1;
    }
  }

  data.updated = today;
  fs.writeFileSync(dataPath, `${JSON.stringify(data, null, 1)}\n`, "utf8");
  console.log(JSON.stringify({ updated, appended, skipped, historyDays }, null, 2));
}

main();
