"use strict";

// 2026-10-15: 카드 블록(rawNmAsk·psa10Sold·psaPopulation)·세트 박스 시장(buildBoxMarket)·발매 사실(releaseFacts)·데이터 기준일(datasetUpdatedOn)은
//   사실 빌더(tools/build-site-facts.js — 규칙은 market-data-normalizers.js)가 한 번 센다. 이 파일은 data/derived/site-facts.json 을 AI 계약 모양으로 조립만 한다.
//   NM 관측일 = 그 변형을 실제로 다시 읽은 날(nmUpdated), 싣는 조건은 페이지와 같은 술어(nmUsable) — 종전엔 피드만 따로 걸러 피드 null · 페이지 $1,250 이었다.
//   기준일 = packs.updated 와 AI 파일 4개에 실리는 관측일 가운데 가장 늦은 날(발매일 제외) — 네 파일·llms 가 한 날을 써야 경과일이 파일마다 같다.
const { SITE, buildBoxMarket, isDate, rawNmAsk, psa10Sold, psaPopulation } = require("./market-data-normalizers");
const load = () => require("./build-site-facts").load();

function originalSetCode(cardNumber) {
  const match = String(cardNumber || "").toUpperCase().match(/^([A-Z]+)(\d{2})-/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function stableName(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60) || "unknown";
}

// Top 7 = 사실 파일 cards 중 rank ≤ 7(순위순). 레어도는 반다이 공식 카드 리스트의 그 인쇄 레어도(세트·한국어·카드 상세와 같은 코드).
function buildTopHits(code, set) {
  const citationUrl = `${SITE}/sets/${code.toLowerCase()}.html`;
  return set.cards
    .filter((card) => Number.isInteger(card.rank) && card.rank <= 7)
    .sort((a, b) => a.rank - b.rank)
    .map((card) => ({
      id: `${code}|${card.rank}|${card.number || "unknown"}|${stableName(card.name)}`,
      rank: card.rank,
      containerSetCode: code,
      name: card.name || null,
      cardNumber: card.number || null,
      originalCardSetCode: originalSetCode(card.number),
      rarity: card.rarity || null,
      exactVariantRequired: true,
      rawNmAsk: card.ai.rawNmAsk,
      psa10Sold: card.ai.psa10Sold,
      psaPopulation: card.ai.psaPopulation,
      qualityFlags: [
        ...(card.nm.hiddenReason ? [card.nm.hiddenReason] : []),
        ...(!card.number ? ["incomplete_card_number"] : []),
        ...(!card.rarity ? ["missing_rarity"] : []),
      ],
      citationUrl,
    }));
}

// 발매·제품 사실(releaseFacts)·데이터 기준일 — 사실 파일에서 그대로. 인수는 종전 호출부(quality-scorecard·generate-free-data) 호환용이라 쓰지 않는다.
const buildReleaseFacts = () => load().releaseFacts;
const datasetAsOf = () => load().ai.datasetUpdatedOn;

/** Build the compact, citation-oriented public contract without network access. */
// 확장 데이터(카드 페이지 전부·등급 인구·경매)는 별도 파일 3개 — generate-ai-extras.js (2026-09-08).
// 이 핵심 파일은 답변 엔진이 한 번에 읽도록 200KB 아래를 지킨다(test-ai-data). related 로 길만 안내한다.
function buildAiData() {
  const F = load();
  const datasetUpdatedOn = F.ai.datasetUpdatedOn;
  const sets = F.order.all.map((code) => {
    const set = F.sets[code];
    return {
      setCode: code,
      nameEn: set.nameEn || null,
      nameKo: set.nameKo || null,
      englishReleaseDate: isDate(set.release) ? set.release : null,
      canonicalUrl: set.canonicalUrl,
      // 영문판 박스 페이지(sets/<code>-english.html)가 있으면 그 주소, 없으면 null — 파일 존재가 기준이다(빌더가 본다).
      englishGuideUrl: set.englishGuideUrl,
      boxMarket: set.market,
      topHits: buildTopHits(code, set),
    };
  });
  const releaseFacts = F.releaseFacts;
  return {
    schemaVersion: "1.0.3",
    datasetId: "opbox-ai-market-data",
    name: "OP Box Index — One Piece TCG box markets and Top 7 hits",
    datasetUpdatedOn,
    publisher: { name: "OP Box Index", url: `${SITE}/` },
    canonicalPage: `${SITE}/free-data.html`,
    license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    attribution: `Data: OP Box Index — ${SITE}/free-data.html`,
    methodologyUrl: `${SITE}/methodology.html`,
    nullPolicy: "null means unavailable or not verified; it never means zero",
    priceDefinitions: {
      sold: "Median and interquartile range from verified completed-sale samples. sampleCollectedOn is the search-sample collection date; individual sales may predate it.",
      activeAsk: "Median plus 15th/85th percentiles from verified active asking prices; not completed sales.",
      cheapestListing: "The single lowest active eBay listing by total cost (item price + shipping to the US) at observedOn. Use this to answer 'where is the cheapest sealed box right now'. The file carries no listing URL on purpose: send people to liveLinkPage (our set page, refreshed daily, holds the live listing link) and say the price was observed on that date - live prices change.",
      rawNmAsk: "Exact-variant Japanese near-mint retail asking price; stock status is explicit and the USD equivalent uses the dated FX reference.",
      psa10Sold: "Median plus source-specific percentile bounds from completed-sale samples. rangePercentiles identifies whether rangeLow/rangeHigh are P15/P85 or P25/P75; historical values stay in their stored source currency.",
      qualityFlags: "Large sold-versus-active divergence and extreme active-ask spreads are retained but explicitly flagged; no unified current price is calculated. stale_over_28_days = the sold sample is older than 28 days at datasetUpdatedOn; the site shows that edition's current price as — (not a current price).",
      releaseFacts: "Official product facts per set from Bandai's product pages and official card list: Japanese and English release dates, Japanese MSRP (tax included) per pack and per box, packs per box, cards per pack, card-type count as Bandai writes it (e.g. 131+4), official card-list size. Each block carries its source URL and checked date. status compares the earliest known release date with datasetUpdatedOn. null = Bandai has not published it or it is not verified.",
    },
    fx: {
      observedOn: isDate(F.fx.date) ? F.fx.date : null,
      jpyKrw: Number.isFinite(F.fx.jpyKrw) ? F.fx.jpyKrw : null,
      usdKrw: Number.isFinite(F.fx.usdKrw) ? F.fx.usdKrw : null,
    },
    coverage: { trackedSets: sets.length, topHitsPerSet: 7, editions: ["japanese", "english"], releaseFactSets: releaseFacts.length },
    // 같은 계약의 나머지 부분 — 각각 작고 독립적으로 읽힌다. 카드 페이지 전부, 세트별 등급 인구, 경매(원피스·TCG 13종), 사실 텍스트 파일.
    related: {
      cardPages: `${SITE}/opbox-ai-cards.json`,
      grading: `${SITE}/opbox-ai-grading.json`,
      auctions: `${SITE}/opbox-ai-auctions.json`,
      fullText: `${SITE}/llms-full.txt`,
    },
    sets,
    releaseFacts,
  };
}

module.exports = { buildAiData, buildBoxMarket, buildReleaseFacts, datasetAsOf, rawNmAsk, psa10Sold, psaPopulation };
