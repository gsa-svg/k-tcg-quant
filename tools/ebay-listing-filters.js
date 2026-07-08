function setCodePattern(code) {
  return new RegExp(`\\b${String(code || "").replace("-", "[- ]?")}\\b`, "i");
}

const excludedLocationCountries = new Set(["CN", "HK", "MO"]);
const excludedSellerPattern = /(china|chinese|hongkong|hong kong|shenzhen|guangzhou|shanghai|beijing|\bcn\b|\bhk\b)/i;
const excludedSellerUsernames = new Set([
  // eBay Browse can report these as US inventory even when the seller page is China-based.
  "jindoutian",
  "pengsupply", // 2026-07-08 사용자 확인: About=China, EB-02 미국창고 발송으로 위치필터 우회
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
