// 한국어 주제 페이지 4장 — 소유자 지시(2026-08-01): "원피스 카드시세 / 원피스 이베이 경매 /
// 원피스 그레이딩 같은 검색에 잡히게 하는 것이 너의 역할" — 그 검색어를 정조준하는 전용 페이지.
//   ko/cards.html   원피스 카드 시세 (NM·PSA10, 일본판)
//   ko/grading.html 원피스 그레이딩 인구 (PSA·CGC·TAG, 세트×판별)
//   ko/auction.html 원피스 이베이 경매 낙찰 데이터 (우리 자체 수집 — 한국어권에 없는 데이터)
//   ko/amazon-lottery.html 일본 아마존 초대판매(추첨) 응모 목록 — 영문 amazon-lottery.html 을 파싱해 한국어 표로
// 원칙: 값은 전부 검증된 데이터 파일에서 파생, 없으면 그 문장/행을 만들지 않는다. 외부 업체명 표기 금지.
// index,follow + 사이트맵 등록(허브 ko/ 는 이미 색인됨 → 내부링크로 연결).
// Run: node tools/generate-ko-topic-pages.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const { navHtmlKo } = require("./site-nav");   // 메뉴는 한 곳에서만 정의한다 — 여기 베껴두면 어긋난다
const CACHE = (fs.readFileSync(path.join(ROOT, "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const fx = d.fx || {};
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => (n == null || !isFinite(n) ? "—" : Math.round(n).toLocaleString("ko-KR") + "원");
const num = (n) => (n == null ? "—" : Number(n).toLocaleString("ko-KR"));
const codes = [...(d.jp?.list || []), ...(d.extra?.list || [])];
const nameKo = (c) => (d.sets[c] && d.sets[c].nameKo) || c;

// ── 카드 썸네일 — 자체 호스팅 경로만 쓴다(가드 I1: 외부 CDN 핫링크 금지).
//    ko/ 는 루트보다 한 단계 아래라 상대경로에 ../ 를 붙인다. 맵에도 없고 자체호스팅 이미지도 없으면 이미지 없이 간다.
const IMG_MAP = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "img", "cards", "map.json"), "utf8")); } catch { return {}; } })();
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
function thumbRel(c) {
  const hit = IMG_MAP[slugify(c.number + "-" + c.name)];
  if (hit) return "../" + String(hit).replace(/^\.?\//, "");
  const img = c.image || "";
  if (img.startsWith(SITE + "/")) return "../" + img.slice(SITE.length + 1);
  if (img && !/^https?:/.test(img)) return "../" + img.replace(/^\.?\//, "");
  return null;   // c.img(외부 CDN)는 쓰지 않는다 — 빈 칸이 핫링크보다 낫다.
}
const { variant } = require("./image-variants");
const thumbHtml = (c) => {
  const raw = thumbRel(c);
  const src = raw ? (variant(raw, "thumb") || { src: raw }).src : raw;   // 40px 칸엔 96px 썸네일(2026-10-08)
  return src ? `<img class="cardThumb" src="${esc(src)}" alt="${esc(c.name)} 일판 카드" width="40" height="56" loading="lazy" decoding="async" />` : "";
};

// ── PSA 10 실낙찰(원화) — psa10Ebay.middle 은 통화가 섞여 저장된다(USD 90건 / KRW 18건).
//    통화를 안 보고 won() 으로 찍으면 USD 값이 원화로 둔갑해 1/1,300 로 표시된다(2026-09-16 수정).
//    표본 3건 미만은 값을 내지 않는다 — 표 아래 주석이 "3건 이상"이라고 말하고 있다.
function psa10Krw(c) {
  const p = c.psa10Ebay;
  if (!p || !p.soldBased || p.middle == null || (p.sampleSize || 0) < 3) return null;
  // fx.usdKrw 가 없으면 NaN 이 흘러 배수칸이 "×NaN" 이 되고 정렬까지 깨진다 — 아예 빈칸으로 둔다(2026-09-16 정합성 검사).
  const krw = p.currency === "USD" ? (fx.usdKrw ? p.middle * fx.usdKrw : null) : p.currency === "KRW" ? p.middle : null;
  return krw == null ? null : { krw, n: p.sampleSize };   // 통화 불명이면 빈칸
}

// ── 카드명 한글 병기 — 사전은 tools/ko-labels.js 한 곳(영문 auction.html 의 토글 data-ko 와 같은 사전). 2026-10-13 분리.
//    캐릭터명만 매핑하고(변형 접미사는 영문 그대로), 확신 없는 이름은 넣지 않는다: 빈 값이 틀린 값보다 낫다.
const { koCharOf } = require("./ko-labels");

// <head> 공통 태그 — 네 장이 같은 노출 상태(robots·canonical·hreflang·og·빵부스러기)를 공유한다. 페이지별 <style> 은 호출 쪽에서 붙인다.
function koHeadTags({ file, title, desc, breadcrumbName, enHref }) {
  const canonical = `${SITE}/ko/${file}`;
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: breadcrumbName, item: canonical },
  ] });
  return `    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <!-- Korean topic pages remain ad-free during AdSense site approval. -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="ko" href="${canonical}" />${enHref ? `
    <link rel="alternate" hreflang="en" href="${SITE}/${enHref}" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/${enHref}" />` : ""}
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(desc)}" />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:title" content="${esc(title)}" />
    <meta property="og:description" content="${esc(desc)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="../styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />`;
}

// 공용 페이지 틀 — ko 세트 페이지와 같은 look(스타일 재사용)
function page({ file, title, desc, h1, eyebrow, body, breadcrumbName, enHref, note }) {
  return `<!doctype html>
<html lang="ko">
  <head>
${koHeadTags({ file, title, desc, breadcrumbName, enHref })}
    <style>
      .koBoard { width: 100%; max-width: 860px; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 9px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11.5px; white-space: nowrap; }
      .koBoard th.l, .koBoard td.l { text-align: left; }
      .koBoard td { padding: 8px 9px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
      .koBoard td.l { color: #cfd6e4; }
      .koBoard td.l small { color: var(--muted); display: block; font-size: 11.5px; }
      .koProse { color: #9aa4b6; font-size: 14px; max-width: 760px; line-height: 1.78; margin: 8px 0; }
      .koProse strong { color: #cfd6e4; }
      main h2 { font-size: 18.5px; margin: 26px 0 6px; }
      .koNote { color: var(--muted); font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
      .faqItem { max-width: 760px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 4px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14.5px; }
      .faqItem p { color: #9aa4b6; font-size: 13.5px; line-height: 1.65; margin: 4px 0 10px; }
      .koCta { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .koCta a { display: inline-block; padding: 11px 18px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .koCta .primary { background: var(--accent); color: #08131a; }
      .koCta .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
      .up { color: var(--accent); } .down { color: var(--red); }
      .koBoard td.l .cardCell { display: flex; align-items: center; gap: 9px; }
      .koBoard img.cardThumb { flex: 0 0 auto; width: 40px; height: 56px; object-fit: cover; border-radius: 3px; background: #12151b; }
      /* 모바일(<=640px): 카드명 칸이 폭을 다 먹어 가격 열이 화면 밖으로 밀렸다(2026-09-16 실측 375px).
         표본·NM 열을 접고 PSA 10 실낙찰·배수만 남긴다 — 이 페이지를 보는 이유가 그 두 값이다. */
      @media (max-width: 640px) {
        /* table-layout:fixed 는 열을 균등 분배해 카드명이 한 글자씩 끊겼다(2026-09-16 375px 실측).
           자동 배분에 맡기고 숫자 열만 nowrap 으로 폭을 확보한다. */
        .koBoard { font-size: 12.5px; }
        .koBoard th.l, .koBoard td.l { width: 100%; }
        .koBoard th, .koBoard td { padding: 6px 4px; }
        .koBoard th { font-size: 11.5px; white-space: normal; overflow-wrap: anywhere; }
        .koBoard .hideM { display: none; }
        .koBoard td.l { white-space: normal; overflow-wrap: anywhere; }
        .koBoard td.l small { font-size: 11.5px; }
        .koBoard img.cardThumb { width: 30px; height: 42px; }
        .koBoard td.l .cardCell { gap: 7px; min-width: 0; }
      }
      .koBoard th.w, .koBoard td.w { white-space: normal; }
      .koBoard td.l a { color: var(--accent); }
      .koSteps { color: #cfd6e4; font-size: 13.5px; line-height: 1.8; max-width: 760px; padding-left: 20px; margin: 8px 0 14px; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${navHtmlKo()}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:var(--muted);text-decoration:none">한국어 시세</a> · ${esc(eyebrow)}</p>
      <h1>${esc(h1)}</h1>
${body}
      ${/* FAQ 섹션은 2026-08-28 소유자 지시로 삭제 — 표만 남긴다 */ ""}
      <p class="koNote">${note || `데이터: 이베이 실거래·검증된 매물 집계, 공개 그레이딩 인구 리포트. 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}). 마지막 갱신 ${esc(DATA_DATE)}. 시세는 참고용이며 투자·구매 판단의 책임은 본인에게 있습니다.`}</p>
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
}

// ── ① ko/cards.html — 원피스 카드 시세 (네이버 검색어: "원피스카드 일판", "원피스 카드 시세")
function cardsPage() {
  const rows = [];
  for (const code of codes) {
    for (const c of d.sets[code].cards || []) {
      if (c.nmJpy == null || !c.number) continue;
      const p10 = psa10Krw(c);
      rows.push({
        code, name: c.name, number: String(c.number), nmKrw: c.nmJpy * fx.jpyKrw,
        p10Krw: p10 ? p10.krw : null, n: p10 ? p10.n : null,
        thumb: thumbHtml(c), ko: koCharOf(c.name),
      });
    }
  }
  rows.sort((a, b) => b.nmKrw - a.nmKrw);
  const top = rows.slice(0, 30);
  const t0 = top[0];
  const sold = rows.filter((r) => r.p10Krw != null).sort((a, b) => b.p10Krw - a.p10Krw).slice(0, 20);

  // 카드 셀 — 한글 캐릭터명이 잡히면 [한글 / 영문 원본] 두 줄, 안 잡히면 영문만.
  const cell = (r) => `<td class="l"><span class="cardCell">${r.thumb}<span>${r.ko ? `${esc(r.ko)}<small>${esc(r.name)}</small>` : esc(r.name)}<small>${esc(r.number)} · ${esc(r.code)} ${esc(nameKo(r.code))}</small></span></span></td>`;

  const tr = top.map((r, i) => `<tr><td>${i + 1}</td>${cell(r)}<td class="hideM">${won(r.nmKrw)}</td><td>${r.p10Krw != null ? won(r.p10Krw) : '<span style="color:#6a7182;font-size:12px">집계중</span>'}</td><td>${r.p10Krw != null ? "×" + (r.p10Krw / r.nmKrw).toFixed(1) : "—"}</td></tr>`).join("\n");
  const sTr = sold.map((r, i) => `<tr><td>${i + 1}</td>${cell(r)}<td>${won(r.p10Krw)}</td><td class="hideM">${num(r.n)}</td><td class="hideM">${won(r.nmKrw)}</td><td>×${(r.p10Krw / r.nmKrw).toFixed(1)}</td></tr>`).join("\n");

  const soldBlock = sold.length ? `
      <h2>PSA 10 실낙찰가 상위 ${sold.length} (일판)</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드 (번호 · 세트)</th><th>PSA 10 실낙찰</th><th class="hideM">표본</th><th class="hideM">일판 NM 시세</th><th>배수</th></tr></thead>
        <tbody>
${sTr}
        </tbody>
      </table>
      </div>` : "";

  // 세트별 전체 카드 시세 — 2026-10-07. 네이버 "원피스 카드 시세"에서 우리가 1페이지 밖인 이유는 한국어 카드 시세가
  // 이 한 장(30행)뿐이라서다(경쟁 3곳은 한국어 카드명으로 카드별 문서 수천 장). 보유 카드를 세트별로 전부 싣는다 —
  // 한 페이지 안의 표라 "틀만 찍은 대량 페이지" 판정 위험이 없다. 세트 제목은 한국어 세트명으로, ko 세트 페이지에 건다.
  const cellShort = (r) => `<td class="l"><span class="cardCell">${r.thumb}<span>${r.ko ? `${esc(r.ko)}<small>${esc(r.name)}</small>` : esc(r.name)}<small>${esc(r.number)}</small></span></span></td>`;
  const bySet = codes.map((code) => ({ code, list: rows.filter((r) => r.code === code) })).filter((g) => g.list.length);
  const allBlock = `
      <h2 id="all">세트별 전체 카드 시세 — ${rows.length}장 (일판 NM · 원화)</h2>
      <p class="koNote">세트마다 추적 중인 카드 전부입니다. 일판 NM 시세 높은 순. 세트 이름을 누르면 그 세트의 박스 시세·재판 이력으로 갑니다.</p>
${bySet.map((g) => `      <h3 id="set-${g.code.toLowerCase()}"><a href="${g.code.toLowerCase()}.html">${esc(g.code)} ${esc(nameKo(g.code))}</a> 카드 시세 (${g.list.length}장)</h3>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드 (번호)</th><th>일판 NM 시세</th><th class="hideM">PSA 10 실낙찰</th></tr></thead>
        <tbody>
${g.list.map((r, i) => `<tr><td>${i + 1}</td>${cellShort(r)}<td>${won(r.nmKrw)}</td><td class="hideM">${r.p10Krw != null ? won(r.p10Krw) : "—"}</td></tr>`).join("\n")}
        </tbody>
      </table>
      </div>`).join("\n")}`;

  const body = `
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드 (번호 · 세트)</th><th class="hideM">일판 NM 시세</th><th>PSA 10 실낙찰</th><th>배수</th></tr></thead>
        <tbody>
${tr}
        </tbody>
      </table>
      </div>
      <p class="koNote">일판 NM = 일본 리테일 무등급 재고가. PSA 10 실낙찰 = 이베이 낙찰 중앙값. "집계중"은 검증된 낙찰 표본(3건 이상)이 아직 없다는 뜻이며 추정치로 채우지 않습니다. 정발(한글판)은 집계하지 않습니다.</p>${soldBlock}${allBlock}
      <h2>표기 — 일판 · 정발 · 패러렐 · 망가 아트</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l">용어</th><th class="l w">뜻</th><th class="l w">이 사이트 수록 여부</th></tr></thead>
        <tbody>
          <tr><td class="l">일판</td><td class="l w">일본판(일본어) 카드</td><td class="l w">수록 — 이 표 전부</td></tr>
          <tr><td class="l">정발</td><td class="l w">한국 정식 발매 한글판</td><td class="l w">미수록</td></tr>
          <tr><td class="l">패러렐</td><td class="l w">같은 번호의 다른 일러스트 버전</td><td class="l w">변형마다 별도 행</td></tr>
          <tr><td class="l">망가 아트</td><td class="l w">만화 원고풍 일러스트 변형</td><td class="l w">변형마다 별도 행</td></tr>
          <tr><td class="l">NM</td><td class="l w">Near Mint, 무등급 최상 상태</td><td class="l w">일판 NM 시세 열</td></tr>
          <tr><td class="l">PSA 10</td><td class="l w">PSA 감정 만점 등급</td><td class="l w">PSA 10 실낙찰 열</td></tr>
        </tbody>
      </table>
      </div>
      <div class="koCta">
        <a class="primary" href="./">전 세트 박스 시세표 →</a>
        <a class="ghost" href="grading.html">그레이딩 인구 →</a>
        <a class="ghost" href="auction.html">이베이 경매 낙찰 데이터 →</a>
        <a class="ghost" href="amazon-lottery.html">아마존 응모 목록 →</a>
      </div>`;

  return page({
    file: "cards.html",
    enHref: "cards/",   // 정규 URL — cards/index.html 을 가리키면 구글이 hreflang 을 무시한다(2026-09-16)
    title: "원피스 카드 시세 — 일판 NM·PSA10 실낙찰 | opboxindex",
    desc: `원피스카드 일판 낱장 시세 — 인기 ${top.length}장 순위와 22세트 전체 ${rows.length}장의 NM·PSA 10 실낙찰가를 원화로. 정발(한글판) 제외.`,
    h1: "원피스 카드 시세 — 일판 낱장 NM·PSA 10 실낙찰 (원화)",
    eyebrow: "원피스카드 일판 시세",
    breadcrumbName: "원피스 카드 시세 (일판)",
    body,
    faqs: [
      { q: "원피스 카드 시세는 어디서 확인하나요?", a: `이 페이지에서 일본판 상위 카드의 NM 시세와 PSA 10 실낙찰가를 원화로 매일 갱신합니다. NM은 일본 리테일 재고가, PSA 10은 이베이 실제 낙찰 중앙값 기준입니다 (${DATA_DATE} 기준).` },
      { q: "지금 제일 비싼 원피스 카드는 뭔가요?", a: `${t0.name}(${t0.number}, ${t0.code})의 NM 추적가는 약 ${won(t0.nmKrw)}이며 현재 1위입니다. 순위는 시세에 따라 바뀌며 표에서 최신 순위를 확인할 수 있습니다.` },
      { q: "PSA 10 가격은 호가인가요, 실거래가인가요?", a: "실거래가입니다. 이베이에서 실제로 낙찰된 판매만 모아 중앙값을 내며, 표본 3건 미만이면 숫자 대신 '집계중'으로 비워 둡니다." },
      { q: "같은 번호인데 가격이 왜 몇 배씩 차이 나나요?", a: "변형이 다르기 때문입니다. 일반판·패러렐·망가 아트·SP는 같은 번호라도 전혀 다른 카드로 거래됩니다. 이 표는 변형 하나에 고정된 값이므로, 매물 비교 시 일러스트까지 맞는지 확인해야 합니다." },
    ],
  });
}

// ── ② ko/grading.html — 원피스 그레이딩 ────────────────────────────────────
function gradingPage() {
  const rows = codes.map((code) => {
    const s = d.sets[code];
    const g = s.graders || {};
    return {
      code, nk: nameKo(code),
      jp: s.psaFull ? { t: s.psaFull.total, gem: s.psaFull.gemRate } : null,
      en: s.psaFullEn ? { t: s.psaFullEn.total, gem: s.psaFullEn.gemRate } : null,
      cgc: g.cgc && (g.cgc.jp || g.cgc.en) ? (g.cgc.jp || g.cgc.en) : null,
      tag: g.tag && (g.tag.jp || g.tag.en) ? (g.tag.jp || g.tag.en) : null,
    };
  }).sort((a, b) => ((b.jp?.t || 0) + (b.en?.t || 0)) - ((a.jp?.t || 0) + (a.en?.t || 0)));

  const tj = rows.reduce((t, r) => t + (r.jp?.t || 0), 0);
  const te = rows.reduce((t, r) => t + (r.en?.t || 0), 0);
  const big = rows[0];
  const jpGem = rows.filter((r) => r.jp && r.jp.gem != null);
  const hi = jpGem.reduce((m, r) => (r.jp.gem > m.jp.gem ? r : m));
  const lo = jpGem.reduce((m, r) => (r.jp.gem < m.jp.gem ? r : m));

  const tr = rows.map((r) => `<tr><td class="l">${esc(r.code)}<small>${esc(r.nk)}</small></td><td>${r.jp ? num(r.jp.t) : "—"}</td><td>${r.jp ? r.jp.gem + "%" : "—"}</td><td>${r.en ? num(r.en.t) : "—"}</td><td>${r.en ? r.en.gem + "%" : "—"}</td><td>${r.cgc ? num(r.cgc.total) : "—"}</td><td>${r.tag ? num(r.tag.total) : "—"}</td></tr>`).join("\n");

  const body = `
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l">세트</th><th>PSA 일본판</th><th>젬률</th><th>PSA 영문판</th><th>젬률</th><th>CGC</th><th>TAG</th></tr></thead>
        <tbody>
${tr}
        </tbody>
      </table>
      </div>
      <p class="koNote">CGC·TAG 열은 각 등급사에 접수된 누적 장수(대표 판 기준)입니다. "—"는 미집계이며 0이 아닙니다.</p>
      <h2>그레이딩 데이터 읽는 법</h2>
      <div class="koCta">
        <a class="primary" href="cards.html">카드 시세 →</a>
        <a class="ghost" href="../psa-grading.html">영문 상세(주간 증감) →</a>
        <a class="ghost" href="auction.html">이베이 경매 데이터 →</a>
      </div>`;

  return page({
    file: "grading.html",
    enHref: "psa-grading.html",
    title: "원피스 그레이딩 통계 PSA·CGC·TAG | opboxindex",
    desc: `PSA·CGC·TAG 세트별 등급 인구와 주간 증가. 일본판·영문판 분리 집계, 매주 갱신 (${DATA_DATE}).`,
    h1: "원피스 카드 그레이딩 인구 (PSA · CGC · TAG)",
    eyebrow: "그레이딩",
    breadcrumbName: "원피스 그레이딩 인구",
    body,
    faqs: [
      { q: "원피스 그레이딩은 어디에 얼마나 접수돼 있나요?", a: `추적 중인 ${rows.length}개 세트 기준 PSA에 일본판 ${num(tj)}장, 영문판 ${num(te)}장이 누적 접수돼 있습니다(${DATA_DATE} 기준). CGC·TAG 누적은 표에서 세트별로 확인할 수 있습니다.` },
      { q: "젬률이 뭔가요?", a: "그 세트에서 PSA 10(만점)을 받은 비율입니다. 젬률이 낮을수록 만점 개체가 귀해서 PSA 10 프리미엄이 커지고, 90% 안팎이면 만점이 흔해 프리미엄이 얇아집니다." },
      { q: "PSA·CGC·TAG 수량을 합쳐서 보면 안 되나요?", a: "안 됩니다. PSA 10, CGC 프리스틴 10/젬 민트 10, TAG 10/10P는 기준이 서로 다른 등급이라 합산하면 어느 쪽도 설명하지 못하는 숫자가 됩니다. 이 사이트는 등급사·판별을 항상 분리해 표기합니다." },
      { q: "일본판과 영문판 중 어느 쪽이 더 많이 그레이딩되나요?", a: `추적 세트 합계 기준 영문판(${num(te)}장)이 일본판(${num(tj)}장)보다 많고, 격차는 매주 커지고 있습니다. 두 판은 별도 인쇄본이라 시장도 따로 움직입니다.` },
    ],
  });
}

// ── ③ ko/auction.html — 원피스 이베이 경매 ─────────────────────────────────
// 2026-10-13: 영문 auction.html(tools/generate-auction-page.js, 승인 목업 "가격판 우선")과 같은 구조·같은 데이터의 한국어판.
// 구조: ① h1 + 제휴 고지 ② 시장 온도 3칸(최근 7일 vs 직전 7일) ③ 카드 가격판(생카드 변형 단위, PSA 10 별도 열)
//       ④ 주별 낙찰률 막대 ⑤ 종류별 표 ⑥ 세트별 표(최근 30일) ⑦ 하단 링크. 우리가 쓴 문장(요약·해설·FAQ)은 넣지 않는다.
// 숫자는 영문판과 같은 tools/auction-page-model.js 에서 받는다(계산 한 벌 — 규칙은 그 파일 머리말). 여기서는 한국어 글자와 배치만.
// 값은 달러 그대로(이베이 낙찰가의 원본 통화) — 환율 환산값을 섞지 않는다. 표는 전부 서버에서 그린다(JS 는 탭·더보기·스와이프 힌트만).
const { buildAuctionModel, CARD_SHOW, SET_SHOW, pct, money, bare, tenth, mdKo: md } = require("./auction-page-model");
const { weekExplorer } = require("./auction-dashboard-view");

function auctionPage() {
  const m = buildAuctionModel();
  if (!m) { console.error("ko/auction 실패: 일별 집계가 3일 미만 — 페이지 미생성"); process.exitCode = 1; return null; }
  const {
    dataThrough: DATA_THROUGH, aggFrom, fullDays, skippedDays, totN,
    last7, prev7, tempGap, kpis, weekly, wkTop: WK_TOP, kindRows, setRows, setWindow,
    cardWindowDays: CARD_WINDOW_DAYS, byPrice, bySales, hasPsa: HAS_PSA,
  } = m;
  const cnt = (n) => (n == null || !isFinite(n) ? "—" : Number(n).toLocaleString("ko-KR"));
  const up = (p) => (p ? "../" + p : null);   // 모델 경로는 루트 기준 — ko/ 는 한 단계 아래

  // ── HTML 조각
  const live = (url) => (url ? `<a class="live" href="${esc(url)}" target="_blank" rel="noopener noreferrer sponsored">진행 경매 →</a>` : "");
  const thumb = (v, i) => (v.img
    ? `<img class="thumb" src="${esc(up(v.img))}" alt="" width="36" height="50"${i >= 3 ? ' loading="lazy"' : ""} />`
    : `<span class="thumb ph" aria-hidden="true">${v.set.split("-").map((p) => `<span>${esc(p)}</span>`).join("")}</span>`);
  function boardRow(v, i) {
    const ed = v.ed === "jp" ? "JP" : "EN";
    const range = v.low != null && v.high != null ? `${money(v.low)}–${bare(v.high)}` : "—";
    const psa = v.psa10Med == null ? "—" : `<span class="pv psa">${money(v.psa10Med)}</span><span class="sub2">${cnt(v.psa10Sold)}건</span>`;
    return `<tr${i >= CARD_SHOW ? " hidden" : ""}>
  <td class="l"><div class="cardCell"><span class="rank">${i + 1}</span>${thumb(v, i)}<div class="info">
    <div class="nameLine"><span class="name">${esc(v.name)}</span>${v.nameKo ? `<span class="nameKo">${esc(v.nameKo)}</span>` : ""}<span class="chip var">${esc(v.id)} · ${esc(v.tierKo)}</span><span class="chip ed dOnly">${ed}</span></div>
    <div class="meta mOnly">${ed} · ${cnt(v.n)}건 중 ${cnt(v.sold)}건 낙찰 · ${pct(v.rate)}</div>
    ${live(v.ebay)}
  </div></div></td>
  <td><span class="pv">${money(v.price)}</span><span class="sub2 mOnly">${range}</span>${v.psa10Med != null ? `<span class="sub2 mOnly psaM">PSA 10 <b>${money(v.psa10Med)}</b></span>` : ""}</td>
  <td class="dOnly"><span class="range">${range}</span></td>
  <td class="dOnly">${pct(v.rate)}</td>
  <td class="dOnly">${cnt(v.sold)}<span class="sub2">${cnt(v.n)}건 중</span></td>${HAS_PSA ? `
  <td class="dOnly">${psa}</td>` : ""}
</tr>`;
  }
  const boardBody = (rows, id, hidden) => `<tbody id="${id}"${hidden ? " hidden" : ""}>\n${rows.map(boardRow).join("\n")}\n</tbody>`;

  const kindTr = kindRows.map((k) => `<tr>
  <td class="l"><span class="kind">${esc(k.labelKo)}</span><br />${live(k.live)}</td>
  <td>${pct(k.rate)}${k.rate != null ? `<div class="bar" aria-hidden="true"><i style="width:${k.rate}%"></i></div>` : ""}</td>
  <td>${money(k.medJp)}</td>
  <td>${money(k.medEn)}</td>
</tr>`).join("\n");

  const setTr = setRows.map((s, i) => {
    const name = s.nameKo || s.nameEn;
    return `<tr${i >= SET_SHOW ? " hidden" : ""}>
  <td class="l">${s.page ? `<a class="setCode" href="${up(s.page)}">${esc(s.code)}</a>` : `<span class="setCode">${esc(s.code)}</span>`}${name && name !== s.code ? `<span class="setName">${esc(name)}</span>` : ""}</td>
  <td>${cnt(s.closed)}</td>
  <td>${pct(s.rate)}</td>
  <td>${money(s.med)}</td>
</tr>`;
  }).join("\n");

  // 시장 온도 칸 — 화살표·차이·직전값. 종료 건수의 증감은 좋고 나쁨이 없어 색을 입히지 않는다(colored=false).
  function kpi(label, k, fmt, deltaFmt, colored) {
    const cls = colored && k.dir ? ` ${k.dir}` : "";
    const delta = k.diff == null ? "—" : `${k.arrow} ${deltaFmt(Math.abs(k.diff))}`;
    return `<div class="kpi"><span class="lbl">${esc(label)}</span><b>${fmt(k.cur)}</b><span class="delta${cls}">${delta}</span><span class="was">직전 ${fmt(k.prev)}</span></div>`;
  }
  const strip = [
    kpi("낙찰률", kpis.rate, pct, (x) => `${tenth(x)}%p`, true),
    kpi("중앙 낙찰가", kpis.med, money, (x) => money(Math.round(x * 100) / 100), true),
    kpi("종료 경매", kpis.closed, cnt, cnt, false),
  ].join("\n        ");
  const tempRange = last7.from && prev7.from ? `${md(last7.from)}–${md(last7.to)} vs ${md(prev7.from)}–${md(prev7.to)}` : "";

  // 주별 막대 — 높이(h)·값 라벨(key)은 모델이 정한다. 값 라벨은 데스크톱 전부, 모바일은 key 만.
  const wkCols = weekly.map((w) => {
    const title = `${md(w.week)} 주: 낙찰률 ${pct(w.rate)} (${cnt(w.closed)}건 중 ${cnt(w.sold)}건)${w.now ? " — 진행 중" : ""}${w.missing ? " — 빠진 날 있음" : ""}`;
    return `<div class="col${w.key ? " key" : ""}${w.faded ? " part" : ""}" style="--h:${w.h}%" title="${esc(title)}"><span class="v">${w.rate}</span><i></i></div>`;
  }).join("");
  const wkMid = weekly[Math.floor(weekly.length / 2)];
  const wkLast = weekly[weekly.length - 1];
  const wkAxis = weekly.length ? `<span>${md(weekly[0].week)}</span><span>${md(wkMid.week)}</span><span>${md(wkLast.week)}${wkLast.now ? " · 진행 중" : ""}</span>` : "";
  const wkRange = weekly.length ? `${weekly.length}주 · ${md(weekly[0].week)}–${md(DATA_THROUGH)}` : "";
  const weekAccess = weekExplorer(weekly.map(w => ({
    date: w.week, rate: w.rate, sold: w.sold,
    statusEn: [w.now ? "So far" : "", w.missing ? "Days missing" : ""].filter(Boolean).join(" · "),
    statusKo: [w.now ? "진행 중" : "", w.missing ? "빠진 날 있음" : ""].filter(Boolean).join(" · "),
  })), true);

  // ── <head> 는 다른 ko 주제 페이지와 같은 노출 상태(canonical ko·hreflang en↔ko·robots·og·빵부스러기)를 그대로 쓴다.
  const title = "원피스 이베이 경매 낙찰가·낙찰률 | opboxindex";
  const desc = `원피스 이베이 경매 실제 낙찰가와 낙찰률 — 카드별·주별·세트별. ${fullDays}일 ${cnt(totN)}건, 호가 아닌 낙찰 기준 (${DATA_DATE}).`;

  return `<!doctype html>
<html lang="ko">
  <head>
${koHeadTags({ file: "auction.html", title, desc, breadcrumbName: "원피스 이베이 경매 데이터", enHref: "auction.html" })}
    <link rel="stylesheet" href="../auction-dashboard.css?v=${CACHE}" />
    <script defer src="../auction-dashboard.js?v=${CACHE}"></script>
    <style>
      /* 영문 auction.html 과 같은 가격판 우선 레이아웃(2026-10-13 승인 목업). 색은 styles.css 토큰만, 모션 없음, 글자 최소 11.5px. */
      .wrap { max-width: 1040px; margin: 0 auto; padding: 22px 16px 60px; }
      .wrap h1 { max-width: none; margin: 0 0 6px; font-size: clamp(30px, 5vw, 46px); line-height: 1.1; }
      .sub { margin: 0 0 6px; color: var(--muted); font-size: 14px; }
      .wrap .affTop { margin: 0 0 20px; }
      .wrap section { margin: 0 0 38px; }
      .secHead { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 14px; margin: 0 0 6px; }
      .secHead h2 { margin: 0; font-size: 18px; }
      .nt { color: var(--muted); font-size: 12.5px; }
      .line { margin: 0 0 12px; color: var(--muted); font-size: 13.5px; line-height: 1.6; max-width: 760px; }
      .line b { color: var(--ink); font-weight: 600; }

      /* ② 시장 온도 — 숫자 3칸 */
      .strip { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; max-width: 760px; margin: 0 0 8px; }
      .kpi { padding: 12px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
      .kpi .lbl { display: block; color: var(--muted); font-size: 12.5px; }
      .kpi b { display: block; margin: 4px 0 2px; font-family: var(--font-display); font-size: clamp(22px, 5.5vw, 30px); font-weight: 800; letter-spacing: -.02em; line-height: 1.15; font-variant-numeric: tabular-nums; }
      .kpi .delta { display: block; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }
      .kpi .delta.up { color: var(--green); }
      .kpi .delta.down { color: var(--red); }
      .kpi .was { display: block; color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; }

      /* 탭·버튼 */
      .tabs { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 10px 0 12px; }
      .btn { font: inherit; font-size: 13.5px; font-weight: 700; min-height: 40px; padding: 0 14px; border-radius: 8px;
        border: 1px solid var(--line); background: transparent; color: var(--muted); cursor: pointer; }
      .btn[aria-pressed="true"] { border-color: var(--accent-line); background: var(--accent-dim); color: var(--accent); }
      .btn:hover { color: var(--ink); border-color: var(--muted); }
      .btn[aria-pressed="true"]:hover { color: var(--accent); border-color: var(--accent-line); }
      .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
      .swipe { margin-left: auto; color: var(--muted); font-size: 12.5px; }
      .more { margin-top: 10px; color: var(--accent); }
      .more[hidden] { display: none; }

      /* 표 공통 */
      .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: thin; }
      table.t { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
      .t th { text-align: right; padding: 8px 10px; border-bottom: 1px solid var(--line); color: var(--muted); font-size: 12.5px; font-weight: 600; white-space: nowrap; vertical-align: bottom; }
      .t th.l, .t td.l { text-align: left; }
      .t th.c { text-align: center; }
      .t td { text-align: right; padding: 10px; border-bottom: 1px solid var(--line); white-space: nowrap; vertical-align: top; }
      .t tbody tr:hover td { background: var(--paper); }
      .t tr[hidden], .t tbody[hidden] { display: none; }
      .t .sub2 { display: block; margin-top: 2px; color: var(--muted); font-size: 12px; font-weight: 400; }
      /* 터치 대상: 링크 높이를 32px 이상으로(2026-10-13 QA) — 색·모션 없이 크기만 */
      a.live { display: inline-block; margin-top: 4px; padding: 7px 0; color: var(--accent); font-size: 12.5px; font-weight: 600; }
      a.live:hover, a.live:focus-visible { text-decoration: underline; text-underline-offset: 3px; }
      .narrow { max-width: 760px; }

      /* ③ 가격판 — 데스크톱 6열, 모바일(≤640)은 2열(카드·낙찰가)로 접어 가로 스크롤 없음 */
      .cardCell { display: flex; gap: 10px; align-items: flex-start; }
      .rank { flex: 0 0 auto; min-width: 18px; padding-top: 2px; color: var(--muted); font-size: 12.5px; }
      .thumb { flex: 0 0 auto; width: 36px; height: 50px; object-fit: cover; border-radius: 4px; border: 1px solid var(--line); background: var(--paper); box-sizing: border-box; }
      .thumb.ph { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1px; color: var(--muted); font-size: 11.5px; font-weight: 700; line-height: 1.1; }
      .info { min-width: 0; }
      .nameLine { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 6px; }
      .name { color: var(--ink); font-size: 15px; font-weight: 700; line-height: 1.3; }
      .nameKo { color: var(--muted); font-size: 12.5px; }
      .chip { display: inline-block; padding: 0 6px; border: 1px solid var(--line); border-radius: 5px; color: var(--ink); font-size: 12px; line-height: 18px; white-space: nowrap; }
      .chip.var { font-weight: 700; }
      .chip.ed { color: var(--muted); }
      .meta { margin-top: 4px; color: var(--muted); font-size: 12.5px; }
      .pv { color: var(--ink); font-size: 16px; font-weight: 700; }
      .pv.psa { font-size: 15px; }
      .range { color: var(--muted); font-size: 13px; }
      .psaM b { color: var(--ink); font-weight: 700; font-size: 12.5px; }
      @media (min-width: 641px) {
        .board { min-width: 680px; table-layout: fixed; }
        .board th.l { width: 300px; }
        .board th:nth-child(2) { width: 100px; }
        .board th:nth-child(3) { width: 126px; }
        .board th:nth-child(4) { width: 76px; }
        .board th:nth-child(5) { width: 68px; }
        .board th:nth-child(6) { width: 98px; }
        .board th.l, .board td.l { position: sticky; left: 0; z-index: 1; background: var(--bg); white-space: normal; box-shadow: 1px 0 0 var(--line); }
        .board tbody tr:hover td.l { background: var(--paper); }
        .mOnly { display: none !important; }
      }
      @media (max-width: 640px) {
        .board .dOnly { display: none; }
        .board th, .board td { padding-left: 6px; padding-right: 6px; }
        .board td.l { white-space: normal; }
        .board td:nth-child(2) { width: 1%; }
        .cardCell { gap: 8px; }
        .thumb { width: 32px; height: 44px; }
        .nameLine { gap: 3px 5px; }
      }

      /* ④ 주별 낙찰률 — CSS 막대, 축 하나 */
      .wk { padding: 12px 14px 10px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); max-width: 760px; }
      .wkHead { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; margin-bottom: 22px; font-size: 13.5px; font-weight: 600; }
      .wkHead .nt { font-weight: 400; }
      .wkPlot { position: relative; height: 170px; margin-left: 34px; border-bottom: 1px solid var(--line); }
      .guide { position: absolute; left: 0; right: 0; border-top: 1px dashed var(--line); }
      .guide span, .zero { position: absolute; left: -34px; width: 30px; text-align: right; color: var(--muted); font-size: 11.5px; line-height: 1; }
      .guide span { top: -6px; }
      .zero { bottom: -6px; }
      .cols { position: absolute; inset: 0; display: flex; align-items: flex-end; gap: 3px; }
      .col { position: relative; flex: 1 1 0; min-width: 0; height: 100%; }
      .col i { position: absolute; left: 0; right: 0; bottom: 0; height: var(--h); background: var(--accent); border-radius: 3px 3px 0 0; }
      .col.part i { background: rgba(var(--accent-rgb), .38); }   /* 7일을 다 세지 못한 주(진행 중·빠진 날) — 영문판·TCG 와 같은 규칙 */
      .lg { display: inline-flex; align-items: center; gap: 6px; }
      .lg .sw { display: inline-block; width: 10px; height: 12px; border-radius: 2px 2px 0 0; background: rgba(var(--accent-rgb), .38); }
      .col:hover i { background: var(--ink); }
      .col .v { position: absolute; left: -8px; right: -8px; bottom: calc(var(--h) + 3px); text-align: center; color: var(--ink); font-size: 12px; font-variant-numeric: tabular-nums; }
      .wkAxis { display: flex; justify-content: space-between; margin: 6px 0 0 34px; color: var(--muted); font-size: 12px; }
      @media (max-width: 640px) {
        .wkPlot { height: 150px; }
        .col:not(.key) .v { display: none; }
        .strip { gap: 6px; }
        .kpi { padding: 10px 8px; }
      }

      /* ⑤ 종류별 · ⑥ 세트별 */
      .bar { height: 6px; margin-top: 5px; border-radius: 3px; background: var(--line); }
      .bar i { display: block; height: 100%; border-radius: 3px; background: var(--accent); }
      .kind { color: var(--ink); font-weight: 700; }
      .setCode { color: var(--ink); font-weight: 700; }
      a.setCode { display: inline-block; padding: 5px 0; text-decoration: underline; text-decoration-color: rgba(var(--accent-rgb), .55); text-underline-offset: 3px; }
      a.setCode:hover, a.setCode:focus-visible { color: var(--accent); text-decoration-color: currentColor; }
      .setName { display: block; margin-top: 0; color: var(--muted); font-size: 12.5px; white-space: normal; }
      .foot { margin-top: 16px; font-size: 12.5px; color: var(--muted); }
      .foot a { display: inline-block; padding: 7px 0; color: var(--accent); }
      @media (max-width: 480px) { .t td, .t th { padding-left: 8px; padding-right: 8px; } }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${navHtmlKo()}
    </header>
    <main id="main-content" class="wrap">
      <h1>원피스 카드 이베이 경매 시세</h1>
      <p class="sub">이베이 실제 낙찰가 · 기준일 ${esc(DATA_THROUGH)} · USD · UTC</p>
      <p class="affTop"><b>Paid Link:</b> eBay 파트너 네트워크(EPN) 제휴사로서 eBay 링크를 통한 적격 구매가 발생하면 OP Box Index가 수수료를 받습니다.</p>

      <section id="week" aria-label="최근 7일">
        <div class="strip">
        ${strip}
        </div>
        <p class="nt">최근 7일 vs 직전 7일${tempRange ? ` · ${esc(tempRange)}` : ""}${tempGap > 0 ? ` · 빠진 날 ${tempGap}일` : ""}</p>
      </section>

      <section id="prices">
        <div class="secHead"><h2>카드 경매 시세</h2><span class="nt">${CARD_WINDOW_DAYS ? `최근 ${CARD_WINDOW_DAYS}일 · ` : ""}생카드 · 낙찰 3건 이상</span></div>
        <details class="marketDetails"><summary>낙찰가·범위 기준</summary><p class="line"><b>낙찰가</b> = 생카드 낙찰가 중앙값 · ${HAS_PSA ? "<b>PSA 10</b> = 같은 카드 PSA 10 낙찰가 중앙값 · " : ""}<b>범위</b> = 낙찰가 가운데 절반 구간</p></details>
        <div class="tabs" role="group" aria-label="정렬">
          <button class="btn" type="button" data-tab="price" aria-pressed="true">최고가 순</button>
          <button class="btn" type="button" data-tab="sales" aria-pressed="false">많이 팔린 순</button>
          <span class="swipe" id="swipe" hidden>옆으로 밀기 → 범위 · 낙찰률${HAS_PSA ? " · PSA 10" : ""}</span>
        </div>
        <div class="scroll" id="boardScroll">
          <table class="t board" id="boardTable">
            <thead><tr>
              <th class="l">카드</th><th>낙찰가</th><th class="dOnly">범위</th><th class="dOnly">낙찰률</th><th class="dOnly">낙찰</th>${HAS_PSA ? '<th class="dOnly">PSA 10</th>' : ""}
            </tr></thead>
            ${boardBody(byPrice, "boardPrice", false)}
            ${boardBody(bySales, "boardSales", true)}
          </table>
        </div>
        <button class="btn more" type="button" id="moreCards" aria-expanded="false"${byPrice.length <= CARD_SHOW ? " hidden" : ""}>${byPrice.length}장 모두 보기</button>
      </section>

      <section id="trend">
        <div class="secHead"><h2>주별 낙찰률</h2><span class="nt">${esc(wkRange)}</span></div>
        <div class="wk">
          <div class="wkHead"><span>종료 경매 중 낙찰 비율</span><span class="nt lg"><i class="sw" aria-hidden="true"></i><span>사선 = 집계가 불완전한 주</span></span></div>
          <div class="wkPlot">
            <div class="guide" style="bottom:100%"><span>${WK_TOP}%</span></div>
            <div class="guide" style="bottom:50%"><span>${WK_TOP / 2}%</span></div>
            <span class="zero">0</span>
            <div class="cols">${wkCols}</div>
          </div>
          <div class="wkAxis">${wkAxis}</div>
          ${weekAccess}
        </div>
      </section>

      <section id="kinds">
        <div class="secHead"><h2>무엇이 팔리나</h2><span class="nt">${esc(aggFrom)} ~ ${esc(DATA_THROUGH)}${skippedDays ? ` · 미완 수집 ${skippedDays}일 제외` : ""}</span></div>
        <div class="scroll narrow">
          <table class="t">
            <thead>
              <tr><th class="l" rowspan="2">종류</th><th rowspan="2">낙찰률</th><th class="c" colspan="2">중앙 낙찰가</th></tr>
              <tr><th>일본판</th><th>영문판</th></tr>
            </thead>
            <tbody>
${kindTr}
            </tbody>
          </table>
        </div>
      </section>

      <section id="sets">
        <div class="secHead"><h2>세트별 · 최근 ${setWindow.days}일</h2><span class="nt">${setWindow.from ? `${esc(md(setWindow.from))}–${esc(md(setWindow.to))}` : ""}</span></div>
        <div class="scroll narrow">
          <table class="t">
            <thead><tr><th class="l">세트</th><th>종료</th><th>낙찰률</th><th>중앙 낙찰가</th></tr></thead>
            <tbody id="setBody">
${setTr}
            </tbody>
          </table>
        </div>
        <button class="btn more" type="button" id="moreSets" aria-expanded="false"${setRows.length <= SET_SHOW ? " hidden" : ""}>${setRows.length}개 세트 모두 보기</button>
      </section>

      <p class="foot"><a href="../free-data.html">무료 CSV</a> · <a href="../methodology.html">집계 방법</a> · <a href="cards.html">카드 시세</a> · <a href="grading.html">그레이딩 통계</a> · <a href="../sets/index.html">세트 가이드</a></p>
    </main>
    <script>
      // 탭·더보기·스와이프 힌트만 — 표는 서버가 그려 두었다(JS 없이도 보인다).
      (function () {
        var SHOW_CARDS = ${CARD_SHOW}, SHOW_SETS = ${SET_SHOW};
        var sc = document.getElementById("boardScroll"), swipe = document.getElementById("swipe"), moreCards = document.getElementById("moreCards");
        var bodies = { price: document.getElementById("boardPrice"), sales: document.getElementById("boardSales") };
        var tab = "price", cardsOpen = false;
        function rowsOf() { return bodies[tab] ? bodies[tab].querySelectorAll("tr") : []; }
        function applyCards() {
          var rows = rowsOf();
          for (var i = 0; i < rows.length; i++) rows[i].hidden = !cardsOpen && i >= SHOW_CARDS;
          if (moreCards) {
            moreCards.hidden = rows.length <= SHOW_CARDS;
            moreCards.setAttribute("aria-expanded", String(cardsOpen));
            moreCards.textContent = cardsOpen ? "상위 " + SHOW_CARDS + "장만" : rows.length + "장 모두 보기";
          }
        }
        function hint() {
          if (!sc || !swipe) return;
          swipe.hidden = !(sc.scrollWidth > sc.clientWidth + 2);
        }
        var tabs = document.querySelectorAll(".tabs .btn[data-tab]");
        Array.prototype.forEach.call(tabs, function (b) {
          b.addEventListener("click", function () {
            tab = b.getAttribute("data-tab"); cardsOpen = false;
            Array.prototype.forEach.call(tabs, function (o) { o.setAttribute("aria-pressed", String(o === b)); });
            for (var k in bodies) if (bodies[k]) bodies[k].hidden = k !== tab;
            applyCards(); hint();
          });
        });
        if (moreCards) moreCards.addEventListener("click", function () { cardsOpen = !cardsOpen; applyCards(); });
        if (sc) sc.addEventListener("scroll", hint, { passive: true });
        window.addEventListener("resize", hint);

        var moreSets = document.getElementById("moreSets"), setBody = document.getElementById("setBody");
        var setsOpen = false;
        function applySets() {
          if (!moreSets || !setBody) return;
          var rows = setBody.querySelectorAll("tr");
          for (var i = 0; i < rows.length; i++) rows[i].hidden = !setsOpen && i >= SHOW_SETS;
          moreSets.hidden = rows.length <= SHOW_SETS;
          moreSets.setAttribute("aria-expanded", String(setsOpen));
          moreSets.textContent = setsOpen ? "상위 " + SHOW_SETS + "개만" : rows.length + "개 세트 모두 보기";
        }
        if (moreSets) moreSets.addEventListener("click", function () { setsOpen = !setsOpen; applySets(); });
        applyCards(); applySets(); hint();
      })();
    </script>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
}

// ── ④ ko/amazon-lottery.html — 아마존 재팬 초대판매(추첨) 응모 목록 ──────────
//    영문 amazon-lottery.html 이 원본이다. 항목을 두 곳에 손으로 베끼면 하루 만에 어긋나므로
//    여기서 그 파일을 파싱해 한국어 표로 다시 낸다(링크·문안 전부 원본 그대로).
function lotteryEntries() {
  let src;
  try { src = fs.readFileSync(path.join(ROOT, "amazon-lottery.html"), "utf8"); } catch (e) {
    console.warn("ko/amazon-lottery 건너뜀: amazon-lottery.html 을 못 읽음 — " + e.message);
    return null;
  }
  const attrOf = (s, name) => {
    const at = s.indexOf(name + '="');
    if (at < 0) return null;
    const from = at + name.length + 2;
    const end = s.indexOf('"', from);
    return end < 0 ? null : s.slice(from, end);
  };
  const items = [];
  let missingGame = 0;
  for (const m of src.matchAll(/<article\s+([^>]*)>([\s\S]*?)<\/article>/g)) {
    const attrs = m[1], inner = m[2];
    if (!/class="[^"]*\bentryItem\b[^"]*"/.test(attrs)) continue;   // data-game 이 class 앞이든 뒤든 잡힌다
    const game = attrOf(attrs, "data-game");
    if (!game) { missingGame++; continue; }
    // 항목명 = article 안에서 응모 버튼 라벨("응모")을 뺀 첫 data-ko. div 에 붙은 경우와 span 에 붙은 경우가 섞여 있다.
    const ko = [...inner.matchAll(/\bdata-ko="([^"]*)"/g)].map((x) => x[1]).find((v) => v !== "응모") || null;
    const href = (inner.match(/<a[^>]*class="[^"]*\bopenLink\b[^"]*"[^>]*href="([^"]+)"/) || [])[1] || null;
    if (!ko || !href) { console.warn(`ko/amazon-lottery: 이름 또는 링크가 없는 항목 1건 제외 (${game})`); continue; }
    const badge = /class="newBadge"/.test(inner) ? "신규" : /class="hotBadge"/.test(inner) ? "인기" : "";
    items.push({ game, ko, href, badge });
  }
  // 건너뛰면 사이트맵·feed·영문 hreflang 이 없는 파일을 가리킨 채 남는다. 조용히 넘기지 않고 배포를 막는다(2026-09-16).
  if (missingGame) console.error(`ko/amazon-lottery 실패: data-game 없는 항목 ${missingGame}건 — amazon-lottery.html 의 article.entryItem 전부에 data-game 이 있어야 한다`);
  if (!items.length) console.error("ko/amazon-lottery 실패: 응모 항목 0건");
  if (missingGame || !items.length) process.exitCode = 1;
  if (missingGame || !items.length) return null;

  const listAttrs = (src.match(/<section\s+([^>]*class="[^"]*\bentryList\b[^"]*"[^>]*)>/) || [])[1] || "";
  const steps = [...(src.match(/<ol class="raffleSteps">([\s\S]*?)<\/ol>/) || ["", ""])[1].matchAll(/<li[^>]*\bdata-ko="([^"]*)"/g)].map((x) => x[1]);
  const brands = [...src.matchAll(/<a[^>]*class="[^"]*\bbrandBtn\b[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
    .map((m) => ({ href: m[1], label: [...m[2].matchAll(/\bdata-ko="([^"]*)"/g)].map((x) => x[1])[0] || null }))
    .filter((b) => b.label);
  return {
    items,
    checked: attrOf(listAttrs, "data-checked"),
    steps,
    brands,
    affiliate: (src.match(/<p class="affiliateNote"\s+data-ko="([^"]*)"/) || [])[1] || "OP Box Index는 Amazon 어소시에이트로서 적격 구매를 통해 수수료를 받을 수 있습니다.",
  };
}

function lotteryPage() {
  const src = lotteryEntries();
  if (!src) return null;
  const A = 'target="_blank" rel="sponsored noopener noreferrer"';
  const op = src.items.filter((x) => x.game === "onepiece");
  const pk = src.items.filter((x) => x.game === "pokemon");
  const other = src.items.filter((x) => x.game !== "onepiece" && x.game !== "pokemon");
  if (other.length) console.warn(`ko/amazon-lottery: 원피스·포켓몬 외 항목 ${other.length}건은 표에 넣지 않음 (${[...new Set(other.map((x) => x.game))].join(", ")})`);

  const rowsOf = (list) => list.map((x) => `<tr><td class="l w">${x.ko}</td><td class="l">${x.badge || "—"}</td><td class="l"><a href="${x.href}" ${A}>응모 페이지 열기 ↗</a></td></tr>`).join("\n");
  const tableOf = (label, list) => !list.length ? "" : `
      <h2>${label} (${list.length}건)</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l w">상품</th><th class="l">상태</th><th class="l">응모 링크</th></tr></thead>
        <tbody>
${rowsOf(list)}
        </tbody>
      </table>
      </div>`;

  const stepsHtml = src.steps.length ? `
      <h2>응모 절차 — 추첨 ${src.steps.length}단계</h2>
      <ol class="koSteps">
${src.steps.map((s) => `        <li>${s}</li>`).join("\n")}
      </ol>` : "";

  const brandsHtml = src.brands.length ? `
      <h2>브랜드별 전체 목록 (개별 응모 아님)</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l w">브랜드 목록</th><th class="l">링크</th></tr></thead>
        <tbody>
${src.brands.map((b) => `          <tr><td class="l w">${b.label}</td><td class="l"><a href="${b.href}" ${A}>아마존 목록 열기 ↗</a></td></tr>`).join("\n")}
        </tbody>
      </table>
      </div>` : "";

  const body = `
      <p class="koNote">${src.affiliate}</p>${tableOf("원피스 카드 아마존 응모", op)}${tableOf("포켓몬 아마존 응모", pk)}${stepsHtml}
      <h2>응모 조건</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l">항목</th><th class="l w">내용</th></tr></thead>
        <tbody>
          <tr><td class="l">계정</td><td class="l w">Amazon.co.jp 계정 (amazon.com 과 별개 · 가입 무료)</td></tr>
          <tr><td class="l">응모 비용</td><td class="l w">무료 — 신청만으로는 결제되지 않음</td></tr>
          <tr><td class="l">판매가</td><td class="l w">일본 정가</td></tr>
          <tr><td class="l">당첨 통보</td><td class="l w">이메일 — 정해진 기간 내 결제, 지나면 자동 취소</td></tr>
          <tr><td class="l">중복 응모</td><td class="l w">같은 상품 반복 신청은 확률에 반영되지 않음</td></tr>
          <tr><td class="l">해외배송</td><td class="l w">상품마다 다름 — 상품 페이지 배송 안내에서 본인 국가 확인</td></tr>
          <tr><td class="l">배송대행</td><td class="l w">해외배송 불가 상품은 일본 내 배송대행 주소 이용 (별도 비용)</td></tr>
          <tr><td class="l">관세·수입 규정</td><td class="l w">국가별로 다름 — 본인 국가 기준 직접 확인 (금액 미안내)</td></tr>
        </tbody>
      </table>
      </div>${brandsHtml}
      <div class="koCta">
        <a class="primary" href="cards.html">원피스 카드 시세 →</a>
        <a class="ghost" href="./">전 세트 박스 시세표 →</a>
        <a class="ghost" href="grading.html">그레이딩 인구 →</a>
      </div>`;

  return page({
    file: "amazon-lottery.html",
    enHref: "amazon-lottery.html",
    title: "원피스 카드 아마존 응모·포켓몬 응모 | opboxindex",
    desc: `일본 아마존 초대판매(추첨) 응모 가능 목록 — 원피스 ${op.length}건, 포켓몬 ${pk.length}건. 신청 무료.`,
    h1: "원피스 카드 아마존 응모 · 포켓몬 아마존 응모 — 일본 아마존 초대판매(추첨) 목록",
    eyebrow: "아마존 응모",
    breadcrumbName: "아마존 응모 (초대판매)",
    body,
    faqs: [],
    note: `목록 확인일 ${esc(src.checked || DATA_DATE)}. 응모 가능 여부·배송 가능 국가는 아마존 상품 페이지가 기준입니다.`,
  });
}

// ── 쓰기 + 사이트맵 ─────────────────────────────────────
const out = [
  ["cards.html", cardsPage()],
  ["grading.html", gradingPage()],
  ["auction.html", auctionPage()],   // 일별 집계가 3일 미만이면 null — 그 한 장만 건너뛴다(exitCode 1)
].filter(([, html]) => html);
{
  // 원본 파싱이 실패하면(항목 0건·data-game 누락) 이 한 장만 건너뛴다 — 나머지 세 장은 그대로 굽는다.
  const lottery = lotteryPage();
  if (lottery) out.push(["amazon-lottery.html", lottery]);
}
for (const [f, html] of out) fs.writeFileSync(path.join(ROOT, "ko", f), html, "utf8");

{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const NL = sm.includes("\r\n") ? "\r\n" : "\n";
  let added = 0, touched = 0;
  for (const [f] of out) {
    const loc = `${SITE}/ko/${f}`;
    // 이미 등재된 URL 은 lastmod 를 갱신한다(upsert). 매일 다시 굽는 시세 페이지가 8/1 lastmod 를
    // 달고 있으면 크롤러에겐 멈춘 페이지다. 등재 자체를 지우는 일은 하지 않는다 — 추가·갱신만.
    const key = "<loc>" + loc + "</loc>";
    const at = sm.indexOf(key);
    const lmOpen = at < 0 ? -1 : sm.indexOf("<lastmod>", at);
    const lmClose = at < 0 ? -1 : sm.indexOf("</lastmod>", at);
    const urlEnd = at < 0 ? -1 : sm.indexOf("</url>", at);
    if (lmOpen > at && lmClose > lmOpen && lmClose < urlEnd) {
      // 앞으로만 옮긴다(sync-sitemap-lastmod 와 같은 규칙) — 2026-10-13: 데이터 기준일(10-12)이 이미 적힌 10-13 을
      // 덮어써 ko/cards·grading·auction 의 lastmod 가 뒤로 갔다.
      const cur = sm.slice(lmOpen + "<lastmod>".length, lmClose).trim();
      if (!(cur >= DATA_DATE)) { sm = sm.slice(0, lmOpen) + "<lastmod>" + DATA_DATE + sm.slice(lmClose); touched++; }
      continue;
    }
    sm = sm.replace("</urlset>", `  <url>${NL}    <loc>${loc}</loc>${NL}    <lastmod>${DATA_DATE}</lastmod>${NL}    <changefreq>daily</changefreq>${NL}    <priority>0.8</priority>${NL}  </url>${NL}</urlset>`);
    added++;
  }
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: out.map(([f]) => "ko/" + f), sitemapAdded: added, sitemapTouched: touched }));
}
