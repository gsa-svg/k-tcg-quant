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

// 카드명에서 캐릭터 토큰(들) 추출 — 번호·변형어를 걷어낸 4글자+ 단어들.
// camelCase 분리(EdwardNewgate→edward newgate, TonyChopper→tony chopper), 괄호 제거로 "Sakazuki (Manga)"도 처리.
// 변형어 + 불용어(the/one/new 등). 3글자 캐릭터명(Ace/Kid/Law/Uta)은 살리되 흔한 단어는 뺀다.
const VARIANT_WORDS = /^(sp|special|parallel|paralle|manga|comic|alternate|alt|art|super|gold|golden|silver|red|leader|stamped|signature|signed|wanted|poster|treasure|rare|edition|foil|holo|japanese|jpn|gem|mint|game|the|one|new|and|for|with|his|her|its|dead|mans|drawn)$/i;
function characterTokens(cardName) {
  const cleaned = String(cardName || "")
    .replace(/\b(?:OP|EB|PRB|ST)\s*-?\s*\d{1,2}\s*-?\s*\d{3}\b/gi, " ")   // 카드번호
    .replace(/\b\d+\b/g, " ")                                             // 숫자
    .replace(/([a-z])([A-Z])/g, "$1 $2")                                  // camelCase 분리
    .replace(/[()[\].,\-!/]/g, " ");
  return cleaned.split(/\s+/).map((w) => w.toLowerCase()).filter((w) => w.length >= 3 && !VARIANT_WORDS.test(w));
}

// 매물 제목에 카드의 캐릭터가 들어있나 — 카드 토큰 중 하나라도 (공백/기호 제거한) 제목에 포함되면 통과.
// "하나라도" 규칙은 붙은이름·띄어쓰기 차이 오탐을 막는다. 토큰을 못 뽑으면 통과(과잉제거 방지).
function characterMatches(title, card) {
  const tokens = characterTokens(card.name);
  if (!tokens.length) return true;
  const norm = String(title || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  return tokens.some((t) => norm.includes(t));
}

// 색상 하위변형(금·은·레드) 충돌. 카드와 매물의 색이 명백히 어긋나면 다른 카드다.
const COLORS = [["red", /\bred\b/i], ["gold", /\bgold(en)?\b|金/i], ["silver", /\bsilver\b|銀/i]];
function colorConflict(title, card) {
  const cardColors = COLORS.filter(([, re]) => re.test(card.name || "")).map(([n]) => n);
  const titleColors = COLORS.filter(([, re]) => re.test(title)).map(([n]) => n);
  // 1) 양쪽 다 색 지정인데 서로 다름 (카드 gold ↔ 매물 silver) → 확실히 다른 카드.
  if (cardColors.length && titleColors.length && !cardColors.some((c) => titleColors.includes(c))) return true;
  // 2) 카드는 무색인데 매물이 '레드'(OPTCG에서 항상 별도 프리미엄) 또는 'gold letters/parallel'(별도 프리미엄)이면 다른 카드.
  //    단순 'silver' 포일은 SP 표준 표기일 수 있어 제외(Buggy Silver SP 등 정상 오탐 방지).
  //    카드가 색 지정인데 매물이 무색인 경우는 여기서 판단 안 함(생NM 가격 규칙에 위임 — Gold Stamped Signature 오탐 방지).
  if (!cardColors.length) {
    if (/\bred\b/i.test(title)) return true;
    if (/\bgold\s*(letters|parallel|foil)\b/i.test(title)) return true;
  }
  return false;
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
    && hasVariantSignal(title, card)
    && characterMatches(title, card)   // 캐릭터(성) 불일치 차단 (2026-07-22: Luffy 카드에 Perona 매물 등)
    && !colorConflict(title, card);    // 금·은·레드 하위변형 충돌 차단
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

module.exports = { hasVariantSignal, isPsa10JapaneseCardListing, normalizeNumber, setCodeFromText, listingSetConflicts, characterTokens, characterMatches, colorConflict };
