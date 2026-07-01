function setCodePattern(code) {
  return new RegExp(`\\b${String(code || "").replace("-", "[- ]?")}\\b`, "i");
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

module.exports = {
  isJapaneseSealedBoosterBoxTitle,
};
