// 한국어 정적 페이지 생성 — /ko/index.html (원피스 부스터박스 시세 허브).
// 네이버 Yeti·구글이 크롤 가능한 "구운" 한국어 HTML(JS 스왑 아님). 검증된 onepiece-packs.json에서 생성 → 야간 재생성으로 영문판과 동일 데이터 유지.
// Run: node tools/generate-ko-pages.js
const CSS_VER = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";  // 하드코딩 금지 — 범프 때 가드 V1 이 배포를 막는다(2026-07-27)
const fs = require("fs");
const { variant } = require("./image-variants");
const { detailRobotsMeta } = require("./adsense-review-gate");
const { syncDetailUrls } = require("./sitemap-detail-urls");
// 세트별 공식 카드리스트(ko/<code>-card-list.html — generate-card-list-pages.js). 링크는 공식 목록 데이터로 정한다(2026-10-14, W7).
const CARD_LIST = require("./card-list-shared");
// NM 을 써도 되는가(값·읽은 날 있음·숨김 표시 없음) — 카드 상세·영문 세트·AI 피드와 같은 술어(2026-10-15).
const { nmUsable, priciest, psa10Usd } = require("./market-data-normalizers");
// 상단 Key facts 표 — 영문 세트 페이지와 같은 함수에서 같은 사실을 읽는다(2026-10-14, W5a). 한국어로 그린다.
const { keyFactsModel, keyFactsHtml, KF_CSS, latestSets, setPageDate, splitReprints } = require("./set-page-shared");
const path = require("path");
const ROOT = path.join(__dirname, "..");
// 세트별 경매 실적 — build-set-auction-stats.js 가 굽는다. 영문 세트 페이지와 같은 원본을 쓴다.
let KO_AUCTION = { sets: {}, window: {}, updated: "" };
try { KO_AUCTION = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-auction-stats.json"), "utf8")); } catch { /* 없으면 생략 */ }
const { navHtmlKo } = require("./site-nav");
const NAV_KO = navHtmlKo();
const SITE = "https://opboxindex.com";
const CACHE = CSS_VER;  // packs.js DATA_VERSION 를 읽는다 — 하드코딩하면 범프 때 가드 V1 이 막는다(2026-07-27)

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
// marketIndex 는 이제 '지수 화면'이 아니라 세트별 시세판(board) 공급원으로만 쓴다.
// 지수/개봉미터 표시는 2026-07-29 소유자 지시로 전부 삭제됨(값이 실제와 안 맞았음).
const mi = d.marketIndex;
// 재판 기록은 영문 세트 페이지(generate-set-pages.js)와 같은 원천 data/set-facts.json 에서 직접 읽는다(2026-10-15 QA).
// marketIndex.reprints 는 build-market-index 가 복사해 둔 사본이라, 분류를 고친 날 순서가 어긋나면 한국어만 옛 분류로 나간다.
let FACTS = { sets: {} };
try { FACTS = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-facts.json"), "utf8")); } catch { /* 없으면 재판 기록 없음으로 */ }
const fx = d.fx || {};
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const won = (n) => (n == null ? "—" : Math.round(n).toLocaleString("ko-KR") + "원");
const pct = (n) => (n == null ? "—" : (n >= 0 ? "+" : "") + n.toFixed(1) + "%");
const DATA_DATE = d.updated || "";
// 허브 "기준일"·"마지막 갱신" = 허브 표에 보이는 가장 늦은 중앙값 날짜 — 2026-10-15(5차): 표의 OP-07 행은 10-15 인데 둘 다 10-14(데이터 갱신일)였다.
// <title>·og:title 의 날짜는 그대로 둔다(SEO 민감 요소).
const HUB_DATE = [...((d.marketIndex && d.marketIndex.board) || []).map((b) => b.nowDate)].filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x || "")).sort().pop() || DATA_DATE;

// 세트번호 자연정렬(OP-01..OP-16, EB-01..EB-03, PRB-01..PRB-02)
function orderKey(code) {
  const m = code.match(/^([A-Z]+)-?(\d+)/);
  const fam = { OP: 0, EB: 1, PRB: 2 }[m ? m[1] : "OP"] ?? 9;
  return fam * 1000 + (m ? parseInt(m[2], 10) : 0);
}
const rows = [...mi.board].sort((a, b) => orderKey(a.code) - orderKey(b.code));
// 최신 세트(계열별 가장 늦은 발매·120일 이내·공식 카드 리스트 있음) — 영문 생성기와 같은 함수.
const LATEST_KO = latestSets(rows.map((b) => b.code), DATA_DATE);

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

// PSA 10 실거래 중앙값 → 원화. psa10Ebay.middle 은 세트마다 통화가 다르다(신규 수집 USD / 옛 값 KRW).
// 확인 없이 원화로 찍어 "PSA 10 실거래 중앙값은 921원 … 약 0.0배"가 세트 페이지 본문에 나갔다(2026-09-16).
// 통화를 모르면 null — 그 문장 자체를 싣지 않는다(빈칸 > 틀린값).
// 표본 하한 3건은 ko/cards.html 과 같은 기준이다 — 한쪽만 느슨하면 같은 카드가 페이지마다 다르게 나온다(2026-09-16).
// 원화 = 영문 페이지가 내는 달러 값(market-data-normalizers.psa10Usd) × 다른 원화 환산과 같은 fx.usdKrw — 2026-10-15(5차). 옛 KRW 저장값을 그대로 쓰지 않는다.
function psa10Krw(p) {
  if (!p || p.middle == null || (p.sampleSize || 0) < 3) return null;
  const u = psa10Usd(p, fx);
  return u != null && fx.usdKrw ? u * fx.usdKrw : null;
}

function nameKo(code) { const s = d.sets[code]; return (s && s.nameKo) || code; }
// 재판 기록 분류 = set-page-shared.splitReprints — 영문 세트 페이지·홈 배지와 같은 함수(2026-10-15, 4차).
//   restock = 재판 횟수(리테일러·유통사 재입고 + "再販"이라 적힌 추첨 — OP-09 반다이남코샵 2024-10) · lottery = 再販 표기 없는 발매 후 추첨(재판 아님)
//   · unverified = 발매 전후 미확인 추첨. 발매 전 추첨(pre-release-lottery)은 초판 배정이라 어디에도 싣지 않는다.
// 3차는 반다이 추첨을 전부 빼서 OP-09 가 허브에서 "재판 1회" → "재판 기록 없음"이 됐다(원장 메모는 再販).
function reprintSplit(code) {
  const { reprint, lottery, unverified } = splitReprints(((FACTS.sets || {})[code] || {}).reprintRecords);
  return { restock: reprint, lottery, unverified };
}
// 툴팁·본문에 note 원문(영어 내부 검증 메모)을 넣지 않는다 — 2026-08-26. 시기 + 유형(한국어)만.
const RESTOCK_KO = { retailer: "리테일러 재입고", distributor: "유통사 재입고", "official-reprint-lottery": "반다이남코샵 재판(再販) 추첨판매" };
// 재입고(리테일러·유통사)만 있는 기록인가 — "반다이 공식 발표가 아닌 유통 기록" 문장은 그때만 맞다(再販 추첨은 반다이남코샵 기록).
const storeOnly = (rr) => rr.every((r) => r.kind === "retailer" || r.kind === "distributor");
const restockLabel = (r) => [r.date, RESTOCK_KO[r.kind] || "재입고"].filter(Boolean).join(" · ");
// 추첨판매 한 줄 라벨 — 허브 표·세트 페이지 팩트·FAQ 가 같은 문구를 쓴다.
const drawText = ({ lottery, unverified }) => [
  lottery.length ? `발매 후 반다이 공식 추첨판매 ${lottery.length}회(${lottery.map((r) => r.date).filter(Boolean).join(", ")})` : "",
  unverified.length ? `반다이 추첨판매 ${unverified.length}회(${unverified.map((r) => r.date).filter(Boolean).join(", ")}, 발매 전후 미확인)` : "",
].filter(Boolean).join(" · ");

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
  // 가장 비싼/싼 박스 = 화면 금액(원 단위 반올림)이 최댓값/최솟값인 세트 전부 — 2026-10-15(5차): OP-07·OP-08 이 둘 다 106,943원인데
  // 여기는 OP-07 하나, 영문 홈 FAQ 는 OP-08 하나만 적었다. 같은 금액이면 표 순서대로 모두 적는다(영문 홈 FAQ 와 같은 규칙).
  const shown = (b) => Math.round(boxKrw(b.code, b.nowUsd));
  const his = priced.filter((b) => shown(b) === Math.max(...priced.map(shown)));
  const los = priced.filter((b) => shown(b) === Math.min(...priced.map(shown)));
  const hi = his[0], lo = los[0];
  const boxNames = (list) => list.map((b) => `<strong>${esc(b.code)} ${esc(nameKo(b.code))}</strong>`).join("·");
  const rpSets = rows.filter((b) => reprintSplit(b.code).restock.length);   // 재판 횟수가 있는 세트(재입고 + 再販 추첨, splitReprints — 2026-10-15 4차)
  const u0 = topUp[0], d0 = topDn[0];
  return `
      <section aria-label="시장 읽기">
        <h2>지금 일본판 박스 시장 읽는 법</h2>
        <p class="koProse">추적 중인 ${withChg.length}개 세트 가운데 <strong>${nUp}개가 4주 전 대비 상승</strong>, ${nDn}개가 하락 상태입니다. 가장 비싼 박스는 ${boxNames(his)}(${won(boxKrw(hi.code, hi.nowUsd))}), 가장 싼 박스는 ${boxNames(los)}(${won(boxKrw(lo.code, lo.nowUsd))})로, 같은 게임 안에서도 세트별 격차가 큽니다. 상승 1위는 ${esc(u0.code)}(${pct(u0.changePct)})${d0 && d0.changePct < 0 ? `, 하락 1위는 ${esc(d0.code)}(${pct(d0.changePct)})` : ""}입니다.</p>
        <p class="koProse">박스 시세를 움직이는 힘은 크게 셋입니다. ① <strong>개봉 속도</strong> — 그레이딩 접수량이 그 대리지표이고, 세트별 PSA·CGC·TAG 인구는 각 세트 페이지에 정리돼 있습니다. ② <strong>재판(재입고)</strong> — 현재 ${rpSets.length}개 세트(${rpSets.map((b) => esc(b.code)).join(", ")})에서 재판 기록이 확인됐고, 재판은 공급을 다시 늘려 시세를 누르는 요인입니다. ③ <strong>히트카드 시세</strong> — 박스 기대값의 골격이라, 상위 카드가 오르면 박스가 따라 오르는 패턴이 반복됩니다.</p>
        <p class="koProse">이 표의 값은 추정치가 아니라 이베이 <strong>실거래·검증된 매물</strong>을 매일 집계해 원화로 환산한 것입니다. 변동률 기준일이 세트마다 다르므로(행마다 표기) "발매일 대비 수익률"로 읽으면 안 됩니다. 세트 코드를 누르면 그 세트의 시세 흐름·재판 이력·인기 카드·그레이딩 인구까지 한국어로 정리된 상세 페이지로 이동합니다.</p>
      </section>`;
})();

// 카드 썸네일 — 자체 호스팅 이미지만 쓴다(외부 CDN 직링크는 가드 I1 이 막는다).
// ko/ 깊이라 출력할 때 "../" 를 붙인다(안 붙이면 /ko/img/... 로 해석돼 404).
const IMG_MAP_CARDS = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "img", "cards", "map.json"), "utf8")); } catch { return {}; } })();
const cardSlugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70);
function ownCardImage(c) {
  const mapped = IMG_MAP_CARDS[cardSlugify(c.number + "-" + c.name)];
  if (mapped) return mapped;
  const u = c.image || c.img || "";
  if (/^https:\/\/opboxindex\.com\//.test(u)) return u.replace(/^https:\/\/opboxindex\.com\//, "").replace(/^\/+/, "");
  return null;
}

// 시세표 행 — 변동률 = 그 중앙값(nowDate) 대 28일 전 중앙값(changeBasis). 기준일이 세트마다 달라 행마다 명시한다.
// (종전 주석의 "2026-01-07 대비·OP-16 발매추적"은 옛 정의다 — 2026-10-14 부터 build-market-index 가 4주 기준으로 낸다.)
const koSlug = (code) => code.toLowerCase();
const tableRows = rows.map((b) => {
  const krw = boxKrw(b.code, b.nowUsd);
  const rs = reprintSplit(b.code);
  // 재판 칸 = 재입고 횟수. 반다이 추첨판매는 재판으로 세지 않고 아래 작은 글씨로 따로(영문 세트 페이지와 같은 분류, 2026-10-15).
  // 칸이 좁아(390px) 작은 글씨는 짧게, 시기·유형은 툴팁에.
  const drawShort = [rs.lottery.length ? `발매 후 추첨 ${rs.lottery.length}회` : "", rs.unverified.length ? `추첨 ${rs.unverified.length}회(발매 전후 미확인)` : ""].filter(Boolean).join(" · ");
  const rpCell = (rs.restock.length
    ? `<span class="rpDot" title="${esc(rs.restock.map(restockLabel).join(" / "))}">재판 ${rs.restock.length}회</span>`
    : `<span class="rpNone">재판 기록 없음</span>`) + (drawShort ? `<small class="fromDate" title="${esc(drawText(rs))}">${esc(drawShort)}</small>` : "");
  const chgCls = b.changePct >= 0 ? "up" : "down";
  return `<tr>
    <td class="code"><a href="${koSlug(b.code)}.html">${esc(b.code)}</a></td>
    <td class="nm">${esc(nameKo(b.code))}</td>
    <td class="num">${won(krw)}${b.nowDate ? `<small class="fromDate">${esc(b.nowDate)}</small>` : ""}</td>
    <td class="num ${chgCls}">${pct(b.changePct)}${b.changeBasis ? `<small class="fromDate">${esc(b.changeBasis)} 대비</small>` : ""}</td>
    <td class="rp">${rpCell}</td>
  </tr>`;
}).join("\n");

// FAQ (한국어) — 스키마 + 본문 동일 소스
const faqs = [
  {
    q: "원피스 부스터박스 시세는 어디 기준인가요?",
    a: `이베이 실거래·매물 데이터를 매일 집계해 원화로 환산한 값입니다(환율 ₩${fx.usdKrw}/$ 기준, ${fx.date} 갱신). 추정가가 아니라 실제 거래·호가 기반이며, 값이 불확실하면 빈칸으로 둡니다.`,
  },
  // 2026-10-15 QA: 이 답은 "2026년 1월 대비·OP-16만 발매 시점부터" 라는 옛 정의를 고정 문구로 들고 있어, 같은 페이지 범례
  // ("28일 전 중앙값 대비")·행 표기("2026-09-15 대비")와 FAQPage 구조화데이터가 엇갈렸다. 범례와 같은 정의로 쓴다.
  {
    q: "변동률은 발매일 대비인가요?",
    a: "아니요. 표의 변동률은 각 세트 판매 중앙값을 그 28일 전 중앙값과 비교한 값이며, 비교 기준일은 행마다 표기합니다.",
  },
  {
    q: "재판(재발매) 정보는 공식인가요?",
    a: "반다이는 세트별 재판을 공식 발표하지 않습니다. 표의 재판 기록은 유통사·리테일러 재입고와 반다이남코샵 재판(再販) 추첨판매 기록이며, '재판 기록 없음'은 확인된 기록이 없다는 뜻입니다.",
  },
  {
    q: "일본 아마존에서 응모는 어떻게 하나요?",
    a: "일본 아마존은 인기 박스를 추첨(응모) 방식으로 판매합니다. 한국 배송도 가능(AmazonGlobal, 상품별 상이). 아마존 응모 안내 페이지에서 최신 링크를 확인하세요.",
  },
  {
    q: "일판과 정발(한글판)은 시세가 같나요?",
    a: "다릅니다. 이 사이트 수치는 전부 일판(일본판) 기준이며 정발(한글판)은 집계하지 않습니다.",
  },
];
const faqLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "FAQPage",
  mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
});
const datasetLd = JSON.stringify({
  "@context": "https://schema.org", "@type": "Dataset",
  name: "원피스 부스터박스 시세 (일본판)",
  description: "일본판 원피스 카드게임 부스터박스 전 세트의 원화 시세, 4주 변동률(28일 전 중앙값 대비), 재판 기록. 매일 갱신.",   // "1월 대비"는 옛 정의(2026-10-15)
  inLanguage: "ko", isAccessibleForFree: true,
  // 표에 실린 값의 마지막 판매일 범위·라이선스·내려받기 — 비어 있었다(2026-10-14 W6b). 영문 홈 Dataset 과 같은 기준.
  // 기간 = 배포 파일(opbox-set-prices.csv)의 관측일 범위 — free-data 의 같은 Dataset 과 한 함수(2026-10-14 QA).
  // 수정일 ≥ 기간 끝 — 2026-10-15 감사(#4): dateModified 10-14(DATA_DATE) · 기간 …/10-15 였다.
  ...(() => { const sp = require("./dataset-coverage").boxCsvSpan(d); return sp ? { temporalCoverage: sp.coverage, dateModified: [DATA_DATE, sp.to].filter(Boolean).sort().pop() } : { dateModified: DATA_DATE }; })(),
  url: `${SITE}/ko/`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  distribution: [{ "@type": "DataDownload", encodingFormat: "text/csv", contentUrl: `${SITE}/opbox-set-prices.csv` }],
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
    <script defer src="/track.js"></script>
    <!-- Korean data pages remain ad-free during AdSense site approval. -->
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="ko" href="${SITE}/ko/" />
    <link rel="alternate" hreflang="en" href="${SITE}/" />
    <link rel="alternate" hreflang="x-default" href="${SITE}/" />
    <link rel="alternate" type="application/rss+xml" title="OP Box Index 한국어" href="${SITE}/ko/feed.xml" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <title>원피스 카드 시세 — 일판 부스터박스 ${rows.length}세트 원화 (${DATA_DATE} 기준) | opboxindex</title>
    <meta name="description" content="일판 원피스 부스터박스 ${rows.length}세트의 원화 시세를 매일 갱신합니다. 박스 시세·재판 기록·급등락 세트, 인기 카드 낱장과 PSA 10 시세까지. 이베이 실제 낙찰가 기준 (${HUB_DATE}, 일판 전용)." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="ko_KR" />
    <meta property="og:title" content="원피스 부스터박스 시세 (일판) — ${rows.length}세트 원화, ${DATA_DATE} 기준" />
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
      .up { color: var(--accent); } .down { color: var(--red); }
      .ixChg.up { background: rgba(var(--accent-rgb), .12); } .ixChg.down { background: rgba(255,125,125,.12); }
      .koBoard { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 14px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11.5px; }
      .koBoard th.l, .koBoard td.nm, .koBoard td.code, .koBoard td.rp { text-align: left; }
      .koBoard td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      @media (max-width: 640px) { .koBoard th, .koBoard td { padding: 8px 6px; } }   /* 390px 에서 표가 2px 넘쳐 가로 스크롤됐다(2026-10-13 QA) */
      .koBoard td.num { text-align: right; white-space: nowrap; }
      .koBoard td.code { font-weight: 700; color: #cfd6e4; }
      .koBoard td.nm { color: #9aa4b6; }
      .rpDot { display: inline-block; background: rgba(255,125,60,.15); color: #ff9d6c; border-radius: 6px; padding: 1px 7px; font-weight: 700; font-size: 12px; }
      .rpNone { color: #6a7182; font-size: 12px; }
      .koProse { color: #9aa4b6; font-size: 14px; max-width: 760px; line-height: 1.75; margin: 8px 0; }
      .koProse strong { color: #cfd6e4; }
      .fromDate { display: block; font-size: 11.5px; color: var(--muted); font-weight: 400; }
      .koBoard td.code a { color: var(--accent); text-decoration: none; font-weight: 700; }
      .owMeter { display: flex; gap: 8px; align-items: flex-end; height: 120px; max-width: 520px; margin: 12px 0; }
      .owBar { flex: 1; display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; gap: 4px; }
      .owBar span { width: 100%; background: #ff7d3c; opacity: .6; border-radius: 4px 4px 0 0; min-height: 6px; }
      .owBar:last-child span { opacity: 1; }
      .owBar small { font-size: 11.5px; color: var(--muted); }
      .koFacts { margin: 14px 0; padding: 12px 16px; border: 1px solid rgba(var(--accent-rgb), .28); background: rgba(var(--accent-rgb), .05); border-radius: 12px; max-width: 760px; font-size: 14px; line-height: 1.7; }
      .koFacts strong { color: var(--accent); }
      .koNote { color: var(--muted); font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
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
      .koCta .primary { background: var(--accent); color: #08131a; }
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
      <p class="eyebrow">한국어 · 원피스카드 일판 시세</p>
      <h1>원피스 부스터박스 시세 (일판) — 전 세트 원화 시세</h1>
      <p class="koNote">일본판 원피스 카드게임 부스터박스 전 세트의 <strong>실거래·검증된 매물 기반</strong> 원화 시세입니다. 기준과 출처가 확인된 값만 표시하며 매일 갱신합니다. 기준일 ${esc(HUB_DATE)}.</p>

      <section aria-label="전 세트 시세표">
        <h2>전 세트 박스 시세표 (원화)</h2>
        <p class="koNote">시세 = 이베이 실거래 중앙값(원화 환산), 아래 날짜는 그 중앙값의 날짜 · 변동률 = 그 값의 <strong>28일 전 중앙값 대비</strong>(기준일은 행마다 표기, 발매일 대비 아님) · — = 28일 안에 날짜가 찍힌 중앙값 없음(중앙값은 창 안 판매 6건 이상). 세트 코드를 누르면 세트별 상세 시세로 갑니다.</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr><th class="l">세트</th><th class="l">이름</th><th>일판 박스 시세 (기준일)</th><th>4주 등락</th><th class="l">재판</th></tr></thead>
          <tbody>
${tableRows}
          </tbody>
        </table>
        </div>
      </section>

${hubProse}

      <section aria-label="급등 급락">
        <h2>급등·급락 TOP 3 (4주)</h2>
        <div class="moverGrid">
          <div class="moverCol"><h3>▲ 급등</h3><ul>${topUp.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="up">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
          <div class="moverCol"><h3>▼ 급락</h3><ul>${topDn.map((b) => `<li><span>${esc(b.code)} ${esc(nameKo(b.code))}</span><span class="down">${pct(b.changePct)}</span></li>`).join("")}</ul></div>
        </div>
      </section>

      <section aria-label="주제별 데이터">
        <h2>주제별 데이터 바로가기</h2>
        <p class="koProse"><a href="cards.html"><strong>원피스카드 일판 시세</strong></a> — 인기 카드 상위 30장의 NM·PSA 10 실거래가를 원화로. <a href="grading.html"><strong>그레이딩 인구</strong></a> — PSA·CGC·TAG에 세트별로 몇 장이 접수됐고 젬률이 얼마인지. <a href="auction.html"><strong>이베이 경매 낙찰 데이터</strong></a> — 호가가 아닌 실제 낙찰가와 낙찰률. 셋 다 자체 수집 데이터로 매일 갱신됩니다.</p>
      </section>

      <div class="koCta">
        <a class="primary" href="amazon-lottery.html">아마존 응모 안내 →</a>
        <a class="ghost" href="../psa-grading.html">그레이딩 인구 데이터 →</a>
        <a class="ghost" href="../sets/index.html">세트별 가이드 →</a>
      </div>

      <section aria-label="자주 묻는 질문">
        <h2>자주 묻는 질문</h2>
        ${faqHtml}
      </section>

      <p class="koNote">데이터: 이베이 실거래·매물 집계, PSA 인구 리포트, 반다이 공식 발매 정보. 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}). 마지막 갱신 ${esc(HUB_DATE)}. 시세는 참고용이며 투자·구매 판단의 책임은 본인에게 있습니다.</p>
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

function setPageKo(b) {
  const code = b.code;
  const s = d.sets[code] || {};
  const nKo = nameKo(code);
  const slug = koSlug(code);
  const krw = boxKrw(code, b.nowUsd);
  const rs = reprintSplit(code);
  const rr = rs.restock;   // 재판 횟수 = 재입고 기록만(반다이 추첨판매 제외 — 2026-10-15)
  const draws = drawText(rs);
  const enHref = fs.existsSync(path.join(ROOT, "sets", `${slug}.html`)) ? `../sets/${slug}.html` : null;
  const canonical = `${SITE}/ko/${slug}.html`;
  const chg = b.changePct;
  const up = chg >= 0;

  // 인기 카드(쓸 수 있는 NM 보유분만, 원화). 값 없으면 섹션 자체를 숨김.
  // 레어도 = 반다이 공식 카드 리스트의 그 인쇄 레어도(CARD_LIST.rarityCode — 영문 세트·카드 상세·AI 피드와 같은 함수·같은 코드, 2026-10-15).
  // 1차 수정은 이 파일에만 함수를 둬서 한국어 SP · 영문 Super Rare 로 갈렸다(72행).
  // 2026-10-15: 읽은 날이 없는 NM·숨김 표시 NM 은 싣지 않는다(nmUsable) — 영문 세트·카드 상세·AI 피드가 비우는 값을 여기만 원화로 보였다.
  const topCards = (s.cards || []).filter((c) => nmUsable(c) && c.number).slice(0, 8);
  // 자체 호스팅 이미지가 한 장도 없는 세트는 썸네일 열 자체를 넣지 않는다(빈 열 방지).
  const cardThumbs = topCards.map((c) => ownCardImage(c));
  const hasThumb = cardThumbs.some(Boolean);
  const thumbCell = (i, c) => (hasThumb
    ? `<td class="thumb">${cardThumbs[i] ? `<img src="${esc((variant("../" + cardThumbs[i], "thumb") || { src: "../" + cardThumbs[i] }).src)}" alt="${esc(c.number)} ${esc(c.name)}" width="40" height="56" loading="lazy" decoding="async" />` : ""}</td>`
    : "");
  const cardRows = topCards.map((c, i) => `<tr>${thumbCell(i, c)}<td class="nm">${esc(c.name)}</td><td class="code">${esc(c.number)}</td><td>${esc(CARD_LIST.rarityCode(code, c) || "—")}</td><td class="num">${won(c.nmJpy * fx.jpyKrw)}</td></tr>`).join("\n");
  // 경매 실적 — 우리가 종료 후 재조회해 쌓은 원장에서만 나오는 축이다.
  // 애드센스가 '가치 없는 콘텐츠'로 거절한 뒤(2026-09-01) 한국어 페이지도 같이 채운다.
  const koAuctionSection = (() => {
    const a = KO_AUCTION.sets && KO_AUCTION.sets[code];
    if (!a || a.ended < 30) return "";
    const w = KO_AUCTION.window || {};
    // carton(박스 케이스 묶음) 키가 빠져 영문 내부 키가 한국어 표에 그대로 나갔다(2026-10-15 QA). 분류기(auction-classify.js)의 키와 맞춘다.
    const catKo = { card: "싱글카드", box: "미개봉 박스", pack: "낱개 팩", carton: "카톤(박스 묶음)", graded: "등급카드", lot: "묶음" };
    const cats = Object.entries(a.byCat || {}).sort((x, y) => y[1].ended - x[1].ended).slice(0, 4);
    const rows = cats.map((e) => `<tr><td class="l">${esc(catKo[e[0]] || e[0])}</td><td>${e[1].ended.toLocaleString("ko-KR")}</td><td>${e[1].sold.toLocaleString("ko-KR")}</td><td>${e[1].sellThrough}%</td></tr>`).join("");
    const rate = a.sellThrough == null
      ? "낙찰 여부가 확인된 건이 적어 비율은 싣지 않습니다."
      : `<strong>${a.sellThrough}%</strong>가 낙찰됐고 <strong>${a.passThrough}%</strong>는 유찰됐습니다.`;
    // 거래액·중앙 낙찰가는 달러(set-auction-stats amount·medPrice = USD). 2026-10-15 QA: 통화 없이 "182,037" 로 나가
    // 원화 위주 페이지에서 원으로 읽혔다(약 1,340배 차이). 영문 세트 페이지와 같은 값·같은 표기("$" + 원값).
    const amt = a.amount ? ` 거래액은 <strong>$${a.amount.toLocaleString("en-US")}</strong>입니다.` : "";
    const med = a.medPrice ? ` 중앙 낙찰가는 <strong>$${a.medPrice}</strong>입니다.` : "";
    return `
      <section aria-label="경매 실적">
        <h2>${esc(code)} 경매는 실제로 어떻게 팔리나</h2>
        <p class="koNote">최근 ${w.days || 30}일(${esc(KO_AUCTION.updated || "")} 기준) ${esc(code)} 카드가 걸린 이베이 경매 <strong>${a.ended.toLocaleString("ko-KR")}건</strong>이 종료됐고, 우리가 종료 후 다시 조회해 결과를 확인했습니다. ${rate}${amt}${med} 호가가 아니라 실제 낙찰 결과입니다.</p>
        ${rows ? `<div style="overflow-x:auto"><table class="koBoard"><thead><tr><th class="l">유형</th><th>종료</th><th>낙찰</th><th>낙찰률</th></tr></thead><tbody>${rows}</tbody></table></div>` : ""}
        <p class="koNote">경매만 집계합니다 — 즉시구매는 따로 셉니다. 유찰된 경매도 분모에 그대로 둡니다.</p>
      </section>`;
  })();

  // NM 관측일 = 그 변형을 읽은 날(nmUpdated) — 2026-10-15 감사(#10): 종전엔 "DATA_DATE(10-14) 기준으로 비교합니다"라 10-11 에 읽은 값을
  // 10-14 값처럼 말했다(카드리스트·카드 상세·AI 피드는 10-11). 원화 값은 오늘 환율 환산이라 환율 날짜를 따로 적는다.
  const nmDays = topCards.map((c) => c.nmUpdated).filter((x) => /^\d{4}-\d{2}-\d{2}$/.test(x || "")).sort();
  const nmSpan = nmDays.length ? (nmDays[0] === nmDays.at(-1) ? nmDays[0] : `${nmDays[0]}~${nmDays.at(-1)}`) : "";
  const cardsSection = topCards.length ? `
      <section aria-label="인기 카드 시세">
        <h2>${esc(code)} 인기 카드 NM 시세 (원화)</h2>
        <p class="koNote">${esc(code)} ${esc(nKo)}의 일본판 NM 카드 ${topCards.length}장을 비교합니다(${nmSpan ? `관측일 ${esc(nmSpan)}, ` : ""}환율 ${esc(fx.date)} 기준).</p>
        <div style="overflow-x:auto">
        <table class="koBoard">
          <thead><tr>${hasThumb ? `<th class="l">이미지</th>` : ""}<th class="l">카드</th><th class="l">번호</th><th class="l">레어도</th><th>NM 시세</th></tr></thead>
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
    // 최저 = 최고(점 하나 또는 모든 점이 같은 값)면 범위 문장을 쓰지 않는다 — 2026-10-15(4차): ko/op-02 "최저 196,508원(2026-06-16)에서 최고 196,508원(2026-06-16) 사이를 오갔습니다".
    const ranged = lo.p !== hi.p;
    let line = ranged ? `${esc(code)} ${esc(nKo)} 박스는 추적 구간(${esc(first.d)}~${esc(last.d)}) 동안 최저 <strong>${won(lo.p)}</strong>(${esc(lo.d)})에서 최고 <strong>${won(hi.p)}</strong>(${esc(hi.d)}) 사이를 오갔습니다.` : "";
    // 같은 값끼리의 비교(변동 0.0%) 절은 뺀다 — 2026-10-15(5차): 마지막 값이 저점·고점과 같은 금액인데 날짜만 달라 "저점 대비 +0.0%"·"고점 대비 +0.0%"가 나갔다.
    const zero = (x) => Math.abs(x) < 0.05;
    const cmp = [fromLo != null && !zero(fromLo) ? `저점 대비 ${pct(fromLo)}` : "", offHi != null && !zero(offHi) ? `고점 대비 ${pct(offHi)}` : ""].filter(Boolean).join(", ");
    if (ranged && fromLo != null && offHi != null) {
      line += hi.d === last.d
        ? ` 현재가가 곧 추적 기간 최고가입니다 — 저점 대비 ${pct(fromLo)} 오른 상태로, 최근 매수세가 가격을 끌어올리고 있다는 뜻입니다.`
        : !cmp ? ""
        : krw != null
          ? ` 현재 시세 ${won(last.p)}은 ${cmp} 수준입니다.`
          : ` 마지막 중앙값 ${won(last.p)}(${esc(last.d)})은 ${cmp} 수준입니다(28일 안에 날짜가 찍힌 중앙값 없음).`;
    }
    prose.push({ h: "시세 흐름", p: [line, `${esc(code)} ${esc(nKo)}의 일별 차트와 검증된 매물 링크는 <a href="${enHref || "../?set=" + code}">영문 상세 페이지</a>에 함께 표시됩니다.`].filter(Boolean) });
  }

  // 2) 재판 이력 — 있는 세트와 없는 세트의 문장이 완전히 다르다
  //    분류는 splitReprints(영문 세트 페이지와 같은 함수, 2026-10-15 4차) — "再販"이라 적힌 추첨(OP-09)은 재판, 그 말이 없는 반다이 추첨은 재판 횟수 밖.
  //    재판 횟수 밖의 추첨은 위 팩트 줄의 라벨("발매 후 반다이 공식 추첨판매 N회(날짜) — 재판 아님")에만 싣는다(화면엔 표·라벨만).
  if (rr.length) {
    // note 원문을 그대로 넣지 않는다 — 2026-08-26. note 는 영어로 쓴 **내부 검증 메모**라
    // ("Verified 2026-08-13. Reclassified …") 한국어 문단 한가운데에 영어 문장이 통째로 박혔다.
    // 화면에는 시기 + 유형(한국어)만 싣는다. 원문 메모는 데이터에 그대로 남는다.
    const reprintLabels = rr.map(restockLabel).filter(Boolean).map(esc);
    prose.push({ h: "재판(재발매) 이력", p: [
      `${esc(code)} ${esc(topic(nKo))} ${storeOnly(rr) ? "유통사·리테일러 재입고 기준으로 " : ""}<strong>재판이 ${rr.length}회</strong> 확인됐습니다${reprintLabels.length ? `(${reprintLabels.join(" / ")})` : ""}.`,
      storeOnly(rr) ? `${esc(nKo)} 재판 이력은 반다이의 세트별 공식 발표가 아니라 확인 가능한 유통 기록이며, 재판분과 초판은 카드 자체로 구분되지 않습니다.` : `${esc(nKo)}의 재판분과 초판은 카드 자체로 구분되지 않습니다.`,
    ] });
  } else {
    // 기록 없음의 뜻을 풀어 쓰는 방어 문장("…단정하는 표현이 아니라 …범위를 뜻합니다")은 뺐다 — 2026-10-15(3차). 화면엔 값만(재입고 기록 없음).
    prose.push({ h: "재판(재발매) 이력", p: [
      `${esc(code)} ${esc(topic(nKo))} 지금까지 확인 가능한 유통사·리테일러 재입고 기록이 <strong>없습니다</strong>.`,
    ] });
  }

  // 3) 인기 카드 구성 — top 카드·유형 구성·NM 대비 PSA10
  // "가치를 끌고 가는 카드" = 가장 비싼 카드(market-data-normalizers.priciest — 검증된 NM 최댓값) — 2026-10-15. 영문 세트 Key facts·추적 문단·비교표와 같은 카드·같은 값.
  // 종전엔 1순위 카드(s.cards[0])라 OP-05 가 "Monkey D. Luffy(OP05-119) 약 4,203,120원" 인데 바로 아래 표 2행은 6,735,120원이었다.
  // 가장 비싼 카드를 모르면(검증 안 된 값이 1위 값 이상 — OP-08·OP-15·PRB-01·PRB-02·EB-02(5차)) 문단을 만들지 않는다. 4차부터 TCG 값은 1위가 될 수 없어 라벨은 NM 하나.
  const pc = priciest(s.cards || [], fx);
  if (topCards.length >= 3 && pc) {
    const t0 = pc.card;
    const pcKrw = t0.nmJpy * fx.jpyKrw;
    const pcLbl = "일본판 NM 시세";
    // 금액 뒤에 NM 관측일 — 영문 세트 Key facts·추적 문단과 같은 날짜(2026-10-15, 5차: OP-12 09-07 값이 날짜 없이 나갔다).
    const pcWhen = pc.price.date ? `(${esc(pc.price.date)})` : "";
    const kind = (c) => /manga|망가/i.test(c.name) ? "망가" : /\bsp\b/i.test(c.name) ? "SP" : /wanted|수배/i.test(c.name) ? "수배서" : /parallel|alt/i.test(c.name) ? "패러렐" : "기타";
    const comp = {};
    (s.cards || []).forEach((c) => { comp[kind(c)] = (comp[kind(c)] || 0) + 1; });
    const compTxt = Object.entries(comp).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}장`).join(", ");
    const p1 = (pc.ties.length > 1
      ? `이 박스의 가치를 끌고 가는 카드는 <strong>${pc.ties.map((c) => esc(c.name)).join(" · ")}</strong>로, ${pcLbl}가 모두 약 <strong>${won(pcKrw)}</strong>${pcWhen}으로 같습니다.`
      : `이 박스의 가치를 끌고 가는 카드는 <strong>${esc(t0.name)}</strong>(${esc(t0.number)})로, ${pcLbl}가 약 <strong>${won(pcKrw)}</strong>${pcWhen}입니다.`) + ` 추적 중인 상위 카드 구성은 ${compTxt} — 어떤 유형이 몇 장인지가 박스 기대값의 골격입니다.`;
    const sold = t0.psa10Ebay && t0.psa10Ebay.soldBased && t0.psa10Ebay.middle != null ? t0.psa10Ebay : null;
    const soldKrw = psa10Krw(sold);
    const nmKrw = t0.nmJpy != null && fx.jpyKrw ? t0.nmJpy * fx.jpyKrw : null;
    // PSA 10 관측일·배수 — 2026-10-15(4차). 영문 페이지처럼 관측일·표본을 같이 적고("(2026-07-09, 표본 10건)"), NM 원본 대비 배수는
    // 카드 상세의 PSA-원본 비교와 같은 신선도 규칙(관측일이 데이터일 기준 35일 이내)일 때만 낸다. 종전엔 10-11 NM 을 07-09 PSA 표본으로 나눠
    // ko/eb-02 "약 1.4배"(영문 기준 1.23배)·ko/op-03 "약 1.7배"(카드 상세는 "107일 묵은 표본은 현재 차이가 아님")가 나갔다.
    const soldAge = sold && /^\d{4}-\d{2}-\d{2}$/.test(sold.updated || "") && DATA_DATE ? (Date.parse(DATA_DATE) - Date.parse(sold.updated)) / 864e5 : null;
    const soldFresh = soldAge != null && soldAge <= 35;
    const mult = soldKrw != null && nmKrw && soldFresh ? soldKrw / nmKrw : null;
    const cardParas = [p1];
    if (soldKrw != null) {
      const soldWhen = [sold.updated, `표본 ${sold.sampleSize}건`].filter(Boolean).join(", ");
      cardParas.push(`${esc(t0.name)}의 <strong>PSA 10 실거래 중앙값은 ${won(soldKrw)}</strong>(${esc(soldWhen)})${mult != null ? `이며, NM 원본 대비 약 ${mult.toFixed(1)}배입니다` : "입니다"}.`);
    }
    // PSA 10 표본이 없을 때의 방어 문장("…추정하지 않고 NM 값만 표시합니다")은 뺐다 — 2026-10-15(3차). TCG 값 카드엔 틀린 말이기도 했다.
    // 표본은 있는데 통화가 안 적힌 값이면 문장을 아예 싣지 않는다.
    prose.push({ h: "인기 카드가 말해주는 것", p: cardParas });
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
      // 분리값이 없는 관측이면 만점 수를 말하지 않는다 — 2026-09-30. 없는 값을 0 으로 적어,
      // 분리값이 원장에 안 쌓이던 8/14 이후 22개 세트 페이지가 전부 "프리스틴 10 0장과 젬 민트 10 0장"이었다.
      const split = e.pristine10 != null && e.gemMint10 != null
        ? `으로, 프리스틴 10 ${e.pristine10.toLocaleString("ko-KR")}장과 젬 민트 10 ${e.gemMint10.toLocaleString("ko-KR")}장` : "";
      if (e.total) g.push(`${esc(nKo)}의 CGC ${ed} 표본은 ${e.total.toLocaleString("ko-KR")}장${split}입니다.`);
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

  // 팩트 리스트 — 검증된 값만.
  // 2026-10-14(W5a): 현재 시세·발매 정가·영문판 발매일은 H1 아래 Key facts 표로 옮겼다(영문 페이지와 같은 함수·같은 값).
  // 종전 "현재 박스 시세 (기준일 데이터 갱신일)" 은 관측일이 아니라 갱신일을 적어, 7/7 값(OP-02)이 10/13 값처럼 나갔다.
  const facts = [];
  if (chg != null) facts.push(`${esc(b.changeBasis || "추적 시작일")} 대비 <strong>${pct(chg)}</strong> — 발매일 대비가 아님`);
  // 재판 기록 줄 = 날짜 · 유형 라벨(2026-10-15, 4차) — 再販 추첨(OP-09)은 "유통사·리테일러 재입고 기준"이 아니라서 꼬리 대신 기록마다 유형을 단다.
  facts.push(rr.length ? `재판 기록 <strong>${rr.length}회</strong> (${rr.map(restockLabel).map(esc).join(", ")})` : `<strong>재판 기록 없음</strong>`);   // 뜻풀이 꼬리(" — 확인된 재입고 기록이 없다는 뜻")는 뺐다 — 라벨·값만(2026-10-15, 3차)
  if (draws) facts.push(`${esc(draws)} — 재판 아님`);
  if (s.psaTotal != null) facts.push(`PSA 누적 감정 <strong>${Number(s.psaTotal).toLocaleString("ko-KR")}장</strong>${s.psaGem != null ? ` · PSA10 비율 <strong>${s.psaGem}%</strong>` : ""}`);

  // Key facts 표와 같은 모델(상단 표).
  const kf = keyFactsModel(code, "jp");
  // 시세 문답의 날짜 = 그 중앙값의 날짜(b.nowDate — Key facts 기준일·설명문과 같은 값). 2026-10-15 QA: 데이터 갱신일(DATA_DATE)을 적어
  // 09-23 값(OP-06)이 "2026-10-14 기준"으로 FAQPage 에 나갔고, 값이 없는 세트(OP-02·OP-04·EB-01)는 "추적가는 약 —이며"가 됐다.
  const priceQ = `${code} ${nKo} 박스 시세는 지금 얼마인가요?`;
  // 현재 값이 없으면 문답을 싣지 않는다 — 값이 없다는 사유 문장("…현재 시세를 표시하지 않습니다")은 2026-10-15(4차)에 뺐다. Key facts 표의 "—" 가 그 사실이다.
  const priceFaq = krw != null
    ? { q: priceQ, a: `${b.nowDate} 기준 ${code} ${nKo} 일본판 부스터박스 판매 중앙값은 약 ${won(krw)}이며, 판매처와 밀봉 상태에 따라 실제 총구매가는 달라질 수 있습니다.` }
    : null;
  // 변동률 문답 = 팩트 줄("기준일 대비 — 발매일 대비가 아님")·허브 범례("28일 전 중앙값 대비")와 같은 정의.
  // 2026-10-15 QA: launchTracked 분기가 4주 비교 기준일(changeBasis)을 "발매 시점(2026-09-15)"으로 적어, OP-17(발매 08-22)·OP-16(05-30)
  // 페이지 안에서 발매일이 둘이 됐다. 비교 기준일은 발매와 무관하므로 분기를 없앴다. 간격은 날짜에서 계산한다(지금은 늘 28일).
  // 2026-10-15: 문장 주어를 "변동률" 하나로 — 종전 "…변동률을 표시하며, 발매일 대비가 아닙니다" 는 뒷절 주어가 바뀌었다.
  // 기준일(changeBasis)이나 값 날짜(nowDate)가 없으면 "그 N일 전 중앙값(…)" 절을 빼고 말한다 — "NaN일"·"undefined" 가 나갈 길을 막는다.
  const isDay = (x) => /^\d{4}-\d{2}-\d{2}$/.test(x || "");
  const gapDays = chg != null && isDay(b.nowDate) && isDay(b.changeBasis) ? Math.round((Date.parse(b.nowDate) - Date.parse(b.changeBasis)) / 864e5) : null;
  // 변동률이 없으면 문답을 싣지 않는다. "발매일 대비가 아닙니다" 꼬리·"…변동률을 표시하지 않습니다" 사유 문장은 뺐다(2026-10-15, 4차) — 정의 문장 하나만.
  const chgA = chg == null ? null
    : gapDays != null
      ? `변동률(${pct(chg)})은 ${b.nowDate} 판매 중앙값을 ${gapDays}일 전(${b.changeBasis}) 중앙값과 비교한 값입니다.`
      : `변동률(${pct(chg)})은 판매 중앙값을 이전 판매 중앙값과 비교한 값입니다.`;
  // 재판 문답 — 재판 횟수(재입고 + 再販 추첨)만 답한다. 再販 표기 없는 추첨을 왜 빼는지 설명하던 꼬리("…반다이가 재판이라 부르지 않아 재판 횟수에 포함하지 않습니다")는 뺐다(2026-10-15, 4차).
  const setFaqs = [
    priceFaq,
    { q: `${code} ${nKo} 재판 기록이 있나요?`, a: rr.length ? `${topic(nKo)} ${storeOnly(rr) ? "유통사·리테일러 재입고 기준 " : ""}재판 ${rr.length}회가 확인됐습니다(${rr.map(restockLabel).join(", ")}).${storeOnly(rr) ? " 반다이 공식 발표가 아닌 유통 기록입니다." : ""}` : `${topic(nKo)} 현재 확인된 유통 재입고 기록이 없습니다.` },
    chgA ? { q: `${code} ${nKo} 변동률은 어느 시점 대비인가요?`, a: chgA } : null,
  ].filter(Boolean);
  const setFaqLd = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: setFaqs.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) });
  const crumbLd = JSON.stringify({ "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
    { "@type": "ListItem", position: 1, name: "OP Box Index", item: `${SITE}/` },
    { "@type": "ListItem", position: 2, name: "한국어 시세", item: `${SITE}/ko/` },
    { "@type": "ListItem", position: 3, name: `${code} ${nKo}`, item: canonical },
  ] });

  // 네이버 간단체크: 제목 40자·설명 80자 초과는 사이트 카드에서 잘린다(2026-09-16).
  // 세트명 길이가 제각각이라(EB-02·PRB 는 14자) 넘치면 브랜드를 떼서 맞춘다 — 자르는 것보다 낫다.
  // 최신 세트(영문 생성기와 같은 규칙 — set-page-shared.latestSets)는 발매일·카드 리스트를 제목·H1 에 넣는다(2026-10-14, W5a).
  const rel = LATEST_KO.has(code);
  const titleCands = rel
    ? [`${code} ${nKo} 박스 시세·발매일`, `${code} 박스 시세·발매일 | opboxindex`, `${code} 박스 시세·발매일`]
    : [`${code} ${nKo} 일판 박스 시세 | opboxindex`, `${code} ${nKo} 일판 박스 시세`];
  const title = titleCands.find((x) => x.length <= 40) || titleCands[titleCands.length - 1];
  // 값은 board(= box-sold-series current.jp)일 때만, 날짜는 그 중앙값의 날짜(b.nowDate). 없으면 값을 빼고 쓴다 — 2026-10-14 QA:
  // 07-07 값(OP-02)을 "(2026-10-13 기준)" 으로 적어 같은 페이지 Key facts(기준일 07-07)와 날짜가 엇갈렸다.
  const descCands = krw != null
    ? [`${code} ${nKo} 일판 부스터박스 시세 ${won(krw)} (${b.nowDate} 기준). 재판 기록·인기 카드 NM 시세, 매일 갱신.`, `${code} ${nKo} 일판 부스터박스 시세 ${won(krw)} (${b.nowDate} 기준). 매일 갱신.`]
    : [`${code} ${nKo} 일판 부스터박스 시세·재판 기록·인기 카드 NM 시세. 매일 갱신.`, `${code} ${nKo} 일판 부스터박스 시세·재판 기록. 매일 갱신.`];
  const desc = descCands.find((x) => x.length <= 80) || descCands[descCands.length - 1];

  return { slug, html: `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <!-- No AdSense on noindex Korean set detail pages. -->
    <!-- Korean set details remain noindex and ad-free through the AdSense review window.
         Reconsider indexing separately after the review; the Korean hub remains indexed. -->
    ${detailRobotsMeta()}
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="ko" href="${canonical}" />
    ${enHref ? `<link rel="alternate" hreflang="en" href="${SITE}/sets/${slug}.html" />\n    <link rel="alternate" hreflang="x-default" href="${SITE}/sets/${slug}.html" />` : ""}
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
    ${/* 수정일 = 영문·일본판 세트 페이지와 같은 함수(setPageDate) — 2026-10-15 감사(#4): DATA_DATE(10-14)라 같은 세트의 영문판(10-15)과 하루 어긋났다 */ ""}
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "WebPage", name: title, url: canonical, inLanguage: "ko", dateModified: setPageDate(code) })}</script>
    <link rel="stylesheet" href="../styles.css?v=${CACHE}" />
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .ixHero { display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin: 6px 0 2px; }
      .ixHero .big { font-size: 40px; font-weight: 800; font-variant-numeric: tabular-nums; letter-spacing: -1px; }
      .ixChg { font-size: 14px; font-weight: 800; padding: 3px 11px; border-radius: 8px; }
      .up { color: var(--accent); } .down { color: var(--red); }
      .ixChg.up { background: rgba(var(--accent-rgb), .12); } .ixChg.down { background: rgba(255,125,125,.12); }
      .koBoard { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 14px; margin: 10px 0; }
      .koBoard th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11.5px; }
      .koBoard th.l, .koBoard td.nm, .koBoard td.code { text-align: left; }
      .koBoard td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      @media (max-width: 640px) { .koBoard th, .koBoard td { padding: 8px 6px; } }   /* 390px 에서 표가 2px 넘쳐 가로 스크롤됐다(2026-10-13 QA) */
      .koBoard td.num { text-align: right; white-space: nowrap; }
      .koBoard td.code { color: #9aa4b6; font-size: 12.5px; }
      .koBoard td.thumb { width: 52px; padding: 6px 8px; }
      .koBoard td.thumb img { width: 40px; height: 56px; object-fit: cover; border-radius: 4px; display: block; background: #12161d; }
      .koFacts { margin: 14px 0; padding: 12px 16px; border: 1px solid rgba(var(--accent-rgb), .28); background: rgba(var(--accent-rgb), .05); border-radius: 12px; max-width: 760px; font-size: 14px; line-height: 1.8; }
      .koFacts strong { color: var(--accent); }
      .koNote { color: var(--muted); font-size: 12.5px; max-width: 760px; margin: 8px 0 14px; line-height: 1.6; }
      .faqItem { max-width: 760px; border-bottom: 1px solid rgba(255,255,255,.08); padding: 4px 0; }
      .faqItem summary { cursor: pointer; font-weight: 700; padding: 8px 0; font-size: 14.5px; }
      .faqItem p { color: #9aa4b6; font-size: 13.5px; line-height: 1.65; margin: 4px 0 10px; }
      .koCta { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .koCta a { display: inline-block; padding: 11px 18px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .koCta .primary { background: var(--accent); color: #08131a; }
      .koCta .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
${KF_CSS}
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">본문으로 건너뛰기</a>
    <header class="topbar">
      <a class="brand" href="../"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>부스터박스 리서치</small></span></a>
      ${NAV_KO}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow"><a href="./" style="color:var(--muted);text-decoration:none">한국어 시세</a> · 일본판</p>
      <h1>${esc(code)} ${esc(nKo)} 부스터박스 시세${rel ? " · 발매일" : ""} (일본판)</h1>
      ${keyFactsHtml(kf, { lang: "ko", usdKrw: fx.usdKrw })}
      <div class="ixHero">
        <span class="big">${won(krw)}</span>
        ${chg != null ? `<span class="ixChg ${up ? "up" : "down"}">${pct(chg)}</span>` : ""}
      </div>
      <ul class="koFacts">${facts.map((f) => `<li>${f}</li>`).join("")}</ul>
${proseHtml}
${cardsSection}
      ${koAuctionSection}
      <div class="koCta">
        <a class="primary" href="./">전 세트 시세표 →</a>
        ${enHref ? `<a class="ghost" href="${enHref}">영문 상세(차트·PSA) →</a>` : ""}
        ${CARD_LIST.has(code) ? `<a class="ghost" href="${slug}-card-list.html">카드 리스트 ${CARD_LIST.productOf(code).counts.cards}장 →</a>` : ""}
        <a class="ghost" href="amazon-lottery.html">아마존 응모 안내 →</a>
      </div>
      <section aria-label="자주 묻는 질문">
        <h2>${esc(code)} 자주 묻는 질문</h2>
        ${setFaqs.map((f) => `<details class="faqItem"><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("\n")}
      </section>
      <p class="koNote">${esc(code)} ${esc(nKo)} 데이터 기준: 검증된 이베이 시장 관측, PSA 인구 리포트, 반다이 발매 정보 · 환율 ₩${fx.usdKrw}/$ (${esc(fx.date)}) · 갱신 ${esc(setPageDate(code))}.</p>
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
  // 심사 게이트 상태에 따라 상세 URL 을 빼거나 되돌린다(tools/sitemap-detail-urls.js).
  const { removed, added } = syncDetailUrls(smPath, written.map((rel) => SITE + "/" + rel));
  // 이미 등재된 URL 은 빼지도 더하지도 않고 lastmod 만 올린다(upsert). 종전엔 읽어서 그대로 다시 쓰기만 했다.
  const today = new Date().toISOString().slice(0, 10);
  const managed = new Set([`${SITE}/ko/`, ...written.map((rel) => SITE + "/" + rel)]);
  let sm = fs.readFileSync(smPath, "utf8");
  let touched = 0;
  sm = sm.replace(/[ \t]*<url>[\s\S]*?<\/url>/g, (block) => {
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    if (!loc || !managed.has(loc)) return block;
    const eol = block.includes("\r\n") ? "\r\n" : "\n";
    const next = /<lastmod>[^<]*<\/lastmod>/.test(block)
      ? block.replace(/<lastmod>[^<]*<\/lastmod>/, `<lastmod>${today}</lastmod>`)
      : block.replace(/(<loc>[^<]*<\/loc>)/, `$1${eol}    <lastmod>${today}</lastmod>`);
    if (next !== block) touched++;
    return next;
  });
  fs.writeFileSync(smPath, sm, "utf8");
  console.log(JSON.stringify({ wrote: "ko/index.html", setPages: written.length, sitemapRemoved: removed, sitemapAdded: added, sitemapLastmod: touched }));
}
