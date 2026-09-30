const fs = require("node:fs");
const path = require("node:path");
const { TCG_KEYS, TCG_WATCH_PER_GAME_MIN } = require("./tcg-config");

const AUCTION_LABEL = "원피스 경매 일별";
const SNAPSHOT_LABEL = "TCG 시장 스냅샷";
const SETTLEMENT_LABEL = "TCG 정산 일별";

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

/** 그날 집계가 부분수집으로 표시돼 있으면 그 설명, 아니면 null. 행이 없는 날은 여기서 보지 않는다. */
function auctionDayPartial(series, day) {
  const row = (series?.daily || []).find((item) => item?.d === day);
  if (!row) return null;
  const gap = Number(row.hourGapHours) || 0;
  if (!row.partial && gap < 2) return null;
  return `부분수집 (${gap}시간 공백 · ${Number(row.ended) || 0}건 확인)`;
}

/** Returns a problem only when the completed day's aggregate is explicitly partial. */
function previousAuctionDayProblems(series, day, label = "원피스 경매 일별", requirePresence = false) {
  if (!(series?.daily || []).some((item) => item?.d === day)) return requirePresence ? [`${label} — 직전 완료일 ${day} 기록 없음`] : [];
  const partial = auctionDayPartial(series, day);
  return partial ? [`${label} — 직전 완료일 ${day} ${partial}`] : [];
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

/**
 * 그날 확인된 정산이 보수적 최소에 못 미친 게임 목록 [{ key, settled, minimum }].
 * snapshotDay 가 없으면 감시 하한(125)을 기준으로 삼는다 — 감시 표본은 스냅샷 실행이 넣으므로 스냅샷이
 * 없는 날은 그날 표본 자체가 안 들어갔다(2026-09-26 실제: 스냅샷 없음, 13종 중 9종 정산 0건).
 */
function settlementShortfall(seriesDay, snapshotDay, requiredKeys = TCG_KEYS) {
  const snapshots = new Map((snapshotDay?.games || []).map((game) => [game?.k, game]));
  const thin = [];
  for (const key of requiredKeys) {
    const endingToday = snapshotDay ? snapshots.get(key)?.endingToday : TCG_WATCH_PER_GAME_MIN;
    if (!Number.isFinite(endingToday)) continue;
    // 기준은 표본 **하한**(125)의 절반이다. 상한(250)을 쓰면 하한 표본인 날 1건만 못 읽어도 실패로 잡힌다
    // (2026-09-07 실제: 12개 게임이 123~124/125 로 빨간불 → 복구 불가능한 1건 때문에 실패 메일).
    // 이 검사의 목적은 "성공했는데 비어 있는 정산"을 잡는 것이지 몇 건 유실을 잡는 게 아니다.
    const minimum = Math.max(1, Math.floor(Math.min(endingToday, TCG_WATCH_PER_GAME_MIN) * 0.5));
    const settled = Number(seriesDay?.games?.[key]?.ended) || 0;
    if (settled < minimum) thin.push({ key, settled, minimum });
  }
  return thin;
}
const shortfallText = (thin) => thin.map((t) => `${t.key} ${t.settled}/${t.minimum}`).join(", ");

/** Detects a successful-but-empty TCG settlement using the day's eBay count as a conservative baseline. */
function previousTcgSettlementProblems(tcgSeries, tcgSnapshot, day, requiredKeys = TCG_KEYS, requirePresence = false) {
  const seriesDay = (tcgSeries?.daily || []).find((item) => item?.d === day);
  const snapshotDay = (tcgSnapshot?.points || []).find((item) => item?.d === day);
  if (!seriesDay || !snapshotDay) {
    return requirePresence && !seriesDay ? [`TCG 정산 일별 — 직전 완료일 ${day} 기록 없음`] : [];
  }
  const thin = settlementShortfall(seriesDay, snapshotDay, requiredKeys);
  return thin.length ? [`TCG 정산 일별 — 직전 완료일 ${day} 처리량 부족(확인/보수적 최소): ${shortfallText(thin)}`] : [];
}

/**
 * 지난 날의 확정 손실 판정 — 2026-09-30 신설(점검 비평 C3).
 * 직전 완료일만 보면 부분일이 하루 지나 보고에서 사라지고 known-gaps 에도 안 남는다. 실제로 9/19·9/24·9/25·
 * 9/26·9/28 TCG 정산 부족과 9/26·9/27 원피스 경매 부분수집이 그렇게 묻혔다. 그래서 감사가 창 안의 지난 날도 본다.
 * 오탐 금지: 감시목록(auction-watch·tcg-watch)에 그날 종료분이 남은 날·게임은 아직 회수 중이라 손실로 치지 않는다.
 * 시한(30시간)이 지나 목록에서 빠진 뒤에야 확정 손실이다. 돌려주는 두 함수는 그날 확정된 손실 설명(없으면 null)을 낸다 —
 * 감사의 창 안 검사와 known-gaps 검증(등록한 날이 정말 손실인가)이 같은 판정을 쓴다.
 */
function confirmedLoss({ auctionSeries, auctionWatch, tcgSnapshot, tcgSeries, tcgWatch, requiredTcgKeys = TCG_KEYS }) {
  const auctionPending = new Set((auctionWatch?.pending || []).map((p) => String(p.endsAt).slice(0, 10)));
  const tcgPending = new Set((tcgWatch?.pending || []).map((p) => `${p.g}|${String(p.end).slice(0, 10)}`));
  return {
    auction: (day) => (auctionPending.has(day) ? null : auctionDayPartial(auctionSeries, day)),
    settlement: (day) => {
      const seriesDay = (tcgSeries?.daily || []).find((item) => item?.d === day);
      const snapshotDay = (tcgSnapshot?.points || []).find((item) => item?.d === day);
      const thin = settlementShortfall(seriesDay, snapshotDay, requiredTcgKeys).filter((t) => !tcgPending.has(`${t.key}|${day}`));
      if (!thin.length) return null;
      return `처리량 부족(시한 지나 확정 · 확인/보수적 최소${snapshotDay ? "" : " · 스냅샷 없어 감시 하한 기준"}): ${shortfallText(thin)}`;
    },
  };
}

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

module.exports = { loadKnownGaps, previousAuctionDayProblems, previousTcgDayProblems, previousTcgSettlementProblems, previousDayAssessment, previousDayProblems, confirmedLoss };
