// 한국어 정적 페이지 생성 — /ko/index.html (원피스 부스터박스 시세 허브).
// 네이버 Yeti·구글이 크롤 가능한 "구운" 한국어 HTML(JS 스왑 아님). 검증된 onepiece-packs.json에서 생성 → 야간 재생성으로 영문판과 동일 데이터 유지.
// Run: node tools/generate-ko-pages.js
const CSS_VER = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";  // 하드코딩 금지 — 범프 때 가드 V1 이 배포를 막는다(2026-07-27)
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = CSS_VER;  // packs.js DATA_VERSION 를 읽는다 — 하드코딩하면 범프 때 가드 V1 이 막는다(2026-07-27)

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
// marketIndex 는 이제 '지수 화면'이 아니라 세트별 시세판(board)·재판기록(reprints) 공급원으로만 쓴다.
// 지수/개봉미터 표시는 2026-07-29 소유자 지시로 전부 삭제됨(값이 실제와 안 맞았음).
const mi = d.marketIndex;
const fx = d.fx || {};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => (n == null ? "—" : Math.round(n).toLocaleString("ko-KR") + "원");
const pct = (n) => (n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%");
const DATA_DATE = d.updated || "";

// 세트번호 자연정렬(OP-01..OP-16, EB-01..EB-03, PRB-01..PRB-02)
function orderKey(code) {
  const m = code.match(/^([A-Z]+)-?(\d+)/);
  const fam = { OP: 0, EB: 1, PRB: 2 }[m ? m[1] : "OP"] ?? 9;
  return fam * 1000 + (m ? parseInt(m[2], 10) : 0);
}
const rows = [...mi.board].sort((a, b) => orderKey(a.code) - orderKey(b.code));

// 박스 시세(원): board.nowUsd(우리 실판매 중앙값)×환율.
// 종전엔 sets.boxSeries KRW 를 우선했는데 그 외부 시세가 07-12 에 멈춘 것을 아무도 몰랐다 — 2026-08-21 제거.
function boxKrw(code, nowUsd) {
  return nowUsd != null && fx.usdKrw ? nowUsd * fx.usdKrw : null;
}
// 산문용 시세 시리즈 — 히어로(boxKrw)와 **같은 소스**를 쓴다. 2026-08-25.
// 종전엔 이 아래 산문만 sets.boxSeries(외부 KRW 시세)를 계속 썼는데 그게 2026-07-12 에 멈춰 있었다.
// 그래서 21개 ko 페이지 전부가 한 페이지 안에서 서로 다른 "현재 시세"를 말했다
// (예: op-01 히어로 422,190원 vs 본문 484,721원). OP-02 는 값을 비워 둔 세트인데 본문만 값을 제시했다.
let SOLD_SERIES = { sets: {} };
try { SOLD_SERIES = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "box-sold-series.json"), "utf8")); } catch (e) {}
// USD 주간 중앙값 → 원화. 환율은 히어로와 같은 fx 를 쓴다.
function soldKrwPts(code) {
  const arr = ((SOLD_SERIES.sets || {})[code] || {}).jp || [];
  if (!fx.usdKrw) return [];
  return arr.filter((p) => p && p.median != null).map((p) => ({ d: p.d, p: Math.round(p.median * fx.usdKrw) }));
}

function nameKo(code) { const s = d.sets[code]; return (s && s.nameKo) || code; }
function reprintRecords(code) { return ((mi.reprints.bySet[code] || {}).reprintRecords) || []; }

/** Return a Korean noun phrase with the correct 은/는 topic particle. */
function topic(value) {
  const text = String(value || "");
  const last = [...text].pop() || "";
  const codePoint = last.charCodeAt(0);
  const hangulBatchim = codePoint >= 0xAC00 && codePoint <= 0xD7A3
    ? (codePoint - 0xAC00) % 28 !== 0
    : false;
  // Korean readings of 0/1/3/6/7/8 end in a consonant (영/일/삼/육/칠/팔).
  const hasBatchim = hangulBatchim || /[013678]$/.test(last);
  return `${text}${hasBatchim ? "은" : "는"}`;
}

// 급등/급락
const movers = [...mi.board].sort((a, b) => b.changePct - a.changePct);
const topUp = movers.slice(0, 3);
const topDn = movers.slice(-3).reverse();

// ── 허브 해설 산문 — 전부 시세판 실측값에서 파생(2026-07-30 애드센스 대응, 허브가 산문 225단어로 얇았음)
const hubProse = (() => {
  const withChg = mi.board.filter((b) => b.changePct != null);
  const nUp = withChg.filter((b) => b.changePct > 0).length;
  const nDn = withChg.filter((b) => b.changePct < 0).length;
  const priced = rows.filter((b) => boxKrw(b.code, b.nowUsd) != null);
  const hi = priced.reduce((m, b) => (boxKrw(b.code, b.nowUsd) > boxKrw(m.code, m.nowUsd) ? b : m));
  const lo = priced.reduce((m, b) => (boxKrw(b.code, b.nowUsd) < boxKrw(m.code, m.nowUsd) ? b : m));
  const rpSets = rows.filter((b) => reprintRecords(b.code).length);
  const u0 = topUp[0], d0 = topDn[0];
  return `
      <section aria-label="시장 읽기">
        <h2>지금 일본판 박스 시장 읽는 법</h2>
        <p class="koProse">추적 중인 ${withChg.length}개 세트 가운데 <strong>${nUp}개가 4주 전 대비 상승</strong>, ${nDn}개가 하락 상태입니다. 가장 비싼 박스는 <strong>${esc(hi.code)} ${esc(nameKo(hi.code))}</strong>(${won(boxKrw(hi.code, hi.nowUsd))}), 가장 싼 박스는 <strong>${esc(lo.code)} ${esc(nameKo(lo.code))}</strong>(${won(boxKrw(lo.code, lo.nowUsd))})로, 같은 게임 안에서도 세트별 격차가 큽니다. 상승 1위는 ${esc(u0.code)}(${pct(u0.changePct)})${d0 && d0.changePct < 0 ? `, 하락 1위는 ${esc(d0.code)}(${pct(d0.changePct)})` : ""}입니다.</p>
        <p class="koProse">박스 시세를 움직이는 힘은 크게 셋입니다. ① <strong>개봉 속도</strong> — 그레이딩 접수량이 그 대리지표이고, 세트별 PSA·CGC·TAG 인구는 각 세트 페이지에 정리돼 있습니다. ② <strong>재판(재입고)</strong> — 현재 ${rpSets.length}개 세트(${rpSets.map((b) => esc(b.code)).join(", ")})에서 유통사 재입고 기록이 확인됐고, 재판은 공급을 다시 늘려 시세를 누르는 요인입니다. ③ <strong>히트카드 시세</strong> — 박스 기대값의 골격이라, 상위 카드가 오르면 박스가 따라 오르는 패턴이 반복됩니다.</p>
        <p class="koProse">이 표의 값은 추정치가 아니라 이베이 <strong>실거래·검증된 매물</strong>을 매일 집계해 원화로 환산한 것입니다. 변동률 기준일이 세트마다 다르므로(행마다 표기) "발매일 대비 수익률"로 읽으면 안 됩니다. 세트 코드를 누르면 그 세트의 시세 흐름·재판 이력·인기 카드·그레이딩 인구까지 한국어로 정리된 상세 페이지로 이동합니다.</p>
      </section>`;
})();

// 시세표 행 — 변동률 기준일(baseDate)은 세트마다 다름(대부분 2026-01-07, OP-16은 발매추적 4-27) → 행마다 명시
const koSlug = (code) => code.toLowerCase();
const tableRows = rows.map((b) => {
  const krw = boxKrw(b.code, b.nowUsd);
  const rr = reprintRecords(b.code);
  // 툴팁에 note 원문(영어 내부 검증 메모)을 넣지 않는다 — 2026-08-26. 시기 + 유형(한국어)만.
  const RP_KIND_KO = { "retailer": "리테일러 재입고", "distributor": "유통사 재입고", "official-lottery": "반다이 공식 추첨판매", "pre-release-lottery": "발매 전 추첨판매" };
  const rpCell = rr.length
    ? `<span class="rpDot" title="${esc(rr.map((r) => r.date + " · " + (RP_KIND_KO[r.kind] || "재입고")).join(" / "))}">재판 ${rr.length}회</span>`
    : `<span class="rpNone">재판 기록 없음</span>`;
  const chgCls = b.changePct >= 0 ? "up" : "down";
  return `<tr>
    <td class="code"><a href="${koSlug(b.code)}.html">${esc(b.code)}</a></td>
    <td class="nm">${esc(nameKo(b.code))}</td>
    <td class="num">${won(krw)}</td>
    <td class="num ${chgCls}">${pct(b.changePct)}<small class="fromDate">${esc(b.baseDate || "")} 대비</small></td>
    <td class="rp">${rpCell}</td>
  </tr>`;
}).join("\n");

// FAQ (한국어) — 스키마 + 본문 동일 소스
const faqs = [
  {
    q: "원피스 부스터박스 시세는 어디 기준인가요?",
    a: `이베이 실거래·매물 데이터를 매일 집계해 원화로 환산한 값입니다(환율 ₩${fx.usdKrw}/$ 기준, ${fx.date} 갱신). 추정가가 아니라 실제 거래·호가 기반이며, 값이 불확실하면 빈칸으로 둡니다.`,
  },
  {
    q: "변동률은 발매일 대비인가요?",
    a: "아니요. 대부분 세트는 2026년 1월부터 추적을 시작해 표의 변동률은 '2026년 1월 대비'입니다(발매일 대비 아님). OP-16만 발매 시점부터 추적했습니다.",
  },
  {
    q: "재판(재발매) 정보는 공식인가요?",
    a: "반다이는 세트별 재판을 공식 발표하지 않습니다. 표의 재판 기록은 유통사·리테일러 재입고 기준으로 확인된 것이며, '재판 기록 없음'은 확인된 기록이 없다는 뜻입니다.",
  },
  {
    q: "일본 아마존에서 응모는 어떻게 하나요?",
    a: "일본 아마존은 인기 박스를 추첨(응모) 방식으로 판매합니다. 한국 배송도 가능(AmazonGlobal, 상품별 상이). 아마존 응모 안내 페이지에서 최신 링크를 확인하세요.",
  },
];
const faqLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
const datasetLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "원피스 부스터박스 시세 (일본판)",
  description: "일본판 원피스 카드게임 부스터박스 전 세트의 원화 시세, 1월 대비 변동률, 재판 기록. 매일 갱신.",
  inLanguage: "ko", isAccessibleForFree: true,
  url: `${SITE}/ko/`, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
});

const faqHtml = faqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");

const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <!-- Korean data pages remain ad-free during AdSense site approval. -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="en" href="${SITE}/" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세·재판 기록 | OP Box Index</title>
    <meta name="description" content="일본판 원피스 카드게임 부스터박스 전 세트 원화 시세를 매일 갱신. OP-01~OP-16, EB, PRB의 박스 가격, 1월 대비 변동률과 재판 기록을 한눈에. 실거래 및 검증된 매물 기반." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:title" content="원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세" />
    <meta property="og:description" content="일본판 원피스 박스 전 세트 원화 시세·재판 기록. 실거래 및 검증된 매물 기반, 매일 갱신." />
    <meta property="og:url" content="${SITE}/ko/" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${faqLd}</script>
    <script type="application/ld+json">${datasetLd}</script>
    <link rel="stylesheet" href="../styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .ixHero { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 6px 0 2px; }
      .ixHero .big { font-size: 46px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
      .ixChg { font-size: 14px; font-weight: 800; padding: 3px 11px; border-radius: 8px; }
      .up { color: #10d7a0; } .down { color: #ff7d7d; }
      .ixChg.up { background: rgba(16,215,160,.12); } .ixChg.down { background: rgba(255,125,125,.12); }
      .koBoard { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 14px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; }
      .koBoard th.l, .koBoard td.nm, .koBoard td.code, .koBoard td.rp { text-align: left; }
      .koBoard td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .koBoard td.num { text-align: right; white-space: nowrap; }
      .koBoard td.code { font-weight: 700; color: #cfd6e4; }
      .koBoard td.nm { color: #9aa4b6; }
      .rpDot { display: inline-block; background: rgba(255,125,60,.15); color: #ff9d6c; border-radius: 6px; padding: 1px 7px; font-weight: 700; font-size: 12px; }
      .rpNone { color: #6a7182; font-size: 12px; }
      .koProse { color: #9aa4b6; font-size: 14px; max-width: 760px; line-height: 1.75; margin: 8px 0; }
      .koProse strong { color: #cfd6e4; }
      .fromDate { display: block; font-size: 10px; color: #7d8698; font-weight: 400; }
      .koBoard td.code a { color: #50dad9; text-decoration: none; font-weight: 700; }
      .owMeter { display: flex; gap: 8px; align-items: flex-end; height: 120px; max-width: 520px; margin: 12px 0; }
      .owBar { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
      .owBar span { width: 100%; background: #ff7d3c; opacity: .6; border-radius: 4px 4px 0 0; min-height: 6px; }
      .owBar:last-child span { opacity: 1; }
      .owBar small { font-size: 10px; color: #7d8698; }
      .koFacts { margin: 14px 0; padding: 12px 16px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 760px; font-size: 14px; line-height: 1.7; }
      .koFacts strong { color: #50dad9; }
      .koNote { color: #7d8698; font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
      .koProse { color: #9aa4b6; font-size: 14px; max-width: 760px; line-height: 1.75; margin: 8px 0; }
      .koProse strong { color: #cfd6e4; }
      main h2 { font-size: 18px; margin: 24px 0 6px; }
      .moverGrid { display: flex; gap: 14px; flex-wrap: wrap; margin: 10px 0; }
      .moverCol { flex: 1; min-width: 200px; }
      .moverCol h3 { font-size: 13px; color: #9aa4b6; margin: 0 0 6px; }
      .moverCol ul { list-style: none; padding: 0; margin: 0; font-size: 13.5px; }
      .moverCol li { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid rgba(255,255,255,.05); }
      .faqItem { max-width: 760px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 4px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14.5px; }
      .faqItem p { color: #9aa4b6; font-size: 13.5px; line-height: 1.65; margin: 4px 0 10px; }
      .koCta { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .koCta a { display: inline-block; padding: 11px 18px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .koCta .primary { background: #50dad9; color: #08131a; }
      .koCta .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      <nav class="nav" aria-label="주요 메뉴"><a href="./">부스터 박스</a><a href="cards.html">카드 시세</a><a href="auction.html">경매</a><a href="../compare.html">세트 비교</a><a href="../psa10-ranking.html">PSA10 랭킹</a><a href="grading.html">PSA 인구</a><a href="../sets/index.html">세트 가이드</a><a href="../amazon-lottery.html">아마존 응모</a></nav>
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow">한국어 · 일본판 시세</p>
      <h1>원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세</h1>
      <p class="koNote">일본판 원피스 카드게임 부스터박스 전 세트의 <strong>실거래·검증된 매물 기반</strong> 원화 시세입니다. 기준과 출처가 확인된 값만 표시하며 매일 갱신합니다. 기준일 ${esc(DATA_DATE)}.</p>

      <section aria-label="전 세트 시세표">
        <h2>전 세트 박스 시세표 (원화)</h2>
        <p class="koNote">변동률은 각 세트의 <strong>추적 시작일 대비</strong>입니다(발매일 대비 아님 — 대부분 2026-01-07부터 추적, 기준일은 행마다 표기). 세트 코드를 누르면 세트별 상세 시세로 갑니다.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">세트</th><th class="l">이름</th><th>박스 시세</th><th>기준일 대비</th><th class="l">재판</th></tr></thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
        </div>
      </section>

${hubProse}

      <section aria-label="급등 급락">
        <h2>급등·급락 TOP 3 (1월 대비)</h2>
        <div class="moverGrid">
          <div class="moverCol"><h3>▲ 급등</h3><ul>${topUp.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="up">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
          <div class="moverCol"><h3>▼ 급락</h3><ul>${topDn.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="down">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
        </div>
      </section>

      <section aria-label="주제별 데이터">
        <h2>주제별 데이터 바로가기</h2>
        <p class="koProse"><a href="cards.html"><strong>원피스 카드 시세</strong></a> — 인기 카드 상위 30장의 NM·PSA 10 실거래가를 원화로. <a href="grading.html"><strong>그레이딩 인구</strong></a> — PSA·CGC·TAG에 세트별로 몇 장이 접수됐고 젬률이 얼마인지. <a href="auction.html"><strong>이베이 경매 낙찰 데이터</strong></a> — 호가가 아닌 실제 낙찰가와 낙찰률. 셋 다 자체 수집 데이터로 매일 갱신됩니다.</p>
      </section>

      <div class="koCta">
        <a class="primary" href="../amazon-lottery.html">아마존 응모 안내 →</a>
        <a class="ghost" href="../psa-grading.html">그레이딩 인구 데이터 →</a>
        <a class="ghost" href="../sets/index.html">세트별 가이드 →</a>
      </div>

      <section aria-label="자주 묻는 질문">
        <h2>자주 묻는 질문</h2>
        ${faqHtml}
      </section>

      <p class="koNote">데이터: 이베이 실거래·매물 집계, PSA 인구 리포트, 반다이 공식 발매 정보. 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}). 마지막 갱신 ${esc(DATA_DATE)}. 시세는 참고용이며 투자·구매 판단의 책임은 본인에게 있습니다.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

fs.mkdirSync(path.join(ROOT, "ko"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "ko", "index.html"), html, "utf8");

// ─────────────────────────────────────────────────────────────
// 세트별 한국어 페이지 /ko/{code}.html — 한국어 롱테일("op-16 시세", "결전의 시간 박스 가격") 공략.
// 값은 전부 검증된 데이터에서만 파생하고, 없으면 표시하지 않음(빈칸 > 틀린값).
const NAV_KO = `<nav class="nav" aria-label="주요 메뉴"><a href="./">부스터 박스</a><a href="cards.html">카드 시세</a><a href="auction.html">경매</a><a href="../compare.html">세트 비교</a><a href="../psa10-ranking.html">PSA10 랭킹</a><a href="grading.html">PSA 인구</a><a href="../sets/index.html">세트 가이드</a><a href="../amazon-lottery.html">아마존 응모</a></nav>`;

function setPageKo(b) {
  const code = b.code;
  const s = d.sets[code] || {};
  const nKo = nameKo(code);
  const slug = koSlug(code);
  const krw = boxKrw(code, b.nowUsd);
  const rr = reprintRecords(code);
  const enHref = fs.existsSync(path.join(ROOT, "sets", `${slug}.html`)) ? `../sets/${slug}.html` : null;
  const canonical = `${SITE}/ko/${slug}.html`;
  const chg = b.changePct;
  const up = chg >= 0;

  // 인기 카드(NM 보유분만, 원화). 값 없으면 섹션 자체를 숨김.
  const topCards = (s.cards || []).filter((c) => c.nmJpy != null && c.number).slice(0, 8);
  const cardRows = topCards.map((c) => `<tr><td class="nm">${esc(c.name)}</td><td class="code">${esc(c.number)}</td><td>${esc(c.rarity || "—")}</td><td class="num">${won(c.nmJpy * fx.jpyKrw)}</td></tr>`).join("\n");
  const cardsSection = topCards.length ? `
      <section aria-label="인기 카드 시세">
        <h2>${esc(code)} 인기 카드 NM 시세 (원화)</h2>
        <p class="koNote">${esc(code)} ${esc(nKo)}의 일본판 NM 카드 ${topCards.length}장을 ${esc(DATA_DATE)} 기준으로 비교합니다.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">카드</th><th class="l">번호</th><th class="l">레어도</th><th>NM 시세</th></tr></thead>
          <tbody>
${cardRows}
          </tbody>
        </table>
        </div>
      </section>` : "";

  // ── 세트별 해설 산문 (2026-07-30 애드센스 "가치 낮은 콘텐츠" 대응)
  //    원칙: 문장은 전부 그 세트의 실측값에서 파생. 값이 없으면 그 문단 자체를 만들지 않는다.
  //    21페이지가 같은 틀이었던 게 반려 사유의 핵심이라, 데이터 조건에 따라 문장이 달라지게 짠다.
  const prose = [];

  // 1) 시세 흐름 — 우리 eBay 실판매 주간 중앙값(원화 환산). 히어로 값과 같은 소스다.
  //    점이 3개 미만이면 문단 자체를 만들지 않는다 — 값을 지어내지 않는다는 원칙은 여기서도 같다.
  const pts = soldKrwPts(code);
  if (pts.length >= 3) {
    const lo = pts.reduce((m, p) => (p.p < m.p ? p : m));
    const hi = pts.reduce((m, p) => (p.p > m.p ? p : m));
    const first = pts[0], last = pts[pts.length - 1];
    const fromLo = lo.p ? ((last.p - lo.p) / lo.p) * 100 : null;
    const offHi = hi.p ? ((last.p - hi.p) / hi.p) * 100 : null;
    let line = `${esc(code)} ${esc(nKo)} 박스는 추적 구간(${esc(first.d)}~${esc(last.d)}) 동안 최저 <strong>${won(lo.p)}</strong>(${esc(lo.d)})에서 최고 <strong>${won(hi.p)}</strong>(${esc(hi.d)}) 사이를 오갔습니다.`;
    if (fromLo != null && offHi != null) {
      line += hi.d === last.d
        ? ` 현재가가 곧 추적 기간 최고가입니다 — 저점 대비 ${pct(fromLo)} 오른 상태로, 최근 매수세가 가격을 끌어올리고 있다는 뜻입니다.`
        : ` 현재 시세 ${won(last.p)}은 저점 대비 ${pct(fromLo)}, 고점 대비 ${pct(offHi)} 수준입니다.`;
    }
    prose.push({ h: "시세 흐름", p: [line, `${esc(code)} ${esc(nKo)}의 일별 차트와 검증된 매물 링크는 <a href="${enHref || "../?set=" + code}">영문 상세 페이지</a>에 함께 표시됩니다.`] });
  }

  // 2) 재판 이력 — 있는 세트와 없는 세트의 문장이 완전히 다르다
  if (rr.length) {
    // note 원문을 그대로 넣지 않는다 — 2026-08-26. note 는 영어로 쓴 **내부 검증 메모**라
    // ("Verified 2026-08-13. Reclassified …") 한국어 문단 한가운데에 영어 문장이 통째로 박혔다.
    // 화면에는 시기 + 유형(한국어)만 싣는다. 원문 메모는 데이터에 그대로 남는다.
    const KIND_KO = {
      "retailer": "리테일러 재입고",
      "distributor": "유통사 재입고",
      "official-lottery": "반다이 공식 추첨판매",
      "pre-release-lottery": "발매 전 추첨판매",
    };
    const reprintLabels = rr
      .map((r) => [r.date, KIND_KO[r.kind] || "재입고"].filter(Boolean).map(esc).join(" · "))
      .filter(Boolean);
    prose.push({ h: "재판(재발매) 이력", p: [
      `${esc(code)} ${esc(topic(nKo))} 유통사·리테일러 재입고 기준으로 <strong>재판이 ${rr.length}회</strong> 확인됐습니다${reprintLabels.length ? `(${reprintLabels.join(" / ")})` : ""}.`,
      `${esc(nKo)} 재판 이력은 반다이의 세트별 공식 발표가 아니라 확인 가능한 유통 기록이며, 재판분과 초판은 카드 자체로 구분되지 않습니다.`,
    ] });
  } else {
    prose.push({ h: "재판(재발매) 이력", p: [
      `${esc(code)} ${esc(topic(nKo))} 지금까지 확인 가능한 유통사·리테일러 재입고 기록이 <strong>없습니다</strong>.`,
      `${esc(nKo)}의 "기록 없음"은 반다이 공식 재판 부재를 단정하는 표현이 아니라, 현재 확보한 유통 기록의 범위를 뜻합니다.`,
    ] });
  }

  // 3) 인기 카드 구성 — top 카드·유형 구성·NM 대비 PSA10
  if (topCards.length >= 3) {
    const t0 = topCards[0];
    const kind = (c) => /manga|망가/i.test(c.name) ? "망가" : /\bsp\b/i.test(c.name) ? "SP" : /wanted|수배/i.test(c.name) ? "수배서" : /parallel|alt/i.test(c.name) ? "패러렐" : "기타";
    const comp = {};
    (s.cards || []).forEach((c) => { comp[kind(c)] = (comp[kind(c)] || 0) + 1; });
    const compTxt = Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}장`).join(", ");
    const p1 = `이 박스의 가치를 끌고 가는 카드는 <strong>${esc(t0.name)}</strong>(${esc(t0.number)})로, 일본판 NM 시세가 약 <strong>${won(t0.nmJpy * fx.jpyKrw)}</strong>입니다. 추적 중인 상위 카드 구성은 ${compTxt} — 어떤 유형이 몇 장인지가 박스 기대값의 골격입니다.`;
    const sold = t0.psa10Ebay && t0.psa10Ebay.soldBased && t0.psa10Ebay.middle != null ? t0.psa10Ebay : null;
    const p2 = sold
      ? `${esc(t0.name)}의 <strong>PSA 10 실거래 중앙값은 ${won(sold.middle)}</strong>(표본 ${sold.sampleSize}건)이며, NM 원본 대비 약 ${(sold.middle / (t0.nmJpy * fx.jpyKrw)).toFixed(1)}배입니다.`
      : `${esc(t0.name)}는 확인 가능한 PSA 10 실거래 표본이 부족해 등급 가격을 추정하지 않고 NM 값만 표시합니다.`;
    prose.push({ h: "인기 카드가 말해주는 것", p: [p1, p2] });
  }

  // 4) 그레이딩 — PSA(판별) + CGC/TAG. 세트마다 숫자가 완전히 다른, 이 사이트 고유 데이터.
  {
    const g = [];
    if (s.psaFull && s.psaFull.total) {
      let line = `${esc(code)} ${esc(topic(nKo))} PSA 일본판 기준 누적 <strong>${s.psaFull.total.toLocaleString("ko-KR")}장</strong>이 접수됐고 그중 ${s.psaFull.gemRate}%가 PSA 10을 받았습니다`;
      line += s.psaFull.wowAdd != null ? ` (최근 한 주에만 +${s.psaFull.wowAdd.toLocaleString("ko-KR")}장).` : ".";
      if (s.psaFullEn && s.psaFullEn.total) {
        line += ` ${esc(nKo)} 영문판은 별도로 ${s.psaFullEn.total.toLocaleString("ko-KR")}장·젬률 ${s.psaFullEn.gemRate}%이며 일본판과 합산하지 않습니다.`;
      }
      g.push(line);
    }
    const cg = set => set && (set.jp || set.en);
    if (cg(s.graders && s.graders.cgc)) {
      const e = s.graders.cgc.jp || s.graders.cgc.en;
      const ed = s.graders.cgc.jp ? "일본판" : "영문판";
      if (e.total) g.push(`${esc(nKo)}의 CGC ${ed} 표본은 ${e.total.toLocaleString("ko-KR")}장으로, 프리스틴 10 ${(e.pristine10 ?? 0).toLocaleString("ko-KR")}장과 젬 민트 10 ${(e.gemMint10 ?? 0).toLocaleString("ko-KR")}장입니다.`);
    }
    if (cg(s.graders && s.graders.tag)) {
      const e = s.graders.tag.jp || s.graders.tag.en;
      const ed = s.graders.tag.jp ? "일본판" : "영문판";
      if (e.total) g.push(`${esc(nKo)}의 TAG ${ed} 표본은 ${e.total.toLocaleString("ko-KR")}장${e.g10 != null ? `이며 10등급 ${e.g10.toLocaleString("ko-KR")}장, 10P ${(e.g10p ?? 0).toLocaleString("ko-KR")}장` : ""}입니다.`);
    }
    if (g.length) {
      g.push(`${esc(nKo)}의 PSA·CGC·TAG 수치는 등급 기준이 서로 달라 합산하지 않고 각 표본을 따로 표시합니다.`);
      prose.push({ h: "그레이딩 인구 (PSA · CGC · TAG)", p: g });
    }
  }

  const proseHtml = prose.map((sec) => `
      <section aria-label="${esc(sec.h)}">
        <h2>${esc(sec.h)}</h2>
        ${sec.p.map((t) => `<p class="koProse">${t}</p>`).join("\n        ")}
      </section>`).join("\n");

  // 팩트 리스트 — 검증된 값만
  const facts = [];
  facts.push(`현재 박스 시세 <strong>${won(krw)}</strong> (기준일 ${esc(DATA_DATE)})`);
  if (chg != null) facts.push(`${esc(b.baseDate || "추적 시작일")} 대비 <strong>${pct(chg)}</strong> — 발매일 대비가 아님`);
  if (b.msrpYen) facts.push(`발매 정가 <strong>¥${b.msrpYen.toLocaleString("ko-KR")}</strong>`);
  const reprintDates = rr.map((r) => r.date).filter(Boolean);
  facts.push(rr.length ? `재판 기록 <strong>${rr.length}회</strong>${reprintDates.length ? ` (${reprintDates.join(", ")})` : ""} — 유통사·리테일러 재입고 기준` : `<strong>재판 기록 없음</strong> — 확인된 재입고 기록이 없다는 뜻`);
  if (s.psaTotal != null) facts.push(`PSA 누적 감정 <strong>${Number(s.psaTotal).toLocaleString("ko-KR")}장</strong>${s.psaGem != null ? ` · PSA10 비율 <strong>${s.psaGem}%</strong>` : ""}`);
  if (s.release) facts.push(`영문(NA)판 발매일 ${esc(s.release)} — 이 페이지 시세는 <strong>일본판</strong> 기준`);

  const setFaqs = [
    { q: `${code} ${nKo} 박스 시세는 지금 얼마인가요?`, a: `${DATA_DATE} 기준 ${code} ${nKo} 일본판 부스터박스 추적가는 약 ${won(krw)}이며, 판매처와 밀봉 상태에 따라 실제 총구매가는 달라질 수 있습니다.` },
    { q: `${code} ${nKo} 재판 기록이 있나요?`, a: rr.length ? `${topic(nKo)} 유통사·리테일러 재입고 기준 ${rr.length}회가 확인됐습니다${reprintDates.length ? `(${reprintDates.join(", ")})` : ""}; 반다이 공식 발표가 아닌 유통 기록입니다.` : `${topic(nKo)} 현재 확인된 유통 재입고 기록이 없지만, 이것만으로 공식 재판 부재를 단정하지 않습니다.` },
    { q: `${code} ${nKo} 변동률은 어느 시점부터인가요?`, a: b.launchTracked ? `${topic(nKo)} 발매 시점(${esc(b.baseDate || "")})부터 추적해 발매 초기 대비 변동률을 표시합니다.` : `${topic(nKo)} ${esc(b.baseDate || "2026-01-07")}부터 추적해 해당 기준일 대비 변동률을 표시합니다.` },
  ];
  const setFaqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: setFaqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: `${code} ${nKo}`, item: canonical },
  ] });

  const title = `${code} ${nKo} 박스 시세 (일본판) | OP Box Index`;
  const desc = `${code} ${nKo} 일본판 부스터박스 시세 ${won(krw)} (${DATA_DATE} 기준). 재판 기록과 인기 카드 NM 시세까지 매일 갱신. 실거래 및 검증된 매물 기반.`;

  return { slug, html: `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <!-- No AdSense on noindex Korean set detail pages. -->
    <!-- Korean set details remain noindex and ad-free through the AdSense review window.
         Reconsider indexing separately after the review; the Korean hub remains indexed. -->
    <meta name="robots" content="noindex,follow" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="ko" href="${canonical}" />
    ${enHref ? `<link rel="alternate" hreflang="en" href="${SITE}/sets/${slug}.html" />` : ""}
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
    <script type="application/ld+json">${setFaqLd}</script>
    <script type="application/ld+json">${crumbLd}</script>
    <link rel="stylesheet" href="../styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .ixHero { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 6px 0 2px; }
      .ixHero .big { font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
      .ixChg { font-size: 14px; font-weight: 800; padding: 3px 11px; border-radius: 8px; }
      .up { color: #10d7a0; } .down { color: #ff7d7d; }
      .ixChg.up { background: rgba(16,215,160,.12); } .ixChg.down { background: rgba(255,125,125,.12); }
      .koBoard { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 14px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; }
      .koBoard th.l, .koBoard td.nm, .koBoard td.code { text-align: left; }
      .koBoard td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .koBoard td.num { text-align: right; white-space: nowrap; }
      .koBoard td.code { color: #9aa4b6; font-size: 12.5px; }
      .koFacts { margin: 14px 0; padding: 12px 16px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 760px; font-size: 14px; line-height: 1.8; }
      .koFacts strong { color: #50dad9; }
      .koNote { color: #7d8698; font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
      .faqItem { max-width: 760px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 4px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14.5px; }
      .faqItem p { color: #9aa4b6; font-size: 13.5px; line-height: 1.65; margin: 4px 0 10px; }
      .koCta { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .koCta a { display: inline-block; padding: 11px 18px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .koCta .primary { background: #50dad9; color: #08131a; }
      .koCta .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${NAV_KO}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:#7d8698;text-decoration:none">한국어 시세</a> · 일본판</p>
      <h1>${esc(code)} ${esc(nKo)} 부스터박스 시세 (일본판)</h1>
      <div class="ixHero">
        <span class="big">${won(krw)}</span>
        ${chg != null ? `<span class="ixChg ${up ? "up" : "down"}">${pct(chg)}</span>` : ""}
      </div>
      <ul class="koFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
${proseHtml}
${cardsSection}
      <div class="koCta">
        <a class="primary" href="./">전 세트 시세표 →</a>
        ${enHref ? `<a class="ghost" href="${enHref}">영문 상세(차트·PSA) →</a>` : ""}
        <a class="ghost" href="../amazon-lottery.html">아마존 응모 안내 →</a>
      </div>
      <section aria-label="자주 묻는 질문">
        <h2>${esc(code)} 자주 묻는 질문</h2>
        ${setFaqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}
      </section>
      <p class="koNote">${esc(code)} ${esc(nKo)} 데이터 기준: 검증된 이베이 시장 관측, PSA 인구 리포트, 반다이 발매 정보 · 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}) · 갱신 ${esc(DATA_DATE)}.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../methodology.html">Methodology</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
` };
}

const written = [];
for (const b of rows) {
  const { slug, html: page } = setPageKo(b);
  fs.writeFileSync(path.join(ROOT, "ko", `${slug}.html`), page, "utf8");
  written.push(`ko/${slug}.html`);
}

// 사이트맵: 한국어 세트 상세는 noindex(2026-07-24 임시) → 사이트맵에서 제거하고 허브(/ko/)만 유지.
//      noindex 페이지를 사이트맵에 두면 GSC 가 "제출됨+색인안됨" 모순으로 계속 표시한다.
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  let removed = 0;
  const dropLocs = new Set(written.map((rel) => `<loc>${SITE}/${rel}</loc>`));
  sm = sm.replace(/[ \t]*<url>[\s\S]*?<\/url>\r?\n?/g, (block) => {
    for (const loc of dropLocs) if (block.includes(loc)) { removed++; return ""; }
    return block;
  });
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: "ko/index.html", setPages: written.length, sitemapRemoved: removed }));
}
