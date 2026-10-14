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
//   navHtml("", "auction.html")        // 루트 페이지
//   navHtml("../", "sets/op-01.html")  // 한 단계 아래 — current 는 항상 루트 기준 전체 경로
// 한국어 메뉴는 navHtmlKo() — ko/ 는 경로 구조가 달라 따로 둔다.
//
// ⚠️ 항목을 늘릴 때는 좁은 화면을 확인할 것. 8개일 때 이미 881~1220px 구간에서
//    가로 넘침이 났고(2026-08-30), styles.css 의 @media (max-width:1220px) 가
//    가로 스크롤로 받아내고 있다.

const fs = require("fs");
const path = require("path");

// [영문 라벨, 한국어 라벨, 경로(루트 기준), 루트상대인가]
//   루트상대=false 면 사이트 절대경로(/cards/ 처럼)라 접두어를 붙이지 않는다.
// 2026-09-01 소유자 지시로 메뉴에서 숨긴 항목이 아래 주석 처리돼 있다.
//   Compare · Top PSA 10 · PSA Population · Set Guides · Cards
//   이유: 긴 산문 위주라 사람이 안 본다는 판단("AI 가 쓴 글 같다").
//   페이지·사이트맵·색인은 그대로 둔다 — 애드센스 심사는 크롤링으로 보므로 대상에 남는다.
//   애드센스 통과 후 삭제 예정. 되살리려면 주석만 풀면 된다.
// ── NEW 배지 (다섯 번째 칸: 이 날짜까지만 보여준다)
// 영구히 붙어 있는 NEW 는 아무 뜻이 없다 — 오히려 사이트가 방치된 것처럼 보인다.
// 그래서 만료일을 값으로 박아 두고, 지나면 메뉴를 다시 만들 때 저절로 사라지게 한다
// (inject-nav 가 매일 워크플로에서 돌면서 전 페이지 메뉴를 다시 쓴다).
// 배지 자체는 styles.css 의 ::after 로 그린다 — 자식 요소로 넣으면 언어를 바꿀 때
// textContent 가 통째로 갈리면서 같이 지워진다.
const ITEMS = [
  ["One Piece Booster Boxes", "원피스 부스터 박스", "./", true],
  // ["Cards", "카드", "/cards/", false],
  ["One Piece eBay Auctions", "원피스 이베이 경매", "auction.html", true, "2026-09-16"],
  ["TCG Auctions", "TCG 경매", "tcg-auction.html", true, "2026-09-16"],
  // ["Compare", "비교", "compare.html", true],
  // ["Top PSA 10", "PSA10 랭킹", "psa10-ranking.html", true],
  // 2026-09-15 소유자 지시: PSA·CGC·TAG 를 한 페이지로 재설계하며 메뉴에 복귀(NEW 배지는 9/30 까지).
  ["One Piece Grading", "원피스 그레이딩 통계", "psa-grading.html", true, "2026-09-30"],
  // ["Set Guides", "세트 가이드", "sets/index.html", true],
  ["Amazon Japan Raffle", "일본 아마존 응모", "amazon-lottery.html", true],
];

// ── 한국어 (2026-09-01 정정)
// 메뉴에는 한국어 '링크'를 넣지 않는다. 전환은 lang-toggle.js 가 버튼을 만들어 담당한다
// (packs.js 를 싣는 페이지는 packs.js 가 자체 버튼을 만든다 — 그쪽이 차트 문구까지 번역한다).
//
// 종전에 메뉴마다 ko/ 링크를 붙였다가 두 가지가 겹쳤다: 원래 있던 토글과 나란히 버튼이 둘이 됐고,
// 한국어판이 없는 페이지에서는 관계없는 ko/ 홈으로 보냈다. ko/ 아래 정적 한국어 페이지는
// 7~8월에 만든 검색 유입용(네이버 크롤러가 JS 를 실행하지 않아 버튼 전환으로는 색인되지 않는다)이라
// 그대로 두되, 메뉴가 아니라 본문·푸터에서 링크한다.

// ── 현재 탭을 보이는 자리로 — 2026-10-13. 모바일 메뉴는 한 줄 가로 스크롤이라 경매·TCG·그레이딩 페이지에서
// 정작 지금 있는 탭이 오른쪽 밖(390px 실측: 그레이딩 탭이 299px 밖)에서 시작했다. 안드로이드 탭 줄처럼 현재 탭을
// 가운데로 당긴다. 메뉴 안에 두는 이유: inject-nav 가 <nav class="nav">…</nav> 를 통째로 갈아끼우므로 함께 교체돼
// 중복이 생기지 않고, 파싱 중 바로 실행돼 첫 그리기 전에 끝난다(이동 효과 없음). 메뉴 자체의 scrollLeft 만 바꾸므로
// 페이지 세로 위치는 건드리지 않는다. 언어 버튼이 뒤늦게 붙어 메뉴 폭이 줄 때를 위해 DOMContentLoaded 에 한 번 더 본다.
// 오른쪽 36px 는 styles.css 의 가로 흐림(mask) 폭이다.
const NAV_CURRENT_SCRIPT = `<script>(function(n){function f(){var a=n.querySelector('[aria-current="page"]');if(!a||n.scrollWidth<=n.clientWidth)return;var r=n.getBoundingClientRect(),b=a.getBoundingClientRect();if(b.left<r.left||b.right>r.right-36)n.scrollLeft+=b.left+b.width/2-r.left-r.width/2;}f();document.addEventListener("DOMContentLoaded",f);})(document.currentScript.parentNode)</script>`;

// prefix: "" (루트) 또는 "../" (한 단계 아래)
// current: 현재 페이지 경로(루트 기준 전체 경로). 메뉴 항목과 일치하면 aria-current 를 붙인다.
function navHtml(prefix = "", current = null, opts = {}) {
  // aria-label 은 항상 붙인다 — 페이지마다 다르면 inject-nav 의 일치 검사가 계속 어긋난다.
  const label = ` aria-label="${opts.ariaLabel || "Primary navigation"}"`;
  const today = new Date().toISOString().slice(0, 10);
  let hasCurrent = false;
  const links = ITEMS.map(([en, ko, href, rel, newUntil]) => {
    const to = rel ? (href === "./" ? (prefix || "./") : prefix + href) : href;
    // 홈은 메뉴 경로가 "./" 라 inject-nav 가 넘기는 "index.html" 과 안 맞아 홈에서만 현재 탭 표시가 빠져 있었다.
    const isCur = !!current && (current === href || (href === "./" && current === "index.html"));
    if (isCur) hasCurrent = true;
    const cur = isCur ? ' aria-current="page"' : "";
    // 만료일이 지나면 속성을 아예 붙이지 않는다 — 배지가 조용히 사라진다.
    const isNew = newUntil && today <= newUntil ? ' data-new="1"' : "";
    return `<a href="${to}"${cur}${isNew} data-ko="${ko}">${en}</a>`;
  }).join("");
  return `<nav class="nav"${label}>${links}${hasCurrent ? NAV_CURRENT_SCRIPT : ""}</nav>`;
}

// ── 푸터 "가격 가이드" 링크 — 2026-09-07 신설.
// 9/1 에 메뉴에서 뺀 허브(카드·세트 가이드·PSA·비교)로 가는 사이트 전체 링크가 4~15 페이지로 줄어,
// 9/1 에 새로 낸 카드 페이지 28개가 사실상 고립됐다(내부 링크 없는 페이지는 색인이 늦고 순위가 안 붙는다).
// 메뉴는 소유자 결정대로 두고, 푸터 첫 줄에 한 줄로만 넣는다. 주소는 전부 정식(canonical) 형태다 —
// index.html 꼴로 걸면 서치콘솔에 "대체 페이지(표준 태그 있음)"가 쌓인다. inject-nav 가 전 페이지에 같은 줄을 넣는다.
// 2026-10-13: 색은 styles.css 토큰만 쓴다(종전 #7d8698·#9aa4b6 리터럴). 라벨은 사이트 라벨 규칙대로 같은 muted 에 굵기로만 구분.
// display:block — 푸터의 `.footer nav { display:flex; gap:18px }` 를 그대로 물려받아 구분점 '·' 이 따로 떠 18px 씩
// 벌어져 있었다(모바일은 줄 맨 앞에 점만 남기도 했다). 글줄로 흘리고, 링크와 그 뒤 점을 nowrap 한 묶음으로 둬
// 점이 줄 머리로 넘어가지 않게 한다(모바일 .footer a 는 탭 영역용 inline-block 이라 nbsp 만으로는 묶이지 않는다).
const GUIDE_STYLE = 'style="display:block;margin:0 0 14px;font-size:13px;line-height:1.9;color:var(--muted);"';
const GUIDE_LABEL_STYLE = 'style="font-weight:700;"';
const GUIDE_ITEM_STYLE = 'style="white-space:nowrap;"';
// 발매 예정 세트 링크 — 2026-09-30. data/upcoming-set-pages.json 의 페이지마다 "<코드> release date" 한 개씩.
// 종전엔 sets/op-18.html·eb-05.html 로 들어오는 내부 링크가 세트 허브와 세트 목록 기사 2장뿐이었다.
// 예정 세트가 바뀌면 그 JSON 만 고치면 전 페이지 푸터가 따라 바뀐다. 파일을 못 읽으면 이 링크만 빠진다.
function upcomingGuideItems() {
  let pages = [];
  try { pages = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "upcoming-set-pages.json"), "utf8")).pages || []; } catch { return []; }
  return pages.filter((p) => p.slug && p.code).map((p) => [`${p.code} release date`, `/sets/${p.slug}.html`, `${p.code} 발매일`]);
}
// 세 번째 칸 = 한국어 토글 라벨(data-ko) — 2026-10-13 QA: 영문 페이지를 한국어로 바꿔도 이 줄이 통째로 영어로 남았다.
// 2026-10-14(W6b): "Packs & MSRP"(팩 수·세트별 정가 글 — 들어오는 내부 링크가 4개뿐이었다)·카드 리스트 허브·글 허브를 더했다.
// 일본어 발매일 표(ja/)는 파일이 있을 때만 — 푸터는 모든 페이지에 깔리므로 없는 주소를 걸지 않는다.
const JA_RELEASE = fs.existsSync(path.join(__dirname, "..", "ja", "release-dates.html")) ? [["日本語", "/ja/release-dates.html"]] : [];
const GUIDE_ITEMS = [
  ["Booster boxes", "/", "부스터 박스"], ["This week", "/weekly.html", "이번 주"], ["Set guides", "/sets/index.html", "세트 가이드"],
  ...upcomingGuideItems(), ["Release dates", "/articles/one-piece-set-list-release-dates.html", "발매일 목록"],
  ["Packs & MSRP", "/articles/how-many-packs-one-piece-booster-box.html", "팩 수·정가"],
  ["All box prices", "/box-prices.html", "전체 박스 시세"], ["Card prices", "/cards/", "카드 시세"], ["Card lists", "/sets/index.html#card-lists", "카드 리스트"], ["Top PSA 10", "/psa10-ranking.html", "PSA10 랭킹"],
  ["Grading population", "/psa-grading.html", "그레이딩 통계"], ["Compare sets", "/compare.html", "세트 비교"], ["Guides", "/articles/", "가이드"], ["Free data", "/free-data.html", "무료 데이터"], ["한국어", "/ko/"],
  ...JA_RELEASE,
];
const GUIDE_ITEMS_KO = [
  ["부스터 박스", "/ko/"], ["이번 주", "/weekly.html"], ["세트 가이드", "/sets/index.html"], ["전체 박스 시세", "/box-prices.html"], ["팩 수·정가", "/articles/how-many-packs-one-piece-booster-box.html"], ["카드 시세", "/ko/cards.html"], ["카드 리스트", "/sets/index.html#card-lists"], ["PSA10 랭킹", "/psa10-ranking.html"],
  ["그레이딩 통계", "/ko/grading.html"], ["세트 비교", "/compare.html"], ["가이드", "/articles/"], ["무료 데이터", "/free-data.html"], ["아마존 응모", "/ko/amazon-lottery.html"], ["English", "/"],
  ...JA_RELEASE,
];
function guideLinksHtml(inKo = false) {
  const items = inKo ? GUIDE_ITEMS_KO : GUIDE_ITEMS;
  const label = inKo ? "가격 가이드" : "Price guides";
  const links = items.map(([text, href, ko], i) => `<span ${GUIDE_ITEM_STYLE}><a href="${href}"${!inKo && ko ? ` data-ko="${ko}"` : ""}>${text}</a>${i < items.length - 1 ? " ·" : ""}</span>`).join(" ");
  return `<nav class="guideLinks" aria-label="${label}" ${GUIDE_STYLE}><span ${GUIDE_LABEL_STYLE}${inKo ? "" : ' data-ko="가격 가이드:"'}>${label}:</span> ${links}</nav>`;
}

// ko/ 페이지용. ko/ 안에 있는 파일은 ko/ 안을 가리키고, 나머지는 ../ 로 나간다.
const KO_ITEMS = [
  ["원피스 부스터 박스", "./"],
  // 2026-09-15 네이버 노출용: "원피스 카드 시세" 검색 착지가 ko/cards.html 이라 한국어 메뉴에만 되살린다(영문 메뉴는 그대로).
  ["카드 시세", "cards.html"],
  ["원피스 이베이 경매", "auction.html"],
  ["TCG 경매", "../tcg-auction.html"],
  // ["세트 비교", "../compare.html"],
  // ["PSA10 랭킹", "../psa10-ranking.html"],
  ["원피스 그레이딩 통계", "grading.html"],
  // ["세트 가이드", "../sets/index.html"],
  ["일본 아마존 응모", "amazon-lottery.html"],
];

// current: 루트 기준 경로("ko/auction.html") — 영문 메뉴처럼 aria-current 와 현재 탭 당김 스크립트를 붙인다.
// enHref : 이 페이지의 영문판(hreflang en). 2026-10-13 QA: "English" 가 메뉴 맨 끝(390px 에서 803px)이라 안 보였고,
//          눌러도 ../(영문 홈)로 가서 그 페이지의 영문판이 아니었다. 영문 페이지의 언어 버튼처럼 .topbar 직속(.langBtn)에 두고
//          영문판으로 보낸다. 누르면 언어 선택(opbox_lang·ktcg_hl)을 en 으로 남긴다 — 안 남기면 영문 페이지가 저장된 ko 로
//          다시 한글로 바뀐다. data-lang-link 는 inject-nav 가 메뉴와 함께 이 링크를 갈아끼울 때 찾는 표식이다.
const KO_EN_LINK = (href) => `<a class="navKo langBtn" href="${href}" hreflang="en" lang="en" data-lang-link onclick="try{localStorage.setItem('opbox_lang','en');localStorage.setItem('ktcg_hl','en')}catch(e){}">English</a>`;
function navHtmlKo(current = null, enHref = "../") {
  let hasCurrent = false;
  const links = KO_ITEMS.map(([ko, href]) => {
    const full = href === "./" ? "ko/index.html" : href.startsWith("../") ? href.slice(3) : `ko/${href}`;
    const isCur = !!current && current === full;
    if (isCur) hasCurrent = true;
    return `<a href="${href}"${isCur ? ' aria-current="page"' : ""}>${ko}</a>`;
  }).join("");
  return `<nav class="nav" aria-label="주요 메뉴">${links}${hasCurrent ? NAV_CURRENT_SCRIPT : ""}</nav>${KO_EN_LINK(enHref)}`;
}

// 가드가 쓰는 목록 — 모든 페이지에 이 한국어 라벨이 다 있어야 한다.
const KO_LABELS = ITEMS.map(([, ko]) => ko);

// 착지 페이지 "다음 클릭" 줄 — 2026-09-14 신설. GA4 28일 실측: ChatGPT 가 보내는 속 페이지(세트 목록·PSA10 랭킹·OP-17)는
// 1인당 1.1~1.3장 보고 나가고, 이베이 클릭 53건 중 47건이 홈에서 났다. 그래서 <h1> 바로 밑에 홈·응모·세트 가이드
// 세 링크를 둬 두 장째로 끌어온다(inject-nav 가 전 페이지에 넣는다). OP-18 문구는 발매·응모 상황에 따라 여기 한 곳만 바꾼다.
// 2026-09-30: OP-18 발매일 페이지 링크 추가. 자기 자신을 가리키는 칸은 그 페이지에서 뺀다(current).
// 2026-10-13: 영문 페이지 칩에 세 번째 칸(한국어 라벨)을 단다 — data-ko 가 없어 한국어로 바꿔도 칩만 영어로 남았다.
// 화살표까지 라벨에 넣는다(lang-toggle.js·packs.js 가 textContent 를 통째로 갈아끼운다). ko/ 줄은 처음부터 한국어라 필요 없다.
const NEXT_ITEMS = [["Live box prices", "/", "실시간 박스 시세"], ["OP-18 Amazon invite", "/amazon-lottery.html", "OP-18 아마존 응모"], ["OP-18 release date", "/sets/op-18.html", "OP-18 발매일"], ["All set guides", "/sets/index.html", "전체 세트 가이드"]];
const NEXT_ITEMS_KO = [["실시간 박스 시세", "/ko/"], ["OP-18 아마존 응모", "/ko/amazon-lottery.html"], ["카드 시세", "/ko/cards.html"]];
function nextLinksHtml(inKo = false, current = null) {
  // Data dashboards lead to their own comparisons, not unrelated release promotions.
  const auctionSections = {
    "tcg-auction.html": [["By game", "games", "게임별 비교"], ["Weekly trend", "weekly", "주별 흐름"], ["Sold prices", "prices", "낙찰가 비교"]],
    "auction.html": [["Card prices", "prices", "카드 시세"], ["Weekly trend", "trend", "주별 흐름"], ["Item types", "kinds", "종류별"], ["By set", "sets", "세트별"]],
  };
  const sections = auctionSections[current === "ko/auction.html" ? "auction.html" : current];
  if (sections) return `<nav class="nextLinks" aria-label="${inKo ? "이 페이지에서" : "On this page"}">${sections.map(([en, id, ko]) => `<a href="#${id}"${inKo ? "" : ` data-ko="${ko}"`}>${inKo ? ko : en}</a>`).join("")}</nav>`;
  const items = (inKo ? NEXT_ITEMS_KO : NEXT_ITEMS).filter(([, href]) => !current || href !== "/" + current);
  const label = inKo ? "다음 보기" : "Next";
  return `<nav class="nextLinks" aria-label="${label}">${items.map(([text, href, ko]) => `<a href="${href}"${ko ? ` data-ko="${ko} →"` : ""}>${text} →</a>`).join("")}</nav>`;
}

module.exports = { ITEMS, navHtml, navHtmlKo, KO_LABELS, guideLinksHtml, nextLinksHtml };
