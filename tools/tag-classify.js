// TAG(taggrading.com) pop-report 세트명 → 우리 부스터박스 코드 매핑 (JP/EN).
// TAG는 세트를 카드-변형 단위로 쪼개 이름 붙인다(예 "One Piece Romance Dawn Japanese Alternate Art").
// 한 부스터박스(OP-01 등)의 total/gem 은 그 박스에서 나온 모든 변형 행을 합쳐 만든다.
//
// ⚠️ 이름 규칙(2026-07-22 실측):
//  - OP-01~16: 영문 세트명으로 시작 ("Romance Dawn ...").
//  - EB-01~03: "Extra Booster {name}" ("Extra Booster Memorial Collection ...").
//  - PRB-01/02: "Premium Booster The Best" / "... The Best Vol. 2" (Vol.2 를 먼저 봐야 PRB-02 로 감).
//  - "Premium Card Collection 25th Edition" 은 부스터박스가 아니므로 매핑하지 않는다(어느 코드에도 안 붙음).
//  가장 구체적인 패턴부터(PRB-02 → PRB-01 → EB → OP). 규칙 변경 시 가드 Q3 가 검증.
const ALIASES = [
  ["PRB-02", "^premium booster the best vol\\.? ?2"],
  ["PRB-01", "^premium booster the best(?! vol)"],
  ["EB-01", "^extra booster memorial collection"],
  ["EB-02", "^extra booster anime 25th collection"],
  ["EB-03", "^extra booster heroines? edition"],
  ["OP-01", "^romance dawn"], ["OP-02", "^paramount war"], ["OP-03", "^pillars of strength"],
  ["OP-04", "^kingdoms of intrigue"], ["OP-05", "^awakening of the new era"], ["OP-06", "^wings of the captain"],
  ["OP-07", "^500 years in the future"], ["OP-08", "^two legends"], ["OP-09", "^emperors in the new world"],
  ["OP-10", "^royal blood"], ["OP-11", "^a fist of divine speed"], ["OP-12", "^legacy of the master"],
  ["OP-13", "^carrying on his will"], ["OP-14", "^the azure sea's seven"], ["OP-15", "^adventure on kami's island"],
  ["OP-16", "^the time of battle"],
].map(([code, pat]) => [code, new RegExp(pat, "i")]);

// TAG 세트명 하나 → { code, ed } 또는 null. ed: 이름에 "Japanese" 있으면 jp, 아니면 en.
function matchBox(tagName) {
  const n = String(tagName || "").replace(/^one piece\s+/i, "").replace(/[’']/g, "'").trim();
  for (const [code, re] of ALIASES) if (re.test(n)) return { code, ed: /japanese/i.test(tagName) ? "jp" : "en" };
  return null;
}

// byYear 덤프(원시 TAG 행들) → 박스별 {jp,en:{total,gem}} 집계. gem = 10 + 10P(TAG 최고등급).
function aggregateBoxes(byYear) {
  const res = {};
  for (const rows of Object.values(byYear || {})) {
    for (const r of rows || []) {
      const m = matchBox(r.name);
      if (!m) continue;
      res[m.code] = res[m.code] || { jp: { total: 0, gem: 0 }, en: { total: 0, gem: 0 } };
      res[m.code][m.ed].total += Number(r.total) || 0;
      res[m.code][m.ed].gem += (Number(r.g10) || 0) + (Number(r.g10p) || 0);
    }
  }
  const boxes = {};
  for (const [c, v] of Object.entries(res)) {
    boxes[c] = { jp: v.jp.total ? v.jp : null, en: v.en.total ? v.en : null };
  }
  return boxes;
}

module.exports = { matchBox, aggregateBoxes, ALIASES };
