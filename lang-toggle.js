// 한↔영 전환 버튼 — 2026-09-01 신설. 소유자 지시: "한국어 누르면 모든 페이지가 한글로,
// 다시 English 누르면 영문으로."
//
// ── 왜 필요했나
// 한국어로 가는 길이 세 갈래로 갈라져 있었다.
//   ① packs.js 의 자체 버튼 — 홈·비교·세트 25장에만 있다.
//   ② ?hl=ko URL 파라미터 — 아마존 응모 페이지. 버튼이 없어 주소를 직접 쳐야 했다.
//   ③ ko/ 정적 페이지 — 7~8월에 만든 검색 유입용(네이버 크롤러가 JS 를 실행하지 않아
//      ①로는 한국어 검색에 잡히지 않는다). 별개 페이지라 "그 페이지의 한국어판"이 아니다.
// 그래서 경매·TCG·랭킹 같은 페이지에는 한국어로 갈 방법이 아예 없었다.
//
// ── 어떻게 동작하나
// 번역할 요소에 data-ko 를 붙여 두면 이 스크립트가 그 자리에서 글자를 바꾼다. 영문 원문은
// 처음 전환할 때 data-en 에 담아 두므로 몇 번을 오가도 원문이 상하지 않는다.
// 선택은 localStorage 에 남아 다음 페이지·다음 방문에도 이어진다.
//
// ⚠️ packs.js 가 자체 토글을 만드는 페이지에서는 이 스크립트가 버튼을 만들지 않는다.
//    두 개가 되면 사용자가 어느 것을 눌러야 하는지 알 수 없다(2026-09-01 에 실제로 그렇게 됐다).
//    그 페이지들은 packs.js 가 차트·표 문구까지 함께 번역하므로 그쪽에 맡기는 것이 맞다.
(function () {
  "use strict";
  var KEY = "opbox_lang";

  function packsOwnsToggle() {
    // 스크립트 "태그"로 판정한다. 플래그나 버튼 유무만 보면 로드 순서에 걸린다 —
    // packs.js 가 아직 실행되기 전이면 둘 다 없어서, 홈에 버튼이 두 개 붙었다(2026-09-01 실측).
    // 태그는 HTML 파싱 시점에 이미 DOM 에 있으므로 순서와 무관하다.
    if (document.querySelector('script[src*="packs.js"]')) return true;
    return !!window.__opboxPacksLang || !!document.querySelector("#displayLangToggle");
  }

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function remember(v) {
    try { localStorage.setItem(KEY, v); } catch (e) {}
  }

  // 처음 언어를 정한다: 저장된 선택 > URL(?hl=ko) > 영문.
  // 브라우저가 한국어라는 이유만으로 한글로 바꾸지 않는다 — 이 사이트는 영문 검색 유입이 주다.
  function initialLang() {
    var saved = stored();
    if (saved === "ko" || saved === "en") return saved;
    try {
      if (new URLSearchParams(location.search).get("hl") === "ko") return "ko";
    } catch (e) {}
    return "en";
  }

  function apply(lang) {
    var nodes = document.querySelectorAll("[data-ko]");
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.dataset.en == null) el.dataset.en = el.textContent;   // 원문 보관(한 번만)
      el.textContent = lang === "ko" ? el.dataset.ko : el.dataset.en;
    }
    // 안에 링크가 든 문단은 textContent 로 바꾸면 링크가 통째로 사라진다. 그런 곳은
    // data-ko-html 에 링크까지 포함한 한국어를 담아 두고 innerHTML 로 갈아끼운다.
    // 값은 우리가 빌드 때 써 넣은 것이고 방문자 입력이 아니다.
    var rich = document.querySelectorAll("[data-ko-html]");
    for (var j = 0; j < rich.length; j++) {
      var re = rich[j];
      if (re.dataset.enHtml == null) re.dataset.enHtml = re.innerHTML;
      re.innerHTML = lang === "ko" ? re.dataset.koHtml : re.dataset.enHtml;
    }
    document.documentElement.lang = lang;
    // 스스로 글자를 만드는 부분(차트 라벨 등)은 data-ko 로 못 바꾼다. 이벤트로 알려서 다시 그리게 한다.
    // 클릭만 듣게 하면 첫 로드(저장된 ko 로 시작할 때)를 놓친다 — 그래서 apply 때마다 쏜다.
    try { document.dispatchEvent(new CustomEvent("opboxlang", { detail: { lang: lang } })); } catch (e) {}
    var btn = document.querySelector("#langToggle");
    if (btn) {
      btn.textContent = lang === "ko" ? "English" : "한국어";
      btn.setAttribute("aria-label", lang === "ko" ? "Switch to English" : "한국어로 보기");
    }
  }

  function mount() {
    if (packsOwnsToggle()) return;
    var nav = document.querySelector(".topbar .nav");
    if (!nav) return;
    var btn = document.querySelector("#langToggle");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "langToggle";
      btn.type = "button";
      btn.className = "navKo";
      nav.appendChild(btn);
    }
    var lang = initialLang();
    apply(lang);
    btn.addEventListener("click", function () {
      lang = lang === "ko" ? "en" : "ko";
      remember(lang);
      apply(lang);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
