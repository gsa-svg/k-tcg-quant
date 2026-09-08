"use strict";
// opbox-ai-data.json 확장 섹션 — 2026-09-08. 답변 AI(ChatGPT·Perplexity·Google AI)가 우리 데이터로 답하게
// 세트 박스 시세·Top 7 외에 (1) 원피스 경매 낙찰 통계 (2) TCG 13종 경매 통계 (3) 세트별 등급 인구(PSA·CGC·TAG)
// (4) 카드 페이지 전체(108장) 색인을 한 파일에 싣는다. 값은 전부 우리 원장에서 그대로 옮기고, 없는 값은 null 이다.
//
// 규칙: 추정 금지 · 라벨 보존(sold/ask/NM/PSA) · 날짜 동반 · 내부 필드(검색어·매물 id·판매자) 비공개.
const fs = require("node:fs");
const path = require("node:path");
const { SITE, isDate, isPositive } = require("./market-data-normalizers");

const ROOT = path.resolve(__dirname, "..");
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
const num = (v) => (Number.isFinite(v) ? v : null);
const pct = (sold, ended, min) => (Number.isFinite(sold) && Number.isFinite(ended) && ended >= min ? Math.round((sold / ended) * 1000) / 10 : null);
const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Reads every auxiliary ledger the extended sections need. Missing files yield null sections, never invented ones. */
function loadExtraSources() {
  return {
    auctionSeries: readJson("data/auction-series.json"),
    tcgSeries: readJson("data/tcg-series.json"),
    setAuctionStats: readJson("data/set-auction-stats.json"),
    gradingSeries: readJson("data/grading-series.json"),
    cardMap: readJson("cards/card-map.json"),
  };
}

function catBlock(byCat) {
  const out = {};
  for (const [cat, v] of Object.entries(byCat || {})) {
    out[cat] = { ended: num(v.ended), sold: num(v.sold), sellThroughPct: pct(v.sold, v.ended, 20), amountUsd: num(v.amount) };
  }
  return out;
}

/** One Piece auctions settled after close: last 30 days, last 8 weeks, and 30-day totals per set. */
function buildAuctions(series, setStats) {
  if (!series || !Array.isArray(series.daily)) return null;
  const daily = series.daily.slice(-30).map((d) => ({
    date: d.d,
    partialDay: !!d.partial,
    ended: num(d.ended), sold: num(d.sold), unsold: num(d.unsold),
    sellThroughPct: num(d.sellThrough),
    amountUsd: num(d.amount),
    byCategory: catBlock(d.byCat),
    byPrinting: catBlock(d.byEd),
  }));
  const weekly = (series.weekly || []).slice(-8).map((w) => ({
    weekStart: w.d, days: num(w.days), partialDays: num(w.partialDays),
    ended: num(w.ended), sold: num(w.sold), sellThroughPct: num(w.sellThrough), amountUsd: num(w.amount),
    byCategory: catBlock(w.byCat),
  }));
  const bySet = [];
  for (const [code, s] of Object.entries(setStats?.sets || {})) {
    bySet.push({
      setCode: code, canonicalUrl: `${SITE}/sets/${code.toLowerCase()}.html`,
      ended: num(s.ended), sold: num(s.sold), sellThroughPct: num(s.sellThrough),
      amountUsd: num(s.amount), medianWinningBidUsd: num(s.medPrice), medianBidders: num(s.medBidders),
      thinSample: !!s.thin,
      byCategory: Object.fromEntries(Object.entries(s.byCat || {}).map(([cat, v]) => [cat, { ended: num(v.ended), sold: num(v.sold), sellThroughPct: num(v.sellThrough) }])),
      // 판본(일본판/영문판)별 — 제목으로 판을 못 가린 건은 어느 쪽에도 없다. 영문판 페이지가 같은 숫자를 보여준다.
      byPrinting: Object.fromEntries(Object.entries(s.byEd || {}).map(([ed, v]) => [ed === "jp" ? "japanese" : "english", {
        ended: num(v.ended), sold: num(v.sold), sellThroughPct: num(v.sellThrough), medianWinningBidUsd: num(v.medPrice),
        byCategory: Object.fromEntries(Object.entries(v.byCat || {}).map(([cat, c]) => [cat, { ended: num(c.ended), sold: num(c.sold), sellThroughPct: num(c.sellThrough) }])),
      }])),
    });
  }
  return {
    basis: series.basis || null,
    definitions: {
      sellThroughPct: "sold ÷ ended among auctions re-read after they closed; null when the sample is below the minimum",
      amountUsd: "sum of winning bids in USD for auctions that sold",
      partialDay: "true when part of that day's auctions could not be read back (a gap, not zero activity)",
      byCategory: "box = sealed booster boxes, graded = PSA/CGC/TAG slabs, raw = ungraded singles, pack = booster packs, lot = multi-card lots",
      byPrinting: "jp = Japanese, en = English, other = unidentified or other languages; per set, byPrinting.japanese / byPrinting.english split that set's auctions and leave unidentified printings out",
    },
    canonicalPage: `${SITE}/auction.html`,
    daily, weekly,
    bySet: { windowDays: num(setStats?.window?.days), from: setStats?.window?.from || null, to: setStats?.window?.to || null, observedOn: setStats?.updated || null, sets: bySet },
  };
}

/** Thirteen trading card games: settled-auction sell-through and winning-bid medians, last 14 days. */
function buildTcgAuctions(series) {
  if (!series || !Array.isArray(series.daily)) return null;
  const games = Object.entries(series.games || {}).sort((a, b) => (a[1].order ?? 0) - (b[1].order ?? 0))
    .map(([key, g]) => ({ key, name: g.name || key }));
  const daily = series.daily.slice(-14).map((d) => ({
    date: d.d,
    games: Object.fromEntries(Object.entries(d.games || {}).map(([k, g]) => [k, {
      ended: num(g.ended), sold: num(g.sold), sellThroughPct: num(g.sellThrough),
      medianWinningBidUsd: num(g.medPrice), priceSample: num(g.priceN), amountUsd: num(g.amount),
      liveAuctions: num(g.live), endingWithin24h: num(g.endingToday), bidRatePct: num(g.bidRate),
    }])),
  }));
  return {
    basis: series.basis || null,
    definitions: {
      ended: "auctions from the daily sample that closed and were re-read (a sample, not every auction on eBay)",
      sellThroughPct: `sold ÷ ended; null when ended is below ${series.minRateSample ?? 20}`,
      liveAuctions: "eBay's own count of running auctions for that game at snapshot time — a real count, not a sample",
      endingWithin24h: "eBay's own count of auctions closing within 24 hours at snapshot time",
      medianWinningBidUsd: "median winning bid among the sold auctions in the sample",
    },
    canonicalPage: `${SITE}/tcg-auction.html`,
    games, daily,
  };
}

function latestPoint(arr) {
  if (!Array.isArray(arr) || !arr.length) return null;
  const p = arr[arr.length - 1];
  const total = num(p.total);
  const gem = num(p.gem);
  return { observedOn: p.d || null, total, gem10: gem, gemRatePct: total && gem != null ? Math.round((gem / total) * 1000) / 10 : null, addedSinceLastPoint: num(p.add) };
}

/** Per-set graded population: PSA, CGC and TAG kept separate; Japanese and English never summed. */
function buildGrading(series) {
  if (!series?.sets) return null;
  const sets = [];
  for (const [code, eds] of Object.entries(series.sets)) {
    const edition = (ed) => {
      if (!ed) return null;
      const psa = Array.isArray(ed.psa) ? latestPoint(ed.psa) : (ed.psaLatest ? latestPoint([ed.psaLatest]) : null);
      return { psa, cgc: latestPoint(ed.cgc), tag: latestPoint(ed.tag) };
    };
    sets.push({ setCode: code, canonicalUrl: `${SITE}/psa-grading.html`, japanese: edition(eds.jp), english: edition(eds.en) });
  }
  return {
    basis: series.basis || series.note || "weekly graded-population counts per set and printing",
    definitions: {
      total: "graded copies the grader reports for that set and printing on observedOn",
      gem10: "PSA 10 / CGC 10 (Pristine + Gem Mint) / TAG 10 + 10 Pristine counts; graders define 10 differently, so never add them across graders",
      gemRatePct: "gem10 ÷ total × 100",
    },
    observedOn: series.updated || null,
    sets,
  };
}

// PSA 10 sold 는 원장 통화(KRW/JPY/USD) 그대로 실린다 — 답변 AI 가 KRW 를 달러로 읽는 사고(2026-09-08 llms-full 실측)를 막기 위해
// 같은 날 환율로 USD 환산값을 병기한다. 원본 필드는 손대지 않는다.
function withUsd(p, fx) {
  if (!p) return null;
  const rate = p.currency === "USD" ? 1 : p.currency === "KRW" && fx?.usdKrw ? 1 / fx.usdKrw : p.currency === "JPY" && fx?.usdKrw && fx?.jpyKrw ? fx.jpyKrw / fx.usdKrw : null;
  if (!rate) return p;
  const usd = (v) => (Number.isFinite(v) ? Math.round(v * rate * 100) / 100 : null);
  return { ...p, medianUsd: usd(p.median), rangeLowUsd: usd(p.rangeLow), rangeHighUsd: usd(p.rangeHigh), fxObservedOn: fx?.date || null };
}

/** Every published card price page, with the same numbers the page shows. */
function buildCardPages(data, cardMap, fx, datasetUpdatedOn, helpers) {
  if (!cardMap || !data?.sets) return null;
  const index = new Map();
  for (const [code, set] of Object.entries(data.sets)) {
    for (const card of set.cards || []) {
      if (!card.number) continue;
      const key = `${card.number}|${norm(card.name)}`;
      const isHome = card.number.replace("-", "").toUpperCase().startsWith(code.replace("-", "").toUpperCase());
      const prev = index.get(key);
      if (!prev || (isHome && !prev.isHome)) index.set(key, { code, card, isHome });
    }
  }
  const pages = [];
  for (const [key, file] of Object.entries(cardMap)) {
    const hit = index.get(key);
    if (!hit) continue;
    const { code, card } = hit;
    pages.push({
      cardNumber: card.number, name: card.name || null, rarity: card.rarity || null,
      containerSetCode: code,
      url: `${SITE}/cards/${file}`,
      exactVariantRequired: true,
      rawNmAsk: helpers.rawNmAsk(card, fx, datasetUpdatedOn),
      psa10Sold: withUsd(helpers.psa10Sold(card, datasetUpdatedOn), fx),
      psaPopulation: helpers.psaPopulation(card, datasetUpdatedOn),
    });
  }
  pages.sort((a, b) => (b.rawNmAsk?.usdEquivalent || 0) - (a.rawNmAsk?.usdEquivalent || 0));
  return {
    note: "One page per tracked card variant. Numbers match the page; rawNmAsk is a Japanese retail asking price, psa10Sold a verified eBay sold median.",
    canonicalPage: `${SITE}/cards/`,
    count: pages.length,
    pages,
  };
}

module.exports = { loadExtraSources, buildAuctions, buildTcgAuctions, buildGrading, buildCardPages, norm, isDate, isPositive };
