// 무료 데이터셋 생성 — /free-data.html + CSV 3종
// 목적: 피인용(백링크)으로 도메인 신뢰도를 올리는 자산. 색인 병목의 실제 원인이 외부링크 부족이라 이걸 겨냥.
//
// 2026-07-29 개편: 박스 시세 21줄만 내주던 걸 바꿨다. 그 표는 홈에도 그대로 있어서
// 굳이 받을 이유가 없었고(소유자 지적), 정가 대비 배수·재판 횟수는 각각 쓸모없다고 판단되었거나
// 세트 페이지로 옮겨갔다. 대신 우리만 가진 두 가지를 낸다:
//   ① 등급 인구 — PSA/CGC/TAG 3사를 세트별·판별로 쪼갠 것. 이렇게 나눠 내는 곳이 없다.
//   ② 경매 실거래 — 일별 낙찰가 중앙값·낙찰률·입찰경쟁. eBay 도 무료로는 안 준다.
//
// ⚠️ 원시 리스팅 덤프 금지 — "파생 집계"만 낸다. 외부 소스명 표기 금지(가드 S1).
// ⚠️ 판별·등급사 합산 금지. 합치면 젬률도 낙찰률도 아무것도 설명하지 못하는 값이 된다.
// Run: node tools/generate-free-data.js
const fs = require("fs");
const { navHtml } = require("./site-nav");
const path = require("path");
const {
  AUCTION_HEAD, BOX_HEAD, GRADE_HEAD,
  buildAuctionRecords, buildBoxRecords, buildGradeRecords,
} = require("./free-data-records");
const { buildAiData } = require("./ai-data-model");
const ROOT = path.join(__dirname, "..");
const SITE = "https://opboxindex.com";
const CACHE = (require("fs").readFileSync(require("path").join(__dirname, "..", "packs.js"), "utf8").match(/DATA_VERSION = "([^"]+)"/) || [])[1] || "dev";  // 하드코딩 금지 — 범프 때 가드 V1 이 배포를 막는다(2026-07-27)

const d = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const fx = d.fx || {};
const DATA_DATE = d.updated || "";
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// CSV 셀: 쉼표/따옴표/개행 있으면 인용부호 처리
const cell = (v) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const maxDate = (dates) => dates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")).sort().at(-1) || "";
const temporalCoverage = (dates) => {
  const valid = dates.filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value || "")).sort();
  return valid.length ? `${valid[0]}/${valid.at(-1)}` : null;
};

const writeCsv = (name, head, records) => {
  const lines = records.map((record) => head.map((key) => cell(record[key])).join(","));
  fs.writeFileSync(path.join(ROOT, name), [head.join(","), ...lines].join("\n") + "\n", "utf8");
  return lines.length;
};

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", p), "utf8")); } catch { return null; } };
const { records: priceRecords, dates: priceDates } = buildBoxRecords(d);
const { records: gradeRecords, dates: gradeDates } = buildGradeRecords(d, readJson("cgc-grading-history.json"), readJson("tag-grading-history.json"));
const { records: auctionRecords, dates: auctionDates } = buildAuctionRecords(readJson("auction-sold.json"), readJson("auction-series.json"));
const aiData = buildAiData(d);
const aiDates = [];
for (const set of aiData.sets) {
  for (const market of Object.values(set.boxMarket)) aiDates.push(market.sold?.sampleCollectedOn, market.activeAsk?.observedOn);
  for (const hit of set.topHits) aiDates.push(hit.rawNmAsk?.observedOn, hit.psa10Sold?.sampleCollectedOn, hit.psaPopulation?.observedOn);
}
const nPrices = writeCsv("opbox-set-prices.csv", BOX_HEAD, priceRecords);
const nGrades = writeCsv("opbox-grading-population.csv", GRADE_HEAD, gradeRecords);
const nAuctions = writeCsv("opbox-auction-daily.csv", AUCTION_HEAD, auctionRecords);

// ---- 랜딩 페이지
// 미리보기 — 등급 인구를 앞세운다. 이게 이 페이지에서 유일하게 다른 데 없는 표다.
const gradePreview = gradeRecords.slice(0, 8).map((record) => {
  const td = (v) => `<td class="num">${v === "" ? "—" : esc(v)}</td>`;
  return `<tr><td>${esc(record.set_code)}</td><td>${record.edition === "japanese" ? "Japanese" : "English"}</td>${td(record.psa_total)}${td(record.psa10_rate_pct === "" ? "" : record.psa10_rate_pct + "%")}${td(record.cgc_total)}${td(record.cgc_pristine10)}${td(record.tag_total)}</tr>`;
}).join("\n");

const publisher = { "@type": "Organization", name: "OP Box Index", url: `${SITE}/` };
const dataset = ({ id, name, description, modified, dates, variables, format, contentUrl }) => ({
  "@type": "Dataset", "@id": `${SITE}/free-data.html#${id}`, name, description,
  url: `${SITE}/free-data.html#${id}`,
  license: "https://creativecommons.org/licenses/by/4.0/",
  isAccessibleForFree: true,
  dateModified: modified,
  ...(temporalCoverage(dates) ? { temporalCoverage: temporalCoverage(dates) } : {}),
  creator: publisher,
  variableMeasured: variables,
  distribution: { "@type": "DataDownload", encodingFormat: format, contentUrl },
});
const datasets = [
  dataset({ id: "ai-json", name: "One Piece TCG box markets and Top 7 hits", description: `Compact AI-ready JSON for ${nPrices} tracked sets, with completed sales and active asking prices separated and field-level freshness and sample sizes.`, modified: DATA_DATE, dates: aiDates, variables: ["setCode", "boxMarket", "topHits", "rawNmAsk", "psa10Sold", "psaPopulation", "citationUrl"], format: "application/json", contentUrl: `${SITE}/opbox-ai-data.json` }),
  dataset({ id: "grading-csv", name: "Grading population by set, printing and grader", description: `${nGrades} set-edition rows. PSA, CGC and TAG counts remain separate and each grader keeps its own observation date.`, modified: maxDate(gradeDates) || DATA_DATE, dates: gradeDates, variables: GRADE_HEAD, format: "text/csv", contentUrl: `${SITE}/opbox-grading-population.csv` }),
  dataset({ id: "auction-csv", name: "Completed auction results by day", description: "Settled auction counts, sold counts, sell-through, median winning bids and bid counts by product type.", modified: maxDate(auctionDates) || DATA_DATE, dates: auctionDates, variables: AUCTION_HEAD, format: "text/csv", contentUrl: `${SITE}/opbox-auction-daily.csv` }),
  dataset({ id: "box-csv", name: "Japanese and English booster box market snapshots", description: `${nPrices} sets with completed-sale medians and active asking-price medians kept separate, including sample sizes and observation dates.`, modified: maxDate(priceDates) || DATA_DATE, dates: priceDates, variables: BOX_HEAD, format: "text/csv", contentUrl: `${SITE}/opbox-set-prices.csv` }),
];
const datasetLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    { "@type": "DataCatalog", "@id": `${SITE}/free-data.html#catalog`, name: "OP Box Index free One Piece TCG datasets", description: "Citable box-market, Top 7 card, grading-population and completed-auction aggregates.", url: `${SITE}/free-data.html`, dateModified: DATA_DATE, publisher, dataset: datasets.map((item) => ({ "@id": item["@id"] })) },
    ...datasets,
  ],
});

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <script async src="https://www.googletagmanager.com/gtag/js?id=G-P73SE1WVD0"></script>
    <script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-P73SE1WVD0');</script>
    <script defer src="/track.js"></script>
    <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=ca-pub-1520891018658006" crossorigin="anonymous"></script>
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1" />
    <link rel="canonical" href="${SITE}/free-data.html" />
    <link rel="icon" href="favicon.svg" type="image/svg+xml" />
    <title>Free One Piece TCG Data — Box Prices, Top 7 Cards &amp; Grading | OP Box Index</title>
    <meta name="description" content="Free CC BY 4.0 One Piece TCG data in JSON and CSV: Japanese and English box sold prices versus active asks, Top 7 chase cards, grading population and completed auctions, with sample sizes and observation dates." />
    <meta property="og:site_name" content="OP Box Index" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Free One Piece TCG Data — Box Prices, Top 7 Cards &amp; Grading" />
    <meta property="og:description" content="AI-ready JSON plus CSV downloads with explicit sold/ask labels, samples and observation dates. Free under CC BY 4.0." />
    <meta property="og:url" content="${SITE}/free-data.html" />
    <meta property="og:image" content="${SITE}/og/og-set-list.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${datasetLd}</script>
    <link rel="stylesheet" href="styles.css?v=${CACHE}" />
    <script defer src="lang-toggle.js?v=${CACHE}"></script>
    <meta name="theme-color" content="#0a0c10" />
    <style>
      .dlRow { display: flex; gap: 10px; flex-wrap: wrap; margin: 16px 0; }
      .dlRow a { display: inline-block; padding: 12px 20px; border-radius: 10px; font-weight: 700; text-decoration: none; font-size: 14px; }
      .dlRow .primary { background: #50dad9; color: #08131a; }
      .dlRow .ghost { border: 1px solid #2a3140; color: #cfd6e4; }
      .dTable { width: 100%; max-width: 760px; border-collapse: collapse; font-size: 13.5px; margin: 10px 0; }
      .dTable th { text-align: right; padding: 8px 10px; border-bottom: 1px solid #2a3140; color: #9aa4b6; font-size: 11px; text-transform: uppercase; }
      .dTable th:nth-child(1), .dTable th:nth-child(2) { text-align: left; }
      .dTable td { padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,.05); font-variant-numeric: tabular-nums; }
      .dTable td.num { text-align: right; }
      .fields { font-size: 13.5px; color: #9aa4b6; line-height: 1.9; max-width: 760px; }
      .fields code { color: #50dad9; background: rgba(80,218,217,.08); padding: 1px 6px; border-radius: 5px; }
      .attrBox { margin: 16px 0; padding: 12px 16px; border: 1px solid rgba(80,218,217,.28); background: rgba(80,218,217,.05); border-radius: 12px; max-width: 760px; font-size: 13.5px; line-height: 1.7; }
      .attrBox code { display: block; margin-top: 6px; color: #cfd6e4; background: rgba(255,255,255,.04); padding: 8px 10px; border-radius: 8px; font-size: 12.5px; }
    </style>
  </head>
  <body>
    <a class="skipLink" href="#main-content">Skip to main content</a>
    <header class="topbar">
      <a class="brand" href="./"><span class="brandMark">OP</span><span><strong>OP Box Index</strong><small>Booster box research</small></span></a>
      ${navHtml("")}
    </header>
    <main id="main-content" class="bodyPage">
      <p class="eyebrow" data-ko="무료 데이터">Free data</p>
      <h1 data-ko="원피스 TCG 무료 데이터 — 박스 시장·상위 7개 카드·그레이딩">Free One Piece TCG data — box markets, Top 7 cards and grading</h1>
      <p data-ko-html="간결한 JSON 피드 하나와 CSV 세 개를 CC BY 4.0으로 무료 공개합니다. <strong>일본판·영문판 박스 시장</strong>, <strong>세트별 상위 7개 체이스 카드</strong>, <strong>감정사·인쇄본별 그레이딩 인구</strong>, <strong>종료된 경매 결과</strong>를 담습니다. 실거래가와 진행 중 호가는 언제나 따로 둡니다.">One compact JSON feed and three CSVs, free under CC BY 4.0. They cover <strong>Japanese and English box markets</strong>, <strong>each set's Top 7 chase cards</strong>, <strong>grading population split by grader and printing</strong>, and <strong>completed auction outcomes</strong>. Completed sales and active asking prices are always separate.</p>

      <div class="dlRow">
        <a class="primary" href="opbox-ai-data.json" download>AI-ready market data (JSON)</a>
        <a class="primary" href="opbox-grading-population.csv" download>Grading population (${nGrades} rows)</a>
        <a class="primary" href="opbox-auction-daily.csv" download>Auction results by day (${nAuctions} rows)</a>
        <a class="ghost" href="opbox-set-prices.csv" download>Box market snapshots (${nPrices} sets)</a>
      </div>
      <p class="note">Page regenerated ${esc(DATA_DATE)} · every value keeps its own observation date · FX ₩${fx.usdKrw}/$ (${esc(fx.date)})</p>

      <h2 id="ai-json">1. AI-ready box and Top 7 data — <code>opbox-ai-data.json</code></h2>
      <p data-ko-html="답변 엔진과 연구자를 위한 간결한 공개 규격입니다. 추적 중인 상품 ${nPrices}종과 세트별 상위 7개 카드 변형을 담습니다. 모든 세트 레코드는 사람이 읽는 가이드로 되돌아가는 링크를 갖습니다. 박스의 <code>sold</code>는 실거래 표본이고 <code>activeAsk</code>는 아직 판매 중인 매물입니다. 판매자 이름, 매물 ID, 제휴 URL, 마켓플레이스 원본 덤프는 넣지 않습니다.">A compact public contract for answer engines and researchers. It covers ${nPrices} tracked products and the Top 7 exact card variants in each set. Every set record links back to its human-readable guide. Box <code>sold</code> values are completed-sale samples; <code>activeAsk</code> values are listings still for sale. The feed excludes seller names, listing IDs, affiliate URLs and raw marketplace dumps.</p>
      <div class="fields">
        <code>schemaVersion</code> · <code>datasetUpdatedOn</code> · <code>license</code> — stable contract and reuse terms<br />
        <code>boxMarket.japanese</code> · <code>boxMarket.english</code> — completed sales and active asks, never combined<br />
        <code>topHits</code> — rank, exact card number and variant name, raw NM ask, verified PSA 10 sold sample and PSA population where available<br />
        <code>sampleSize</code> · <code>observedOn</code> · <code>ageDaysAtDatasetUpdate</code> — enough context to judge freshness<br />
        <code>citationUrl</code> — the OP Box Index page that explains the product and its data
      </div>

      <h2 id="grading-csv">2. Grading population — <code>opbox-grading-population.csv</code></h2>
      <p data-ko-html="세트별 <em>인쇄본별</em>로 한 행씩입니다. 일본판과 영문판은 인쇄가 다르고 봉입률이 다르므로 따로 기록하며 <strong>절대 합치지 않습니다</strong> — 합친 젬 비율은 어느 쪽도 설명하지 못합니다. 감정사끼리도 같습니다. PSA 10, CGC 프리스틴 10, TAG 10은 서로 다른 기준이라 열을 나란히 두고 절대 더하지 않습니다.">One row per set <em>per printing</em>. Japanese and English are different print runs with different pull rates, so we record them separately and <strong>never add them together</strong> — a combined gem rate describes neither. The same applies across graders: a PSA 10, a CGC Pristine 10 and a TAG 10 are different standards, so the columns sit side by side and are never summed.</p>
      <div class="fields">
        <code>set_code</code> · <code>edition</code> — <code>japanese</code> or <code>english</code><br />
        <code>psa_total</code> · <code>psa10_rate_pct</code> · <code>psa_weekly_add</code> — cumulative PSA count, PSA 10 share, and how many were added in the latest week we recorded<br />
        <code>cgc_total</code> · <code>cgc_pristine10</code> · <code>cgc_gem_mint10</code> — CGC splits its top grade in two; Pristine 10 is the stricter one<br />
        <code>tag_total</code> · <code>tag_10</code> · <code>tag_10p</code> — TAG's 10 and its stricter 10P<br />
        <code>*_as_of</code> — each total, weekly change and grade split keeps its own source date. Blank means unverified, not zero.
      </div>

      <h2 data-ko="미리보기 — 그레이딩 인구">Preview — grading population</h2>
      <div style="overflow-x:auto">
      <table class="dTable">
        <thead><tr><th>Set</th><th>Printing</th><th>PSA</th><th>PSA 10 rate</th><th>CGC</th><th>Pristine 10</th><th>TAG</th></tr></thead>
        <tbody>
${gradePreview}
        </tbody>
      </table>
      </div>

      <h2 id="auction-csv">3. Auction results by day — <code>opbox-auction-daily.csv</code></h2>
      <p data-ko-html="한 행이 하루와 상품 종류 하나입니다. 같은 데이터를 <a href="auction.html">경매 결과 페이지</a>에서 설명과 그래프로 봅니다. 각 경매는 끝난 <em>뒤에</em> 읽으므로 <code>median_price_usd</code>는 진행 중 값이 아니라 최종 낙찰가입니다. 이 차이는 실제로 큽니다 — 막판 스나이핑이 가격을 자주 움직입니다. 유찰로 끝난 경매도 <code>sell_through_pct</code>의 분모로 데이터에 남습니다. 빼버리면 모든 가격이 실제보다 좋아 보입니다.">Every row is one day and one product type. The same data is explained and charted on the <a href="auction.html">auction results page</a>. Each auction is read <em>after</em> it closed, so <code>median_price_usd</code> is the final winning bid, not a mid-auction figure — the difference is real, since sniping regularly moves a price in the last minutes. Auctions that ended unsold stay in the data as the denominator of <code>sell_through_pct</code>; dropping them would flatter every price.</p>
      <div class="fields">
        <code>date</code> · <code>kind</code> — <code>all</code>, <code>box</code>, <code>card</code> or <code>pack</code><br />
        <code>auctions</code> · <code>sold</code> · <code>sell_through_pct</code> — how many ran, how many actually sold<br />
        <code>median_price_usd</code> — median final winning bid, per item for multi-item lots<br />
        <code>median_bids</code> — median bid count, a rough read on competition
      </div>

      <h2 id="box-csv">4. Japanese and English booster box markets — <code>opbox-set-prices.csv</code></h2>
      <p data-ko-html="추적 상품마다 한 행입니다. 일본판과 영문판 인쇄본은 분리합니다. 실거래 중앙값에는 25/75 백분위, 표본 수, 표본 수집일이 함께 들어갑니다. 진행 중 호가 중앙값에는 15/85 백분위, 확인된 매물 수, 관측일이 들어갑니다. 둘을 조용히 섞는 현재가 같은 열은 두지 않습니다.">One row per tracked product. Japanese and English printings are separate. Completed-sale medians include the 25th/75th percentile, sample size and sample-collection date. Active asking-price medians include the 15th/85th percentile, verified listing count and observation date. There is no generic “current price” column that silently mixes the two.</p>

      <h2 data-ko="어떻게 만드는가">How it's built</h2>
      <p data-ko-html="박스 시세는 실거래 또는 확인된 진행 매물의 집계이며, 부스터 박스 한 개 기준으로 환산하고 인쇄본을 표시합니다. 그레이딩 수는 각 감정사의 공개 인구 보고서에서 각자의 주기로 수집해, 다시 쓰지 않는 원장에 덧붙입니다. 경매 수치는 매물이 끝난 뒤에 읽습니다. 파생 집계만 공개하고 매물 원본 덤프는 내보내지 않습니다. 값을 확인할 수 없으면 추정하지 않고 비웁니다.">Box prices are aggregates of completed sales or verified active listings, normalised to one booster box and labelled by printing. Grading counts come from each grader's public population reporting, collected on its own cadence and appended to ledgers we never rewrite. Auction figures are read after listings close. We publish derived aggregates only — never raw listing dumps. Where a value cannot be verified we leave it blank rather than estimate it.</p>

      <div class="attrBox" id="terms">
        <strong>Attribution (CC BY 4.0)</strong> — free to use, including commercially, if you credit the source:
        <code>Data: OP Box Index — https://opboxindex.com/free-data.html</code>
      </div>

      <h2 data-ko="갱신 주기">Update frequency</h2>
      <p data-ko-html="파일은 사이트의 일일 데이터 파이프라인이 다시 만들며 주소는 그대로 유지됩니다. 출처마다 주기가 다릅니다 — 진행 매물과 정산된 경매는 매일 갱신될 수 있고, 실거래 표본과 그레이딩 인구는 그보다 드뭅니다. 파일 생성일이 아니라 각 항목의 관측일을 쓰십시오. 특정 시점의 과거 스냅샷이 필요하면 <a href="about.html">연락 주십시오</a>.">The files are regenerated by the site's daily data pipeline and keep stable URLs. Source cadences differ: active listings and settled auctions can update daily, while completed-sale samples and grading populations update less often. Use each field's own observation date rather than the file-generation date. If you need a specific historical snapshot, <a href="about.html">get in touch</a>.</p>
    </main>
    <footer class="footer">
      <p>OP Box Index is a data-driven research site, not investment advice.</p>
      <nav aria-label="Footer navigation"><a href="sets/index.html">Set Guides</a><a href="psa-grading.html">Grading Population</a><a href="ko/">한국어 시세</a><a href="about.html">About</a><a href="methodology.html">Methodology</a><a href="privacy.html">Privacy</a><a href="disclaimer.html">Disclaimer</a></nav>
    </footer>
  </body>
</html>
`;
fs.writeFileSync(path.join(ROOT, "free-data.html"), html, "utf8");

// 사이트맵 idempotent 등재
{
  const smPath = path.join(ROOT, "sitemap.xml");
  let sm = fs.readFileSync(smPath, "utf8");
  const loc = `${SITE}/free-data.html`;
  let added = 0;
  if (!sm.includes(`<loc>${loc}</loc>`)) {
    sm = sm.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${DATA_DATE}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.9</priority>\n  </url>\n</urlset>`);
    fs.writeFileSync(smPath, sm, "utf8");
    added = 1;
  }
  console.log(JSON.stringify({
    wrote: ["free-data.html", "opbox-grading-population.csv", "opbox-auction-daily.csv", "opbox-set-prices.csv"],
    gradingRows: nGrades, auctionRows: nAuctions, priceRows: nPrices, sitemapAdded: added,
  }));
}
