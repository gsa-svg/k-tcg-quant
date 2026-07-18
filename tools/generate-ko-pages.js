// 한국어 정적 페이지 생성 — /ko/index.html (원피스 부스터박스 시세 허브).
// 네이버 Yeti·구글이 크롤 가능한 "구운" 한국어 HTML(JS 스왑 아님). 검증된 onepiece-packs.json에서 생성 → 야간 재생성으로 영문판과 동일 데이터 유지.
// Run: node tools/generate-ko-pages.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = "20260719a"; // packs.js DATA_VERSION 와 동시 범프(가드 V1)

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const mi = d.marketIndex;
const idx = mi.index;
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

// 박스 시세(원): sets.boxSeries 최신 KRW 우선, 없으면 board.nowUsd×환율
function boxKrw(code, nowUsd) {
  const s = d.sets[code];
  const pts = s && s.boxSeries && s.boxSeries.points;
  if (pts && pts.length) return pts[pts.length - 1].p;
  return nowUsd != null && fx.usdKrw ? nowUsd * fx.usdKrw : null;
}
function nameKo(code) { const s = d.sets[code]; return (s && s.nameKo) || code; }
function reprintRecords(code) { return ((mi.reprints.bySet[code] || {}).reprintRecords) || []; }

// 급등/급락
const movers = [...mi.board].sort((a, b) => b.changePct - a.changePct);
const topUp = movers.slice(0, 3);
const topDn = movers.slice(-3).reverse();

// 개봉 미터 막대
const weeks = (mi.meter.weeks || []).slice(-6);
const maxW = Math.max(...weeks.map((w) => w.v), 1);
const meterBars = weeks.map((w, i) => {
  const h = Math.max(6, Math.round((w.v / maxW) * 100));
  return `<div class="owBar"><span style="height:${h}%"></span><small>${w.d.slice(5)}</small></div>`;
}).join("");

// 시세표 행
const tableRows = rows.map((b) => {
  const krw = boxKrw(b.code, b.nowUsd);
  const rr = reprintRecords(b.code);
  const rpCell = rr.length
    ? `<span class="rpDot" title="${esc(rr.map((r) => r.date + (r.note ? " " + r.note : "")).join(" / "))}">재판 ${rr.length}회</span>`
    : `<span class="rpNone">재판 기록 없음</span>`;
  const chgCls = b.changePct >= 0 ? "up" : "down";
  return `<tr>
    <td class="code">${esc(b.code)}</td>
    <td class="nm">${esc(nameKo(b.code))}</td>
    <td class="num">${won(krw)}</td>
    <td class="num ${chgCls}">${pct(b.changePct)}</td>
    <td class="num">${b.vsMsrp ? "×" + b.vsMsrp : "—"}</td>
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
    q: "OPBOX 지수가 뭔가요?",
    a: `일본판 원피스 부스터박스 ${mi.constituents.length}종의 시세를 동일가중으로 묶어 하나의 숫자로 만든 시장지수입니다. 2026년 1월 7일 = 100 기준이며, 현재 ${idx.value.toFixed(1)}로 1월 대비 ${pct(idx.sinceBasePct)}입니다.`,
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
    q: "정가 대비 배수는 어떻게 계산하나요?",
    a: "현재 박스 시세 ÷ 발매 당시 정가(일본 MSRP)입니다. 예를 들어 ×5면 정가의 5배 가격에 거래된다는 의미입니다.",
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
  description: "일본판 원피스 카드게임 부스터박스 전 세트의 원화 시세, 1월 대비 변동률, 정가 대비 배수, 재판 기록. 매일 갱신.",
  inLanguage: "ko", isAccessibleForFree: true,
  url: `${SITE}/ko/`, dateModified: DATA_DATE,
  creator: { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` },
});

const faqHtml = faqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n");

const chgCls = idx.sinceBasePct >= 0 ? "up" : "down";
const wkCls = idx.weekChangePct >= 0 ? "up" : "down";

const html = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="en" href="${SITE}/market.html" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세·재판·개봉 지수 | OP Box Index</title>
    <meta name="description" content="일본판 원피스 카드게임 부스터박스 전 세트 원화 시세를 매일 갱신. OP-01~OP-16, EB, PRB의 박스 가격, 1월 대비 변동률, 정가 대비 배수, 재판 기록, 개봉 지수까지 한눈에. 실거래 및 검증된 매물 기반." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:title" content="원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세" />
    <meta property="og:description" content="일본판 원피스 박스 전 세트 원화 시세·정가 대비 배수·재판 기록. 실거래 및 검증된 매물 기반, 매일 갱신." />
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
      .owMeter { display: flex; gap: 8px; align-items: flex-end; height: 120px; max-width: 520px; margin: 12px 0; }
      .owBar { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
      .owBar span { width: 100%; background: #ff7d3c; opacity: .6; border-radius: 4px 4px 0 0; min-height: 6px; }
      .owBar:last-child span { opacity: 1; }
      .owBar small { font-size: 10px; color: #7d8698; }
      .koFacts { margin: 14px 0; padding: 12px 16px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 760px; font-size: 14px; line-height: 1.7; }
      .koFacts strong { color: #50dad9; }
      .koNote { color: #7d8698; font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
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
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      <nav class="nav" aria-label="주요 메뉴"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../market.html" data-ko="마켓 지수">Market Index</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>
    </header>
    <main class="bodyPage">
      <p class="eyebrow">한국어 · 일본판 시세</p>
      <h1>원피스 부스터박스 시세 (일본판) — 전 세트 원화 시세</h1>
      <p class="koNote">일본판 원피스 카드게임 부스터박스 전 세트의 <strong>실거래·검증된 매물 기반</strong> 원화 시세입니다. 기준과 출처가 확인된 값만 표시하며 매일 갱신합니다. 기준일 ${esc(DATA_DATE)}.</p>

      <section aria-label="OPBOX 지수">
        <h2>OPBOX 지수 — 시장 전체를 숫자 하나로</h2>
        <div class="ixHero">
          <span class="big">${idx.value.toFixed(1)}</span>
          <span class="ixChg ${chgCls}">1월 대비 ${pct(idx.sinceBasePct)}</span>
          <span class="ixChg ${wkCls}">주간 ${pct(idx.weekChangePct)}</span>
        </div>
        <ul class="koFacts">
          <li>일본판 부스터박스 <strong>${mi.constituents.length}종</strong> 동일가중 지수 (2026년 1월 7일 = 100)</li>
          <li>현재 <strong>${idx.value.toFixed(1)}</strong> — 1월 대비 <strong>${pct(idx.sinceBasePct)}</strong></li>
          <li>개봉 지수(주간 PSA 등급 수): <strong>${mi.meter.latestWeek.v.toLocaleString("ko-KR")}장</strong> (${esc(mi.meter.latestWeek.d)} 주)</li>
        </ul>
      </section>

      <section aria-label="전 세트 시세표">
        <h2>전 세트 박스 시세표 (원화)</h2>
        <p class="koNote">변동률은 <strong>2026년 1월 대비</strong>입니다(발매일 대비 아님). 정가 대비 배수 = 현재 시세 ÷ 발매 정가.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">세트</th><th class="l">이름</th><th>박스 시세</th><th>1월 대비</th><th>정가 대비</th><th class="l">재판</th></tr></thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
        </div>
      </section>

      <section aria-label="급등 급락">
        <h2>급등·급락 TOP 3 (1월 대비)</h2>
        <div class="moverGrid">
          <div class="moverCol"><h3>▲ 급등</h3><ul>${topUp.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="up">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
          <div class="moverCol"><h3>▼ 급락</h3><ul>${topDn.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="down">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
        </div>
      </section>

      <section aria-label="개봉 지수">
        <h2>개봉 지수 — 주간 PSA 등급 물량</h2>
        <p class="koNote">주간 PSA 그레이딩 접수량입니다. 물량이 늘수록 개봉·등급 열기가 뜨겁다는 신호(누적 ${mi.meter.allTimeGraded.toLocaleString("ko-KR")}장).</p>
        <div class="owMeter">${meterBars}</div>
      </section>

      <div class="koCta">
        <a class="primary" href="../amazon-lottery.html">아마존 응모 안내 →</a>
        <a class="ghost" href="../market.html">영문 상세 지수 →</a>
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
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;

fs.mkdirSync(path.join(ROOT, "ko"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "ko", "index.html"), html, "utf8");
console.log(JSON.stringify({ wrote: "ko/index.html", sets: rows.length, index: idx.value, faqs: faqs.length }));
