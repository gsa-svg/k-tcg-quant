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
const auc = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-sold.json"), "utf8"));
const cardStats = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "auction-card-stats.json"), "utf8"));
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
const thumbHtml = (c) => {
  const src = thumbRel(c);
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

// ── 카드명 한글 병기 — 캐릭터명만 매핑한다(Parallel·Manga 같은 변형 접미사는 영문 원문 그대로).
//    확신이 없는 이름은 넣지 않는다: 빈 값이 틀린 값보다 낫다.
const KO_CHAR = {
  "Monkey D. Luffy": "몽키 D. 루피", "Roronoa Zoro": "롤로노아 조로", "Nami": "나미", "Sanji": "상디",
  "Shanks": "샹크스", "Portgas D. Ace": "포트거스 D. 에이스", "Sabo": "사보", "Boa Hancock": "보아 행콕",
  "Trafalgar Law": "트라팔가 로", "Nico Robin": "니코 로빈", "Tony Tony.Chopper": "토니토니 쵸파",
  "Yamato": "야마토", "Uta": "우타", "Gol D. Roger": "골 D. 로저", "Marshall D. Teach": "마샬 D. 티치",
  "Charlotte Katakuri": "샬롯 카타쿠리", "Dracule Mihawk": "쥬라큘 미호크", "Silvers Rayleigh": "실버즈 레일리",
  "Jewelry Bonney": "쥬얼리 보니", "Buggy": "버기", "Brook": "브룩", "Kuzan": "쿠잔", "Sakazuki": "사카즈키",
  "Borsalino": "볼사리노", "Perona": "페로나", "Tashigi": "타시기", "Rebecca": "레베카", "Enel": "에넬",
  "Smoker": "스모커", "Koala": "코알라", "Laboon": "라분", "Hannyabal": "한냐발", "Shirahoshi": "시라호시",
  "Charlotte Pudding": "샬롯 푸딩", "Sogeking": "저격왕", "Vinsmoke Reiju": "빈스모크 레이쥬",
  "Gecko Moria": "겟코 모리아", "Stussy": "스투시", "Edward.Newgate": "에드워드 뉴게이트",
  "Monkey D. Garp": "몽키 D. 가프", "Koby": "코비", "Zoro-Juurou": "조로주로", "Luffy-Tarou": "루피타로",
  "O-Nami": "오나미", "Kaido": "카이도", 'Eustass"Captain"Kid': "유스타스 캡틴 키드", "Vegapunk": "베가펑크",
};
// 표기 흔들림(공백·점·따옴표)을 없애고 앞부분 일치로 찾는다. 긴 키부터 봐야 "Monkey D. Garp"가 "Monkey D."에 먹히지 않는다.
const flat = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const KO_CHAR_KEYS = Object.entries(KO_CHAR).map(([k, v]) => [flat(k), v]).sort((a, b) => b[0].length - a[0].length);
const koCharOf = (name) => { const n = flat(name); const hit = KO_CHAR_KEYS.find(([k]) => n.startsWith(k)); return hit ? hit[1] : null; };

// 공용 페이지 틀 — ko 세트 페이지와 같은 look(스타일 재사용)
function page({ file, title, desc, h1, eyebrow, body, faqs, breadcrumbName, enHref, note }) {
  const canonical = `${SITE}/ko/${file}`;
  const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: breadcrumbName, item: canonical },
  ] });  return `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
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
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .koBoard { width: 100%; max-width: 860px; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 9px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; white-space: nowrap; }
      .koBoard th.l, .koBoard td.l { text-align: left; }
      .koBoard td { padding: 8px 9px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; text-align: right; white-space: nowrap; }
      .koBoard td.l { color: #cfd6e4; }
      .koBoard td.l small { color: #7d8698; display: block; font-size: 11px; }
      .koProse { color: #9aa4b6; font-size: 14px; max-width: 760px; line-height: 1.78; margin: 8px 0; }
      .koProse strong { color: #cfd6e4; }
      main h2 { font-size: 18.5px; margin: 26px 0 6px; }
      .koNote { color: #7d8698; font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
      .faqItem { max-width: 760px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 4px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14.5px; }
      .faqItem p { color: #9aa4b6; font-size: 13.5px; line-height: 1.65; margin: 4px 0 10px; }
      .koCta { display: flex; gap: 10px; flex-wrap: wrap; margin: 18px 0; }
      .koCta a { display: inline-block; padding: 11px 18px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .koCta .primary { background: #50dad9; color: #08131a; }
      .koCta .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
      .up { color: #10d7a0; } .down { color: #ff7d7d; }
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
        .koBoard th { font-size: 10.5px; white-space: normal; overflow-wrap: anywhere; }
        .koBoard .hideM { display: none; }
        .koBoard td.l { white-space: normal; overflow-wrap: anywhere; }
        .koBoard td.l small { font-size: 10.5px; }
        .koBoard img.cardThumb { width: 30px; height: 42px; }
        .koBoard td.l .cardCell { gap: 7px; min-width: 0; }
      }
      .koBoard th.w, .koBoard td.w { white-space: normal; }
      .koBoard td.l a { color: #50dad9; }
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
      <p class="eyebrow"><a href="./" style="color:#7d8698;text-decoration:none">한국어 시세</a> · ${esc(eyebrow)}</p>
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

  const body = `
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드 (번호 · 세트)</th><th class="hideM">일판 NM 시세</th><th>PSA 10 실낙찰</th><th>배수</th></tr></thead>
        <tbody>
${tr}
        </tbody>
      </table>
      </div>
      <p class="koNote">일판 NM = 일본 리테일 무등급 재고가. PSA 10 실낙찰 = 이베이 낙찰 중앙값. "집계중"은 검증된 낙찰 표본(3건 이상)이 아직 없다는 뜻이며 추정치로 채우지 않습니다. 정발(한글판)은 집계하지 않습니다.</p>${soldBlock}
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
    desc: `원피스카드 일판 낱장 시세 — 인기 ${top.length}장의 NM·PSA 10 실낙찰가를 원화로. 정발(한글판) 제외.`,
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
function auctionPage() {
  const daily = (auc.daily || []).slice(-10);
  const totN = daily.reduce((t, x) => t + x.n, 0);
  const totSold = daily.reduce((t, x) => t + x.sold, 0);
  const box = daily.map((x) => x.byKind && x.byKind.box).filter(Boolean);
  const boxN = box.reduce((t, b) => t + b.n, 0), boxSold = box.reduce((t, b) => t + b.sold, 0);
  const last = daily[daily.length - 1];

  // 카드별 낙찰 top — 표본 3건 이상만(집계 파일 자체가 그 기준), 이름은 우리 카드목록에서 찾되 없으면 번호만
  const nameOf = (set, id) => {
    const cs = (d.sets[set] || {}).cards || [];
    const hit = cs.find((c) => String(c.number || "").toUpperCase() === id.toUpperCase());
    return hit ? hit.name : null;
  };
  const topCards = Object.entries(cardStats.cards || {})
    .map(([id, c]) => ({ id, ...c, name: nameOf(c.set, id) }))
    .sort((a, b) => b.medPrice - a.medPrice).slice(0, 12);

  const dTr = daily.map((x) => `<tr><td class="l">${esc(x.d)}</td><td>${num(x.n)}</td><td>${num(x.sold)}</td><td>${x.sellThrough != null ? x.sellThrough + "%" : "—"}</td><td>${x.medPrice != null ? won(x.medPrice * fx.usdKrw) : "—"}</td></tr>`).join("\n");
  const cTr = topCards.map((c, i) => `<tr><td>${i + 1}</td><td class="l">${esc(c.name || c.id)}<small>${esc(c.id)} · ${esc(c.set)}</small></td><td>${won(c.medPrice * fx.usdKrw)}</td><td>${c.sellThrough != null ? c.sellThrough + "%" : "—"}</td><td>${num(c.sold)}</td></tr>`).join("\n");

  const body = `
      <h2>일별 낙찰 현황</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th class="l">날짜</th><th>종료 경매</th><th>낙찰</th><th>낙찰률</th><th>낙찰가 중앙값</th></tr></thead>
        <tbody>
${dTr}
        </tbody>
      </table>
      </div>
      <p class="koNote">우리가 추적한 경매 기준(전체 시장 전수가 아닌 표본). 낙찰률 분모는 팔림/유찰이 확정된 건만 씁니다.</p>
      <h2>카드별 경매 낙찰가 상위</h2>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드</th><th>낙찰 중앙값</th><th>낙찰률</th><th>낙찰 수</th></tr></thead>
        <tbody>
${cTr}
        </tbody>
      </table>
      </div>
      <h2>경매 데이터 읽는 법</h2>
      <div class="koCta">
        <a class="primary" href="cards.html">카드 시세 →</a>
        <a class="ghost" href="grading.html">그레이딩 인구 →</a>
        <a class="ghost" href="../free-data.html">경매 일별 CSV 무료 다운로드 →</a>
      </div>`;

  return page({
    file: "auction.html",
    enHref: "auction.html",
    title: "원피스 이베이 경매 낙찰가·낙찰률 | opboxindex",
    desc: `원피스 이베이 경매 실제 낙찰가와 낙찰률. 최근 ${daily.length}일 ${num(totN)}건, 호가 아닌 낙찰 기준 (${DATA_DATE}).`,
    h1: "원피스 카드 이베이 경매 — 실제 낙찰 데이터",
    eyebrow: "이베이 경매",
    breadcrumbName: "원피스 이베이 경매 데이터",
    body,
    faqs: [
      { q: "이 낙찰가는 어떻게 수집한 건가요?", a: "끝난 경매를 종료 후 다시 조회해 최종 낙찰가와 낙찰 여부를 기록합니다. 진행 중 현재가는 스나이핑 때문에 최종가와 다르므로 쓰지 않고, 유찰된 경매도 낙찰률 분모로 함께 셉니다." },
      { q: "원피스 카드 경매 낙찰률은 얼마나 되나요?", a: `최근 ${daily.length}일 기준 우리가 추적한 경매 ${num(totN)}건 중 ${num(totSold)}건이 낙찰돼 약 ${totN ? Math.round((totSold / totN) * 100) : 0}%였습니다. 싱글 카드는 유찰이 흔하고, 밀봉 박스는 표본은 적지만 낙찰률이 훨씬 높습니다.` },
      { q: "경매 낙찰가와 일반 시세는 뭐가 다른가요?", a: "낙찰가는 실제 구매자가 지불한 가격이라 즉시구매 호가보다 낮게 형성되는 경우가 많습니다. 시장의 바닥 가격을 읽는 지표로 쓰되, 배송비·관세는 별도입니다." },
      { q: "이 데이터를 받아볼 수 있나요?", a: "일별 집계(종료 수·낙찰 수·낙찰률·중앙값)를 무료 CSV로 공개하고 있습니다. free-data 페이지에서 내려받을 수 있으며 출처 표기 조건(CC BY 4.0)만 지키면 됩니다." },
    ],
  });
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
  ["auction.html", auctionPage()],
];
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
      sm = sm.slice(0, lmOpen) + "<lastmod>" + DATA_DATE + sm.slice(lmClose);
      touched++; continue;
    }
    sm = sm.replace("</urlset>", `  <url>${NL}    <loc>${loc}</loc>${NL}    <lastmod>${DATA_DATE}</lastmod>${NL}    <changefreq>daily</changefreq>${NL}    <priority>0.8</priority>${NL}  </url>${NL}</urlset>`);
    added++;
  }
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: out.map(([f]) => "ko/" + f), sitemapAdded: added, sitemapTouched: touched }));
}
