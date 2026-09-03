const { TCG_KEYS, TCG_WATCH_PER_GAME } = require("./tcg-config");

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

/** Separates visible problems from the subset that can still be retried before source expiry. */
function previousDayAssessment({ auctionSeries, tcgSnapshot, tcgSeries, day, requiredTcgKeys = TCG_KEYS, requirePresence = false }) {
  const auction = previousAuctionDayProblems(auctionSeries, day, "원피스 경매 일별", requirePresence);
  const snapshot = previousTcgDayProblems(tcgSnapshot, day, requiredTcgKeys, "TCG 시장 스냅샷", requirePresence);
  const settlement = previousTcgSettlementProblems(tcgSeries, tcgSnapshot, day, requiredTcgKeys, requirePresence);
  return {
    problems: [...auction, ...snapshot, ...settlement],
    // Snapshot counts cannot be recreated after midnight. Settlement can still be recovered
    // from watched auctions until eBay's roughly 30-hour lookup window closes.
    recovery: { auction: auction.length > 0, tcg: settlement.length > 0 },
  };
}

/** Compatibility-free reporting view used by the CLI audit. */
function previousDayProblems(options) {
  return previousDayAssessment(options).problems;
}

module.exports = { previousAuctionDayProblems, previousTcgDayProblems, previousTcgSettlementProblems, previousDayAssessment, previousDayProblems };
