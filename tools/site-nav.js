// 상단 메뉴를 한 곳에서 정의한다 — 2026-09-01 신설.
//
// ── 왜
// 메뉴가 수동 HTML 14개와 생성기 7곳에 각각 하드코딩돼 있었다. 항목을 하나 바꾸려면
// 21곳을 손으로 맞춰야 하고, 한 곳만 빠뜨리면 그 페이지만 옛 메뉴를 달고 배포된다.
// 오늘 하루에만 같은 유형(같은 것이 여러 곳에 있어 어긋남)을 네 번 봤다 —
// 영문판 배제 필터, 사이트맵 제거/복원, compare 표, 그리고 이 메뉴.
//
// ── 쓰는 법
//   const { navHtml } = require("./site-nav");
//   navHtml("")        // 루트 페이지 (index.html, auction.html ...)
//   navHtml("../")     // 한 단계 아래 (sets/, cards/, articles/)
// 한국어 메뉴는 navHtmlKo() — ko/ 는 경로 구조가 달라 따로 둔다.
//
// ⚠️ 항목을 늘릴 때는 좁은 화면을 확인할 것. 8개일 때 이미 881~1220px 구간에서
//    가로 넘침이 났고(2026-08-30), styles.css 의 @media (max-width:1220px) 가
//    가로 스크롤로 받아내고 있다.

// [영문 라벨, 한국어 라벨, 경로(루트 기준), 루트상대인가]
//   루트상대=false 면 사이트 절대경로(/cards/ 처럼)라 접두어를 붙이지 않는다.
// 2026-09-01 소유자 지시로 메뉴에서 숨긴 항목이 아래 주석 처리돼 있다.
//   Compare · Top PSA 10 · PSA Population · Set Guides · Cards
//   이유: 긴 산문 위주라 사람이 안 본다는 판단("AI 가 쓴 글 같다").
//   페이지·사이트맵·색인은 그대로 둔다 — 애드센스 심사는 크롤링으로 보므로 대상에 남는다.
//   애드센스 통과 후 삭제 예정. 되살리려면 주석만 풀면 된다.
const ITEMS = [
  ["Booster Boxes", "부스터 박스", "./", true],
  // ["Cards", "카드", "/cards/", false],
  ["One Piece Auctions", "원피스 경매", "auction.html", true],
  ["TCG Auctions", "TCG 경매", "tcg-auction.html", true],
  // ["Compare", "비교", "compare.html", true],
  // ["Top PSA 10", "PSA10 랭킹", "psa10-ranking.html", true],
  // ["PSA Population", "PSA 인구", "psa-grading.html", true],
  // ["Set Guides", "세트 가이드", "sets/index.html", true],
  ["Amazon Raffle", "아마존 응모", "amazon-lottery.html", true],
];

// prefix: "" (루트) 또는 "../" (한 단계 아래)
// current: 현재 페이지 경로(루트 기준). 일치하면 aria-current 를 붙인다.
function navHtml(prefix = "", current = null, opts = {}) {
  // aria-label 은 항상 붙인다 — 페이지마다 다르면 inject-nav 의 일치 검사가 계속 어긋난다.
  const label = ` aria-label="${opts.ariaLabel || "Primary navigation"}"`;
  const links = ITEMS.map(([en, ko, href, rel]) => {
    const to = rel ? (href === "./" ? (prefix || "./") : prefix + href) : href;
    const cur = current && current === href ? ' aria-current="page"' : "";
    return `<a href="${to}"${cur} data-ko="${ko}">${en}</a>`;
  }).join("");
  // 한국어 페이지 링크는 항상 마지막에 붙인다 — 2026-09-01.
  // 종전에는 홈 본문 각주에만 있어서, 카드·세트·경매 페이지에서는 한국어로 갈 방법이 없었다.
  const koHref = prefix ? prefix + "ko/" : "ko/";
  const koLink = `<a href="${koHref}" class="navKo" data-ko="한국어">한국어</a>`;
  return `<nav class="nav"${label}>${links}${koLink}</nav>`;
}

// ko/ 페이지용. ko/ 안에 있는 파일은 ko/ 안을 가리키고, 나머지는 ../ 로 나간다.
const KO_ITEMS = [
  ["부스터 박스", "./"],
  // ["카드 시세", "cards.html"],
  ["원피스 경매", "auction.html"],
  ["TCG 경매", "../tcg-auction.html"],
  // ["세트 비교", "../compare.html"],
  // ["PSA10 랭킹", "../psa10-ranking.html"],
  // ["PSA 인구", "grading.html"],
  // ["세트 가이드", "../sets/index.html"],
  ["아마존 응모", "../amazon-lottery.html"],
];

function navHtmlKo() {
  // ko 페이지에서는 반대로 영문으로 나가는 링크를 붙인다.
  const enLink = `<a href="../" class="navKo">English</a>`;
  return `<nav class="nav" aria-label="주요 메뉴">${KO_ITEMS.map(([ko, href]) => `<a href="${href}">${ko}</a>`).join("")}${enLink}</nav>`;
}

// 가드가 쓰는 목록 — 모든 페이지에 이 한국어 라벨이 다 있어야 한다.
const KO_LABELS = ITEMS.map(([, ko]) => ko);

module.exports = { ITEMS, navHtml, navHtmlKo, KO_LABELS };
