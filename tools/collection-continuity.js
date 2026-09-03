const fs = require("node:fs");
const path = require("node:path");
const { TCG_KEYS, TCG_WATCH_PER_GAME } = require("./tcg-config");

// 조사가 끝난 영구 공백 — data/known-gaps.json. audit-series-gaps.js 의 규칙과 같다:
// 사유(reason)·확인일(confirmed)이 없는 항목은 인정하지 않는다(새 공백을 조용히 덮는 데 못 쓰게).
// 2026-09-03: 직전 완료일 검사가 이 목록을 안 봐서, 복구 불가로 확인된 9/2 공백이 2시간마다
// 빨간불·재실행·실패 메일을 냈다. 영구 공백은 notes(known)로 내려보내고 재실행 대상에서도 뺀다.
function loadKnownGaps(root) {
  const known = new Set();
  try {
    const j = JSON.parse(fs.readFileSync(path.join(root, "data", "known-gaps.json"), "utf8"));
    for (const g of (j && j.gaps) || []) {
      if (!g.reason || !g.confirmed) continue;
      for (const d of g.dates || []) known.add(`${g.series}|${d}`);
    }
  } catch {}
  return known;
}

/** Returns a problem only when the completed day's aggregate is explicitly partial. */
function previousAuctionDayProblems(series, day, label = "원피스 경매 일별", requirePresence = false) {
  const row = (series?.daily || []).find((item) => item?.d === day);
  if (!row) return requirePresence ? [`${label} — 직전 완료일 ${day} 기록 없음`] : [];
  const gap = Number(row.hourGapHours) || 0;
  if (!row.partial && gap < 2) return [];
  return [`${label} — 직전 완료일 ${day} 부분수집 (${gap}시간 공백 · ${Number(row.ended) || 0}건 확인)`];
}

/** Validates that every actively tracked game has both non-recoverable snapshot fields. */
function previousTcgDayProblems(snapshot, day, requiredKeys = TCG_KEYS, label = "TCG 시장 스냅샷", requirePresence = false) {
  const point = (snapshot?.points || []).find((item) => item?.d === day);
  if (!point) return requirePresence ? [`${label} — 직전 완료일 ${day} 기록 없음`] : [];
  const games = new Map((point.games || []).map((game) => [game?.k, game]));
  const missing = [];
  for (const key of requiredKeys) {
    const game = games.get(key);
    for (const field of ["live", "endingToday"]) {
      if (!Number.isFinite(game?.[field])) missing.push(`${key}.${field}`);
    }
  }
  return missing.length ? [`${label} — 직전 완료일 ${day} 필수 관측 누락: ${missing.join(", ")}`] : [];
}

/** Detects a successful-but-empty TCG settlement using the day's eBay count as a conservative baseline. */
function previousTcgSettlementProblems(tcgSeries, tcgSnapshot, day, requiredKeys = TCG_KEYS, requirePresence = false) {
  const seriesDay = (tcgSeries?.daily || []).find((item) => item?.d === day);
  const snapshotDay = (tcgSnapshot?.points || []).find((item) => item?.d === day);
  if (!seriesDay || !snapshotDay) {
    return requirePresence && !seriesDay ? [`TCG 정산 일별 — 직전 완료일 ${day} 기록 없음`] : [];
  }
  const snapshots = new Map((snapshotDay.games || []).map((game) => [game?.k, game]));
  const thin = [];
  for (const key of requiredKeys) {
    const endingToday = snapshots.get(key)?.endingToday;
    if (!Number.isFinite(endingToday)) continue;
    const minimum = Math.max(1, Math.floor(Math.min(endingToday, TCG_WATCH_PER_GAME) * 0.5));
    const settled = Number(seriesDay.games?.[key]?.ended) || 0;
    if (settled < minimum) thin.push(`${key} ${settled}/${minimum}`);
  }
  return thin.length ? [`TCG 정산 일별 — 직전 완료일 ${day} 처리량 부족(확인/보수적 최소): ${thin.join(", ")}`] : [];
}

const AUCTION_LABEL = "원피스 경매 일별";
const SNAPSHOT_LABEL = "TCG 시장 스냅샷";
const SETTLEMENT_LABEL = "TCG 정산 일별";

/**
 * Separates visible problems from the subset that can still be retried before source expiry.
 * A day registered in known-gaps.json for a series is reported under `known` (a note), not
 * `problems`, and is never scheduled for recovery — it has already been confirmed unrecoverable.
 */
function previousDayAssessment({ auctionSeries, tcgSnapshot, tcgSeries, day, requiredTcgKeys = TCG_KEYS, requirePresence = false, knownGaps, root }) {
  // root 를 준 호출자(감사기·자가치유)만 known-gaps.json 을 읽는다. 순수 테스트는 디스크를 안 본다.
  const known = knownGaps instanceof Set ? knownGaps : root ? loadKnownGaps(root) : new Set();
  const isKnown = (label) => known.has(`${label}|${day}`);
  const split = (label, list) => (isKnown(label) ? { problems: [], known: list } : { problems: list, known: [] });

  const auction = split(AUCTION_LABEL, previousAuctionDayProblems(auctionSeries, day, AUCTION_LABEL, requirePresence));
  const snapshot = split(SNAPSHOT_LABEL, previousTcgDayProblems(tcgSnapshot, day, requiredTcgKeys, SNAPSHOT_LABEL, requirePresence));
  const settlement = split(SETTLEMENT_LABEL, previousTcgSettlementProblems(tcgSeries, tcgSnapshot, day, requiredTcgKeys, requirePresence));

  return {
    problems: [...auction.problems, ...snapshot.problems, ...settlement.problems],
    known: [...auction.known, ...snapshot.known, ...settlement.known],
    // Snapshot counts cannot be recreated after midnight. Settlement can still be recovered
    // from watched auctions until eBay's roughly 30-hour lookup window closes.
    // Known permanent gaps are excluded: re-dispatching cannot bring them back.
    recovery: { auction: auction.problems.length > 0, tcg: settlement.problems.length > 0 },
  };
}

/** Compatibility-free reporting view used by the CLI audit. */
function previousDayProblems(options) {
  return previousDayAssessment(options).problems;
}

module.exports = { loadKnownGaps, previousAuctionDayProblems, previousTcgDayProblems, previousTcgSettlementProblems, previousDayAssessment, previousDayProblems };
