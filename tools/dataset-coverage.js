"use strict";
// 같은 배포 파일(opbox-ai-data.json · opbox-set-prices.csv · opbox-grading-population.csv)을 가리키는 Dataset 노드의
// 기간(temporalCoverage)·수정일은 이 함수들에서만 계산한다 — 2026-10-14 QA 신설.
// 왜: 같은 opbox-ai-data.json 이 free-data 에선 2026-06-29/10-14, 홈에선 2026-07-07/10-13 이었다(페이지마다 따로 셌다).
//     등급 CSV 도 psa-grading 09-30 · free-data 10-07 로 갈렸다. 기간 = 그 파일에 실린 관측일 전체의 첫날/마지막 날.
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const { buildAiData } = require("./ai-data-model");
const { buildBoxRecords, buildGradeRecords } = require("./free-data-records");

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const readJson = (rel) => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8")); } catch { return null; } };
const span = (dates) => { const v = dates.filter((x) => ISO.test(x || "")).sort(); return v.length ? { from: v[0], to: v.at(-1), coverage: `${v[0]}/${v.at(-1)}` } : null; };

// opbox-ai-data.json — 세트 박스 시장(판매 표본·호가 관측일)과 Top 7 카드의 관측일 전부
function aiDataSpan(packs) {
  const ai = buildAiData(packs);
  const dates = [];
  for (const set of ai.sets) {
    for (const market of Object.values(set.boxMarket)) dates.push(market.sold?.sampleCollectedOn, market.activeAsk?.observedOn);
    for (const hit of set.topHits) dates.push(hit.rawNmAsk?.observedOn, hit.psa10Sold?.sampleCollectedOn, hit.psaPopulation?.observedOn);
  }
  return span(dates);
}
// opbox-set-prices.csv
function boxCsvSpan(packs) { return span(buildBoxRecords(packs).dates); }
// opbox-grading-population.csv · opbox-ai-grading.json
function gradingSpan(packs) { return span(buildGradeRecords(packs, readJson("data/cgc-grading-history.json"), readJson("data/tag-grading-history.json")).dates); }

module.exports = { span, aiDataSpan, boxCsvSpan, gradingSpan };
