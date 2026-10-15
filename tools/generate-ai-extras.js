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
const { SITE } = require("./market-data-normalizers");
const { rawNmAsk, psa10Sold, psaPopulation, buildReleaseFacts, datasetAsOf } = require("./ai-data-model");
const extras = require("./ai-data-extras");

const ROOT = path.resolve(__dirname, "..");
const packs = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "onepiece-packs.json"), "utf8"));
const src = extras.loadExtraSources();
// 기준일은 핵심 파일(opbox-ai-data.json)과 같은 함수 — 실린 관측일 가운데 가장 늦은 날(2026-10-15 QA: packs.updated 10-14 안에 10-15 값).
const datasetUpdatedOn = datasetAsOf(packs);

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

// 세 파일의 내용 — 쓰기와 분리했다(2026-10-15, 3차). 무료 데이터 페이지(generate-free-data.js)가 같은 객체에서 Dataset 수정일·기간을 낸다.
// 왜: free-data 는 CSV 날짜로 셈해 #ai-grading-json·#ai-auctions-json 이 dateModified 10-14 인데 파일 datasetUpdatedOn 은 10-15 였다
//     (생성 순서상 이 파일들은 free-data 뒤에 써져서 파일을 읽으면 하루 전 것을 읽는다 — 같은 함수로 같은 객체를 만든다).
function buildExtraDocs() {
  const cards = extras.buildCardPages(packs, src.cardMap, packs.fx || {}, datasetUpdatedOn, { rawNmAsk, psa10Sold, psaPopulation });
  const grading = extras.buildGrading(src.gradingSeries, packs);   // PSA 총량은 페이지와 같은 packs 값
  const onePiece = extras.buildAuctions(src.auctionSeries, src.setAuctionStats, buildReleaseFacts(packs, datasetUpdatedOn));   // 세트별 행은 발매된 세트만
  const tcg = extras.buildTcgAuctions(src.tcgSeries);
  if (!cards || !grading || !onePiece || !tcg) throw new Error("확장 데이터 원장 누락 — 아무것도 쓰지 않음");
  return {
    "opbox-ai-cards.json": { ...header("opbox-ai-card-pages", "OP Box Index — every tracked One Piece card variant with raw NM and PSA 10 prices", `${SITE}/cards/`), ...cards },
    "opbox-ai-grading.json": { ...header("opbox-ai-grading", "OP Box Index — graded population per set (PSA, CGC, TAG)", `${SITE}/psa-grading.html`), ...grading },
    "opbox-ai-auctions.json": { ...header("opbox-ai-auctions", "OP Box Index — settled eBay auction results: One Piece daily/weekly/by set, and 13 trading card games", `${SITE}/auction.html`), onePiece, tcg },
  };
}
module.exports = { buildExtraDocs };

if (require.main === module) {
  const docs = buildExtraDocs();
  const out = Object.fromEntries(Object.entries(docs).map(([file, obj]) => [file, write(file, obj)]));
  console.log(JSON.stringify({ wrote: out, cards: docs["opbox-ai-cards.json"].count, gradedSets: docs["opbox-ai-grading.json"].sets.length, auctionDays: docs["opbox-ai-auctions.json"].onePiece.daily.length, tcgGames: docs["opbox-ai-auctions.json"].tcg.games.length }));
}
