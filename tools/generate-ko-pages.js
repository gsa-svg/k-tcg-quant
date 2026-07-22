// 한국어 정적 페이지 생성 — /ko/index.html (원피스 부스터박스 시세 허브).
// 네이버 Yeti·구글이 크롤 가능한 "구운" 한국어 HTML(JS 스왑 아님). 검증된 onepiece-packs.json에서 생성 → 야간 재생성으로 영문판과 동일 데이터 유지.
// Run: node tools/generate-ko-pages.js
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = "20260721f"; // packs.js DATA_VERSION 와 동시 범프(가드 V1)

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

// 시세표 행 — 변동률 기준일(baseDate)은 세트마다 다름(대부분 2026-01-07, OP-16은 발매추적 4-27) → 행마다 명시
const koSlug = (code) => code.toLowerCase();
const tableRows = rows.map((b) => {
  const krw = boxKrw(b.code, b.nowUsd);
  const rr = reprintRecords(b.code);
  const rpCell = rr.length
    ? `<span class="rpDot" title="${esc(rr.map((r) => r.date + (r.note ? " " + r.note : "")).join(" / "))}">재판 ${rr.length}회</span>`
    : `<span class="rpNone">재판 기록 없음</span>`;
  const chgCls = b.changePct >= 0 ? "up" : "down";
  return `<tr>
    <td class="code"><a href="${koSlug(b.code)}.html">${esc(b.code)}</a></td>
    <td class="nm">${esc(nameKo(b.code))}</td>
    <td class="num">${won(krw)}</td>
    <td class="num ${chgCls}">${pct(b.changePct)}<small class="fromDate">${esc(b.baseDate || "")} 대비</small></td>
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
    <link rel="alternate" hreflang="en" href="${SITE}/" />
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
        <p class="koNote">변동률은 각 세트의 <strong>추적 시작일 대비</strong>입니다(발매일 대비 아님 — 대부분 2026-01-07부터 추적, 기준일은 행마다 표기). 정가 대비 배수 = 현재 시세 ÷ 발매 정가. 세트 코드를 누르면 세트별 상세 시세로 갑니다.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">세트</th><th class="l">이름</th><th>박스 시세</th><th>기준일 대비</th><th>정가 대비</th><th class="l">재판</th></tr></thead>
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

// ─────────────────────────────────────────────────────────────
// 세트별 한국어 페이지 /ko/{code}.html — 한국어 롱테일("op-16 시세", "결전의 시간 박스 가격") 공략.
// 값은 전부 검증된 데이터에서만 파생하고, 없으면 표시하지 않음(빈칸 > 틀린값).
const NAV_KO = `<nav class="nav" aria-label="주요 메뉴"><a href="../" data-ko="부스터 박스">Booster Boxes</a><a href="../compare.html" data-ko="비교">Compare</a><a href="../psa10-ranking.html" data-ko="PSA10 랭킹">Top PSA 10</a><a href="../market.html" data-ko="마켓 지수">Market Index</a><a href="../sets/index.html" data-ko="세트 가이드">Set Guides</a><a href="../amazon-lottery.html" data-ko="아마존 응모">Amazon Raffle</a></nav>`;

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
        <p class="koNote">일본판 NM(민트급) 기준 시세입니다. 변형(패러렐·망가·SP)이 다르면 가격이 크게 달라지므로 번호와 레어도를 함께 확인하세요.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">카드</th><th class="l">번호</th><th class="l">레어도</th><th>NM 시세</th></tr></thead>
          <tbody>
${cardRows}
          </tbody>
        </table>
        </div>
      </section>` : "";

  // 팩트 리스트 — 검증된 값만
  const facts = [];
  facts.push(`현재 박스 시세 <strong>${won(krw)}</strong> (기준일 ${esc(DATA_DATE)})`);
  if (chg != null) facts.push(`${esc(b.baseDate || "추적 시작일")} 대비 <strong>${pct(chg)}</strong> — 발매일 대비가 아님`);
  if (b.msrpYen) facts.push(`발매 정가 <strong>¥${b.msrpYen.toLocaleString("ko-KR")}</strong>${b.vsMsrp ? ` · 현재 정가의 <strong>${b.vsMsrp}배</strong>` : ""}`);
  facts.push(rr.length ? `재판 기록 <strong>${rr.length}회</strong> (${rr.map((r) => r.date).join(", ")}) — 유통사·리테일러 재입고 기준` : `<strong>재판 기록 없음</strong> — 확인된 재입고 기록이 없다는 뜻`);
  if (s.psaTotal != null) facts.push(`PSA 누적 감정 <strong>${Number(s.psaTotal).toLocaleString("ko-KR")}장</strong>${s.psaGem != null ? ` · PSA10 비율 <strong>${s.psaGem}%</strong>` : ""}`);
  if (s.release) facts.push(`영문(NA)판 발매일 ${esc(s.release)} — 이 페이지 시세는 <strong>일본판</strong> 기준`);

  const setFaqs = [
    { q: `${code} ${nKo} 박스 시세는 지금 얼마인가요?`, a: `${DATA_DATE} 기준 일본판 ${code} 부스터박스 시세는 약 ${won(krw)}입니다. 이베이 실거래·검증된 매물을 매일 집계해 원화로 환산한 값이며, 판매처·상태에 따라 달라질 수 있습니다.` },
    { q: `${code}는 정가보다 얼마나 올랐나요?`, a: b.msrpYen ? `발매 정가는 ¥${b.msrpYen.toLocaleString("ko-KR")}이고, 현재 시세는 정가의 약 ${b.vsMsrp ?? "—"}배입니다. 정가 대비 배수 = 현재 시세 ÷ 발매 당시 일본 정가로 계산합니다.` : `이 세트의 발매 정가 정보가 확인되지 않아 정가 대비 배수는 표시하지 않습니다.` },
    { q: `${code}는 재판(재발매)된 적 있나요?`, a: rr.length ? `유통사·리테일러 재입고 기준으로 ${rr.length}회 확인됩니다(${rr.map((r) => r.date).join(", ")}). 반다이는 세트별 재판을 공식 발표하지 않으므로 공식 발표가 아닌 유통 기록입니다.` : `확인된 재판 기록이 없습니다. 다만 반다이가 세트별 재판을 공식 발표하지 않기 때문에, "기록 없음"이 "재판이 절대 없었다"는 뜻은 아닙니다.` },
    { q: `${code} 변동률은 발매일부터 계산한 건가요?`, a: b.launchTracked ? `${code}는 발매 시점(${esc(b.baseDate || "")})부터 추적한 세트라 변동률이 발매 초기 대비입니다.` : `아니요. ${esc(b.baseDate || "2026-01-07")}부터 추적을 시작해 그 시점 대비 변동률입니다. 발매일 대비가 아닙니다.` },
  ];
  const setFaqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: setFaqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: `${code} ${nKo}`, item: canonical },
  ] });

  const title = `${code} ${nKo} 박스 시세 (일본판) | OP Box Index`;
  const desc = `${code} ${nKo} 일본판 부스터박스 시세 ${won(krw)} (${DATA_DATE} 기준). 정가 대비 배수, 재판 기록, 인기 카드 NM 시세까지 매일 갱신. 실거래 및 검증된 매물 기반.`;

  return { slug, html: `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
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
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${NAV_KO}
    </header>
    <main class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:#7d8698;text-decoration:none">한국어 시세</a> · 일본판</p>
      <h1>${esc(code)} ${esc(nKo)} 부스터박스 시세 (일본판)</h1>
      <div class="ixHero">
        <span class="big">${won(krw)}</span>
        ${chg != null ? `<span class="ixChg ${up ? "up" : "down"}">${pct(chg)}</span>` : ""}
        ${b.vsMsrp ? `<span style="color:#9aa4b6;font-size:14px">정가의 ${b.vsMsrp}배</span>` : ""}
      </div>
      <ul class="koFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
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
      <p class="koNote">데이터: 이베이 실거래·검증된 매물 집계, PSA 인구 리포트, 반다이 공식 발매 정보. 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}). 마지막 갱신 ${esc(DATA_DATE)}. 시세는 참고용이며 투자·구매 판단의 책임은 본인에게 있습니다.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index는 투자 권유가 아닌 데이터 기반 리서치 사이트입니다.</p>
      <nav aria-label="정책 안내"><a href="../about.html">About</a><a href="../privacy.html">Privacy</a><a href="../disclaimer.html">Disclaimer</a></nav>
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

// 사이트맵 idempotent 등재(/ko/{slug}.html)
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  let added = 0;
  for (const rel of written) {
    const loc = `${SITE}/${rel}`;
    if (sm.includes(`<loc>${loc}</loc>`)) continue;
    const slug = rel.replace("ko/", "").replace(".html", "");
    const enAlt = fs.existsSync(path.join(ROOT, "sets", `${slug}.html`)) ? `\n    <xhtml:link rel="alternate" hreflang="en" href="${SITE}/sets/${slug}.html" />` : "";
    const block = `  <url>\n    <loc>${loc}</loc>\n    <xhtml:link rel="alternate" hreflang="ko" href="${loc}" />${enAlt}\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.7</priority>\n  </url>\n`;
    sm = sm.replace("</urlset>", block + "</urlset>");
    added++;
  }
  if (added) fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: "ko/index.html", setPages: written.length, sitemapAdded: added, index: idx.value }));
}
