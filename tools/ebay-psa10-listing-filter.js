"use strict";

function compact(value) {
  return String(value || "").replace(/[^A-Z0-9]/gi, "").toUpperCase();
}

function normalizeNumber(number, setCode) {
  const raw = String(number || "").trim().toUpperCase();
  if (/^[A-Z]+[0-9]+-\d+/.test(raw)) return raw;
  if (/^\d+$/.test(raw) && /^OP-\d+/.test(setCode)) {
    return `${setCode.replace("-", "")}-${raw.padStart(3, "0")}`;
  }
  return raw;
}

function hasNumber(title, number) {
  if (!number) return true;
  const normalizedTitle = compact(title);
  const normalizedNumber = compact(number);
  if (normalizedTitle.includes(normalizedNumber)) return true;
  const match = normalizedNumber.match(/^(OP|EB|PRB|ST)(\d{1,2})(\d{3})$/);
  if (!match) return false;
  return normalizedTitle.includes(`${match[1]}${Number(match[2])}${match[3]}`);
}

function hasConflictingCardNumber(title, expectedNumber) {
  const expected = compact(expectedNumber);
  const found = String(title || "").match(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi) || [];
  return found.map(compact).some((number) => number !== expected);
}

/** Premium variants must be named explicitly because they share base numbers. */
function hasVariantSignal(title, card) {
  const expected = `${card.name || ""} ${card.rarity || ""}`;
  const premiumTitle = /manga|comic|super\s*parall|super\s*alt/i;
  const treasureSignal = /treasure\s*rare|\btr\b/i;

  if (/treasure\s*rare|\btr\b/i.test(expected)) return treasureSignal.test(title);
  if (/signature|signed|stamped|stamp/i.test(expected)) return /signature|signed|stamped|stamp/i.test(title);
  if (/\bred\b/i.test(expected)) return /\bred\b/i.test(title) && premiumTitle.test(title);
  if (/manga|comic|\bsuper\b/i.test(expected)) return premiumTitle.test(title);
  if (/\bsp\b|speci[a4]l/i.test(expected)) {
    return /\bsp\b|speci[a4]l/i.test(title) && !premiumTitle.test(title);
  }
  if (/parallel|alternate/i.test(expected)) {
    return /parallel|alternate|alt\s*art|leader\s*parallel|paralle/i.test(title)
      && !premiumTitle.test(title)
      && !/\bsp\b|speci[a4]l|red\s*text/i.test(title);
  }
  return !treasureSignal.test(title);
}

function isPsa10JapaneseCardListing(item, setCode, card) {
  const title = item?.title || "";
  const number = normalizeNumber(card.number, setCode);
  const country = item?.itemLocation?.country || item?.country || "";
  const hasJapaneseSignal = /japanese|japan|jpn/i.test(title) || country === "JP";
  const positive = [/one piece/i, /psa\s*10|gem\s*mint\s*10/i];
  const negative = [
    /psa\s*[1-9]\b(?!0)|psa\s*9|psa\s*8|bgs|cgc|ars|raw|ungraded|proxy|digital/i,
    /english|\beng\b|\ben\b|korean|chinese|simplified/i,
    /lot of|bundle|repack|booster|box|case/i,
  ];

  return positive.every((pattern) => pattern.test(title))
    && hasJapaneseSignal
    && !negative.some((pattern) => pattern.test(title))
    && hasNumber(title, number)
    && !hasConflictingCardNumber(title, number)
    && hasVariantSignal(title, card);
}

// 문자열(제목·Set 속성 등)에서 세트 코드를 뽑는다. "ONE PIECE PRB01-PREMIUM BOOSTER..." → "PRB-01".
function setCodeFromText(text) {
  const m = String(text || "").toUpperCase().match(/\b(OP|EB|PRB|ST)\s*-?\s*0*(\d{1,2})\b/);
  return m ? `${m[1]}-${String(m[2]).padStart(2, "0")}` : null;
}

// 교차세트 오매칭 판별 — 2026-07-22 실사고.
// PRB(프리미엄 부스터)·EB 재판은 원본 카드 번호(예: OP01-024)를 제목에 그대로 달기 때문에,
// 번호 매칭만으로는 OP-01 원본 알트아트와 PRB-01 재판 알트아트를 구분할 수 없다.
// getItem 의 Set 속성이 유일하게 믿을 수 있는 신호다. 매물 Set 이 카드 세트와 명백히 다르면 true.
// (Set 을 못 읽으면 null → false 로 두어 정상 매물을 과잉 제거하지 않는다.)
function listingSetConflicts(setAspect, cardSetCode) {
  const listingSet = setCodeFromText(setAspect);
  const cardSet = String(cardSetCode || "").toUpperCase();
  return !!(listingSet && cardSet && listingSet !== cardSet);
}

module.exports = { hasVariantSignal, isPsa10JapaneseCardListing, normalizeNumber, setCodeFromText, listingSetConflicts };
