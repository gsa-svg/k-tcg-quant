"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { SITE, ageDays, buildBoxMarket, isDate, isPositive, nmUsable, stockStatus, toUsd } = require("./market-data-normalizers");
const extras = require("./ai-data-extras");

const ROOT = path.resolve(__dirname, "..");

// NM 관측일 = 그 변형을 실제로 다시 읽은 날(card.nmUpdated — update-yuyutei-nm-prices 가 읽은 날에만 찍는다). 2026-10-15 QA.
// 종전엔 card-series 의 마지막 점을 썼다. 그 이력은 엔화 호가를 원화로 바꿔 쌓아서 환율만 움직여도 점이 생긴다 —
// 10-11 에 읽은 ¥1,280,000 이 피드에선 10-14 관측·경과 0일로 나갔고(카드리스트는 10-11), 09-07 값도 10-14 로 나갔다.
// 읽은 날이 없는 값(매칭 실패로 nmUpdated 가 없는 카드)은 날짜를 지어내지 않고 싣지 않는다(null).
// 싣는 조건은 페이지와 같은 술어 하나(market-data-normalizers.nmUsable) — 2026-10-15. 종전엔 이 함수만 따로 걸러 피드 null · 페이지 $1,250 이었다.
function rawNmAsk(card, fx, datasetUpdatedOn) {
  if (!nmUsable(card)) return null;
  const observedOn = card.nmUpdated;
  return {
    basis: "japanese_retail_asking_price",
    currency: "JPY",
    priceJpy: card.nmJpy,
    usdEquivalent: toUsd(card.nmJpy, "JPY", fx),
    fxObservedOn: isDate(fx.date) ? fx.date : null,
    // 외부 소스명은 공개하지 않는다(소유자 규칙 S1 — "Weekly ungraded market" 식 중립 라벨만). 업체명이 여기로 새어 나갔었다(2026-09-09 감사).
    sourceName: "Japanese retailer",
    stockStatus: stockStatus(card.nmStock),
    observedOn,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, observedOn),
  };
}

function psa10Sold(card, datasetUpdatedOn) {
  const sold = card.psa10Ebay;
  if (!sold?.soldBased || !Number.isInteger(sold.sampleSize) || sold.sampleSize < 3 || !isDate(sold.updated)) return null;
  if (![sold.low, sold.middle, sold.high].every(isPositive) || !(sold.low <= sold.middle && sold.middle <= sold.high)) return null;
  if (!["USD", "KRW", "JPY"].includes(sold.currency)) return null;
  const rangePercentiles = /manual, variant-matched/i.test(sold.source || "")
    ? [25, 75]
    : /completed search/i.test(sold.source || "") ? [15, 85] : null;
  if (!rangePercentiles) return null;
  return {
    basis: "completed_sales",
    grade: "PSA 10",
    market: "eBay",
    currency: sold.currency,
    median: sold.middle,
    rangeLow: sold.low,
    rangeHigh: sold.high,
    rangePercentiles,
    sampleSize: sold.sampleSize,
    sampleCollectedOn: sold.updated,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, sold.updated),
  };
}

function psaPopulation(card, datasetUpdatedOn) {
  const pop = card.graderPop?.psa?.jp;
  if (!pop || !isDate(pop.d) || !Number.isInteger(pop.total) || pop.total < 0) return null;
  const validGrade = (value) => Number.isInteger(value) && value >= 0 && value <= pop.total;
  let grade10 = validGrade(pop.g10) ? pop.g10 : null;
  let grade9 = validGrade(pop.g9) ? pop.g9 : null;
  if ((grade10 ?? 0) + (grade9 ?? 0) > pop.total) grade10 = grade9 = null;
  return {
    printing: "japanese",
    total: pop.total,
    grade10,
    grade9,
    observedOn: pop.d,
    ageDaysAtDatasetUpdate: ageDays(datasetUpdatedOn, pop.d),
  };
}

function originalSetCode(cardNumber) {
  const match = String(cardNumber || "").toUpperCase().match(/^([A-Z]+)(\d{2})-/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function stableName(value) {
  return String(value || "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 60) || "unknown";
}

function buildTopHits(code, set, fx, datasetUpdatedOn) {
  const citationUrl = `${SITE}/sets/${code.toLowerCase()}.html`;
  return [...(set.cards || [])]
    .filter((card) => Number.isInteger(card.rank) && card.rank <= 7)
    .sort((a, b) => a.rank - b.rank)
    .map((card) => ({
      id: `${code}|${card.rank}|${card.number || "unknown"}|${stableName(card.name)}`,
      rank: card.rank,
      containerSetCode: code,
      name: card.name || null,
      cardNumber: card.number || null,
      originalCardSetCode: originalSetCode(card.number),
      // 레어도 = 반다이 공식 카드 리스트의 그 인쇄 레어도(세트·한국어·카드 상세와 같은 함수·같은 코드, 2026-10-15). 종전 원본 값은 SP 인쇄를 SR 로 냈다.
      rarity: CL.rarityCode(code, card) || null,
      exactVariantRequired: true,
      rawNmAsk: rawNmAsk(card, fx, datasetUpdatedOn),
      psa10Sold: psa10Sold(card, datasetUpdatedOn),
      psaPopulation: psaPopulation(card, datasetUpdatedOn),
      qualityFlags: [
        ...(card.nmHiddenReason ? [card.nmHiddenReason] : []),
        ...(!card.number ? ["incomplete_card_number"] : []),
        ...(!CL.rarityCode(code, card) ? ["missing_rarity"] : []),
      ],
      citationUrl,
    }));
}

// 발매·제품 사실 — 2026-10-14(W4). 답변 AI 가 가장 많이 묻는 사실(발매일·정가·팩 수·카드 종수)이 이 파일에 없었다.
// 원천은 data/set-facts.json(반다이 공식 페이지에서 확인한 값, 항목마다 출처·확인일)과 data/official-cardlist.json(공식 카드리스트)
// 둘뿐이다. 영문판 발매일은 set-facts 에 없으면 세트 페이지 상단과 같은 onepiece-packs.json 의 release 를 쓴다.
// 없는 값은 null — 박스당 팩 수를 공식 페이지가 밝히지 않은 세트(OP-18·EB-05)는 박스 정가도 계산하지 않는다.
// 가드 RF1 이 set-facts 와 이 표·llms-full.txt 가 한 칸도 어긋나지 않는지 본다.
const CL = require("./card-list-shared");
function readSetFacts() {
  try { const f = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "set-facts.json"), "utf8")); return f.sets || {}; } catch { return {}; }
}
const pageUrl = (rel) => (fs.existsSync(path.join(ROOT, rel)) ? `${SITE}/${rel}` : null);
function buildReleaseFacts(data, datasetUpdatedOn) {
  const facts = readSetFacts();
  const lists = Object.fromEntries(CL.products().map((p) => [p.code, p]));
  const codes = [...new Set([...Object.keys(facts), ...Object.keys(lists)])].sort(CL.naturalCode);
  return codes.map((code) => {
    const f = facts[code] || {};
    const slug = code.toLowerCase();
    const jpRel = isDate(f.jpRelease?.date) ? f.jpRelease.date : null;
    const enRel = isDate(f.enRelease?.date) ? f.enRelease.date : isDate(data.sets?.[code]?.release) ? data.sets[code].release : null;
    const known = [jpRel, enRel].filter(Boolean).sort();
    const perPack = isPositive(f.jpMsrpYenPerPack) ? f.jpMsrpYenPerPack : isPositive(f.jpMsrpYen) && isPositive(f.packsPerBox) ? Math.round(f.jpMsrpYen / f.packsPerBox) : null;
    const list = lists[code];
    return {
      setCode: code,
      nameEn: CL.nameEnOf(code) || null,
      status: !known.length ? null : datasetUpdatedOn && known[0] <= datasetUpdatedOn ? "released" : "upcoming",
      japanese: {
        releaseDate: jpRel,
        releaseSource: jpRel ? f.jpRelease.source || null : null,
        releaseCheckedOn: jpRel && isDate(f.jpRelease.verifiedOn) ? f.jpRelease.verifiedOn : null,
        msrpYenPerPack: perPack,
        msrpYenPerBox: isPositive(f.jpMsrpYen) ? f.jpMsrpYen : null,
        // 박스 구성이 공식 페이지에 없는 세트(OP-17)는 박스 정가가 계산값이다 — 공식 값과 구분한다(2026-10-14 QA).
        msrpYenPerBoxBasis: isPositive(f.jpMsrpYen) && f.boxConfig && f.boxConfig.stated === false ? "pack price x packsPerBox; box configuration not stated by Bandai" : null,
        packsPerBox: isPositive(f.packsPerBox) ? f.packsPerBox : null,
        cardsPerPack: isPositive(f.cardsPerPack) ? f.cardsPerPack : null,
        cardTypes: f.cardTypes ? String(f.cardTypes) : null,
        specSource: f.jpSpecSource?.source || null,
        specCheckedOn: isDate(f.jpSpecSource?.verifiedOn) ? f.jpSpecSource.verifiedOn : null,
      },
      english: {
        releaseDate: enRel,
        releaseSource: f.enRelease?.source || null,
        msrpUsdPerPack: isPositive(f.enRelease?.msrpUsdPerPack) ? f.enRelease.msrpUsdPerPack : null,
        cardTypes: f.enRelease?.cardTypes ? String(f.enRelease.cardTypes) : null,
        checkedOn: isDate(f.enRelease?.verifiedOn) ? f.enRelease.verifiedOn : null,
      },
      officialCardList: list ? { cards: list.counts.cards, cardNumbers: list.counts.numbers, checkedOn: list.checked || null, officialUrl: list.url || null } : null,
      pages: {
        set: pageUrl(`sets/${slug}.html`),
        englishSet: pageUrl(`sets/${slug}-english.html`),
        cardList: list ? `${SITE}/${CL.pagePath(code)}` : null,
      },
    };
  });
}

// 데이터 기준일(datasetUpdatedOn) — 2026-10-15 QA. 종전엔 packs.updated(10-14)를 그대로 써서 "data as of 2026-10-14" 파일 안에
// 10-15 박스 판매 표본(KST 수집)·경매 일별·TCG 일별 값이 들어 있었고, 경과일 -1 은 0 으로 잘려 나갔다.
// 기준일 = packs.updated 와 AI 파일 4개(핵심·카드·등급·경매)에 실리는 관측일 가운데 가장 늦은 날.
// 네 파일과 llms 가 한 날을 써야 같은 값의 경과일(ageDaysAtDatasetUpdate)이 파일마다 같다. 발매일(releaseDate)은 관측일이 아니라 넣지 않는다.
const OBSERVED_KEYS = new Set(["observedOn", "sampleCollectedOn", "fxObservedOn", "checkedOn", "releaseCheckedOn", "specCheckedOn", "date", "to"]);
function newestObserved(node, best) {
  if (Array.isArray(node)) return node.reduce((b, x) => newestObserved(x, b), best);
  if (!node || typeof node !== "object") return best;
  for (const [key, value] of Object.entries(node)) {
    if (OBSERVED_KEYS.has(key) && isDate(value)) best = !best || value > best ? value : best;
    else if (value && typeof value === "object") best = newestObserved(value, best);
  }
  return best;
}
function datasetAsOf(data) {
  const base = isDate(data.updated) ? data.updated : null;
  const src = extras.loadExtraSources();
  const drafts = [
    buildAiDataAt(data, base),
    extras.buildCardPages(data, src.cardMap, data.fx || {}, base, { rawNmAsk, psa10Sold, psaPopulation }),
    extras.buildGrading(src.gradingSeries, data),
    extras.buildAuctions(src.auctionSeries, src.setAuctionStats, buildReleaseFacts(data, base)),
    extras.buildTcgAuctions(src.tcgSeries),
  ];
  return drafts.reduce((best, part) => newestObserved(part, best), base);
}

/** Build the compact, citation-oriented public contract without network access. */
// 확장 데이터(카드 페이지 전부·등급 인구·경매)는 별도 파일 3개 — generate-ai-extras.js (2026-09-08).
// 이 핵심 파일은 답변 엔진이 한 번에 읽도록 200KB 아래를 지킨다(test-ai-data). related 로 길만 안내한다.
function buildAiData(data) {
  return buildAiDataAt(data, datasetAsOf(data));
}

function buildAiDataAt(data, datasetUpdatedOn) {
  const codes = [...(data.jp?.list || []), ...(data.extra?.list || [])];
  const sets = codes.filter((code) => data.sets?.[code]).map((code) => {
    const set = data.sets[code];
    return {
      setCode: code,
      nameEn: set.nameEn || null,
      nameKo: set.nameKo || null,
      englishReleaseDate: isDate(set.release) ? set.release : null,
      canonicalUrl: `${SITE}/sets/${code.toLowerCase()}.html`,
      // 영문판 박스 페이지(sets/<code>-english.html)가 있으면 그 주소, 없으면 null — 파일 존재가 기준이다.
      englishGuideUrl: fs.existsSync(path.join(ROOT, "sets", `${code.toLowerCase()}-english.html`)) ? `${SITE}/sets/${code.toLowerCase()}-english.html` : null,
      boxMarket: buildBoxMarket(set, datasetUpdatedOn, `${SITE}/sets/${code.toLowerCase()}.html`),
      topHits: buildTopHits(code, set, data.fx || {}, datasetUpdatedOn),
    };
  });
  const releaseFacts = buildReleaseFacts(data, datasetUpdatedOn);
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
      observedOn: isDate(data.fx?.date) ? data.fx.date : null,
      jpyKrw: Number.isFinite(data.fx?.jpyKrw) ? data.fx.jpyKrw : null,
      usdKrw: Number.isFinite(data.fx?.usdKrw) ? data.fx.usdKrw : null,
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
