#!/usr/bin/env node
"use strict";
// 답변 AI 용 확장 데이터 파일 3개 — 2026-09-08.
//   opbox-ai-cards.json    : 공개된 카드 페이지 전부(카드번호·이름·세트·NM·PSA 10 sold·PSA 인구·페이지 URL)
//   opbox-ai-grading.json  : 세트별 등급 인구(PSA·CGC·TAG, 일본판·영문판 분리)
//   opbox-ai-auctions.json : 원피스 경매(일별·주별·세트별) + TCG 13종 경매(일별)
// 핵심 파일 opbox-ai-data.json 은 검색엔진이 한 번에 읽을 수 있게 200KB 아래로 유지한다(test-ai-data). 그래서 나머지는 따로 낸다.
// 값은 전부 우리 원장에서 그대로 옮긴다(추정 금지). 라벨·날짜 동반. 내부 필드(검색어·매물 id·판매자) 없음.
// Run: node tools/generate-ai-extras.js   (generate-ai-data.js 다음, generate-llms.js 전)
const fs = require("node:fs");
const path = require("node:path");
const { SITE, isDate } = require("./market-data-normalizers");
const { rawNmAsk, psa10Sold, psaPopulation } = require("./ai-data-model");
const extras = require("./ai-data-extras");

const ROOT = path.resolve(__dirname, "..");
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const src = extras.loadExtraSources();
const datasetUpdatedOn = isDate(packs.updated) ? packs.updated : null;

const header = (id, name, canonicalPage) => ({
  schemaVersion: "1.0.0",
  datasetId: id,
  name,
  datasetUpdatedOn,
  publisher: { name: "OP Box Index", url: `${SITE}/` },
  canonicalPage,
  license: { name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  attribution: `Data: OP Box Index — ${SITE}/free-data.html`,
  nullPolicy: "null means unavailable or not verified; it never means zero",
  coreDataset: `${SITE}/opbox-ai-data.json`,
});

function write(file, obj) {
  const text = `${JSON.stringify(obj, null, 1)}\n`;
  fs.writeFileSync(path.join(ROOT, file), text, "utf8");
  return Buffer.byteLength(JSON.stringify(obj));
}

const cards = extras.buildCardPages(packs, src.cardMap, packs.fx || {}, datasetUpdatedOn, { rawNmAsk, psa10Sold, psaPopulation });
const grading = extras.buildGrading(src.gradingSeries);
const onePiece = extras.buildAuctions(src.auctionSeries, src.setAuctionStats);
const tcg = extras.buildTcgAuctions(src.tcgSeries);
if (!cards || !grading || !onePiece || !tcg) throw new Error("확장 데이터 원장 누락 — 아무것도 쓰지 않음");

const out = {
  "opbox-ai-cards.json": write("opbox-ai-cards.json", { ...header("opbox-ai-card-pages", "OP Box Index — every tracked One Piece card variant with raw NM and PSA 10 prices", `${SITE}/cards/`), ...cards }),
  "opbox-ai-grading.json": write("opbox-ai-grading.json", { ...header("opbox-ai-grading", "OP Box Index — graded population per set (PSA, CGC, TAG)", `${SITE}/psa-grading.html`), ...grading }),
  "opbox-ai-auctions.json": write("opbox-ai-auctions.json", { ...header("opbox-ai-auctions", "OP Box Index — settled eBay auction results: One Piece daily/weekly/by set, and 13 trading card games", `${SITE}/auction.html`), onePiece, tcg }),
};
console.log(JSON.stringify({ wrote: out, cards: cards.count, gradedSets: grading.sets.length, auctionDays: onePiece.daily.length, tcgGames: tcg.games.length }));
