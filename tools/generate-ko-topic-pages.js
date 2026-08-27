// 한국어 주제 페이지 3장 — 소유자 지시(2026-08-01): "원피스 카드시세 / 원피스 이베이 경매 /
// 원피스 그레이딩 같은 검색에 잡히게 하는 것이 너의 역할" — 그 검색어를 정조준하는 전용 페이지.
//   ko/cards.html   원피스 카드 시세 (NM·PSA10, 일본판)
//   ko/grading.html 원피스 그레이딩 인구 (PSA·CGC·TAG, 세트×판별)
//   ko/auction.html 원피스 이베이 경매 낙찰 데이터 (우리 자체 수집 — 한국어권에 없는 데이터)
// 원칙: 값은 전부 검증된 데이터 파일에서 파생, 없으면 그 문장/행을 만들지 않는다. 외부 업체명 표기 금지.
// index,follow + 사이트맵 등록(허브 ko/ 는 이미 색인됨 → 내부링크로 연결).
// Run: node tools/generate-ko-topic-pages.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
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

// 공용 페이지 틀 — ko 세트 페이지와 같은 look(스타일 재사용)
function page({ file, title, desc, h1, eyebrow, body, faqs, breadcrumbName, enHref }) {
  const canonical = `${SITE}/ko/${file}`;
  const faqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: breadcrumbName, item: canonical },
  ] });
  const faqHtml = faqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n        ");
  return `<!doctype html>
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
    <script type="application/ld+json">${faqLd}</script>
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
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      <nav class="nav" aria-label="주요 메뉴"><a href="./">부스터 박스</a><a href="cards.html">카드 시세</a><a href="auction.html">경매</a><a href="../compare.html">세트 비교</a><a href="../psa10-ranking.html">PSA10 랭킹</a><a href="grading.html">PSA 인구</a><a href="../sets/index.html">세트 가이드</a><a href="../amazon-lottery.html">아마존 응모</a></nav>
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:#7d8698;text-decoration:none">한국어 시세</a> · ${esc(eyebrow)}</p>
      <h1>${esc(h1)}</h1>
${body}
      <section aria-label="자주 묻는 질문">
        <h2>자주 묻는 질문</h2>
        ${faqHtml}
      </section>
      <p class="koNote">데이터: 이베이 실거래·검증된 매물 집계, 공개 그레이딩 인구 리포트. 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}). 마지막 갱신 ${esc(DATA_DATE)}. 시세는 참고용이며 투자·구매 판단의 책임은 본인에게 있습니다.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
}

// ── ① ko/cards.html — 원피스 카드 시세 ─────────────────────────────────────
function cardsPage() {
  const rows = [];
  for (const code of codes) {
    for (const c of d.sets[code].cards || []) {
      if (c.nmJpy == null || !c.number) continue;
      const nmKrw = c.nmJpy * fx.jpyKrw;
      const p10 = c.psa10Ebay && c.psa10Ebay.soldBased && c.psa10Ebay.middle != null ? c.psa10Ebay : null;
      rows.push({ code, name: c.name, number: String(c.number), nmKrw, p10Krw: p10 ? p10.middle : null, n: p10 ? p10.sampleSize : null });
    }
  }
  rows.sort((a, b) => b.nmKrw - a.nmKrw);
  const top = rows.slice(0, 30);
  const t0 = top[0];
  const withP10 = top.filter((r) => r.p10Krw != null);
  const maxMul = withP10.length ? withP10.reduce((m, r) => (r.p10Krw / r.nmKrw > m.p10Krw / m.nmKrw ? r : m)) : null;

  const tr = top.map((r, i) => `<tr><td>${i + 1}</td><td class="l">${esc(r.name)}<small>${esc(r.number)} · ${esc(r.code)} ${esc(nameKo(r.code))}</small></td><td>${won(r.nmKrw)}</td><td>${r.p10Krw != null ? won(r.p10Krw) : '<span style="color:#6a7182;font-size:12px">집계중</span>'}</td><td>${r.p10Krw != null ? "×" + (r.p10Krw / r.nmKrw).toFixed(1) : "—"}</td></tr>`).join("\n");

  const body = `
      <p class="koProse">일본판 원피스 카드게임에서 시세가 높은 카드 <strong>상위 ${top.length}장</strong>의 원화 시세표입니다. NM(민트급) 원본 시세는 일본 리테일 재고가를, PSA 10 시세는 이베이 <strong>실제 낙찰(sold)</strong> 중앙값을 원화로 환산한 값입니다 — 호가가 아니라 실제로 팔린 가격입니다. 현재 1위는 <strong>${esc(t0.name)}</strong>(${esc(t0.number)}, ${esc(t0.code)})로 NM 기준 약 <strong>${won(t0.nmKrw)}</strong>입니다.</p>
      <div style="overflow-x:auto">
      <table class="koBoard">
        <thead><tr><th>#</th><th class="l">카드 (번호 · 세트)</th><th>NM 시세</th><th>PSA 10 실거래</th><th>배수</th></tr></thead>
        <tbody>
${tr}
        </tbody>
      </table>
      </div>
      <p class="koNote">PSA 10 "집계중"은 검증된 낙찰 표본(3건 이상)이 아직 없다는 뜻입니다. 추정치로 채우지 않습니다.</p>
      <h2>카드 시세 읽는 법</h2>
      <p class="koProse">같은 카드 번호라도 <strong>변형(패러렐·망가 아트·SP·수배서)</strong>이 다르면 가격이 몇 배에서 몇십 배까지 달라집니다. 이 표의 각 행은 특정 변형 하나에 고정돼 있고, 공식 카드리스트와 대조해 이미지·변형을 검증한 값만 싣습니다. 매물을 비교할 때는 반드시 일러스트와 번호를 함께 확인하세요.</p>
      <p class="koProse">PSA 10 배수(PSA10 ÷ NM)는 그레이딩 프리미엄입니다.${maxMul ? ` 현재 상위권에서 배수가 가장 큰 카드는 <strong>${esc(maxMul.name)}</strong>(${esc(maxMul.code)})로 약 <strong>×${(maxMul.p10Krw / maxMul.nmKrw).toFixed(1)}</strong>입니다.` : ""} 배수가 크다는 건 젬(만점) 개체가 귀하다는 뜻이고, 배수가 1~2배 수준이면 굳이 그레이딩 비용을 들일 실익이 적다는 신호입니다. 세트별 젬률은 <a href="grading.html">그레이딩 인구 페이지</a>에서 확인할 수 있습니다.</p>
      <div class="koCta">
        <a class="primary" href="./">전 세트 박스 시세표 →</a>
        <a class="ghost" href="grading.html">그레이딩 인구 →</a>
        <a class="ghost" href="auction.html">이베이 경매 낙찰 데이터 →</a>
      </div>`;

  return page({
    file: "cards.html",
    enHref: "cards/index.html",
    title: "원피스 카드 시세 — NM·PSA10 실거래 상위 30 (일본판) | OP Box Index",
    desc: `원피스 카드 시세를 원화로 정리. 일본판 인기 카드 상위 ${top.length}장의 NM 시세와 PSA 10 실제 낙찰가, 그레이딩 프리미엄 배수까지. 실거래 기반, 매일 갱신 (${DATA_DATE}).`,
    h1: "원피스 카드 시세 — NM·PSA 10 실거래 (일본판)",
    eyebrow: "카드 시세",
    breadcrumbName: "원피스 카드 시세",
    body,
    faqs: [
      { q: "원피스 카드 시세는 어디서 확인하나요?", a: `이 페이지에서 일본판 상위 카드의 NM 시세와 PSA 10 실거래가를 원화로 매일 갱신합니다. NM은 일본 리테일 재고가, PSA 10은 이베이 실제 낙찰 중앙값 기준입니다 (${DATA_DATE} 기준).` },
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
      <p class="koProse">원피스 카드가 등급사(PSA·CGC·TAG)에 얼마나 접수됐는지를 <strong>세트별·판별(일본판/영문판)</strong>로 정리한 표입니다. 그레이딩 접수량은 "박스가 얼마나 개봉되고 있나"를 보여주는 가장 확실한 대리지표입니다 — 등급 카드는 전부 개봉된 팩에서 나오기 때문입니다. 현재 PSA 누적은 일본판 <strong>${num(tj)}장</strong>, 영문판 <strong>${num(te)}장</strong>입니다(두 판은 인쇄가 달라 절대 합산하지 않습니다).</p>
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
      <p class="koProse">가장 많이 감정된 세트는 <strong>${esc(big.code)} ${esc(big.nk)}</strong>${big.jp ? `(일본판 ${num(big.jp.t)}장)` : ""}입니다. 젬률(PSA 10 비율)은 세트마다 달라서, 일본판 기준 <strong>${esc(hi.code)} ${hi.jp.gem}%</strong>부터 <strong>${esc(lo.code)} ${lo.jp.gem}%</strong>까지 벌어져 있습니다. 젬률이 낮은 세트일수록 만점 개체가 귀해 PSA 10 프리미엄이 크게 형성됩니다.</p>
      <p class="koProse">등급사마다 만점 체계가 다릅니다. <strong>PSA</strong>는 10이 최고 등급이고, <strong>CGC</strong>는 만점을 프리스틴 10과 젬 민트 10으로 나누며(프리스틴이 더 엄격), <strong>TAG</strong>는 10 위에 10P를 둡니다. 기준이 서로 호환되지 않으므로 등급사 간 수량을 합쳐 읽으면 안 됩니다. 세트별 CGC 프리스틴/젬민트, TAG 10/10P 세부 분포는 각 <a href="./">세트 페이지</a>에 있습니다.</p>
      <p class="koProse">특이한 점 하나 — 추적 세트 합계로 보면 <strong>영문판 PSA 인구(${num(te)}장)가 일본판(${num(tj)}장)보다 많고</strong>, 그 격차가 우리가 기록한 매주 더 벌어지고 있습니다. "일본판이 본판"이라는 통념과 달리, 그레이딩 시장 규모는 이미 영문판이 더 큽니다.</p>
      <div class="koCta">
        <a class="primary" href="cards.html">카드 시세 →</a>
        <a class="ghost" href="../psa-grading.html">영문 상세(주간 증감) →</a>
        <a class="ghost" href="auction.html">이베이 경매 데이터 →</a>
      </div>`;

  return page({
    file: "grading.html",
    enHref: "psa-grading.html",
    title: "원피스 카드 그레이딩 인구 — PSA·CGC·TAG 세트별 현황 | OP Box Index",
    desc: `원피스 그레이딩 현황을 세트별·판별로 정리. PSA 일본판 ${num(tj)}장·영문판 ${num(te)}장, 세트별 젬률과 CGC·TAG 누적까지. 공개 인구 리포트 기반 매주 갱신 (${DATA_DATE}).`,
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
      <p class="koProse">이베이에서 끝난 원피스 카드 경매를 <strong>종료 후 다시 조회해 실제 낙찰가</strong>를 기록한 데이터입니다. 진행 중 호가나 "현재 입찰가"가 아니라, 경매가 끝난 뒤의 최종 낙찰가·유찰 여부만 셉니다 — 스나이핑 때문에 종료 직전 가격과 최종가는 자주 크게 다릅니다. 최근 ${daily.length}일간 우리가 추적한 경매는 <strong>${num(totN)}건</strong>, 그중 실제로 낙찰된 건 <strong>${num(totSold)}건(${totN ? Math.round((totSold / totN) * 100) : 0}%)</strong>입니다.</p>
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
      <p class="koProse">핵심은 <strong>낙찰률</strong>입니다. 싱글 카드는 경매에 쏟아지지만 상당수가 유찰됩니다${totN ? ` — 최근 ${daily.length}일 낙찰률이 ${Math.round((totSold / totN) * 100)}% 수준` : ""}. 반면 밀봉 부스터박스는 표본은 적어도 거의 팔립니다${boxN ? ` (같은 기간 박스 경매 ${num(boxN)}건 중 ${num(boxSold)}건 낙찰)` : ""}. "매물이 많다"와 "팔린다"는 전혀 다른 신호라서, 우리는 유찰까지 분모에 넣어 셉니다.</p>
      <p class="koProse">경매 낙찰가는 즉시구매(BIN) 시세보다 낮게 형성되는 경우가 많아 <strong>시장의 바닥 가격</strong>을 읽는 데 유용합니다. 다만 배송비·관세가 별도이고, 등급 카드는 라벨 변형까지 확인해야 하므로 표의 값은 참고 기준으로 쓰세요.${last ? ` 최근 집계일(${esc(last.d)}) 기준 종료 ${num(last.n)}건, 낙찰 ${num(last.sold)}건이었습니다.` : ""}</p>
      <div class="koCta">
        <a class="primary" href="cards.html">카드 시세 →</a>
        <a class="ghost" href="grading.html">그레이딩 인구 →</a>
        <a class="ghost" href="../free-data.html">경매 일별 CSV 무료 다운로드 →</a>
      </div>`;

  return page({
    file: "auction.html",
    enHref: "auction.html",
    title: "원피스 카드 이베이 경매 데이터 — 실제 낙찰가·낙찰률 | OP Box Index",
    desc: `원피스 이베이 경매를 종료 후 재조회해 실제 낙찰가를 기록. 최근 ${daily.length}일 ${num(totN)}건 추적, 낙찰률 ${totN ? Math.round((totSold / totN) * 100) : 0}%, 카드별 낙찰 중앙값까지. 호가가 아닌 낙찰가 기준 (${DATA_DATE}).`,
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

// ── 쓰기 + 사이트맵 ─────────────────────────────────────────────────────────
const out = [
  ["cards.html", cardsPage()],
  ["grading.html", gradingPage()],
  ["auction.html", auctionPage()],
];
for (const [f, html] of out) fs.writeFileSync(path.join(ROOT, "ko", f), html, "utf8");

{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  let added = 0;
  for (const [f] of out) {
    const loc = `${SITE}/ko/${f}`;
    if (sm.includes(`<loc>${loc}</loc>`)) continue;
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    added++;
  }
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: out.map(([f]) => "ko/" + f), sitemapAdded: added }));
}
