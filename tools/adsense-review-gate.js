// 애드센스 심사 기간 동안 걸어둔 noindex 를 한 곳에서 켜고 끈다 — 2026-08-31 신설.
//
// ── 배경
// 2026-07-24 커밋 28b9c912 "애드센스 재심사 대비 — 얇은 45페이지 임시 noindex".
// 카드 상세 28개와 한국어 세트 상세 22개, 합쳐 50페이지에 noindex 를 걸고 사이트맵에서 뺐다.
// "임시"라고 적었지만 5주가 지나도록 그대로였고, 그 사이 검색 노출이 무너졌다.
//
// ── 실측 (2026-08-31, GSC)
//   색인된 페이지 38 / 색인 안 된 페이지 37 (사이트가 만드는 페이지는 122개)
//   노출: 8월 초중순 하루 50~60 → 8월 하순 2~15 (약 -90%)
//   평균 순위는 3.5~4.1 로 멀쩡하다 — 순위가 밀린 게 아니라 **노출될 페이지가 사라진 것**이다.
//   롱테일 노출을 만들던 카드·ko 페이지가 통째로 빠졌기 때문이다.
//
// ── 지금 이 페이지들이 정말 "얇은가" (2026-08-31 재측정)
//   ko  noindex 22개 평균 2,174자  vs  색인된 ko 4개 평균 2,272자
//   카드 noindex 28개 평균 2,558자  vs  색인된 카드 1개 평균 2,497자
//   분량이 사실상 같다. 7/24 의 "얇다"는 기준은 지금 데이터에는 맞지 않는다.
//
// ── 왜 스위치로 두나
// 해제는 파일 두 곳(generate-card-pages.js / generate-ko-pages.js)의 meta 태그와
// 사이트맵 제거 블록을 동시에 되돌려야 한다. 손으로 맞추면 한쪽만 풀려서
// "색인은 되는데 사이트맵에 없음" 같은 어중간한 상태가 남는다. 그래서 한 값으로 묶는다.
//
// ── 푸는 법
//   1) 애드센스 심사 결과를 확인한다(통과/거절 무관 — 심사가 끝나기만 하면 된다)
//   2) 아래 REVIEW_ACTIVE 를 false 로 바꾼다
//   3) node tools/generate-card-pages.js && node tools/generate-ko-pages.js
//   4) node tools/guard-invariants.js 로 확인하고 커밋
//   해제하면 meta 가 index,follow 로 바뀌고 사이트맵에 50개 URL 이 다시 들어간다.
//
// ⚠️ 이 값은 소유자 지시 없이 바꾸지 않는다. 노출상태 변경은 되돌리기 어렵다.
const REVIEW_ACTIVE = false;

// 심사 중에는 이 페이지들에 광고를 붙이지 않는다. noindex 와는 별개 판단이라 따로 둔다 —
// 광고 코드가 없는 페이지는 애드센스 심사 대상이 아니고, noindex 를 풀어도 그 사실은 안 변한다.
const ADS_ON_DETAIL_PAGES = !REVIEW_ACTIVE;

// 상세 페이지 <head> 에 넣을 robots 메타. 심사가 끝나면 index,follow 로 바뀐다.
function detailRobotsMeta() {
  return REVIEW_ACTIVE
    ? '<meta name="robots" content="noindex,follow" />'
    : '<meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1" />';
}

// 사이트맵에서 상세 페이지를 빼야 하는가.
// noindex 페이지를 사이트맵에 두면 GSC 가 "제출됨 + 색인 안 됨" 모순으로 계속 잡는다.
function dropDetailFromSitemap() {
  return REVIEW_ACTIVE;
}

module.exports = { REVIEW_ACTIVE, ADS_ON_DETAIL_PAGES, detailRobotsMeta, dropDetailFromSitemap };
