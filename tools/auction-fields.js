// 경매 항목에서 "나중에 다양하게 보여줄" 수 있는 필드를 뽑아내는 공용 모듈.
//
// 왜 지금 만드나: 경매는 끝나면 사라진다. 오늘 안 뽑은 필드는 영원히 못 뽑는다.
// 낙찰가만 쌓아두면 나중에 만들 수 있는 화면이 "가격 그래프" 하나뿐이다.
// eBay getItem 응답에는 이미 등급·판·변형·배송비·판매국가·종료시각이 들어 있는데
// 우리는 그걸 버리고 있었다(2026-07-29 실측으로 확인).
//
// ⚠️ 정확도 원칙 — 애매하면 null. 억지로 채우지 않는다.
//  - 등급은 제목에서만 읽는다. eBay 에 구조화된 등급 필드가 없다(실측). 그래서 gradeSrc 로 출처를 남긴다.
//  - 한 제목에 서로 다른 등급이 여러 개면(로트) null. 하나로 단정하면 그건 거짓말이다.
//  - 카드번호는 aspects 의 "Card Number" 를 우선한다. 단 값이 여러 개면 쓰지 않는다
//    (실측: "OP09-119 ST15-005 OP07-118" 처럼 3장 묶음이 있다).
//  - 판매자는 username 을 저장하지 않는다. 개인 식별 정보를 모아두지 않기 위해서다.
//    분석에 필요한 건 "신뢰도 구간"이지 누구인지가 아니다.

// 등급사 표기 → 정규화. 우리 등급 페이지와 같은 이름을 쓴다(PSA/CGC/BGS/TAG/SGC).
const GRADERS = "PSA|CGC|BGS|TAG|SGC";
// "PSA 10", "PSA10", "CGC 9.5", "TAG 10P", "CGC Pristine 10", "CGC 10 Pristine", "CGC Gem Mint 10"
// ⚠️ 수식어(Pristine / Gem Mint)를 버리면 안 된다. CGC 최고등급은 Pristine 10 과 Gem Mint 10 이
//    엄연히 다르고, 우리 등급 페이지도 둘을 나눠 보여준다. 여기서 뭉개면 경매값을 그 표에 못 붙인다.
//    수식어는 등급 숫자 앞뒤 어디에나 온다(실측: "CGC 10 PRISTINE").
const QUAL = "GEM\\s*MINT|PRISTINE|PERFECT";
const GRADE_RE = new RegExp(
  `\\b(${GRADERS})\\s*(${QUAL})?\\s*(10P|10|9\\.5|9|8\\.5|8|7|6|5)\\s*(${QUAL})?\\b`,
  "gi"
);
const normQual = (q) => (!q ? "" : /GEM/i.test(q) ? " Gem Mint" : /PRISTINE/i.test(q) ? " Pristine" : " Perfect");

// 제목에서 등급을 읽는다. 확신할 때만 값을 준다.
// 반환: {co:"CGC", g:"10", qual:"Pristine"} | null
function parseGrade(title) {
  const t = String(title || "");
  const found = new Set();
  let m;
  GRADE_RE.lastIndex = 0;
  while ((m = GRADE_RE.exec(t))) {
    const qual = normQual(m[2] || m[4]).trim();
    found.add(`${m[1].toUpperCase()}|${m[3].toUpperCase()}|${qual}`);
  }
  if (found.size !== 1) return null;          // 0개=미등급/불명, 2개 이상=로트 → 둘 다 단정 불가
  const [co, g, qual] = [...found][0].split("|");
  return qual ? { co, g, qual } : { co, g };
}

// localizedAspects 배열 → {이름: 값} 맵. 이름은 그대로 둔다(eBay 가 바꾸면 우리가 알아야 하므로).
function aspectMap(item) {
  const out = {};
  for (const a of item.localizedAspects || []) {
    if (a && a.name && a.value != null && out[a.name] == null) out[a.name] = String(a.value);
  }
  return out;
}

// 판(일본판/영문판).
// ⚠️ aspects 와 제목이 어긋나면 둘 다 버린다. 2026-07-29 실측에서 제목은 "Japanese",
//    aspects 는 Language=English 인 매물이 나왔다(판매자가 항목을 복사해 올린 것으로 보인다).
//    한쪽을 골라 담으면 일본판 시세에 영문판이 섞인다. 판별 혼입은 우리가 절대 못 하는 일이다.
// 반환: {ed, edSrc:"aspect"|"title"|"agree"|null, edConflict?:true}
function parseEdition(item, asp) {
  const lang = asp.Language || asp.language;
  const fromAspect = !lang ? null : /japan/i.test(lang) ? "jp" : /english/i.test(lang) ? "en" : null;
  const t = String(item.title || "");
  const fromTitle = /english|\beng\b/i.test(t) ? "en" : /japanese|japan\b/i.test(t) ? "jp" : null;
  if (fromAspect && fromTitle) {
    if (fromAspect !== fromTitle) return { ed: null, edSrc: null, edConflict: true };
    return { ed: fromAspect, edSrc: "agree" };
  }
  if (fromAspect) return { ed: fromAspect, edSrc: "aspect" };
  if (fromTitle) return { ed: fromTitle, edSrc: "title" };
  return { ed: null, edSrc: null };
}

// aspects 의 카드번호. 정확히 하나일 때만 채택한다.
const CARD_NO = /\b(OP|EB|PRB|ST)[-\s]?(\d{2})[-\s]?(\d{3})\b/gi;
function parseCardNo(asp) {
  const raw = asp["Card Number"] || asp["Card number"];
  if (!raw) return null;
  const hits = new Set();
  let m;
  CARD_NO.lastIndex = 0;
  while ((m = CARD_NO.exec(raw))) hits.add(`${m[1].toUpperCase()}${m[2]}-${m[3]}`);
  return hits.size === 1 ? [...hits][0] : null;
}

// 제목에서 읽은 카드번호 — aspects 값과 대조하는 용도. 여기서도 여러 개면 버린다.
function parseTitleCardNo(title) {
  const hits = new Set();
  let m;
  CARD_NO.lastIndex = 0;
  while ((m = CARD_NO.exec(String(title || "")))) hits.add(`${m[1].toUpperCase()}${m[2]}-${m[3]}`);
  return hits.size === 1 ? [...hits][0] : null;
}

// 변형(패러렐·매장한정·SP 등). 해석하지 않고 원문 그대로 남긴다 —
// 같은 카드번호의 다른 변형에 같은 값을 붙이는 게 우리가 겪은 최악의 사고였다.
function parseVariant(asp) {
  const v = {
    variety: asp["Parallel/Variety"] || null,
    rarity: asp.Rarity || null,
    features: asp.Features || null,
    finish: asp.Finish || null,
  };
  return Object.values(v).some(Boolean) ? v : null;
}

// 배송비(마켓플레이스 통화). 낙찰가만으론 실제 지불액을 모른다.
// 무료배송은 0, 계산 불가(현지 픽업·미표기)는 null.
function parseShipping(item) {
  const opt = (item.shippingOptions || [])[0];
  if (!opt) return null;
  const c = opt.shippingCost;
  if (!c || c.value == null) return null;
  const v = Number(c.value);
  return Number.isFinite(v) ? Number(v.toFixed(2)) : null;
}

// 판매자 신뢰도 — 구간으로만 저장한다. username 도, 정확한 점수도 남기지 않는다.
// "평점 높은 셀러가 더 비싸게 팔리나" 같은 분석엔 구간이면 충분하고,
// 개인을 특정할 수 있는 조합(점수+비율)을 쌓아두지 않아도 된다.
function sellerTier(item) {
  const s = item.seller || {};
  const score = Number(s.feedbackScore);
  const pct = Number(s.feedbackPercentage);
  if (!Number.isFinite(score)) return null;
  const band =
    score >= 10000 ? "10k+" : score >= 1000 ? "1k-10k" : score >= 100 ? "100-1k" : score >= 10 ? "10-100" : "<10";
  const rep = !Number.isFinite(pct) ? null : pct >= 99.5 ? "99.5+" : pct >= 98 ? "98-99.5" : pct >= 95 ? "95-98" : "<95";
  return { band, rep };
}

// 상태(밀봉/개봉). conditionId 는 eBay 표준코드라 문자열보다 안정적이다.
function parseCondition(item) {
  const id = item.conditionId != null ? String(item.conditionId) : null;
  return id ? { condId: id, cond: item.condition || null } : null;
}

// 한 항목에서 뽑을 수 있는 모든 부가 필드. settle-auctions 가 이걸 그대로 기록에 펼친다.
// 값이 없는 키는 넣지 않는다 — 원장에 null 만 가득한 필드를 만들지 않기 위해서.
function extraFields(item) {
  const asp = aspectMap(item);
  const out = {};
  const grade = parseGrade(item.title);
  if (grade) { out.grade = `${grade.co}${grade.qual ? " " + grade.qual : ""} ${grade.g}`; out.gradeSrc = "title"; }
  const { ed, edSrc, edConflict } = parseEdition(item, asp);
  if (ed) { out.ed = ed; out.edSrc = edSrc; }
  if (edConflict) out.edConflict = true;     // 얼마나 자주 어긋나는지 세어보려고 남긴다

  // aspects 카드번호는 제목과 일치할 때만 쓴다.
  // 실측: 제목 "Charlotte Katakuri SP OP11-067" 인데 aspects Card Number 는 OP10-045 였다.
  // 같은 판매자가 항목을 복사해 올리면 이런 일이 생긴다. 번호 오매칭은 우리 최악의 사고 유형이다.
  const cardNo = parseCardNo(asp);
  const titleNo = parseTitleCardNo(item.title);
  if (cardNo && titleNo && cardNo !== titleNo) out.cardIdConflict = true;
  else if (cardNo) out.aspectCardId = cardNo;
  const variant = parseVariant(asp);
  if (variant) out.variant = variant;
  const ship = parseShipping(item);
  if (ship != null) out.ship = ship;
  const tier = sellerTier(item);
  if (tier) out.seller = tier;
  const cond = parseCondition(item);
  if (cond) Object.assign(out, cond);
  const loc = item.itemLocation && item.itemLocation.country;
  if (loc) out.loc = loc;
  if (item.itemEndDate) out.endedAt = item.itemEndDate;      // 요일·시간대 분석용(날짜만으론 불가)
  if (asp.Set) out.setName = asp.Set;
  if (Number.isFinite(Number(item.lotSize)) && Number(item.lotSize) > 0) out.lotSize = Number(item.lotSize);
  return out;
}

module.exports = { parseGrade, aspectMap, parseEdition, parseCardNo, parseTitleCardNo, parseVariant, parseShipping, sellerTier, parseCondition, extraFields };
