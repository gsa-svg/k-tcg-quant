function setCodePattern(code) {
  return new RegExp(`\\b${String(code || "").replace("-", "[- ]?")}\\b`, "i");
}

const excludedLocationCountries = new Set(["CN", "HK", "MO"]);
const excludedSellerPattern = /(china|chinese|hongkong|hong kong|shenzhen|guangzhou|shanghai|beijing|\bcn\b|\bhk\b)/i;
const excludedSellerUsernames = new Set([
  // eBay Browse can report these as US inventory even when the seller page is China-based.
  "jindoutian",
  "pengsupply", // 2026-07-08 사용자 확인: About=China, EB-02 미국창고 발송으로 위치필터 우회
  "greatestplc", // 2026-07-15 사용자 확인: 중국 판매자, OP-07 US창고 발송으로 위치필터 우회
  "wzxc2024", // 2026-07-15 eBay About 확인: Location China, US창고 발송으로 위치필터 우회
  "chuangxinhe", // 2026-07-15 병음 상호(创新和), US창고 발송 — 중국 판매자 강한 신호
  "ajwu2024", // 2026-07-17 eBay 피드백프로필 확인: member since Mar-2024 in China (OP-07 최저 잠식)
  "dcfonew", // 2026-07-17 eBay 피드백프로필 확인: China (EB-02·EB-03 박스 최저 잠식)
  "dndy2024", // 2026-07-17 fdbk 확인: China — OP-07 최저 잠식 3번째 계정(동일 창고망 다계정 추정)
  "obtr2024", // 2026-07-17 fdbk 확인: China — dcfonew 차단 직후 EB-02·EB-03 최저 재잠식
  "onpiececard", // 2026-07-17 fdbk 확인: China — chuangxinhe와 동일가($151.89) OP-05 재잠식
  "newcardscoming", // 2026-07-17 fdbk 확인: China — OP-05 동일가 3번째 계정
  "ygmvtion",
  "wonder5136", // 2026-07-17 fdbk: China — OP-05 동일가($151.89) 4번째 계정
  "goldencardstore",
  "pokem_57", // 2026-07-17 fdbk: China — OP-05 동일가 5번째 계정
  "sunnystore24", // 2026-07-17 fdbk: China — OP-04 최저 잠식(패턴 미탐지형)
  "paparazzir",
  "fuyistore", // 2026-07-17 fdbk: Hong Kong — OP-14 재잠식
  // 2026-07-17 OP-14 $79.9 대역 홍콩 다계정망(브라우저 fdbk 전수 확인)
  "vasettler", "vcbbox", "vbzeckon", "vedesh", "gromance", "vdcontion", "bloonymary", "dihssease",
 // 2026-07-17 fdbk: Hong Kong — OP-14 최저 잠식
 // 2026-07-17 fdbk: China — EB-03 재잠식
 // 2026-07-17 fdbk 확인: China — EB-03 최저 잠식
]);

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function textParts(values) {
  return values.flatMap((value) => (Array.isArray(value) ? value : [value])).filter(Boolean).join(" ");
}

function sellerUsername(item) {
  const seller = item?.seller;
  if (!seller) return "";
  if (typeof seller === "string") return seller;
  return seller.username || "";
}

function isExcludedEbaySellerOrLocation(item) {
  const country = firstValue(item?.itemLocation?.country ?? item?.country);
  const sellerName = sellerUsername(item);
  const locationText = textParts([
    item?.itemLocation?.city,
    item?.itemLocation?.stateOrProvince,
    item?.itemLocation?.postalCode,
    item?.location,
  ]);

  return (
    excludedLocationCountries.has(country) ||
    excludedSellerUsernames.has(String(sellerName).toLowerCase()) ||
    excludedSellerPattern.test(sellerName) ||
    excludedSellerPattern.test(locationText)
  );
}

function isJapaneseSealedBoosterBoxTitle(title, code) {
  const value = String(title || "");
  const positive = [
    /one piece/i,
    setCodePattern(code),
    /(?:booster|premium booster|extra booster|display)\s+box/i,
    /japanese|japan|jp\b/i,
  ];
  const negative = [
    /english|korean|chinese|simplified/i,
    /card lot|single card|proxy|digital|empty box|case\b/i,
    /booster pack|single pack|loose pack|pack bundle|fresh from box|from box/i,
    /\b(?:[1-9]|1\d|2[0-3])\s*(?:pack|packs|pk)\b/i,
    /open live|live break|box break|rip\s*ship|break spot|personal break|opened/i,
  ];
  return positive.every((pattern) => pattern.test(value)) && !negative.some((pattern) => pattern.test(value));
}

// 영문판 미개봉 부스터박스: 제목에 English 명시 필수(정확도 우선 — 무표기 매물은 일판 혼입 위험으로 제외)
function isEnglishSealedBoosterBoxTitle(title, code) {
  const value = String(title || "");
  const positive = [
    /one piece/i,
    setCodePattern(code),
    /(?:booster|premium booster|extra booster|display)\s+box/i,
    /english|\beng\b/i,
  ];
  const negative = [
    /japanese|japan|\bjp\b|korean|chinese|simplified/i,
    /card lot|single card|proxy|digital|empty box|case\b/i,
    /booster pack|single pack|loose pack|pack bundle|fresh from box|from box/i,
    /\b(?:[1-9]|1\d|2[0-3])\s*(?:pack|packs|pk)\b/i,
    /open live|live break|box break|rip\s*ship|break spot|personal break|opened/i,
  ];
  return positive.every((pattern) => pattern.test(value)) && !negative.some((pattern) => pattern.test(value));
}

module.exports = {
  isExcludedEbaySellerOrLocation,
  isJapaneseSealedBoosterBoxTitle,
  isEnglishSealedBoosterBoxTitle,
};
